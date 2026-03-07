
import { getSettings, saveSettings } from "./core.js";
import { notify } from "./notifications.js";
import { clearAllSprites } from "./sprites.js";
import { getRealityEngineV3 } from "./reality.js";

// --- SPATIAL NAVIGATION MODULE (v4.0) ---

export function initNavigation() {
    renderNavHud();
    updateNavVisibility();
}

export function setNavVisible(show) {
    const s = getSettings();
    if (!s.realityEngine) s.realityEngine = {};
    if (!s.realityEngine.ui) s.realityEngine.ui = {};
    s.realityEngine.ui.showNav = show === true;
    saveSettings();
    updateNavVisibility();
}

export function refreshNavVisibility() {
    updateNavVisibility();
}

function renderNavHud() {
    if (document.getElementById("re-nav-arrows")) return;

    const layer = document.createElement("div");
    layer.id = "re-nav-arrows";
    layer.style.cssText = "position:absolute; inset:0; pointer-events:none; z-index:2147483646;";

    const isMobile = (() => {
        try { return window.matchMedia("(max-width: 768px), (pointer: coarse)").matches; } catch (_) { return window.innerWidth < 768; }
    })();
    const size = isMobile ? 44 : 60;
    const fontSize = isMobile ? 18 : 24;

    const arrows = [
        { dir: "north", icon: "fa-chevron-up", style: isMobile ? "top:20px; left:50%; transform:translateX(-50%);" : "top:60px; left:50%; transform:translateX(-50%);" },
        { dir: "south", icon: "fa-chevron-down", style: isMobile ? "bottom:28vh; left:50%; transform:translateX(-50%);" : "bottom:25vh; left:50%; transform:translateX(-50%);" }, // Moved up from 110px to 25vh (~270px on 1080p)
        { dir: "west", icon: "fa-chevron-left", style: isMobile ? "left:12px; top:50%; transform:translateY(-50%);" : "left:20px; top:50%; transform:translateY(-50%);" },
        { dir: "east", icon: "fa-chevron-right", style: isMobile ? "right:12px; top:50%; transform:translateY(-50%);" : "right:20px; top:50%; transform:translateY(-50%);" }
    ];

    const handleNavActivate = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
        // const vn = document.getElementById("re-vn-box");
        // if (vn && vn.style.display !== "none") return;
        const dir = e.currentTarget?.dataset?.dir || e.target?.dataset?.dir;
        if (!dir) return;
        moveDirectionSilent(dir);
    };

    arrows.forEach(a => {
        const btn = document.createElement("div");
        btn.className = `re-nav-arrow re-nav-${a.dir}`;
        btn.innerHTML = `<i class="fa-solid ${a.icon}"></i>`;
        btn.dataset.dir = a.dir;
        btn.style.cssText = `
            position: absolute;
            width: ${size}px; height: ${size}px;
            background: rgba(0,0,0,0.4);
            border: 1px solid rgba(255,255,255,0.2);
            border-radius: 50%;
            color: #fff;
            font-size: ${fontSize}px;
            display: grid; place-items: center;
            cursor: pointer;
            pointer-events: auto;
            transition: all 0.2s;
            touch-action: none;
            ${a.style}
        `;

        btn.onpointerdown = (e) => {
            e.preventDefault();
            e.stopPropagation();
        };
        btn.ontouchstart = (e) => {
            e.preventDefault();
            e.stopPropagation();
        };
        btn.onpointerup = handleNavActivate;
        btn.ontouchend = handleNavActivate;
        btn.onclick = handleNavActivate;

        btn.onmouseenter = () => {
            btn.style.background = "rgba(255,255,255,0.2)";
            btn.style.transform = `${btn.style.transform} scale(1.1)`;
            showTooltip(a.dir);
        };

        btn.onmouseleave = () => {
            btn.style.background = "rgba(0,0,0,0.4)";
            btn.style.transform = btn.style.transform.replace(" scale(1.1)", "");
            hideTooltip();
        };

        layer.appendChild(btn);
    });

    // Tooltip
    const tip = document.createElement("div");
    tip.id = "re-nav-tooltip";
    tip.style.cssText = "position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); background:rgba(0,0,0,0.8); padding:8px 12px; border-radius:8px; color:#fff; font-weight:bold; display:none; pointer-events:none;";
    layer.appendChild(tip);

    const bg = document.getElementById("re-bg");
    if (bg && bg.parentElement) {
        bg.parentElement.appendChild(layer);
    } else {
        // Fallback if re-bg is missing (e.g. World only mode)
        document.body.appendChild(layer);
    }
}

function updateNavVisibility() {
    const layer = document.getElementById("re-nav-arrows");
    if (!layer) return;
    const s = getSettings();
    const wantsNav = s.realityEngine?.ui?.showNav !== false;
    const vn = document.getElementById("re-vn-box");
    const vnOpen = vn && vn.style.display !== "none";
    const show = wantsNav;
    layer.style.display = show ? "block" : "none";
}

