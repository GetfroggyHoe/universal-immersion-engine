import { getSettings, saveSettings, isMobileUI, updateLayout } from "./core.js";
import { initDragging } from "./dragging.js";
import { init as initInventory } from "./features/items.js";
import { initShop } from "./shop.js";
import { notify } from "./notifications.js";
import { addInventoryItemWithStack } from "./inventoryItems.js";

let uieMenuTabSwitchedAt = 0;

let uieBattlePopupBridgeInited = false;
let uieBattlePopupLastOpenAt = 0;
let battleModulePromise = null;

async function getBattleModule() {
    if (!battleModulePromise) {
        battleModulePromise = import("./battle.js").catch((err) => {
            battleModulePromise = null;
            throw err;
        });
    }
    return await battleModulePromise;
}

function initBattlePopupBridge() {
    if (uieBattlePopupBridgeInited) return;
    uieBattlePopupBridgeInited = true;

    window.addEventListener("uie:battle_detected", async function () {
        try {
            const s = getSettings();
            if (!s || s.enabled === false) return;

            const now = Date.now();
            if (now - uieBattlePopupLastOpenAt < 2000) return;
            uieBattlePopupLastOpenAt = now;

            const mobileNow = (() => {
                try {
                    if (isMobileUI()) return true;
                    return window.matchMedia("(max-width: 768px), (pointer: coarse)").matches;
                } catch (_) {
                    return false;
                }
            })();
            if (mobileNow) {
                try { notify("warning", "Combat detected. Open War Room from menu.", "War Room", "api"); } catch (_) {}
                return;
            }

            openWindow("#uie-battle-window");
            try {
                const battle = await getBattleModule();
                try { battle?.initBattle?.(); } catch (_) {}
                try { battle?.renderBattle?.(); } catch (_) {}
            } catch (_) {}
            try { notify("warning", "Combat detected. War Room opened.", "War Room", "api"); } catch (_) {}
        } catch (_) {}
    });

    const refreshBattleIfVisible = () => {
        try {
            const $win = $("#uie-battle-window");
            if (!$win.length || !$win.is(":visible")) return;
            getBattleModule()
                .then((battle) => {
                    try { battle?.renderBattle?.(); } catch (_) {}
                })
                .catch(() => {});
        } catch (_) {}
    };

    window.addEventListener("uie:battle_state_updated", refreshBattleIfVisible);
    window.addEventListener("uie:state_updated", refreshBattleIfVisible);
}

async function ensureSettingsWindowLoaded() {
    try {
        if (document.getElementById("uie-settings-window")) return true;
        const baseUrl = String(window.UIE_BASEURL || "/scripts/extensions/third-party/universal-immersion-engine/").trim();
        const mod = await import("./templateFetch.js");
        const fetchTemplateHtml = mod?.fetchTemplateHtml;
        if (typeof fetchTemplateHtml !== "function") return false;

        const ts = (() => {
            try {
                const v = Number(window.UIE_BUILD);
                if (Number.isFinite(v) && v > 0) return v;
            } catch (_) {}
            return Date.now();
        })();

        const urls = [
            `${baseUrl}src/templates/settings_window.html?v=${ts}`,
            `${baseUrl}templates/settings_window.html?v=${ts}`,
            `/scripts/extensions/third-party/universal-immersion-engine/src/templates/settings_window.html?v=${ts}`
        ];
        let html = "";
        for (const u of urls) {
            try { html = await fetchTemplateHtml(u); } catch (_) { html = ""; }
            if (html) break;
        }
        if (!html) return false;
        $("body").append(html);
        try { (await import("./i18n.js")).applyI18n?.(document); } catch (_) {}
        return !!document.getElementById("uie-settings-window");
    } catch (_) {
        return false;
    }
}

function initStWandUieControls() {
    try {
        if (window.UIE_wandControlsInited) return;
        window.UIE_wandControlsInited = true;
    } catch (_) {}

    const needsInject = () => {
        try {
            const menu = document.getElementById("extensionsMenu");
            if (!menu) return false;
            const container = document.getElementById("uie_wand_container");
            const btn = document.getElementById("uie_wand_button");
            if (!container || container.parentElement !== menu) return true;
            if (!btn || !container.contains(btn)) return true;
            return false;
        } catch (_) {
            return true;
        }
    };

    const inject = () => {
        const menu = document.getElementById("extensionsMenu");
        if (!menu) return;

        // Create our container if it doesn't exist
        let container = document.getElementById("uie_wand_container");
        if (!container) {
            container = document.createElement("div");
            container.id = "uie_wand_container";
            container.className = "extension_container";
            // Prepend to ensure visibility at the top
            menu.prepend(container);
        } else if (container.parentElement !== menu) {
             // Ensure it's in the menu if it moved
             menu.prepend(container);
        }

        // Create/update button and ALWAYS (re)bind handler in case a stale node already exists.
        let btn = document.getElementById("uie_wand_button");
        if (!btn) {
            btn = document.createElement("div");
            btn.id = "uie_wand_button";
            btn.className = "list-group-item flex-container flexGap5";
            btn.title = "Run UIE System Scan";
            btn.style.cursor = "pointer";
            btn.style.fontWeight = "bold";
            btn.style.display = "flex";
            btn.style.alignItems = "center";
            btn.innerHTML = `
                <div class="fa-fw fa-solid fa-radar extensionsMenuExtensionButton" style="color:#f1c40f;"></div>
                <span>UIE Scan Now</span>
            `;
            container.appendChild(btn);
        }
        btn.onclick = async (e) => {
            e.preventDefault();
            e.stopPropagation();

            try { $(menu).hide(); } catch (_) {}
            try { $("#extensionsMenuButton").removeClass("active"); } catch (_) {}

            try {
                const { scanAll } = await import("./orchestration.js");
                await scanAll?.({ force: true, source: "wand_button" });
            } catch (err) {
                console.error("Scan failed", err);
                try { window.toastr?.error?.("UIE scan failed. Check console."); } catch (_) {}
            }
        };
    };

    // Try immediately
    inject();

    // And watch for changes (in case the menu is re-rendered)
    let bodyObsT = 0;
    const obs = new MutationObserver(() => {
        if (bodyObsT) return;
        bodyObsT = setTimeout(() => {
            bodyObsT = 0;
            if (needsInject()) inject();
        }, 120);
    });
    // Keep this shallow to avoid reacting to every chat token/DOM mutation.
    obs.observe(document.body, { childList: true, subtree: false });
    
    // Also specifically watch the menu if possible
    const menu = document.getElementById("extensionsMenu");
    if (menu) {
        let menuObsT = 0;
        const menuObs = new MutationObserver(() => {
            if (menuObsT) return;
            menuObsT = setTimeout(() => {
                menuObsT = 0;
                if (needsInject()) inject();
            }, 80);
        });
        menuObs.observe(menu, { childList: true, subtree: true });
    }

    // Low-overhead fallback: only attempt when missing.
    setInterval(() => {
        try {
            if (needsInject()) inject();
        } catch (_) {}
    }, 15000);
}

// --- SCAVENGE & INTERACTION MODULE ---

export function initInteractions() {
    initScavenge();
    initSpriteInteraction();
    initLauncher();
    initMobileBackNav();

    try { initBattlePopupBridge(); } catch (_) {}

    // Settings drawer (and other delegated UI handlers) must work even if the launcher
    // is missing/hidden or the user never opens the main menu.
    try { initMenuTabs(); } catch (_) {}
    try { initMenuButtons(); } catch (_) {}
    try { initGenericHandlers(); } catch (_) {}
    try { initStWandUieControls(); } catch (_) {}
}

let uieNavInited = false;
let uieNavLock = false;
let uieNavStack = [];

function initMobileBackNav() {
    if (uieNavInited) return;
    uieNavInited = true;

    const isMobileNow = () => {
        try { return isMobileUI(); } catch (_) {}
        try { return window.matchMedia("(max-width: 768px), (pointer: coarse)").matches; } catch (_) {}
        return false;
    };

    const navPush = (tag = "uie") => {
        if (!isMobileNow()) return;
        if (uieNavLock) return;
        try {
            uieNavStack.push(String(tag || "uie"));
            history.pushState({ uie: true, tag: String(tag || "uie"), t: Date.now() }, "");
        } catch (_) {}
    };

    const navPop = () => {
        if (!isMobileNow()) return;
        if (uieNavLock) return;
        if (!uieNavStack.length) return;
        uieNavLock = true;
        try { uieNavStack.pop(); } catch (_) {}
        try { history.back(); } catch (_) {}
        setTimeout(() => { uieNavLock = false; }, 120);
    };

    const closePhoneBack = () => {
        try {
            const phone = document.getElementById("uie-phone-window");
            if (!phone) return false;
            const disp = String(getComputedStyle(phone).display || "none");
            if (disp === "none") return false;

            const stickerDrawer = document.getElementById("uie-phone-sticker-drawer");
            if (stickerDrawer && String(getComputedStyle(stickerDrawer).display || "none") !== "none") {
                try { document.getElementById("uie-phone-sticker-close")?.click(); } catch (_) {}
                return true;
            }

            const $phone = $(phone);
            const $visibleApp = $phone.find(".phone-app-window:visible").first();
            if ($visibleApp.length) {
                const $btn = $visibleApp.find(".phone-back-btn").first();
                if ($btn.length) {
                    try { $btn.trigger("click"); } catch (_) {}
                    return true;
                }
            }

            const lock = document.getElementById("uie-phone-lockscreen");
            if (lock && String(getComputedStyle(lock).display || "none") !== "none") {
                try { $(phone).hide(); } catch (_) {}
                return true;
            }

            const home = document.getElementById("uie-phone-homescreen");
            if (home && String(getComputedStyle(home).display || "none") !== "none") {
                try { $(phone).hide(); } catch (_) {}
                return true;
            }
        } catch (_) {}
        return false;
    };

    const closeTopmostOverlay = () => {
        try {
            const kitchen = document.getElementById("uie-kitchen-overlay");
            if (kitchen) {
                const kd = String(getComputedStyle(kitchen).display || "none");
                if (kd !== "none") {
                    try {
                        const btn = document.getElementById("uie-kitchen-exit");
                        if (btn) {
                            btn.click();
                            return true;
                        }
                    } catch (_) {}
                    try {
                        if (typeof window.UIE_closeKitchen === "function") {
                            window.UIE_closeKitchen();
                            return true;
                        }
                    } catch (_) {}
                    try { $(kitchen).hide(); } catch (_) { try { kitchen.style.display = "none"; } catch (_) {} }
                    return true;
                }
            }

            const ids = [
                "re-quick-modal",
                "re-vn-settings-modal",
                "re-forge-modal",
                "re-st-menu",
                "uie-create-overlay",
                "uie-launcher-options-window"
            ];
            for (const id of ids) {
                const el = document.getElementById(id);
                if (!el) continue;
                const disp = String(getComputedStyle(el).display || "none");
                if (disp === "none") continue;

                if (id === "uie-create-overlay") {
                    try {
                        const btn = document.getElementById("uie-create-overlay-exit");
                        if (btn) {
                            btn.click();
                            return true;
                        }
                    } catch (_) {}
                }

                try { $(el).hide(); } catch (_) { try { el.style.display = "none"; } catch (_) {} }
                return true;
            }

            if (closePhoneBack()) return true;

            const $mods = $(".uie-modal:visible, .uie-overlay:visible, .uie-full-modal:visible");
            if ($mods.length) {
                let best = null;
                let bestZ = -Infinity;
                $mods.each(function () {
                    const z = Number(getComputedStyle(this).zIndex) || 0;
                    if (z >= bestZ) { bestZ = z; best = this; }
                });
                if (best) {
                    try { $(best).hide(); } catch (_) {}
                    return true;
                }
            }

            const $wins = $(".uie-window:visible");
            if ($wins.length) {
                let best = null;
                let bestZ = -Infinity;
                $wins.each(function () {
                    const z = Number(getComputedStyle(this).zIndex) || 0;
                    if (z >= bestZ) { bestZ = z; best = this; }
                });
                if (best) {
                    try { $(best).hide(); } catch (_) {}
                    return true;
                }
            }
        } catch (_) {}
        return false;
    };

    try {
        window.UIE_navPush = navPush;
        window.UIE_navPop = navPop;
        window.UIE_navCloseTop = closeTopmostOverlay;
    } catch (_) {}

    try {
        window.addEventListener("popstate", () => {
            if (!isMobileNow()) return;
            if (uieNavLock) return;
            if (uieNavStack.length) {
                try { uieNavStack.pop(); } catch (_) {}
                closeTopmostOverlay();
            } else {
                closeTopmostOverlay();
            }
        });
    } catch (_) {}
}

function clampToViewportPx(left, top, w, h, pad = 8) {
    const vw = window.innerWidth || document.documentElement.clientWidth || 0;
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    const minVisible = 40;
    const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
    const maxX = Math.max(pad, vw - minVisible);
    const maxY = Math.max(pad, vh - minVisible);
    const x = clamp(left, -Math.max(0, w - minVisible), maxX);
    const y = clamp(top, -Math.max(0, h - minVisible), maxY);
    return { x, y, vw, vh };
}

function ensureVisibleOnScreen($el, pad = 8) {
    if (!$el || !$el.length) return;
    const el = $el.get(0);
    if (!el) return;
    try {
        const rect = el.getBoundingClientRect();
        const vw = window.innerWidth || document.documentElement.clientWidth || 0;
        const vh = window.innerHeight || document.documentElement.clientHeight || 0;
        const minVisible = 40;

        const badRect =
            !Number.isFinite(rect.left) ||
            !Number.isFinite(rect.top) ||
            !Number.isFinite(rect.right) ||
            !Number.isFinite(rect.bottom) ||
            rect.width <= 1 ||
            rect.height <= 1;

        if (badRect) {
            placeCenteredClamped($el);
            return;
        }

        // If it's completely (or almost completely) off-screen, snap it back.
        const fullyOff =
            rect.right < minVisible ||
            rect.bottom < minVisible ||
            rect.left > vw - minVisible ||
            rect.top > vh - minVisible;

        if (fullyOff) {
            placeCenteredClamped($el);
            return;
        }

        // If partially off-screen, clamp pixel position.
        if (rect.top < 0 || rect.left < 0 || rect.bottom > vh || rect.right > vw) {
            const w = rect.width || $el.outerWidth() || 320;
            const h = rect.height || $el.outerHeight() || 420;
            const pos = clampToViewportPx(rect.left, rect.top, w, h, pad);
            $el.css({ left: `${pos.x}px`, top: `${pos.y}px`, right: "auto", bottom: "auto", transform: "none", position: "fixed" });
        }
    } catch (_) {
        try { placeCenteredClamped($el); } catch (_) {}
    }
}

