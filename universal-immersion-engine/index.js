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
    console.log("[UIE] Initializing (Import Only Mode)...", { url: import.meta.url, baseUrl });

    // 1. Styles
    $("<link>").attr({rel: "stylesheet", type: "text/css", href: `${baseUrl}style.css?v=${Date.now()}`}).appendTo("head");
    
    // 2. Cleanup Old Elements
    $("#uie-launcher, #uie-main-menu, .uie-window, .uie-book-overlay, .uie-phone").remove();

    // 3. Import Core & Startup
    try {
        const Core = await import("./src/modules/core.js");
        Core.sanitizeSettings();
        
        const Startup = await import("./src/modules/startup.js");
        Startup.patchToastr();
        await Startup.loadTemplates();
        try {
            const ok = $("#uie-inventory-window").length > 0;
            if (!ok) {
                console.error("[UIE] Templates loaded but inventory window missing. BaseUrl likely wrong.", { baseUrl });
                window.alert?.("[UIE] Inventory template did not load. Check console for baseUrl/template errors.");
            }
        } catch (_) {}
        Startup.injectSettingsUI();
        
        // 4. Load Features (Modules)
        // These modules should self-initialize their event listeners
        await import("./src/modules/dragging.js").then(m => m.initDragging?.());
        await import("./src/modules/interaction.js").then(m => m.initInteractions?.());
        await import("./src/modules/inventory.js").then(m => m.initInventory?.());
        await import("./src/modules/diary.js").then(m => m.initDiary?.());
        await import("./src/modules/diagnostics.js").then(m => m.initDiagnostics?.());
        await import("./src/modules/calendar.js").then(m => m.initCalendar?.());
        await import("./src/modules/databank.js").then(m => m.initDatabank?.());
        await import("./src/modules/battle.js").then(m => m.initBattle?.());
        await import("./src/modules/map.js").then(m => m.initMap?.());
        await import("./src/modules/party.js").then(m => m.initParty?.());
        await import("./src/modules/social.js").then(m => m.initSocial?.());
        await import("./src/modules/world.js").then(m => m.initWorld?.());
        
        // Phone placeholder
        try { (await import("./src/modules/phone.js")).initPhone(); } catch(e){}

        // 5. Finalize
        Core.updateLayout();
        console.log("[UIE] Ready.");
        
    } catch (e) {
        console.error("[UIE] Critical Initialization Error:", e);
    }
});
