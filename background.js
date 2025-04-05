// Sonara Meet Transcriptor - Background Script
console.log("[Sonara Background] Script de fundo iniciado");

// Estado inicial
let activeTabId = null;
let isRecording = false;

// Inicialização
chrome.runtime.onInstalled.addListener(() => {
  console.log("[Sonara Background] Extensão instalada/atualizada");
  
  // Restaura estado anterior se existir
  chrome.storage.local.get(["isRecording"], (data) => {
    isRecording = !!data.isRecording;
    updateIcon();
  });
});

// Escuta mensagens dos scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("[Sonara Background] Mensagem recebida:", message);
  
  // Mensagem do content script informando que está pronto
  if (message.action === "contentScriptActive" && sender.tab) {
    activeTabId = sender.tab.id;
    console.log("[Sonara Background] Content script pronto na aba:", activeTabId);
  }
  
  // Atualização do status de gravação
  else if (message.action === "recordingStatusChanged") {
    isRecording = message.isRecording;
    updateIcon();
  }
  
  // Status da reunião
  else if (message.action === "meetingStatus") {
    console.log("[Sonara Background] Status da reunião:", message.isActive ? "Ativa" : "Inativa");
  }
  
  // Atualização da transcrição (usado principalmente para notificar o popup)
  else if (message.action === "transcriptUpdated") {
    // Propaga a mensagem para o popup se estiver aberto
    chrome.runtime.sendMessage({
      action: "transcriptUpdated", 
      transcript: message.transcript
    }).catch(() => {
      // É normal falhar se o popup não estiver aberto
    });
  }
  
  return true; // Mantém a conexão aberta para respostas assíncronas
});

// Atualiza o ícone da extensão de acordo com o estado
function updateIcon() {
  const iconPath = isRecording 
    ? {
        "16": "icons/icon16-recording.png",
        "32": "icons/icon32-recording.png",
        "48": "icons/icon48-recording.png",
        "128": "icons/icon128-recording.png"
      }
    : {
        "16": "icons/icon16.png",
        "32": "icons/icon32.png",
        "48": "icons/icon48.png",
        "128": "icons/icon128.png"
      };
      
  chrome.action.setIcon({ path: iconPath });
}

// Monitora quando o usuário fecha uma aba do Google Meet
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === activeTabId) {
    console.log("[Sonara Background] Aba do Meet fechada:", tabId);
    activeTabId = null;
  }
});