function getMenuHidden() {
    const s = getSettings();
    const hid = s?.menuHidden;
    return (hid && typeof hid === "object") ? hid : {};
}

function getMenuVisibilityMap() {
    return {
        "uie-hide-inventory": "inventory",
        "uie-hide-shop": "shop",
        "uie-hide-journal": "journal",
        "uie-hide-diary": "diary",
        "uie-hide-social": "social",
        "uie-hide-party": "party",
        "uie-hide-battle": "battle",
        "uie-hide-phone": "phone",
        "uie-hide-map": "map",
        "uie-hide-calendar": "calendar",
        "uie-hide-databank": "databank",
        "uie-hide-world": "world",
        "uie-hide-settings": "settings",
        "uie-hide-debug": "debug",
        "uie-hide-help": "help",
    };
}

function applyMenuHiddenToButtons() {
    try {
        const hid = getMenuHidden();
        const set = (btnSel, key) => {
            try {
                const $b = $(btnSel);
                if (!$b.length) return;
                const hide = hid?.[key] === true;
                $b.toggle(!hide);
            } catch (_) {}
        };

        // Main tab
        set("#uie-btn-inventory", "inventory");
        set("#uie-btn-shop", "shop");
        set("#uie-btn-journal", "journal");
        set("#uie-btn-diary", "diary");
        set("#uie-btn-social", "social");
        set("#uie-btn-party", "party");
        set("#uie-btn-stats", "stats");
        set("#uie-btn-activities", "activities");

        // Misc/Apps tab
        set("#uie-btn-open-phone", "phone");
        set("#uie-btn-open-map", "map");
        set("#uie-btn-open-world", "world");
        set("#uie-btn-open-calendar", "calendar");
        set("#uie-btn-databank", "databank");
        set("#uie-btn-battle", "battle");

        // System tab
        set("#uie-btn-open-settings", "settings");
        set("#uie-btn-debug", "debug");
        set("#uie-btn-help", "help");
    } catch (_) {}
}

function syncMenuVisibilityCheckboxes() {
    try {
        const hid = getMenuHidden();
        const map = getMenuVisibilityMap();
        for (const id of Object.keys(map)) {
            const key = map[id];
            const el = document.getElementById(id);
            if (!el) continue;
            try { $(el).prop("checked", hid?.[key] === true); } catch (_) {}
        }
    } catch (_) {}
}

function placeCenteredClamped($el) {
    if (!$el || !$el.length) return;
    const el = $el.get(0);
    if (!el) return;
    const vw = window.innerWidth || document.documentElement.clientWidth || 0;
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    const rect = el.getBoundingClientRect();
    const w = rect.width || $el.outerWidth() || Math.min(420, vw * 0.94);
    const h = rect.height || $el.outerHeight() || Math.min(520, vh * 0.88);
    const left = (vw - w) / 2;
    const top = (vh - h) / 2;
    const pos = clampToViewportPx(left, top, w, h, 8);
    $el.css({ left: `${pos.x}px`, top: `${pos.y}px`, right: "auto", bottom: "auto", transform: "none", position: "fixed" });
}

function placeMenuCenteredScaled($menu, desiredScale = 1) {
    if (!$menu || !$menu.length) return;

    try {
        const el = $menu.get(0);
        if (el && el.parentElement !== document.body) {
            document.body.appendChild(el);
        }
    } catch (_) {}

    const rawScale = Number(desiredScale);
    const userScale = Math.max(0.5, Math.min(1.5, Number.isFinite(rawScale) ? rawScale : 1));

    // Measure at natural size (no transform) to compute fit-to-viewport scale.
    // This avoids the menu being bigger than the screen on mobile.
    let w = 320;
    let h = 420;
    try {
        $menu.css({ position: "fixed", left: "0px", top: "0px", right: "auto", bottom: "auto", transform: "none", transformOrigin: "center", visibility: "hidden" });
        const rect = $menu.get(0)?.getBoundingClientRect?.();
        w = rect?.width || $menu.outerWidth() || w;
        h = rect?.height || $menu.outerHeight() || h;
    } catch (_) {}

    const vw = window.innerWidth || document.documentElement.clientWidth || 0;
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    const fitW = vw > 0 ? (vw * 0.94) / Math.max(1, w) : 1;
    const fitH = vh > 0 ? (vh * 0.88) / Math.max(1, h) : 1;
    const fitScale = Math.max(0.5, Math.min(1, fitW, fitH));
    const scale = Math.max(0.5, Math.min(1.5, userScale, fitScale));

    const pad = 10;
    const scaledW = Math.max(1, w * scale);
    const scaledH = Math.max(1, h * scale);
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const minCx = pad + scaledW / 2;
    const maxCx = (vw || 0) - pad - scaledW / 2;
    const minCy = pad + scaledH / 2;
    const maxCy = (vh || 0) - pad - scaledH / 2;

    const targetCx = (vw || 0) / 2;
    const targetCy = (vh || 0) * 0.75;
    const cx = (vw && vw > 0) ? clamp(targetCx, minCx, Math.max(minCx, maxCx)) : 0;
    const cy = (vh && vh > 0) ? clamp(targetCy, minCy, Math.max(minCy, maxCy)) : 0;

    try {
        $menu.css({
            left: vw && vw > 0 ? `${cx}px` : "50%",
            top: vh && vh > 0 ? `${cy}px` : "50%",
            right: "auto",
            bottom: "auto",
            position: "fixed",
            transformOrigin: "center",
            transform: `translate(-50%, -50%) scale(${scale})`,
            visibility: "visible"
        });
    } catch (_) {}
}

function initLauncher() {
    const btn = document.getElementById("uie-launcher");
    if (!btn) return;

    let lastToggleAt = 0;
    let longPressFired = false;
    let touchDown = null;

    const toggleMenu = (e) => {
        if (longPressFired) {
            longPressFired = false;
            return;
        }

        const now = Date.now();
        if (now - lastToggleAt < 320) return;
        lastToggleAt = now;

        try {
            e?.preventDefault?.();
            e?.stopPropagation?.();
        } catch (_) {}

        const menu = $("#uie-main-menu");
        if (!menu.length) return;

        if (menu.is(":visible")) {
            menu.hide();
            return;
        }

        menu.css({ visibility: "hidden" });
        menu.show().css("display", "flex");
        menu.css("z-index", "2147483650");

        // Apply per-button visibility
        applyMenuHiddenToButtons();

        const mobileNow = (() => {
            try {
                if (isMobileUI()) return true;
                const touch = (typeof navigator !== "undefined" && Number(navigator.maxTouchPoints || 0) > 0);
                const minDim = Math.min(Number(window.innerWidth || 0), Number(window.innerHeight || 0));
                return touch && minDim > 0 && minDim <= 700;
            } catch (_) {
                return isMobileUI();
            }
        })();

        if (mobileNow) {
            const s = getSettings();
            const raw = Number(s?.ui?.scale ?? s?.uiScale ?? 1);
            placeMenuCenteredScaled(menu, raw);
            try { updateLayout(); } catch (_) {}
            return;
        }

        const sScale = getSettings();
        const rawScale = Number(sScale?.ui?.scale ?? sScale?.uiScale ?? 1);
        const scale = Math.max(0.5, Math.min(1.5, Number.isFinite(rawScale) ? rawScale : 1));
        const useScale = scale !== 1;
        try {
            menu.css({ transformOrigin: "top left", transform: useScale ? `scale(${scale})` : "none" });
        } catch (_) {}

        const launcher = document.getElementById("uie-launcher");
        if (launcher && launcher.getBoundingClientRect().height > 0) {
            const rect = launcher.getBoundingClientRect();
            let mw = 300;
            let mh = 400;
            try {
                const r = menu.get(0)?.getBoundingClientRect?.();
                mw = r?.width || menu.outerWidth() || mw;
                mh = r?.height || menu.outerHeight() || mh;
            } catch (_) {}
            const margin = 10;
            const vw = window.innerWidth;
            const vh = window.innerHeight;

            let left = rect.right + margin;
            if (left + mw > vw - margin) left = rect.left - mw - margin;
            let top = rect.top;

            // Clamp robustly even when the menu is larger than the viewport.
            const maxLeft = vw - mw - margin;
            if (maxLeft < margin) {
                left = margin;
            } else {
                if (left < margin) left = margin;
                if (left > maxLeft) left = maxLeft;
            }

            const maxTop = vh - mh - margin;
            if (maxTop < margin) {
                top = margin;
            } else {
                if (top < margin) top = margin;
                if (top > maxTop) top = maxTop;
            }

            menu.css({
                top: top + "px",
                left: left + "px",
                bottom: "auto",
                right: "auto",
                position: "fixed",
                transformOrigin: "top left",
                transform: useScale ? `scale(${scale})` : "none",
                visibility: "visible"
            });
        } else {
             menu.css({ top: "50%", left: "50%", transformOrigin: "center", transform: `translate(-50%, -50%) scale(${scale})`, bottom: "auto", right: "auto", visibility: "visible" });
        }
    };

    const openLauncherOptions = () => {
        try {
            const w = $("#uie-launcher-options-window");
            if (!w.length) return;
            w.show().css("display", "flex");
            w.css("z-index", "2147483652");
            placeCenteredClamped(w);

            const s = getSettings();
            const name = String(s?.launcher?.name || "");
            const hidden = s?.launcher?.hidden === true;
            const src = String(s?.launcher?.src || s?.launcherIcon || "");
            $("#uie-launcher-opt-hide").prop("checked", hidden);
            $("#uie-launcher-opt-name").val(name);

            // Populate Saved Icons
            const sel = document.getElementById("uie-launcher-opt-icon");
            if (sel) {
                // Clear old custom options (keeping the hardcoded ones)
                // We identify hardcoded ones by their value not starting with data: or custom
                // Actually easier: remove options with class 'uie-custom-opt'
                $(sel).find(".uie-custom-opt").remove();

                const saved = Array.isArray(s?.launcher?.savedIcons) ? s.launcher.savedIcons : [];
                if (saved.length > 0) {
                    // Add separator
                    const sep = document.createElement("option");
                    sep.textContent = "--- Saved Icons ---";
                    sep.disabled = true;
                    sep.className = "uie-custom-opt";
                    sel.appendChild(sep);

                    saved.forEach((iconUrl, idx) => {
                        const opt = document.createElement("option");
                        opt.value = iconUrl;
                        opt.textContent = `Custom Icon ${idx + 1}`;
                        opt.className = "uie-custom-opt";
                        sel.appendChild(opt);
                    });
                }

                const has = Array.from(sel.options || []).some(o => String(o.value || "") === src);
                sel.value = has ? src : "custom";
            }

            const prev = document.getElementById("uie-launcher-opt-preview");
            if (prev && src) {
                prev.style.backgroundImage = `url("${src}")`;
                prev.style.display = "block";
            } else if (prev) {
                prev.style.backgroundImage = "";
                prev.style.display = "none";
            }
        } catch (_) {}
    };

    // Block Context Menu (Right Click) to prevent ST Menu interference
    $(btn).off("contextmenu.uieLauncher").on("contextmenu.uieLauncher", function(e) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        openLauncherOptions();
    });

    let lpT = 0;
    const clearLp = () => { if (lpT) { clearTimeout(lpT); lpT = 0; } };
    btn.addEventListener("pointerdown", (e) => {
        try {
            if (String(e.pointerType || "") !== "touch") return;
        } catch (_) { return; }
        touchDown = { x: Number(e.clientX || 0), y: Number(e.clientY || 0), t: Date.now(), moved: false };
        clearLp();
        lpT = setTimeout(() => {
            lpT = 0;
            longPressFired = true;
            openLauncherOptions();
        }, 520);
    }, { passive: true });
    btn.addEventListener("pointerup", clearLp, { passive: true });
    btn.addEventListener("pointercancel", clearLp, { passive: true });
    btn.addEventListener("pointermove", (e) => {
        clearLp();
        try {
            if (String(e.pointerType || "") !== "touch") return;
        } catch (_) { return; }
        if (!touchDown) return;
        const dx = Math.abs(Number(e.clientX || 0) - Number(touchDown.x || 0));
        const dy = Math.abs(Number(e.clientY || 0) - Number(touchDown.y || 0));
        if (dx > 10 || dy > 10) touchDown.moved = true;
    }, { passive: true });

    // Mobile reliability: toggle on pointerup for touch.
    btn.addEventListener("pointerup", (e) => {
        try {
            if (String(e.pointerType || "") !== "touch") return;
        } catch (_) { return; }
        const moved = touchDown?.moved === true;
        touchDown = null;
        if (moved) return;
        toggleMenu(e);
    }, { passive: false });

    // Desktop: click still works; on mobile this is de-duped against pointerup.
    $(btn).off("click.uieLauncher").on("click.uieLauncher", function(e) {
        toggleMenu(e);
    });

    // Menu handlers are initialized by initInteractions().
    initLauncherOptionsHandlers(openLauncherOptions);
}

