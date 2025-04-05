// content_script_inject.js
// Este script será injetado diretamente na página do Google Meet
// para ter acesso completo ao DOM original

(function() {
    console.log("[Sonara Inject] Script injetado diretamente na página");
    
    // Estilo CSS para ocultar as legendas nativas do Google Meet
    const hideNativeCaptionsStyle = `
      /* Ocultar container de legendas principal */
      div[jscontroller="TEjq6e"],
      div[jsname="dsyhDe"],
      div.a4cQT,
      div.pHsCke,
      div.ULZf3,
      div.EP9dJe {
        visibility: hidden !important;
        height: 0 !important;
        opacity: 0 !important;
        position: absolute !important;
        overflow: hidden !important;
        pointer-events: none !important;
        max-height: 0 !important;
        padding: 0 !important;
        margin: 0 !important;
      }
      
      /* Classes específicas de texto de legenda */
      .iTTPOb, 
      .VbkSUe, 
      [data-message-text] {
        visibility: hidden !important;
        opacity: 0 !important;
      }
      
      /* Garante que o container existe para captura, mas fica invisível */
      div[jscontroller="TEjq6e"],
      div[jsname="dsyhDe"] {
        display: block !important;
        visibility: hidden !important;
        max-height: 0 !important;
        z-index: -999 !important;
      }
    `;
    
    // Função para injetar CSS que oculta as legendas
    function injectCaptionHidingCSS() {
      const style = document.createElement('style');
      style.id = 'sonara-hide-captions-style';
      style.textContent = hideNativeCaptionsStyle;
      document.head.appendChild(style);
      console.log("[Sonara Inject] CSS para ocultar legendas injetado");
    }
    
    // Função para detectar e clicar no botão de legendas
    function enableCaptionsAutomatically() {
      // Lista de possíveis seletores para o botão de legendas
      const captionButtonSelectors = [
        // Seletores baseados em aria-label
        'button[aria-label="Turn on captions"]',
        'button[aria-label="Ativar legendas"]',
        'button[aria-label="Activar subtítulos"]',
        // Seletores alternativos para botão de closed caption
        '[data-tooltip-id*="caption"]:not([aria-pressed="true"])',
        '[aria-label*="caption"]:not([aria-pressed="true"])',
        '[aria-label*="legenda"]:not([aria-pressed="true"])',
        // Botão pela posição/ícone
        '.google-material-icons:contains("closed_caption_off")',
        // Menu de três pontos, pode precisar ser aberto primeiro
        '[aria-label="More options"]',
        '[aria-label="Mais opções"]'
      ];
      
      // Tenta cada seletor até encontrar o botão
      for (const selector of captionButtonSelectors) {
        const button = document.querySelector(selector);
        if (button) {
          // Verifica se o botão não está em um menu que precisa ser aberto primeiro
          if (selector.includes("More options") || selector.includes("Mais opções")) {
            // Clica no menu de mais opções primeiro
            button.click();
            // Depois procura pelo item de menu de legendas
            setTimeout(() => {
              const menuItems = document.querySelectorAll('[role="menuitem"]');
              for (const item of menuItems) {
                if (item.textContent.toLowerCase().includes('caption') || 
                    item.textContent.toLowerCase().includes('legenda') ||
                    item.textContent.toLowerCase().includes('subtitle')) {
                  console.log("[Sonara Inject] Ativando legendas via menu:", item.textContent);
                  item.click();
                  break;
                }
              }
            }, 300);
            return true;
          }
          
          // Clica diretamente no botão de legendas
          console.log("[Sonara Inject] Botão de legendas encontrado, ativando...");
          button.click();
          
          // Aguarda um instante e verifica se há seletor de idioma
          setTimeout(() => {
            // Tenta encontrar o seletor de idioma se aparecer
            const languageSelectors = document.querySelectorAll('[role="menuitem"]');
            let foundPt = false;
            
            for (const langItem of languageSelectors) {
              // Prioriza português se disponível
              if (langItem.textContent.toLowerCase().includes('português') || 
                  langItem.textContent.toLowerCase().includes('portugues')) {
                console.log("[Sonara Inject] Selecionando idioma Português");
                langItem.click();
                foundPt = true;
                break;
              }
            }
            
            // Se não encontrou português, seleciona inglês ou o primeiro idioma
            if (!foundPt && languageSelectors.length > 0) {
              for (const langItem of languageSelectors) {
                if (langItem.textContent.toLowerCase().includes('english')) {
                  console.log("[Sonara Inject] Selecionando idioma English");
                  langItem.click();
                  break;
                }
              }
              
              // Se ainda não clicou em nada, seleciona o primeiro
              if (!foundPt && languageSelectors.length > 0) {
                console.log("[Sonara Inject] Selecionando primeiro idioma disponível");
                languageSelectors[0].click();
              }
            }
          }, 500);
          
          return true;
        }
      }
      
      console.log("[Sonara Inject] Botão de legendas não encontrado.");
      return false;
    }
    
    // Verifica periodicamente se estamos em uma reunião ativa
    function checkMeetingStatus() {
      // Verificações para determinar se a reunião está ativa
      const hasVideo = document.querySelectorAll('video').length > 0;
      const hasControls = document.querySelectorAll('.XCoPyb, .BvDXcd').length > 0;
      const hasCaptionsButton = document.querySelector('[data-tooltip-id*="caption"], [aria-label*="caption"], [aria-label*="legenda"]');
      
      // Se parece ser uma reunião ativa
      if ((hasVideo || hasControls) && hasCaptionsButton) {
        console.log("[Sonara Inject] Reunião ativa detectada, verificando legendas...");
        
        // Verifica se as legendas já estão ativadas
        const captionsActive = document.querySelector('.iTTPOb, .VbkSUe, [data-message-text]');
        
        if (!captionsActive) {
          console.log("[Sonara Inject] Legendas não estão ativas, tentando ativar...");
          enableCaptionsAutomatically();
        } else {
          console.log("[Sonara Inject] Legendas já estão ativas");
        }
      }
    }
    
    // Função principal que será executada quando a página estiver pronta
    function initialize() {
      console.log("[Sonara Inject] Inicializando script injetado");
      
      // Injeta CSS para ocultar legendas
      injectCaptionHidingCSS();
      
      // Verifica a cada 3 segundos se as legendas precisam ser ativadas
      // (até que sejam ativadas com sucesso)
      let captionsCheckInterval = setInterval(() => {
        checkMeetingStatus();
        
        // Verifica se as legendas já estão ativas para parar o intervalo
        const captionsActive = document.querySelector('.iTTPOb, .VbkSUe, [data-message-text]');
        if (captionsActive) {
          // Mantém apenas algumas verificações periódicas para garantir que continuem ativas
          clearInterval(captionsCheckInterval);
          console.log("[Sonara Inject] Legendas ativadas com sucesso!");
          
          // Configura intervalo mais longo para verificar ocasionalmente
          setInterval(checkMeetingStatus, 30000); // A cada 30 segundos
        }
      }, 3000);
      
      // Configura um observer para detectar mudanças na interface do Meet
      // que poderiam indicar entrada/saída de reuniões
      const bodyObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
            // Verifica por mudanças significativas na interface
            const significantChanges = Array.from(mutation.addedNodes).some(node => {
              if (node.nodeType !== Node.ELEMENT_NODE) return false;
              
              // Verifica se algum elemento importante foi adicionado
              return node.querySelector?.('video') || 
                    node.matches?.('.XCoPyb, .BvDXcd') ||
                    node.querySelector?.('[data-tooltip-id*="caption"]');
            });
            
            if (significantChanges) {
              console.log("[Sonara Inject] Mudança significativa na UI detectada, verificando legendas...");
              setTimeout(checkMeetingStatus, 1000);
            }
          }
        }
      });
      
      // Inicia observação do body
      bodyObserver.observe(document.body, { 
        childList: true, 
        subtree: true
      });
      
      // Verifica inicialmente após carregar
      setTimeout(checkMeetingStatus, 2000);
    }
    
    // Executa quando a página estiver pronta
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initialize);
    } else {
      initialize();
    }
  })();