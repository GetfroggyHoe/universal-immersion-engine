import { getSettings, saveSettings } from "./core.js";
import { notify } from "./notifications.js";
import { generateImageAPI } from "./imageGen.js";

// ==========================================
// REALITY ENGINE V3 CORE
// ==========================================

const slug = (s) => String(s || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80);

function ensureWorldData(s) {
    if (!s.realityEngine || typeof s.realityEngine !== "object") s.realityEngine = {};
    if (!s.realityEngine.worldData || typeof s.realityEngine.worldData !== "object") {
        s.realityEngine.worldData = {
            v: "3.1",
            player: { locationId: "default", money: Number(s.currency || 0) || 0, energy: 100, timeOfDay: "day" },
            locations: {
                default: { id: "default", name: "Default", type: "ROOM", biome: "default", exits: {} }
            },
            locationRegistry: { backgrounds: {} },
            atlas: { nodes: [], links: [], explored: {}, fog: {} },
            socialGraph: { npcs: {} },
            ui: { mode: "life" }
        };
    }
    const wd = s.realityEngine.worldData;
    if (!wd.player || typeof wd.player !== "object") wd.player = { locationId: "default", money: 0, energy: 100, timeOfDay: "day" };
    if (!wd.locations || typeof wd.locations !== "object") wd.locations = { default: { id: "default", name: "Default", type: "ROOM", biome: "default", exits: {} } };
    if (!wd.locationRegistry || typeof wd.locationRegistry !== "object") wd.locationRegistry = { backgrounds: {} };
    if (!wd.locationRegistry.backgrounds || typeof wd.locationRegistry.backgrounds !== "object") wd.locationRegistry.backgrounds = {};
    if (!wd.atlas || typeof wd.atlas !== "object") wd.atlas = { nodes: [], links: [], explored: {}, fog: {} };
    if (!wd.socialGraph || typeof wd.socialGraph !== "object") wd.socialGraph = { npcs: {} };
    if (!wd.socialGraph.npcs || typeof wd.socialGraph.npcs !== "object") wd.socialGraph.npcs = {};
    if (!wd.ui || typeof wd.ui !== "object") wd.ui = { mode: "life" };
    if (typeof wd.ui.mode !== "string") wd.ui.mode = "life";
    return wd;
}

function createEmitter() {
    const map = new Map();
    return {
        on(type, fn) {
            const t = String(type || "");
            if (!t || typeof fn !== "function") return () => {};
            const arr = map.get(t) || [];
            arr.push(fn);
            map.set(t, arr);
            return () => {
                const cur = map.get(t) || [];
                map.set(t, cur.filter(f => f !== fn));
            };
        },
        emit(type, payload) {
            const t = String(type || "");
            const arr = map.get(t) || [];
            for (const fn of arr.slice()) {
                try { fn(payload); } catch (_) {}
            }
        }
    };
}

export function getRealityEngineV3() {
    if (window.UIE_realityV3) return window.UIE_realityV3;
    const ev = createEmitter();

    const api = {
        on: ev.on,
        getState() {
            const s = getSettings();
            ensureWorldData(s);
            return s.realityEngine.worldData;
        },
        save() {
            saveSettings();
        },
        ensureLocationFromWorldState() {
            const s = getSettings();
            const wd = ensureWorldData(s);
            const ws = s.worldState && typeof s.worldState === "object" ? s.worldState : {};
            const label = String(ws.location || "").trim() || "Default";
            const id = slug(label) || "default";
            if (!wd.locations[id]) wd.locations[id] = { id, name: label.slice(0, 80), type: "ROOM", biome: "default", exits: {} };
            wd.player.locationId = id;
            saveSettings();
            return id;
        },
        getCurrentLocation() {
            const wd = this.getState();
            const id = String(wd?.player?.locationId || "default");
            return wd.locations?.[id] || wd.locations?.default || { id: "default", name: "Default", exits: {} };
        },
        setLocation(id) {
            const s = getSettings();
            const wd = ensureWorldData(s);
            const k = slug(id || "") || "default";
            if (!wd.locations[k]) wd.locations[k] = { id: k, name: String(id || "Default").slice(0, 80), type: "ROOM", biome: "default", exits: {} };
            wd.player.locationId = k;
            saveSettings();
            ev.emit("location:changed", { id: k, location: wd.locations[k] });
        },
        getBackground(locationId) {
            const wd = this.getState();
            const id = slug(locationId || wd?.player?.locationId || "default") || "default";
            return String(wd?.locationRegistry?.backgrounds?.[id] || "").trim();
        },
        setBackground(locationId, dataUrl) {
            const s = getSettings();
            const wd = ensureWorldData(s);
            const id = slug(locationId || wd?.player?.locationId || "default") || "default";
            wd.locationRegistry.backgrounds[id] = String(dataUrl || "");
            saveSettings();
            ev.emit("background:changed", { id, src: wd.locationRegistry.backgrounds[id] });
        },
        ensureBackgroundOrRequest() {
            const wd = this.getState();
            const id = slug(wd?.player?.locationId || "default") || "default";
            const src = String(wd?.locationRegistry?.backgrounds?.[id] || "").trim();
            if (src) return { ok: true, id, src };
            ev.emit("background:missing", { id, location: wd.locations?.[id] || null });
            return { ok: false, id, src: "" };
        },
        setMode(mode) {
            const s = getSettings();
            const wd = ensureWorldData(s);
            wd.ui.mode = String(mode || "").toLowerCase() === "rpg" ? "rpg" : "life";
            saveSettings();
            ev.emit("mode:changed", { mode: wd.ui.mode });
        }
    };

    window.UIE_realityV3 = api;
    return api;
}

