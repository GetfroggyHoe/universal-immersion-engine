import { getSettings, saveSettings, updateLayout } from "./core.js";

let bound = false;
let lastAutoAt = 0;
let lastAutoSig = "";

const DB_NAME = "uie_backups";
const DB_VERSION = 1;
const STORE = "backups";
const MAX_BACKUPS = 20;

const HAD_DATA_KEY = "uie_had_data_v1";
const PROMPTED_KEY = "uie_autorestore_prompted_v1";

function nowId() {
    return Date.now();
}

function markHadDataIfNeeded(s) {
    try {
        if (!stateLooksEmpty(s)) localStorage.setItem(HAD_DATA_KEY, "1");
    } catch (_) {}
}

function hadDataBefore() {
    try {
        return localStorage.getItem(HAD_DATA_KEY) === "1";
    } catch (_) {
        return false;
    }
}

function promptedThisSession() {
    try {
        return sessionStorage.getItem(PROMPTED_KEY) === "1";
    } catch (_) {
        return false;
    }
}

function setPromptedThisSession() {
    try {
        sessionStorage.setItem(PROMPTED_KEY, "1");
    } catch (_) {}
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

function snapshotState() {
    const s = getSettings();
    const clone = JSON.parse(safeJson(s) || "{}");
    return clone && typeof clone === "object" ? clone : {};
}

function openDb() {
    return new Promise((resolve, reject) => {
        try {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(STORE)) {
                    db.createObjectStore(STORE, { keyPath: "id" });
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        } catch (e) {
            reject(e);
        }
    });
}

async function dbPut(record) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        try {
            const tx = db.transaction(STORE, "readwrite");
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => reject(tx.error);
            tx.objectStore(STORE).put(record);
        } catch (e) {
            reject(e);
        }
    }).finally(() => {
        try { db.close(); } catch (_) {}
    });
}

async function dbGetLatest() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        try {
            const tx = db.transaction(STORE, "readonly");
            const store = tx.objectStore(STORE);
            const req = store.getAll();
            req.onsuccess = () => {
                const arr = Array.isArray(req.result) ? req.result : [];
                arr.sort((a, b) => Number(b?.id || 0) - Number(a?.id || 0));
                resolve(arr[0] || null);
            };
            req.onerror = () => reject(req.error);
        } catch (e) {
            reject(e);
        }
    }).finally(() => {
        try { db.close(); } catch (_) {}
    });
}

async function dbTrim() {
    const db = await openDb();
    try {
        const ids = await new Promise((resolve, reject) => {
            try {
                const tx = db.transaction(STORE, "readonly");
                const store = tx.objectStore(STORE);
                const req = store.getAllKeys();
                req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
                req.onerror = () => reject(req.error);
            } catch (e) {
                reject(e);
            }
        });
        const sorted = ids.map(Number).filter(Number.isFinite).sort((a, b) => b - a);
        const toDelete = sorted.slice(MAX_BACKUPS);
        if (!toDelete.length) return;
        await new Promise((resolve, reject) => {
            try {
                const tx = db.transaction(STORE, "readwrite");
                tx.oncomplete = () => resolve(true);
                tx.onerror = () => reject(tx.error);
                const store = tx.objectStore(STORE);
                for (const id of toDelete) store.delete(id);
            } catch (e) {
                reject(e);
            }
        });
    } finally {
        try { db.close(); } catch (_) {}
    }
}

function stateLooksEmpty(s) {
    try {
        if (!s || typeof s !== "object") return true;
        const invItems = Array.isArray(s?.inventory?.items) ? s.inventory.items.length : 0;
        const hasSavedStates = s.savedStates && typeof s.savedStates === "object" && Object.keys(s.savedStates).length > 0;
        const hasCalendar = s.calendar && typeof s.calendar === "object" && s.calendar.events && Object.keys(s.calendar.events || {}).length > 0;
        const hasMap = !!(s.map && (s.map.image || (Array.isArray(s.map?.data?.nodes) && s.map.data.nodes.length)));
        const hasSocial = s.social && typeof s.social === "object" && Object.values(s.social).some(v => Array.isArray(v) && v.length);
        const hasDiary = s.diary && typeof s.diary === "object" && Object.keys(s.diary).length > 0;
        const hasDatabank = s.databank && typeof s.databank === "object" && Object.keys(s.databank).length > 0;
        if (invItems > 0) return false;
        if (hasSavedStates || hasCalendar || hasMap || hasSocial || hasDiary || hasDatabank) return false;
        const keys = Object.keys(s).filter(k => !["inventory", "image", "windows", "ui", "currencySymbol", "currencyRate"].includes(k));
        return keys.length === 0;
    } catch (_) {
        return false;
    }
}

