// ==UserScript==
// @name         4 DEVICE AUTO-PESQUISAR
// @version      2.1
// @description  Planejador de pesquisas por cidade para NC (Integrado ao Humanizer)
// @author       device
// @include      http://*.grepolis.com/game/*
// @include      https://*.grepolis.com/game/*
// @exclude      view-source://*
// @grant        unsafeWindow
// @run-at       document-idle
// ==/UserScript==

(async function () {
    'use strict';

    const uw = typeof unsafeWindow === 'undefined' ? window : unsafeWindow;
    if (!uw.location.pathname.includes("game")) return;

    const MODULE_NAME = 'AutoPesquisar';

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    await sleep(3000);

    if (!uw.Game || !uw.Game.world_id) return;

    const STORAGE_KEY = uw.Game.world_id + "_RESEARCHES";
    let currentResearchIndex = 0;
    let currentAcademyWindow = null;
    let academyObserver = null;
    let usedForMultiAccounting = true;

    function getConquestMode(research) {
        try {
            const css = uw.GameDataResearches.getResearchCssClass(research);
            return css === 'take_over_old' ? 'cerco' : 'revolta';
        } catch (e) {
            return 'desconhecido';
        }
    }

    console.log(`%c[${MODULE_NAME}] Ativo e integrado à Central do Humanizador.`, 'color: #ff9800; font-weight: bold;');

    if (usedForMultiAccounting) {
        const predefinedResearches = [
            "slinger", "town_guard", "booty_bpv", "architecture", "shipwright", "building_crane", "bireme",
            "colonize_ship", getConquestMode("take_over") === "cerco" ? "democracy" : "",
            "mathematics", "cartography", "set_sail", "strong_wine", "plow", "pottery", "combat_experience"
        ].filter(Boolean);

        const allTowns = uw.ITowns && uw.ITowns.towns ? uw.ITowns.towns : {};

        $.each(allTowns, function (id, town) {
            try {
                const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
                const existingResearches = all[id] || [];

                if (existingResearches.length === 0) {
                    all[id] = [...predefinedResearches];
                    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
                }
            } catch (e) {
                console.error(`[${MODULE_NAME}] Erro ao inicializar localStorage para cidade:`, id, e);
            }
        });
    }

    $("head").append(`
        <style>
            .GAP_highlight_inactive::after {
                content: '';
                position: absolute;
                width: 100%;
                height: 100%;
                background-color: rgba(0, 255, 0, 0.5);
            }
            .GAP_highlight_active {
                border: 1px solid rgba(0, 255, 0, 1);
            }
        </style>
    `);

    if (uw.GameEvents && uw.GameEvents.game && uw.GameEvents.game.load) {
        $.Observer(uw.GameEvents.game.load).subscribe("GAP_load", attachAjaxListener);
    }

    if (uw.GameEvents && uw.GameEvents.window && uw.GameEvents.window.open) {
        $.Observer(uw.GameEvents.window.open).subscribe("GAP_window_open", (e, wnd) => {
            if (!wnd || typeof wnd.getType !== 'function' || !wnd.cid) return;
            if (wnd.getType() === "academy") {
                currentAcademyWindow = wnd;
                openAcademy(wnd);
            }
        });
    }

    if (uw.GameEvents && uw.GameEvents.town && uw.GameEvents.town.town_switch) {
        $.Observer(uw.GameEvents.town.town_switch).subscribe("GAP_town_switch", resetAcademy);
    }

    if (uw.GameEvents && uw.GameEvents.window && uw.GameEvents.window.close) {
        $.Observer(uw.GameEvents.window.close).subscribe("GAP_window_close", (e, wnd) => {
            if (wnd && typeof wnd.getType === 'function' && wnd.getType() === "academy") {
                currentAcademyWindow = null;
                if (academyObserver) {
                    academyObserver.disconnect();
                    academyObserver = null;
                }
            }
        });
    }

    // Função de execução processada pela Fila da Central do Humanizador
    async function processResearchTick() {
        try {
            const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");

            for (const [townId, researches] of Object.entries(all)) {
                if (!Array.isArray(researches) || researches.length === 0) continue;
                const index = currentResearchIndex % researches.length;
                const research = researches[index];
                await tryAutoResearch(research, parseInt(townId));
            }

            currentResearchIndex++;
        } catch (e) {
            console.error(`[${MODULE_NAME}] Erro no loop de intervalo:`, e);
        }
    }

    // Inicialização segura utilizando o DeviceCentral (Fila e Semáforo)
    function initDeviceIntegration() {
        if (uw.DeviceCentral && typeof uw.DeviceCentral.requestQueue === 'function') {
            setInterval(() => {
                // Envia a verificação de pesquisas para a fila controlada da central
                uw.DeviceCentral.requestQueue(MODULE_NAME, async () => {
                    await processResearchTick();
                });
            }, 60000); // Roda a cada 1 minuto (a fila gerencia o momento exato de disparar)
        } else {
            setTimeout(initDeviceIntegration, 2000);
        }
    }

    initDeviceIntegration();

    function attachAjaxListener() {
        $(document).ajaxComplete((e, xhr, opt) => {
            try {
                if (!opt || !opt.url) return;
                let urlParts = opt.url.split("?");
                if (!urlParts[1]) return;
                const url = new URL("https://dummy/?" + urlParts[1]);
                const action = urlParts[0].substr(5);
                if (action === "frontend_bridge/fetch" && url.searchParams.get("window_type") === "academy") {
                    const wnd = uw.WM && uw.WM.getWindowByType ? uw.WM.getWindowByType("academy")[0] : null;
                    if (wnd) {
                        currentAcademyWindow = wnd;
                        setTimeout(() => openAcademy(wnd), 100);
                    }
                }
            } catch (e) {}
        });
    }

    function getTownId() {
        return uw.Game && uw.Game.townId ? uw.Game.townId : null;
    }

    function loadResearches() {
        try {
            const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
            return all[getTownId()] || [];
        } catch (e) {
            return [];
        }
    }

    function saveResearches(researches) {
        try {
            const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
            all[getTownId()] = researches;
            localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
        } catch (e) {}
    }

    function toggleResearch(research, element, isInactive) {
        let researches = loadResearches();
        const index = researches.indexOf(research);

        if (index >= 0) {
            researches.splice(index, 1);
            removeClass(element);
        } else {
            researches.push(research);
            if (isInactive) addClassInactive(element);
            else addClassActive(element);
            tryAutoResearch(research);
        }

        saveResearches(researches);
    }

    async function tryAutoResearch(research, townOverride = null) {
        const townId = townOverride || getTownId();
        if (!townId || !uw.ITowns) return;

        const town = uw.ITowns.getTown(townId);
        if (!town || typeof town.buildings !== 'function') return;

        const buildings = town.buildings();
        if (!buildings || !buildings.attributes) return;

        const academy = buildings.attributes.academy;
        if (!academy || !research) return;

        const techs = (typeof town.researches === 'function' && town.researches())
            ? town.researches().attributes
            : {};

        const researchOrderColl = uw.MM && uw.MM.getFirstTownAgnosticCollectionByName ? uw.MM.getFirstTownAgnosticCollectionByName("ResearchOrder") : null;
        const researchesQueue = researchOrderColl && researchOrderColl.fragments && researchOrderColl.fragments[townId] ? researchOrderColl.fragments[townId].models || [] : [];
        const queueLimit = uw.GameDataPremium && uw.GameDataPremium.isAdvisorActivated && uw.GameDataPremium.isAdvisorActivated('curator') ? 7 : 2;
        const researchesQueueCount = researchesQueue.length;

        const isAlreadyQueued = researchesQueue.some(model => model && model.attributes && model.attributes.research_type === research);
        if (isAlreadyQueued) return;
        if (researchesQueueCount >= queueLimit) return;

        let cleanResearch = research;
        if (cleanResearch.endsWith("_old")) {
            cleanResearch = cleanResearch.replace("_old", "");
        }
        if (cleanResearch.endsWith("_bpv")) {
            cleanResearch = cleanResearch.replace("_bpv", "");
        }

        if (techs[cleanResearch]) {
            let researches = loadResearches();
            const index = researches.indexOf(research);
            if (index >= 0) {
                researches.splice(index, 1);
                saveResearches(researches);
                if (currentAcademyWindow && typeof currentAcademyWindow.getIdentifier === 'function') {
                    const selector = "#window_" + currentAcademyWindow.getIdentifier();
                    const researchElement = $(selector).find(`.research.${research}`)[0];
                    if (researchElement) {
                        removeClass(researchElement);
                    }
                }
            }
            return;
        }

        const reqsTech = uw.GameData && uw.GameData.researches ? uw.GameData.researches[cleanResearch] : null;

        if (!reqsTech) {
            let researches = loadResearches();
            const index = researches.indexOf(research);
            if (index >= 0) {
                researches.splice(index, 1);
                saveResearches(researches);
            }
            return;
        }

        if (reqsTech.building_dependencies && academy < reqsTech.building_dependencies.academy) {
            return;
        }

        let currentTown = uw.ITowns.getTown(townId);
        if (!currentTown || typeof currentTown.getBuildings !== 'function' || typeof currentTown.getResearches !== 'function') return;

        let availablePoints = currentTown.getBuildings().getBuildingLevel('academy') * (uw.GameDataResearches && uw.GameDataResearches.getResearchPointsPerAcademyLevel ? uw.GameDataResearches.getResearchPointsPerAcademyLevel() : 1);

        if (uw.GameData && uw.GameData.researches) {
            $.each(uw.GameData.researches, function (ind) {
                if (currentTown.getResearches().get(ind)) {
                    availablePoints -= uw.GameData.researches[ind].research_points;
                }
            });
        }

        availablePoints = Math.max(0, availablePoints);

        if (availablePoints < reqsTech.research_points) {
            return;
        }

        if (typeof currentTown.resources !== 'function') return;
        const { wood, stone, iron } = currentTown.resources();

        const margin = 5;
        if (wood < (reqsTech.resources.wood + margin) ||
            stone < (reqsTech.resources.stone + margin) ||
            iron < (reqsTech.resources.iron + margin)) {
            return;
        }

        const data = {
            model_url: "ResearchOrder",
            action_name: "research",
            captcha: null,
            arguments: { id: cleanResearch },
            town_id: townId,
            nl_init: true
        };

        if (uw.gpAjax && typeof uw.gpAjax.ajaxPost === 'function') {
            uw.gpAjax.ajaxPost("frontend_bridge", "execute", data, false, {
                success: (resp) => {
                    let researches = loadResearches();
                    const index = researches.indexOf(research);
                    if (index >= 0) {
                        researches.splice(index, 1);
                        saveResearches(researches);
                    }
                },
                error: (err) => {}
            });
        }
    }

    function openAcademy(wnd) {
        if (!wnd || typeof wnd.getIdentifier !== 'function') return;
        const selector = "#window_" + wnd.getIdentifier();
        let retries = 0;

        function tryRender() {
            const techTree = $(selector).find(".tech_tree_box");
            if (techTree.length === 0) {
                if (retries++ < 15) return setTimeout(tryRender, 200);
                return;
            }

            const saved = loadResearches();

            techTree.find("div.research").each((_, el) => {
                removeClass(el);
            });

            techTree.find("div.research").each((_, el) => {
                const $el = $(el);
                const classAttr = $el.attr("class");
                if (!classAttr) return;
                const classes = classAttr.split(/\s+/);
                if (classes.length < 3) return;
                const research = classes[2];
                const isInactive = $el.hasClass("inactive");

                $el.off("click.GAP").on("click.GAP", (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    toggleResearch(research, el, isInactive);
                });

                if (saved.includes(research)) {
                    if (isInactive) addClassInactive(el);
                    else addClassActive(el);
                }
            });

            setupAcademyObserver(selector);
        }

        tryRender();
    }

    function setupAcademyObserver(selector) {
        if (academyObserver) {
            academyObserver.disconnect();
        }

        const windowElement = $(selector)[0];
        if (!windowElement) return;

        academyObserver = new MutationObserver((mutations) => {
            let shouldReapply = false;

            mutations.forEach((mutation) => {
                if (mutation.type === 'childList') {
                    const addedNodes = Array.from(mutation.addedNodes);
                    const removedNodes = Array.from(mutation.removedNodes);

                    const techTreeChanged = [...addedNodes, ...removedNodes].some(node => {
                        if (node.nodeType === 1) {
                            return node.matches && (
                                node.matches('.tech_tree_box') ||
                                (node.querySelector && node.querySelector('.tech_tree_box')) ||
                                node.matches('.research') ||
                                (node.querySelector && node.querySelector('.research'))
                            );
                        }
                        return false;
                    });

                    if (techTreeChanged) {
                        shouldReapply = true;
                    }
                }

                if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                    const target = mutation.target;
                    if (target.matches && (
                        target.matches('.tab_research') ||
                        target.matches('.tab_research_queue') ||
                        target.classList.contains('active')
                    )) {
                        shouldReapply = true;
                    }
                }
            });

            if (shouldReapply && currentAcademyWindow) {
                setTimeout(() => {
                    if (currentAcademyWindow && typeof currentAcademyWindow.getIdentifier === 'function' && $(selector).length > 0) {
                        openAcademy(currentAcademyWindow);
                    }
                }, 150);
            }
        });

        academyObserver.observe(windowElement, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class']
        });
    }

    function resetAcademy() {
        if (currentAcademyWindow && typeof currentAcademyWindow.getIdentifier === 'function') {
            const selector = "#window_" + currentAcademyWindow.getIdentifier();
            $(selector).find(".tech_tree_box .research").each((_, el) => {
                removeClass(el);
            });
            setTimeout(() => openAcademy(currentAcademyWindow), 100);
        }
    }

    function addClassInactive(el) {
        $(el).addClass("GAP_highlight_inactive");
    }

    function addClassActive(el) {
        $(el).addClass("GAP_highlight_active");
    }

    function removeClass(el) {
        $(el).removeClass("GAP_highlight_inactive GAP_highlight_active");
    }
})();