// ==========================================
// WORLD FORGE (Background Gen)
// ==========================================

function buildPrompt({ location, biome, timeOfDay, lore } = {}) {
    const parts = [];
    if (location) parts.push(String(location));
    if (biome) parts.push(`Biome: ${String(biome)}`);
    if (timeOfDay) parts.push(`Time: ${String(timeOfDay)}`);
    if (lore) parts.push(String(lore));
    const base = parts.filter(Boolean).join("\n").trim();
    return base || "A detailed background scene for a visual novel style roleplay.";
}

export function initForgeV3() {
    const eng = getRealityEngineV3();
    if (window.UIE_realityForgeV3Bound) return;
    window.UIE_realityForgeV3Bound = true;

    eng.on("background:missing", async ({ id, location } = {}) => {
        const s = getSettings();
        const wd = eng.getState();
        const locId = slug(id || wd?.player?.locationId || "default") || "default";
        const loc = location || wd.locations?.[locId] || wd.locations?.default || {};
        const prompt = buildPrompt({
            location: loc?.name || locId,
            biome: loc?.biome || "default",
            timeOfDay: wd?.player?.timeOfDay || "day",
            lore: String(s?.worldState?.status || "").trim()
        });
        const img = await generateImageAPI(`[UIE_LOCKED] ${prompt}`);
        if (!img) return;
        eng.setBackground(locId, img);
    });
}

// ==========================================
// GAMEPLAY & MODES
// ==========================================

function stSendText(text) {
    const ta =
        document.querySelector("textarea#send_textarea") ||
        document.querySelector("textarea#send_text") ||
        document.querySelector("textarea") ||
        null;
    if (!ta) return false;
    ta.value = String(text || "");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    ta.dispatchEvent(new Event("change", { bubbles: true }));
    const send = document.querySelector("#send_but") || document.querySelector("[data-testid='send']");
    if (send) send.click();
    return true;
}

function renderButtons(mode) {
    // DISABLED: User requested removal of all default quick buttons (Work, Flirt, etc.)
    // Logic is now handled centrally in world.js via User Settings.
    return;
}

export function initGameplayV3() {
    if (window.UIE_realityGameplayV3Bound) return;
    window.UIE_realityGameplayV3Bound = true;
    const eng = getRealityEngineV3();
    const sync = () => { try { renderButtons(eng.getState()?.ui?.mode || "life"); } catch (_) {} };
    eng.on("mode:changed", sync);
    sync();
}

export function setGameplayMode(mode) {
    getRealityEngineV3().setMode(mode);
}

// ==========================================
// HAPTICS & SENSORY
// ==========================================

export class HapticManager {
    constructor() {
        this.enabled = true;
        try {
            if (!("vibrate" in navigator)) {
                console.warn("[UIE] Haptics not supported on this device.");
                this.enabled = false;
            }
        } catch (e) {
            this.enabled = false;
        }
    }