function downloadJson(filename, obj) {
    const json = JSON.stringify(obj, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

export async function createBackup(reason = "manual") {
    try {
        const state = snapshotState();
        try { markHadDataIfNeeded(state); } catch (_) {}
        const rec = { id: nowId(), at: Date.now(), reason: String(reason || "manual"), data: state };
        await dbPut(rec);
        await dbTrim();
        return rec;
    } catch (e) {
        try { console.error("[UIE] Backup failed", e); } catch (_) {}
        return null;
    }
}

export async function restoreLatestBackup() {
    const rec = await dbGetLatest();
    if (!rec || !rec.data || typeof rec.data !== "object") return false;
    const target = getSettings();
    for (const k of Object.keys(target)) delete target[k];
    for (const [k, v] of Object.entries(rec.data)) target[k] = v;
    saveSettings();
    try { updateLayout(); } catch (_) {}
    try { window.UIE_refreshStateSaves?.(); } catch (_) {}
    try { window.toastr?.success?.("UIE restored from latest backup.", "UIE"); } catch (_) {}
    return true;
}

export async function backupMaybeAuto() {
    const now = Date.now();
    if (now - lastAutoAt < 45000) return;
    const state = snapshotState();
    const sig = `${Object.keys(state).length}:${safeJson(state).length}`;
    if (sig === lastAutoSig) {
        lastAutoAt = now;
        return;
    }
    lastAutoAt = now;
    lastAutoSig = sig;
    await createBackup("auto");
}

async function maybeOfferAutoRestore() {
    try {
        if (promptedThisSession()) return;
        const s = getSettings();
        if (!stateLooksEmpty(s)) return;
        const latest = await dbGetLatest();
        if (!latest) return;
        if (!latest.data || typeof latest.data !== "object") return;
        if (stateLooksEmpty(latest.data)) return;
        if (!hadDataBefore()) return;
        setPromptedThisSession();
        await restoreLatestBackup();
    } catch (_) {}
}

function readFileAsText(file) {
    return new Promise((resolve) => {
        try {
            const r = new FileReader();
            r.onload = () => resolve(String(r.result || ""));
            r.onerror = () => resolve("");
            r.readAsText(file);
        } catch (_) {
            resolve("");
        }
    });
}

async function importJsonFile(file) {
    const txt = await readFileAsText(file);
    if (!txt) return false;
    let obj = null;
    try {
        obj = JSON.parse(txt);
    } catch (_) {
        obj = null;
    }
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return false;
    const target = getSettings();
    for (const k of Object.keys(target)) delete target[k];
    for (const [k, v] of Object.entries(obj)) target[k] = v;
    saveSettings();
    try { updateLayout(); } catch (_) {}
    try { window.UIE_refreshStateSaves?.(); } catch (_) {}
    await createBackup("import");
    return true;
}

export function initBackups() {
    if (bound) return;
    bound = true;

    try {
        window.UIE_backupMaybe = backupMaybeAuto;
        window.UIE_backupNow = createBackup;
        window.UIE_restoreLatestBackup = restoreLatestBackup;
    } catch (_) {}

    $(document)
        .off("click.uieBackupNow")
        .on("click.uieBackupNow", "#uie-backup-now, #uie-sw-backup-now", async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const rec = await createBackup("manual");
            if (rec) {
                try { window.toastr?.success?.("Backup created.", "UIE"); } catch (_) {}
            } else {
                try { window.toastr?.error?.("Backup failed.", "UIE"); } catch (_) {}
            }
        })
        .off("click.uieBackupRestore")
        .on("click.uieBackupRestore", "#uie-backup-restore, #uie-sw-backup-restore", async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const ok = window.confirm("Restore UIE state from latest backup? This will overwrite current UIE settings.");
            if (!ok) return;
            const done = await restoreLatestBackup();
            if (!done) {
                try { window.toastr?.warning?.("No backup found.", "UIE"); } catch (_) {}
            }
        })
        .off("click.uieBackupExport")
        .on("click.uieBackupExport", "#uie-backup-export, #uie-sw-backup-export", async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const state = snapshotState();
            downloadJson(`uie_backup_${new Date().toISOString().slice(0, 10)}.json`, state);
        })
        .off("click.uieBackupImport")
        .on("click.uieBackupImport", "#uie-backup-import, #uie-sw-backup-import", (e) => {
            e.preventDefault();
            e.stopPropagation();
            const id = String(e.currentTarget.id || "").includes("sw-") ? "uie-sw-backup-file" : "uie-backup-file";
            document.getElementById(id)?.click?.();
        })
        .off("change.uieBackupFile")
        .on("change.uieBackupFile", "#uie-backup-file, #uie-sw-backup-file", async function (e) {
            e.preventDefault();
            e.stopPropagation();
            const f = e.target && e.target.files ? e.target.files[0] : null;
            if (!f) return;
            const ok = window.confirm("Import UIE backup JSON? This will overwrite current UIE settings.");
            if (!ok) { try { e.target.value = ""; } catch (_) {} return; }
            const done = await importJsonFile(f);
            try { e.target.value = ""; } catch (_) {}
            if (done) {
                try { window.toastr?.success?.("Backup imported.", "UIE"); } catch (_) {}
            } else {
                try { window.toastr?.error?.("Import failed (invalid file).", "UIE"); } catch (_) {}
            }
        });

    maybeOfferAutoRestore().then(() => createBackup("init")).catch(() => {});
}
