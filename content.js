// Sonara Meet Transcriptor - Content Script
console.log("[Sonara] Content script iniciado em: " + window.location.href);

// Injeta o script diretamente na página do Meet para acesso completo ao DOM
function injectScriptIntoPage() {
  console.log("[Sonara] Injetando script na página para ativar legendas automaticamente");
  
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('content_script_inject.js');
  script.onload = function() {
    this.remove(); // Remove o elemento script após carregar (o código já estará executando)
  };
  (document.head || document.documentElement).appendChild(script);
}

// Executa a injeção do script
injectScriptIntoPage();

// Estado global da transcrição
let transcript = [];
let isRecording = false;
let speakerBuffer = {};
let pendingCaptionTimeout = null;
let consolidationTimeout = null;
let meetingId = "";
let meetingStartTime = null;
let subtitleObserver = null;
let setupObserver = null;
let lastNotificationTime = 0;

// Configurações
const SENTENCE_BUFFER_TIME = 3000;   // Tempo de espera para consolidar uma frase (3 segundos)
const CONSOLIDATION_INTERVAL = 8000; // Intervalo para executar consolidação global (8 segundos)
const NOTIFICATION_THROTTLE = 2000;  // Limita notificações a cada 2 segundos 
const MIN_WORDS_FOR_NEW_SENTENCE = 3; // Mínimo de palavras para considerar uma nova frase 

// Inicializa a extensão quando a página carregar
setTimeout(initializeExtension, 1000);

// Recebe mensagens do popup e background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("[Sonara] Mensagem recebida no content script:", message);
  
  if (message.action === "getState") {
    const state = {
      isRecording,
      transcript,
      meetingId,
      isMeeting: true,
      url: window.location.href
    };
    console.log("[Sonara] Enviando estado:", state);
    sendResponse(state);
  } else if (message.action === "checkMeeting") {
    // Força reconhecimento de reunião ativa
    const response = {
      isMeeting: true,
      url: window.location.href,
      title: document.title,
      elements: detectMeetElements()
    };
    console.log("[Sonara] Resultado checkMeeting:", response);
    sendResponse(response);
  } else if (message.action === "startRecording") {
    startRecording();
    sendResponse({ success: true, isRecording: true });
  } else if (message.action === "stopRecording") {
    stopRecording();
    sendResponse({ success: true, isRecording: false });
  } else if (message.action === "clearTranscript") {
    clearTranscript();
    sendResponse({ success: true });
  } else if (message.action === "scanForCaptions") {
    const captionsInfo = scanForCaptions();
    sendResponse({ success: true, captionsInfo });
  }
  
  return true; // Mantém a conexão aberta para respostas assíncronas
});

// Detecta elementos do Meet para confirmação de reunião ativa
function detectMeetElements() {
  return {
    videoElements: document.querySelectorAll('video').length,
    participantsList: document.querySelectorAll('[aria-label*="participant"], [aria-label*="Participante"]').length,
    controlButtons: document.querySelectorAll('button[jsname], .XCoPyb, .BvDXcd').length,
    captions: document.querySelectorAll('.iTTPOb, .VbkSUe, [jsname="dsyhDe"], [jscontroller="TEjq6e"]').length
  };
}

// Inicializa a extensão e configura observers
function initializeExtension() {
  console.log("[Sonara] Inicializando extensão...");
  
  // Extrai ID da reunião da URL
  meetingId = window.location.pathname.substring(1);
  
  // Notifica que estamos em uma reunião
  chrome.runtime.sendMessage({
    action: "meetingStatus",
    isActive: true,
    url: window.location.href
  });
  
  // Configura o observer para detectar quando as legendas estiverem prontas
  setupObserver = new MutationObserver(checkForCaptions);
  setupObserver.observe(document.body, { 
    childList: true, 
    subtree: true 
  });
  
  // Escaneia para legendas imediatamente
  scanForCaptions();
  
  // Inicia o intervalo de consolidação global
  startConsolidationInterval();
}