    // Simulate intensity (0.0 - 1.0) using PWM (Pulse-Width Modulation)
    vibratePWM(duration, intensity = 1.0) {
        if (!this.enabled) return;
        intensity = Math.max(0.1, Math.min(1.0, intensity));
        if (intensity >= 0.9) {
            try { navigator.vibrate(duration); } catch (_) {}
            return;
        }
        const cycle = 20;
        const on = Math.max(5, Math.floor(cycle * intensity));
        const off = cycle - on;
        const loops = Math.floor(duration / cycle);
        const pattern = [];
        for (let i = 0; i < loops; i++) pattern.push(on, off);
        const rem = duration % cycle;
        if (rem > 5) pattern.push(rem);
        try { navigator.vibrate(pattern); } catch (_) {}
    }

    // Play a predefined texture pattern
    texture(name, modifier = 1.0) {
        if (!this.enabled) return;
        let pattern = [];
        switch (name.toLowerCase()) {
            case "friction":
                // Dragging heavy items: rapid pulses with random-ish gaps
                pattern = [8, 20, 8, 25, 10, 20, 8];
                break;
            case "micro-click":
            case "click":
                // UI Switches: Sharp, short pulse
                try { navigator.vibrate(5); } catch (_) {}
                return;
            case "biological":
            case "heartbeat":
                // Heartbeat: Lub-Dub
                const gap = Math.max(50, 100 * modifier);
                pattern = [40, 80, 20, gap];
                break;
            case "rumble":
                this.vibratePWM(200 * modifier, 0.4);
                return;
            case "bump":
                pattern = [15];
                break;
            case "error":
                pattern = [30, 50, 30, 50, 30];
                break;
            case "success":
                pattern = [10, 50, 20];
                break;
            case "tap":
                pattern = [5];
                break;
            case "step":
                pattern = [10];
                break;
            default:
                return;
        }
        try { navigator.vibrate(pattern); } catch (_) {}
    }

    stop() {
        if (!this.enabled) return;
        try { navigator.vibrate(0); } catch (_) {}
    }
}

export const haptics = new HapticManager();

export function initHaptics() {
    console.log("[UIE] Haptics Initialized");
    document.addEventListener("pointerup", (e) => {
        if (e.target.closest("button, .re-qbtn, .re-actbtn")) {
            haptics.texture("click");
        }
    });
}

// ==========================================
// PROCEDURAL AUDIO LAYER
// ==========================================

export class ProceduralAudio {
    constructor() {
        this.ctx = null;
        this.masterGain = null;
        this.windNode = null;
        this.enabled = true;
    }

    init() {
        try {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            this.ctx = new Ctx();
            this.masterGain = this.ctx.createGain();
            this.masterGain.connect(this.ctx.destination);
            this.masterGain.gain.value = 0.5; // Default volume
            console.log("[UIE] Procedural Audio Initialized");
        } catch (e) {
            console.warn("[UIE] AudioContext failed", e);
            this.enabled = false;
        }
    }

    // Spatial Sound (HRTF)
    // x: -1 (left) to 1 (right)
    // z: depth (positive is away)
    playSpatialTone(freq, type = "sine", duration = 0.1, x = 0, z = 0) {
        if (!this.enabled || !this.ctx) return;
        if (this.ctx.state === "suspended") this.ctx.resume();

        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        const panner = this.ctx.createPanner();

        panner.panningModel = "HRTF";
        panner.distanceModel = "inverse";
        panner.positionX.value = x;
        panner.positionY.value = 0;
        panner.positionZ.value = z;

        osc.type = type;
        osc.frequency.setValueAtTime(freq, this.ctx.currentTime);

        gain.gain.setValueAtTime(0.1, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + duration);

        osc.connect(panner);
        panner.connect(this.masterGain);

        osc.start();
        osc.stop(this.ctx.currentTime + duration);
    }

    // Dynamic Wind
    startWind() {
        if (!this.enabled || !this.ctx || this.windNode) return;
        // Simple implementation: White noise + Lowpass
        const bufferSize = 2 * this.ctx.sampleRate;
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const output = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            output[i] = Math.random() * 2 - 1;
        }

        const noise = this.ctx.createBufferSource();
        noise.buffer = buffer;
        noise.loop = true;

        const filter = this.ctx.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.value = 200; // Deep rumble

        const gain = this.ctx.createGain();
        gain.gain.value = 0.0; // Start silent

        noise.connect(filter);
        filter.connect(gain);
        gain.connect(this.masterGain);

        noise.start();

        this.windNode = { noise, filter, gain };