function initLauncherOptionsHandlers(openLauncherOptions) {
    const syncIcon = (src) => {
        const prev = document.getElementById("uie-launcher-opt-preview");
        if (prev && src) {
            prev.style.backgroundImage = `url("${src}")`;
            prev.style.display = "block";
        } else if (prev) {
            prev.style.backgroundImage = "";
            prev.style.display = "none";
        }
    };

    $("body").off("change.uieLauncherOptHide").on("change.uieLauncherOptHide", "#uie-launcher-opt-hide", function (e) {
        e.preventDefault();
        e.stopPropagation();
        const s = getSettings();
        if (!s.launcher) s.launcher = {};
        s.launcher.hidden = $(this).prop("checked") === true;
        saveSettings();
        updateLayout();
    });

    $("body").off("input.uieLauncherOptName change.uieLauncherOptName").on("input.uieLauncherOptName change.uieLauncherOptName", "#uie-launcher-opt-name", function (e) {
        e.preventDefault();
        e.stopPropagation();
        const s = getSettings();
        if (!s.launcher) s.launcher = {};
        s.launcher.name = String($(this).val() || "");
        saveSettings();
        updateLayout();
    });

    const updateLauncherButton = (src) => {
        const btn = document.getElementById("uie-launcher");
        if (!btn) return;

        const defaultIcon = "https://user.uploads.dev/file/b3fc92e1b70f0c8f0c200b544f7a4cce.png";
        let iconUrl = (src && src.trim() !== "" && src !== "custom") ? src : defaultIcon;

        // Handle custom fallback
        if (src === "custom") {
             const s = getSettings();
             if (s?.launcher?.src && s.launcher.src !== "custom") {
                 iconUrl = s.launcher.src;
             }
        }

        // Try to update existing inner div first to preserve state/animations
        let imgDiv = btn.querySelector(".uie-launcher-img");
        if (!imgDiv) {
            btn.innerHTML = ""; // Clear fallback icons if any
            imgDiv = document.createElement("div");
            imgDiv.className = "uie-launcher-img";
            imgDiv.style.width = "100%";
            imgDiv.style.height = "100%";
            imgDiv.style.borderRadius = "12px";
            imgDiv.style.boxShadow = "0 4px 6px rgba(0,0,0,0.5)";
            imgDiv.style.backgroundPosition = "center";
            imgDiv.style.backgroundSize = "cover";
            imgDiv.style.backgroundRepeat = "no-repeat";
            btn.appendChild(imgDiv);
        }

        // Update background image safely
        imgDiv.style.backgroundImage = `url('${iconUrl}')`;
        imgDiv.style.backgroundPosition = "center";
        imgDiv.style.backgroundSize = "cover";
        imgDiv.style.backgroundRepeat = "no-repeat";

        console.log("[UIE] Launcher icon updated to:", iconUrl);
    };

    $("body").off("change.uieLauncherOptIcon").on("change.uieLauncherOptIcon", "#uie-launcher-opt-icon", function (e) {
        e.preventDefault();
        e.stopPropagation();
        const val = String($(this).val() || "");
        console.log("[UIE] Icon selection changed to:", val);

        if (val === "custom") {
            document.getElementById("uie-launcher-opt-file")?.click();
            return;
        }

        const s = getSettings();
        if (!s.launcher) s.launcher = {};
        s.launcher.src = val;
        saveSettings();

        // Update layout might move the button but we need to ensure the icon is correct
        updateLayout();

        // Sync preview and button
        syncIcon(val);
        updateLauncherButton(val);
    });

    $("body").off("change.uieLauncherOptFile").on("change.uieLauncherOptFile", "#uie-launcher-opt-file", function (e) {
        e.preventDefault();
        e.stopPropagation();
        const file = this.files && this.files[0];
        if (!file) return;
        const r = new FileReader();
        r.onload = () => {
            const src = String(r.result || "");
            if (!src) return;
            const s = getSettings();
            if (!s.launcher) s.launcher = {};
            s.launcher.src = src;
            s.launcher.lastUploadName = String(file.name || "");
            if (!Array.isArray(s.launcher.savedIcons)) s.launcher.savedIcons = [];
            if (!s.launcher.savedIcons.includes(src)) s.launcher.savedIcons.unshift(src);
            saveSettings();
            updateLayout();
            syncIcon(src);
            updateLauncherButton(src);
        };
        r.readAsDataURL(file);
        try { this.value = ""; } catch (_) {}
    });

    $("body").off("click.uieLauncherOptResetPos").on("click.uieLauncherOptResetPos", "#uie-launcher-opt-resetpos", function (e) {
        e.preventDefault();
        e.stopPropagation();
        const s = getSettings();
        s.launcherX = 20;
        s.launcherY = 120;
        saveSettings();
        updateLayout();
        try { openLauncherOptions?.(); } catch (_) {}
    });

    $("body").off("click.uieLauncherOptOpenSettings").on("click.uieLauncherOptOpenSettings", "#uie-launcher-opt-open-settings", async function (e) {
        e.preventDefault();
        e.stopPropagation();
        try {
            await ensureSettingsWindowLoaded();
            openWindow("#uie-settings-window");
        } catch (_) {}
    });
}

function openUieSettingsDrawer() {
    try {
        const block = document.getElementById("uie-settings-block");
        if (!block) return;

        // Best-effort: ensure drawer is expanded.
        const content = block.querySelector(".inline-drawer-content");
        if (content && window.getComputedStyle(content).display === "none") {
            const toggle = block.querySelector(".inline-drawer-toggle");
            if (toggle) toggle.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        }

        // Scroll settings into view.
        block.scrollIntoView?.({ block: "start", behavior: "smooth" });
    } catch (_) {}
}

function initGenericHandlers() {
    // Generic Close Button for any UIE Window
    // Added pointerup for better responsiveness
    // COMPREHENSIVE LIST OF CLOSE BUTTONS
    const selectors = [
        ".uie-close-btn", ".uie-inv-close", ".uie-window-close", ".uie-p-close",
        "#uie-world-close", "#re-forge-close",
        "#uie-party-close",
        "#cal-modal-close", "#cal-rp-modal-close", "#uie-activities-close-btn",
        "#uie-social-close", "#books-reader-close", "#uie-phone-sticker-close",
        "#uie-sprites-close", "#uie-map-card-close", ".uie-sticker-close",
        "#uie-chatbox-close", "#uie-chatbox-options-close",
        "#uie-stats-close-btn", "#uie-inv-editor-close", "#uie-fx-close",
        "#uie-create-overlay-exit",
        "#life-create-close", "#life-edit-close", "#life-template-close",
        "#uie-battle-close",
        "#uie-launcher-opt-close",
        "#life-create-cancel",
        "#uie-diary-close", "#uie-databank-close", "#uie-journal-close"
    ].join(", ");

    let lastPointerTime = 0;
    // SCOPED FIX: Use body instead of document to catch events before they hit the document-level blocker
    $("body").off("click.uieGenericClose pointerup.uieGenericClose", selectors).on("click.uieGenericClose pointerup.uieGenericClose", selectors, function(e) {
        const closeId = String(this?.id || "");
        if (closeId === "uie-create-overlay-exit") {
            e.preventDefault();
            e.stopPropagation();
            try { e.stopImmediatePropagation(); } catch (_) {}
            try {
                if (typeof window.UIE_closeCreateOverlay === "function") {
                    window.UIE_closeCreateOverlay();
                } else {
                    const ov = document.getElementById("uie-create-overlay");
                    if (ov) {
                        try { ov.style.setProperty("display", "none", "important"); } catch (_) { ov.style.display = "none"; }
                    }
                    const body = document.getElementById("uie-create-overlay-body");
                    if (body) {
                        body.style.background = "transparent";
                        body.innerHTML = "";
                    }
                }
            } catch (_) {}
            return;
        }

        if (
            closeId === "uie-create-overlay-exit" ||
            closeId === "uie-kitchen-exit" ||
            closeId === "uie-k-pick-close" ||
            $(this).is(".uie-create-close")
        ) {
            return;
        }

        // Mobile Double-Click Fix: De-dup pointerup vs click
        if (e.type === "pointerup") {
            lastPointerTime = Date.now();
        } else if (e.type === "click" && Date.now() - lastPointerTime < 300) {
            e.preventDefault();
            e.stopPropagation();
            return;
        }

        e.preventDefault();
        e.stopPropagation();
        const win = $(this).closest(".uie-window");
        if (win.length) {
            win.hide();
        } else {
            // Fallback for overlays that might not be .uie-window
            // Added .uie-book-overlay for Diary
            $(this).closest(".uie-overlay, .uie-modal, #uie-inventory-window, .uie-full-modal, .uie-book-overlay, #uie-diary-window").hide();
            // Also handle specific parents if closest fails
            if (this.id === "re-forge-close") $("#re-forge-modal").hide();
            if (this.id === "uie-map-card-close") $("#uie-map-card").hide();
        }

        try { window.UIE_navPop?.(); } catch (_) {}
    });

    $("body").off("click.uieLauncherOptClose pointerup.uieLauncherOptClose", "#uie-launcher-opt-close").on("click.uieLauncherOptClose pointerup.uieLauncherOptClose", "#uie-launcher-opt-close", function(e) {
        e.preventDefault();
        e.stopPropagation();
        $("#uie-launcher-options-window").hide();
    });
}

function openWindow(selector) {
    const win = $(selector);
    if (!win.length) return;

    // Settings window is deprecated; use Extensions Settings drawer.
    if (String(selector || "") === "#uie-settings-window" || String(win.attr("id") || "") === "uie-settings-window") {
        // no-op
    }

    // Hide other UIE windows
    $(".uie-window").hide();

    // Show this window
    win.show();

    // Dynamic Z-Index Handling: Bring to front
    const visibleWins = $(".uie-window").filter(":visible").toArray();
    const highestZ = Math.max(2147483650, ...visibleWins.map(el => Number(getComputedStyle(el).zIndex) || 0));

    win.css("z-index", highestZ + 1);

    // Ensure it's a direct child of body to avoid stacking context traps
    if (win[0].parentElement !== document.body) {
        document.body.appendChild(win[0]);
    }

    win.css("display", "flex"); // Most windows use flex

    // (settings_window removed)

    // Mobile: always center newly opened windows (prevents "stuck at top")
    const mobileNow = (() => {
        try {
            if (isMobileUI()) return true;
            const touch = (typeof navigator !== "undefined" && Number(navigator.maxTouchPoints || 0) > 0);
            const minDim = Math.min(Number(window.innerWidth || 0), Number(window.innerHeight || 0));
            return touch && minDim > 0 && minDim <= 820;
        } catch (_) {
            return isMobileUI();
        }
    })();
    if (mobileNow) {
        const winId = String(win.attr("id") || "");
        if (winId === "uie-battle-window") {
            win.css({
                left: "0px",
                top: "0px",
                right: "auto",
                bottom: "auto",
                transform: "none",
                position: "fixed",
                width: "100vw",
                height: "100vh",
                maxWidth: "100vw",
                maxHeight: "100vh",
                borderRadius: "0"
            });
        } else if (winId === "uie-party-window") {
            try {
                const rect = win[0].getBoundingClientRect();
                const vw = Number(window.innerWidth || 0);
                const vh = Number(window.innerHeight || 0);
                const isFullScreenLike =
                    (vw > 0 && rect.width >= (vw - 12)) ||
                    (vh > 0 && rect.height >= (vh - 12));

                if (isFullScreenLike) {
                    win.css({ left: "0px", top: "0px", right: "auto", bottom: "auto", transform: "none", position: "fixed" });
                } else {
                    placeCenteredClamped(win);
                }
            } catch (_) {
                placeCenteredClamped(win);
            }
        } else {
            placeCenteredClamped(win);
        }
    }

    // Desktop: ensure it's not off-screen (e.g. after dragging, resizing, scaling)
    if (!mobileNow) {
        ensureVisibleOnScreen(win, 8);
    }

    // Ensure on-screen: clamp pixel position, never force translate centering
    try {
        const rect = win[0].getBoundingClientRect();
        if (rect.top < 0 || rect.left < 0 || rect.bottom > window.innerHeight || rect.right > window.innerWidth) {
            const w = rect.width || win.outerWidth() || 320;
            const h = rect.height || win.outerHeight() || 420;
            const pos = clampToViewportPx(rect.left, rect.top, w, h, 8);
            win.css({ left: `${pos.x}px`, top: `${pos.y}px`, right: "auto", bottom: "auto", transform: "none", position: "fixed" });
        }
    } catch (_) {}

    // Close main menu
    $("#uie-main-menu").hide();

    try { window.UIE_navPush?.(`win:${String(selector || "")}`); } catch (_) {}
    try { window.UIE_refreshStateSaves?.(); } catch (_) {}
}

function initWindowLayering() {
    // Bring window to front on click
    $("body").off("mousedown.uieWindowLayering pointerdown.uieWindowLayering").on("mousedown.uieWindowLayering pointerdown.uieWindowLayering", ".uie-window", function() {
        const visibleWins = $(".uie-window:visible").toArray();
        const highestZ = Math.max(2147483650, ...visibleWins.map(el => Number(getComputedStyle(el).zIndex) || 0));

        const current = Number($(this).css("z-index")) || 0;
        const isPhone = $(this).is("#uie-phone-window");

        // Phone always wins
        if (isPhone) {
            $(this).css("z-index", 2147483670);
        } else if (current <= highestZ) {
            // Standard window
            $(this).css("z-index", highestZ + 1);
        }
    });
}

