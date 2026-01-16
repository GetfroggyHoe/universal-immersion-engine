import { getSettings, saveSettings, isMobileUI, updateLayout } from "./core.js";

let launcherState = { active: false, startX: 0, startY: 0, startTime: 0, moved: false };
let windowState = { active: false, target: null, startX: 0, startY: 0, ox: 0, oy: 0 };
let touchBlocker = false;
let launcherMouse = { active: false, ox: 0, oy: 0, moved: false, movedAt: 0 };
let launcherSaveT = 0;

export function initDragging() {
    if (window.uie_drag_controller) window.uie_drag_controller.abort();
    window.uie_drag_controller = new AbortController();
    const signal = window.uie_drag_controller.signal;

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
                left = Math.max(0, Math.min(left, vw - w));
                top = Math.max(0, Math.min(top, vh - h));
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

    const onWinStart = (e) => {
        if (launcherState.active) return;
        if (e.type === "mousedown" && typeof e.button === "number" && e.button !== 0) return;
        const t = $(e.target);

        if (t.closest(".uie-close-btn, .uie-inv-close, #uie-phone-close, #uie-settings-close, .phone-back-btn, .uie-controls, .uie-dropdown, .uie-dd-item, .uie-menu-tab, .uie-inv-icon, .fa-wand-magic-sparkles, [id*='sparkle'], button, input, select, textarea, a").length) {
            return;
        }

        if (t.closest("#uie-inv-drag").length && t.closest(".uie-inv-actions, .uie-inv-currency, #uie-inv-pencil-menu, #uie-inv-sparkle-menu").length) {
            return;
        }

        let target = null;
        if (t.closest(".uie-diary-header").length) target = $("#uie-diary-window");
        else if (t.closest("#uie-inv-drag").length) target = $("#uie-inventory-window");
        else if (t.closest("#uie-menu-drag").length) target = $("#uie-main-menu");
        else if (t.closest(".phone-status-bar").length) target = $("#uie-phone-window");
        else if (t.closest(".uie-p-header").length) target = $("#uie-social-overlay .uie-paper-box");
        else if (t.closest(".uie-party-member-header").length) target = $("#uie-party-member-card");
        else if (t.closest(".uie-header").length) target = t.closest(".uie-window");

        if (!target || !target.length) return;
        if (isMobileUI() && (target.attr("id") || "") === "uie-inventory-window") return;
        if (isMobileUI() && t.closest(".uie-party-member-header").length) return;

        if (e.type === "mousedown") e.preventDefault();

        const pos = e.touches ? e.touches[0] : e;
        const rect = target[0].getBoundingClientRect();
        const prevOrigin = target.css("transform-origin");
        const prevTransform = target.css("transform");
        target.css({ left: rect.left, top: rect.top, transformOrigin: "top left" });
        target.css({ transform: "none" });

        windowState = {
            active: true,
            target,
            startX: pos.clientX,
            startY: pos.clientY,
            ox: pos.clientX - rect.left,
            oy: pos.clientY - rect.top,
            prevOrigin,
            prevTransform
        };
    };

    const onWinMove = (e) => {
        if (!windowState.active || !windowState.target) return;
        if (e.type === "mousemove" && typeof e.buttons === "number" && e.buttons !== 1) {
            windowState.active = false;
            windowState.target = null;
            return;
        }
        if (e.cancelable) e.preventDefault();
        const pos = e.touches ? e.touches[0] : e;
        windowState.target.css({ left: pos.clientX - windowState.ox, top: pos.clientY - windowState.oy });
    };

    const onWinEnd = () => {
        if (windowState.active && windowState.target && windowState.target.length) {
            const rect = windowState.target[0].getBoundingClientRect();
            const s = getSettings();
            const id = windowState.target.attr("id") || "";
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
            windowState.target.css({ transform: "none", transformOrigin: windowState.prevOrigin || "" });
            updateLayout();
        }
        windowState.active = false;
        windowState.target = null;
    };

    document.addEventListener("mousedown", onWinStart, { signal });
    document.addEventListener("mousemove", onWinMove, { signal });
    document.addEventListener("mouseup", onWinEnd, { signal });
    window.addEventListener("blur", onWinEnd, { signal });

    document.addEventListener("touchstart", onWinStart, { passive: false, signal });
    document.addEventListener("touchmove", onWinMove, { passive: false, signal });
    document.addEventListener("touchend", onWinEnd, { signal });
}