// Inicia o intervalo de consolidação global
function startConsolidationInterval() {
  if (consolidationTimeout) {
    clearInterval(consolidationTimeout);
  }
  
  consolidationTimeout = setInterval(() => {
    if (isRecording) {
      // Finaliza todas as frases em buffer que estejam pendentes há mais tempo
      const now = Date.now();
      let hasChanges = false;
      
      Object.keys(speakerBuffer).forEach(speaker => {
        const buffer = speakerBuffer[speaker];
        
        // Se há texto em buffer e está pendente há mais do SENTENCE_BUFFER_TIME
        if (buffer.currentText && (now - buffer.lastUpdateTime > SENTENCE_BUFFER_TIME)) {
          finalizeSpeakerSentence(speaker);
          hasChanges = true;
        }
      });
      
      // Executa consolidação global de duplicatas e ordenação
      if (hasChanges || transcript.length > 1) {
        globalTranscriptConsolidation();
      }
    }
  }, CONSOLIDATION_INTERVAL);
}

// Escaneamento completo para legendas - para diagnóstico
function scanForCaptions() {
  console.log("[Sonara] Escaneando para legendas...");
  
  const captionSelectors = [
    '.iTTPOb', // Seletor clássico
    '.VbkSUe', // Outro possível seletor
    '[jsname="dsyhDe"]', // Container de legendas
    '.CNusmb', // Outro potencial seletor
    '[data-message-text]'
  ];
  
  let results = {};
  
  captionSelectors.forEach(selector => {
    const elements = document.querySelectorAll(selector);
    results[selector] = {
      count: elements.length,
      texts: Array.from(elements).slice(0, 3).map(el => el.textContent.trim())
    };
    
    if (elements.length > 0) {
      console.log(`[Sonara] Encontrado ${elements.length} elementos com seletor ${selector}`, 
                  results[selector].texts);
    }
  });
  
  // Busca qualquer elemento que possa conter legenda
  const potentialCaptions = [];
  const allDivs = document.querySelectorAll('div');
  
  allDivs.forEach(div => {
    if (div.textContent && 
        div.textContent.trim().length > 5 && 
        div.textContent.trim().length < 200 &&
        div.children.length < 3) {
      
      potentialCaptions.push({
        text: div.textContent.trim(),
        classes: div.className,
        id: div.id
      });
    }
  });
  
  results.potentialTexts = potentialCaptions.slice(0, 5);
  
  return results;
}

// Verifica se a UI de legendas do Meet foi carregada
function checkForCaptions(mutations) {
  for (const mutation of mutations) {
    if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          // Tenta encontrar elementos de legenda
          const captionElement = node.querySelector('.iTTPOb, .VbkSUe, [data-message-text]');
          
          if (captionElement) {
            console.log("[Sonara] Elemento de legenda detectado:", captionElement.textContent);
            setupCaptionObserver();
            return;
          }
          
          // Ou verifica se o próprio nó é um elemento de legenda
          if (node.classList && 
              (node.classList.contains('iTTPOb') || 
               node.classList.contains('VbkSUe') ||
               node.hasAttribute('data-message-text'))) {
            console.log("[Sonara] Nó de legenda detectado:", node.textContent);
            setupCaptionObserver();
            return;
          }
        }
      }
    }
  }
}

// Configura o observer para as legendas
function setupCaptionObserver() {
  console.log("[Sonara] Configurando observer de legendas");
  
  // Se já temos um observer ativo, não precisamos configurar outro
  if (subtitleObserver) return;
  
  // Primeiro, vamos encontrar o container de legendas
  const subtitleContainer = findCaptionContainer();
  
  if (!subtitleContainer) {
    console.log("[Sonara] Não foi possível encontrar o container de legendas");
    return;
  }
  
  // Cria um observer para monitorar mudanças nas legendas
  subtitleObserver = new MutationObserver(processCaptionMutations);
  subtitleObserver.observe(subtitleContainer, { 
    childList: true, 
    subtree: true,
    characterData: true
  });
  
  console.log("[Sonara] Observer de legendas configurado no elemento:", subtitleContainer);
}