function initMenuButtons() {
    initWindowLayering();
    const $menu = $("#uie-main-menu");

    // Inventory
    $menu.off("click.uieMenuInv").on("click.uieMenuInv", "#uie-btn-inventory", function() {
        if (Date.now() - Number(uieMenuTabSwitchedAt || 0) < 350) return false;
        openWindow("#uie-inventory-window");
        // Ensure items tab is active by default if not set
        const root = document.getElementById("uie-inventory-window");
        if (root && !root.dataset.activeTab) {
             $("#uie-inventory-window #tabs [data-tab='items']").trigger("click");
        }
    });

    // Shop
    $menu.off("click.uieMenuShop").on("click.uieMenuShop", "#uie-btn-shop", async function() {
        openWindow("#uie-shop-window");
        try { (await import("./shop.js")).initShop?.(); } catch (_) {}
    });

    // Journal
    $menu.off("click.uieMenuJournal").on("click.uieMenuJournal", "#uie-btn-journal", async function() {
        openWindow("#uie-journal-window");
        try { (await import("./journal.js")).initJournal?.(); } catch (_) {}
    });

    // Party
    $menu.off("click.uieMenuParty").on("click.uieMenuParty", "#uie-btn-party", async function() {
        openWindow("#uie-party-window");
    });

    // Diary
    $menu.off("click.uieMenuDiary").on("click.uieMenuDiary", "#uie-btn-diary", async function() {
        openWindow("#uie-diary-window");
        try { (await import("./diary.js")).initDiary?.(); } catch (_) {}
    });

    // Social
    $menu.off("click.uieMenuSocial").on("click.uieMenuSocial", "#uie-btn-social", async function() {
        openWindow("#uie-social-window");
        try { (await import("./social.js")).initSocial?.(); } catch (_) {}
    });

    // Stats (Might be inventory tab or separate)
    $menu.off("click.uieMenuStats").on("click.uieMenuStats", "#uie-btn-stats", async function() {
        openWindow("#uie-stats-window");
        try { (await import("./features/stats.js")).initStats?.(); } catch (_) {}
    });

    // Activities
    $menu.off("click.uieMenuActivities").on("click.uieMenuActivities", "#uie-btn-activities", async function() {
        openWindow("#uie-activities-window");
        try { (await import("./features/activities.js")).initActivities?.(); } catch (_) {}
    });

    // Phone
    $menu.off("click.uieMenuPhone").on("click.uieMenuPhone", "#uie-btn-open-phone", async function() {
        // Phone usually has its own toggle
        try {
            const mod = await import("./phone.js");
            if (mod.initPhone) mod.initPhone(); // Ensure logic is bound and visuals loaded
            mod.togglePhone?.();
        } catch (e) { console.error("Phone load error:", e); }
        $("#uie-main-menu").hide();
    });

    // Map
    $menu.off("click.uieMenuMap").on("click.uieMenuMap", "#uie-btn-open-map", async function() {
        openWindow("#uie-map-window");
        try { (await import("./map.js")).initMap?.(); } catch (_) {}
    });

    // World
    $menu.off("click.uieMenuWorld").on("click.uieMenuWorld", "#uie-btn-open-world", async function() {
        openWindow("#uie-world-window");
        try { (await import("./world.js")).initWorld?.(); } catch (e) { console.error(e); }
    });

    // Calendar
    $menu.off("click.uieMenuCalendar").on("click.uieMenuCalendar", "#uie-btn-open-calendar", async function() {
        openWindow("#uie-calendar-window");
        try { (await import("./calendar.js")).initCalendar?.(); } catch (_) {}
    });

    // Databank
    $menu.off("click.uieMenuDatabank").on("click.uieMenuDatabank", "#uie-btn-databank", async function() {
        openWindow("#uie-databank-window");
        try { (await import("./databank.js")).initDatabank?.(); } catch (_) {}
    });

    // Battle
    $menu.off("click.uieMenuBattle").on("click.uieMenuBattle", "#uie-btn-battle", async function() {
        openWindow("#uie-battle-window");
        try { (await getBattleModule())?.initBattle?.(); } catch (_) {}
    });

    // Settings
    $menu.off("click.uieMenuSettings").on("click.uieMenuSettings", "#uie-btn-open-settings", async function() {
        try {
            await ensureSettingsWindowLoaded();
            openWindow("#uie-settings-window");
        } catch (_) {}
    });

    // Debug
    $menu.off("click.uieMenuDebug").on("click.uieMenuDebug", "#uie-btn-debug", async function() {
        openWindow("#uie-debug-window");
        try { (await import("./diagnostics.js")).initDiagnostics?.(); } catch (_) {}
    });

    // Help
    $menu.off("click.uieMenuHelp").on("click.uieMenuHelp", "#uie-btn-help", function() {
        try {
            openWindow("#uie-phone-window");
        } catch (_) {}
        import("./phone.js")
            .then((mod) => {
                try { mod.initPhone?.(); } catch (_) {}
                try { mod.openBooksGuide?.(); } catch (_) {}
            })
            .catch(() => {});
    });

    // Chatbox (Reality Engine Projection)
    $menu.off("click.uieMenuChatbox").on("click.uieMenuChatbox", "#uie-btn-chatbox", async function() {
        const win = $("#uie-chatbox-window");
        if (win.length) {
            win.show();
            win.css("z-index", "2147483655");
            try { (await import("./chatbox.js")).openChatbox?.(); } catch (_) {}
            $("#uie-main-menu").hide();
        } else {
             try { (await import("./chatbox.js")).openChatbox?.(); } catch (_) {}
             $("#uie-main-menu").hide();
        }
    });

    // Memories scan controls (settings window)
    $(document)
        .off("click.uieMemScanAll")
        .on("click.uieMemScanAll", "#uie-mem-scan-all", async function(e) {
            e.preventDefault();
            e.stopPropagation();
            try {
                notify("info", "Scanning memories from start...", "Memories");
                const mod = await import("./memories.js");
                await mod.scanAllMemoriesFromStart?.();
                notify("success", "Memory scan complete.", "Memories");
            } catch (err) {
                console.warn("[UIE] Memory full scan failed", err);
                notify("error", "Memory scan failed.", "Memories");
            }
        })
        .off("click.uieMemScanNext")
        .on("click.uieMemScanNext", "#uie-mem-scan-next", async function(e) {
            e.preventDefault();
            e.stopPropagation();
            try {
                const mod = await import("./memories.js");
                await mod.scanNextMemoriesChunk?.();
                notify("success", "Scanned next memory chunk.", "Memories");
            } catch (err) {
                console.warn("[UIE] Memory chunk scan failed", err);
                notify("error", "Memory chunk scan failed.", "Memories");
            }
        });
}

