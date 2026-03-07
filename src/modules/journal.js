import { getSettings, saveSettings } from "./core.js";
import { generateContent } from "./apiClient.js";
import { notify } from "./notifications.js";
import { injectRpEvent } from "./features/rp_log.js";

let currentTab = "active";
let bound = false;
let chatObserver = null;
let lastSeenHash = "";

function esc(s) {
    return String(s ?? "")
        .replace(/&/g,"&amp;")
        .replace(/</g,"&lt;")
        .replace(/>/g,"&gt;")
        .replace(/"/g,"&quot;")
        .replace(/'/g,"&#39;");
}

function simpleHash(str) {
    let h = 0;
    const s = String(str || "");
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return String(h);
}

function normalizeQuest(q) {
    const title = String(q?.title || q?.name || "Quest").slice(0, 80);
    const desc = String(q?.desc || q?.description || q?.details || "").slice(0, 600);
    return { title, desc };
}

function extractQuestPayloads(text) {
    const out = [];
    const t = String(text || "");

    const tagRe = /```(?:uie_journal|uie_quests|json)?\s*([\s\S]*?)```/gi;
    let m;
    while ((m = tagRe.exec(t))) {
        out.push(m[1]);
    }

    const xmlRe = /<uie_journal[^>]*>([\s\S]*?)<\/uie_journal>/gi;
    while ((m = xmlRe.exec(t))) {
        out.push(m[1]);
    }

    // Fallback: try parsing any JSON object containing "quests"
    if (!out.length) {
        const start = t.indexOf("{");
        const end = t.lastIndexOf("}");
        if (start !== -1 && end !== -1 && end > start) out.push(t.slice(start, end + 1));
    }

    return out;
}

function ingestQuestsFromChatText(text) {
    const s = getSettings();
    if (!s) return 0;
    if (!s.journal) s.journal = { active: [], pending: [], abandoned: [], completed: [], codex: [] };
    if (!Array.isArray(s.journal.pending)) s.journal.pending = [];

    const payloads = extractQuestPayloads(text);
    let added = 0;

    for (const raw of payloads) {
        const cleaned = String(raw || "").replace(/```json|```/g, "").trim();
        let data = null;
        try { data = JSON.parse(cleaned); } catch (_) { continue; }

        const quests = Array.isArray(data) ? data : (Array.isArray(data?.quests) ? data.quests : null);
        if (!quests) continue;

        for (const q of quests) {
            const nq = normalizeQuest(q);
            const key = `${nq.title}::${nq.desc}`;
            const exists =
                (s.journal.pending || []).some(x => `${x.title}::${x.desc}` === key) ||
                (s.journal.active || []).some(x => `${x.title}::${x.desc}` === key) ||
                (s.journal.completed || []).some(x => `${x.title}::${x.desc}` === key) ||
                (s.journal.abandoned || []).some(x => `${x.title}::${x.desc}` === key);
            if (exists) continue;

            s.journal.pending.push({ ...nq, source: "chat", ts: Date.now() });
            added++;
        }
    }

    if (added) {
        saveSettings();
        notify("success", `New Quest Suggestions: ${added}`, "Journal", "questsAccepted");
    }
    return added;
}

function startChatIngest() {
    if (chatObserver) return;
    const chatEl = document.querySelector("#chat");
    if (!chatEl) return;

    chatObserver = new MutationObserver(() => {
        const last = $(".chat-msg-txt").last();
        if (!last.length) return;
        const txt = last.text() || "";
        const h = simpleHash(txt);
        if (h === lastSeenHash) return;
        lastSeenHash = h;
        ingestQuestsFromChatText(txt);
        const s = getSettings();
        
        // Auto-Codex
            if (s?.features?.codexAutoExtract === true) {
                 if (Math.random() < 0.1) extractCodexFromChat();
            }
            
            // Auto-Quests
            if (!window.UIE_questDebounce) {
                 window.UIE_questDebounce = setTimeout(() => {
                     autoUpdateQuests();
                     window.UIE_questDebounce = null;
                 }, 20000); 
            }
    });
    chatObserver.observe(chatEl, { childList: true, subtree: true });
}

async function autoUpdateQuests() {
    const s = getSettings();
    if (s?.ai?.journalQuestGen === false) return;
    if (!s.journal) s.journal = { active: [], pending: [], abandoned: [], completed: [], codex: [] };

    // Debounce check (global)
    if (window.UIE_questAutoRunning) return;
    window.UIE_questAutoRunning = true;
    
    try {
        let raw = "";
        $(".chat-msg-txt").slice(-15).each(function() { raw += $(this).text() + "\n"; });
        if (!raw.trim()) return;

        const active = (s.journal.active || []).map(q => String(q.title).slice(0,50));
        const pending = (s.journal.pending || []).map(q => String(q.title).slice(0,50));
        
        // Only run if we have quests to update OR randomly for new quests (to save tokens)
        // Run more aggressively if we have active quests.
        if (active.length === 0 && pending.length === 0 && Math.random() > 0.3) return;

        const prompt = `
Context: RPG/Story.
Recent Chat:
${raw.slice(0, 2500)}

Active Quests:
${active.map(x => "- " + x).join("\n") || "(none)"}

Pending Quests:
${pending.map(x => "- " + x).join("\n") || "(none)"}

Task: Check for quest completion, failure, acceptance, or NEW quests.
Return JSON ONLY:
{
  "completed": ["exact title from Active list"],
  "failed": ["exact title from Active list"],
  "accepted": ["exact title from Pending list"],
  "new": [{"title":"Short Title","desc":"Objective"}]
}
`;
        const res = await generateContent(prompt, "Quest Update");
        if (!res) return;

        let data;
        try { data = JSON.parse(String(res).replace(/```json|```/g, "").trim()); } catch(_) { return; }

        let changed = false;
        
        // Accepted
        if (Array.isArray(data.accepted)) {
            for (const t of data.accepted) {
                const idx = s.journal.pending.findIndex(q => q.title.includes(t) || t.includes(q.title));
                if (idx !== -1) {
                    const q = s.journal.pending[idx];
                    s.journal.pending.splice(idx, 1);
                    s.journal.active.push(q);
                    notify("success", `Quest Accepted: ${q.title}`, "Journal");
                    changed = true;
                }
            }
        }

        // Completed
        if (Array.isArray(data.completed)) {
            for (const t of data.completed) {
                const idx = s.journal.active.findIndex(q => q.title.includes(t) || t.includes(q.title));
                if (idx !== -1) {
                    const q = s.journal.active[idx];
                    s.journal.active.splice(idx, 1);
                    s.journal.completed.push(q);
                    s.xp = (s.xp || 0) + 50;
                    notify("success", `Quest Completed: ${q.title} (+50 XP)`, "Journal");
                    changed = true;
                }
            }
        }

        // Failed
        if (Array.isArray(data.failed)) {
            for (const t of data.failed) {
                const idx = s.journal.active.findIndex(q => q.title.includes(t) || t.includes(q.title));
                if (idx !== -1) {
                    const q = s.journal.active[idx];
                    s.journal.active.splice(idx, 1);
                    s.journal.abandoned.push({ ...q, failed: true });
                    notify("error", `Quest Failed: ${q.title}`, "Journal");
                    changed = true;
                }
            }
        }

        // New
        if (Array.isArray(data.new)) {
            for (const n of data.new) {
                const title = String(n.title || "").trim();
                if (!title) continue;
                // Check duplicates
                const all = [].concat(s.journal.active, s.journal.pending, s.journal.completed, s.journal.abandoned);
                if (all.some(q => q.title === title)) continue;
                
                s.journal.pending.push({ title, desc: n.desc || "...", source: "auto", ts: Date.now() });
                notify("info", `New Quest: ${title}`, "Journal");
                changed = true;
            }
        }

        if (changed) {
            saveSettings();
            renderJournal();
        }

    } catch(e) {
        console.error("AutoQuest Error:", e);
    } finally {
        window.UIE_questAutoRunning = false;
    }
}

export function renderJournal() {
    if (!bound) { initJournal(); bound = true; }
    const s = getSettings();
    if(!s.journal) s.journal = { active: [], pending: [], abandoned: [], completed: [], codex: [] };
    
    const counts = {
        active: (s.journal.active || []).length,
        pending: (s.journal.pending || []).length,
        abandoned: (s.journal.abandoned || []).length,
        completed: (s.journal.completed || []).length,
        codex: (s.codex?.entries || []).length,
        databank: (s.databank || []).length
    };

    $("#uie-journal-counts").text(`Active ${counts.active} • Pending ${counts.pending} • Failed ${counts.abandoned} • Completed ${counts.completed} • Codex ${counts.codex}`);

    const titles = { active: "Active", pending: "Pending", codex: "Codex", abandoned: "Failed", completed: "Completed", databank: "Databank", state: "World State" };
    $("#uie-journal-tab-title").text(titles[currentTab] || "Journal");

    const host = $("#uie-journal-list");
    const container = host.length ? host : $("#uie-journal-content");
    container.empty();

    const search = String($("#uie-journal-search").val() || "").trim().toLowerCase();

    // CODEX: LORE ENCYCLOPEDIA (MANUAL)
    if (currentTab === "codex") {
        if (s.features && s.features.codexEnabled !== true) {
            container.html(`<div style="text-align:center; margin-top:50px; color:#aaa; font-style:italic;">Codex Disabled</div>`);
            return;
        }
        if (!s.codex) s.codex = { entries: [] };
        if (!Array.isArray(s.codex.entries)) s.codex.entries = [];

        const autoActive = s.features?.codexAutoExtract === true;
        const autoColor = autoActive ? "#2ecc71" : "rgba(255,255,255,0.14)";
        const autoText = autoActive ? "Auto: ON" : "Auto: OFF";
        const autoBg = autoActive ? "rgba(46,204,113,0.2)" : "rgba(0,0,0,0.25)";

        container.append(`
            <div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:12px;">
                <button id="uie-codex-add" style="height:30px; padding:0 10px; border-radius:10px; border:none; background:#2ecc71; color:#000; font-weight:900; cursor:pointer; font-size:0.85em;">New Entry</button>
                <button id="uie-codex-extract-desc" style="height:30px; padding:0 10px; border-radius:10px; border:1px solid rgba(255,255,255,0.14); background:rgba(0,0,0,0.25); color:#fff; font-weight:900; cursor:pointer; font-size:0.85em;">Generate From Description</button>
                <button id="uie-codex-extract-chat" style="height:30px; padding:0 10px; border-radius:10px; border:1px solid rgba(255,255,255,0.14); background:rgba(0,0,0,0.25); color:#fff; font-weight:900; cursor:pointer; font-size:0.85em;">Extract Lore From Chat</button>
                <button id="uie-codex-toggle-auto" style="height:30px; padding:0 10px; border-radius:10px; border:1px solid ${autoColor}; background:${autoBg}; color:#fff; font-weight:900; cursor:pointer; font-size:0.85em;">${autoText}</button>
            </div>
        `);

        const data = s.codex.entries || [];
        if (data.length === 0) {
            container.append(`<div style="text-align:center; margin-top:30px; color:#aaa; font-style:italic;">No Codex Entries<br><small style="opacity:0.7;">Codex is lore-only (not small events). Add entries manually.</small></div>`);
            return;
        }

        const tmpl = document.getElementById("uie-template-codex-entry");
        if (tmpl) {
            const frag = document.createDocumentFragment();
            data
                .slice()
                .sort((a, b) => Number(b?.updatedAt || b?.ts || 0) - Number(a?.updatedAt || a?.ts || 0))
                .filter(m => {
                    if (!search) return true;
                    const t = String(m?.title || "").toLowerCase();
                    const body = String(m?.body || "").toLowerCase();
                    const kw = Array.isArray(m?.keywords) ? m.keywords.join(" ").toLowerCase() : "";
                    const cat = String(m?.category || "").toLowerCase();
                    return t.includes(search) || body.includes(search) || kw.includes(search) || cat.includes(search);
                })
                .forEach(m => {
                    const id = String(m.id || "");
                    const title = m.title || "Codex Entry";
                    const category = m.category || "Lore";
                    const when = m.updatedAt ? new Date(m.updatedAt).toLocaleDateString() : (m.ts ? new Date(m.ts).toLocaleDateString() : "");
                    const keywords = Array.isArray(m.keywords) ? m.keywords.join(", ") : "";
                    
                    const clone = tmpl.content.cloneNode(true);
                    const el = clone.querySelector(".uie-codex-entry");
                    const tEl = clone.querySelector(".codex-title");
                    const dEl = clone.querySelector(".codex-date");
                    const mEl = clone.querySelector(".codex-meta");
                    const bEl = clone.querySelector(".uie-codex-body");
                    const editBtn = clone.querySelector(".uie-codex-edit");
                    const delBtn = clone.querySelector(".uie-codex-del");
                    
                    el.dataset.id = id;
                    tEl.textContent = title;
                    dEl.textContent = when;
                    mEl.textContent = `${category}${keywords ? ` • ${keywords}` : ""}`;
                    bEl.textContent = m.body || "";
                    editBtn.dataset.id = id;
                    delBtn.dataset.id = id;
                    
                    frag.appendChild(clone);
                });
            container.append(frag);
        }
        return;
    }

    const list = s.journal[currentTab] || [];
    const filtered = list.filter(q => {
        if (!search) return true;
        return String(q?.title || "").toLowerCase().includes(search) || String(q?.desc || "").toLowerCase().includes(search);
    });

    if (filtered.length === 0) {
        container.html(`<div style="text-align:center; margin-top:50px; color:#aaa; font-style:italic;">No entries here.</div>`);
        return;
    }
    
    const tmplQuest = document.getElementById("uie-template-quest-entry");
    if (tmplQuest) {
        const frag = document.createDocumentFragment();
        filtered.forEach((q) => {
            const idx = list.indexOf(q);
            const clone = tmplQuest.content.cloneNode(true);
            const title = clone.querySelector(".uie-quest-title");
            const desc = clone.querySelector(".uie-quest-desc");
            const actionsDiv = clone.querySelector(".uie-quest-actions");
            
            title.textContent = q.title || "Unknown Quest";
            desc.textContent = q.desc || "Details faded...";
            
            if(currentTab === "pending") {
                actionsDiv.style.display = "flex";
                
                const btnAccept = document.createElement("button");
                btnAccept.className = "uie-btn-accept";
                btnAccept.dataset.idx = idx;
                btnAccept.textContent = "Accept";
                btnAccept.style.cssText = "background:#2ecc71; border:none; color:white; padding:8px 12px; border-radius:10px; cursor:pointer; font-weight:900;";
                
                const btnDeny = document.createElement("button");
                btnDeny.className = "uie-btn-deny";
                btnDeny.dataset.idx = idx;
                btnDeny.textContent = "Deny";
                btnDeny.style.cssText = "background:#e74c3c; border:none; color:white; padding:8px 12px; border-radius:10px; cursor:pointer; font-weight:900;";
                
                actionsDiv.appendChild(btnAccept);
                actionsDiv.appendChild(btnDeny);
            } else if(currentTab === "active") {
                actionsDiv.style.display = "flex";
                
                const btnComplete = document.createElement("button");
                btnComplete.className = "uie-btn-complete";
                btnComplete.dataset.idx = idx;
                btnComplete.textContent = "Complete";
                btnComplete.style.cssText = "background:#3498db; border:none; color:white; padding:5px 10px; border-radius:8px; cursor:pointer; font-weight:900; font-size:0.8em;";
                
                const btnFail = document.createElement("button");
                btnFail.className = "uie-btn-fail";
                btnFail.dataset.idx = idx;
                btnFail.textContent = "Fail";
                btnFail.style.cssText = "background:#e74c3c; border:none; color:white; padding:5px 10px; border-radius:8px; cursor:pointer; font-weight:900; font-size:0.8em;";
                
                actionsDiv.appendChild(btnComplete);
                actionsDiv.appendChild(btnFail);
            }
            
            frag.appendChild(clone);
        });
        container.append(frag);
    }
}

export function initJournal() {
    startChatIngest();
    
    const $win = $("#uie-journal-window");
    $win.off(".uieCodex .uieJournal .uieJournalAdd .uieJournalSparkle .uieJournalGen .uieJournalNew .uieJournalExtract");
    $(document).off(".uieCodex .uieJournal .uieJournalAdd .uieJournalSparkle .uieJournalGen .uieJournalNew .uieJournalExtract");

    const touchOk = (e) => !(e?.type === "pointerup" && e.pointerType !== "touch");
    let lastTouchSparkleAt = 0;

    $win.on("click.uieCodex pointerup.uieCodex", "#uie-codex-add", function(e) {
        if (!touchOk(e)) return;
        e.preventDefault();
        e.stopPropagation();
        const s = getSettings();
        ensureCodex(s);
        const title = (prompt("Codex title:") || "").trim();
        if (!title) return;
        const category = (prompt("Category (People/Places/Factions/etc):", "Culture") || "").trim() || "Lore";
        const body = (prompt("Codex body (reference text):") || "").trim();
        if (!body) return;
        const keywords = (prompt("Keywords (comma separated):") || "").split(",").map(x => x.trim()).filter(Boolean);
        upsertCodexEntry(s, { title, category, body, keywords });
        saveSettings();
        renderJournal();
    });
    $win.on("click.uieCodex pointerup.uieCodex", "#uie-codex-extract-desc", async function(e) {
        if (!touchOk(e)) return;
        e.preventDefault();
        e.stopPropagation();
        const desc = (prompt("Describe the lore you want to add to the Codex:") || "").trim();
        if (!desc) return;
        const btn = $(this);
        btn.prop("disabled", true);
        try { await generateCodexFromDescription(desc); } finally { btn.prop("disabled", false); }
        renderJournal();
    });
    $win.on("click.uieCodex pointerup.uieCodex", "#uie-codex-extract-chat", async function(e) {
        if (!touchOk(e)) return;
        e.preventDefault();
        e.stopPropagation();
        const btn = $(this);
        btn.prop("disabled", true);
        try { await extractCodexFromChat(); } finally { btn.prop("disabled", false); }
        renderJournal();
    });
    $win.on("click.uieCodex pointerup.uieCodex", "#uie-codex-toggle-auto", function(e) {
        if (!touchOk(e)) return;
        e.preventDefault(); e.stopPropagation();
        const s = getSettings();
        if (!s.features) s.features = {};
        s.features.codexAutoExtract = !s.features.codexAutoExtract;
        saveSettings();
        renderJournal();
        notify("info", `Codex Auto-Extract: ${s.features.codexAutoExtract ? "ON" : "OFF"}`, "Journal");
    });
    $win.on("click.uieCodex pointerup.uieCodex", ".uie-codex-entry", function(e) {
        if (!touchOk(e)) return;
        const t = $(e.target);
        if (t.closest("button").length) return;
        const $body = $(this).find(".uie-codex-body");
        const $actions = $(this).find(".uie-codex-actions");
        const open = $body.is(":visible");
        $body.toggle(!open);
        $actions.toggle(!open);
    });
    $win.on("click.uieCodex pointerup.uieCodex", ".uie-codex-del", function(e) {
        if (!touchOk(e)) return;
        e.preventDefault();
        e.stopPropagation();
        const id = String($(this).data("id") || "");
        if (!id) return;
        if (!confirm("Delete this Codex entry?")) return;
        const s = getSettings();
        ensureCodex(s);
        s.codex.entries = (s.codex.entries || []).filter(x => String(x?.id || "") !== id);
        saveSettings();
        renderJournal();
    });
    $win.on("click.uieCodex pointerup.uieCodex", ".uie-codex-edit", function(e) {
        if (!touchOk(e)) return;
        e.preventDefault();
        e.stopPropagation();
        const id = String($(this).data("id") || "");
        if (!id) return;
        const s = getSettings();
        ensureCodex(s);
        const cur = (s.codex.entries || []).find(x => String(x?.id || "") === id);
        if (!cur) return;
        const title = (prompt("Codex title:", cur.title || "") || "").trim() || cur.title;
        const category = (prompt("Category:", cur.category || "Lore") || "").trim() || cur.category;
        const body = (prompt("Body:", cur.body || "") || "").trim() || cur.body;
        const keywords = (prompt("Keywords (comma separated):", Array.isArray(cur.keywords) ? cur.keywords.join(", ") : "") || "").split(",").map(x => x.trim()).filter(Boolean);
        upsertCodexEntry(s, { id, title, category, body, keywords });
        saveSettings();
        renderJournal();
    });
    $win.on("click.uieJournal pointerup.uieJournal", ".uie-journal-sidebar .uie-tab", function(e) {
        if (!touchOk(e)) return;
        e.preventDefault();
        e.stopPropagation();
        $(".uie-journal-sidebar .uie-tab").css({color: "#888", borderLeft: "3px solid transparent"});
        $(this).css({color: "#cba35c", borderLeft: "3px solid #cba35c"});
        currentTab = $(this).data("tab");
        renderJournal();
    });

    // Journal sparkle dropdown
    $win.on("click.uieJournalSparkle pointerup.uieJournalSparkle", "#uie-journal-sparkle", function(e) {
        if (e.type === "pointerup") {
            if (e.pointerType !== "touch") return;
            lastTouchSparkleAt = Date.now();
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            $("#uie-journal-menu").toggle();
            return;
        }
        if (Date.now() - lastTouchSparkleAt < 650) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        $("#uie-journal-menu").toggle();
    });

    // GENERATE QUESTS
    $win.on("click.uieJournalGen pointerup.uieJournalGen", "#uie-journal-act-gen", async function(e) {
        if (e.type === "pointerup" && e.pointerType !== "touch") return;
        e.preventDefault();
        e.stopPropagation();
        $("#uie-journal-menu").hide();
        const sAllow = getSettings();
        if (sAllow?.ai && sAllow.ai.journalQuestGen === false) return;
        const btn = $("#uie-journal-sparkle");
        btn.addClass("fa-spin");
        notify("info", "Analyzing timeline for opportunities...", "Journal", "api");

        let rawLog = "";
        try {
            const $txt = $(".chat-msg-txt");
            if ($txt.length) {
                $txt.slice(-30).each(function () { rawLog += $(this).text() + "\n"; });
            } else {
                const chatEl = document.querySelector("#chat");
                if (chatEl) {
                    const msgs = Array.from(chatEl.querySelectorAll(".mes")).slice(-20);
                    for (const m of msgs) {
                        const isUser =
                            m.classList?.contains("is_user") ||
                            m.getAttribute("is_user") === "true" ||
                            m.getAttribute("data-is-user") === "true" ||
                            m.dataset?.isUser === "true";
                        const t =
                            m.querySelector(".mes_text")?.textContent ||
                            m.querySelector(".mes-text")?.textContent ||
                            m.textContent ||
                            "";
                        rawLog += `${isUser ? "You" : "Story"}: ${String(t || "").trim()}\n`;
                    }
                }
            }
        } catch (_) {}
        rawLog = String(rawLog || "").trim();

        const prompt = [
            "Generate 1-2 quests/objectives for the player based on the available context.",
            "You must work even if there is only 1 message of chat; if context is thin, create a safe, generic quest that matches the current setting, character card, lorebooks/world info, and persona.",
            "",
            rawLog ? `CHAT (recent):\n${rawLog.slice(0, 2200)}` : "CHAT (recent): [none]",
            "",
            "Output ONLY JSON array (no markdown):",
            `[{"title":"Quest Title","desc":"Short objective description (1-2 sentences)."}]`
        ].join("\n");

        try {
            const res = await generateContent(prompt, "Journal Quests");
            if (!res) throw new Error("No AI response");
            const quests = JSON.parse(String(res || "").trim());

            if (Array.isArray(quests) && quests.length > 0) {
                const s = getSettings();
                if (!s.journal) s.journal = { active: [], pending: [], abandoned: [], completed: [], codex: [] };
                if (!Array.isArray(s.journal.pending)) s.journal.pending = [];
                const all = []
                    .concat(Array.isArray(s.journal.pending) ? s.journal.pending : [])
                    .concat(Array.isArray(s.journal.active) ? s.journal.active : [])
                    .concat(Array.isArray(s.journal.completed) ? s.journal.completed : [])
                    .concat(Array.isArray(s.journal.abandoned) ? s.journal.abandoned : []);
                const seen = new Set(all.map(q => `${String(q?.title || "").toLowerCase().trim()}::${String(q?.desc || "").toLowerCase().trim()}`));
                let added = 0;
                for (const q of quests.slice(0, 4)) {
                    const title = String(q?.title || q?.name || "").trim().slice(0, 80);
                    const desc = String(q?.desc || q?.objective || q?.summary || "").trim().slice(0, 700);
                    if (!title && !desc) continue;
                    const sig = `${title.toLowerCase()}::${desc.toLowerCase()}`;
                    if (seen.has(sig)) continue;
                    seen.add(sig);
                    s.journal.pending.push({ title: title || "Quest", desc, source: "ai", ts: Date.now() });
                    added++;
                }
                saveSettings();
                $(".uie-journal-sidebar .uie-tab[data-tab='pending']").click();
                if (added) notify("success", `Found ${added} new potential quest(s)!`, "Journal", "questsAccepted");
                else notify("info", "No new quests (already tracked).", "Journal", "questsAccepted");
            } else {
                notify("warning", "No quests returned.", "Journal", "questsAccepted");
            }

        } catch(e) {
            console.error(e);
            notify("error", "Failed to generate quests.", "Journal", "api");
        }
        btn.removeClass("fa-spin");
    });

    // MANUAL QUEST ADD
    $win.on("click.uieJournalNew pointerup.uieJournalNew", "#uie-journal-act-new", function(e) {
        if (e.type === "pointerup" && e.pointerType !== "touch") return;
        e.preventDefault();
        e.stopPropagation();
        $("#uie-journal-menu").hide();
        const title = (prompt("Entry title:") || "").trim();
        if (!title) return;
        const desc = (prompt("Entry details (optional):") || "").trim();
        const s = getSettings();
        if (!s.journal) s.journal = { active: [], pending: [], abandoned: [], completed: [], codex: [] };
        if (!Array.isArray(s.journal.pending)) s.journal.pending = [];
        s.journal.pending.push({ title: title.slice(0, 80), desc: desc.slice(0, 600), source: "manual", ts: Date.now() });
        saveSettings();
        $(".uie-journal-sidebar .uie-tab[data-tab='pending']").click();
    });

    $win.on("click.uieJournalExtract pointerup.uieJournalExtract", "#uie-journal-act-extract", function(e) {
        if (e.type === "pointerup" && e.pointerType !== "touch") return;
        e.preventDefault();
        e.stopPropagation();
        $("#uie-journal-menu").hide();
        let raw = "";
        $(".chat-msg-txt").slice(-30).each(function() { raw += $(this).text() + "\n"; });
        const added = ingestQuestsFromChatText(raw);
        if (!added) notify("info", "No quests found to extract.", "Journal", "questsAccepted");
        else $(".uie-journal-sidebar .uie-tab[data-tab='pending']").click();
    });

    // ACCEPT QUEST
    $win.on("click.uieJournal pointerup.uieJournal", ".uie-btn-accept", function(e) {
        if (!touchOk(e)) return;
        e.preventDefault();
        e.stopPropagation();
        const idx = $(this).data("idx");
        const s = getSettings();
        const quest = s.journal.pending[idx];
        
        s.journal.pending.splice(idx, 1);
        s.journal.active.push(quest);
        saveSettings();
        try { if (quest) injectRpEvent(`[System: Quest '${String(quest.title || "Quest")}' is now Active.]`); } catch (_) {}
        renderJournal();
        notify("success", "Quest Accepted!", "Quests", "questsAccepted");
    });

    // DENY QUEST
    $win.on("click.uieJournal pointerup.uieJournal", ".uie-btn-deny", function(e) {
        if (!touchOk(e)) return;
        e.preventDefault();
        e.stopPropagation();
        const idx = $(this).data("idx");
        const s = getSettings();

        const quest = s.journal.pending[idx];
        s.journal.pending.splice(idx, 1);
        if (!Array.isArray(s.journal.abandoned)) s.journal.abandoned = [];
        if (quest) s.journal.abandoned.push({ ...quest, failed: false, abandonedAt: Date.now() });
        saveSettings();
        try { if (quest) injectRpEvent(`[System: Quest '${String(quest.title || "Quest")}' is now Abandoned.]`); } catch (_) {}
        renderJournal();
        notify("info", "Quest Abandoned.", "Quests", "questsAbandoned");
    });

    // COMPLETE QUEST
    $win.on("click.uieJournal pointerup.uieJournal", ".uie-btn-complete", function(e) {
        if (!touchOk(e)) return;
        e.preventDefault();
        e.stopPropagation();
        const idx = $(this).data("idx");
        const s = getSettings();
        if(!s || !s.journal) return;
        const quest = s.journal.active[idx];
        if(!quest) return;

        s.journal.active.splice(idx, 1);
        s.journal.completed.push(quest);

        const gain = 50;
        s.xp = Number(s.xp || 0) + gain;

        saveSettings();
        try { injectRpEvent(`[System: Quest '${String(quest.title || "Quest")}' is now Completed.]`); } catch (_) {}
        renderJournal();
        notify("success", `Quest Completed! +${gain} XP`, "Quests", "questsCompleted");
        $(document).trigger("uie:updateVitals");
    });

    // FAIL QUEST (XP + Hearts loss)
    $win.on("click.uieJournal pointerup.uieJournal", ".uie-btn-fail", function(e) {
        if (!touchOk(e)) return;
        e.preventDefault();
        e.stopPropagation();
        const idx = $(this).data("idx");
        const s = getSettings();
        if(!s || !s.journal) return;
        const quest = s.journal.active[idx];
        if(!quest) return;

        s.journal.active.splice(idx, 1);
        s.journal.abandoned.push({ ...quest, failed: true, failedAt: Date.now() });

        const xpLoss = 25;
        const heartLoss = 1;
        s.xp = Math.max(0, Number(s.xp || 0) - xpLoss);
        s.hearts = Math.max(0, Number(s.hearts || 0) - heartLoss);

        saveSettings();
        try { injectRpEvent(`[System: Quest '${String(quest.title || "Quest")}' is now Failed.]`); } catch (_) {}
        renderJournal();
        notify("error", `Quest Failed! -${xpLoss} XP, -${heartLoss} Heart`, "Quests", "questsFailed");
        $(document).trigger("uie:updateVitals");
    });
}

function ensureCodex(s) {
    if (!s.codex) s.codex = { entries: [] };
    if (!Array.isArray(s.codex.entries)) s.codex.entries = [];
}

function upsertCodexEntry(s, entry) {
    ensureCodex(s);
    const e = entry && typeof entry === "object" ? entry : {};
    const id = String(e.id || Date.now());
    const title = String(e.title || "Codex").slice(0, 80);
    const category = String(e.category || "Lore").slice(0, 40);
    const body = String(e.body || e.text || "").slice(0, 5000);
    const keywords = Array.isArray(e.keywords) ? e.keywords.map(x => String(x || "").trim()).filter(Boolean).slice(0, 16) : [];
    const updatedAt = Date.now();

    const idx = s.codex.entries.findIndex(x => String(x?.id || "") === id);
    const obj = { id, title, category, body, keywords, updatedAt };
    if (idx >= 0) s.codex.entries[idx] = obj;
    else s.codex.entries.push(obj);
}

async function generateCodexFromDescription(desc) {
    const sAllow = getSettings();
    if (sAllow?.features?.codexEnabled !== true) return;
    const s = getSettings();
    ensureCodex(s);

    const prompt = `
Create a Codex entry (Dragon Age style encyclopedia). Lore only.
Hard rules:
- Do NOT log small events (no "picked up a sword", no moment-to-moment actions).
- Do NOT invent world-changing canon unless supported by context.
- Write as reference text: neutral, informative, in-universe.
- If you cannot justify the entry as stable lore, return {"entries":[]}.
Return ONLY JSON:
{
  "entries":[{"title":"","category":"People|Places|Factions|Creatures|Magic|History|Religion|Technology|Culture|Items","body":"","keywords":["",""]}]
}

Description:
${desc}
`;
    const res = await generateContent(prompt.slice(0, 6000), "System Check");
    if (!res) return;
    let obj = null;
    try { obj = JSON.parse(String(res).replace(/```json|```/g, "").trim()); } catch (_) { obj = null; }
    const arr = Array.isArray(obj?.entries) ? obj.entries : [];
    if (!arr.length) return;
    for (const e of arr.slice(0, 6)) upsertCodexEntry(s, e);
    saveSettings();
}

async function extractCodexFromChat() {
    const sAllow = getSettings();
    if (sAllow?.features?.codexEnabled !== true) return;
    const s = getSettings();
    ensureCodex(s);

    let raw = "";
    $(".chat-msg-txt").slice(-60).each(function () { raw += $(this).text() + "\n"; });
    raw = raw.trim().slice(0, 5000);
    if (!raw) return;

    const prompt = `
Extract Codex-grade lore from this chat. Lore only.
Hard rules:
- Ignore small actions, loot, minor scene beats, casual dialogue.
- Keep only stable encyclopedia-worthy lore: factions, locations, history, species, magic rules, institutions, tech, culture.
- If nothing qualifies, return {"entries":[]} .
Return ONLY JSON:
{
  "entries":[{"title":"","category":"People|Places|Factions|Creatures|Magic|History|Religion|Technology|Culture|Items","body":"","keywords":["",""]}]
}

CHAT LOG:
${raw}
`;
    const res = await generateContent(prompt.slice(0, 6000), "System Check");
    if (!res) return;
    let obj = null;
    try { obj = JSON.parse(String(res).replace(/```json|```/g, "").trim()); } catch (_) { obj = null; }
    const arr = Array.isArray(obj?.entries) ? obj.entries : [];
    if (!arr.length) return;
    for (const e of arr.slice(0, 8)) upsertCodexEntry(s, e);
    saveSettings();
}