// Encontra o container de legendas
function findCaptionContainer() {
  // Tenta vários seletores possíveis
  const selectors = [
    'div[jsname="dsyhDe"]',
    'div[jscontroller="TEjq6e"]',
    'div.a4cQT',
    'div.pHsCke', 
    'div.ULZf3', 
    'div.EP9dJe',
    // Função para encontrar o container das legendas
    () => {
      const caption = document.querySelector('.iTTPOb, .VbkSUe, [data-message-text]');
      return caption ? caption.parentNode.parentNode : null;
    }
  ];
  
  for (const selector of selectors) {
    if (typeof selector === 'function') {
      const result = selector();
      if (result) {
        console.log("[Sonara] Container de legendas encontrado via função");
        return result;
      }
    } else {
      const container = document.querySelector(selector);
      if (container) {
        console.log("[Sonara] Container de legendas encontrado via seletor:", selector);
        return container;
      }
    }
  }
  
  // Último recurso: observar todo o corpo da página
  console.log("[Sonara] Nenhum container específico encontrado, usando body");
  return document.body;
}

// Processa mutações para extrair legendas
function processCaptionMutations(mutations) {
  if (!isRecording) return;
  
  for (const mutation of mutations) {
    // Procura por elementos de legenda adicionados
    if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const isCaptionElement = 
            node.classList?.contains('iTTPOb') || 
            node.classList?.contains('VbkSUe') ||
            node.hasAttribute('data-message-text');
          
          // Verifica se é um nó de legenda ou contém legendas
          if (isCaptionElement && node.textContent) {
            processCaptionText(node);
          } else {
            // Verifica se contém elementos de legenda
            const captionElements = node.querySelectorAll('.iTTPOb, .VbkSUe, [data-message-text]');
            captionElements.forEach(captionElement => {
              if (captionElement.textContent) {
                processCaptionText(captionElement);
              }
            });
          }
        }
      }
    }
    
    // Também verificamos mudanças no texto de elementos existentes
    if (mutation.type === 'characterData' && mutation.target.textContent) {
      const parentElement = mutation.target.parentNode;
      
      if (parentElement && 
          (parentElement.classList?.contains('iTTPOb') || 
           parentElement.classList?.contains('VbkSUe') ||
           parentElement.hasAttribute('data-message-text'))) {
        processCaptionText(parentElement);
      }
    }
  }
}

// Processa o texto da legenda e o falante
function processCaptionText(captionElement) {
  // O texto da legenda é o conteúdo do elemento
  const captionText = captionElement.textContent.trim();
  if (!captionText) return;
  
  // Tentamos encontrar o nome do falante (subindo níveis no DOM)
  let speakerName = "Unknown Speaker";
  let currentNode = captionElement;
  
  // Sobe até 5 níveis no DOM buscando por um elemento com o nome do falante
  for (let i = 0; i < 5 && currentNode; i++) {
    currentNode = currentNode.parentNode;
    
    // Procura pelo elemento do nome do falante
    const speakerElement = currentNode?.querySelector('.zs7s8d, .jxFHg, .ZjFb7c');
    
    if (speakerElement && speakerElement.textContent) {
      speakerName = speakerElement.textContent.trim();
      break;
    }
  }
  
  // Se o nome for "Você" ou "You", substitui
  if (speakerName === "Você" || speakerName === "You") {
    speakerName = "You (Me)";
  }
  
  // Verifica se recebemos um novo fragmento de texto
  handleNewTextFragment(speakerName, captionText);
}

