
import { getSettings, saveSettings, updateLayout, isMobileUI } from "./core.js";
import { injectRpEvent } from "./features/rp_log.js";
import { notify } from "./notifications.js";

// --- SCAVENGE & INTERACTION MODULE ---

export function initInteractions() {
    initScavenge();
    initSpriteInteraction();
    initLauncher();
    initMobileBackNav();
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

function initLauncher() {
    const btn = document.getElementById("uie-launcher");
    if (!btn) return;

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

            const sel = document.getElementById("uie-launcher-opt-icon");
            if (sel) {
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
        clearLp();
        lpT = setTimeout(() => {
            lpT = 0;
            openLauncherOptions();
        }, 520);
    }, { passive: true });
    btn.addEventListener("pointerup", clearLp, { passive: true });
    btn.addEventListener("pointercancel", clearLp, { passive: true });
    btn.addEventListener("pointermove", clearLp, { passive: true });

    // Block Mousedown/Pointerdown propagation to prevent ST from hijacking the drag
    // But allow default so dragging.js can handle it (dragging.js attaches directly)
    $(btn).off("mousedown.uieLauncher pointerdown.uieLauncher").on("mousedown.uieLauncher pointerdown.uieLauncher", function(e) {
        e.stopPropagation();
        e.stopImmediatePropagation();
    });

    // Remove old listener if any
    $(btn).off("click.uieLauncher").on("click.uieLauncher", function(e) {
        // dragging.js handles capture phase stopImmediatePropagation if dragged
        // If we get here, it's a click
        e.preventDefault();
        e.stopPropagation();

        const menu = $("#uie-main-menu");
        if (!menu.length) return;

        if (menu.is(":visible")) {
            menu.hide();
        } else {
            menu.show();
            // Ensure proper Z-index
            menu.css("z-index", "2147483650");

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
                const sx = (s.menuX === null || s.menuX === undefined) ? NaN : Number(s.menuX);
                const sy = (s.menuY === null || s.menuY === undefined) ? NaN : Number(s.menuY);
                if (Number.isFinite(sx) && Number.isFinite(sy)) {
                    const rect = menu.get(0)?.getBoundingClientRect?.();
                    const w = rect?.width || menu.outerWidth() || 320;
                    const h = rect?.height || menu.outerHeight() || 420;
                    const pos = clampToViewportPx(sx, sy, w, h, 8);
                    menu.css({ left: `${pos.x}px`, top: `${pos.y}px`, right: "auto", bottom: "auto", transform: "none", position: "fixed" });
                } else {
                    placeCenteredClamped(menu);
                }
                try { updateLayout(); } catch (_) {}
                return;
            }

            // Force position next to launcher (User Request)
            const launcher = document.getElementById("uie-launcher");
            if (launcher && launcher.getBoundingClientRect().height > 0) {
                const rect = launcher.getBoundingClientRect();
                // Dimensions
                let mw = menu.outerWidth() || 300;
                let mh = menu.outerHeight() || 400;
                const margin = 10;
                const vw = window.innerWidth;
                const vh = window.innerHeight;

                // Prefer opening BESIDE the launcher (User Request)
                // Try right side first, then left side.
                let left = rect.right + margin;
                if (left + mw > vw - margin) left = rect.left - mw - margin;
                let top = rect.top;

                // Strict Clamping to Viewport
                if (left < margin) left = margin;
                if (left + mw > vw - margin) left = vw - mw - margin;
                
                if (top < margin) top = margin;
                if (top + mh > vh - margin) top = vh - mh - margin;

                menu.css({
                    top: top + "px",
                    left: left + "px",
                    bottom: "auto",
                    right: "auto",
                    transform: "none",
                    position: "fixed"
                });
            } else {
                // Fallback to center
                 menu.css({ top: "50%", left: "50%", transform: "translate(-50%, -50%)", bottom: "auto", right: "auto" });
            }
        }
    });

    // Also init Menu Tabs here since it's menu related?
    // Or maybe separate initMenu()? For now, let's stick to launcher.
    initMenuTabs();
    initMenuButtons();
    initGenericHandlers();
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

    $("body").off("change.uieLauncherOptIcon").on("change.uieLauncherOptIcon", "#uie-launcher-opt-icon", function (e) {
        e.preventDefault();
        e.stopPropagation();
        const val = String($(this).val() || "");
        if (val === "custom") {
            document.getElementById("uie-launcher-opt-file")?.click();
            return;
        }
        const s = getSettings();
        if (!s.launcher) s.launcher = {};
        s.launcher.src = val;
        saveSettings();
        updateLayout();
        syncIcon(val);
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

    $("body").off("click.uieLauncherOptOpenSettings").on("click.uieLauncherOptOpenSettings", "#uie-launcher-opt-open-settings", function (e) {
        e.preventDefault();
        e.stopPropagation();
        const w = $("#uie-settings-window");
        if (w.length) {
            w.show().css("display", "flex");
            w.css("z-index", "2147483653");
            placeCenteredClamped(w);
        }
    });
}

function initGenericHandlers() {
    // Generic Close Button for any UIE Window
    // Added pointerup for better responsiveness
    // COMPREHENSIVE LIST OF CLOSE BUTTONS
    const selectors = [
        ".uie-close-btn", ".uie-inv-close", ".uie-window-close", ".uie-p-close",
        "#uie-world-close", "#re-forge-close",
        "#uie-party-close", "#uie-party-member-close",
        "#cal-modal-close", "#cal-rp-modal-close", ".uie-sim-close",
        "#uie-social-close", "#books-reader-close", "#uie-phone-sticker-close",
        "#uie-sprites-close", "#uie-map-card-close", ".uie-sticker-close",
        "#uie-chatbox-close", "#uie-chatbox-options-close",
        ".uie-rpg-close", ".uie-create-close", "#uie-inv-editor-close", "#uie-fx-close",
        "#life-create-close", "#life-edit-close", "#life-template-close",
        "#uie-k-pick-close", "#uie-item-modal-close", "#uie-battle-close",
        "#uie-launcher-opt-close",
        "#uie-create-overlay-exit", "#uie-kitchen-exit", "#life-create-cancel",
        "#uie-diary-close", "#uie-databank-close", "#uie-journal-close"
    ].join(", ");

    let lastPointerTime = 0;
    // SCOPED FIX: Use body instead of document to catch events before they hit the document-level blocker
    $("body").off("click.uieGenericClose pointerup.uieGenericClose", selectors).on("click.uieGenericClose pointerup.uieGenericClose", selectors, function(e) {
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

    // Mobile: always center newly opened windows (prevents "stuck at top")
    const mobileNow = (() => {
        try {
            if (isMobileUI()) return true;
            const touch = (typeof navigator !== "undefined" && (Number(navigator.maxTouchPoints || 0) > 0 || Number(navigator.msMaxTouchPoints || 0) > 0)) || (typeof window !== "undefined" && ("ontouchstart" in window));
            const minDim = Math.min(Number(window.innerWidth || 0), Number(window.innerHeight || 0));
            return touch && minDim > 0 && minDim <= 820;
        } catch (_) {
            return isMobileUI();
        }
    })();
    if (mobileNow) {
        if (String(win.attr("id") || "") !== "uie-party-window") {
            placeCenteredClamped(win);
        }
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
        try { (await import("./party.js")).initParty?.(); } catch (_) {}
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
        try { (await import("./battle.js")).initBattle?.(); } catch (_) {}
    });

    // Settings
    $menu.off("click.uieMenuSettings").on("click.uieMenuSettings", "#uie-btn-open-settings", function() {
        openWindow("#uie-settings-window");
    });

    // Debug
    $menu.off("click.uieMenuDebug").on("click.uieMenuDebug", "#uie-btn-debug", async function() {
        openWindow("#uie-debug-window");
        try { (await import("./diagnostics.js")).initDiagnostics?.(); } catch (_) {}
    });

    // Help
    $menu.off("click.uieMenuHelp").on("click.uieMenuHelp", "#uie-btn-help", function() {
        window.open("https://github.com/SillyTavern/SillyTavern/blob/release/public/scripts/extensions/third-party/universal-immersion-engine-main/README.md", "_blank");
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
}

function initMenuTabs() {
    const $menu = $("#uie-main-menu");
    let lastPointerTime = 0;
    $menu.off("click.uieMenuTabs pointerup.uieMenuTabs").on("click.uieMenuTabs pointerup.uieMenuTabs", ".uie-menu-tab", function(e) {
        // De-dupe pointerup vs click on mobile
        if (e?.type === "pointerup") {
            lastPointerTime = Date.now();
        } else if (e?.type === "click" && Date.now() - lastPointerTime < 300) {
            try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
            return;
        }

        try { e.preventDefault(); e.stopPropagation(); } catch (_) {}

        const tab = $(this).data("tab");
        const target = $("#uie-tab-" + tab);
        if (!target.length) return;

        $(".uie-menu-tab").removeClass("active").css({ "border-bottom-color": "transparent", "color": "#888" });
        $(this).addClass("active").css({ "border-bottom-color": "#f1c40f", "color": "#fff" });

        $(".uie-menu-page").hide();
        target.show();
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

    const existing = s.inventory.items.find(x => x.name === item);
    if (existing) existing.qty = (existing.qty || 1) + 1;
    else s.inventory.items.push({ name: item, qty: 1, type: "Material" });

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
