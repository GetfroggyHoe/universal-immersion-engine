import { getSettings, saveSettings, ensureChatStateLoaded } from "./core.js";
import { generateContent } from "./apiClient.js";
import { getWorldState, scanEverything } from "./stateTracker.js";
import { getContext } from "../../../../../extensions.js";
import { injectRpEvent } from "./features/rp_log.js";
import { parseJsonLoose, normalizeDatabankArrayInPlace, toDatabankDisplayEntries } from "./databankModel.js";

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

function ensureDatabank(s) {
    if (!s.databank) s.databank = [];
    if (!Array.isArray(s.databank)) s.databank = [];
    const changed = normalizeDatabankArrayInPlace(s.databank, { now: Date.now(), makeId: () => newId("db") });
    if (changed) saveSettings();
}

function ensureSocial(s) {
    if (!s.social) s.social = { friends: [], romance: [], family: [], rivals: [] };
    ["friends", "romance", "family", "rivals"].forEach(k => { if (!Array.isArray(s.social[k])) s.social[k] = []; });
    ["friends", "romance", "family", "rivals"].forEach(k => {
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

export function initDatabank() {
    const doc = $(document);
    if (!$("#uie-databank-window").length) {
        setTimeout(() => { try { initDatabank(); } catch (_) {} }, 120);
        return;
    }
    render();

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

    // Archive Memory Scan
    doc.off("click", "#uie-db-scan").on("click", "#uie-db-scan", async function() {
        const allow = getSettings()?.ai?.databankScan !== false;
        if (!allow) return;
        const btn = $(this);
        btn.addClass("fa-spin");
        
        const rawLog = getChatSnippet(60);
        
        if(rawLog.length < 50) { alert("Not enough chat data to archive."); btn.removeClass("fa-spin"); return; }

        const prompt = `Task: Summarize this RP segment into a concise "Memory File" for long-term storage.\nInput:\n${rawLog.substring(0, 4000)}\n\nOutput JSON: { "title": "Short Title", "summary": "3-4 sentence summary of key events, names, and locations." }`;

        try {
            const res = await generateContent(prompt, "System Check");
            const data = parseJsonLoose(res);
            if (!data || typeof data !== "object") throw new Error("Bad JSON response");
            const s = getSettings();
            ensureDatabank(s);
            
            const now = Date.now();
            s.databank.push({ id: newId("db"), created: now, date: new Date(now).toLocaleDateString(), title: String(data.title || "Memory").trim().slice(0, 80), summary: String(data.summary || "").trim() });
            saveSettings();
            render();
            if(window.toastr) toastr.success("Memory Archived");
        } catch(e) { try { window.toastr?.error?.("Archive failed (check console)."); } catch (_) {} console.error(e); }
        btn.removeClass("fa-spin");
    });

    doc.off("click", "#uie-db-state-scan").on("click", "#uie-db-state-scan", async function() {
        const btn = $(this).find("i");
        btn.addClass("fa-spin");
        try { await scanEverything(); } catch (_) {}
        try { renderState(); } catch (_) {}
        btn.removeClass("fa-spin");
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
            saveSettings();
            renderSocialMemoriesModal();
            return;
        }

        if (this.id === "uie-db-social-mem-clear") {
            const ok = confirm("Clear ALL memories for this character?");
            if (!ok) return;
            person.memories = [];
            saveSettings();
            renderSocialMemoriesModal();
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
        saveSettings();
        renderSocialMemoriesModal();
    });
}

function getSocialPersonById(personId) {
    const s = getSettings();
    ensureSocial(s);
    const pid = String(personId || "");
    if (!pid) return { s, person: null };
    for (const k of ["friends", "romance", "family", "rivals"]) {
        const hit = (s.social[k] || []).find(p => String(p?.id || "") === pid);
        if (hit) return { s, person: hit };
    }
    return { s, person: null };
}

function renderSocialProfiles() {
    const s = getSettings();
    ensureSocial(s);
    const q = String($("#uie-db-social-search").val() || "").trim().toLowerCase();
    const list = $("#uie-db-social-list").empty();
    const rows = [];
    for (const k of ["friends", "romance", "family", "rivals"]) {
        for (const p of (s.social[k] || [])) {
            const name = String(p?.name || "").trim();
            if (!name) continue;
            if (q && !name.toLowerCase().includes(q)) continue;
            rows.push({ k, p, name });
        }
    }
    rows.sort((a, b) => a.name.localeCompare(b.name));
    if (!rows.length) {
        list.html('<div style="text-align:center; color:rgba(0,240,255,0.55); margin-top:30px;">NO PROFILES FOUND</div>');
        return;
    }
    for (const row of rows) {
        const memCount = Array.isArray(row.p?.memories) ? row.p.memories.length : 0;
        list.append(`
            <div class="uie-db-social-row" data-pid="${esc(String(row.p.id || ""))}" style="background:rgba(0, 240, 255, 0.05); border:1px solid rgba(0,240,255,0.25); border-radius:4px; padding:10px; margin-bottom:8px; cursor:pointer;">
                <div style="display:flex; align-items:center; gap:10px;">
                    <div style="font-weight:900; color:#00f0ff; letter-spacing:1px;">${esc(row.name)}</div>
                    <div style="margin-left:auto; font-size:11px; color:rgba(0,240,255,0.6);">${esc(row.k.toUpperCase())}</div>
                    <div style="font-size:11px; color:rgba(255,255,255,0.65);">${memCount} mem</div>
                </div>
            </div>
        `);
    }
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
    $("#uie-db-social-mem-sub").text(`${person.name} ↔ ${user}`);

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
        return out.join("\n").slice(-14000);
    })();
    if (!transcript) return;

    const prompt = `[UIE_LOCKED]
You are extracting ONLY vital, relationship-relevant memories for the character "${person.name}" about interactions with "${user}".

Input transcript (may include omniscient tool cards / metadata; ignore anything that is not an in-world event or a durable fact):
${transcript}

Return ONLY valid JSON (no markdown, no extra keys):
{"memories":[{"text":"...","impact":"...","tags":["..."]}]}

Rules:
- 3 to 8 memories max. If none, return {"memories":[]}.
- Each memory must be a durable fact that CHANGED something: trust, fear, loyalty, obligation, romance, rivalry, plans, secrets, injuries, promises, betrayals, gifts, major discoveries.
- No trivial entries (no greetings, walking in, “they talked”, generic vibes).
- Be specific and consequence-based. 1–2 sentences per memory.
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
        const text = String(m?.text || "").trim();
        const impact = String(m?.impact || "").trim();
        const tags = Array.isArray(m?.tags) ? m.tags.map(t => String(t || "").trim()).filter(Boolean).slice(0, 6) : [];
        const key = text.toLowerCase().replace(/\s+/g, " ").trim();
        if (!text) continue;
        if (isTrivialMemory(text)) continue;
        if (existing.has(key)) continue;
        person.memories.push({ id: newId("mem"), t: Date.now(), text: text.slice(0, 320), impact: impact.slice(0, 240), tags });
        existing.add(key);
        added++;
    }
    saveSettings();
    renderSocialMemoriesModal();
    try { window.toastr?.success?.(added ? `Added ${added} memory${added === 1 ? "" : "ies"}.` : "No new vital memories found."); } catch (_) {}
}

function render() {
    try { ensureChatStateLoaded(); } catch (_) {}
    const s = getSettings();
    ensureDatabank(s);
    const list = $("#uie-db-list");
    if (!list.length) {
        setTimeout(() => { try { render(); } catch (_) {} }, 160);
        return;
    }
    const t0 = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
    const entries = toDatabankDisplayEntries(s.databank || []);
    const meta = $("#uie-db-meta");
    const sig = `${entries.length}|${dbRenderLimit}|${entries[0]?.id || ""}`;
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
    const container = $("#uie-db-state-content").empty();
    const state = getWorldState();

    if (!state || Object.keys(state).length === 0) {
        container.html(`<div style="text-align:center; margin-top:50px; color:rgba(0,240,255,0.5); font-style:italic;">NO WORLD STATE DATA<br><small>Start chatting to generate state.</small></div>`);
        return;
    }

    container.append(`
        <div style="padding:15px; border:1px solid rgba(0,240,255,0.2); background:rgba(0,240,255,0.05); border-radius:6px; margin-bottom:20px;">
            <div style="font-size:12px; color:rgba(0,240,255,0.7); margin-bottom:15px; text-transform:uppercase; letter-spacing:2px; font-weight:700; border-bottom:1px solid rgba(0,240,255,0.2); padding-bottom:5px;">CURRENT STATUS</div>
            <div style="display:grid; grid-template-columns: 1fr; gap:12px;">
                ${Object.entries(state).map(([k, v]) => {
                    if (k === "custom") return ""; 
                    return `
                    <div style="display:flex; align-items:center; justify-content:space-between; background:rgba(0,0,0,0.3); padding:10px; border-left:3px solid #00f0ff;">
                        <div style="font-size:11px; color:rgba(0,240,255,0.8); text-transform:uppercase; font-weight:700;">${esc(k)}</div>
                        <div style="font-size:14px; color:#fff; font-weight:600; text-shadow:0 0 5px rgba(0,240,255,0.5);">${esc(String(v))}</div>
                    </div>`;
                }).join("")}
            </div>
        </div>
    `);

    if (state.custom && Object.keys(state.custom).length > 0) {
        container.append(`
            <div style="padding:15px; border:1px solid rgba(0,240,255,0.2); background:rgba(0,240,255,0.05); border-radius:6px;">
                <div style="font-size:12px; color:rgba(0,240,255,0.7); margin-bottom:15px; text-transform:uppercase; letter-spacing:2px; font-weight:700; border-bottom:1px solid rgba(0,240,255,0.2); padding-bottom:5px;">ADDITIONAL TRACKERS</div>
                <div style="display:grid; grid-template-columns: 1fr; gap:8px;">
                    ${Object.entries(state.custom).map(([k, v]) => `
                        <div style="display:flex; justify-content:space-between; align-items:center; padding:8px; background:rgba(0,0,0,0.3); border-radius:4px;">
                            <span style="color:rgba(0,240,255,0.6); font-size:12px;">${esc(k)}</span>
                            <span style="color:#fff; font-weight:600; font-size:13px;">${esc(String(v))}</span>
                        </div>
                    `).join("")}
                </div>
            </div>
        `);
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
