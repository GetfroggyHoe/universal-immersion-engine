const DATABANK_MAX_ENTRIES = 400;
const DATABANK_SUMMARY_MAX = 1200;

export function toCanonicalDatabankEntry(raw, opts = {}) {
    if (!raw || typeof raw !== "object") return null;
    const now = opts?.now ?? Date.now();
    const makeId = opts?.makeId ?? (() => `db_${Date.now().toString(16)}_${Math.floor(Math.random() * 1e9).toString(16)}`);
    const title = String(raw?.title ?? raw?.key ?? "Entry").trim().slice(0, 80) || "Entry";
    const summary = String(raw?.summary ?? raw?.content ?? raw?.entry ?? "").trim().slice(0, DATABANK_SUMMARY_MAX);
    const created = Number(raw?.created ?? raw?.ts ?? now) || now;
    const tags = Array.isArray(raw?.tags) ? raw.tags.map(t => String(t || "").trim()).filter(Boolean).slice(0, 12) : (raw?.tags ? [String(raw.tags)] : ["auto"]);
    return {
        id: String(raw?.id || makeId()).trim() || makeId(),
        title,
        summary,
        content: summary,
        created,
        date: raw?.date ?? new Date(created).toLocaleDateString(),
        tags
    };
}

export function addDatabankEntryWithDedupe(arr, raw, opts = {}) {
    if (!Array.isArray(arr)) return false;
    const entry = toCanonicalDatabankEntry(raw, opts);
    if (!entry) return false;
    const titleKey = entry.title.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 60);
    const exists = arr.some(e => {
        const t = String(e?.title ?? e?.key ?? "").toLowerCase().replace(/\s+/g, " ").trim().slice(0, 60);
        return t && t === titleKey;
    });
    if (exists) return false;
    arr.push(entry);
    while (arr.length > DATABANK_MAX_ENTRIES) {
        arr.sort((a, b) => (Number(a?.created ?? 0) || 0) - (Number(b?.created ?? 0) || 0));
        arr.shift();
    }
    return true;
}

export function parseJsonLoose(text) {
    try {
        let str = String(text || "").trim();
        if (str.startsWith("```")) {
            str = str.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
        }
        return JSON.parse(str);
    } catch (e) {
        return null;
    }
}

export function normalizeDatabankArrayInPlace(arr, opts) {
    if (!Array.isArray(arr)) return false;
    let changed = false;
    const now = opts?.now || Date.now();
    const makeId = opts?.makeId || (() => `db_${Date.now().toString(16)}_${Math.floor(Math.random() * 1e9).toString(16)}`);

    for (let i = 0; i < arr.length; i++) {
        const e = arr[i];
        if (!e || typeof e !== "object") continue;
        const canonical = toCanonicalDatabankEntry(e, { now, makeId });
        if (!canonical) continue;
        const needsUpdate = !e.title && e.key || !e.summary && (e.content || e.entry) || !e.id || !e.created;
        if (needsUpdate) {
            Object.assign(e, canonical);
            changed = true;
        }
    }
    return changed;
}

export function toDatabankDisplayEntries(arr) {
    if (!Array.isArray(arr)) return [];
    return arr.map(entry => ({
        id: entry.id,
        title: entry.title || "Entry",
        body: entry.summary || entry.content || "",
        date: entry.date || new Date(entry.created || Date.now()).toLocaleDateString(),
        type: (entry.tags && entry.tags.includes("lore")) ? "lore" : "memory"
    }));
}
