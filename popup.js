// Sonara Meet Transcriptor - Popup Script
console.log("[Sonara Popup] Inicializando popup...");

// Elementos DOM
const toggleRecordingBtn = document.getElementById('toggle-recording');
const downloadBtn = document.getElementById('download-transcript');
const clearBtn = document.getElementById('clear-transcript');
const statusBadge = document.getElementById('status-badge');
const meetingInfo = document.getElementById('meeting-info');
const transcriptContent = document.getElementById('transcript-content');

// Estado local
let isRecording = false;
let transcript = [];
let activeTabId = null;
let meetingId = "";
let pendingPreviewUpdate = null;

// Inicializa o popup
document.addEventListener('DOMContentLoaded', initializePopup);

// Configura os event listeners
function setupEventListeners() {
  toggleRecordingBtn.addEventListener('click', toggleRecording);
  downloadBtn.addEventListener('click', downloadTranscript);
  clearBtn.addEventListener('click', clearTranscript);
}

// Inicializa o popup e carrega o estado atual
async function initializePopup() {
  console.log("[Sonara Popup] Inicializando popup");
  setupEventListeners();
  
  try {
    // Obtém a aba ativa
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    console.log("[Sonara Popup] Tabs encontradas:", tabs.length);
    
    if (tabs.length > 0) {
      activeTabId = tabs[0].id;
      console.log("[Sonara Popup] Tab ativa:", tabs[0].url);
      
      // Verifica se estamos em uma página do Google Meet
      if (tabs[0].url && tabs[0].url.includes("meet.google.com")) {
        meetingInfo.textContent = "Conectando com o Meet...";
        
        // Primeiro, recupera qualquer transcrição já salva
        chrome.storage.local.get(["transcript", "isRecording", "meetingId"], (data) => {
          if (data.transcript && data.transcript.length > 0) {
            transcript = data.transcript;
            isRecording = !!data.isRecording;
            meetingId = data.meetingId || meetingId;
            
            // Atualiza a UI imediatamente com os dados do storage
            updateRecordingButton();
            updateTranscriptPreview(true); // Força atualização imediata
            
            if (transcript.length > 0) {
              enableDownloadButton();
            }
          }
        });
        
        // Solicita ao content script para verificar o estado atual
        try {
          chrome.tabs.sendMessage(activeTabId, { action: "getState" }, (response) => {
            console.log("[Sonara Popup] Resposta do getState:", response);
            
            if (response) {
              updateUIState(response);
              
              // Se não estamos gravando, verifica as legendas
              if (!isRecording) {
                scanForCaptions();
              }
            } else {
              console.error("[Sonara Popup] Não recebeu resposta do content script");
              showErrorMessage("Erro de comunicação com a página. Tente recarregar a extensão.");
            }
          });
        } catch (error) {
          console.error("[Sonara Popup] Erro ao comunicar com content script:", error);
          showErrorMessage("Não foi possível comunicar com a página. Recarregue a extensão.");
        }
      } else {
        showNotInMeetMessage("Não está em uma página do Google Meet");
      }
    } else {
      showNotInMeetMessage("Nenhuma aba ativa detectada");
    }
  } catch (error) {
    console.error("[Sonara Popup] Erro ao inicializar:", error);
    showErrorMessage("Erro ao inicializar: " + error.message);
  }
}

// Escaneia por legendas na página atual
function scanForCaptions() {
  if (activeTabId) {
    chrome.tabs.sendMessage(activeTabId, { action: "scanForCaptions" }, (response) => {
      if (response && response.success) {
        console.log("[Sonara Popup] Resultados do escaneamento de legendas:", response.captionsInfo);
        
        // Verifica se encontramos algum elemento de legenda
        const foundCaptions = Object.values(response.captionsInfo)
          .some(info => (info.count && info.count > 0));
        
        if (foundCaptions) {
          // Atualiza a UI para mostrar que encontramos legendas
          updateUIForCaptions(response.captionsInfo);
        } else {
          // Não encontramos legendas, mas a reunião ainda pode estar ativa
          updateUIForNoLegends();
        }
      }
    });
  }
}

