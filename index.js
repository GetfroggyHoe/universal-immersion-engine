const EXT_ID = "universal-immersion-engine";
const basePathFallback = `scripts/extensions/third-party/${EXT_ID}`;
const baseUrl = (() => {
    try {
        const u = new URL(".", import.meta.url);
        return u.href.endsWith("/") ? u.href : `${u.href}/`;
    } catch (_) {
        const p = basePathFallback.startsWith("/") ? basePathFallback : `/${basePathFallback}`;
        return `${p}/`;
    }
})();
try {
    window.UIE_BASEURL = baseUrl;
    window.UIE_BASEPATH = baseUrl.replace(location.origin, "").replace(/\/$/, "");
} catch (_) {}

jQuery(async () => {
    try {
        if (window.UIE_DEBUG === true) console.log("[UIE] Initializing (Import Only Mode)...", { url: import.meta.url, baseUrl });
    } catch (_) {}

    try {
        window.UIE_moduleErrors = window.UIE_moduleErrors || [];
        window.UIE_moduleLoaded = window.UIE_moduleLoaded || {};
        window.UIE_debugStatus = () => {
            const s = (() => {
                try { return window.extension_settings?.["universal-immersion-engine"]; } catch (_) { return undefined; }
            })();
            const q = (sel) => {
                try { return document.querySelector(sel); } catch (_) { return null; }
            };
            const qAll = (sel) => {
                try { return Array.from(document.querySelectorAll(sel) || []); } catch (_) { return []; }
            };
            const wandCandidates = qAll("[id='wand_popup'], [id^='wand_popup'], [id*='wand_popup'], [id*='wandPopup']");
            const status = {
                baseUrl: window.UIE_BASEURL,
                build: window.UIE_BUILD,
                lastInitError: window.UIE_lastInitError || null,
                moduleErrors: Array.isArray(window.UIE_moduleErrors) ? window.UIE_moduleErrors.slice(-10) : [],
                moduleLoaded: window.UIE_moduleLoaded || {},
                settingsFlags: {
                    enabled: s && typeof s === "object" ? (s.enabled !== false) : null,
                    scanAllEnabled: s && typeof s === "object" ? (s?.generation?.scanAllEnabled !== false) : null,
                    allowSystemChecks: s && typeof s === "object" ? (s?.generation?.allowSystemChecks !== false) : null,
                    showPopups: s && typeof s === "object" ? (s?.ui?.showPopups !== false) : null,
                },
                dom: {
                    launcher: !!q("#uie-launcher"),
                    mainMenu: !!q("#uie-main-menu"),
                    settingsBlock: !!q("#uie-settings-block, .uie-settings-block"),
                    killSwitch: !!q("#uie-setting-enable"),
                    scanAll: !!q("#uie-scanall-enable"),
                    turboEnable: !!q("#uie-turbo-enable"),
                    backupNow: !!q("#uie-backup-now"),
                    wandPopup: !!q("#wand_popup"),
                    wandUieControls: !!q("#wand_popup #uie-wand-controls"),
                    wandPopupCandidates: wandCandidates.length,
                    wandPopupCandidateIds: wandCandidates.map((el) => String(el?.id || "")).filter(Boolean).slice(0, 12),
                },
                runtime: {
                    autoScanBound: window.UIE_autoScanBound === true,
                    autoScanBoundAt: window.UIE_autoScanBoundAt || null,
                    autoScanHasEventBus: window.UIE_autoScanHasEventBus === true,
                    domAutoScanBound: window.UIE_domAutoScanBound === true,
                    domAutoScanBoundAt: window.UIE_domAutoScanBoundAt || null,
                    autoScanLastTriggerAt: window.UIE_autoScanLastTriggerAt || null,
                    autoScanLastRunAt: window.UIE_autoScanLastRunAt || null,
                    autoScanLastError: window.UIE_autoScanLastError || null,
                    lastCoreToggle: window.UIE_lastCoreToggle || null,
                    wandPopupLastSeen: window.UIE_wandPopupLastSeen || null,
                    wandPopupCandidatesLast: window.UIE_wandPopupCandidatesLast || null,
                    wandPopupDeepCandidatesLast: window.UIE_wandPopupDeepCandidatesLast || null,
                    wandControlsInjectedAt: window.UIE_wandControlsInjectedAt || null,
                    wandControlsInjectedInto: window.UIE_wandControlsInjectedInto || null,
                    promptBound: window.UIE_promptBound === true,
                    promptBoundAt: window.UIE_promptBoundAt || null,
                    promptLastUpdateAt: window.UIE_promptLastUpdateAt || null,
                    promptLastError: window.UIE_promptLastError || null,
                    rpBufferLen: Number(window.UIE_rpBufferLen || 0) || 0,
                    rpLastBufferedAt: window.UIE_rpLastBufferedAt || null,
                },
                globals: {
                    hasGetSettings: typeof window?.UIE?.getSettings === "function" || typeof window?.UIE?.get_settings === "function",
                    hasRefreshStateSaves: typeof window.UIE_refreshStateSaves === "function",
                    hasBackupNow: typeof window.UIE_backupNow === "function",
                    hasScanNow: typeof window.UIE_scanNow === "function",
                },
                settingsBucket: {
                    exists: !!s,
                    type: typeof s,
                    keys: s && typeof s === "object" ? Object.keys(s).slice(0, 30) : [],
                },
            };
            try { console.log("[UIE] debugStatus", status); } catch (_) {}
            return status;
        };
    } catch (_) {}

    const uieBuildV = Date.now();
    try { window.UIE_BUILD = uieBuildV; } catch (_) {}

    const markInitError = (stage, e) => {
        try {
            window.UIE_lastInitError = {
                stage,
                message: String(e?.message || e || "Unknown error"),
                stack: String(e?.stack || ""),
                at: Date.now(),
                baseUrl,
                url: import.meta.url
            };
        } catch (_) {}
        try { window.toastr?.error?.(`UIE init failed (${stage}). Open console for details.`); } catch (_) {}
    };

    const safeImport = async (path, initFn, required = false) => {
        try {
            const m = await import(path);
            const fn = initFn ? m?.[initFn] : null;
            if (typeof fn === "function") await fn();
            try { window.UIE_moduleLoaded = window.UIE_moduleLoaded || {}; window.UIE_moduleLoaded[path] = true; } catch (_) {}
            return true;
        } catch (e) {
            const errorMsg = e?.message || e?.toString() || String(e) || "Unknown error";
            const errorStack = e?.stack || "";
            console.error(`[UIE] Module failed: ${path}${initFn ? ` (${initFn})` : ""}`, {
                message: errorMsg,
                stack: errorStack,
                error: e
            });
            try {
                window.UIE_moduleErrors = window.UIE_moduleErrors || [];
                window.UIE_moduleErrors.push({ at: Date.now(), path, initFn, message: String(errorMsg), stack: String(errorStack) });
            } catch (_) {}
            try { window.toastr?.error?.(`UIE module failed: ${path.split("/").pop()}`); } catch (_) {}
            if (required) throw e;
            return false;
        }
    };

    // 1. Styles
    $("<link>").attr({rel: "stylesheet", type: "text/css", href: `${baseUrl}style.css?v=${uieBuildV}`}).appendTo("head");
    $("<link>").attr({rel: "stylesheet", type: "text/css", href: `${baseUrl}src/styles/overrides.css?v=${uieBuildV}`}).appendTo("head");

    // 2. Cleanup Old Elements
    $("#uie-launcher, #uie-main-menu, .uie-window, .uie-book-overlay, .uie-phone, #uie-settings-block, .uie-settings-block").remove();

    // 3. Import Core & Startup
    try {
        const Core = await import(`./src/modules/core.js?v=${uieBuildV}`);
        const sleep = (ms) => new Promise(r => setTimeout(r, Math.max(0, ms | 0)));
        const ensureSanitized = async () => {
            let lastErr = null;
            for (let i = 0; i < 150; i++) {
                try {
                    Core.sanitizeSettings();
                    return true;
                } catch (e) {
                    lastErr = e;
                    const msg = String(e?.message || e || "");
                    const looksLikeSettingsNotReady =
                        msg.includes("universal-immersion-engine") ||
                        msg.toLowerCase().includes("extension_settings") ||
                        msg.toLowerCase().includes("cannot read properties of undefined");
                    if (!looksLikeSettingsNotReady) throw e;
                    await sleep(100);
                }
            }
            throw lastErr || new Error("sanitizeSettings failed (timeout waiting for extension_settings)");
        };
        await ensureSanitized();
        try { (await import(`./src/modules/stateSubscriptions.js?v=${uieBuildV}`)).initStateSubscriptions?.(); } catch (_) {}

        const Startup = await import(`./src/modules/startup.js?v=${uieBuildV}`);
        Startup.patchToastr();
        try {
            await Startup.loadTemplates();
        } catch (e) {
            markInitError("templates", e);
            throw e;
        }

        await safeImport(`./src/modules/i18n.js?v=${uieBuildV}`, "initI18n", false);
        await safeImport(`./src/modules/backup.js?v=${uieBuildV}`, "initBackups", false);
        try {
            const ok = $("#uie-inventory-window").length > 0;
            if (!ok) {
                console.error("[UIE] Templates loaded but inventory window missing. BaseUrl likely wrong.", { baseUrl });
                window.alert?.("[UIE] Inventory template did not load. Check console for baseUrl/template errors.");
                throw new Error("Inventory template missing after loadTemplates()");
            }
        } catch (_) {}
        Startup.injectSettingsUI();

        // 4. Load Features (Modules)
        // These modules should self-initialize their event listeners
        await safeImport(`./src/modules/dragging.js?v=${uieBuildV}`, "initDragging", true);
        await safeImport(`./src/modules/interaction.js?v=${uieBuildV}`, "initInteractions", true);
        await safeImport(`./src/modules/navigation.js?v=${uieBuildV}`, "initNavigation", false);
        await safeImport(`./src/modules/prompt_injection.js?v=${uieBuildV}`, "initPromptInjection", false);
        await safeImport(`./src/modules/stateTracker.js?v=${uieBuildV}`, "initAutoScanning", false);
        await safeImport(`./src/modules/features/generation.js?v=${uieBuildV}`, "init", false);
        await safeImport(`./src/modules/inventory.js?v=${uieBuildV}`, "initInventory", true);
        await safeImport(`./src/modules/features/activities.js?v=${uieBuildV}`, "initActivities", false);
        await safeImport(`./src/modules/diary.js?v=${uieBuildV}`, "initDiary", false);
        await safeImport(`./src/modules/diagnostics.js?v=${uieBuildV}`, "initDiagnostics", false);
        await safeImport(`./src/modules/calendar.js?v=${uieBuildV}`, "initCalendar", false);
        await safeImport(`./src/modules/databank.js?v=${uieBuildV}`, "initDatabank", false);
        await safeImport(`./src/modules/journal.js?v=${uieBuildV}`, "initJournal", false);
        // Do not init War Room at startup; only init when the user explicitly opens it.
        await safeImport(`./src/modules/map.js?v=${uieBuildV}`, "initMap", false);
        await safeImport(`./src/modules/party.js?v=${uieBuildV}`, "initParty", false);
        await safeImport(`./src/modules/social.js?v=${uieBuildV}`, "initSocial", false);
        // Force reload world.js to apply UI fixes
        await safeImport(`./src/modules/world.js?v=${uieBuildV}`, "initWorld", false);
        await safeImport(`./src/modules/chatbox.js?v=${uieBuildV}`, "initChatbox", false);
        await safeImport(`./src/modules/sprites.js?v=${uieBuildV}`, "initSprites", false);
        await safeImport(`./src/modules/features/stats.js?v=${uieBuildV}`, "initStats", false);

        // Phone placeholder
        await safeImport(`./src/modules/phone.js?v=${uieBuildV}`, "initPhone", false);

        // 5. Finalize
        Core.updateLayout();
        try { $("#uie-battle-window").hide().css("display", "none"); } catch (_) {}
        console.log("[UIE] Ready.");

    } catch (e) {
        console.error("[UIE] Critical Initialization Error:", e);
        markInitError("critical", e);
    }
});
