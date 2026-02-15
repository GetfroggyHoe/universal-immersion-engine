import { getContext } from "/scripts/extensions.js";

const EXT_ID = "universal-immersion-engine";

const MIRROR_KEY = "uie_settings_mirror_v1";
const MIRROR_IDB_FLAG_KEY = "uie_settings_mirror_idb_v1";
const MIRROR_IDB_DB = "uie_settings_mirror";
const MIRROR_IDB_STORE = "mirror";
const MIRROR_IDB_ID = "current";
let saveRetryScheduled = false;

let bootstrapSettings = {};
let bootstrapTouched = false;

const INIT_GRACE_MS = 30000;
const INIT_DEADLINE = Date.now() + INIT_GRACE_MS;

let mirrorIdbCache = null;
let mirrorIdbLoadPromise = null;

function applyMirrorToCurrent(data) {
    try {
        if (!isNonEmptyObject(data)) return false;
        if (!window.extension_settings) window.extension_settings = {};
        if (!window.extension_settings[EXT_ID] || typeof window.extension_settings[EXT_ID] !== "object") {
            window.extension_settings[EXT_ID] = {};
        }
        const current = window.extension_settings[EXT_ID];
        try {
            const curAt = Number(current?.__uie_saved_at || 0) || 0;
            const mirAt = Number(data?.__uie_saved_at || 0) || 0;
            if (hasUserData(current) && mirAt > 0 && curAt > 0 && mirAt <= curAt + 250) return false;
            if (hasUserData(current) && mirAt <= 0) return false;
        } catch (_) {
            if (hasUserData(current)) return false;
        }
        for (const k of Object.keys(current)) delete current[k];
        for (const [k, v] of Object.entries(data)) current[k] = v;

        try {
            setTimeout(() => {
                try { window.UIE_refreshStateSaves?.(); } catch (_) {}
                try {
                    const event = new CustomEvent("uie:state_updated", { detail: { mirror: true } });
                    window.dispatchEvent(event);
                } catch (_) {}
                try { updateLayout(); } catch (_) {}
            }, 0);
        } catch (_) {}
        return true;
    } catch (_) {
        return false;
    }
}

