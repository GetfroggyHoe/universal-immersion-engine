
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

// Helper to delay execution
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Safe import helper
async function safeImport(path, initFunc, required = true) {
    try {
        const module = await import(path);
        if (initFunc && typeof module[initFunc] === "function") {
            await module[initFunc]();
        }
        return module;
    } catch (e) {
        console.error(`[UIE] Failed to load ${path}:`, e);
        if (required) throw e;
    }
}

jQuery(async () => {
    // Basic error handler for initialization
    const markInitError = (type, e) => {
        try {
            if (window.toastr) window.toastr.error(`UIE Initialization Failed: ${e.message}`);
        } catch (_) {}
    };

    try {
        window.UIE_BASEURL = baseUrl;
        window.UIE_BASEPATH = baseUrl.replace(location.origin, "").replace(/\/$/, "");
        
        console.log("[UIE] Initializing...", { url: import.meta.url, baseUrl });

        // Ensure settings are sanitized before proceeding
        const ensureSanitized = async () => {
            let tries = 0;
            let lastErr = null;
            while (tries < 5) {
                try {
                    const Core = await import("./src/modules/core.js");
                    if (Core && Core.sanitizeSettings) {
                        Core.sanitizeSettings();
                        return;
                    }
                } catch (e) {
                    lastErr = e;
                    tries++;
                    await sleep(100);
                }
            }
            throw lastErr || new Error("sanitizeSettings failed");
        };

        await ensureSanitized();

        // Initialize State Subscriptions
        try { 
            const StateSubs = await import("./src/modules/stateSubscriptions.js");
            if (StateSubs && StateSubs.initStateSubscriptions) {
                StateSubs.initStateSubscriptions(); 
            }
        } catch (_) {}

        // Load Core Modules
        const Startup = await import("./src/modules/startup.js");
        const Core = await import("./src/modules/core.js");
        
        // Initialize Databank (Memory/Lore)
        await safeImport("./src/modules/databank.js", "initDatabank", false);
        
        // Load UI Templates
        await Startup.loadTemplates();
        
        // Initialize Sprites
        await safeImport("./src/modules/sprites.js", "initSprites", false);
        
        // Initialize Phone
        await safeImport("./src/modules/phone.js", "initPhone", false);

        // Final Layout Update
        Core.updateLayout();
        
        console.log("[UIE] Ready.");
        
    } catch (e) {
        console.error("[UIE] Critical Initialization Error:", e);
        markInitError("critical", e);
    }
});
