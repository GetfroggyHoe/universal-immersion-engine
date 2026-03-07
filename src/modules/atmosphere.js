
import { getSettings } from "./core.js";

const TIME_FILTERS = {
    night: "brightness(0.6) hue-rotate(240deg) contrast(1.1)",
    sunset: "sepia(0.4) hue-rotate(-30deg) contrast(1.1)",
    day: "none"
};

const WEATHER_EFFECTS = {
    rain: "rain",
    storm: "rain", // Storm uses rain + maybe darker filter
    snow: "snow",
    fog: "fog",
    clear: ""
};

function ensureLayers() {
    const stage = document.getElementById("reality-stage");
    if (!stage) return;

    if (!document.getElementById("re-time-filter")) {
        const tf = document.createElement("div");
        tf.id = "re-time-filter";
        tf.style.position = "absolute";
        tf.style.top = "0";
        tf.style.left = "0";
        tf.style.width = "100%";
        tf.style.height = "100%";
        tf.style.pointerEvents = "none";
        tf.style.zIndex = "10";
        tf.style.transition = "backdrop-filter 2s ease";
        stage.appendChild(tf);
    }

    if (!document.getElementById("re-weather-layer")) {
        const wl = document.createElement("div");
        wl.id = "re-weather-layer";
        wl.style.position = "absolute";
        wl.style.top = "0";
        wl.style.left = "0";
        wl.style.width = "100%";
        wl.style.height = "100%";
        wl.style.pointerEvents = "none";
        wl.style.zIndex = "11";
        stage.appendChild(wl);
    }
    
    // SENSORY LAYERS (Mobile-First / True Reality)
    if (!document.getElementById("re-sensory-style")) {
        const s = document.createElement("style");
        s.id = "re-sensory-style";
        s.textContent = `
            @keyframes re-drift { 
                0% { transform: scale(1.0) rotate(0deg); } 
                50% { transform: scale(1.02) rotate(0.1deg); } 
                100% { transform: scale(1.0) rotate(0deg); } 
            }
            .re-breathing { animation: re-drift 24s infinite ease-in-out; }
            .re-blur-bg { filter: blur(3px); transition: filter 0.5s; }
            .re-focus-sprite { filter: drop-shadow(0 0 5px rgba(0,0,0,0.5)); }
        `;
        document.head.appendChild(s);
        // Apply breathing to background container
        const bg = document.getElementById("re-bg");
        if (bg) bg.classList.add("re-breathing");
    }
}

let _mouseX = 0;
let _mouseY = 0;
let _lastParallaxAt = 0;
let _lastPx = 0;
let _lastPy = 0;
let atmosphereSyncInterval = null;
let sensoryEventsBound = false;

function initSensoryEvents() {
    // Mouse
    document.addEventListener("mousemove", (e) => {
        _mouseX = e.clientX;
        _mouseY = e.clientY;
        requestAnimationFrame(updateSensoryFrame);
    });

    // Touch (for Flashlight/Focus)
    document.addEventListener("touchmove", (e) => {
        if (e.touches[0]) {
            _mouseX = e.touches[0].clientX;
            _mouseY = e.touches[0].clientY;
            requestAnimationFrame(updateSensoryFrame);
        }
    }, { passive: true });

    // Gyroscope (for Parallax - Mobile Reality)
    window.addEventListener("deviceorientation", (e) => {
        // Gamma: Left/Right (-90 to 90)
        // Beta: Front/Back (-180 to 180)
        if (e.gamma !== null && e.beta !== null) {
            // Clamp and Normalize
            const tiltX = Math.min(Math.max(e.gamma, -45), 45) / 45; // -1 to 1
            const tiltY = Math.min(Math.max(e.beta - 45, -45), 45) / 45; // Centered at 45deg holding angle
            
            window._tiltX = tiltX;
            window._tiltY = tiltY;
            requestAnimationFrame(updateSensoryFrame);
        }
    }, true);
}