function openMirrorDb() {
    return new Promise((resolve, reject) => {
        try {
            const req = indexedDB.open(MIRROR_IDB_DB, 1);
            req.onupgradeneeded = () => {
                try {
                    const db = req.result;
                    if (!db.objectStoreNames.contains(MIRROR_IDB_STORE)) {
                        db.createObjectStore(MIRROR_IDB_STORE, { keyPath: "id" });
                    }
                } catch (_) {}
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        } catch (e) {
            reject(e);
        }
    });
}

async function mirrorDbPut(payload) {
    const db = await openMirrorDb();
    return new Promise((resolve, reject) => {
        try {
            const tx = db.transaction(MIRROR_IDB_STORE, "readwrite");
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => reject(tx.error);
            tx.objectStore(MIRROR_IDB_STORE).put(payload);
        } catch (e) {
            reject(e);
        }
    }).finally(() => {
        try { db.close(); } catch (_) {}
    });
}

async function mirrorDbGet() {
    const db = await openMirrorDb();
    return new Promise((resolve, reject) => {
        try {
            const tx = db.transaction(MIRROR_IDB_STORE, "readonly");
            const req = tx.objectStore(MIRROR_IDB_STORE).get(MIRROR_IDB_ID);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => reject(req.error);
        } catch (e) {
            reject(e);
        }
    }).finally(() => {
        try { db.close(); } catch (_) {}
    });
}

function kickMirrorIdbLoad() {
    try {
        if (mirrorIdbLoadPromise) return mirrorIdbLoadPromise;
        mirrorIdbLoadPromise = (async () => {
            try {
                const rec = await mirrorDbGet();
                const data = rec?.data;
                if (isNonEmptyObject(data)) {
                    try {
                        if (!Number(data.__uie_saved_at) && Number(rec?.at || 0)) data.__uie_saved_at = Number(rec.at || 0) || Date.now();
                    } catch (_) {}
                    mirrorIdbCache = { at: Number(rec?.at || 0) || 0, data };
                    try { localStorage.setItem(MIRROR_IDB_FLAG_KEY, String(mirrorIdbCache.at || Date.now())); } catch (_) {}
                    try { applyMirrorToCurrent(mirrorIdbCache.data); } catch (_) {}
                }
            } catch (_) {}
            return mirrorIdbCache;
        })();
        return mirrorIdbLoadPromise;
    } catch (_) {
        return null;
    }
}

// Kick off IndexedDB mirror load early so bootstrap mode can hydrate quickly even when localStorage is full.
try { kickMirrorIdbLoad(); } catch (_) {}

function isPersistentSettingsReady() {
    try {
        const es = window.extension_settings;
        if (!es || typeof es !== "object") return false;
        if (Object.prototype.hasOwnProperty.call(es, EXT_ID)) return true;
        // If we have a non-empty mirror snapshot, we can safely create & hydrate the bucket.
        try { if (hasNonEmptyMirror()) return true; } catch (_) {}
        // After a grace period, assume ST isn't going to hydrate the bucket for us.
        return Date.now() > INIT_DEADLINE;
    } catch (_) {
        return false;
    }
}

function hasUserData(s) {
    try {
        if (!s || typeof s !== "object") return false;
        const invItems = Array.isArray(s?.inventory?.items) ? s.inventory.items.length : 0;
        const hasSavedStates = s.savedStates && typeof s.savedStates === "object" && Object.keys(s.savedStates).length > 0;
        const hasCalendar = s.calendar && typeof s.calendar === "object" && s.calendar.events && Object.keys(s.calendar.events || {}).length > 0;
        const hasMap = !!(s.map && (s.map.image || (Array.isArray(s.map?.data?.nodes) && s.map.data.nodes.length)));
        const hasSocial = s.social && typeof s.social === "object" && Object.values(s.social).some(v => Array.isArray(v) && v.length);
        const hasDiary = s.diary && typeof s.diary === "object" && Object.keys(s.diary).length > 0;
        const hasDatabank = s.databank && typeof s.databank === "object" && Object.keys(s.databank).length > 0;
        return invItems > 0 || hasSavedStates || hasCalendar || hasMap || hasSocial || hasDiary || hasDatabank;
    } catch (_) {
        return false;
    }
}

function safeJson(obj) {
    try {
        const seen = new WeakSet();
        return JSON.stringify(obj, (k, v) => {
            try {
                if (typeof v === "function") return undefined;
                if (typeof v === "bigint") return Number(v);
                if (v && typeof v === "object") {
                    if (seen.has(v)) return undefined;
                    seen.add(v);
                }
            } catch (_) {}
            return v;
        });
    } catch (_) {
        try {
            return JSON.stringify(JSON.parse(JSON.stringify(obj)));
        } catch (_) {
            return "";
        }
    }
}

function isNonEmptyObject(o) {
    try {
        return !!(o && typeof o === "object" && !Array.isArray(o) && Object.keys(o).length > 0);
    } catch (_) {
        return false;
    }
}

function looksEmptySettings(s) {
    try {
        if (!s || typeof s !== "object") return true;
        const keys = Object.keys(s);
        if (!keys.length) return true;
        const invItems = Array.isArray(s?.inventory?.items) ? s.inventory.items.length : 0;
        const hasSavedStates = s.savedStates && typeof s.savedStates === "object" && Object.keys(s.savedStates).length > 0;
        const hasCalendar = s.calendar && typeof s.calendar === "object" && s.calendar.events && Object.keys(s.calendar.events || {}).length > 0;
        const hasMap = !!(s.map && (s.map.image || (Array.isArray(s.map?.data?.nodes) && s.map.data.nodes.length)));
        const hasSocial = s.social && typeof s.social === "object" && Object.values(s.social).some(v => Array.isArray(v) && v.length);
        const hasDiary = s.diary && typeof s.diary === "object" && Object.keys(s.diary).length > 0;
        const hasDatabank = s.databank && typeof s.databank === "object" && Object.keys(s.databank).length > 0;
        if (invItems > 0) return false;
        if (hasSavedStates || hasCalendar || hasMap || hasSocial || hasDiary || hasDatabank) return false;

        const keep = ["inventory", "image", "windows", "ui", "currencySymbol", "currencyRate"].filter(Boolean);
        const meaningful = keys.filter(k => !keep.includes(k));
        return meaningful.length === 0;
    } catch (_) {
        return false;
    }
}

 function hasNonEmptyMirror() {
     try {
         const raw = localStorage.getItem(MIRROR_KEY);
         if (!raw) {
            try {
                if (mirrorIdbCache && isNonEmptyObject(mirrorIdbCache.data)) return true;
            } catch (_) {}
            try { kickMirrorIdbLoad(); } catch (_) {}
            try { if (mirrorIdbLoadPromise) return true; } catch (_) {}
            try {
                const flag = localStorage.getItem(MIRROR_IDB_FLAG_KEY);
                if (flag) return true;
            } catch (_) {}
            return false;
         }
         let payload = null;
         try { payload = JSON.parse(raw); } catch (_) { payload = null; }
         const data = payload?.data;
         return isNonEmptyObject(data);
     } catch (_) {
        try {
            const flag = localStorage.getItem(MIRROR_IDB_FLAG_KEY);
            if (flag) return true;
        } catch (_) {}
        return false;
     }
 }

function writeMirror() {
    try {
        const s = window.extension_settings?.[EXT_ID];
        if (!isNonEmptyObject(s)) return;
        const payload = { at: Date.now(), data: JSON.parse(safeJson(s) || "{}") };
        localStorage.setItem(MIRROR_KEY, safeJson(payload) || "");
    } catch (e) {
        try {
            console.warn("[UIE] localStorage mirror write failed, using IndexedDB backup", e?.message ?? e);
            if (!window.UIE_mirrorWriteErrorShown) {
                window.UIE_mirrorWriteErrorShown = true;
                window.toastr?.info?.("UIE is using backup storage (localStorage full or unavailable). Your data is still saved.", "UIE");
            }
        } catch (_) {}

        try {
            const s = window.extension_settings?.[EXT_ID];
            if (!isNonEmptyObject(s)) return;
            const at = Date.now();
            const data = JSON.parse(safeJson(s) || "{}") || {};
            void mirrorDbPut({ id: MIRROR_IDB_ID, at, data }).then(() => {
                mirrorIdbCache = { at, data };
                try { localStorage.setItem(MIRROR_IDB_FLAG_KEY, String(at)); } catch (_) {}
                try { applyMirrorToCurrent(mirrorIdbCache.data); } catch (_) {}
            }).catch((err) => {
                try {
                    console.error("[UIE] IndexedDB mirror write failed", err);
                    window.toastr?.error?.("UIE could not persist settings (storage failed).", "UIE");
                } catch (_) {}
            });
        } catch (_) {}
    }
}

function writeMirrorFrom(data) {
    try {
        if (!isNonEmptyObject(data)) return;
        const payload = { at: Date.now(), data: JSON.parse(safeJson(data) || "{}") };
        localStorage.setItem(MIRROR_KEY, safeJson(payload) || "");
    } catch (e) {
        try {
            console.warn("[UIE] localStorage mirror write failed, using IndexedDB backup", e?.message ?? e);
            if (!window.UIE_mirrorWriteErrorShown) {
                window.UIE_mirrorWriteErrorShown = true;
                window.toastr?.info?.("UIE is using backup storage (localStorage full or unavailable). Your data is still saved.", "UIE");
            }
        } catch (_) {}

        try {
            if (!isNonEmptyObject(data)) return;
            const at = Date.now();
            const copy = JSON.parse(safeJson(data) || "{}") || {};
            void mirrorDbPut({ id: MIRROR_IDB_ID, at, data: copy }).then(() => {
                mirrorIdbCache = { at, data: copy };
                try { localStorage.setItem(MIRROR_IDB_FLAG_KEY, String(at)); } catch (_) {}
                try { applyMirrorToCurrent(mirrorIdbCache.data); } catch (_) {}
            }).catch((err) => {
                try {
                    console.error("[UIE] Failed to write settings mirror to IndexedDB", err);
                    window.toastr?.error?.("UIE could not persist settings (storage failed).", "UIE");
                } catch (_) {}
            });
        } catch (_) {}
    }
}

function readMirrorData() {
    try {
        const raw = localStorage.getItem(MIRROR_KEY);
        if (!raw) {
            try {
                if (mirrorIdbCache && isNonEmptyObject(mirrorIdbCache.data)) return mirrorIdbCache.data;
                try { kickMirrorIdbLoad(); } catch (_) {}
            } catch (_) {}
            return null;
        }
        let payload = null;
        try { payload = JSON.parse(raw); } catch (_) { payload = null; }
        const data = payload?.data;
        if (!isNonEmptyObject(data)) return null;
        return data;
    } catch (_) {
        try {
            if (mirrorIdbCache && isNonEmptyObject(mirrorIdbCache.data)) return mirrorIdbCache.data;
            const flag = localStorage.getItem(MIRROR_IDB_FLAG_KEY);
            if (flag) kickMirrorIdbLoad();
        } catch (_) {}
        return null;
    }
}

function readMirrorPayload() {
    try {
        const raw = localStorage.getItem(MIRROR_KEY);
        if (!raw) {
            try {
                if (mirrorIdbCache && isNonEmptyObject(mirrorIdbCache.data)) {
                    return { at: Number(mirrorIdbCache.at || 0) || 0, data: mirrorIdbCache.data };
                }
                try { kickMirrorIdbLoad(); } catch (_) {}
            } catch (_) {}
            return null;
        }
        let payload = null;
        try { payload = JSON.parse(raw); } catch (_) { payload = null; }
        const data = payload?.data;
        if (!isNonEmptyObject(data)) return null;
        const at = Number(payload?.at || 0);
        return { at: Number.isFinite(at) ? at : 0, data };
    } catch (_) {
        try {
            if (mirrorIdbCache && isNonEmptyObject(mirrorIdbCache.data)) {
                return { at: Number(mirrorIdbCache.at || 0) || 0, data: mirrorIdbCache.data };
            }
            const flag = localStorage.getItem(MIRROR_IDB_FLAG_KEY);
            if (flag) kickMirrorIdbLoad();
        } catch (_) {}
        return null;
    }
}

function restoreFromMirrorIfEmpty() {
    try {
        if (!isPersistentSettingsReady()) return;
        if (!window.extension_settings) window.extension_settings = {};
        if (!window.extension_settings[EXT_ID]) window.extension_settings[EXT_ID] = {};
        const current = window.extension_settings[EXT_ID];

        const payload = readMirrorPayload();
        const data = payload?.data;
        if (!isNonEmptyObject(data)) return;

        try {
            const curAt = Number(current?.__uie_saved_at || 0) || 0;
            const mirAt = Number(payload?.at || data?.__uie_saved_at || 0) || 0;
            if (hasUserData(current) && mirAt > 0 && curAt > 0 && mirAt <= curAt + 250) return;
            if (hasUserData(current) && mirAt <= 0) return;
        } catch (_) {
            if (hasUserData(current)) return;
        }

        for (const k of Object.keys(current)) delete current[k];
        for (const [k, v] of Object.entries(data)) current[k] = v;

        try {
            setTimeout(() => {
                try { window.UIE_refreshStateSaves?.(); } catch (_) {}
                try {
                    const event = new CustomEvent("uie:state_updated", { detail: { mirror: true } });
                    window.dispatchEvent(event);
                } catch (_) {}
                try { updateLayout(); } catch (_) {}
            }, 0);
        } catch (_) {}
    } catch (_) {}
}

export function getSettings() {
    if (!isPersistentSettingsReady()) {
        bootstrapTouched = true;
        try {
            const snap = readMirrorData();
            if (snap && bootstrapSettings && typeof bootstrapSettings === "object" && looksEmptySettings(bootstrapSettings)) {
                bootstrapSettings = JSON.parse(safeJson(snap) || "{}") || {};
            }
        } catch (_) {}
        return bootstrapSettings;
    }

    if (!window.extension_settings) window.extension_settings = {};
    if (!window.extension_settings[EXT_ID] || typeof window.extension_settings[EXT_ID] !== "object") {
        window.extension_settings[EXT_ID] = {};
    }

    const s = window.extension_settings[EXT_ID];

    // Always try to restore persisted settings BEFORE merging any bootstrap defaults.
    // Bootstrap mutations can happen early (before ST hydrates extension_settings) and would otherwise
    // make the bucket look non-empty, preventing mirror restore and causing settings loss.
    restoreFromMirrorIfEmpty();

    if (bootstrapTouched && bootstrapSettings && typeof bootstrapSettings === "object") {
        try {
            for (const [k, v] of Object.entries(bootstrapSettings)) {
                if (!(k in s)) s[k] = v;
            }
        } catch (_) {}
        bootstrapTouched = false;
        bootstrapSettings = {};
    }
    return s;
}

export function saveSettings() {
    const context = getContext();
    if (!isPersistentSettingsReady()) {
        bootstrapTouched = true;
        try { if (bootstrapSettings && typeof bootstrapSettings === "object") bootstrapSettings.__uie_saved_at = Date.now(); } catch (_) {}
        try { writeMirrorFrom(bootstrapSettings); } catch (_) {}
        if (!saveRetryScheduled) {
            saveRetryScheduled = true;
            setTimeout(() => {
                saveRetryScheduled = false;
                try { saveSettings(); } catch (_) {}
            }, 1000);
        }
        return;
    }

    // IMPORTANT: Ensure any bootstrap writes are merged into the real settings bucket
    // BEFORE we persist to mirror / ST disk. Otherwise we can end up saving an empty bucket.
    let live = null;
    try { live = getSettings(); } catch (_) { live = null; }
    
    // Ensure chat state is synced before saving
    try { saveCurrentChatState(); } catch (_) {}

    try { window.UIE_backupMaybe?.(); } catch (_) {}
    try {
        if (live && typeof live === "object") {
            try { live.__uie_saved_at = Date.now(); } catch (_) {}
            writeMirrorFrom(live);
        }
        else writeMirror();
    } catch (_) {}
    if (window.saveSettingsDebounced) {
        window.saveSettingsDebounced();
    }

    if (context && context.saveSettings) {
        try { context.saveSettings(); } catch (_) {}
        return;
    }

    if (!saveRetryScheduled) {
        saveRetryScheduled = true;
        setTimeout(() => {
            saveRetryScheduled = false;
            try {
                const ctx = getContext();
                if (ctx && ctx.saveSettings) ctx.saveSettings();
            } catch (_) {}
        }, 1000);
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

try {
    window.UIE = window.UIE || {};
    window.UIE.getSettings = getSettings;
    window.UIE.saveSettings = saveSettings;
    window.UIE.commitStateUpdate = commitStateUpdate;
} catch (_) {}

export function failsafeRecover(opts = {}) {
    try { kickMirrorIdbLoad(); } catch (_) {}
    try { restoreFromMirrorIfEmpty(); } catch (_) {}
    try { updateLayout(); } catch (_) {}
    try { window.UIE_refreshStateSaves?.(); } catch (_) {}
    try {
        const event = new CustomEvent("uie:state_updated", { detail: { ...(opts || {}), failsafe: true } });
        window.dispatchEvent(event);
    } catch (_) {}
}

try { window.UIE_failsafeRecover = failsafeRecover; } catch (_) {}

function clampMenuIfNeeded() {
    try {
        const el = document.getElementById("uie-main-menu");
        if (!el) return;
        const style = window.getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden") return;
        const rect = el.getBoundingClientRect();
        const vw = window.innerWidth || document.documentElement.clientWidth || 0;
        const vh = window.innerHeight || document.documentElement.clientHeight || 0;
        if (!(vw > 0 && vh > 0)) return;

        const pad = 10;
        const out = rect.right < pad || rect.bottom < pad || rect.left > vw - pad || rect.top > vh - pad;
        if (!out) return;

        const s = getSettings();
        const rawScale = Number(s?.ui?.scale ?? s?.uiScale ?? 1);
        const scale = Math.max(0.5, Math.min(1.5, Number.isFinite(rawScale) ? rawScale : 1));
        const useScale = scale !== 1;

        const w = rect.width || 320;
        const h = rect.height || 420;
        let left = rect.left;
        let top = rect.top;
        if (!Number.isFinite(left)) left = pad;
        if (!Number.isFinite(top)) top = pad;
        if (left < pad) left = pad;
        if (top < pad) top = pad;
        if (left > vw - w - pad) left = vw - w - pad;
        if (top > vh - h - pad) top = vh - h - pad;

        el.style.position = "fixed";
        el.style.left = `${left}px`;
        el.style.top = `${top}px`;
        el.style.right = "auto";
        el.style.bottom = "auto";
        el.style.transformOrigin = "top left";
        el.style.transform = useScale ? `scale(${scale})` : "none";
    } catch (_) {}
}

function startFailsafeWatchdog() {
    try {
        if (window.__uieFailsafeWatchdogStarted) return;
        window.__uieFailsafeWatchdogStarted = true;
    } catch (_) {}

    let lastRecoverAt = 0;
    const tick = () => {
        try {
            if (window.UIE_isDragging) return;
        } catch (_) {}

        try { clampMenuIfNeeded(); } catch (_) {}

        const now = Date.now();
        if (now - lastRecoverAt < 2500) return;

        try {
            const s = getSettings();
            if (!s || typeof s !== "object") return;
            if (looksEmptySettings(s)) {
                const hasMirror = hasNonEmptyMirror();
                if (hasMirror) {
                    lastRecoverAt = now;
                    failsafeRecover({ reason: "empty_settings" });
                }
            }
        } catch (_) {}
    };

    try { setInterval(tick, 1500); } catch (_) {}
    try { setTimeout(tick, 1000); } catch (_) {}
}

try { startFailsafeWatchdog(); } catch (_) {}

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
    const persistent = isPersistentSettingsReady();
    const s = getSettings();

    // If settings are still an empty shell, don't stamp defaults over real data that hasn't hydrated yet.
    // Give ST a moment to populate extension_settings from disk; if it doesn't, then proceed.
    if (persistent && looksEmptySettings(s) && Date.now() < INIT_DEADLINE) {
        try {
            // If there may be a mirror (localStorage or IndexedDB), give it a chance to hydrate before stamping defaults.
            try { kickMirrorIdbLoad(); } catch (_) {}
            const maybeMirror = hasNonEmptyMirror();
            if (maybeMirror) throw new Error("extension_settings not hydrated yet");

            // Even if we can't detect a mirror synchronously (e.g. IDB-only), wait briefly during init.
            if (mirrorIdbLoadPromise) throw new Error("extension_settings not hydrated yet");
        } catch (_) {
            throw new Error("extension_settings not hydrated yet");
        }
    }

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

    try {
        if (!s.ui) s.ui = {};
        const raw = Number(s?.ui?.scale ?? s?.uiScale);
        if (!Number.isFinite(raw) || raw <= 0) {
            s.ui.scale = 0.8;
            s.uiScale = 0.8;
        } else {
            if (!Number.isFinite(Number(s.ui.scale))) s.ui.scale = raw;
            if (!Number.isFinite(Number(s.uiScale))) s.uiScale = raw;
        }
    } catch (_) {}

    // Never persist an effectively-empty settings object during init.
    // This prevents overwriting real user settings that haven't hydrated yet.
    if (persistent && !looksEmptySettings(s)) saveSettings();
}

export function isMobileUI() {
    return $(window).width() < 800 || navigator.maxTouchPoints > 0;
}

// --- CHAT PERSISTENCE ---
let lastChatId = null;
// savedStates is global (library of manual saves) - never per-chat, never reset on new chat
const SESSION_KEYS = [
    "inventory", "character", "currency", "currencySymbol", "currencyRate", 
    "calendar", "map", "social", "diary", "databank", "activities",
    "xp", "hp", "mp", "ap", "maxHp", "maxMp", "maxAp", "maxXp", "life", "image"
];

function saveCurrentChatState() {
    if (!lastChatId) return;
    const s = getSettings();
    if (!s.chats) s.chats = {};
    
    const data = {};
    let hasData = false;
    for (const k of SESSION_KEYS) {
        if (s[k] !== undefined) {
            data[k] = s[k];
            hasData = true;
        }
    }
    
    if (hasData) {
        s.chats[lastChatId] = JSON.parse(safeJson(data));
    }
}

function loadChatState(chatId) {
    const s = getSettings();
    
    // First, ensure we save the PREVIOUS chat state if we switched
    if (lastChatId && lastChatId !== chatId) {
        saveCurrentChatState();
    }
    
    lastChatId = chatId;
    
    if (!chatId) return; // No chat loaded
    
    const saved = s.chats?.[chatId];
    
    if (saved) {
        // Restore saved data
        for (const k of SESSION_KEYS) {
            if (saved[k] !== undefined) {
                s[k] = JSON.parse(safeJson(saved[k]));
            } else {
                delete s[k];
            }
        }
    } else {
        // New chat or no data: Reset session keys to defaults
        for (const k of SESSION_KEYS) {
            delete s[k];
        }
    }
    
    // Re-hydrate defaults
    sanitizeSettings();
    
    // Persist chat state to disk (save current chat storage + session state)
    try { saveSettings(); } catch (_) {}
    
    // Notify system
    setTimeout(() => {
        try { window.UIE_refreshStateSaves?.(); } catch (_) {}
        try {
            const event = new CustomEvent("uie:state_updated", { detail: { chatLoad: true } });
            window.dispatchEvent(event);
        } catch (_) {}
        try { updateLayout(); } catch (_) {}
        
        // Refresh specific modules that might be stale
        try { import("./features/life.js").then(m => m.render?.()); } catch (_) {}
        try { import("./features/items.js").then(m => m.render?.()); } catch (_) {}
        try { import("./features/skills.js").then(m => m.init?.()); } catch (_) {}
        try { import("./features/assets.js").then(m => m.init?.()); } catch (_) {}
    }, 50);
}

// Hook into saveSettings to ensure we keep the chat storage updated
const originalSave = saveSettings;
// We can't easily wrap the export, so we inject logic inside saveSettings via the existing function structure
// or we add a periodic check.

function checkChatIdAndLoad() {
    try {
        const ctx = getContext();
        const cid = ctx ? ctx.chatId : null;
        if (cid !== lastChatId) {
            if (lastChatId !== null) {
                console.log(`[UIE] Chat changed: ${lastChatId} -> ${cid}`);
                loadChatState(cid);
            } else {
                lastChatId = cid;
                if (cid) loadChatState(cid);
            }
        }
    } catch (_) {}
}

let chatPollInterval = null;
function initChatPersistence() {
    if (chatPollInterval) return;
    checkChatIdAndLoad();
    chatPollInterval = setInterval(checkChatIdAndLoad, 1000);
}

// Start monitoring
initChatPersistence();

export function updateLayout() {
    const s = getSettings();

    try {
        const raw = Number(s?.ui?.scale ?? s?.uiScale ?? 1);
        const scale = Math.max(0.5, Math.min(1.5, Number.isFinite(raw) ? raw : 1));
        document.documentElement.style.setProperty("--uie-scale", scale);
        const slider = document.getElementById("uie-scale-slider");
        if (slider) slider.value = String(scale);
        const disp = document.getElementById("uie-scale-display");
        if (disp) disp.textContent = scale.toFixed(1);
    } catch (_) {}

    // Always keep the launcher visible (unless explicitly hidden) and on-screen.
    // On mobile we skip window clamping, but the launcher must still be corrected.
    try {
        const launcher = document.getElementById("uie-launcher");
        if (launcher) {
            const hidden = s?.launcher?.hidden === true;
            launcher.style.display = hidden ? "none" : "flex";

            if (!hidden) {
                const rect = launcher.getBoundingClientRect();
                const vw = window.innerWidth || document.documentElement.clientWidth || 0;
                const vh = window.innerHeight || document.documentElement.clientHeight || 0;
                const w = rect.width || launcher.offsetWidth || 60;
                const h = rect.height || launcher.offsetHeight || 60;

                const pad = 6;
                const outOfView =
                    rect.right < pad ||
                    rect.bottom < pad ||
                    rect.left > vw - pad ||
                    rect.top > vh - pad;

                if (outOfView && vw > 0 && vh > 0) {
                    let left = rect.left;
                    let top = rect.top;
                    if (!Number.isFinite(left)) left = pad;
                    if (!Number.isFinite(top)) top = pad;
                    if (left < pad) left = pad;
                    if (top < pad) top = pad;
                    if (left > vw - w - pad) left = vw - w - pad;
                    if (top > vh - h - pad) top = vh - h - pad;

                    launcher.style.position = "fixed";
                    launcher.style.left = `${left}px`;
                    launcher.style.top = `${top}px`;
                    launcher.style.right = "auto";
                    launcher.style.bottom = "auto";
                }
            }
        }
    } catch (_) {}

    if (isMobileUI()) return; // Skip rigid clamping on mobile to prevent crashes

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

$("body")
    .off("change.uieCoreKill")
    .on("change.uieCoreKill", "#uie-setting-enable", function (e) {
        try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
        const on = $(this).prop("checked") === true;
        console.log("[UIE] Kill Switch toggled:", on);
        try { window.UIE_lastCoreToggle = { id: String(this?.id || ""), on, at: Date.now() }; } catch (_) {}
        const s = getSettings();
        s.enabled = on === true;
        saveSettings();
        try {
            document.querySelectorAll("#uie-setting-enable").forEach((el) => {
                try { el.checked = on; } catch (_) {}
            });
        } catch (_) {}
        if (s.enabled === false) {
            try { $("#uie-main-menu").hide(); } catch (_) {}
            try { $(".uie-window, .uie-overlay, .uie-modal, .uie-full-modal").hide(); } catch (_) {}
        }
        try { updateLayout(); } catch (_) {}
    })
    .off("change.uieCoreScanAll")
    .on("change.uieCoreScanAll", "#uie-scanall-enable, #uie-sw-scanall-enable, #uie-wand-scanall-enable", function (e) {
        try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
        const on = $(this).prop("checked") === true;
        try { window.UIE_lastCoreToggle = { id: String(this?.id || ""), on, at: Date.now() }; } catch (_) {}
        const s = getSettings();
        if (!s.generation || typeof s.generation !== "object") s.generation = {};
        s.generation.scanAllEnabled = on === true;
        saveSettings();
        try {
            document.querySelectorAll("#uie-scanall-enable, #uie-sw-scanall-enable, #uie-wand-scanall-enable").forEach((el) => {
                try { el.checked = on; } catch (_) {}
            });
        } catch (_) {}
    })
    .off("change.uieCoreSysChecks")
    .on("change.uieCoreSysChecks", "#uie-systemchecks-enable, #uie-sw-systemchecks-enable, #uie-wand-systemchecks-enable", function (e) {
        try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
        const on = $(this).prop("checked") === true;
        try { window.UIE_lastCoreToggle = { id: String(this?.id || ""), on, at: Date.now() }; } catch (_) {}
        const s = getSettings();
        if (!s.generation || typeof s.generation !== "object") s.generation = {};
        s.generation.allowSystemChecks = on === true;
        saveSettings();
        try {
            document.querySelectorAll("#uie-systemchecks-enable, #uie-sw-systemchecks-enable, #uie-wand-systemchecks-enable").forEach((el) => {
                try { el.checked = on; } catch (_) {}
            });
        } catch (_) {}
    })
    .off("change.uieCorePopups")
    .on("change.uieCorePopups", "#uie-show-popups", function (e) {
        try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
        const on = $(this).prop("checked") === true;
        try { window.UIE_lastCoreToggle = { id: String(this?.id || ""), on, at: Date.now() }; } catch (_) {}
        const s = getSettings();
        if (!s.ui || typeof s.ui !== "object") s.ui = {};
        s.ui.showPopups = on === true;
        saveSettings();
        try {
            document.querySelectorAll("#uie-show-popups").forEach((el) => {
                try { el.checked = on; } catch (_) {}
            });
        } catch (_) {}
    });