function initMenuTabs() {
    // Menu Tabs Logic (For Main Menu)
    const $menu = $("#uie-main-menu");
    let lastPointerTime = 0;

    // Unbind specific namespace first
    $menu.off("click.uieMenuTabs pointerup.uieMenuTabs");

    // Bind to the MENU container directly for delegation
    $(document).on("click.uieMenuTabs pointerup.uieMenuTabs", "#uie-main-menu .uie-menu-tab", function(e) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        // De-dupe pointerup vs click
        if (e.type === "pointerup") {
            lastPointerTime = Date.now();
        } else if (e.type === "click" && Date.now() - lastPointerTime < 300) {
            return;
        }

        uieMenuTabSwitchedAt = Date.now();
        const tab = $(this).data("tab");
        const target = $("#uie-tab-" + tab);
        if (!target.length) return;

        $(".uie-menu-tab").removeClass("active").css({ "border-bottom-color": "transparent", "color": "#888" });
        $(this).addClass("active").css({ "border-bottom-color": "#f1c40f", "color": "#fff" });

        $(".uie-menu-page").hide();
        target.show();
    });

    // Guard against mobile click-through: the tab touch can synthesize a click on the
    // newly-shown first button (Inventory). Block button clicks briefly after a tab switch.
    $(document)
        .off("click.uieMenuTabGuard pointerup.uieMenuTabGuard", "#uie-main-menu button")
        .on("click.uieMenuTabGuard pointerup.uieMenuTabGuard", "#uie-main-menu button", function(e) {
            if (Date.now() - Number(uieMenuTabSwitchedAt || 0) < 350) {
                try { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); } catch (_) {}
                return false;
            }
        });

    // Settings Tabs Logic
    const $settingsTabs = $("#uie-settings-tabs");

    // Unbind specific namespace first
    $(document).off("click.uieSettingsTabs pointerup.uieSettingsTabs");

    // Bind to the SETTINGS TABS container directly for delegation
    $(document).on("click.uieSettingsTabs pointerup.uieSettingsTabs", "#uie-settings-tabs .uie-set-tab", function(e) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        // De-dupe pointerup vs click
        if (e.type === "pointerup") {
            lastPointerTime = Date.now();
        } else if (e.type === "click" && Date.now() - lastPointerTime < 300) {
            return;
        }

        const tab = $(this).data("tab");

        const idPrefix = "uie-set-";
        const $scope = $(".uie-settings-block");
        const target = $("#" + idPrefix + tab);

        // Hide all setting pages (scoped)
        if ($scope && $scope.length) {
            $scope.find(`[id^='${idPrefix}']`).hide();
        } else {
            $(`[id^='${idPrefix}']`).hide();
        }

        // Reset all tabs (only within the clicked tabs container)
        const $tabsRoot = $(this).closest("#uie-settings-tabs");
        ($tabsRoot.length ? $tabsRoot : $("#uie-settings-tabs")).find(".uie-set-tab")
            .removeClass("active")
            .css({ "border-bottom-color": "transparent", "color": "#888", "font-weight": "normal" });

        // Activate clicked tab
        $(this).addClass("active").css({ "border-bottom-color": "#cba35c", "color": "#fff", "font-weight": "bold" });

        // Show target page
        if (target.length) target.show();

        // Profiles tab: attempt to sync SillyTavern main-API presets into UIE selector.
        // (UIE selector mirrors ST's own preset/profile selector; best-effort discovery.)
        if (String(tab || "") === "profiles") {
            setTimeout(() => {
                try { syncStMainApiPresetsToUie(true); } catch (_) {}
            }, 60);
        }
    });

    // (settings_window removed)

    let lastSwPointerTime = 0;
    $(document).off("click.uieSettingsWindowTabs pointerup.uieSettingsWindowTabs");
    $(document).on("click.uieSettingsWindowTabs pointerup.uieSettingsWindowTabs", "#uie-sw-tabs .uie-set-tab", function(e) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        if (e.type === "pointerup") {
            lastSwPointerTime = Date.now();
        } else if (e.type === "click" && Date.now() - lastSwPointerTime < 300) {
            return;
        }

        const tab = String($(this).data("tab") || "").trim();
        if (!tab) return;

        const root = document.getElementById("uie-settings-window");
        if (root) {
            const pages = root.querySelectorAll("#uie-sw-general, #uie-sw-menu, #uie-sw-features, #uie-sw-automation, #uie-sw-rpg, #uie-sw-style");
            for (const el of pages) {
                try { el.style.display = "none"; } catch (_) {}
            }
            const target = root.querySelector("#uie-sw-" + tab);
            if (target) {
                try { target.style.display = "block"; } catch (_) {}
            }
        }

        const $tabsRoot = $(this).closest("#uie-sw-tabs");
        ($tabsRoot.length ? $tabsRoot : $("#uie-sw-tabs")).find(".uie-set-tab")
            .removeClass("active")
            .css({ "border-bottom-color": "transparent", "color": "#888", "font-weight": "700" });

        $(this).addClass("active").css({ "border-bottom-color": "#cba35c", "color": "#fff", "font-weight": "700" });
    });

    $("body").off("click.uieSettingsWindowClose pointerup.uieSettingsWindowClose", "#uie-settings-close")
        .on("click.uieSettingsWindowClose pointerup.uieSettingsWindowClose", "#uie-settings-close", function(e) {
            e.preventDefault();
            e.stopPropagation();
            const win = $("#uie-settings-window");
            if (win.length) win.hide();
            try { window.UIE_navPop?.(); } catch (_) {}
        });

    // --- SillyTavern Connection Presets (Main API) ---
    function findStMainApiPresetSelect() {
        try {
            const candidates = [
                "#connection_profile",
                "#connection-profile",
                "#connection_preset",
                "#connection-preset",
                "#api_connection_profile",
                "#api-connection-profile",
                "#api_connection_preset",
                "#api-connection-preset",
                "#main_api_profile",
                "#main-api-profile",
                "select[name='connection_profile']",
                "select[name='connection_preset']",
                "select[id*='connection'][id*='profile']",
                "select[id*='connection'][id*='preset']",
                "select[id*='api'][id*='profile']",
                "select[id*='api'][id*='preset']"
            ];

            for (const sel of candidates) {
                const el = document.querySelector(sel);
                if (!el) continue;
                if (!(el instanceof HTMLSelectElement)) continue;
                const opts = Array.from(el.options || []);
                // Heuristic: must have at least 2 choices to be a real preset selector.
                if (opts.length < 2) continue;
                return el;
            }
        } catch (_) {}
        return null;
    }

    function syncStMainApiPresetsToUie(selectSaved = false) {
        const uieSel = document.getElementById("uie-st-preset-select");
        if (!uieSel) return;

        const stSel = findStMainApiPresetSelect();
        if (!stSel) {
            // Leave whatever is currently there; only replace if we have real data.
            if (uieSel.options.length <= 1) {
                uieSel.innerHTML = "";
                const opt = document.createElement("option");
                opt.value = "";
                opt.textContent = "(Open ST API settings to load presets)";
                uieSel.appendChild(opt);
            }
            return;
        }

        const prev = String(uieSel.value || "");
        const stOpts = Array.from(stSel.options || []).map(o => ({ value: String(o.value || ""), text: String(o.textContent || o.label || o.value || "").trim() }));

        // Rebuild UIE select.
        uieSel.innerHTML = "";
        for (const o of stOpts) {
            const opt = document.createElement("option");
            opt.value = o.value;
            opt.textContent = o.text || o.value;
            uieSel.appendChild(opt);
        }

        const s = getSettings();
        const saved = String(s?.connections?.stMainPreset || "");
        const hasSaved = saved && Array.from(uieSel.options).some(o => String(o.value || "") === saved);
        const hasPrev = prev && Array.from(uieSel.options).some(o => String(o.value || "") === prev);

        if (selectSaved && hasSaved) uieSel.value = saved;
        else if (hasPrev) uieSel.value = prev;
    }

    // Refresh button
    $(document).off("click.uieStPresetRefresh").on("click.uieStPresetRefresh", "#uie-st-preset-refresh", function (e) {
        e.preventDefault();
        e.stopPropagation();
        try { syncStMainApiPresetsToUie(true); } catch (_) {}
        try { notify("info", "Refreshed connection presets.", "UIE", "settings"); } catch (_) {}
    });

    // Apply on selection change
    $(document).off("change.uieStPreset").on("change.uieStPreset", "#uie-st-preset-select", function (e) {
        e.preventDefault();
        e.stopPropagation();

        const val = String($(this).val() || "");
        const s = getSettings();
        if (!s.connections || typeof s.connections !== "object") s.connections = {};
        s.connections.stMainPreset = val;
        saveSettings();

        const stSel = findStMainApiPresetSelect();
        if (!stSel) {
            try { notify("warning", "Could not find SillyTavern's preset selector. Open ST API settings then refresh.", "UIE", "settings"); } catch (_) {}
            return;
        }

        // Apply to ST selector and trigger its native handler.
        try {
            stSel.value = val;
            stSel.dispatchEvent(new Event("input", { bubbles: true }));
            stSel.dispatchEvent(new Event("change", { bubbles: true }));
        } catch (_) {}

        // Force a save after ST handlers apply settings.
        setTimeout(() => {
            try {
                const ctx = getContext?.();
                if (ctx?.saveSettingsDebounced) ctx.saveSettingsDebounced();
                else if (ctx?.saveSettings) ctx.saveSettings();
                else if (window.saveSettingsDebounced) window.saveSettingsDebounced();
            } catch (_) {}
        }, 120);

        try { notify("success", "Applied preset.", "UIE", "settings"); } catch (_) {}
    });

    // Initial sync (best effort). The ST preset selector may not be present until the user opens ST settings.
    setTimeout(() => {
        try { syncStMainApiPresetsToUie(true); } catch (_) {}
    }, 900);

    // Scan Now Button (Moved to Wand Menu)
    // Handler removed from here as the button was removed from settings.

    const popupCategoryById = {
        "uie-pop-quests-accepted": "questsAccepted",
        "uie-pop-quests-abandoned": "questsAbandoned",
        "uie-pop-quests-failed": "questsFailed",
        "uie-pop-quests-completed": "questsCompleted",
        "uie-pop-phone-calls": "phoneCalls",
        "uie-pop-phone-messages": "phoneMessages",
        "uie-pop-loot": "loot",
        "uie-pop-currency": "currency",
        "uie-pop-xp": "xp",
        "uie-pop-levelup": "levelUp",
        "uie-pop-postbattle": "postBattle",
        "uie-pop-api": "api",
        "uie-pop-social": "social",
        "uie-pop-lowhp-enabled": "lowHp",
    };

    const ensureUiCustomization = (s) => {
        if (!s.ui || typeof s.ui !== "object") s.ui = {};
        if (!s.ui.css || typeof s.ui.css !== "object") s.ui.css = { global: "", stats: "", activities: "", byTarget: {} };
        if (typeof s.ui.css.global !== "string") s.ui.css.global = "";
        if (typeof s.ui.css.stats !== "string") s.ui.css.stats = "";
        if (typeof s.ui.css.activities !== "string") s.ui.css.activities = "";
        if (!s.ui.css.byTarget || typeof s.ui.css.byTarget !== "object") s.ui.css.byTarget = {};
        if (!s.ui.backgrounds || typeof s.ui.backgrounds !== "object") s.ui.backgrounds = {};
        return s.ui;
    };

    const ensureNotificationsSettings = (s) => {
        if (!s.ui || typeof s.ui !== "object") s.ui = {};
        if (s.ui.showPopups === undefined) s.ui.showPopups = true;
        if (!s.ui.notifications || typeof s.ui.notifications !== "object") s.ui.notifications = {};
        const n = s.ui.notifications;
        if (!n.categories || typeof n.categories !== "object") n.categories = {};
        if (!n.lowHp || typeof n.lowHp !== "object") n.lowHp = { enabled: false, threshold: 0.25, lastWarnAt: 0 };
        if (n.lowHp.enabled === undefined) n.lowHp.enabled = false;
        if (!Number.isFinite(Number(n.lowHp.threshold))) n.lowHp.threshold = 0.25;
        if (!n.postBattle || typeof n.postBattle !== "object") n.postBattle = { enabled: false, lastSig: "" };
        if (n.postBattle.enabled === undefined) n.postBattle.enabled = false;
        if (!n.cssByCategory || typeof n.cssByCategory !== "object") n.cssByCategory = {};
        if (typeof n.css !== "string") n.css = "";
        return n;
    };

    const ensureMemSettings = (s) => {
        if (!s.memories || typeof s.memories !== "object") s.memories = {};
        if (typeof s.memories.auto !== "boolean") s.memories.auto = false;
        return s.memories;
    };

    const ensureRpgToggleSettings = (s) => {
        if (!s.rpg || typeof s.rpg !== "object") s.rpg = {};
        if (typeof s.rpg.enabled !== "boolean") s.rpg.enabled = true;
        if (typeof s.rpg.xpbar !== "boolean") s.rpg.xpbar = true;
        if (typeof s.rpg.equipment !== "boolean") s.rpg.equipment = true;
        if (typeof s.rpg.skills !== "boolean") s.rpg.skills = true;
        if (typeof s.rpg.party !== "boolean") s.rpg.party = true;
        if (typeof s.rpg.permadeath !== "boolean") s.rpg.permadeath = false;
        return s.rpg;
    };

    const popupScopeToKey = (scopeRaw) => {
        const scope = String(scopeRaw || "global").trim();
        return scope || "global";
    };

    const getPopupCssForScope = (s, scopeRaw) => {
        const n = ensureNotificationsSettings(s);
        const scope = popupScopeToKey(scopeRaw);
        if (scope === "global") return String(n.css || "");
        return String(n.cssByCategory?.[scope] || "");
    };

    const setPopupCssForScope = (s, scopeRaw, cssRaw) => {
        const n = ensureNotificationsSettings(s);
        const scope = popupScopeToKey(scopeRaw);
        const css = String(cssRaw || "").trim();
        if (scope === "global") {
            n.css = css;
            return;
        }
        if (!n.cssByCategory || typeof n.cssByCategory !== "object") n.cssByCategory = {};
        if (!css) delete n.cssByCategory[scope];
        else n.cssByCategory[scope] = css;
    };

    const popupScopeClass = (scopeRaw) => String(scopeRaw || "").replace(/[^a-z0-9_-]/gi, "-").toLowerCase();

    const popupCssBlock = (scopeRaw, cssRaw) => {
        const scope = popupScopeToKey(scopeRaw);
        const css = String(cssRaw || "").trim();
        if (!css) return "";
        if (scope === "global") return css;
        if (/[{}]/.test(css)) return css;
        return `#toast-container .toast-uie-cat-${popupScopeClass(scope)} { ${css} }`;
    };

    const applyPopupCssFromSettings = () => {
        try {
            const s = getSettings();
            const n = ensureNotificationsSettings(s);
            const parts = [];
            const globalCss = popupCssBlock("global", n.css || "");
            if (globalCss) parts.push(globalCss);
            const scoped = n.cssByCategory && typeof n.cssByCategory === "object" ? n.cssByCategory : {};
            for (const [scope, raw] of Object.entries(scoped)) {
                const block = popupCssBlock(scope, raw);
                if (block) parts.push(block);
            }

            const finalCss = parts.join("\n\n").trim();
            let styleEl = document.getElementById("uie-popup-css-style");
            if (!finalCss) {
                if (styleEl) styleEl.remove();
                return;
            }
            if (!styleEl) {
                styleEl = document.createElement("style");
                styleEl.id = "uie-popup-css-style";
                document.head.appendChild(styleEl);
            }
            styleEl.textContent = finalCss;
        } catch (_) {}
    };

    const styleTargetSelectors = {
        menu: "#uie-main-menu",
        inventory: "#uie-inventory-window",
        shop: "#uie-shop-window",
        journal: "#uie-journal-window",
        diary: "#uie-diary-window",
        social: "#uie-social-window",
        party: "#uie-party-window",
        phone: "#uie-phone-window",
        map: "#uie-map-window",
    };

    const cssTargetSelectors = {
        global: "",
        menu: "#uie-main-menu",
        inventory: "#uie-inventory-window",
        shop: "#uie-shop-window",
        journal: "#uie-journal-window",
        diary: "#uie-diary-window",
        social: "#uie-social-window",
        party: "#uie-party-window",
        phone: "#uie-phone-window",
        map: "#uie-map-window",
    };

    const toScopedCss = (selector, cssRaw) => {
        const css = String(cssRaw || "").trim();
        if (!css) return "";
        if (!selector) return css;
        if (/[{}]/.test(css)) return css;
        return `${selector} { ${css} }`;
    };

    const applyCustomCssFromSettings = () => {
        try {
            const s = getSettings();
            const ui = ensureUiCustomization(s);
            const css = ui.css || {};
            const byTarget = css.byTarget && typeof css.byTarget === "object" ? css.byTarget : {};

            const parts = [];
            if (String(css.global || "").trim()) parts.push(String(css.global || ""));
            const statsBlock = toScopedCss("#uie-stats-window", css.stats || "");
            if (statsBlock) parts.push(statsBlock);
            const activitiesBlock = toScopedCss("#uie-activities-window", css.activities || "");
            if (activitiesBlock) parts.push(activitiesBlock);

            for (const [target, raw] of Object.entries(byTarget)) {
                const selector = cssTargetSelectors[String(target || "")] || "";
                const block = toScopedCss(selector, raw);
                if (block) parts.push(block);
            }

            const finalCss = parts.join("\n\n").trim();
            let styleEl = document.getElementById("uie-custom-css-style");
            if (!finalCss) {
                if (styleEl) styleEl.remove();
                return;
            }
            if (!styleEl) {
                styleEl = document.createElement("style");
                styleEl.id = "uie-custom-css-style";
                document.head.appendChild(styleEl);
            }
            styleEl.textContent = finalCss;
        } catch (_) {}
    };

    const applyBackgroundsFromSettings = () => {
        try {
            const s = getSettings();
            const ui = ensureUiCustomization(s);
            const bg = ui.backgrounds && typeof ui.backgrounds === "object" ? ui.backgrounds : {};
            for (const [target, selector] of Object.entries(styleTargetSelectors)) {
                const val = String(bg?.[target] || "").trim();
                if (!selector) continue;
                if (val) {
                    $(selector).css({
                        backgroundImage: `url("${val}")`,
                        backgroundSize: "cover",
                        backgroundPosition: "center",
                        backgroundRepeat: "no-repeat",
                    });
                } else {
                    $(selector).css({
                        backgroundImage: "",
                        backgroundSize: "",
                        backgroundPosition: "",
                        backgroundRepeat: "",
                    });
                }
            }
        } catch (_) {}
    };

    const syncPopupCssEditorFromScope = () => {
        try {
            const s = getSettings();
            const scope = String($("#uie-popup-css-scope").val() || "global");
            $("#uie-popup-css-text").val(getPopupCssForScope(s, scope));
        } catch (_) {}
    };

    const syncKillSwitchUi = () => {
        try {
            const s = getSettings();
            const enabled = s.enabled !== false;
            $("#uie-setting-enable").prop("checked", enabled);

            const scanAll = s?.generation?.scanAllEnabled !== false;
            $("#uie-scanall-enable").prop("checked", scanAll);
            $("#uie-sw-scanall-enable").prop("checked", scanAll);

            const sysChecks = s?.generation?.allowSystemChecks !== false;
            $("#uie-systemchecks-enable").prop("checked", sysChecks);
            $("#uie-sw-systemchecks-enable").prop("checked", sysChecks);

            const popups = s?.ui?.showPopups !== false;
            $("#uie-show-popups").prop("checked", popups);
        } catch (_) {}
    };

    const syncSettingsDrawerUi = () => {
        try {
            const s = getSettings();
            if (!s) return;

            if (!s.ui || typeof s.ui !== "object") s.ui = {};

            // AI allow toggles
            if (!s.ai || typeof s.ai !== "object") s.ai = {};
            $("#uie-ai-phone-browser").prop("checked", s.ai.phoneBrowser !== false);
            $("#uie-ai-phone-messages").prop("checked", s.ai.phoneMessages !== false);
            $("#uie-ai-phone-calls").prop("checked", s.ai.phoneCalls !== false);
            $("#uie-ai-app-builder").prop("checked", s.ai.appBuilder !== false);
            $("#uie-ai-books").prop("checked", s.ai.books !== false);
            $("#uie-ai-journal-quests").prop("checked", s.ai.journalQuestGen !== false);
            $("#uie-ai-databank").prop("checked", s.ai.databankScan !== false);
            $("#uie-ai-map").prop("checked", s.ai.map !== false);
            $("#uie-ai-shop").prop("checked", s.ai.shop !== false);
            $("#uie-ai-loot").prop("checked", s.ai.loot !== false);
            $("#uie-sw-ai-phone-browser").prop("checked", s.ai.phoneBrowser !== false);
            $("#uie-sw-ai-phone-messages").prop("checked", s.ai.phoneMessages !== false);
            $("#uie-sw-ai-phone-calls").prop("checked", s.ai.phoneCalls !== false);
            $("#uie-sw-ai-app-builder").prop("checked", s.ai.appBuilder !== false);
            $("#uie-sw-ai-books").prop("checked", s.ai.books !== false);
            $("#uie-sw-ai-journal-quests").prop("checked", s.ai.journalQuestGen !== false);
            $("#uie-sw-ai-databank").prop("checked", s.ai.databankScan !== false);
            $("#uie-sw-ai-map").prop("checked", s.ai.map !== false);
            $("#uie-sw-ai-shop").prop("checked", s.ai.shop !== false);
            $("#uie-sw-ai-loot").prop("checked", s.ai.loot !== false);
            $("#uie-ai-journal-gen").prop("checked", s.ai.journalQuestGen !== false);
            $("#uie-ai-map-gen").prop("checked", s.ai.map !== false);

            if (!s.generation || typeof s.generation !== "object") s.generation = {};
            $("#uie-gen-require-confirm").prop("checked", s.generation.requireConfirmUnverified === true);
            $("#uie-gen-show-prompt").prop("checked", s.generation.showPromptBox === true);
            $("#uie-ai-confirm-toggle").prop("checked", s.generation.aiConfirm === true);
            $("#uie-gen-scan-only-buttons").prop("checked", s.generation.scanOnlyOnGenerateButtons === true);

            const sysMinSec = Math.max(0, Math.round(Number(s.generation.systemCheckMinIntervalMs ?? 20000) / 1000));
            const autoMinSec = Math.max(0, Math.round(Number(s.generation.autoScanMinIntervalMs ?? 8000) / 1000));
            const $sys = $("#uie-gen-syscheck-min");
            if ($sys.length) $sys.val(String(Number.isFinite(sysMinSec) ? sysMinSec : 20));
            const $auto = $("#uie-gen-autoscan-min");
            if ($auto.length) $auto.val(String(Number.isFinite(autoMinSec) ? autoMinSec : 8));

            const $cs = $("#uie-gen-custom-system");
            if ($cs.length) $cs.val(String(s.generation.customSystemPrompt || ""));

            if (!s.features || typeof s.features !== "object") s.features = {};
            $("#uie-feature-codex").prop("checked", s.features.codexEnabled === true);
            $("#uie-feature-codex-auto").prop("checked", s.features.codexAutoExtract === true);

            // Backups
            // (Buttons are stateless, nothing to sync)

            // Prompts
            const p = (s.generation.promptPrefixes && typeof s.generation.promptPrefixes === "object")
                ? s.generation.promptPrefixes
                : (s.generation.promptPrefixes = { byType: {} });
            if (!p.byType || typeof p.byType !== "object") p.byType = {};
            $("#uie-gen-prompt-global").val(String(p.global || ""));
            $("#uie-gen-prompt-default").val(String(p.byType.default || ""));
            $("#uie-gen-prompt-webpage").val(String(p.byType.Webpage || ""));
            $("#uie-gen-prompt-systemcheck").val(String(p.byType["System Check"] || ""));
            $("#uie-gen-prompt-phonecall").val(String(p.byType["Phone Call"] || ""));
            $("#uie-gen-prompt-image").val(String(p.byType["Image Gen"] || ""));

            // Scale Display
            const scale = s.ui?.scale || s.uiScale || 1.0;
            $("#uie-scale-slider").val(scale);
            $("#uie-scale-display").text(scale.toFixed(1));

            // Launcher Name
            $("#uie-launcher-name").val(s.launcher?.name || "");

            // Launcher Icon Select
            const lSrc = s.launcher?.src || "";
            const lSel = document.getElementById("uie-launcher-icon");
            if (lSel) {
                const has = Array.from(lSel.options).some(o => o.value === lSrc);
                lSel.value = has ? lSrc : "custom";
            }

            // Settings window: language + menu visibility + memory
            const langPref = String(s?.ui?.lang || "auto");
            const langSel = document.getElementById("uie-sw-lang-select");
            if (langSel) {
                const hasPref = Array.from(langSel.options || []).some((o) => String(o.value || "") === langPref);
                langSel.value = hasPref ? langPref : "auto";
            }
            syncMenuVisibilityCheckboxes();
            const mem = ensureMemSettings(s);
            $("#uie-mem-auto").prop("checked", mem.auto === true);

            const rpg = ensureRpgToggleSettings(s);
            $("#uie-rpg-enable").prop("checked", rpg.enabled === true);
            $("#uie-rpg-xpbar").prop("checked", rpg.xpbar === true);
            $("#uie-rpg-equipment").prop("checked", rpg.equipment === true);
            $("#uie-rpg-skills").prop("checked", rpg.skills === true);
            $("#uie-rpg-party").prop("checked", rpg.party === true);
            $("#uie-check-permadeath").prop("checked", rpg.permadeath === true);

            // Popup settings
            const n = ensureNotificationsSettings(s);
            for (const [id, key] of Object.entries(popupCategoryById)) {
                const on = key === "lowHp"
                    ? n.lowHp?.enabled === true
                    : n.categories?.[key] !== false;
                $("#" + id).prop("checked", on);
            }
            $("#uie-postbattle-generate").prop("checked", n.postBattle?.enabled === true);
            const lowHpThreshold = Math.max(0.05, Math.min(0.9, Number(n.lowHp?.threshold || 0.25)));
            $("#uie-pop-lowhp-threshold").val(String(lowHpThreshold));
            const cssScopeEl = document.getElementById("uie-popup-css-scope");
            if (cssScopeEl && !String(cssScopeEl.value || "").trim()) cssScopeEl.value = "global";
            syncPopupCssEditorFromScope();
            applyPopupCssFromSettings();

            // Custom style/background settings
            const ui = ensureUiCustomization(s);
            const cssTarget = String($("#uie-css-target").val() || "global");
            if (document.getElementById("uie-style-css")) {
                const cssByTarget = ui.css.byTarget && typeof ui.css.byTarget === "object" ? ui.css.byTarget : {};
                $("#uie-style-css").val(String(cssByTarget[cssTarget] || ""));
            }
            $("#uie-custom-css").val(String(ui.css.global || ""));
            $("#uie-custom-css-stats").val(String(ui.css.stats || ""));
            $("#uie-custom-css-activities").val(String(ui.css.activities || ""));
            const bgTarget = String($("#uie-bg-target").val() || "menu");
            if (document.getElementById("uie-bg-url")) {
                $("#uie-bg-url").val(String(ui.backgrounds?.[bgTarget] || ""));
            }
            applyCustomCssFromSettings();
            applyBackgroundsFromSettings();

            // ComfyUI / Image Gen
            if (!s.image || typeof s.image !== "object") s.image = {};
            const img = s.image;
            $("#uie-img-enable, #uie-sw-img-enable").prop("checked", img.enabled === true);
            $("#uie-img-provider").val(img.provider || "openai");
            $("#uie-sw-img-url").val(String(img.url || ""));
            $("#uie-sw-img-key").val(String(img.key || ""));
            $("#uie-sw-img-model").val(String(img.model || ""));

            // Show/Hide blocks
            const prov = img.provider || "openai";
            $("#uie-img-openai-block").toggle(prov === "openai");
            $("#uie-img-comfy-block").toggle(prov === "comfy");
            $("#uie-img-sdwebui-block").toggle(prov === "sdwebui");

            if (img.comfy && typeof img.comfy === "object") {
                $("#uie-img-comfy-base").val(img.comfy.base || "");
                $("#uie-img-comfy-key").val(img.comfy.key || "");
                $("#uie-img-comfy-workflow").val(img.comfy.workflow || "");
                $("#uie-img-comfy-posnode").val(img.comfy.positiveNodeId || "");
                $("#uie-img-comfy-negnode").val(img.comfy.negativeNodeId || "");
                $("#uie-img-comfy-outnode").val(img.comfy.outputNodeId || "");
            }

            const feats = (img.features && typeof img.features === "object") ? img.features : {};
            $("#uie-img-map, #uie-sw-img-map").prop("checked", feats.map !== false);
            $("#uie-img-doll, #uie-sw-img-doll").prop("checked", feats.doll !== false);
            $("#uie-img-social, #uie-sw-img-social").prop("checked", feats.social !== false);
            $("#uie-img-phone-bg, #uie-sw-img-phone-bg").prop("checked", feats.phoneBg !== false);
            $("#uie-img-msg, #uie-sw-img-msg").prop("checked", feats.msg !== false);
            $("#uie-img-party, #uie-sw-img-party").prop("checked", feats.party !== false);
            $("#uie-img-items, #uie-sw-img-items").prop("checked", feats.items !== false);

        } catch (_) {}
    };

    // Sync when the settings drawer is interacted with.
    // Use body delegation to ensure we catch it.
    $("body").off("click.uieSettingsDrawerSync").on("click.uieSettingsDrawerSync", ".uie-settings-block .inline-drawer-toggle", function () {
        setTimeout(() => { try { syncKillSwitchUi(); } catch (_) {} }, 40);
        setTimeout(() => { try { syncSettingsDrawerUi(); } catch (_) {} }, 60);
    });

    // Also sync shortly after init.
    setTimeout(() => { try { syncKillSwitchUi(); } catch (_) {} }, 900);
    setTimeout(() => { try { syncSettingsDrawerUi(); } catch (_) {} }, 950);


    const setEnabled = (on) => {
        const s = getSettings();
        s.enabled = on === true;
        saveSettings();
        if (s.enabled === false) {
            try { $("#uie-main-menu").hide(); } catch (_) {}
            try { $(".uie-window, .uie-overlay, .uie-modal, .uie-full-modal").hide(); } catch (_) {}
            try { $("#uie-launcher").hide(); } catch (_) {}
        } else {
            try { $("#uie-launcher").css("display", "flex"); } catch (_) {}
        }
        try { updateLayout(); } catch (_) {}
    };

    const setScanAll = (on) => {
        const s = getSettings();
        if (!s.generation || typeof s.generation !== "object") s.generation = {};
        s.generation.scanAllEnabled = on === true;
        saveSettings();
    };

    const setSystemChecks = (on) => {
        const s = getSettings();
        if (!s.generation || typeof s.generation !== "object") s.generation = {};
        s.generation.allowSystemChecks = on === true;
        saveSettings();
    };

    const setPopups = (on) => {
        const s = getSettings();
        if (!s.ui || typeof s.ui !== "object") s.ui = {};
        s.ui.showPopups = on === true;
        saveSettings();
        $("[id='uie-show-popups']").prop("checked", on === true);
    };

    const aiSelectorsByKey = {
        phoneBrowser: "#uie-ai-phone-browser, #uie-sw-ai-phone-browser",
        phoneMessages: "#uie-ai-phone-messages, #uie-sw-ai-phone-messages",
        phoneCalls: "#uie-ai-phone-calls, #uie-sw-ai-phone-calls",
        appBuilder: "#uie-ai-app-builder, #uie-sw-ai-app-builder",
        books: "#uie-ai-books, #uie-sw-ai-books",
        journalQuestGen: "#uie-ai-journal-quests, #uie-sw-ai-journal-quests, #uie-ai-journal-gen",
        databankScan: "#uie-ai-databank, #uie-sw-ai-databank",
        map: "#uie-ai-map, #uie-sw-ai-map, #uie-ai-map-gen",
        shop: "#uie-ai-shop, #uie-sw-ai-shop",
        loot: "#uie-ai-loot, #uie-sw-ai-loot",
    };

    const setAiAllow = (key, checked) => {
        const s = getSettings();
        if (!s.ai || typeof s.ai !== "object") s.ai = {};
        s.ai[key] = checked === true;
        saveSettings();
        const sel = aiSelectorsByKey[key];
        if (sel) $(sel).prop("checked", checked === true);
    };

    const setGenFlag = (key, checked) => {
        const s = getSettings();
        if (!s.generation || typeof s.generation !== "object") s.generation = {};
        s.generation[key] = checked === true;
        saveSettings();
    };

    const setGenNumberMs = (key, value) => {
        const s = getSettings();
        if (!s.generation || typeof s.generation !== "object") s.generation = {};
        const raw = Number(value);
        const sec = Number.isFinite(raw) ? Math.max(0, raw) : 0;
        s.generation[key] = Math.round(sec * 1000);
        saveSettings();
    };

    // Kill Switch Handlers - DELEGATED to BODY to ensure they catch clicks even if re-rendered
    $("body")
        .off("change.uieKillEnable")
        .on("change.uieKillEnable", "#uie-setting-enable", function (e) {
            e.preventDefault();
            e.stopPropagation();
            setEnabled($(this).prop("checked") === true);
        })
        .off("change.uieKillScanAll")
        .on("change.uieKillScanAll", "#uie-scanall-enable, #uie-sw-scanall-enable, #uie-wand-scanall-enable", function (e) {
            e.preventDefault();
            e.stopPropagation();
            const on = $(this).prop("checked") === true;
            setScanAll(on);
            // Sync all checkboxes
            $("#uie-scanall-enable").prop("checked", on);
            $("#uie-sw-scanall-enable").prop("checked", on);
            $("#uie-wand-scanall-enable").prop("checked", on);
        })
        .off("change.uieKillSysChecks")
        .on("change.uieKillSysChecks", "#uie-systemchecks-enable, #uie-sw-systemchecks-enable, #uie-wand-systemchecks-enable", function (e) {
            e.preventDefault();
            e.stopPropagation();
            const on = $(this).prop("checked") === true;
            setSystemChecks(on);
            $("#uie-systemchecks-enable").prop("checked", on);
            $("#uie-sw-systemchecks-enable").prop("checked", on);
            $("#uie-wand-systemchecks-enable").prop("checked", on);
        })
        .off("change.uieKillPopups")
        .on("change.uieKillPopups", "#uie-show-popups", function (e) {
            e.preventDefault();
            e.stopPropagation();
            const on = $(this).prop("checked") === true;
            setPopups(on);
        });

    $(document)
        .off("change.uieAiAllowPhoneBrowser")
        .on("change.uieAiAllowPhoneBrowser", "#uie-ai-phone-browser, #uie-sw-ai-phone-browser", function () { setAiAllow("phoneBrowser", $(this).prop("checked") === true); })
        .off("change.uieAiAllowPhoneMessages")
        .on("change.uieAiAllowPhoneMessages", "#uie-ai-phone-messages, #uie-sw-ai-phone-messages", function () { setAiAllow("phoneMessages", $(this).prop("checked") === true); })
        .off("change.uieAiAllowPhoneCalls")
        .on("change.uieAiAllowPhoneCalls", "#uie-ai-phone-calls, #uie-sw-ai-phone-calls", function () { setAiAllow("phoneCalls", $(this).prop("checked") === true); })
        .off("change.uieAiAllowAppBuilder")
        .on("change.uieAiAllowAppBuilder", "#uie-ai-app-builder, #uie-sw-ai-app-builder", function () { setAiAllow("appBuilder", $(this).prop("checked") === true); })
        .off("change.uieAiAllowBooks")
        .on("change.uieAiAllowBooks", "#uie-ai-books, #uie-sw-ai-books", function () { setAiAllow("books", $(this).prop("checked") === true); })
        .off("change.uieAiAllowJournalQuests")
        .on("change.uieAiAllowJournalQuests", "#uie-ai-journal-quests, #uie-sw-ai-journal-quests, #uie-ai-journal-gen", function () { setAiAllow("journalQuestGen", $(this).prop("checked") === true); })
        .off("change.uieAiAllowDatabank")
        .on("change.uieAiAllowDatabank", "#uie-ai-databank, #uie-sw-ai-databank", function () { setAiAllow("databankScan", $(this).prop("checked") === true); })
        .off("change.uieAiAllowMap")
        .on("change.uieAiAllowMap", "#uie-ai-map, #uie-sw-ai-map, #uie-ai-map-gen", function () { setAiAllow("map", $(this).prop("checked") === true); })
        .off("change.uieAiAllowShop")
        .on("change.uieAiAllowShop", "#uie-ai-shop, #uie-sw-ai-shop", function () { setAiAllow("shop", $(this).prop("checked") === true); })
        .off("change.uieAiAllowLoot")
        .on("change.uieAiAllowLoot", "#uie-ai-loot, #uie-sw-ai-loot", function () { setAiAllow("loot", $(this).prop("checked") === true); })
        .off("change.uieGenRequireConfirm")
        .on("change.uieGenRequireConfirm", "#uie-gen-require-confirm", function () { setGenFlag("requireConfirmUnverified", $(this).prop("checked") === true); })
        .off("change.uieGenShowPrompt")
        .on("change.uieGenShowPrompt", "#uie-gen-show-prompt", function () { setGenFlag("showPromptBox", $(this).prop("checked") === true); })
        .off("change.uieAiConfirm")
        .on("change.uieAiConfirm", "#uie-ai-confirm-toggle", function () { setGenFlag("aiConfirm", $(this).prop("checked") === true); })
        .off("change.uieScanOnlyButtons")
        .on("change.uieScanOnlyButtons", "#uie-gen-scan-only-buttons", function () { setGenFlag("scanOnlyOnGenerateButtons", $(this).prop("checked") === true); })
        .off("input.uieSyscheckMin change.uieSyscheckMin")
        .on("input.uieSyscheckMin change.uieSyscheckMin", "#uie-gen-syscheck-min", function () { setGenNumberMs("systemCheckMinIntervalMs", $(this).val()); })
        .off("input.uieAutoScanMin change.uieAutoScanMin")
        .on("input.uieAutoScanMin change.uieAutoScanMin", "#uie-gen-autoscan-min", function () { setGenNumberMs("autoScanMinIntervalMs", $(this).val()); })
        .off("input.uieCustomSystem change.uieCustomSystem")
        .on("input.uieCustomSystem change.uieCustomSystem", "#uie-gen-custom-system", function () {
            const s = getSettings();
            if (!s.generation || typeof s.generation !== "object") s.generation = {};
            s.generation.customSystemPrompt = String($(this).val() || "");
            saveSettings();
        })
        .off("change.uieFeatureCodex")
        .on("change.uieFeatureCodex", "#uie-feature-codex", function () {
            const s = getSettings();
            if (!s.features || typeof s.features !== "object") s.features = {};
            s.features.codexEnabled = $(this).prop("checked") === true;
            saveSettings();
        })
        .off("change.uieFeatureCodexAuto")
        .on("change.uieFeatureCodexAuto", "#uie-feature-codex-auto", function () {
            const s = getSettings();
            if (!s.features || typeof s.features !== "object") s.features = {};
            s.features.codexAutoExtract = $(this).prop("checked") === true;
            saveSettings();
        })
        .off("input.uiePromptGlobal change.uiePromptGlobal")
        .on("input.uiePromptGlobal change.uiePromptGlobal", "#uie-gen-prompt-global", function () {
            const s = getSettings();
            if (!s.generation || typeof s.generation !== "object") s.generation = {};
            if (!s.generation.promptPrefixes || typeof s.generation.promptPrefixes !== "object") s.generation.promptPrefixes = { byType: {} };
            s.generation.promptPrefixes.global = String($(this).val() || "");
            saveSettings();
        })
        .off("input.uiePromptDefault change.uiePromptDefault")
        .on("input.uiePromptDefault change.uiePromptDefault", "#uie-gen-prompt-default", function () {
            const s = getSettings();
            if (!s.generation || typeof s.generation !== "object") s.generation = {};
            if (!s.generation.promptPrefixes || typeof s.generation.promptPrefixes !== "object") s.generation.promptPrefixes = { byType: {} };
            if (!s.generation.promptPrefixes.byType || typeof s.generation.promptPrefixes.byType !== "object") s.generation.promptPrefixes.byType = {};
            s.generation.promptPrefixes.byType.default = String($(this).val() || "");
            saveSettings();
        })
        .off("input.uiePromptWebpage change.uiePromptWebpage")
        .on("input.uiePromptWebpage change.uiePromptWebpage", "#uie-gen-prompt-webpage", function () {
            const s = getSettings();
            if (!s.generation || typeof s.generation !== "object") s.generation = {};
            if (!s.generation.promptPrefixes || typeof s.generation.promptPrefixes !== "object") s.generation.promptPrefixes = { byType: {} };
            if (!s.generation.promptPrefixes.byType || typeof s.generation.promptPrefixes.byType !== "object") s.generation.promptPrefixes.byType = {};
            s.generation.promptPrefixes.byType.Webpage = String($(this).val() || "");
            saveSettings();
        })
        .off("input.uiePromptSysCheck change.uiePromptSysCheck")
        .on("input.uiePromptSysCheck change.uiePromptSysCheck", "#uie-gen-prompt-systemcheck", function () {
            const s = getSettings();
            if (!s.generation || typeof s.generation !== "object") s.generation = {};
            if (!s.generation.promptPrefixes || typeof s.generation.promptPrefixes !== "object") s.generation.promptPrefixes = { byType: {} };
            if (!s.generation.promptPrefixes.byType || typeof s.generation.promptPrefixes.byType !== "object") s.generation.promptPrefixes.byType = {};
            s.generation.promptPrefixes.byType["System Check"] = String($(this).val() || "");
            saveSettings();
        })
        .off("input.uiePromptPhoneCall change.uiePromptPhoneCall")
        .on("input.uiePromptPhoneCall change.uiePromptPhoneCall", "#uie-gen-prompt-phonecall", function () {
            const s = getSettings();
            if (!s.generation || typeof s.generation !== "object") s.generation = {};
            if (!s.generation.promptPrefixes || typeof s.generation.promptPrefixes !== "object") s.generation.promptPrefixes = { byType: {} };
            if (!s.generation.promptPrefixes.byType || typeof s.generation.promptPrefixes.byType !== "object") s.generation.promptPrefixes.byType = {};
            s.generation.promptPrefixes.byType["Phone Call"] = String($(this).val() || "");
            saveSettings();
        })
        .off("input.uiePromptImage change.uiePromptImage")
        .on("input.uiePromptImage change.uiePromptImage", "#uie-gen-prompt-image", function () {
            const s = getSettings();
            if (!s.generation || typeof s.generation !== "object") s.generation = {};
            if (!s.generation.promptPrefixes || typeof s.generation.promptPrefixes !== "object") s.generation.promptPrefixes = { byType: {} };
            if (!s.generation.promptPrefixes.byType || typeof s.generation.promptPrefixes.byType !== "object") s.generation.promptPrefixes.byType = {};
            s.generation.promptPrefixes.byType["Image Gen"] = String($(this).val() || "");
            saveSettings();
        });

    const menuVisibilitySelector = Object.keys(getMenuVisibilityMap()).map((id) => `#${id}`).join(", ");
    const popupToggleSelector = Object.keys(popupCategoryById).map((id) => `#${id}`).join(", ");
    let styleCssWriteTimer = 0;

    $(document)
        .off("change.uieMenuVisibilitySave")
        .on("change.uieMenuVisibilitySave", menuVisibilitySelector, function (e) {
            try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
            const id = String(this?.id || "");
            const key = getMenuVisibilityMap()[id];
            if (!key) return;
            const s = getSettings();
            if (!s.menuHidden || typeof s.menuHidden !== "object") s.menuHidden = {};
            s.menuHidden[key] = $(this).prop("checked") === true;
            saveSettings();
            try { applyMenuHiddenToButtons(); } catch (_) {}
            try { syncMenuVisibilityCheckboxes(); } catch (_) {}
        })
        .off("change.uieMemAutoSave")
        .on("change.uieMemAutoSave", "#uie-mem-auto", function (e) {
            try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
            const s = getSettings();
            const mem = ensureMemSettings(s);
            mem.auto = $(this).prop("checked") === true;
            saveSettings();
        })
        .off("change.uieLangSelect")
        .on("change.uieLangSelect", "#uie-sw-lang-select", async function (e) {
            try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
            const lang = String($(this).val() || "auto").trim() || "auto";
            try {
                const i18n = await import("./i18n.js");
                if (typeof i18n?.setLang === "function") i18n.setLang(lang);
                i18n?.applyI18n?.(document);
            } catch (_) {
                const s = getSettings();
                if (!s.ui || typeof s.ui !== "object") s.ui = {};
                s.ui.lang = lang;
                saveSettings();
            }
        })
        .off("change.uieRpgToggles")
        .on("change.uieRpgToggles", "#uie-rpg-enable, #uie-rpg-xpbar, #uie-rpg-equipment, #uie-rpg-skills, #uie-rpg-party, #uie-check-permadeath", function (e) {
            try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
            const id = String(this?.id || "");
            const on = $(this).prop("checked") === true;
            const s = getSettings();
            const rpg = ensureRpgToggleSettings(s);
            if (id === "uie-rpg-enable") rpg.enabled = on;
            if (id === "uie-rpg-xpbar") rpg.xpbar = on;
            if (id === "uie-rpg-equipment") rpg.equipment = on;
            if (id === "uie-rpg-skills") rpg.skills = on;
            if (id === "uie-rpg-party") rpg.party = on;
            if (id === "uie-check-permadeath") rpg.permadeath = on;
            saveSettings();
        })
        .off("change.uiePopupToggles")
        .on("change.uiePopupToggles", popupToggleSelector, function (e) {
            try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
            const id = String(this?.id || "");
            const key = popupCategoryById[id];
            if (!key) return;
            const on = $(this).prop("checked") === true;
            const s = getSettings();
            const n = ensureNotificationsSettings(s);
            if (key === "lowHp") n.lowHp.enabled = on;
            else n.categories[key] = on;
            saveSettings();
        })
        .off("change.uiePostBattleGenerate")
        .on("change.uiePostBattleGenerate", "#uie-postbattle-generate", function (e) {
            try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
            const s = getSettings();
            const n = ensureNotificationsSettings(s);
            n.postBattle.enabled = $(this).prop("checked") === true;
            saveSettings();
        })
        .off("input.uieLowHpThreshold change.uieLowHpThreshold")
        .on("input.uieLowHpThreshold change.uieLowHpThreshold", "#uie-pop-lowhp-threshold", function (e) {
            try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
            const s = getSettings();
            const n = ensureNotificationsSettings(s);
            const raw = Number($(this).val());
            const threshold = Math.max(0.05, Math.min(0.9, Number.isFinite(raw) ? raw : 0.25));
            n.lowHp.threshold = Math.round(threshold * 100) / 100;
            $(this).val(String(n.lowHp.threshold));
            saveSettings();
        })
        .off("change.uiePopupCssScope")
        .on("change.uiePopupCssScope", "#uie-popup-css-scope", function () {
            syncPopupCssEditorFromScope();
        })
        .off("click.uiePopupCssApply")
        .on("click.uiePopupCssApply", "#uie-popup-css-apply", function (e) {
            try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
            const s = getSettings();
            const scope = String($("#uie-popup-css-scope").val() || "global");
            const css = String($("#uie-popup-css-text").val() || "");
            setPopupCssForScope(s, scope, css);
            saveSettings();
            applyPopupCssFromSettings();
        })
        .off("click.uiePopupCssReset")
        .on("click.uiePopupCssReset", "#uie-popup-css-reset", function (e) {
            try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
            const s = getSettings();
            const scope = String($("#uie-popup-css-scope").val() || "global");
            setPopupCssForScope(s, scope, "");
            saveSettings();
            syncPopupCssEditorFromScope();
            applyPopupCssFromSettings();
        })
        .off("click.uiePopupCssTest")
        .on("click.uiePopupCssTest", "#uie-popup-test", function (e) {
            try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
            const scope = popupScopeToKey($("#uie-popup-css-scope").val() || "global");
            const category = scope === "global" ? "api" : scope;
            try { notify("info", "Popup style test", "UIE", category); } catch (_) {}
        })
        .off("click.uieCustomCssApply")
        .on("click.uieCustomCssApply", "#uie-custom-css-apply", function (e) {
            try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
            const s = getSettings();
            const ui = ensureUiCustomization(s);
            ui.css.global = String($("#uie-custom-css").val() || "");
            ui.css.stats = String($("#uie-custom-css-stats").val() || "");
            ui.css.activities = String($("#uie-custom-css-activities").val() || "");
            saveSettings();
            applyCustomCssFromSettings();
        })
        .off("change.uieCssTarget")
        .on("change.uieCssTarget", "#uie-css-target", function () {
            const s = getSettings();
            const ui = ensureUiCustomization(s);
            const target = String($(this).val() || "global");
            const cssByTarget = ui.css.byTarget && typeof ui.css.byTarget === "object" ? ui.css.byTarget : {};
            $("#uie-style-css").val(String(cssByTarget[target] || ""));
        })
        .off("input.uieStyleCss change.uieStyleCss")
        .on("input.uieStyleCss change.uieStyleCss", "#uie-style-css", function () {
            if (styleCssWriteTimer) clearTimeout(styleCssWriteTimer);
            styleCssWriteTimer = setTimeout(() => {
                const s = getSettings();
                const ui = ensureUiCustomization(s);
                const target = String($("#uie-css-target").val() || "global");
                const css = String($("#uie-style-css").val() || "");
                if (!ui.css.byTarget || typeof ui.css.byTarget !== "object") ui.css.byTarget = {};
                if (!css.trim()) delete ui.css.byTarget[target];
                else ui.css.byTarget[target] = css;
                saveSettings();
                applyCustomCssFromSettings();
            }, 180);
        })
        .off("change.uieBgTarget")
        .on("change.uieBgTarget", "#uie-bg-target", function () {
            const s = getSettings();
            const ui = ensureUiCustomization(s);
            const target = String($(this).val() || "menu");
            $("#uie-bg-url").val(String(ui.backgrounds?.[target] || ""));
        })
        .off("click.uieBgApply")
        .on("click.uieBgApply", "#uie-bg-apply", function (e) {
            try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
            const s = getSettings();
            const ui = ensureUiCustomization(s);
            const target = String($("#uie-bg-target").val() || "menu");
            const raw = String($("#uie-bg-url").val() || "").trim();
            if (raw) ui.backgrounds[target] = raw;
            else delete ui.backgrounds[target];
            saveSettings();
            applyBackgroundsFromSettings();
        })
        .off("click.uieBgClear")
        .on("click.uieBgClear", "#uie-bg-clear", function (e) {
            try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
            const s = getSettings();
            const ui = ensureUiCustomization(s);
            const target = String($("#uie-bg-target").val() || "menu");
            delete ui.backgrounds[target];
            $("#uie-bg-url").val("");
            saveSettings();
            applyBackgroundsFromSettings();
        })
        .off("click.uieBgPick")
        .on("click.uieBgPick", "#uie-bg-pick", function (e) {
            try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
            document.getElementById("uie-bg-file")?.click?.();
        })
        .off("change.uieBgFile")
        .on("change.uieBgFile", "#uie-bg-file", function () {
            const file = this.files && this.files[0];
            if (!file) return;
            const r = new FileReader();
            r.onload = () => {
                const dataUrl = String(r.result || "");
                if (!dataUrl) return;
                $("#uie-bg-url").val(dataUrl);
                $("#uie-bg-apply").trigger("click");
            };
            r.readAsDataURL(file);
            try { this.value = ""; } catch (_) {}
        })
        .off("click.uieLauncherSave")
        .on("click.uieLauncherSave", "#uie-launcher-save", function (e) {
            try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
            const s = getSettings();
            if (!s.launcher || typeof s.launcher !== "object") s.launcher = {};
            if (!Array.isArray(s.launcher.savedIcons)) s.launcher.savedIcons = [];
            const val = String($("#uie-launcher-icon").val() || "").trim();
            const src = val && val !== "custom" ? val : String(s.launcher.src || "").trim();
            if (!src) return;
            if (!s.launcher.savedIcons.includes(src)) s.launcher.savedIcons.unshift(src);
            saveSettings();
        })
        .off("click.uieLauncherDelete")
        .on("click.uieLauncherDelete", "#uie-launcher-delete", function (e) {
            try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
            const s = getSettings();
            if (!s.launcher || typeof s.launcher !== "object") s.launcher = {};
            if (!Array.isArray(s.launcher.savedIcons)) s.launcher.savedIcons = [];
            const val = String($("#uie-launcher-icon").val() || "").trim();
            const src = val && val !== "custom" ? val : String(s.launcher.src || "").trim();
            if (!src) return;
            s.launcher.savedIcons = s.launcher.savedIcons.filter((x) => String(x || "") !== src);
            saveSettings();
        })
        .off("click.uiePromptsClear")
        .on("click.uiePromptsClear", "#uie-gen-prompts-clear", function (e) {
            try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
            const s = getSettings();
            if (!s.generation || typeof s.generation !== "object") s.generation = {};
            s.generation.promptPrefixes = { byType: {} };
            saveSettings();
            $("#uie-gen-prompt-global, #uie-gen-prompt-default, #uie-gen-prompt-webpage, #uie-gen-prompt-systemcheck, #uie-gen-prompt-phonecall, #uie-gen-prompt-image").val("");
        });

    // Save State
    $(document).off("click.uieStateSave").on("click.uieStateSave", ".uie-state-save-btn", function(e) {
        e.preventDefault();
        e.stopPropagation();
        const name = $(".uie-state-name").val() || "Manual Save " + new Date().toLocaleString();

        const s = getSettings();
        if (!s.savedStates) s.savedStates = {};

        // Deep clone current state
        const state = JSON.parse(JSON.stringify(s));
        // Remove savedStates from the clone to prevent recursion
        delete state.savedStates;

        s.savedStates[name] = state;
        saveSettings();

        // Refresh dropdown
        refreshStateDropdown();

        // Notify
        try { window.toastr?.success?.(`State '${name}' saved!`, "UIE"); } catch (_) {}
    });

    // Load State - overwrites all UIE session data; never overwrites settings (launcher, ui, windows, generation, image, chats)
    const UIE_SETTINGS_KEYS = ["launcher", "ui", "uiScale", "windows", "generation", "image", "chats", "savedStates", "__uie_saved_at"];
    $(document).off("click.uieStateLoad").on("click.uieStateLoad", ".uie-state-load-btn", function(e) {
        e.preventDefault();
        e.stopPropagation();
        const name = $(".uie-state-select").val();
        if (!name) return;

        const s = getSettings();
        if (s.savedStates && s.savedStates[name]) {
            const loaded = s.savedStates[name];

            // Overwrite all keys except settings (never reset launcher, ui, windows, etc.)
            Object.keys(loaded).forEach(k => {
                if (UIE_SETTINGS_KEYS.indexOf(k) >= 0) return;
                s[k] = loaded[k];
            });

            saveSettings();

            // Reload UI
            try {
                updateLayout();
                import("./inventory.js").then(m => m.initInventory?.());
                import("./features/stats.js").then(m => m.initStats?.());
                import("./features/life.js").then(m => m.render?.());
                import("./features/items.js").then(m => m.render?.());
                import("./features/skills.js").then(m => m.init?.());
                import("./features/assets.js").then(m => m.init?.());
            } catch (_) {}

            try { window.toastr?.success?.(`State '${name}' loaded!`, "UIE"); } catch (_) {}
        }
    });

    // Delete State
    $(document).off("click.uieStateDel").on("click.uieStateDel", ".uie-state-del-btn", function(e) {
        e.preventDefault();
        e.stopPropagation();
        const name = $(".uie-state-select").val();
        if (!name) return;

        const s = getSettings();
        if (s.savedStates && s.savedStates[name]) {
            delete s.savedStates[name];
            saveSettings();
            refreshStateDropdown();
            try { window.toastr?.info?.(`State '${name}' deleted.`, "UIE"); } catch (_) {}
        }
    });

    function refreshStateDropdown() {
        const s = getSettings();
        const $sel = $(".uie-state-select");
        $sel.empty();
        $sel.append('<option value="">(Select Save...)</option>');

        if (s.savedStates) {
            Object.keys(s.savedStates).forEach(k => {
                $sel.append(`<option value="${k}">${k}</option>`);
            });
        }
    }

    // Expose for external refresh
    window.UIE_refreshStateSaves = refreshStateDropdown;

    try {
        window.removeEventListener("uie:state_updated", window.__uieStateUpdatedHandler);
    } catch (_) {}
    try {
        window.__uieStateUpdatedHandler = () => {
            try { refreshStateDropdown(); } catch (_) {}
        };
        window.addEventListener("uie:state_updated", window.__uieStateUpdatedHandler);
    } catch (_) {}

    // Initial refresh on open (handled by openWindow but also here for safety)
    // We'll hook into the tab click or window open

    $(document).off("input.uieScale change.uieScale").on("input.uieScale change.uieScale", "#uie-scale-slider", function(e) {
        e.preventDefault();
        e.stopPropagation();
        const val = parseFloat($(this).val());
        $("#uie-scale-display").text(val.toFixed(1));
        const s = getSettings();
        s.ui = s.ui || {};
        s.ui.scale = val;
        s.uiScale = val;
        saveSettings();

        // Update root variable - CSS handles the rest
        document.documentElement.style.setProperty("--uie-scale", val);

        // If the main menu is open on mobile, keep it visually in-sync.
        try {
            if (isMobileUI()) {
                const $menu = $("#uie-main-menu");
                if ($menu.length && $menu.is(":visible")) {
                    placeMenuCenteredScaled($menu, val);
                }
            }
        } catch (_) {}

        console.log("[UIE] Scale updated to:", val);
    });

    $(document).off("input.uieLauncherName change.uieLauncherName").on("input.uieLauncherName change.uieLauncherName", "#uie-launcher-name", function(e) {
        e.preventDefault();
        e.stopPropagation();
        const val = $(this).val();
        const s = getSettings();
        s.launcher = s.launcher || {};
        s.launcher.name = val;
        saveSettings();
    });

    $(document).off("change.uieLauncherIcon").on("change.uieLauncherIcon", "#uie-launcher-icon", function(e) {
        e.preventDefault();
        e.stopPropagation();
        const val = $(this).val();
        if (val === "custom") {
             $("#uie-launcher-file").click();
             return;
        }
        const s = getSettings();
        s.launcher = s.launcher || {};
        s.launcher.src = val;
        saveSettings();

        // Update live preview
        const btn = document.getElementById("uie-launcher");
        if (btn) {
            let imgDiv = btn.querySelector(".uie-launcher-img");
            if (imgDiv) imgDiv.style.backgroundImage = `url('${val}')`;
        }
    });

    $(document).off("change.uieLauncherFile").on("change.uieLauncherFile", "#uie-launcher-file", function(e) {
        const file = this.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function(evt) {
            const res = evt.target.result;
            const s = getSettings();
            s.launcher = s.launcher || {};
            s.launcher.src = res;
            saveSettings();

            // Update live preview
            const btn = document.getElementById("uie-launcher");
            if (btn) {
                let imgDiv = btn.querySelector(".uie-launcher-img");
                if (imgDiv) imgDiv.style.backgroundImage = `url('${res}')`;
            }

            // Update select to show custom is active (visual only)
            const sel = document.getElementById("uie-launcher-icon");
            if(sel) sel.value = "custom";
        };
        reader.readAsDataURL(file);
    });

    // Menu Buttons - Delegate
    // We can add the specific open handlers here or let the specific modules handle them.
    // Ideally, specific modules should bind their buttons.
    // But basic "Close" or similar?
}