// Atualiza a UI quando encontramos legendas
function updateUIForCaptions(captionsInfo) {
  // Só mostra esta informação se não estiver gravando e não tiver transcrições
  if (isRecording || transcript.length > 0) {
    return;
  }
  
  statusBadge.textContent = "Pronto";
  statusBadge.className = "badge ready";
  meetingInfo.textContent = "Reunião ativa com legendas detectadas";
  
  let previewHTML = '<div class="transcript-item">';
  previewHTML += '<div class="transcript-header">';
  previewHTML += '<span class="speaker">Sistema</span>';
  previewHTML += '<span class="time">' + new Date().toLocaleTimeString() + '</span>';
  previewHTML += '</div>';
  previewHTML += '<div class="message">';
  previewHTML += '<p>Legendas detectadas! Clique em "Iniciar Gravação" para começar a transcrição.</p>';
  
  // Mostra exemplos de textos encontrados
  let exampleTexts = [];
  Object.keys(captionsInfo).forEach(selector => {
    if (captionsInfo[selector].texts && captionsInfo[selector].texts.length > 0) {
      captionsInfo[selector].texts.forEach(text => {
        if (text && text.length > 0 && !exampleTexts.includes(text)) {
          exampleTexts.push(text);
        }
      });
    }
  });
  
  if (exampleTexts.length > 0) {
    previewHTML += '<p>Exemplos de textos detectados:</p><ul>';
    exampleTexts.slice(0, 3).forEach(text => {
      previewHTML += `<li>${escapeHTML(text)}</li>`;
    });
    previewHTML += '</ul>';
  }
  
  previewHTML += '</div></div>';
  
  transcriptContent.innerHTML = previewHTML;
  toggleRecordingBtn.disabled = false;
}

// Atualiza a UI quando não encontramos legendas
function updateUIForNoLegends() {
  // Só mostra esta informação se não estiver gravando e não tiver transcrições
  if (isRecording || transcript.length > 0) {
    return;
  }
  
  statusBadge.textContent = "Atenção";
  statusBadge.className = "badge ready";
  meetingInfo.textContent = "Reunião detectada, mas sem legendas ativas";
  
  transcriptContent.innerHTML = `
    <div class="transcript-item">
      <div class="transcript-header">
        <span class="speaker">Sistema</span>
        <span class="time">${new Date().toLocaleTimeString()}</span>
      </div>
      <div class="message">
        <p>Reunião detectada, mas nenhuma legenda foi encontrada.</p>
        <p>Por favor, ative as legendas no Google Meet:</p>
        <ol>
          <li>Clique no botão "CC" na barra inferior do Meet</li>
          <li>Selecione a opção "Português (Brasil)" ou seu idioma preferido</li>
          <li>Fale algo para testar se as legendas aparecem</li>
        </ol>
        <p>Após ativar as legendas, clique no botão "Iniciar Gravação".</p>
      </div>
    </div>
  `;
  
  toggleRecordingBtn.disabled = false;
}

// Atualiza a interface com o estado atual
function updateUIState(state) {
  console.log("[Sonara Popup] Atualizando UI com estado:", state);
  
  isRecording = state.isRecording;
  if (state.transcript) transcript = state.transcript;
  meetingId = state.meetingId || "Current Meeting";
  
  // Atualiza o botão de gravação
  updateRecordingButton();
  
  // Atualiza a prévia da transcrição
  updateTranscriptPreview();
  
  // Atualiza o badge de status
  statusBadge.textContent = isRecording ? "Gravando" : "Pronto";
  statusBadge.className = "badge " + (isRecording ? "recording" : "ready");
  
  // Atualiza a informação da reunião
  meetingInfo.textContent = `Reunião: ${meetingId || "Atual"}`;
  
  // Habilita/desabilita botão de download
  if (transcript && transcript.length > 0) {
    enableDownloadButton();
  }
  
  // Habilita o botão de gravação
  toggleRecordingBtn.disabled = false;
}

