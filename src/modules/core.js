import { getContext } from "/scripts/extensions.js";

const EXT_ID = "universal-immersion-engine";

export function getSettings() {
    if (!window.extension_settings) window.extension_settings = {};
    if (!window.extension_settings[EXT_ID]) window.extension_settings[EXT_ID] = {};
    return window.extension_settings[EXT_ID];
}

export function saveSettings() {
    const context = getContext();
    if (window.saveSettingsDebounced) {
        window.saveSettingsDebounced();
    } else if (context && context.saveSettings) {
        context.saveSettings();
    }
}

export function commitStateUpdate(opts = {}) {
    saveSettings();
    if (opts.layout) updateLayout();
    if (opts.emit) {
        // Dispatch global event for state changes if needed
        const event = new CustomEvent("uie:state_updated", { detail: opts });
        window.dispatchEvent(event);
    }
}

export async function ensureChatStateLoaded() {
    // Wait for context to be available
    if (getContext()) return true;

    // Simple polling if not ready (though usually it is by the time extensions run)
    for (let i = 0; i < 20; i++) {
        if (getContext()) return true;
        await new Promise(r => setTimeout(r, 100));
    }
    return false;
}

export function sanitizeSettings() {
    const s = getSettings();

    // 1. Basic Structure
    if (!s.inventory) s.inventory = {};
    if (!Array.isArray(s.inventory.items)) s.inventory.items = [];
    if (!s.inventory.equipment) s.inventory.equipment = {};
    if (!s.inventory.vitals) s.inventory.vitals = {};

    // Vitals Defaults
    const v = s.inventory.vitals;
    if (typeof v.hp !== "number") v.hp = 100;
    if (typeof v.maxHp !== "number") v.maxHp = 100;
    if (typeof v.mp !== "number") v.mp = 50;
    if (typeof v.maxMp !== "number") v.maxMp = 50;
    if (typeof v.sp !== "number") v.sp = 50;
    if (typeof v.maxSp !== "number") v.maxSp = 50;
    if (typeof v.xp !== "number") v.xp = 0;
    if (typeof v.level !== "number") v.level = 1;
    if (!v.name) v.name = "Traveler";
    if (!v.class) v.class = "Adventurer";

    // 2. Economy
    if (!s.currencySymbol) s.currencySymbol = "G";
    if (typeof s.currencyRate !== "number") s.currencyRate = 1;

    // 3. Image/Features Toggles
    if (!s.image) s.image = {};
    if (!s.image.features) s.image.features = {};
    const f = s.image.features;
    // Default all to true if undefined
    if (f.map === undefined) f.map = true;
    if (f.doll === undefined) f.doll = true;
    if (f.social === undefined) f.social = true;
    if (f.phoneBg === undefined) f.phoneBg = true;
    if (f.msg === undefined) f.msg = true;
    if (f.party === undefined) f.party = true;
    if (f.items === undefined) f.items = true;

    // 4. Windows State
    if (!s.windows) s.windows = {};

    saveSettings();
}

export function isMobileUI() {
    return $(window).width() < 800 || navigator.maxTouchPoints > 0;
}

export function updateLayout() {
    if (isMobileUI()) return; // Skip rigid clamping on mobile to prevent crashes

    const s = getSettings();
    if (!s.windows) return;

    // Apply saved positions
    Object.keys(s.windows).forEach(id => {
        const pos = s.windows[id];
        const $el = $(`#${id}`);
        if ($el.length && pos) {
            // Simple bounds check
            let top = pos.top;
            let left = pos.left;

            // Ensure visibility (desktop only)
            const w = $(window).width();
            const h = $(window).height();

            if (left < 0) left = 0;
            if (top < 0) top = 0;
            if (left > w - 100) left = w - 100;
            if (top > h - 100) top = h - 100;

            $el.css({ top: top + "px", left: left + "px" });
        }
    });
}

// --- Event Listeners ---

// Settings Checkbox Listeners
$("body").on("change", "#uie-sw-img-map, #uie-sw-img-doll, #uie-sw-img-social, #uie-sw-img-phone-bg, #uie-sw-img-msg, #uie-sw-img-party, #uie-sw-img-items", function(e) {
    e.preventDefault();
    e.stopPropagation();
    const s = getSettings();
    if (!s.image) s.image = {};
    if (!s.image.features) s.image.features = {};
    const id = String(this.id || "");
    const on = $(this).prop("checked") === true;
    if (id === "uie-sw-img-map") s.image.features.map = on;
    if (id === "uie-sw-img-doll") s.image.features.doll = on;
    if (id === "uie-sw-img-social") s.image.features.social = on;
    if (id === "uie-sw-img-phone-bg") s.image.features.phoneBg = on;
    if (id === "uie-sw-img-msg") s.image.features.msg = on;
    if (id === "uie-sw-img-party") s.image.features.party = on;
    if (id === "uie-sw-img-items") s.image.features.items = on;
    saveSettings();
});

// Economy Save Button Listener
$("body").off("click.uieCurrencySave").on("click.uieCurrencySave", "#uie-currency-save-btn", function(e) {
    e.preventDefault();
    e.stopPropagation();
    const s = getSettings();
    const sym = String($("#uie-set-currency-sym").val() || "").trim();
    const rate = Number($("#uie-set-currency-rate").val());

    s.currencySymbol = sym || "G";
    s.currencyRate = Number.isFinite(rate) ? rate : 0;

    // Update existing currency item if present
    if (s.inventory && Array.isArray(s.inventory.items)) {
        const curItem = s.inventory.items.find(it => String(it?.type || "").toLowerCase() === "currency");
        if (curItem) {
            curItem.symbol = s.currencySymbol;
            if (!curItem.name || curItem.name.includes("Currency")) {
                curItem.name = `${s.currencySymbol} Currency`;
            }
        }
    }

    saveSettings();
    updateLayout(); // Refresh UI if currency is displayed
    try { window.toastr?.success?.("Economy settings saved.", "UIE"); } catch (_) {}
});