// Processa um novo fragmento de texto
function handleNewTextFragment(speaker, text) {
  // Se ainda não temos um buffer para este falante, inicializa
  if (!speakerBuffer[speaker]) {
    speakerBuffer[speaker] = {
      currentText: "",
      lastUpdateTime: Date.now(),
      pendingTimeout: null,
      recentSentences: [] // Para detecção de duplicatas recentes
    };
  }
  
  const buffer = speakerBuffer[speaker];
  
  // Verifica se este texto é parte de uma frase em andamento
  if (buffer.currentText && (
      text.includes(buffer.currentText) || // Texto atual é expansão do anterior
      isIncrementalUpdate(buffer.currentText, text) || // Expansão com pequenas diferenças
      buffer.currentText.includes(text) // Texto atual já contém este fragmento
     )) {
    
    // Se o novo texto é mais longo, atualiza o buffer
    if (text.length > buffer.currentText.length) {
      buffer.currentText = text;
      buffer.lastUpdateTime = Date.now();
      
      // Reseta o timeout para dar mais tempo antes de finalizar
      if (buffer.pendingTimeout) {
        clearTimeout(buffer.pendingTimeout);
      }
      
      buffer.pendingTimeout = setTimeout(() => {
        finalizeSpeakerSentence(speaker);
      }, SENTENCE_BUFFER_TIME);
      
      return;
    }
    // Se o novo texto é menor, só atualizamos o timestamp
    else {
      buffer.lastUpdateTime = Date.now();
      return;
    }
  }
  
  // Verifica se é uma duplicata de alguma frase recente
  if (isDuplicateOfRecent(speaker, text)) {
    console.log("[Sonara] Texto ignorado por ser duplicata recente:", text);
    return;
  }
  
  // Se chegamos aqui, é um novo texto significativo
  
  // Verifica se já temos texto em buffer que precisa ser finalizado
  if (buffer.currentText) {
    // Se o texto atual parece ser continuação baseado em conteúdo
    if (seemsToBeContinuation(buffer.currentText, text)) {
      // Concatena e continua no buffer
      buffer.currentText = `${buffer.currentText} ${text}`;
      buffer.lastUpdateTime = Date.now();
      
      // Reseta o timeout
      if (buffer.pendingTimeout) {
        clearTimeout(buffer.pendingTimeout);
      }
      
      buffer.pendingTimeout = setTimeout(() => {
        finalizeSpeakerSentence(speaker);
      }, SENTENCE_BUFFER_TIME);
      
      return;
    }
    
    // Se não é continuação, finaliza o texto atual
    finalizeSpeakerSentence(speaker);
  }
  
  // Inicia um novo buffer com este texto
  buffer.currentText = text;
  buffer.lastUpdateTime = Date.now();
  
  // Configura timeout para esta nova frase
  if (buffer.pendingTimeout) {
    clearTimeout(buffer.pendingTimeout);
  }
  
  buffer.pendingTimeout = setTimeout(() => {
    finalizeSpeakerSentence(speaker);
  }, SENTENCE_BUFFER_TIME);
}

// Verifica se um novo texto é uma atualização incremental do anterior
function isIncrementalUpdate(oldText, newText) {
  // Normaliza os textos
  const normalizeText = (text) => text.toLowerCase().trim();
  const oldNorm = normalizeText(oldText);
  const newNorm = normalizeText(newText);
  
  // Verifica contenção parcial
  if (newNorm.includes(oldNorm.substring(0, Math.min(oldNorm.length, 20)))) {
    return true;
  }
  
  // Verifica se tem pelo menos 70% das palavras em comum
  const oldWords = oldNorm.split(/\s+/);
  const newWords = newNorm.split(/\s+/);
  
  let commonWords = 0;
  for (const word of oldWords) {
    if (newWords.includes(word)) {
      commonWords++;
    }
  }
  
  const similarityRatio = commonWords / oldWords.length;
  return similarityRatio > 0.7;
}

// Verifica se o texto parece ser continuação de outro
function seemsToBeContinuation(prevText, newText) {
  // Verifica se o novo texto começa com minúscula (indicando continuação)
  if (newText.length > 0 && newText[0] === newText[0].toLowerCase() && 
      newText[0] !== newText[0].toUpperCase()) {
    return true;
  }
  
  // Verifica se o texto anterior termina sem pontuação final
  if (!/[.!?;:]$/.test(prevText.trim())) {
    return true;
  }
  
  // Verifica se são frases curtas que podem ser conectadas
  const wordCount = newText.split(/\s+/).length;
  if (wordCount < 4) {
    return true;
  }
  
  return false;
}

