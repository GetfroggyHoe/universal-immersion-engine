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
            return true;
        } catch (e) {
            const errorMsg = e?.message || e?.toString() || String(e) || "Unknown error";
            const errorStack = e?.stack || "";
            console.error(`[UIE] Module failed: ${path}${initFn ? ` (${initFn})` : ""}`, {
                message: errorMsg,
                stack: errorStack,
                error: e
            });
            try { window.toastr?.error?.(`UIE module failed: ${path.split("/").pop()}`); } catch (_) {}
            if (required) throw e;
            return false;
        }
    };

    // 1. Styles
    $("<link>").attr({rel: "stylesheet", type: "text/css", href: `${baseUrl}style.css?v=${uieBuildV}`}).appendTo("head");
    $("<link>").attr({rel: "stylesheet", type: "text/css", href: `${baseUrl}src/styles/overrides.css?v=${uieBuildV}`}).appendTo("head");

    // 2. Cleanup Old Elements
    $("#uie-launcher, #uie-main-menu, .uie-window, .uie-book-overlay, .uie-phone").remove();

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
