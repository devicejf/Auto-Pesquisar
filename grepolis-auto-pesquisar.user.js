// ==UserScript==
// @name         4 DEVICE AUTO-PESQUISAR (Integrado à Central)
// @version      2.2
// @description  Automatiza pesquisas na Academia utilizando a fila e o humanizador da DeviceCentral.
// @author       device
// @match        http://*.grepolis.com/game/*
// @match        https://*.grepolis.com/game/*
// @grant        unsafeWindow
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const MODULE_NAME = "AutoResearch";

    // Mapeamento padrão de pesquisas caso o usuário não tenha configurado no localStorage
    const DEFAULT_CONQUEST_RESEARCH = [
        'slinger', 'town_guard', 'architecture', 'bireme', 'mathematics',
        'pioneer', 'meteorology', 'crane', 'conquest', 'trireme',
        'colony_ship', 'demolition_expert', 'cryptography', 'phalanx', 'ram',
        'cartography', 'astrology', 'pottery', 'watchtower', 'instructors', 'plow'
    ];

    const DEFAULT_REVOLT_RESEARCH = [
        'slinger', 'town_guard', 'architecture', 'bireme', 'mathematics',
        'pioneer', 'meteorology', 'crane', 'democracy', 'trireme',
        'colony_ship', 'demolition_expert', 'cryptography', 'phalanx', 'ram',
        'cartography', 'astrology', 'pottery', 'watchtower', 'instructors', 'plow'
    ];

    function getStorageKey() {
        const uw = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
        const player = (uw.Game && uw.Game.player_id) ? uw.Game.player_id : 'default';
        const world = (uw.Game && uw.Game.world_id) ? uw.Game.world_id : 'default';
        return `GAP_researchQueue_${world}_${player}`;
    }

    function getResearchQueue() {
        try {
            const saved = localStorage.getItem(getStorageKey());
            if (saved) return JSON.parse(saved);
        } catch (e) {
            console.error(`[${MODULE_NAME}] Erro ao ler fila do localStorage:`, e);
        }

        // Se não houver salvo, inicializa com base no tipo de mundo (Cerco/Conquest ou Revolta)
        const uw = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
        const isConquest = uw.Game && uw.Game.conquest_type === 'conquest'; 
        return isConquest ? DEFAULT_CONQUEST_RESEARCH : DEFAULT_REVOLT_RESEARCH;
    }

    // Injeta estilos CSS para destacar pesquisas ativas na interface da Academia
    function injectStyles() {
        if (document.getElementById('gap-styles')) return;
        const style = document.createElement('style');
        style.id = 'gap-styles';
        style.innerHTML = `
            .gap_highlight_active {
                box-shadow: 0 0 10px 3px #00ff00 !important;
                border: 2px solid #00ff00 !important;
            }
            .gap_highlight_inactive {
                opacity: 0.4;
            }
        `;
        document.head.appendChild(style);
    }

    // Executa a lógica principal de envio de requisição de pesquisa à API do jogo
    async function tryAutoResearch() {
        const uw = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

        // Validações básicas de ambiente e segurança da Central
        if (!uw.ITowns || !uw.ITowns.getCurrentTown) return;
        
        // Verifica se a central global existe
        if (!uw.DeviceCentral) {
            console.warn(`[${MODULE_NAME}] DeviceCentral ainda não carregada. Adiando ciclo...`);
            return;
        }

        // Se a conta estiver pausada por CAPTCHA ou Farm prioritário rodando, aborta por ora
        if (uw.DeviceCentral.isFarmActive) {
            console.log(`[${MODULE_NAME}] Farm prioritário ativo. Auto-Pesquisa aguardando...`);
            return;
        }

        const currentTown = uw.ITowns.getCurrentTown();
        if (!currentTown) return;

        const townId = currentTown.getId();
        
        // Verifica nível da academia
        const buildingCounts = currentTown.getBuildings();
        const academyLevel = buildingCounts && buildingCounts.academy ? buildingCounts.academy : 0;
        if (academyLevel < 1) return;

        // Verifica se já existe pesquisa em andamento nesta cidade
        const researchOrders = currentTown.getResearchOrders ? currentTown.getResearchOrders() : [];
        if (researchOrders && researchOrders.length > 0) {
            return; // Já tem pesquisa rodando
        }

        // Verifica limite de fila de pesquisas (Ex: Conta comum = 1, com Administrador/Curator = até 5)
        const maxOrders = (uw.Game && uw.Game.premium_features && uw.Game.premium_features.curator) ? 5 : 1;
        if (researchOrders.length >= maxOrders) return;

        const researchedTechs = currentTown.getResearches ? currentTown.getResearches() : {};
        const availablePoints = currentTown.getAvailableResearchPoints ? currentTown.getAvailableResearchPoints() : 0;
        const currentWood = currentTown.wood || 0;
        const currentStone = currentTown.stone || 0;
        const currentIron = currentTown.iron || 0;

        const queue = getResearchQueue();
        
        // Procura a próxima tecnologia viável na fila
        for (const techId of queue) {
            // Se já foi pesquisado, pula
            if (researchedTechs[techId]) continue;

            // Busca os dados da tecnologia no Model do Grepolis
            const techConfig = uw.GameData && uw.GameData.researches ? uw.GameData.researches[techId] : null;
            if (!techConfig) continue;

            // Valida requisitos de pontos e recursos
            const pointsNeeded = techConfig.research_points || 0;
            const cost = techConfig.resources || {};
            const woodNeeded = cost.wood || 0;
            const stoneNeeded = cost.stone || 0;
            const ironNeeded = cost.iron || 0;

            if (availablePoints >= pointsNeeded &&
                currentWood >= woodNeeded &&
                currentStone >= stoneNeeded &&
                currentIron >= ironNeeded) {
                
                console.log(`[${MODULE_NAME}] Iniciando pesquisa da tecnologia: ${techId} na cidade ${townId}`);

                // Dispara a requisição de pesquisa via API interna do Grepolis (`gpAjax`)
                if (uw.gpAjax && typeof uw.gpAjax.ajaxPost === 'function') {
                    uw.gpAjax.ajaxPost('frontend_bridge', 'execute', {
                        model_url: `ResearchOrder`,
                        action_name: 'research',
                        arguments: {
                            town_id: townId,
                            research_type: techId
                        }
                    }, 0, {
                        success: function () {
                            console.log(`[${MODULE_NAME}] 🧪 Pesquisa [${techId}] iniciada com sucesso!`);
                        },
                        error: function (err) {
                            console.error(`[${MODULE_NAME}] Erro ao iniciar pesquisa [${techId}]:`, err);
                        }
                    });
                }
                break; // Envia apenas uma por ciclo
            }
        }
    }

    // Função de loop que se cadastra na fila da DeviceCentral
    function scheduleAutoResearchLoop() {
        const uw = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

        if (uw.DeviceCentral && typeof uw.DeviceCentral.requestQueue === 'function') {
            uw.DeviceCentral.requestQueue(MODULE_NAME, async () => {
                await tryAutoResearch();
            }).then(() => {
                // Agenda a próxima checagem em um intervalo seguro (ex: a cada 60 a 90 segundos)
                const nextCheck = Math.floor(Math.random() * (90000 - 60000 + 1)) + 60000;
                setTimeout(scheduleAutoResearchLoop, nextCheck);
            });
        } else {
            // Se a central demorar a carregar, tenta novamente em 5 segundos
            setTimeout(scheduleAutoResearchLoop, 5000);
        }
    }

    // Inicialização do Script
    setTimeout(() => {
        const uw = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
        if (!uw.Game || !uw.Game.world_id) return;

        injectStyles();
        console.log(`%c[${MODULE_NAME} v2.2] Módulo de Auto-Pesquisa integrado à Central carregado!`, "color: #ff9800; font-weight: bold;");

        // Inicia o loop de requisições conectando-se à fila da central
        setTimeout(scheduleAutoResearchLoop, 15000);
    }, 5000);

})();