        // Wind LFO loop
        this.windLoop();
    }

    windLoop() {
        if (!this.windNode) return;
        const time = Date.now() / 1000;
        // Vary gain and cutoff to simulate gusts
        const gust = (Math.sin(time * 0.5) + Math.sin(time * 0.2) + 2) / 4; // 0 to 1

        // Smooth transitions
        const now = this.ctx.currentTime;
        this.windNode.gain.gain.setTargetAtTime(gust * 0.05, now, 2); // Low volume background
        this.windNode.filter.frequency.setTargetAtTime(100 + (gust * 400), now, 2); // 100Hz - 500Hz

        requestAnimationFrame(() => this.windLoop());
    }
}

export const audio = new ProceduralAudio();

export function initAudio() {
    audio.init();
}

// ==========================================
// SENSORY INTERACTION
// ==========================================

export function triggerHaptic(type) {
    haptics.texture(type);
}

export function playMaterialSound(x, y) {
    const w = window.innerWidth;
    const h = window.innerHeight;

    // Calculate Pan (-1 to 1) based on X
    const pan = (x / w) * 2 - 1;

    const isFloor = y > h * 0.8;
    if (isFloor) {
        // Lower tone for floor
        audio.playSpatialTone(100, "square", 0.1, pan, 0);
    } else {
        // Higher tone for walls/objects
        audio.playSpatialTone(400, "triangle", 0.05, pan, 0);
    }
    haptics.texture("tap");
}

export function playFootstep(biome = "default") {
    const s = getSettings();
    if (s.realityEngine?.audio?.enabled === false) return;
    // Center panned footstep
    audio.playSpatialTone(80, "sawtooth", 0.1, 0, 0);
    haptics.texture("step");
}

export function initSensory() {
    if (initSensory._inited) return;
    initSensory._inited = true;
    initAudio(); // Initialize Audio Context

    const stage = document.getElementById("reality-stage");
    if (!stage) return;
    stage.addEventListener("pointerdown", (e) => {
        if (e.target.id === "re-bg" || e.target.id === "reality-stage") {
            // playMaterialSound(e.clientX, e.clientY); // Disabled to prevent annoying beeps
        }
    });
    console.log("[UIE] Sensory Physics Initialized");
}

export function updateAudioOcclusion(mouseX) {
    // Placeholder for future spatial audio updates
}

// ==========================================
// GESTURES
// ==========================================

let touchStartX = 0;
let touchStartY = 0;
let longPressTimer = null;
let isLongPress = false;

function handleSwipe(diffX, diffY) {
    // Swipes disabled: navigation uses buttons only
    return;
    const absX = Math.abs(diffX);
    const absY = Math.abs(diffY);
    if (Math.max(absX, absY) < 50) return;

    const s = getSettings();
    if (!s.realityEngine || !s.realityEngine.enabled) return;

    if (absX > absY) {
        if (diffX > 0) {
            import("./navigation.js").then(m => m.moveDirectionSilent?.("west")).catch(() => {});
            notify("info", "West", "Gestures");
        } else {
            import("./navigation.js").then(m => m.moveDirectionSilent?.("east")).catch(() => {});
            notify("info", "East", "Gestures");
        }
    } else {
        if (diffY > 0) {
            import("./navigation.js").then(m => m.moveDirectionSilent?.("south")).catch(() => {});
            notify("info", "South", "Gestures");
        } else {
            import("./navigation.js").then(m => m.moveDirectionSilent?.("north")).catch(() => {});
            notify("info", "North", "Gestures");
        }
    }
}

function processCommand(cmd) {
    const ta = document.getElementById("send_textarea");
    if (!ta) return;
    const nativeTextAreaValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
    nativeTextAreaValueSetter.call(ta, cmd);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    const send = document.getElementById("send_but");
    if (send) send.click();
}