function showTooltip(dir) {
    const tip = document.getElementById("re-nav-tooltip");
    if (!tip) return;

    // Calculate next coord
    const s = getSettings();
    const x = s.worldState?.x || 0;
    const y = s.worldState?.y || 0;
    let nx = x, ny = y;
    if (dir === "north") ny--;
    if (dir === "south") ny++;
    if (dir === "west") nx--;
    if (dir === "east") nx++;

    const key = `${nx},${ny}`;
    const known = s.realityEngine?.backgrounds?.[key] ? "Known Location" : "Unknown Area";

    tip.textContent = `To ${dir.toUpperCase()} (${known})`;
    tip.style.display = "block";
}

function hideTooltip() {
    const tip = document.getElementById("re-nav-tooltip");
    if (tip) tip.style.display = "none";
}

let navLastAt = 0;
const navPending = new Map();

// Global generation lock to prevent navigation during generation
function isGenerating() {
    try {
        // Check standard SillyTavern generation flags if available
        if (typeof is_send_press !== "undefined" && is_send_press) return true;
        const btn = document.getElementById("send_but");
        if (btn && btn.style.display === "none") return true; // Send button hidden usually means generating
        const stop = document.getElementById("stop_but");
        if (stop && stop.style.display !== "none") return true; // Stop button visible means generating
    } catch (_) {}
    return false;
}

export async function moveDirectionSilent(dir) {
    // strict debounce + generation lock
    if (isGenerating()) {
        try { notify("warn", "Cannot move while generating.", "Navigation"); } catch (_) {}
        return;
    }

    const now = Date.now();
    if (now - navLastAt < 650) return; // Increased from 300ms to 650ms
    navLastAt = now;

    const s = getSettings();
    if (!s.worldState) s.worldState = { x: 0, y: 0 };
    if (typeof s.worldState.x !== "number") s.worldState.x = 0;
    if (typeof s.worldState.y !== "number") s.worldState.y = 0;

    // Transition Effect
    const bg = document.getElementById("re-bg");
    const spritesLayer = document.getElementById("re-sprites-layer");
    if (bg) {
        bg.style.transition = "transform 0.5s, opacity 0.5s";
        bg.style.transform = "scale(1.5)";
        bg.style.opacity = "0";
    }
    // Keep sprites "following" the player on movement (never leave screen)
    // This is purely visual; it does not generate assistant narration.
    if (spritesLayer) {
        spritesLayer.style.transition = "transform 0.45s ease, opacity 0.45s ease";
        spritesLayer.style.opacity = "0";
        // small directional slide for VN/RPG feel
        const dx = dir === "east" ? -40 : dir === "west" ? 40 : 0;
        const dy = dir === "south" ? -20 : dir === "north" ? 20 : 0;
        spritesLayer.style.transform = `translate(${dx}px, ${dy}px)`;
    }
    // Location change => new scene by default
    clearAllSprites({ remove: true });

    // Update Coords
    if (dir === "north") s.worldState.y--;
    if (dir === "south") s.worldState.y++;
    if (dir === "west") s.worldState.x--;
    if (dir === "east") s.worldState.x++;

    const locId = `${s.worldState.x},${s.worldState.y}`;
    s.worldState.location = locId;
    saveSettings();

    const reV3 = getRealityEngineV3();
    try { reV3.setLocation(locId); } catch (_) {}

    setTimeout(async () => {
        // Apply new background
        if (bg) {
            bg.classList.remove("re-moving-forward", "re-moving-backward");
            // Clean up inline styles if any remained (though we use classes now)
            bg.style.transform = "";
            bg.style.opacity = "";

            // Check if exists
            let savedBg = "";
            try { savedBg = String(reV3.getBackground(locId) || "").trim(); } catch (_) {}
            if (!savedBg) savedBg = String(s.realityEngine?.backgrounds?.[locId] || "").trim();
            if (savedBg) {
                bg.style.backgroundImage = `url("${savedBg}")`;
                notify("info", `Arrived at ${locId}`, "Navigation");
            } else {
                bg.style.backgroundImage = "";
                notify("info", `New Area: ${locId}. Generating...`, "Navigation");
                // Trigger background generation once, then wait for it
                if (!navPending.has(locId)) {
                    navPending.set(locId, Date.now());
                    try { reV3.ensureBackgroundOrRequest(); } catch (_) {}
                    const poll = (tries = 0) => {
                        let nextBg = "";
                        try { nextBg = String(reV3.getBackground(locId) || "").trim(); } catch (_) {}
                        if (nextBg && bg) {
                            bg.style.backgroundImage = `url("${nextBg}")`;
                            navPending.delete(locId);
                            return;
                        }
                        if (tries >= 8) { navPending.delete(locId); return; }
                        setTimeout(() => poll(tries + 1), 350);
                    };
                    poll();
                }
            }
        }

        // Fade sprites back in cleanly
        if (spritesLayer) {
            spritesLayer.style.opacity = "1";
            spritesLayer.style.transform = "none";
        }
    }, 500);
}

// Backwards compatibility for older callers inside this module
async function moveDirection(dir) {
    return await moveDirectionSilent(dir);
}