// Verifica se um texto é duplicata de algo já dito recentemente
function isDuplicateOfRecent(speaker, text) {
  if (!speakerBuffer[speaker] || !speakerBuffer[speaker].recentSentences) {
    return false;
  }
  
  const recentSentences = speakerBuffer[speaker].recentSentences;
  const normalizedText = text.toLowerCase().trim();
  
  // Para cada sentença recente, verifica se é muito similar
  for (const recent of recentSentences) {
    const recentNorm = recent.toLowerCase().trim();
    
    // Contenção direta
    if (recentNorm.includes(normalizedText) || normalizedText.includes(recentNorm)) {
      return true;
    }
    
    // Similaridade por palavras
    const recentWords = recentNorm.split(/\s+/);
    const newWords = normalizedText.split(/\s+/);
    
    if (newWords.length < MIN_WORDS_FOR_NEW_SENTENCE) {
      continue; // Ignora trechos muito curtos
    }
    
    // Conta palavras comuns
    let commonWords = 0;
    for (const word of newWords) {
      if (recentWords.includes(word)) {
        commonWords++;
      }
    }
    
    const similarityRatio = commonWords / Math.max(newWords.length, 1);
    if (similarityRatio > 0.8) { // 80% de palavras em comum
      return true;
    }
  }
  
  return false;
}

// Finaliza uma frase pendente de um falante
function finalizeSpeakerSentence(speaker) {
  if (!speakerBuffer[speaker] || !speakerBuffer[speaker].currentText) {
    return;
  }
  
  const buffer = speakerBuffer[speaker];
  
  // Texto final a ser adicionado
  const finalText = buffer.currentText;
  
  // Limpa o timeout pendente
  if (buffer.pendingTimeout) {
    clearTimeout(buffer.pendingTimeout);
    buffer.pendingTimeout = null;
  }
  
  // Adiciona este texto ao histórico de sentenças recentes
  buffer.recentSentences.push(finalText);
  // Mantém apenas as 5 mais recentes para evitar consumo de memória
  if (buffer.recentSentences.length > 5) {
    buffer.recentSentences.shift();
  }
  
  // Limpa o buffer
  buffer.currentText = "";
  
  // Adiciona a frase à transcrição
  addToTranscript(speaker, finalText);
}

// Adiciona uma entrada à transcrição
function addToTranscript(speaker, text) {
  // Verifica se o texto é significativo (não é muito curto)
  if (text.split(/\s+/).length < MIN_WORDS_FOR_NEW_SENTENCE) {
    console.log("[Sonara] Ignorando texto muito curto:", text);
    return;
  }
  
  // Verifica se não é uma duplicata exata do que já temos
  for (let i = Math.max(0, transcript.length - 10); i < transcript.length; i++) {
    const entry = transcript[i];
    if (entry.speaker === speaker && entry.text === text) {
      console.log("[Sonara] Texto ignorado por ser duplicata exata:", text);
      return;
    }
  }
  
  console.log(`[Sonara] Adicionando entrada: ${speaker}: ${text}`);
  
  // Cria a entrada com timestamp
  const timestamp = new Date();
  
  transcript.push({
    speaker: speaker,
    text: text,
    timestamp: timestamp.toISOString(),
    updatedAt: timestamp.toISOString(),
    timestampMs: timestamp.getTime() // Para ordenação precisa
  });
  
  // Salva o estado
  saveTranscriptState();
  
  // Notifica o popup (com throttling)
  throttledNotifyTranscriptUpdate();
}

// Throttle para notificações (evita bombardear o popup)
function throttledNotifyTranscriptUpdate() {
  const now = Date.now();
  if (now - lastNotificationTime > NOTIFICATION_THROTTLE) {
    chrome.runtime.sendMessage({
      action: "transcriptUpdated",
      transcript: transcript
    });
    lastNotificationTime = now;
  }
}