function showBottomSheet() {
    let sheet = document.getElementById("re-bottom-sheet");
    if (!sheet) {
        sheet = document.createElement("div");
        sheet.id = "re-bottom-sheet";
        sheet.className = "re-bottom-sheet";
        sheet.innerHTML = `
            <div class="re-sheet-handle"></div>
            <button class="re-sheet-btn" data-cmd="/inspect"><i class="fa-solid fa-magnifying-glass"></i> Inspect</button>
            <button class="re-sheet-btn" data-cmd="/take"><i class="fa-solid fa-hand"></i> Pick Up</button>
            <button class="re-sheet-btn" data-cmd="/talk"><i class="fa-solid fa-comment"></i> Talk</button>
            <button class="re-sheet-btn" data-cmd="/look"><i class="fa-solid fa-eye"></i> Look</button>
        `;
        document.body.appendChild(sheet);

        // Prevent sheet interactions from triggering background/stage/global handlers
        sheet.addEventListener("mousedown", (e) => e.stopPropagation());
        sheet.addEventListener("pointerdown", (e) => e.stopPropagation());
        sheet.addEventListener("touchstart", (e) => { try { e.stopPropagation(); } catch (_) {} }, { passive: true });
        sheet.addEventListener("click", (e) => e.stopPropagation());

        sheet.querySelectorAll("button").forEach(btn => {
            btn.addEventListener("click", (e) => {
                const cmd = e.currentTarget.dataset.cmd;
                processCommand(cmd);
                hideBottomSheet();
            });
        });
        document.addEventListener("click", (e) => {
            if (!sheet.contains(e.target) && !isLongPress) {
                hideBottomSheet();
            }
            isLongPress = false;
        });
    }
    setTimeout(() => sheet.classList.add("active"), 10);
    haptics.vibratePWM(50);
}

function hideBottomSheet() {
    const sheet = document.getElementById("re-bottom-sheet");
    if (sheet) sheet.classList.remove("active");
}

export function initGestures() {
    if (initGestures._inited) return;
    initGestures._inited = true;
    const stage = document.getElementById("reality-stage");
    if (!stage) return;
    stage.addEventListener("touchstart", (e) => {
        touchStartX = e.changedTouches[0].screenX;
        touchStartY = e.changedTouches[0].screenY;
        isLongPress = false;
        longPressTimer = setTimeout(() => {
            isLongPress = true;
            showBottomSheet();
        }, 600);
    }, { passive: true });

    stage.addEventListener("touchmove", (e) => {
        const x = e.changedTouches[0].screenX;
        const y = e.changedTouches[0].screenY;
        if (Math.abs(x - touchStartX) > 10 || Math.abs(y - touchStartY) > 10) {
            clearTimeout(longPressTimer);
        }
    }, { passive: true });

    stage.addEventListener("touchend", (e) => {
        clearTimeout(longPressTimer);
        if (isLongPress) return;
        const touchEndX = e.changedTouches[0].screenX;
        const touchEndY = e.changedTouches[0].screenY;
        handleSwipe(touchEndX - touchStartX, touchEndY - touchStartY);
    }, { passive: true });

    console.log("[UIE] Gestures Initialized");
}

// ==========================================
// INPUT ASSIST (Pills)
// ==========================================

const PILLS = []; // Empty by default as requested

function injectPills() {
    const composer = document.getElementById("re-composer");
    if (!composer || document.getElementById("re-glass-pills")) return;
    const bar = document.createElement("div");
    bar.id = "re-glass-pills";
    bar.className = "custom-scroll";
    PILLS.forEach(p => {
        const btn = document.createElement("button");
        btn.className = "re-pill";
        btn.textContent = p.label;
        btn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            processCommand(p.cmd);
        };
        bar.appendChild(btn);
    });
    composer.parentNode.insertBefore(bar, composer);
}

function toggleFocusMode(active) {
    const stage = document.getElementById("reality-stage");
    if (!stage) return;
    if (active) stage.classList.add("re-focus-mode");
    else stage.classList.remove("re-focus-mode");
}

export function initInputAssist() {
    injectPills();
    const input = document.getElementById("re-user-input");
    if (input) {
        input.addEventListener("focus", () => toggleFocusMode(true));
        input.addEventListener("blur", () => {
            setTimeout(() => toggleFocusMode(false), 200);
        });
    }
    console.log("[UIE] Input Assist Initialized");
}

// ==========================================
// VISUAL TROPHIES
// ==========================================

const TROPHY_MAPPING = {
    "Dragon Egg": "egg.png",
    "Ancient Sword": "sword.png",
    "Gold Crown": "crown.png",
    "Magic Map": "map_scroll.png"
};