function updateSensoryFrame() {
    const stage = document.getElementById("reality-stage");
    if (!stage || stage.style.display === "none") return;
    // Avoid parallax jitter while dragging UI windows
    if (window.UIE_isDragging) return;
    const now = Date.now();
    if (now - _lastParallaxAt < 33) return; // ~30fps cap
    _lastParallaxAt = now;
    
    const w = window.innerWidth;
    const h = window.innerHeight;
    
    // Parallax Factors (Default to Mouse)
    let px = (_mouseX / w - 0.5); 
    let py = (_mouseY / h - 0.5);

    // Override with Tilt if available (True Reality)
    if (typeof window._tiltX === "number") {
        px = window._tiltX * 0.8; 
        py = window._tiltY * 0.8;
    }

    // 1. Parallax (disable on mobile / coarse pointer)
    try {
        if (w < 768 || (window.matchMedia && window.matchMedia("(pointer: coarse)").matches)) {
            px = 0;
            py = 0;
        }
    } catch (_) {}
    const bg = document.getElementById("re-bg");
    const sprites = document.getElementById("re-sprites-layer");
    // Smooth values to reduce jitter
    const smoothing = 0.18;
    _lastPx = _lastPx + (px - _lastPx) * smoothing;
    _lastPy = _lastPy + (py - _lastPy) * smoothing;
    if (bg) bg.style.transform = `scale(1.04) translate(${_lastPx * -14}px, ${_lastPy * -9}px)`; 
    // Keep sprites stable to avoid hover jitter/vibration
    if (sprites) sprites.style.transform = "none";

    // 2. Flashlight (Night Mode) - Always follows Finger/Mouse
    const tf = document.getElementById("re-time-filter");
    if (tf && tf.dataset.mode === "night") {
        // Darker outer rim for better immersion
        tf.style.background = `radial-gradient(circle 280px at ${_mouseX}px ${_mouseY}px, transparent 5%, rgba(0,0,5,0.96) 100%)`;
        tf.style.backdropFilter = "none"; 
    } else if (tf) {
        tf.style.background = "";
    }
}

function detectTime(text) {
    const t = text.toLowerCase();
    if (t.includes("night") || t.includes("midnight") || t.includes("moon")) return "night";
    if (t.includes("sunset") || t.includes("dusk") || t.includes("evening")) return "sunset";
    if (t.includes("morning") || t.includes("noon") || t.includes("day")) return "day";
    return null; // No change
}

function detectWeather(text) {
    const t = text.toLowerCase();
    if (t.includes("rain") || t.includes("downpour")) return "rain";
    if (t.includes("snow") || t.includes("blizzard")) return "snow";
    if (t.includes("fog") || t.includes("mist")) return "fog";
    if (t.includes("clear sky") || t.includes("sunny")) return "clear";
    return null;
}

export function updateAtmosphere(text = "") {
    ensureLayers();
    const s = getSettings();
    const tf = document.getElementById("re-time-filter");
    const wl = document.getElementById("re-weather-layer");

    // 1. Time
    let time = detectTime(text);
    if (!time && s.worldState?.time) {
        const wt = s.worldState.time.toLowerCase();
        if (wt.includes("night")) time = "night";
        else if (wt.includes("sunset") || wt.includes("dusk")) time = "sunset";
        else time = "day";
    }
    if (time && tf) {
        tf.dataset.mode = time; // Store mode for flashlight
        if (time !== "night") { // Flashlight handles night CSS manually
            tf.style.backdropFilter = TIME_FILTERS[time] || "none";
            tf.style.background = "";
        }
    }

    // 2. Weather
    let weather = detectWeather(text);
    if (!weather && s.worldState?.weather) {
        const ww = s.worldState.weather.toLowerCase();
        if (ww.includes("rain")) weather = "rain";
        else if (ww.includes("snow")) weather = "snow";
        else if (ww.includes("fog")) weather = "fog";
        else weather = "clear";
    }

    if (wl) {
        // Remove existing weather classes
        wl.className = "";
        if (weather && WEATHER_EFFECTS[weather]) {
            wl.classList.add(`re-weather-${WEATHER_EFFECTS[weather]}`);
            // Add particles dynamically if needed, or rely on CSS pseudo-elements
            // For rain/snow, we often need inner elements for parallax
            if (weather === "rain" || weather === "snow") {
                wl.innerHTML = '<div class="particles"></div>';
            } else {
                wl.innerHTML = '';
            }
        } else {
            wl.innerHTML = '';
        }
    }
}

export function initAtmosphere() {
    console.log("[UIE] Atmosphere Engine Initialized");
    if (!sensoryEventsBound) {
        initSensoryEvents();
        sensoryEventsBound = true;
    }
    if (atmosphereSyncInterval) return;

    atmosphereSyncInterval = setInterval(() => {
        try {
            if (document.hidden) return;
            const stage = document.getElementById("reality-stage");
            if (!stage) return;
            const stageStyle = window.getComputedStyle(stage);
            if (stageStyle.display === "none" || stageStyle.visibility === "hidden") return;
        } catch (_) {
            return;
        }

        // Periodic check to sync with world state settings if chat isn't moving
        updateAtmosphere("");
    }, 5000);
}