export function initScavenge() {
    // Scavenge logic initialized
    // Button injection removed as per user request ("remove quick buttons")
}

export function spawnScavengeNodes() {
    let bg = document.getElementById("re-bg");
    if (!bg) {
        // Fallback to body if re-bg (Reality Engine) is not present
        bg = document.body;
    }

    // Clear existing
    document.querySelectorAll(".div-sparkle").forEach(e => e.remove());

    const count = 3 + Math.floor(Math.random() * 3); // 3-5 nodes
    for (let i = 0; i < count; i++) {
        const sparkle = document.createElement("div");
        sparkle.className = "div-sparkle";

        // Random Position
        const top = 20 + Math.random() * 60; // Keep somewhat central
        const left = 10 + Math.random() * 80;

        sparkle.style.cssText = `
            position: fixed;
            top: ${top}%;
            left: ${left}%;
            width: 30px;
            height: 30px;
            background: radial-gradient(circle, #ffd700 0%, transparent 70%);
            border-radius: 50%;
            cursor: pointer;
            z-index: 2147483661;
            animation: pulse-gold 1.5s infinite;
        `;

        sparkle.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            sparkle.remove();

            // Ding Sound
            const audio = new Audio("/scripts/extensions/third-party/universal-immersion-engine-main/assets/audio/ding.mp3");
            audio.volume = 0.5;
            audio.play().catch(()=>{});

            // Loot Logic
            handleLoot();
        };

        bg.appendChild(sparkle);
    }


    // Inject animation style if not exists
    if (!document.getElementById("re-sparkle-style")) {
        const style = document.createElement("style");
        style.id = "re-sparkle-style";
        style.textContent = `
            @keyframes pulse-gold {
                0% { transform: scale(0.8); opacity: 0.6; box-shadow: 0 0 5px #ffd700; }
                50% { transform: scale(1.2); opacity: 1; box-shadow: 0 0 15px #ffd700; }
                100% { transform: scale(0.8); opacity: 0.6; box-shadow: 0 0 5px #ffd700; }
            }
        `;
        document.head.appendChild(style);
    }

    // Smart Context Notification
    const s = getSettings();
    const loc = s.worldState?.location || "Unknown";
    notify("info", `Searching ${loc}...`, "Scavenge");

    setTimeout(() => {
        document.querySelectorAll(".div-sparkle").forEach(e => e.remove());
    }, 8000);
}

