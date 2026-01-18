export function parseJsonLoose(raw) {
    const txt = String(raw || "").trim();
    if (!txt) return null;
    try { return JSON.parse(txt.replace(/```json|```/g, "").trim()); } catch (_) {}
    const m = txt.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try { return JSON.parse(m[0]); } catch (_) { return null; }
}

export function normalizeDatabankEntryInPlace(it, { now = Date.now(), makeId = null } = {}) {
    if (!it || typeof it !== "object") return false;
    let changed = false;
    const idFactory = typeof makeId === "function" ? makeId : (() => `db_${now.toString(16)}`);

    if (it.id === undefined || it.id === null || String(it.id).trim() === "") {
        it.id = idFactory();
        changed = true;
    }
    if (typeof it.id !== "string") {
        it.id = String(it.id);
        changed = true;
    }
    if (!it.created) {
        const n = Number(it.ts || it.t || it.time || it.id);
        if (Number.isFinite(n) && n > 0) it.created = n;
        else it.created = now;
        changed = true;
    }
    if (it.created && !it.date) {
        try { it.date = new Date(Number(it.created) || now).toLocaleDateString(); changed = true; } catch (_) {}
    }
    if (it.key && !it.title) { it.title = String(it.key || "").trim(); changed = true; }
    if (it.content && !it.summary) { it.summary = String(it.content || "").trim(); changed = true; }
    if (it.entry && !it.summary) { it.summary = String(it.entry || "").trim(); changed = true; }
    return changed;
}

export function normalizeDatabankArrayInPlace(arr, { now = Date.now(), makeId = null } = {}) {
    if (!Array.isArray(arr)) return false;
    let changed = false;
    for (const it of arr) {
        if (normalizeDatabankEntryInPlace(it, { now, makeId })) changed = true;
    }
    return changed;
}

export function toDatabankDisplayEntries(arr) {
    if (!Array.isArray(arr)) return [];
    const out = [];
    for (const it of arr) {
        if (!it || typeof it !== "object") continue;
        const id = String(it.id || "").trim();
        if (!id) continue;
        const title = String(it.title || it.key || "Entry").trim() || "Entry";
        const body = String(it.summary || it.content || it.entry || "").trim();
        const created = Number(it.created || it.ts || it.t || 0) || 0;
        const date = String(it.date || (created ? new Date(created).toLocaleDateString() : "") || "").trim();
        const type = it.key || it.entry || it.content ? "lore" : "archive";
        out.push({ id, title, body, created, date, type });
    }
    return out;
}