// Mostra mensagem quando não estamos em uma reunião do Meet
function showNotInMeetMessage(message) {
  meetingInfo.textContent = message || "Não está em uma reunião do Google Meet";
  toggleRecordingBtn.disabled = true;
  statusBadge.textContent = "Indisponível";
  statusBadge.className = "badge inactive";
  
  // Ainda assim, verifica se temos transcrições salvas
  chrome.storage.local.get(["transcript"], (data) => {
    if (data.transcript && data.transcript.length > 0) {
      transcript = data.transcript;
      updateTranscriptPreview(true); // Força atualização imediata
      enableDownloadButton();
    }
  });
}

// Mostra mensagem de erro
function showErrorMessage(message) {
  meetingInfo.textContent = "Erro detectado";
  statusBadge.textContent = "Erro";
  statusBadge.className = "badge inactive";
  
  transcriptContent.innerHTML = `
    <div class="transcript-item">
      <div class="transcript-header">
        <span class="speaker">Erro</span>
      </div>
      <div class="message" style="color: #d93025;">${message}</div>
    </div>
  `;
}

// Atualiza o botão de gravação conforme estado
function updateRecordingButton() {
  if (isRecording) {
    toggleRecordingBtn.classList.add('recording');
    toggleRecordingBtn.querySelector('.btn-text').textContent = "Parar Gravação";
  } else {
    toggleRecordingBtn.classList.remove('recording');
    toggleRecordingBtn.querySelector('.btn-text').textContent = "Iniciar Gravação";
  }
}

// Atualiza a prévia da transcrição com buffer para evitar flickering
function updateTranscriptPreview(forceUpdate = false) {
  // Cancela qualquer atualização pendente
  if (pendingPreviewUpdate) {
    clearTimeout(pendingPreviewUpdate);
  }
  
  // Se forçar atualização, mostra imediatamente
  if (forceUpdate) {
    renderTranscriptPreview();
    return;
  }
  
  // Caso contrário, agenda atualização com delay para buffer
  pendingPreviewUpdate = setTimeout(() => {
    renderTranscriptPreview();
    pendingPreviewUpdate = null;
  }, 1000); // Buffer de 1 segundo
}