async function handleLoot() {
    const s = getSettings();
    const loc = s.worldState?.location || "Unknown Place";

    let item = "Strange Pebble";

    try {
        // Dynamic Story-Based Loot
        const { generateContent } = await import("./apiClient.js");
        const prompt = `Location: ${loc}.
The user searches the area. Generate ONE small, tangible item name that fits this specific story location.
Examples: "Rusty Key", "Cyberdeck Chip", "Dragon Scale", "Metro Ticket".
Return ONLY the item name. No punctuation.`;

        const res = await generateContent(prompt, "Loot");
        if (res) {
            item = res.replace(/["\.]/g, "").trim();
            // Safety cap length
            if (item.length > 30) item = item.substring(0, 30);
        }
    } catch (e) {
        console.warn("Loot Gen Failed", e);
        // Fallback logic
        const isLifeSim = s.rpg?.mode === "life_sim";
        const items = isLifeSim
            ? ["Lost Coin", "Grocery Coupon", "Shiny Marble", "Wild Flower", "Old Ticket", "Cool Rock", "Pen", "Lighter"]
            : ["Old Coin", "Strange Pebble", "Rusty Key", "Medicinal Herb", "Scrap Metal", "Gemstone", "Lost Note", "Small Potion"];
        item = items[Math.floor(Math.random() * items.length)];
    }

    // Add to Inventory
    if (!s.inventory) s.inventory = {};
    if (!s.inventory.items) s.inventory.items = [];
    addInventoryItemWithStack(s.inventory.items, {
        kind: "item",
        name: item,
        qty: 1,
        type: "Material",
        description: "Found while scavenging.",
        rarity: "common",
    }, { source: "interaction_loot" });

    saveSettings();

    notify("success", `Found: ${item}`, "Scavenge");
    injectRpEvent(`[System: You found a ${item}.]`);
}

export function initSpriteInteraction() {
    $("body").off("pointerup.reSprite");
    $("body").on("pointerup.reSprite", ".re-sprite", function (e) {
        e.preventDefault();
        e.stopPropagation();

        const el = this;
        const charName = el.getAttribute("alt") || "Character";

        spawnContextMenu(e.clientX, e.clientY, charName, [
            {
                label: "Look",
                icon: "fa-solid fa-eye",
                action: () => {
                    injectRpEvent(`[System: You look closely at ${charName}. Describe their appearance and demeanor.]`);
                    notify("info", `Looking at ${charName}`, "Interaction");
                }
            },
            {
                label: "Talk",
                icon: "fa-solid fa-comment",
                action: () => {
                    injectRpEvent(`[System: You approach ${charName} to speak.]`);
                }
            },
            {
                label: "Touch",
                icon: "fa-solid fa-hand",
                action: () => {
                    injectRpEvent(`[System: You reach out to touch ${charName}.]`);
                }
            },
            {
                label: "Inspect",
                icon: "fa-solid fa-magnifying-glass",
                action: () => {
                    injectRpEvent(`[System: You inspect ${charName} for any unusual details.]`);
                }
            }
        ]);
    });
}

export function initBackgroundInteraction() {
    // Context menu for the background (Look Around, Investigate, Relax)
    // Bind to body to catch clicks even if passing through pointer-events:none layers
    $("body").off("contextmenu.reBg").on("contextmenu.reBg", function(e) {
        // Exclude ST UI and our UI
        if ($(e.target).closest(".re-sprite, .re-btn, .re-qbtn, .uie-window, .mes, .drawer-content, #chat, textarea, input, button, a").length) return;

        // Only active if Reality Engine is enabled?
        // Or if we are just in the global scope? User wants interactivity.
        // Let's assume always active but maybe check if RE is enabled if we want to be strict.
        // For now, allow it as a general feature since it injects RP events.

        e.preventDefault();

        spawnContextMenu(e.clientX, e.clientY, "Area", [
            {
                label: "Look Around",
                icon: "fa-solid fa-eye",
                action: () => {
                    injectRpEvent(`[System: You look around the area. Describe the surroundings in detail.]`);
                    notify("info", "Observing surroundings...", "Interaction");
                }
            },
            {
                label: "Investigate",
                icon: "fa-solid fa-magnifying-glass",
                action: () => {
                    // Trigger scavenge
                    handleLoot();
                }
            },
            {
                label: "Relax",
                icon: "fa-solid fa-chair",
                action: () => {
                    injectRpEvent(`[System: You take a moment to relax and soak in the atmosphere.]`);
                }
            }
        ]);
    });
}

function spawnContextMenu(x, y, title, options) {
    // Remove existing
    $(".re-context-menu").remove();

    const menu = document.createElement("div");
    menu.className = "re-context-menu";
    menu.style.left = x + "px";
    menu.style.top = y + "px";

    const header = document.createElement("div");
    header.className = "re-ctx-header";
    header.textContent = title;
    menu.appendChild(header);

    options.forEach(opt => {
        const item = document.createElement("div");
        item.className = "re-ctx-item";
        item.innerHTML = `<i class="${opt.icon}"></i> ${opt.label}`;
        item.onclick = (e) => {
            e.stopPropagation();
            opt.action();
            menu.remove();
        };
        menu.appendChild(item);
    });

    document.body.appendChild(menu);

    // Close on click outside
    setTimeout(() => {
        $(document).one("click.reCtx", () => menu.remove());
    }, 10);

    // Bounds check
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) menu.style.left = (window.innerWidth - rect.width - 10) + "px";
    if (rect.bottom > window.innerHeight) menu.style.top = (window.innerHeight - rect.height - 10) + "px";
}


