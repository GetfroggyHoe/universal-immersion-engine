import { getSettings, saveSettings, isMobileUI, updateLayout } from "./core.js";

let launcherState = { active: false, startX: 0, startY: 0, startTime: 0, moved: false };
let windowState = { pending: false, active: false, target: null, startX: 0, startY: 0, ox: 0, oy: 0, prevOrigin: "", prevTransform: "" };
let touchBlocker = false;
let launcherMouse = { active: false, ox: 0, oy: 0, moved: false, movedAt: 0 };
let launcherSaveT = 0;

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const clampToViewport = (left, top, w, h, pad = 0) => {
    const vw = window.innerWidth || document.documentElement.clientWidth || 0;
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    // Keep at least some of the window visible even if it is larger than the viewport.
    const minVisible = 40;
    const minX = Math.min(pad, vw - minVisible);
    const maxX = Math.max(pad, vw - minVisible);
    const minY = Math.min(pad, vh - minVisible);
    const maxY = Math.max(pad, vh - minVisible);
    const x = clamp(left, -Math.max(0, w - minVisible), maxX);
    const y = clamp(top, -Math.max(0, h - minVisible), maxY);
    return { x, y };
};

export function initDragging() {
    if (window.uie_drag_controller) window.uie_drag_controller.abort();
    window.uie_drag_controller = new AbortController();
    const signal = window.uie_drag_controller.signal;

    const markHandled = (e) => {
        try {
            if (e && e.__uieDragHandled) return false;
            if (e) e.__uieDragHandled = true;
        } catch (_) {}
        return true;
    };

    const dragLog = (stage, data) => {
        try {
            const payload = { stage, t: Date.now(), ...(data || {}) };
            window.UIE_lastDrag = payload;
            if (window.UIE_DRAG_DEBUG === true) {
                console.log("[UIE][drag]", payload);
            }
        } catch (_) {}
    };

    const launcher = document.getElementById("uie-launcher");
    if (launcher) {
        launcher.style.touchAction = "none";

        launcher.addEventListener("touchstart", (e) => {
            const touch = e.touches[0];
            launcherState = { active: true, startX: touch.clientX, startY: touch.clientY, startTime: Date.now(), moved: false };
        }, { passive: true, signal });

        launcher.addEventListener("touchmove", (e) => {
            if (!launcherState.active) return;
            const touch = e.touches[0];
            if (Math.abs(touch.clientX - launcherState.startX) > 10 || Math.abs(touch.clientY - launcherState.startY) > 10) {
                launcherState.moved = true;
                if (e.cancelable) e.preventDefault();
                const vw = window.innerWidth;
                const vh = window.innerHeight;
                const r = launcher.getBoundingClientRect();
                const w = r.width || launcher.offsetWidth || 60;
                const h = r.height || launcher.offsetHeight || 60;
                let left = touch.clientX - (w / 2);
                let top = touch.clientY - (h / 2);
                const pos = clampToViewport(left, top, w, h, 0);
                left = pos.x;
                top = pos.y;
                launcher.style.left = `${left}px`;
                launcher.style.top = `${top}px`;

                const s = getSettings();
                s.launcherX = left;
                s.launcherY = top;
                if (launcherSaveT) clearTimeout(launcherSaveT);
                launcherSaveT = setTimeout(() => {
                    try { saveSettings(); } catch (_) {}
                }, 180);
            }
        }, { passive: false, signal });

        launcher.addEventListener("touchend", (e) => {
            if (!launcherState.active) return;
            launcherState.active = false;

            if (launcherState.moved) {
                const s = getSettings();
                s.launcherX = parseFloat(launcher.style.left) || 0;
                s.launcherY = parseFloat(launcher.style.top) || 0;
                saveSettings();
                touchBlocker = true;
                setTimeout(() => { touchBlocker = false; }, 450);
            }
        }, { signal });

        launcher.addEventListener("click", (e) => {
            if (touchBlocker) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                return;
            }
            if (launcherMouse.moved && Date.now() - launcherMouse.movedAt < 320) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
            }
        }, { capture: true, signal });

        launcher.addEventListener("mousedown", (e) => {
            if (typeof e.button === "number" && e.button !== 0) return;
            if (touchBlocker) return;
            const rect = launcher.getBoundingClientRect();
            launcherMouse = { active: true, ox: e.clientX - rect.left, oy: e.clientY - rect.top, moved: false, movedAt: 0 };
            e.preventDefault();
        }, { signal });

        document.addEventListener("mousemove", (e) => {
            if (!launcherMouse.active) return;
            if (typeof e.buttons === "number" && e.buttons !== 1) {
                launcherMouse.active = false;
                return;
            }
            const vw = window.innerWidth;
            const vh = window.innerHeight;
            const r = launcher.getBoundingClientRect();
            const w = r.width || launcher.offsetWidth || 60;
            const h = r.height || launcher.offsetHeight || 60;
            let left = e.clientX - launcherMouse.ox;
            let top = e.clientY - launcherMouse.oy;
            left = Math.max(0, Math.min(left, vw - w));
            top = Math.max(0, Math.min(top, vh - h));
            launcher.style.left = `${left}px`;
            launcher.style.top = `${top}px`;
            launcherMouse.moved = true;
            launcherMouse.movedAt = Date.now();
            e.preventDefault();
        }, { signal });

        document.addEventListener("mouseup", () => {
            if (!launcherMouse.active) return;
            launcherMouse.active = false;
            if (!launcherMouse.moved) return;
            const s = getSettings();
            s.launcherX = parseFloat(launcher.style.left) || 0;
            s.launcherY = parseFloat(launcher.style.top) || 0;
            saveSettings();
        }, { signal });
    }

    // Ensure drag handles are not treated as scroll gestures on mobile browsers.
    // This prevents the page from hijacking the drag and making windows feel "stuck".
    try {
        const dragSel = [
            "#uie-menu-drag",
            ".uie-header",
            ".uie-diary-header",
            ".phone-status-bar",
            ".uie-p-header",
            ".uie-party-member-header",
            ".uie-rpg-header",
            ".uie-sim-header",
            "#uie-inv-drag"
        ].join(", ");
        document.querySelectorAll(dragSel).forEach((el) => {
            try {
                el.style.touchAction = "none";
                el.style.userSelect = "none";
                el.style.webkitUserSelect = "none";
            } catch (_) {}
        });
    } catch (_) {}

    const onWinStart = (e) => {
        if (launcherState.active) return;
        if (e.type === "mousedown" && typeof e.button === "number" && e.button !== 0) return;
        const t = $(e.target);

        const inStatsHeader = t.closest(".uie-rpg-header").length > 0;
        const inActivitiesHeader = t.closest(".uie-sim-header").length > 0;
        const inGenericHeader = t.closest(".uie-header, .uie-diary-header, .phone-status-bar, .uie-p-header, .uie-party-member-header").length > 0;
        const inDragHeader = inStatsHeader || inActivitiesHeader || inGenericHeader;
        const inHeaderButton = t.closest("button, .uie-rpg-close, .uie-sim-close, .uie-close-btn").length > 0;
        const inAnyWindow = t.closest(".uie-window").length > 0;
        const inPhoneWindow = t.closest("#uie-phone-window").length > 0;
        const inMainMenu = t.closest("#uie-main-menu").length > 0;
        const inMenuDrag = t.closest("#uie-menu-drag").length > 0;
        const inMenuContent = t.closest("#uie-menu-content").length > 0;
        const inMenuTabs = t.closest(".uie-menu-tabs").length > 0;
        const mobile = isMobileUI();
        const allowDragStart = inMenuDrag || inDragHeader || (mobile && inMainMenu && !inMenuContent && !inMenuTabs);

        dragLog("start", {
            type: String(e?.type || ""),
            target: String(t?.[0]?.id || t?.[0]?.className || ""),
            allowDragStart,
            inMenuDrag,
            inDragHeader
        });

        // CRITICAL: Always allow interactive elements to receive clicks
        if (!inMenuDrag && (t.is("button") || 
            t.is("i") && t.closest("button").length ||
            t.closest("button").length ||
            t.closest(".uie-close-btn, .uie-rpg-close, .uie-sim-close, .uie-inv-close, #uie-phone-close, #uie-settings-close, #uie-party-member-close, #uie-party-member-bg-edit, .phone-back-btn, .uie-controls, .uie-dropdown, .uie-dd-item, .uie-menu-tab, .uie-inv-icon, .fa-wand-magic-sparkles, [id*='sparkle'], #uie-activity-sparkle, input, select, textarea, option, optgroup, a, label, .tab, .uie-tab, .uie-set-tab, .uie-settings-tab, [onclick], [role='button'], .uie-btn-accept, .uie-btn-deny, .uie-btn-complete, .uie-btn-fail, .uie-codex-add, .uie-codex-edit, .uie-codex-del, #re-st-menu, #re-q-menu, #uie-journal-menu, .menu, .popup, .dropdown-menu, .range-slider, .checkbox, .radio, .toggle, .re-qbtn, .re-menu-item, .re-forge-btn, .vn-dialogue-box, .re-bar, .re-hud-btn, .uie-social-card, .uie-p-close, .uie-inv-tabs, .uie-journal-sidebar, .uie-journal-list, #uie-world-content, .no-drag, .clickable, .re-actbtn, #re-action-grid, #re-composer, .re-obj, #re-phone, #re-journal, #re-ui button, #re-ui input, #re-ui textarea, #uie-stats-window .uie-rpg-close, #uie-activities-window .uie-sim-close").length)) {
            return;
        }

        // If the user is grabbing a real drag handle, prevent the browser from treating it as scroll.
        // IMPORTANT: Do this only after we have ruled out interactive elements, otherwise touch/pointer clicks get canceled.
        if (allowDragStart && e.cancelable) {
            try { e.preventDefault(); } catch (_) {}
        }

        // Allow dragging when clicking the stats/activities header background.
        if (!inDragHeader || inHeaderButton) {
            if (!allowDragStart) return;
        }

        // Global Z-Index Safety Check: If clicking something with high z-index (likely popup), don't drag
        try {
            const z = window.getComputedStyle(e.target).zIndex;
            // Exception for UIE Main Menu which has very high z-index
            const isMenu = t.closest("#uie-main-menu").length > 0;
            if (!isMenu && z && z !== "auto" && Number(z) > 20050) return;
        } catch (_) {}

        // Heuristic: If it looks clickable (pointer cursor), don't drag
        // Skip this heuristic for stats/activities headers (they are drag handles)
            if (!inDragHeader && !allowDragStart) {
            try {
                const cursor = window.getComputedStyle(e.target).cursor;
                if (cursor === "pointer" || cursor === "text") return;
            } catch (_) {}
        }

        if (t.closest("#uie-inv-drag").length && t.closest(".uie-inv-actions, .uie-inv-currency, #uie-inv-pencil-menu, #uie-inv-sparkle-menu").length) {
            return;
        }

        let target = null;
        
        // Mobile: only drag from explicit handles (menu drag bar or headers)
        if (mobile) {
            if (inMenuDrag || (inMainMenu && !inMenuContent)) target = $("#uie-main-menu");
            else if (t.closest(".uie-diary-header").length) target = $("#uie-diary-window");
            else if (t.closest("#uie-inv-drag").length) target = $("#uie-inventory-window");
            else if (t.closest(".phone-status-bar").length) target = $("#uie-phone-window");
            else if (t.closest(".uie-p-header").length) target = $("#uie-social-overlay .uie-paper-box");
            else if (t.closest(".uie-party-member-header").length) target = $("#uie-party-member-card");
            else if (t.closest(".uie-rpg-header").length) target = $("#uie-stats-window");
            else if (t.closest(".uie-sim-header").length) target = $("#uie-activities-window");
            else if (t.closest(".uie-header").length) target = t.closest(".uie-window");
        } else {
            // Desktop: only drag from headers
            if (t.closest(".uie-diary-header").length) target = $("#uie-diary-window");
            else if (t.closest("#uie-inv-drag").length) target = $("#uie-inventory-window");
            else if (t.closest("#uie-menu-drag").length) target = $("#uie-main-menu");
            else if (t.closest(".phone-status-bar").length) target = $("#uie-phone-window");
            else if (t.closest(".uie-p-header").length) target = $("#uie-social-overlay .uie-paper-box");
            else if (t.closest(".uie-party-member-header").length) target = $("#uie-party-member-card");
            else if (t.closest(".uie-rpg-header").length) target = $("#uie-stats-window");
            else if (t.closest(".uie-sim-header").length) target = $("#uie-activities-window");
            else if (t.closest(".uie-header").length) target = t.closest(".uie-window");
        }

        if (!target || !target.length) return;
        if (mobile && (target.attr("id") || "") === "uie-inventory-window") return;
        if (mobile && t.closest(".uie-party-member-header").length) return;

        const pos = e.touches ? e.touches[0] : e;
        try { window.UIE_isDragging = true; } catch (_) {}
        windowState = {
            pending: true,
            active: true,
            target,
            startX: pos.clientX,
            startY: pos.clientY,
            ox: 0,
            oy: 0,
            prevOrigin: target.css("transform-origin"),
            prevTransform: target.css("transform")
        };

        dragLog("target", { id: String(target.attr("id") || ""), startX: pos.clientX, startY: pos.clientY });
    };

    const onWinMove = (e) => {
        if (!windowState.active || !windowState.target) return;
        if (e.type === "mousemove" && typeof e.buttons === "number" && e.buttons !== 1) {
            windowState.active = false;
            windowState.target = null;
            return;
        }
        const pos = e.touches ? e.touches[0] : e;
        if (windowState.pending) {
            const dx = Math.abs(pos.clientX - windowState.startX);
            const dy = Math.abs(pos.clientY - windowState.startY);
            if (dx < 6 && dy < 6) return;
            windowState.pending = false;
            const rect = windowState.target[0].getBoundingClientRect();
            const winId = windowState.target.attr("id") || "";
            const isDesktop = window.innerWidth >= 768;
            const isFullScreenWindow = isDesktop && (winId === "uie-stats-window" || winId === "uie-activities-window");
            
            // For desktop full-screen windows, ensure we use pixel values from current position
            // Don't reset position if it's already correctly positioned
            const s = getSettings();
            const rawScale = Number(s?.ui?.scale ?? s?.uiScale ?? 1);
            const scale = Math.max(0.5, Math.min(1.5, Number.isFinite(rawScale) ? rawScale : 1));
            const useScale = (winId === "uie-main-menu") ? (scale !== 1) : (isMobileUI() && scale !== 1);
            if (isFullScreenWindow) {
                // Get current computed position
                const currentLeft = rect.left;
                const currentTop = rect.top;
                windowState.ox = pos.clientX - currentLeft;
                windowState.oy = pos.clientY - currentTop;
                // Set position in pixels (not viewport units) for dragging
                // Remove transform that was used for centering
                windowState.target.css({ 
                    left: `${currentLeft}px`, 
                    top: `${currentTop}px`, 
                    right: "auto",
                    bottom: "auto",
                    position: "fixed",
                    transformOrigin: "top left",
                    transform: useScale ? `scale(${scale})` : "none"
                });
            } else {
                windowState.ox = pos.clientX - rect.left;
                windowState.oy = pos.clientY - rect.top;
                windowState.target.css({ left: rect.left, top: rect.top, right: "auto", bottom: "auto", position: "fixed", transformOrigin: "top left" });
                windowState.target.css({ transform: useScale ? `scale(${scale})` : "none" });
            }
        }
        // Only prevent default if we're actually dragging (not just pending)
        if (!windowState.pending && e.cancelable) e.preventDefault();

        if (!windowState.pending) {
            try {
                const pos0 = e.touches ? e.touches[0] : e;
                dragLog("move", { x: Number(pos0?.clientX || 0), y: Number(pos0?.clientY || 0), id: String(windowState.target?.attr?.("id") || "") });
            } catch (_) {}
        }
        // Use pixel values for dragging + clamp to viewport
        const r = windowState.target[0].getBoundingClientRect();
        const w = r.width || windowState.target.outerWidth() || 320;
        const h = r.height || windowState.target.outerHeight() || 320;
        const rawLeft = pos.clientX - windowState.ox;
        const rawTop = pos.clientY - windowState.oy;
        const winId = windowState.target.attr("id") || "";
        const pad = winId === "uie-main-menu" ? 8 : 0;
        const clamped = clampToViewport(rawLeft, rawTop, w, h, pad);
        windowState.target.css({ left: `${clamped.x}px`, top: `${clamped.y}px`, right: "auto", bottom: "auto", position: "fixed" });
    };

    const onWinEnd = () => {
        if (windowState.active && windowState.target && windowState.target.length) {
            if (windowState.pending) {
                windowState.active = false;
                windowState.pending = false;
                windowState.target = null;
                return;
            }
            const rect = windowState.target[0].getBoundingClientRect();
            const s = getSettings();
            const id = windowState.target.attr("id") || "";
            const isDesktop = window.innerWidth >= 768;
            const isFullScreenWindow = isDesktop && (id === "uie-stats-window" || id === "uie-activities-window");

            const rawScale = Number(s?.ui?.scale ?? s?.uiScale ?? 1);
            const scale = Math.max(0.5, Math.min(1.5, Number.isFinite(rawScale) ? rawScale : 1));
            const useScale = (id === "uie-main-menu") ? (scale !== 1) : (isMobileUI() && scale !== 1);
            
            if (id === "uie-inventory-window") {
                s.posX = rect.left;
                s.posY = rect.top;
                saveSettings();
            }
            if (id === "uie-main-menu") {
                s.menuX = rect.left;
                s.menuY = rect.top;
                saveSettings();
            }
            if (id === "uie-phone-window") {
                if (!s.phone) s.phone = {};
                s.phone.windowPos = { x: rect.left, y: rect.top };
                saveSettings();
            }
            
            // For desktop full-screen windows, keep pixel values for dragging but allow CSS media queries to handle initial positioning
            // Only override if window was actually dragged (not just clicked)
            if (isFullScreenWindow) {
                // Save the dragged position but don't force it on next open - let CSS media query handle initial position
                // The inline style from dragging will persist until window is closed/reopened
                windowState.target.css({
                    left: `${rect.left}px`,
                    top: `${rect.top}px`,
                    right: "auto",
                    bottom: "auto",
                    position: "fixed",
                    transformOrigin: "top left",
                    transform: useScale ? `scale(${scale})` : "none"
                });
            } else {
                windowState.target.css({
                    left: `${rect.left}px`,
                    top: `${rect.top}px`,
                    right: "auto",
                    bottom: "auto",
                    position: "fixed",
                    transformOrigin: "top left",
                    transform: useScale ? `scale(${scale})` : "none"
                });
            }
            updateLayout();
        }
        try { dragLog("end", {}); } catch (_) {}
        try { window.UIE_isDragging = false; } catch (_) {}
        windowState.active = false;
        windowState.pending = false;
        windowState.target = null;
    };

    // Use capture phase but allow buttons to work
    document.addEventListener("mousedown", (e) => {
        if (!markHandled(e)) return;
        const t = $(e.target);
        // If clicking a button or icon inside button, don't interfere
        if (t.is("button") || t.is("i") && t.closest("button").length || t.closest("button").length) {
            return; // Let the button's onclick handler work
        }
        onWinStart(e);
    }, { capture: true, signal });
    document.addEventListener("mousemove", (e) => { if (!markHandled(e)) return; onWinMove(e); }, { signal });
    document.addEventListener("mouseup", (e) => { if (!markHandled(e)) return; onWinEnd(e); }, { signal });
    window.addEventListener("blur", onWinEnd, { signal });

    document.addEventListener("pointerdown", (e) => {
        if (!markHandled(e)) return;
        // Touch devices may only fire pointer events (no touchstart)
        try {
            if (String(e.pointerType || "") !== "touch") return;
        } catch (_) { return; }
        const t = $(e.target);
        // If clicking a button or icon inside button, don't interfere
        // Also check for close buttons specifically
        if (t.is("button") ||
            t.is("i") && t.closest("button").length ||
            t.closest("button").length ||
            t.closest(".uie-close-btn, .uie-rpg-close, .uie-sim-close").length) {
            return;
        }
        onWinStart(e);
    }, { capture: true, passive: false, signal });
    document.addEventListener("pointermove", (e) => { if (!markHandled(e)) return; onWinMove(e); }, { passive: false, signal });
    document.addEventListener("pointerup", (e) => { if (!markHandled(e)) return; onWinEnd(e); }, { signal });
    document.addEventListener("pointercancel", (e) => { if (!markHandled(e)) return; onWinEnd(e); }, { signal });

    document.addEventListener("touchstart", (e) => {
        if (!markHandled(e)) return;
        const t = $(e.target);
        // If clicking a button or icon inside button, don't interfere
        // Also check for close buttons specifically
        if (t.is("button") || 
            t.is("i") && t.closest("button").length || 
            t.closest("button").length ||
            t.closest(".uie-close-btn, .uie-rpg-close, .uie-sim-close").length) {
            return; // Let the button's onclick handler work
        }
        onWinStart(e);
    }, { capture: true, passive: false, signal });

    document.addEventListener("touchmove", (e) => { if (!markHandled(e)) return; onWinMove(e); }, { passive: false, signal });
    document.addEventListener("touchend", (e) => { if (!markHandled(e)) return; onWinEnd(e); }, { signal });

    // Some SillyTavern/mobile builds register capture listeners on document and stopImmediatePropagation.
    // window-capture runs before document-capture, so it cannot be blocked the same way.
    window.addEventListener("pointerdown", (e) => {
        if (!markHandled(e)) return;
        try {
            if (String(e.pointerType || "") !== "touch") return;
        } catch (_) { return; }
        const t = $(e.target);
        if (t.is("button") ||
            t.is("i") && t.closest("button").length ||
            t.closest("button").length ||
            t.closest(".uie-close-btn, .uie-rpg-close, .uie-sim-close").length) {
            return;
        }
        onWinStart(e);
    }, { capture: true, passive: false, signal });

    window.addEventListener("pointermove", (e) => {
        if (!markHandled(e)) return;
        onWinMove(e);
    }, { capture: true, passive: false, signal });

    window.addEventListener("pointerup", (e) => {
        if (!markHandled(e)) return;
        onWinEnd(e);
    }, { capture: true, signal });

    window.addEventListener("pointercancel", (e) => {
        if (!markHandled(e)) return;
        onWinEnd(e);
    }, { capture: true, signal });

    window.addEventListener("touchstart", (e) => {
        if (!markHandled(e)) return;
        const t = $(e.target);
        if (t.is("button") || 
            t.is("i") && t.closest("button").length || 
            t.closest("button").length ||
            t.closest(".uie-close-btn, .uie-rpg-close, .uie-sim-close").length) {
            return;
        }
        onWinStart(e);
    }, { capture: true, passive: false, signal });

    window.addEventListener("touchmove", (e) => {
        if (!markHandled(e)) return;
        onWinMove(e);
    }, { capture: true, passive: false, signal });

    window.addEventListener("touchend", (e) => {
        if (!markHandled(e)) return;
        onWinEnd(e);
    }, { capture: true, signal });
}
