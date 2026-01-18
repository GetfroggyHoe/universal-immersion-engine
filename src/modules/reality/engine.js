import { getSettings, saveSettings } from "../core.js";

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