function updateTrophies() {
    const s = getSettings();
    const inv = s.inventory || [];
    const container = document.getElementById("re-trophies");
    if (!container) return;
    container.innerHTML = "";
    const items = Array.isArray(inv) ? inv : Object.keys(inv);
    items.forEach((item, index) => {
        const name = typeof item === "string" ? item : item.name;
        if (TROPHY_MAPPING[name]) {
            const img = document.createElement("img");
            const baseUrl = window.UIE_BASEURL || "/scripts/extensions/third-party/universal-immersion-engine/";
            img.src = `${baseUrl}assets/trophies/${TROPHY_MAPPING[name]}`;
            img.className = "re-trophy-item";
            img.style.left = `${10 + (index * 15)}%`;
            container.appendChild(img);
        }
    });
}

export function initTrophies() {
    const stage = document.getElementById("reality-stage");
    if (!stage || document.getElementById("re-trophies")) return;
    const layer = document.createElement("div");
    layer.id = "re-trophies";
    layer.style.pointerEvents = "none";
    const ui = document.getElementById("re-ui");
    stage.insertBefore(layer, ui);
    updateTrophies();
    document.addEventListener("uie:inventory_update", updateTrophies);
    console.log("[UIE] Visual Trophies Initialized");
}

// ==========================================
// VISUAL PHYSICS (Parallax & Trauma)
// ==========================================

export class VisualPhysics {
    constructor() {
        this.trauma = 0;
        this.shakeTimer = null;
        this.maxOffset = 20; // px
        this.decay = 0.5; // per second approx
        this.loopId = null;

        this.parallax = {
            enabled: true,
            x: 0,
            y: 0,
            targetX: 0,
            targetY: 0
        };

        this.layers = {
            bg: null,
            mid: null,
            fg: null
        };
        this.hasGyro = false;
        this.initialized = false;
    }

    init() {
        if (this.initialized) return;
        this.initialized = true;

        // Find layers
        this.layers.bg = document.getElementById("re-bg");
        this.layers.mid = document.getElementById("re-objects"); // Treat objects as midground
        this.layers.fg = document.getElementById("re-sprites-layer"); // Treat sprites as foreground

        // Gyro Parallax
        if (window.DeviceOrientationEvent) {
            window.addEventListener("deviceorientation", (e) => this.handleOrientation(e));
        }

        // Mouse Parallax (Desktop Fallback)
        document.addEventListener("mousemove", (e) => this.handleMouse(e));

        // Start Loop
        if (!this.loopId) this.loop();
        console.log("[UIE] Visual Physics Initialized");
    }

    handleMouse(e) {
        if (this.hasGyro) return; // Prefer Gyro if active
        if (!this.parallax.enabled) return;

        const w = window.innerWidth;
        const h = window.innerHeight;

        // Normalize -1 to 1
        const x = (e.clientX / w) * 2 - 1;
        const y = (e.clientY / h) * 2 - 1;

        // Invert Y for natural feel (up is negative in DOM, but looking up should shift view down)
        // Actually for parallax: moving mouse right (looking right) shifts layers left.
        // x is positive (right). targetX positive.
        // In loop: translate(px). If px > 0, moves right.
        // We want opposite?
        // Let's stick to 1:1 mapping for now, refine if needed.

        this.parallax.targetX = x * 0.5; // Reduce intensity for mouse
        this.parallax.targetY = y * 0.5;
    }

    handleOrientation(e) {
        if (!this.parallax.enabled) return;
        if (e.gamma === null || e.beta === null) return;

        this.hasGyro = true;

        // Gamma: Left/Right (-90 to 90)
        // Beta: Front/Back (-180 to 180)

        const g = e.gamma || 0; // x
        const b = e.beta || 0;  // y

        // Normalize roughly to -1 to 1 range for typical holding angles
        // Gamma: +/- 45 deg
        // Beta: 45 deg tilt +/- 45 deg

        const x = Math.max(-45, Math.min(45, g)) / 45;
        const y = Math.max(-45, Math.min(45, b - 45)) / 45;

        this.parallax.targetX = x;
        this.parallax.targetY = y;
    }

    addTrauma(amount) {
        this.trauma = Math.min(1.0, this.trauma + amount);
    }