// Consolidação global da transcrição
function globalTranscriptConsolidation() {
  if (transcript.length <= 1) return;
  
  console.log("[Sonara] Executando consolidação global da transcrição");
  
  // 1. Ordenação cronológica precisa
  transcript.sort((a, b) => {
    // Timestamps em milissegundos para ordenação precisa
    const aTime = a.timestampMs || new Date(a.timestamp).getTime();
    const bTime = b.timestampMs || new Date(b.timestamp).getTime();
    return aTime - bTime;
  });
  
  // 2. Remoção avançada de duplicatas
  let i = 0;
  while (i < transcript.length - 1) {
    const current = transcript[i];
    const next = transcript[i + 1];
    
    // Mesmos falantes com textos muito similares
    if (current.speaker === next.speaker && 
        (isHighlySimilar(current.text, next.text) || 
         isShorterVersion(current.text, next.text))) {
      
      // Mantém a versão mais longa/completa
      if (next.text.length > current.text.length) {
        transcript.splice(i, 1); // Remove o atual
      } else {
        transcript.splice(i + 1, 1); // Remove o próximo
      }
      // Não incrementa i aqui porque precisamos verificar o novo elemento na posição atual
    } 
    // Falantes diferentes, mas textos quase idênticos (pode ser erro de atribuição)
    else if (current.speaker !== next.speaker && 
             isVeryHighlySimilar(current.text, next.text)) {
      
      // Se os timestamps estão muito próximos (< 1 segundo)
      const timeDiff = Math.abs(
        (next.timestampMs || new Date(next.timestamp).getTime()) -
        (current.timestampMs || new Date(current.timestamp).getTime())
      );
      
      if (timeDiff < 1000) {
        // Provável erro de atribuição - remover um dos dois
        // Escolhemos manter o mais longo
        if (next.text.length > current.text.length) {
          transcript.splice(i, 1); // Remove o atual
        } else {
          transcript.splice(i + 1, 1); // Remove o próximo
        }
        // Não incrementa i
      } else {
        i++; // Parece ser uma repetição legítima, avança
      }
    }
    else {
      i++; // Nenhum problema detectado, avança
    }
  }
  
  // 3. Limpeza final - remove textos muito curtos ou vazios
  for (i = transcript.length - 1; i >= 0; i--) {
    if (!transcript[i].text || 
        transcript[i].text.trim() === "" ||
        transcript[i].text.split(/\s+/).length < MIN_WORDS_FOR_NEW_SENTENCE) {
      transcript.splice(i, 1);
    }
  }
  
  // Salva o estado e notifica
  saveTranscriptState();
  
  // Notifica o popup sobre a atualização consolidada
  chrome.runtime.sendMessage({
    action: "transcriptUpdated",
    transcript: transcript
  });
}

// Verifica se um texto é uma versão altamente similar do outro
function isHighlySimilar(text1, text2) {
  // Normaliza os textos
  const normalize = (t) => t.toLowerCase().trim().replace(/[^\w\s]/g, '');
  const t1 = normalize(text1);
  const t2 = normalize(text2);
  
  // Contenção direta
  if (t1.includes(t2) || t2.includes(t1)) {
    return true;
  }
  
  // Similaridade por palavras
  const words1 = t1.split(/\s+/).filter(w => w.length > 2);
  const words2 = t2.split(/\s+/).filter(w => w.length > 2);
  
  if (words1.length === 0 || words2.length === 0) {
    return false;
  }
  
  // Conta palavras comuns
  let commonWords = 0;
  for (const word of words1) {
    if (words2.includes(word)) {
      commonWords++;
    }
  }
  
  const similarityRatio = commonWords / Math.max(words1.length, words2.length);
  return similarityRatio > 0.7; // 70% de similaridade
}

