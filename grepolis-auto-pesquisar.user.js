// ==UserScript==
// @name         4 DEVICE AUTO-PESQUISAR (Integrado à Central)
// @version      2.3
// @description  Automatiza pesquisas na Academia utilizando a fila, o humanizador e as proteções da DeviceCentral.
// @author       Device
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

        const uw = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
        const isConquest = uw.Game && uw.Game.conquest_type === 'conquest'; 
        return isConquest ? DEFAULT_CONQUEST_RESEARCH : DEFAULT_REVOLT_RESEARCH;
    }

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

    // Centraliza a verificação de bloqueios consultando o DeviceCentral
    function isBlocked() {
        const uw = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
        if (uw.DeviceCentral && typeof uw.DeviceCentral.isBlocked === 'function') {
            return uw.DeviceCentral.isBlocked();
        }
        const captchaContainer = document.getElementById('hcaptcha-container');
        const botCheckModal = document.querySelector('.bot_check, .bot_check_window, iframe[src*="hcaptcha"]');
        const gameBotCheck = uw.BotCheck && typeof uw.BotCheck.isBotCheckActive === 'function' ? uw.BotCheck.isBotCheckActive() : false;
        return !!(captchaContainer || botCheckModal || gameBotCheck);
    }

    // Executa a lógica principal de envio de requisição de pesquisa à API do jogo
    async function tryAutoResearch() {
        const uw = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

        if (!uw.ITowns || !uw.ITowns.getCurrentTown) return;
        
        if (!uw.DeviceCentral) {
            console.warn(`[${MODULE_NAME}] DeviceCentral ainda não carregada. Adiando ciclo...`);
            return;
        }

        // Verifica se a conta está bloqueada por CAPTCHA
        if (isBlocked()) {
            if (typeof uw.DeviceCentral.sendDiscordAlert === 'function') {
                uw.DeviceCentral.sendDiscordAlert("CAPTCHA detectado! Ciclo de auto-pesquisa pausado.");
            }
            return;
        }

        // Se o Auto-Farm de prioridade máxima estiver rodando, a pesquisa aguarda
        if (uw.DeviceCentral.isFarmActive) {
            return;
        }

        const currentTown = uw.ITowns.getCurrentTown();
        if (!currentTown) return;

        const townId = currentTown.getId();
        
        const buildingCounts = currentTown.getBuildings();
        const academyLevel = buildingCounts && buildingCounts.academy ? buildingCounts.academy : 0;
        if (academyLevel < 1) return;

        const researchOrders = currentTown.getResearchOrders ? currentTown.getResearchOrders() : [];
        if (researchOrders && researchOrders.length > 0) {
            return; 
        }

        const maxOrders = (uw.Game && uw.Game.premium_features && uw.Game.premium_features.curator) ? 5 : 1;
        if (researchOrders.length >= maxOrders) return;

        const researchedTechs = currentTown.getResearches ? currentTown.getResearches() : {};
        const availablePoints = currentTown.getAvailableResearchPoints ? currentTown.getAvailableResearchPoints() : 0;
        const currentWood = currentTown.wood || 0;
        const currentStone = currentTown.stone || 0;
        const currentIron = currentTown.iron || 0;

        const queue = getResearchQueue();
        
        for (const techId of queue) {
            if (researchedTechs[techId]) continue;

            const techConfig = uw.GameData && uw.GameData.researches ? uw.GameData.researches[techId] : null;
            if (!techConfig) continue;

            const pointsNeeded = techConfig.research_points || 0;
            const cost = techConfig.resources || {};
            const woodNeeded = cost.wood || 0;
            const stoneNeeded = cost.stone || 0;
            const ironNeeded = cost.iron || 0;

            if (availablePoints >= pointsNeeded &&
                currentWood >= woodNeeded &&
                currentStone >= stoneNeeded &&
                currentIron >= ironNeeded) {
                
                console.log(`[${MODULE_NAME}] Solicitando pesquisa da tecnologia: ${techId} na cidade ${townId}`);

                let success = false;
                try {
                    // Envolve a requisição Ajax na fila segura controlada pelo Humanizer
                    if (uw.DeviceCentral && typeof uw.DeviceCentral.requestQueue === 'function') {
                        success = await uw.DeviceCentral.requestQueue(MODULE_NAME, async () => {
                            return new Promise((resolve) => {
                                uw.gpAjax.ajaxPost('frontend_bridge', 'execute', {
                                    model_url: `ResearchOrder`,
                                    action_name: 'research',
                                    arguments: {
                                        town_id: townId,
                                        research_type: techId
                                    }
                                }, 0, {
                                    success: () => {
                                        console.log(`%c[${MODULE_NAME}] 🧪 Pesquisa [${techId}] aceita com sucesso pelo servidor!`, 'color: #8bc34a; font-weight: bold;');
                                        resolve(true);
                                    },
                                    error: (err) => {
                                        console.error(`[${MODULE_NAME}] Erro ao iniciar pesquisa [${techId}]:`, err);
                                        resolve(false);
                                    }
                                });
                            });
                        });
                    }
                } catch (e) {
                    console.error(`[${MODULE_NAME}] Erro na requisição de fila:`, e);
                }

                break; // Envia apenas uma por ciclo
            }
        }
    }

    // Função de loop contínuo gerenciada pelo timer principal
    function startAutoResearchLoop() {
        const uw = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

        setInterval(async () => {
            try {
                await tryAutoResearch();
            } catch (e) {
                console.error(`[${MODULE_NAME}] Erro no loop de execução:`, e);
            }
        }, 60000); // Executa a cada 60 segundos com segurança
    }

    setTimeout(() => {
        const uw = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
        if (!uw.Game || !uw.Game.world_id) return;

        injectStyles();
        console.log(`%c[${MODULE_NAME} v2.3] Módulo de Auto-Pesquisa totalmente integrado à Central!`, "color: #ff9800; font-weight: bold;");

        setTimeout(startAutoResearchLoop, 15000);
    }, 5000);

})();