    loop() {
        this.loopId = requestAnimationFrame(() => this.loop());

        // Lerp Parallax
        const lerp = (start, end, amt) => (1 - amt) * start + amt * end;
        this.parallax.x = lerp(this.parallax.x, this.parallax.targetX, 0.05);
        this.parallax.y = lerp(this.parallax.y, this.parallax.targetY, 0.05);

        // Apply Trauma Shake
        let shakeX = 0;
        let shakeY = 0;
        let rot = 0;

        if (this.trauma > 0) {
            const t2 = this.trauma * this.trauma;
            shakeX = (this.maxOffset * t2 * (Math.random() * 2 - 1));
            shakeY = (this.maxOffset * t2 * (Math.random() * 2 - 1));
            rot = (5 * t2 * (Math.random() * 2 - 1)); // Max 5 deg rotation

            // Decay
            this.trauma = Math.max(0, this.trauma - 0.01);
        }

        // Apply Parallax + Shake
        // BG: Moves little (Depth 1)
        if (this.layers.bg) {
            const px = this.parallax.x * 10;
            const py = this.parallax.y * 10;
            this.layers.bg.style.transform = `translate3d(${px + shakeX}px, ${py + shakeY}px, 0) rotate(${rot}deg) scale(1.1)`;
            // Scale 1.1 to prevent edges showing
        }

        // Mid: Moves medium (Depth 2)
        if (this.layers.mid) {
            const px = this.parallax.x * 20;
            const py = this.parallax.y * 20;
            this.layers.mid.style.transform = `translate3d(${px + shakeX}px, ${py + shakeY}px, 0) rotate(${rot}deg)`;
        }

        // FG: Moves most (Depth 3)
        if (this.layers.fg) {
            const px = this.parallax.x * 30;
            const py = this.parallax.y * 30;
            this.layers.fg.style.transform = `translate3d(${px + shakeX}px, ${py + shakeY}px, 0) rotate(${rot}deg)`;
        }
    }
}

export const physics = new VisualPhysics();

export function initVisualPhysics() {
    if (initVisualPhysics._inited) return;
    initVisualPhysics._inited = true;
    try {
        const isMobileNow = () => {
            try { return window.matchMedia("(max-width: 768px), (pointer: coarse)").matches; } catch (_) {}
            return false;
        };
        if (isMobileNow()) {
            physics.parallax.enabled = false;
            return;
        }
    } catch (_) {}
    physics.init();
}

export function addTrauma(amount) {
    physics.addTrauma(amount);
}

// ==========================================
// RUNE CASTER (Unistroke Recognizer)
// ==========================================

class RuneCaster {
    constructor() {
        this.canvas = null;
        this.ctx = null;
        this.points = [];
        this.isDrawing = false;
        this.active = false;
        this.templates = this.defineTemplates();
        this._inited = false;
    }

    defineTemplates() {
        // Simplified Unistroke Templates
        // Format: Array of {x,y} normalized to 0-1 box? Or just directions?
        // Let's use simple direction matching for robustness without heavy math.
        // Directions: 0:N, 1:NE, 2:E, 3:SE, 4:S, 5:SW, 6:W, 7:NW
        return {
            "attack": { name: "Attack", seq: [2] }, // Right (East)
            "defend": { name: "Defend", seq: [2, 4, 6, 0] }, // Circle-ish (Right, Down, Left, Up)
            "magic": { name: "Magic", seq: [3, 1, 3, 1] }, // ZigZag (SE, NE, SE, NE)
            "heal": { name: "Heal", seq: [3, 1] }, // Check (SE, NE)
            "inspect": { name: "Inspect", seq: [4, 2, 0, 6] } // Box (Down, Right, Up, Left)
        };
    }

    init() {
        if (this._inited) return;
        this._inited = true;
        this.canvas = document.getElementById("re-gesture-canvas");
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext("2d");
        this.resize();

        window.addEventListener("resize", () => this.resize());

        // Use pointer events for touch/mouse
        this.canvas.addEventListener("pointerdown", (e) => this.start(e));
        document.addEventListener("pointermove", (e) => this.move(e));
        document.addEventListener("pointerup", (e) => this.end(e));

        // Bind Toggle Button
        document.addEventListener("click", (e) => {
            if (e.target.closest("#re-q-rune")) {
                this.toggle();
            }
        });

        console.log("[UIE] Rune Caster Initialized");
    }

    resize() {
        if (!this.canvas) return;
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
    }

    toggle() {
        if (!this.canvas) return;
        this.active = !this.active;
        if (this.active) {
            this.canvas.style.zIndex = "2147483646";
            this.canvas.style.pointerEvents = "auto";
            this.canvas.style.opacity = "1";
            // Dim background
            this.ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
            this.ctx.font = "30px Cinzel";
            this.ctx.fillStyle = "#cba35c";
            this.ctx.textAlign = "center";
            this.ctx.fillText("Draw a Rune", this.canvas.width / 2, this.canvas.height * 0.2);
            notify("info", "Rune Casting Active", "Magic");
        } else {
            this.canvas.style.zIndex = "90";
            this.canvas.style.pointerEvents = "none";
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            this.points = [];
        }
    }

