import { getSettings, saveSettings, ensureChatStateLoaded, commitStateUpdate } from "./core.js";
import { generateContent } from "./apiClient.js";
import { getWorldState } from "./stateTracker.js";
import { getContext } from "/scripts/extensions.js";
import { injectRpEvent } from "./features/rp_log.js";
import { parseJsonLoose, normalizeDatabankArrayInPlace, toDatabankDisplayEntries, addDatabankEntryWithDedupe } from "./databankModel.js";

function esc(s) {
    return String(s ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function newId(prefix) {
    return `${String(prefix || "id")}_${Date.now().toString(16)}_${Math.floor(Math.random() * 1e9).toString(16)}`;
}

function normalizeMemoryTitle(rawTitle, rawSummary = "") {
    const summary = String(rawSummary || "").trim();
    let title = String(rawTitle || "")
        .replace(/[\r\n\t]+/g, " ")
        .replace(/[\[\]{}<>]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 80);

    const generic = new Set([
        "memory",
        "memories",
        "entry",
        "log",
        "story",
        "event",
        "update",
        "specific title",
    ]);

    const key = title.toLowerCase().replace(/\s+/g, " ").trim();
    if (!title || title.length < 6 || generic.has(key)) {
        const lead = summary
            .replace(/[\r\n]+/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .split(/[.!?]/)
            .map((x) => String(x || "").trim())
            .find(Boolean) || "";
        title = lead.slice(0, 80);
    }

    if (!title) {
        const d = new Date();
        title = `Memory ${d.toLocaleDateString()}`;
    }
    return title;
}

function parseTagsInput(raw, fallback = []) {
    const tags = String(raw || "")
        .split(",")
        .map((t) => String(t || "").trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 12);
    if (tags.length) return tags;
    const fb = Array.isArray(fallback)
        ? fallback.map((t) => String(t || "").trim().toLowerCase()).filter(Boolean).slice(0, 12)
        : [];
    return fb.length ? fb : ["manual"];
}

function getChatSnippet(max) {
    try {
        let raw = "";
        const $txt = $(".chat-msg-txt");
        if ($txt.length) {
            $txt.slice(-1 * Math.max(1, Number(max || 50))).each(function () { raw += $(this).text() + "\n"; });
            return raw.trim().slice(0, 6000);
        }
        const chatEl = document.getElementById("chat");
        if (!chatEl) return "";
        const msgs = Array.from(chatEl.querySelectorAll(".mes")).slice(-1 * Math.max(1, Number(max || 50)));
        for (const m of msgs) {
            const isUser =
                m.classList?.contains("is_user") ||
                m.getAttribute?.("is_user") === "true" ||
                m.getAttribute?.("data-is-user") === "true" ||
                m.dataset?.isUser === "true";
            const t =
                m.querySelector?.(".mes_text")?.textContent ||
                m.querySelector?.(".mes-text")?.textContent ||
                m.textContent ||
                "";
            const line = `${isUser ? "You" : "Story"}: ${String(t || "").trim()}`;
            if (!line.trim()) continue;
            raw += line.slice(0, 520) + "\n";
        }
        return raw.trim().slice(0, 6000);
    } catch (_) {
        return "";
    }
}

export async function scanDatabankFromChat(opts = {}) {
    const maxMessages = Math.max(50, Number(opts?.maxMessages || 80));
    const silent = opts?.silent === true;
    const allow = getSettings()?.ai?.databankScan !== false;
    if (!allow) {
        if (!silent) {
            try { window.toastr?.info?.("Databank scan is disabled in settings."); } catch (_) {}
        }
        return { ok: false, reason: "disabled" };
    }

    const rawLog = getChatSnippet(maxMessages);
    if (!rawLog || rawLog.length < 50) {
        if (!silent) {
            try { window.toastr?.info?.("Not enough chat data to archive."); } catch (_) {}
        }
        return { ok: false, reason: "not_enough_chat" };
    }

    const prompt = `Task: Generate a detailed "Memory File" for the Databank based on this RP segment.
Input:
${rawLog.substring(0, 5000)}

Instructions:
1. Title must be specific and human-readable (4-10 words), format like: "Who/Where - What changed".
2. Never use generic names like "Memory", "Entry", "Story Update", or "Event".
3. Write a detailed summary (4-6 sentences) capturing key events, important decisions, new information about characters/locations, and any changes in relationships or quest status. Avoid vague phrasing. Be specific.
4. Optional tags should be short lowercase keywords.

Output JSON: { "title": "Specific Title", "summary": "Detailed summary...", "tags": ["optional","tags"] }`;

    try {
        const res = await generateContent(prompt, "System Check");
        const data = parseJsonLoose(res);
        if (!data || typeof data !== "object") throw new Error("Bad JSON response");

        const s = getSettings();
        ensureDatabank(s);
        const beforeLen = Array.isArray(s.databank) ? s.databank.length : 0;

        const summary = String(data.summary || data.content || "").trim().slice(0, 1200);
        if (!summary) throw new Error("Missing summary");
        const title = normalizeMemoryTitle(data.title, summary);
        const tags = Array.isArray(data.tags)
            ? data.tags.map((t) => String(t || "").trim().toLowerCase()).filter(Boolean).slice(0, 12)
            : ["auto"];

        const addOpts = { now: Date.now(), makeId: () => newId("db") };
        addDatabankEntryWithDedupe(s.databank, { title, summary, tags }, addOpts);

        const afterLen = Array.isArray(s.databank) ? s.databank.length : 0;
        const added = Math.max(0, afterLen - beforeLen);

        saveSettings();
        try { render(); } catch (_) {}
        try { renderState(); } catch (_) {}

        if (!silent) {
            if (added > 0) {
                try { window.toastr?.success?.("Databank updated."); } catch (_) {}
            } else {
                try { window.toastr?.info?.("No new databank entry to add."); } catch (_) {}
            }
        }
        return { ok: true, added };
    } catch (e) {
        if (!silent) {
            try { window.toastr?.error?.("Databank scan failed (check console)."); } catch (_) {}
        }
        try { console.error(e); } catch (_) {}
        return { ok: false, reason: "scan_failed", error: String(e?.message || e || "") };
    }
}
function ensureDatabank(s) {
    if (!s.databank) s.databank = [];
    if (!Array.isArray(s.databank)) s.databank = [];
    const changed = normalizeDatabankArrayInPlace(s.databank, { now: Date.now(), makeId: () => newId("db") });
    if (changed) saveSettings();
}

function ensureSocial(s) {
    if (!s.social) s.social = { friends: [], associates: [], romance: [], family: [], rivals: [] };
    ["friends", "associates", "romance", "family", "rivals"].forEach(k => { if (!Array.isArray(s.social[k])) s.social[k] = []; });
    ["friends", "associates", "romance", "family", "rivals"].forEach(k => {
        (s.social[k] || []).forEach(p => {
            if (!p || typeof p !== "object") return;
            if (!p.id) p.id = newId("person");
            if (!Array.isArray(p.memories)) p.memories = [];
        });
    });
}

let dbSocialActivePersonId = "";
let dbRenderLimit = 60;
let dbLastListSig = "";

function refreshLinkedSocialState({ rerenderProfiles = false, rerenderModal = false } = {}) {
    try {
        commitStateUpdate({ save: true, layout: false, emit: true });
    } catch (_) {
        try { saveSettings(); } catch (_) {}
    }
    if (rerenderProfiles) {
        try { renderSocialProfiles(); } catch (_) {}
    }
    if (rerenderModal) {
        try { renderSocialMemoriesModal(); } catch (_) {}
    }
}

function buildDatabankRenderSignature(entries, socialIndex) {
    const list = Array.isArray(entries) ? entries : [];
    const tailSig = list
        .slice(-8)
        .map((m) => {
            const id = String(m?.id || "");
            const title = String(m?.title || "").trim().slice(0, 48);
            const body = String(m?.body || "").trim().slice(0, 96);
            const date = String(m?.date || "").trim();
            return `${id}|${title}|${body}|${date}`;
        })
        .join("~");
    const socialSig = (Array.isArray(socialIndex?.list) ? socialIndex.list : [])
        .slice(0, 220)
        .map((p) => `${normalizeNameKey(p?.name || "")}:${String(p?.id || "")}`)
        .join("|");
    return `${list.length}|${dbRenderLimit}|${tailSig}|${socialSig}`;
}

function normalizeNameKey(name) {
    return String(name || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function escapeRegExp(str) {
    return String(str || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function lineMentionsName(line, name) {
    const src = normalizeNameKey(line);
    const key = normalizeNameKey(name);
    if (!src || !key) return false;
    const pattern = `\\b${escapeRegExp(key).replace(/\s+/g, "\\\\s+")}\\b`;
    try {
        return new RegExp(pattern, "i").test(src);
    } catch (_) {
        return src.includes(key);
    }
}

function buildFocusedMemoryTranscript(transcript, personName, userName) {
    const lines = String(transcript || "")
        .split(/\r?\n/)
        .map((l) => String(l || "").trim())
        .filter(Boolean);
    if (!lines.length) return "";

    const keep = new Set();
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const speaker = String(line.split(":", 1)[0] || "").trim();
        const mentionsTarget = lineMentionsName(line, personName);
        const speakerIsTarget = lineMentionsName(speaker, personName);

        if (mentionsTarget || speakerIsTarget) {
            keep.add(i);
            if (i > 0) keep.add(i - 1);
            if (i + 1 < lines.length) keep.add(i + 1);
        }
    }

    if (keep.size < 8 && userName) {
        for (let i = 0; i < lines.length; i++) {
            const speaker = String(lines[i].split(":", 1)[0] || "").trim();
            if (lineMentionsName(speaker, userName)) keep.add(i);
        }
    }

    const selected = (keep.size
        ? Array.from(keep).sort((a, b) => a - b).map((i) => lines[i])
        : lines.slice(-80)).slice(-140);
    return selected.join("\n").slice(-14000);
}

function isMetaMemoryText(text) {
    return /\b(character\s*card|lorebook|metadata|tool\s*card|system\s*prompt|author\s*note|ooc)\b/i.test(String(text || ""));
}

function getSocialNameIndex(s) {
    ensureSocial(s);
    const byKey = new Map();
    for (const k of ["friends", "associates", "romance", "family", "rivals"]) {
        for (const p of (s.social[k] || [])) {
            const name = String(p?.name || "").trim();
            const key = normalizeNameKey(name);
            const id = String(p?.id || "").trim();
            if (!name || !key || !id) continue;
            if (!byKey.has(key)) byKey.set(key, { id, name, tab: k });
        }
    }
    const list = Array.from(byKey.values())
        .sort((a, b) => b.name.length - a.name.length)
        .slice(0, 180);
    return { byKey, list };
}

function extractMentionedSocialPeople(text, socialIndex) {
    const src = String(text || "");
    if (!src) return [];
    const list = Array.isArray(socialIndex?.list) ? socialIndex.list : [];
    if (!list.length) return [];
    const hits = [];
    for (const person of list) {
        if (hits.length >= 6) break;
        const name = String(person?.name || "").trim();
        if (!name) continue;
        const key = normalizeNameKey(name);
        if (!key) continue;
        const pattern = `\\b${escapeRegExp(key).replace(/\\\s+/g, "\\\\s+")}\\b`;
        try {
            if (!new RegExp(pattern, "i").test(src.toLowerCase())) continue;
        } catch (_) {
            if (!src.toLowerCase().includes(key)) continue;
        }
        hits.push(person);
    }
    return hits;
}

export function initDatabank() {
    const doc = $(document);
    if (!$("#uie-databank-window").length) {
        setTimeout(() => { try { initDatabank(); } catch (_) {} }, 120);
        return;
    }
    render();

    try { window.removeEventListener("uie:state_updated", window.__uieDatabankStateSync); } catch (_) {}
    try {
        window.__uieDatabankStateSync = () => {
            try {
                if (!$("#uie-databank-window").is(":visible")) return;
                const activeTab = String($(".uie-db-tab.active").data("tab") || "memories");
                if (activeTab === "social") {
                    try { renderSocialProfiles(); } catch (_) {}
                    if ($("#uie-db-social-mem-overlay").is(":visible")) {
                        try { renderSocialMemoriesModal(); } catch (_) {}
                    }
                    return;
                }
                if (activeTab === "state") {
                    try { renderState(); } catch (_) {}
                    return;
                }
                dbLastListSig = "";
                try { render(); } catch (_) {}
            } catch (_) {}
        };
        window.addEventListener("uie:state_updated", window.__uieDatabankStateSync);
    } catch (_) {}

    $("body").off("click.uieDbHardClose pointerup.uieDbHardClose", "#uie-databank-close").on("click.uieDbHardClose pointerup.uieDbHardClose", "#uie-databank-close", function (e) {
        e.preventDefault();
        e.stopPropagation();
        try { $("#uie-db-social-mem-overlay").hide(); } catch (_) {}
        try { $("#uie-databank-window").hide(); } catch (_) {}
    });

    // Tab Switching
    doc.off("click", ".uie-db-tab").on("click", ".uie-db-tab", function() {
        $(".uie-db-tab").removeClass("active").css({ background: "transparent", color: "rgba(0,240,255,0.5)" });
        $(this).addClass("active").css({ background: "rgba(0,240,255,0.1)", color: "#00f0ff" });

        const tab = $(this).data("tab");
        $("#uie-db-view-memories").hide();
        $("#uie-db-view-state").hide();
        $("#uie-db-view-social").hide();

        if (tab === "memories") {
            $("#uie-db-view-memories").show();
            render();
            return;
        }
        if (tab === "social") {
            $("#uie-db-view-social").show();
            renderSocialProfiles();
            return;
        }
        $("#uie-db-view-state").show();
        renderState();
    });

    // Databank Scan (Memories tab)
    doc.off("click", "#uie-db-scan").on("click", "#uie-db-scan", async function() {
        const btn = $(this);
        const icon = btn.find("i");
        if (btn.data("busy") === "1") return;
        btn.data("busy", "1");
        btn.prop("disabled", true);
        icon.addClass("fa-spin");
        try {
            await scanDatabankFromChat({ maxMessages: 80, silent: false });
        } finally {
            icon.removeClass("fa-spin");
            btn.prop("disabled", false);
            btn.data("busy", "0");
        }
    });

    // State tab refresh (Databank-only, no full UIE Scan All)
    doc.off("click", "#uie-db-state-scan").on("click", "#uie-db-state-scan", async function() {
        const btn = $(this);
        const icon = btn.find("i");
        if (btn.data("busy") === "1") return;
        btn.data("busy", "1");
        btn.prop("disabled", true);
        icon.addClass("fa-spin");
        try {
            await scanDatabankFromChat({ maxMessages: 80, silent: true });
            try { renderState(); } catch (_) {}
            try { render(); } catch (_) {}
            try { window.toastr?.success?.("State refreshed."); } catch (_) {}
        } finally {
            icon.removeClass("fa-spin");
            btn.prop("disabled", false);
            btn.data("busy", "0");
        }
    });

    // Social tab quick scan button (adds/refreshes databank entries only)
    doc.off("click", "#uie-db-social-scan").on("click", "#uie-db-social-scan", async function () {
        const btn = $(this);
        const icon = btn.find("i");
        if (btn.data("busy") === "1") return;
        btn.data("busy", "1");
        btn.prop("disabled", true);
        icon.addClass("fa-spin");
        try {
            await scanDatabankFromChat({ maxMessages: 80, silent: false });
            try { renderSocialProfiles(); } catch (_) {}
        } finally {
            icon.removeClass("fa-spin");
            btn.prop("disabled", false);
            btn.data("busy", "0");
        }
    });
    doc.off("click", ".db-edit").on("click", ".db-edit", function() {
        const id = String($(this).data("id") || "");
        if (!id) return;
        const s = getSettings();
        ensureDatabank(s);
        const idx = (s.databank || []).findIndex(m => String(m?.id || "") === id);
        if (idx < 0) return;
        const entry = s.databank[idx] || {};
        const curTitle = String(entry?.title || entry?.key || "Entry").trim();
        const curSummary = String(entry?.summary || entry?.content || entry?.entry || "").trim();
        const nextTitleRaw = prompt("Edit memory title:", curTitle);
        if (nextTitleRaw === null) return;
        const nextSummaryRaw = prompt("Edit memory summary:", curSummary);
        if (nextSummaryRaw === null) return;
        const nextTagsRaw = prompt("Edit tags (comma-separated):", Array.isArray(entry?.tags) ? entry.tags.join(", ") : "");
        if (nextTagsRaw === null) return;

        const nextSummary = String(nextSummaryRaw || "").trim().slice(0, 1200);
        if (!nextSummary) {
            try { window.toastr?.info?.("Summary cannot be empty."); } catch (_) {}
            return;
        }

        entry.title = normalizeMemoryTitle(nextTitleRaw, nextSummary);
        entry.summary = nextSummary;
        entry.content = nextSummary;
        entry.tags = parseTagsInput(nextTagsRaw, entry?.tags);
        entry.created = Number(entry?.created || Date.now()) || Date.now();
        entry.date = entry?.date || new Date(Number(entry.created || Date.now())).toLocaleDateString();
        saveSettings();
        render();
    });

    // Delete Memory
    doc.off("click", ".db-delete").on("click", ".db-delete", function() {
        if(confirm("Delete this memory?")) {
            const id = String($(this).data("id") || "");
            const s = getSettings();
            s.databank = (s.databank || []).filter(m => String(m?.id || "") !== id);
            saveSettings(); render();
        }
    });

    doc.off("click.uieDbLoadMore").on("click.uieDbLoadMore", "#uie-db-load-more", function (e) {
        e.preventDefault();
        e.stopPropagation();
        dbRenderLimit = Math.min(600, dbRenderLimit + 60);
        render();
    });

    doc.off("input.uieDbSocialSearch").on("input.uieDbSocialSearch", "#uie-db-social-search", function () {
        renderSocialProfiles();
    });

    doc.off("click.uieDbSocialOpen").on("click.uieDbSocialOpen", ".uie-db-social-row", function (e) {
        e.preventDefault();
        e.stopPropagation();
        const pid = String($(this).data("pid") || "");
        if (!pid) return;
        dbSocialActivePersonId = pid;
        $("#uie-db-social-mem-overlay").show();
        renderSocialMemoriesModal();
    });

    doc.off("click.uieDbSocialLink").on("click.uieDbSocialLink", ".uie-db-social-link", function (e) {
        e.preventDefault();
        e.stopPropagation();
        const pid = String($(this).data("pid") || "");
        if (!pid) return;
        dbSocialActivePersonId = pid;
        $("#uie-db-social-mem-overlay").show();
        renderSocialMemoriesModal();
    });

    doc.off("click.uieDbSocialMemClose").on("click.uieDbSocialMemClose", "#uie-db-social-mem-close", function (e) {
        e.preventDefault();
        e.stopPropagation();
        $("#uie-db-social-mem-overlay").hide();
    });
    doc.off("click.uieDbSocialMemBackdrop").on("click.uieDbSocialMemBackdrop", "#uie-db-social-mem-overlay", function (e) {
        if ($(e.target).closest("#uie-db-social-mem-overlay > div").length) return;
        $("#uie-db-social-mem-overlay").hide();
    });

    doc.off("click.uieDbSocialMemActions").on("click.uieDbSocialMemActions", "#uie-db-social-mem-scan, #uie-db-social-mem-add, #uie-db-social-mem-inject, #uie-db-social-mem-clear", async function (e) {
        e.preventDefault();
        e.stopPropagation();
        const { person } = getSocialPersonById(dbSocialActivePersonId);
        if (!person) return;

        if (this.id === "uie-db-social-mem-add") {
            const text = prompt("Add a vital memory (consequence-based):", "");
            if (text === null) return;
            const t = String(text || "").trim();
            if (!t) return;
            const impact = prompt("Impact on the character (optional):", "") ?? "";
            if (isTrivialMemory(t)) {
                try { window.toastr?.info?.("That looks trivial. Keep only vital, consequence-based memories."); } catch (_) {}
                return;
            }
            person.memories.push({ id: newId("mem"), t: Date.now(), text: t.slice(0, 320), impact: String(impact || "").trim().slice(0, 240), tags: [] });
            refreshLinkedSocialState({ rerenderProfiles: true, rerenderModal: true });
            return;
        }

        if (this.id === "uie-db-social-mem-clear") {
            const ok = confirm("Clear ALL memories for this character?");
            if (!ok) return;
            person.memories = [];
            refreshLinkedSocialState({ rerenderProfiles: true, rerenderModal: true });
            return;
        }

        if (this.id === "uie-db-social-mem-inject") {
            const block = buildMemoryBlock(person);
            if (!block) return;
            await injectRpEvent(block);
            try { window.toastr?.success?.("Injected memories into chat."); } catch (_) {}
            return;
        }

        if (this.id === "uie-db-social-mem-scan") {
            await scanMemoriesForPerson(person);
        }
    });

    doc.off("click.uieDbSocialMemDel").on("click.uieDbSocialMemDel", ".uie-db-social-mem-del", function (e) {
        e.preventDefault();
        e.stopPropagation();
        const mid = String($(this).data("mid") || "");
        const { person } = getSocialPersonById(dbSocialActivePersonId);
        if (!person || !mid) return;
        person.memories = (Array.isArray(person.memories) ? person.memories : []).filter(m => String(m?.id || "") !== mid);
        refreshLinkedSocialState({ rerenderProfiles: true, rerenderModal: true });
    });

    doc.off("click.uieDbSocialMemEdit").on("click.uieDbSocialMemEdit", ".uie-db-social-mem-edit", function (e) {
        e.preventDefault();
        e.stopPropagation();
        const mid = String($(this).data("mid") || "");
        const { person } = getSocialPersonById(dbSocialActivePersonId);
        if (!person || !mid) return;
        const mem = (Array.isArray(person.memories) ? person.memories : []).find((m) => String(m?.id || "") === mid);
        if (!mem) return;

        const nextTextRaw = prompt("Edit memory text:", String(mem?.text || ""));
        if (nextTextRaw === null) return;
        const nextImpactRaw = prompt("Edit impact (optional):", String(mem?.impact || ""));
        if (nextImpactRaw === null) return;
        const nextTagsRaw = prompt("Edit tags (comma-separated):", Array.isArray(mem?.tags) ? mem.tags.join(", ") : "");
        if (nextTagsRaw === null) return;

        let nextText = String(nextTextRaw || "").trim();
        if (!nextText) return;
        if (!lineMentionsName(nextText, person.name)) nextText = `${person.name}: ${nextText}`;
        if (isTrivialMemory(nextText) || isMetaMemoryText(nextText)) {
            try { window.toastr?.info?.("Keep only vital, in-world, character-specific memories."); } catch (_) {}
            return;
        }

        mem.text = nextText.slice(0, 320);
        mem.impact = String(nextImpactRaw || "").trim().slice(0, 240);
        mem.tags = parseTagsInput(nextTagsRaw, mem?.tags).slice(0, 6);
        mem.t = Date.now();
        refreshLinkedSocialState({ rerenderProfiles: true, rerenderModal: true });
    });
}

function getSocialPersonById(personId) {
    const s = getSettings();
    ensureSocial(s);
    const pid = String(personId || "");
    if (!pid) return { s, person: null };
    for (const k of ["friends", "associates", "romance", "family", "rivals"]) {
        const hit = (s.social[k] || []).find(p => String(p?.id || "") === pid);
        if (hit) return { s, person: hit };
    }
    return { s, person: null };
}

function renderSocialProfiles() {
    const s = getSettings();
    ensureSocial(s);
    const q = String($("#uie-db-social-search").val() || "").trim().toLowerCase();
    const list = document.getElementById("uie-db-social-list");
    if (!list) return;
    list.innerHTML = "";

    const rows = [];
    for (const k of ["friends", "associates", "romance", "family", "rivals"]) {
        for (const p of (s.social[k] || [])) {
            const name = String(p?.name || "").trim();
            if (!name) continue;
            if (q && !name.toLowerCase().includes(q)) continue;
            rows.push({ k, p, name });
        }
    }
    rows.sort((a, b) => a.name.localeCompare(b.name));
    if (!rows.length) {
        list.innerHTML = '<div style="text-align:center; color:rgba(0,240,255,0.55); margin-top:30px;">NO PROFILES FOUND</div>';
        return;
    }

    const tmpl = document.getElementById("uie-template-db-social-row");

    const frag = document.createDocumentFragment();
    for (const row of rows) {
        const memCount = Array.isArray(row.p?.memories) ? row.p.memories.length : 0;
        if (tmpl && tmpl.content) {
            const clone = tmpl.content.cloneNode(true);
            const el = clone.querySelector(".uie-db-social-row");
            const nameEl = clone.querySelector(".social-name");
            const relEl = clone.querySelector(".social-rel");
            const countEl = clone.querySelector(".social-count");
            if (!el || !nameEl || !relEl || !countEl) continue;

            el.dataset.pid = String(row.p.id || "");
            nameEl.textContent = row.name;
            relEl.textContent = row.k.toUpperCase();
            countEl.textContent = `${memCount} mem`;
            frag.appendChild(clone);
            continue;
        }

        const el = document.createElement("div");
        el.className = "uie-db-social-row";
        el.dataset.pid = String(row.p.id || "");
        el.style.cssText = "display:flex;align-items:center;gap:10px;background:rgba(0,240,255,0.05);border:1px solid rgba(0,240,255,0.24);border-radius:8px;padding:10px 12px;cursor:pointer;margin-bottom:8px;";
        el.innerHTML = `
            <div class="social-name" style="font-weight:900;color:#fff;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(row.name)}</div>
            <div class="social-rel" style="font-size:10px;color:rgba(0,240,255,0.8);border:1px solid rgba(0,240,255,0.25);padding:2px 8px;border-radius:999px;letter-spacing:0.6px;">${esc(row.k.toUpperCase())}</div>
            <div class="social-count" style="font-size:11px;color:rgba(255,255,255,0.7);">${memCount} mem</div>
        `;
        frag.appendChild(el);
    }
    list.appendChild(frag);
}

function isTrivialMemory(s) {
    const t = String(s || "").toLowerCase();
    if (!t) return true;
    if (t.length < 24) return true;
    const bad = /(said hi|said hello|walked in|greeted|small talk|chatted|talked a bit|they talked|made conversation|smiled and|laughed and)/i;
    return bad.test(t);
}

function buildMemoryBlock(person) {
    const ctx = getContext ? getContext() : {};
    const user = String(ctx?.name1 || "User");
    const mems = Array.isArray(person?.memories) ? person.memories.slice() : [];
    mems.sort((a, b) => Number(b?.t || 0) - Number(a?.t || 0));
    const lines = mems.slice(0, 10).map(m => `- ${String(m?.text || "").trim()}${m?.impact ? ` (Impact: ${String(m.impact).trim()})` : ""}`).filter(Boolean);
    if (!lines.length) return "";
    return `[UIE SOCIAL MEMORY]\nCharacter: ${String(person?.name || "Unknown")}\nAbout: ${user}\nVital memories:\n${lines.join("\n")}`;
}

function renderSocialMemoriesModal() {
    const { person } = getSocialPersonById(dbSocialActivePersonId);
    if (!person) return;
    const ctx = getContext ? getContext() : {};
    const user = String(ctx?.name1 || "User");
    $("#uie-db-social-mem-sub").text(`${person.name} â†” ${user}`);

    const list = $("#uie-db-social-mem-list").empty();
    const mems = Array.isArray(person.memories) ? person.memories.slice() : [];
    mems.sort((a, b) => Number(b?.t || 0) - Number(a?.t || 0));
    if (!mems.length) {
        $("#uie-db-social-mem-empty").show();
        return;
    }
    $("#uie-db-social-mem-empty").hide();
    for (const mem of mems) {
        const id = String(mem?.id || "");
        const text = String(mem?.text || "").trim();
        const impact = String(mem?.impact || "").trim();
        const tags = Array.isArray(mem?.tags) ? mem.tags.map(t => String(t || "").trim()).filter(Boolean).slice(0, 6) : [];
        const tagHtml = tags.length ? `<div style="margin-top:6px; display:flex; gap:6px; flex-wrap:wrap;">${tags.map(t => `<span style="font-size:10px; padding:2px 8px; border-radius:999px; background:rgba(0,240,255,0.08); border:1px solid rgba(0,240,255,0.2); color:#00f0ff; font-weight:900;">${esc(t)}</span>`).join("")}</div>` : "";
        list.append(`
            <div style="background:rgba(0, 240, 255, 0.05); border:1px solid rgba(0,240,255,0.22); border-radius:4px; padding:10px; position:relative; margin-bottom:10px;">
                <div style="font-weight:900; color:#fff; font-size:13px; line-height:1.35;">${esc(text)}</div>
                ${impact ? `<div style="margin-top:6px; font-size:12px; color:rgba(255,255,255,0.75);"><strong style="color:rgba(0,240,255,0.9);">Impact:</strong> ${esc(impact)}</div>` : ""}
                ${tagHtml}
                <i class="fa-solid fa-pen-to-square uie-db-social-mem-edit" data-mid="${esc(id)}" style="position:absolute; top:10px; right:32px; color:#7dd3ff; cursor:pointer; font-size:12px; opacity:0.9;"></i>
                <i class="fa-solid fa-trash uie-db-social-mem-del" data-mid="${esc(id)}" style="position:absolute; top:10px; right:10px; color:#ff3b30; cursor:pointer; font-size:12px; opacity:0.85;"></i>
            </div>
        `);
    }
}

async function scanMemoriesForPerson(person) {
    const ctx = getContext ? getContext() : {};
    const user = String(ctx?.name1 || "User");
    const transcript = (() => {
        const out = [];
        try {
            const nodes = Array.from(document.querySelectorAll("#chat .mes")).slice(-90);
            for (const m of nodes) {
                const name =
                    m.querySelector(".mes_name")?.textContent ||
                    m.querySelector(".name_text")?.textContent ||
                    m.querySelector(".name")?.textContent ||
                    "";
                const text =
                    m.querySelector(".mes_text")?.textContent ||
                    m.querySelector(".message")?.textContent ||
                    "";
                const nm = String(name || "").trim() || "Unknown";
                const tx = String(text || "").trim();
                if (!tx) continue;
                out.push(`${nm}: ${tx}`);
            }
        } catch (_) {}
        return out.join("\n").slice(-20000);
    })();
    if (!transcript) return;

    const focused = buildFocusedMemoryTranscript(transcript, person.name, user);
    const source = focused || transcript.slice(-14000);

    const prompt = `[UIE_LOCKED]
You are extracting ONLY vital, relationship-relevant memories for the character "${person.name}" about interactions with "${user}".

Target character: "${person.name}" (story character in this transcript, not card metadata)

Input transcript (may include omniscient tool cards / metadata; ignore anything that is not an in-world event or a durable fact):
${source}

Return ONLY valid JSON (no markdown, no extra keys):
{"memories":[{"text":"...","impact":"...","tags":["..."]}]}

Rules:
- 3 to 8 memories max. If none, return {"memories":[]}.
- Each memory must be about "${person.name}" directly (they act, speak, decide, reveal, promise, betray, help, harm, or are explicitly referenced).
- Ignore character-card data, profile blurbs, lorebook snippets, system messages, OOC, or tool/meta output.
- Each memory must be a durable fact that CHANGED something: trust, fear, loyalty, obligation, romance, rivalry, plans, secrets, injuries, promises, betrayals, gifts, major discoveries.
- No trivial entries (no greetings, walking in, "they talked", generic vibes).
- Be specific and consequence-based. 1â€“2 sentences per memory.
- Tags are short (e.g., "promise", "betrayal", "injury", "secret", "favor", "trauma", "trust").`;

    try { window.toastr?.info?.("Scanning memories..."); } catch (_) {}
    const res = await generateContent(prompt.slice(0, 16000), "System Check");
    if (!res) return;
    let obj = null;
    try { obj = JSON.parse(String(res).replace(/```json|```/g, "").trim()); } catch (_) { obj = null; }
    const mems = Array.isArray(obj?.memories) ? obj.memories : [];
    const existing = new Set((person.memories || []).map(m => String(m?.text || "").toLowerCase().replace(/\s+/g, " ").trim()).filter(Boolean));
    let added = 0;
    for (const m of mems) {
        let text = String(m?.text || "").trim();
        const impact = String(m?.impact || "").trim();
        const tags = Array.isArray(m?.tags)
            ? m.tags.map(t => String(t || "").trim().toLowerCase()).filter(Boolean).slice(0, 6)
            : [];
        if (!text) continue;
        if (isMetaMemoryText(text)) continue;
        if (!lineMentionsName(text, person.name)) text = `${person.name}: ${text}`;
        const key = text.toLowerCase().replace(/\s+/g, " ").trim();
        if (isTrivialMemory(text)) continue;
        if (existing.has(key)) continue;
        person.memories.push({ id: newId("mem"), t: Date.now(), text: text.slice(0, 320), impact: impact.slice(0, 240), tags });
        existing.add(key);
        added++;
    }
    refreshLinkedSocialState({ rerenderProfiles: true, rerenderModal: true });
    try { window.toastr?.success?.(added ? `Added ${added} memory${added === 1 ? "" : "ies"}.` : "No new vital memories found."); } catch (_) {}
}

function render() {
    try { ensureChatStateLoaded(); } catch (_) {}
    const s = getSettings();
    ensureDatabank(s);
    ensureSocial(s);
    const list = $("#uie-db-list");
    if (!list.length) {
        setTimeout(() => { try { render(); } catch (_) {} }, 160);
        return;
    }
    const t0 = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
    const entries = toDatabankDisplayEntries(s.databank || []);
    const socialIndex = getSocialNameIndex(s);
    const meta = $("#uie-db-meta");
    const sig = buildDatabankRenderSignature(entries, socialIndex);
    if (sig === dbLastListSig && list.children().length) {
        try {
            const t1 = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
            window.UIE_lastDatabankRenderMs = Math.max(0, (t1 - t0));
        } catch (_) {}
        return;
    }
    dbLastListSig = sig;
    list.empty();

    if (meta.length) {
        meta.text(`${entries.length} ${entries.length === 1 ? "entry" : "entries"} saved for this chat`);
    }

    if (entries.length === 0) {
        list.html('<div style="text-align:center; color:#00f0ff; opacity:0.55; margin-top:50px;">NO MEMORIES FOUND IN THIS CHAT</div>');
        return;
    }

    const shown = entries.slice(-1 * Math.max(1, Math.min(dbRenderLimit, entries.length))).reverse();
    const html = [];
    for (const m of shown) {
        const title = String(m?.title || "Entry").trim() || "Entry";
        const body = String(m?.body || "").trim();
        const date = String(m?.date || "").trim();
        const tag = m?.type === "lore" ? "LORE" : "MEMORY";
        const mentionedPeople = extractMentionedSocialPeople(`${title}\n${body}`, socialIndex);
        const mentionHtml = mentionedPeople.length
            ? `<div style="margin-top:8px; display:flex; gap:6px; flex-wrap:wrap;">${mentionedPeople.map((p) => `<span class="uie-db-social-link" data-pid="${esc(String(p.id || ""))}" style="font-size:10px; color:#9ff; border:1px solid rgba(0,240,255,0.28); background:rgba(0,240,255,0.08); border-radius:999px; padding:2px 8px; cursor:pointer;">${esc(p.name)}</span>`).join("")}</div>`
            : "";
        html.push(`
            <div style="background:rgba(0, 240, 255, 0.05); border:1px solid rgba(0,240,255,0.3); border-radius:6px; padding:12px; position:relative; margin-bottom:10px;">
                <div style="display:flex; align-items:flex-start; gap:8px;">
                    <div style="flex:1; min-width:0; font-weight:bold; color:#00f0ff; font-size:14px; margin-bottom:6px; letter-spacing:1px; text-transform:uppercase; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${esc(title)}</div>
                    <div style="display:flex; align-items:center; gap:8px; margin-left:auto; flex:0 0 auto;">
                        <span style="font-size:10px; color:rgba(0,240,255,0.75); border:1px solid rgba(0,240,255,0.25); padding:2px 6px; border-radius:999px; letter-spacing:1px;">${esc(tag)}</span>
                        <span style="color:rgba(0,240,255,0.5); font-size:10px; white-space:nowrap;">${esc(date)}</span>
                    </div>
                </div>
                <div style="font-size:12px; color:rgba(255,255,255,0.88); line-height:1.45; white-space:pre-wrap; word-break:break-word;">${esc(body || "(empty)")}</div>
                ${mentionHtml}
                <i class="fa-solid fa-pen-to-square db-edit" data-id="${esc(String(m.id || ""))}" style="position:absolute; bottom:10px; right:32px; color:#7dd3ff; cursor:pointer; font-size:12px; opacity:0.85;"></i>
                <i class="fa-solid fa-trash db-delete" data-id="${esc(String(m.id || ""))}" style="position:absolute; bottom:10px; right:10px; color:#ff3b30; cursor:pointer; font-size:12px; opacity:0.7;"></i>
            </div>
        `);
    }
    if (entries.length > shown.length) {
        html.push(`<button id="uie-db-load-more" style="width:100%; margin:10px 0 2px; background:rgba(0,240,255,0.10); border:1px solid rgba(0,240,255,0.35); color:#00f0ff; padding:10px 12px; cursor:pointer; font-weight:900; font-size:12px; border-radius:10px;">LOAD MORE</button>`);
    }
    list.html(html.join(""));
    try {
        const t1 = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
        window.UIE_lastDatabankRenderMs = Math.max(0, (t1 - t0));
    } catch (_) {}
}

function renderState() {
    const container = document.getElementById("uie-db-state-content");
    if (!container) return;
    container.innerHTML = "";

    let state = null;
    try {
        state = getWorldState();
    } catch (e) {
        container.innerHTML = `<div style="text-align:center; margin-top:50px; color:rgba(0,240,255,0.5); font-style:italic;">WORLD STATE ERROR<br><small>Check console for details.</small></div>`;
        try { console.warn("[UIE] getWorldState() failed:", e); } catch (_) {}
        return;
    }

    if (!state || Object.keys(state).length === 0) {
        container.innerHTML = `<div style="text-align:center; margin-top:50px; color:rgba(0,240,255,0.5); font-style:italic;">NO WORLD STATE DATA<br><small>Start chatting to generate state.</small></div>`;
        return;
    }

    // Status Block
    const tmplStatus = document.getElementById("uie-template-db-state-status");
    const tmplRow = document.getElementById("uie-template-db-state-row");

    if (!(tmplStatus && tmplRow)) {
        const wrap = document.createElement("div");
        wrap.style.display = "flex";
        wrap.style.flexDirection = "column";
        wrap.style.gap = "10px";

        const makeGrid = () => {
            const grid = document.createElement("div");
            grid.style.display = "grid";
            grid.style.gridTemplateColumns = "minmax(120px, 0.9fr) 1.1fr";
            grid.style.gap = "6px 10px";
            grid.style.background = "rgba(0,240,255,0.05)";
            grid.style.border = "1px solid rgba(0,240,255,0.25)";
            grid.style.borderRadius = "10px";
            grid.style.padding = "10px";
            return grid;
        };

        const grid = makeGrid();
        for (const [k, v] of Object.entries(state)) {
            if (k === "custom") continue;
            const keyEl = document.createElement("div");
            keyEl.style.color = "rgba(0,240,255,0.9)";
            keyEl.style.fontWeight = "900";
            keyEl.style.letterSpacing = "0.4px";
            keyEl.style.wordBreak = "break-word";
            keyEl.textContent = String(k);

            const valEl = document.createElement("div");
            valEl.style.color = "rgba(255,255,255,0.88)";
            valEl.style.wordBreak = "break-word";
            valEl.textContent = String(v);

            grid.appendChild(keyEl);
            grid.appendChild(valEl);
        }
        wrap.appendChild(grid);

        if (state.custom && Object.keys(state.custom).length > 0) {
            const grid2 = makeGrid();
            for (const [k, v] of Object.entries(state.custom)) {
                const keyEl = document.createElement("div");
                keyEl.style.color = "rgba(0,240,255,0.9)";
                keyEl.style.fontWeight = "900";
                keyEl.style.letterSpacing = "0.4px";
                keyEl.style.wordBreak = "break-word";
                keyEl.textContent = String(k);

                const valEl = document.createElement("div");
                valEl.style.color = "rgba(255,255,255,0.88)";
                valEl.style.wordBreak = "break-word";
                valEl.textContent = String(v);

                grid2.appendChild(keyEl);
                grid2.appendChild(valEl);
            }
            wrap.appendChild(grid2);
        }

        container.appendChild(wrap);
        return;
    }

    if (tmplStatus && tmplRow) {
        const cloneStatus = tmplStatus.content.cloneNode(true);
        const grid = cloneStatus.querySelector(".db-state-grid");
        
        Object.entries(state).forEach(([k, v]) => {
            if (k === "custom") return;
            const cloneRow = tmplRow.content.cloneNode(true);
            const keyEl = cloneRow.querySelector(".db-state-key");
            const valEl = cloneRow.querySelector(".db-state-val");
            keyEl.textContent = esc(k);
            valEl.textContent = esc(String(v));
            grid.appendChild(cloneRow);
        });
        
        container.appendChild(cloneStatus);
    }

    // Custom Block
    if (state.custom && Object.keys(state.custom).length > 0) {
        const tmplCustom = document.getElementById("uie-template-db-state-custom");
        const tmplCustomRow = document.getElementById("uie-template-db-state-custom-row");
        
        if (tmplCustom && tmplCustomRow) {
            const cloneCustom = tmplCustom.content.cloneNode(true);
            const grid = cloneCustom.querySelector(".db-custom-grid");
            
            Object.entries(state.custom).forEach(([k, v]) => {
                const cloneRow = tmplCustomRow.content.cloneNode(true);
                const keyEl = cloneRow.querySelector(".db-custom-key");
                const valEl = cloneRow.querySelector(".db-custom-val");
                keyEl.textContent = esc(k);
                valEl.textContent = esc(String(v));
                grid.appendChild(cloneRow);
            });
            
            container.appendChild(cloneCustom);
        }
    }
}

// Export for other modules to read history
export function getFullHistoryContext() {
    try { ensureChatStateLoaded(); } catch (_) {}
    const s = getSettings();
    if(!s.databank || s.databank.length === 0) return "";
    ensureDatabank(s);
    const lines = (s.databank || [])
        .map(m => String(m?.summary || m?.content || m?.entry || "").trim())
        .filter(Boolean)
        .slice(-80);
    if (!lines.length) return "";
    return "PAST EVENTS:\n" + lines.map(x => `- ${x}`).join("\n");
}