// Verifica se um texto é uma versão muito altamente similar do outro (quase idêntico)
function isVeryHighlySimilar(text1, text2) {
  // Normaliza os textos
  const normalize = (t) => t.toLowerCase().trim().replace(/[^\w\s]/g, '');
  const t1 = normalize(text1);
  const t2 = normalize(text2);
  
  // Contenção quase completa
  if (t1.includes(t2) || t2.includes(t1)) {
    const longerText = t1.length > t2.length ? t1 : t2;
    const shorterText = t1.length > t2.length ? t2 : t1;
    
    // Se o texto maior contém 90% ou mais do menor
    return (shorterText.length / longerText.length) > 0.9;
  }
  
  // Similaridade por palavras
  const words1 = t1.split(/\s+/).filter(w => w.length > 2);
  const words2 = t2.split(/\s+/).filter(w => w.length > 2);
  
  if (words1.length === 0 || words2.length === 0) {
    return false;
  }
  
  // Conta palavras comuns
  let commonWords = 0;
  for (const word of words1) {
    if (words2.includes(word)) {
      commonWords++;
    }
  }
  
  const similarityRatio = commonWords / Math.max(words1.length, words2.length);
  return similarityRatio > 0.9; // 90% de similaridade - muito alto
}

// Verifica se um texto é uma versão menor/menos completa de outro
function isShorterVersion(text1, text2) {
  // Se um é significativamente mais curto
  if (text1.length < text2.length * 0.8) {
    // E o maior contém quase todo o menor
    return text2.toLowerCase().includes(text1.toLowerCase());
  }
  
  if (text2.length < text1.length * 0.8) {
    // E o maior contém quase todo o menor
    return text1.toLowerCase().includes(text2.toLowerCase());
  }
  
  return false;
}

// Inicia a gravação da transcrição
function startRecording() {
  if (!isRecording) {
    console.log("[Sonara] Iniciando gravação");
    isRecording = true;
    meetingStartTime = meetingStartTime || new Date().toISOString();
    
    // Reinicia buffers
    speakerBuffer = {};
    
    // Garante que temos um observer de legendas configurado
    if (!subtitleObserver) {
      setupCaptionObserver();
    }
    
    // Inicia/reinicia o intervalo de consolidação
    startConsolidationInterval();
    
    // Salva o estado
    saveTranscriptState();
    
    // Notifica o popup
    chrome.runtime.sendMessage({
      action: "recordingStatusChanged",
      isRecording: true
    });
  }
}

// Para a gravação da transcrição
function stopRecording() {
  if (isRecording) {
    console.log("[Sonara] Parando gravação");
    isRecording = false;
    
    // Finaliza qualquer texto pendente em buffers
    Object.keys(speakerBuffer).forEach(speaker => {
      if (speakerBuffer[speaker].currentText) {
        finalizeSpeakerSentence(speaker);
      }
    });
    
    // Executa uma consolidação final
    globalTranscriptConsolidation();
    
    // Limpa intervalos
    if (consolidationTimeout) {
      clearInterval(consolidationTimeout);
      consolidationTimeout = null;
    }
    
    // Salva o estado
    saveTranscriptState();
    
    // Notifica o popup
    chrome.runtime.sendMessage({
      action: "recordingStatusChanged",
      isRecording: false
    });
    
    // Envia uma cópia limpa da transcrição
    chrome.runtime.sendMessage({
      action: "transcriptUpdated",
      transcript: transcript
    });
  }
}

// Limpa a transcrição atual
function clearTranscript() {
  console.log("[Sonara] Limpando transcrição");
  transcript = [];
  speakerBuffer = {};
  
  // Limpa timeout de consolidação
  if (consolidationTimeout) {
    clearInterval(consolidationTimeout);
  }
  
  // Reinicia intervalo
  startConsolidationInterval();
  
  // Salva o estado
  saveTranscriptState();
  
  // Notifica o popup
  chrome.runtime.sendMessage({
    action: "transcriptCleared"
  });
}

// Salva o estado atual da transcrição no storage local
function saveTranscriptState() {
  chrome.storage.local.set({
    isRecording: isRecording,
    transcript: transcript,
    meetingId: meetingId,
    meetingStartTime: meetingStartTime
  });
}