    start(e) {
        if (!this.active) return;
        this.isDrawing = true;
        this.points = [];
        this.points.push({ x: e.clientX, y: e.clientY });
        this.ctx.beginPath();
        this.ctx.moveTo(e.clientX, e.clientY);
        this.ctx.strokeStyle = "#cba35c";
        this.ctx.lineWidth = 4;
        this.ctx.lineCap = "round";
        this.ctx.shadowBlur = 10;
        this.ctx.shadowColor = "#ffcc00";
    }

    move(e) {
        if (!this.active || !this.isDrawing) return;
        e.preventDefault();
        const p = { x: e.clientX, y: e.clientY };
        this.points.push(p);
        this.ctx.lineTo(p.x, p.y);
        this.ctx.stroke();

        // Particle effect?
        if (Math.random() > 0.8) {
            this.ctx.fillStyle = "#fff";
            this.ctx.fillRect(p.x + (Math.random()*10-5), p.y + (Math.random()*10-5), 2, 2);
        }
    }

    end(e) {
        if (!this.active || !this.isDrawing) return;
        this.isDrawing = false;
        this.recognize();
        // Don't clear immediately, let user see result
        setTimeout(() => {
            if (this.active) this.toggle(); // Close after cast
        }, 800);
    }

    recognize() {
        if (this.points.length < 10) return; // Too short

        // 1. Simplify path to directions
        // Divide into segments
        const segments = [];
        const threshold = 40; // min px for a segment
        let last = this.points[0];

        for (let i = 1; i < this.points.length; i++) {
            const p = this.points[i];
            const dx = p.x - last.x;
            const dy = p.y - last.y;
            const dist = Math.sqrt(dx*dx + dy*dy);

            if (dist > threshold) {
                // Determine angle
                const angle = Math.atan2(dy, dx) * 180 / Math.PI;
                // Map to 0-7 (N, NE, E, SE, S, SW, W, NW)
                // -180 to 180.
                // E = 0, S = 90, W = 180/-180, N = -90
                // Shift by 22.5 to center sectors
                let a = angle + 22.5;
                if (a < 0) a += 360;
                const dir = Math.floor(a / 45) % 8;

                // Add if different from last
                if (segments.length === 0 || segments[segments.length - 1] !== dir) {
                    segments.push(dir);
                }
                last = p;
            }
        }

        // Match against templates
        // We look for sequence containment or similarity
        // Simple containment for now

        let match = null;

        // Check Horizontal Line (Attack)
        const counts = {};
        segments.forEach(s => counts[s] = (counts[s] || 0) + 1);

        // Attack: Mostly East (2) or West (6)?
        // Let's use simple heuristics based on segments

        const sig = segments.join("");
        console.log("Rune Sig:", sig, segments);

        if (segments.includes(2) && !segments.includes(6) && segments.length < 4) match = "Attack";
        else if ((segments.includes(1) && segments.includes(3)) || (segments.includes(5) && segments.includes(7))) match = "Magic"; // ZigZag
        else if (segments.includes(4) && segments.includes(0)) match = "Inspect"; // Vertical-ish
        else if (segments.length >= 4) match = "Shield"; // Circle-ish (many directions)

        // Feedback
        this.ctx.font = "40px Cinzel";
        this.ctx.fillStyle = "#fff";
        this.ctx.textAlign = "center";

        if (match) {
            this.ctx.fillText(match + "!", this.canvas.width / 2, this.canvas.height / 2);
            triggerHaptic("success");

            // Execute Command
            const cmdMap = {
                "Attack": "/attack",
                "Magic": "/cast fireball",
                "Shield": "/cast shield",
                "Inspect": "/look",
                "Heal": "/cast heal"
            };
            const cmd = cmdMap[match];
            if (cmd) processCommand(cmd);
        } else {
            this.ctx.fillStyle = "#f00";
            this.ctx.fillText("Fizzle...", this.canvas.width / 2, this.canvas.height / 2);
            triggerHaptic("error");
        }
    }
}

export const runeCaster = new RuneCaster();

export function initRuneCasting() {
    runeCaster.init();
}