// Renderiza a prévia da transcrição
function renderTranscriptPreview() {
  if (!transcript || transcript.length === 0) {
    transcriptContent.innerHTML = 
      '<p class="empty-state">A transcrição aparecerá aqui quando disponível.</p>';
    clearBtn.disabled = true;
    return;
  }
  
  clearBtn.disabled = false;
  
  // Não precisamos limpar duplicatas aqui, pois isso já é feito no content script
  // Apenas garantimos ordenação por timestamp
  const sortedTranscript = [...transcript].sort((a, b) => {
    const aTime = a.timestampMs || new Date(a.timestamp).getTime();
    const bTime = b.timestampMs || new Date(b.timestamp).getTime();
    return aTime - bTime;
  });
  
  // Limita a prévia aos últimos 5 itens
  const previewItems = sortedTranscript.slice(-5);
  let previewHTML = '';
  
  previewItems.forEach(item => {
    // Formata o timestamp para exibição
    let formattedTime = "";
    try {
      const date = new Date(item.timestamp);
      formattedTime = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch (e) {
      formattedTime = "";
    }
    
    previewHTML += `
      <div class="transcript-item">
        <div class="transcript-header">
          <span class="speaker">${escapeHTML(item.speaker || "Unknown")}</span>
          <span class="time">${formattedTime}</span>
        </div>
        <div class="message">${escapeHTML(item.text || "")}</div>
      </div>
    `;
  });
  
  // Adiciona contador se houver mais itens
  if (sortedTranscript.length > 5) {
    previewHTML += `<div class="more-items">+ ${sortedTranscript.length - 5} mais itens</div>`;
  }
  
  transcriptContent.innerHTML = previewHTML;
}

// Ativa/desativa a gravação
function toggleRecording() {
  if (activeTabId) {
    const action = isRecording ? "stopRecording" : "startRecording";
    
    chrome.tabs.sendMessage(activeTabId, { action }, (response) => {
      if (response && response.success) {
        isRecording = !isRecording;
        updateRecordingButton();
        
        // Atualiza o badge
        statusBadge.textContent = isRecording ? "Gravando" : "Pronto";
        statusBadge.className = "badge " + (isRecording ? "recording" : "ready");
        
        // Se parou a gravação, solicita transcrição atualizada
        if (!isRecording) {
          setTimeout(() => {
            chrome.tabs.sendMessage(activeTabId, { action: "getState" }, (stateResponse) => {
              if (stateResponse && stateResponse.transcript) {
                transcript = stateResponse.transcript;
                updateTranscriptPreview(true); // Força atualização imediata
              }
            });
          }, 1000);
        }
      }
    });
  }
}

// Habilita o botão de download
function enableDownloadButton() {
  downloadBtn.disabled = false;
}

// Baixa a transcrição como arquivo de texto
function downloadTranscript() {
  if (!transcript || transcript.length === 0) return;
  
  // Usa a transcrição ordenada por timestamp
  const sortedTranscript = [...transcript].sort((a, b) => {
    const aTime = a.timestampMs || new Date(a.timestamp).getTime();
    const bTime = b.timestampMs || new Date(b.timestamp).getTime();
    return aTime - bTime;
  });
  
  // Formata a transcrição como texto
  let textContent = `# Sonara Meet Transcriptor - Transcrição da Reunião\n`;
  textContent += `# Reunião: ${meetingId}\n`;
  textContent += `# Data: ${new Date().toLocaleDateString()}\n\n`;
  
  // Adiciona cada item da transcrição
  sortedTranscript.forEach(item => {
    let formattedTime = "";
    try {
      const date = new Date(item.timestamp);
      formattedTime = date.toLocaleTimeString([], { 
        hour: '2-digit', 
        minute: '2-digit',
        second: '2-digit'
      });
    } catch (e) {
      formattedTime = "";
    }
    
    textContent += `[${formattedTime}] ${item.speaker}: ${item.text}\n`;
  });

  // Cria um arquivo Blob
  const blob = new Blob([textContent], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  
  // Cria um elemento de link para download
  const a = document.createElement('a');
  a.href = url;
  a.download = `sonara-transcript-${new Date().toISOString().split('T')[0]}.txt`;
  a.click();
  
  // Limpa o URL criado
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 100);
}

// Limpa a transcrição atual
function clearTranscript() {
  if (confirm("Tem certeza que deseja limpar a transcrição atual?")) {
    if (activeTabId) {
      chrome.tabs.sendMessage(activeTabId, { action: "clearTranscript" }, () => {
        transcript = [];
        updateTranscriptPreview(true); // Força atualização imediata
        downloadBtn.disabled = true;
      });
    } else {
      // Se não estamos em uma aba do Meet, limpa diretamente o storage
      chrome.storage.local.set({ transcript: [] }, () => {
        transcript = [];
        updateTranscriptPreview(true); // Força atualização imediata
        downloadBtn.disabled = true;
      });
    }
  }
}

// Escuta por atualizações na transcrição do content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("[Sonara Popup] Mensagem recebida:", message);
  
  if (message.action === "transcriptUpdated") {
    transcript = message.transcript;
    updateTranscriptPreview(); // Usa buffer para evitar flickering
    enableDownloadButton();
  } else if (message.action === "recordingStatusChanged") {
    isRecording = message.isRecording;
    updateRecordingButton();
    
    statusBadge.textContent = isRecording ? "Gravando" : "Pronto";
    statusBadge.className = "badge " + (isRecording ? "recording" : "ready");
  } else if (message.action === "transcriptCleared") {
    transcript = [];
    updateTranscriptPreview(true); // Força atualização imediata
    downloadBtn.disabled = true;
  }
  
  return true;
});

// Função de utilidade para escapar HTML e prevenir XSS
function escapeHTML(text) {
  if (!text) return '';
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}