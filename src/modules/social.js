import { getSettings, saveSettings } from "./core.js";
import { generateContent } from "./apiClient.js";
import { getContext } from "../../../../../extensions.js"; 
import { notify } from "./notifications.js";
import { injectRpEvent } from "./features/rp_log.js";

let currentTab = "friends";
let deleteMode = false;
let selectedForDelete = [];
let tempImgBase64 = null;
let isInitialized = false;
let editingIndex = null;
let activeProfileIndex = null;
let socialLongPressTimer = null;
let socialLongPressFired = false;
let autoScanTimer = null;
let autoScanInFlight = false;
let autoScanLastAt = 0;

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

function baseUrl() {
    try {
        const u = String(window.UIE_BASEURL || "");
        if (u) return u.endsWith("/") ? u : `${u}/`;
    } catch (_) {}
    return "/scripts/extensions/third-party/universal-immersion-engine/";
}

async function ensurePhoneThread(name) {
    const nm = String(name || "").trim();
    if (!nm) return;
    try {
        if ($("#uie-phone-window").length === 0) {
            const modFetch = await import("./templateFetch.js");
            const html = await modFetch.fetchTemplateHtml(`${baseUrl()}src/templates/phone.html`);
            $("body").append(html);
        }
        const mod = await import("./phone.js");
        if (typeof mod?.initPhone === "function") mod.initPhone();
        if (typeof window.UIE_phone_openThread === "function") window.UIE_phone_openThread(nm);
    } catch (e) {
        console.error("[UIE] Social message open failed", e);
        notify("error", "Phone messaging failed to open.", "UIE", "api");
    }
}

function resolveCurrentCharAvatarUrl() {
    try {
        const ctx = getContext?.();
        const c = ctx?.character || ctx?.char || ctx?.characterCard || (Array.isArray(ctx?.characters) ? ctx.characters[0] : null) || null;
        const card = c?.data?.data || c?.data || c || {};
        const direct =
            card?.avatar ||
            card?.avatar_url ||
            c?.avatar ||
            c?.avatar_url ||
            ctx?.avatar_url ||
            ctx?.char_avatar ||
            "";
        if (direct) return String(direct);

        const name2 = String(ctx?.name2 || "").trim().toLowerCase();
        if (name2) {
            const imgs = Array.from(document.querySelectorAll("img")).slice(0, 250);
            for (const img of imgs) {
                const alt = String(img?.alt || "").trim().toLowerCase();
                if (alt && alt.includes(name2) && img?.src) return String(img.src);
            }
        }
    } catch (_) {}
    return "";
}

function findAvatarForNameFromChat(name) {
    try {
        const n = String(name || "").trim().toLowerCase();
        if (!n) return "";
        const chatEl = document.querySelector("#chat");
        if (!chatEl) return "";
        const nodes = Array.from(chatEl.querySelectorAll(".mes")).slice(-80).reverse();
        for (const m of nodes) {
            const nm =
                m.querySelector(".mes_name")?.textContent ||
                m.querySelector(".name_text")?.textContent ||
                m.querySelector(".name")?.textContent ||
                "";
            if (String(nm || "").trim().toLowerCase() !== n) continue;
            const img =
                m.querySelector(".mesAvatar img") ||
                m.querySelector(".mes_avatar img") ||
                m.querySelector(".avatar img");
            if (img?.src) return String(img.src);
        }
    } catch (_) {}
    return "";
}

function normalizeSocial(s) {
    if(!s.social) s.social = { friends: [], associates: [], romance: [], family: [], rivals: [] };
    ["friends","associates","romance","family","rivals"].forEach(k => { if(!Array.isArray(s.social[k])) s.social[k] = []; });
    if (!s.socialMeta || typeof s.socialMeta !== "object") s.socialMeta = { autoScan: false, deletedNames: [] };
    if (!Array.isArray(s.socialMeta.deletedNames)) s.socialMeta.deletedNames = [];
    ["friends","associates","romance","family","rivals"].forEach(k => {
        (s.social[k] || []).forEach(p => {
            if (!p || typeof p !== "object") return;
            if (!p.id) p.id = newId("person");
            if (p.familyRole === undefined) p.familyRole = "";
            if (p.relationshipStatus === undefined) p.relationshipStatus = "";
            if (p.met_physically === undefined) p.met_physically = false;
            if (p.known_from_past === undefined) p.known_from_past = false;
            if (!Array.isArray(p.memories)) p.memories = [];
        });
    });

    const hateThreshold = 20;
    const rivals = s.social.rivals;
    const rivalNames = new Set(rivals.map(p => String(p?.name || "").toLowerCase()).filter(Boolean));

    const moveToRivals = (arr) => {
        const keep = [];
        for (const p of arr) {
            const aff = Number(p?.affinity ?? 0);
            const name = String(p?.name || "");
            if (name && aff <= hateThreshold) {
                const key = name.toLowerCase();
                if (!rivalNames.has(key)) {
                    rivals.push(p);
                    rivalNames.add(key);
                }
            } else {
                keep.push(p);
            }
        }
        return keep;
    };

    const before = { f: s.social.friends.length, r: s.social.romance.length, fa: s.social.family.length, rv: s.social.rivals.length };
    s.social.friends = moveToRivals(s.social.friends);
    s.social.associates = moveToRivals(s.social.associates);
    s.social.romance = moveToRivals(s.social.romance);
    s.social.family = moveToRivals(s.social.family);
    const after = { f: s.social.friends.length, r: s.social.romance.length, fa: s.social.family.length, rv: s.social.rivals.length };
    return before.f !== after.f || before.r !== after.r || before.fa !== after.fa || before.rv !== after.rv;
}

function deletedNameSet(s) {
    normalizeSocial(s);
    const arr = Array.isArray(s?.socialMeta?.deletedNames) ? s.socialMeta.deletedNames : [];
    return new Set(arr.map(x => String(x || "").toLowerCase().trim()).filter(Boolean));
}

function rememberDeletedNames(s, names) {
    normalizeSocial(s);
    const cur = new Set((s.socialMeta.deletedNames || []).map(x => String(x || "").toLowerCase().trim()).filter(Boolean));
    for (const n of (names || [])) {
        const k = String(n || "").toLowerCase().trim();
        if (k) cur.add(k);
    }
    s.socialMeta.deletedNames = Array.from(cur).slice(-400);
}

function unforgetDeletedName(s, name) {
    normalizeSocial(s);
    const k = String(name || "").toLowerCase().trim();
    if (!k) return;
    s.socialMeta.deletedNames = (s.socialMeta.deletedNames || []).filter(x => String(x || "").toLowerCase().trim() !== k);
}

function getChatTranscript(maxMessages) {
    const out = [];
    try {
        const nodes = getChatMessageNodes(maxMessages || 80);
        for (const m of nodes) {
            const name =
                m.querySelector?.(".mes_name")?.textContent ||
                m.querySelector?.(".name_text")?.textContent ||
                m.querySelector?.(".name")?.textContent ||
                m.querySelector?.(".ch_name")?.textContent ||
                m.getAttribute?.("ch_name") ||
                m.getAttribute?.("data-name") ||
                m.dataset?.name ||
                m.dataset?.chName ||
                "";
            const text =
                m.querySelector?.(".mes_text")?.textContent ||
                m.querySelector?.(".mes-text")?.textContent ||
                m.querySelector?.(".message")?.textContent ||
                m.textContent ||
                "";
            const nm = String(name || "").trim() || "Unknown";
            const tx = String(text || "").trim();
            if (!tx) continue;
            out.push(`${nm}: ${tx}`);
        }
    } catch (_) {}
    return out.join("\n").slice(-14000);
}

function getChatMessageNodes(maxMessages) {
    const max = Math.max(20, Number(maxMessages || 120));
    try {
        const sels = [
            "#chat .mes",
            "#chat .mes_block",
            "#chat .mes_wrap",
            "#chat .chat-message",
            "#chat .chat_message",
            "#chat .message",
        ];
        const all = [];
        for (const sel of sels) {
            try {
                const nodes = Array.from(document.querySelectorAll(sel));
                for (const n of nodes) all.push(n);
            } catch (_) {}
        }
        const uniq = [];
        const seen = new Set();
        for (const n of all) {
            if (!n || !n.getBoundingClientRect) continue;
            const key = n.dataset?.mesId || n.getAttribute?.("mesid") || n.id || `${n.className}-${uniq.length}`;
            const k = `${key}-${n.tagName}`;
            if (seen.has(k)) continue;
            seen.add(k);
            uniq.push(n);
        }
        return uniq.slice(-1 * max);
    } catch (_) {
        return [];
    }
}

function getActivePerson() {
    const s = getSettings();
    normalizeSocial(s);
    const idx = Number(activeProfileIndex);
    if (!Number.isFinite(idx)) return { s, person: null };
    const person = s?.social?.[currentTab]?.[idx] || null;
    if (person && !person.id) person.id = newId("person");
    if (person && !Array.isArray(person.memories)) person.memories = [];
    return { s, person };
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

function renderMemoryOverlay() {
    const { person } = getActivePerson();
    if (!person) return;
    const ctx = getContext ? getContext() : {};
    const user = String(ctx?.name1 || "User");
    $("#uie-social-mem-sub").text(`${person.name} ↔ ${user}`);

    const list = Array.isArray(person.memories) ? person.memories.slice() : [];
    list.sort((a, b) => Number(b?.t || 0) - Number(a?.t || 0));
    const $list = $("#uie-social-mem-list");
    $list.empty();
    if (!list.length) {
        $("#uie-social-mem-empty").show();
        return;
    }
    $("#uie-social-mem-empty").hide();
    for (const mem of list) {
        const id = String(mem?.id || "");
        const text = String(mem?.text || "").trim();
        const impact = String(mem?.impact || "").trim();
        const tags = Array.isArray(mem?.tags) ? mem.tags.map(t => String(t || "").trim()).filter(Boolean).slice(0, 6) : [];
        const tagHtml = tags.length ? `<div style="margin-top:6px; display:flex; gap:6px; flex-wrap:wrap;">${tags.map(t => `<span style="font-size:11px; padding:3px 8px; border-radius:999px; background:rgba(0,0,0,0.08); border:1px solid rgba(74,46,22,0.18); color:#4a2e16; font-weight:900;">${esc(t)}</span>`).join("")}</div>` : "";
        const row = $(`
            <div style="border:1px solid rgba(0,0,0,0.12); border-radius:12px; background:rgba(255,255,255,0.55); padding:10px; color:#4a2e16;">
                <div style="display:flex; gap:10px; align-items:flex-start;">
                    <div style="flex:1; min-width:0;">
                        <div style="font-weight:900; font-family:serif; line-height:1.35;">${esc(text || "—")}</div>
                        ${impact ? `<div style="margin-top:6px; font-size:12px; opacity:0.85;"><strong>Impact:</strong> ${esc(impact)}</div>` : ""}
                        ${tagHtml}
                    </div>
                    <div class="uie-p-icon-btn danger uie-social-mem-del" data-mid="${esc(id)}" title="Delete" style="width:34px; height:34px;"><i class="fa-solid fa-trash"></i></div>
                </div>
            </div>
        `);
        $list.append(row);
    }
    saveSettings();
}

async function scanMemoriesForActivePerson() {
    const { person } = getActivePerson();
    if (!person) return;
    const ctx = getContext ? getContext() : {};
    const user = String(ctx?.name1 || "User");
    const transcript = getChatTranscript(90);
    if (!transcript) {
        try { window.toastr?.info?.("No chat transcript found."); } catch (_) {}
        return;
    }

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
    renderMemoryOverlay();
    try { window.toastr?.success?.(added ? `Added ${added} memory${added === 1 ? "" : "ies"}.` : "No new vital memories found."); } catch (_) {}
}

export function renderSocial() {
    if (!isInitialized) { initSocial(); isInitialized = true; }

    const s = getSettings();
    const changed = normalizeSocial(s);
    if (changed) saveSettings();

    const list = s.social[currentTab] || [];
    const container = $("#uie-social-content");

    container.find(".uie-social-grid, .no-data-msg").remove();

    if (list.length === 0) {
        container.prepend(`<div class="no-data-msg" style="text-align:center; margin-top:50px; color:#4a2e16; font-family:serif; font-size:1.2em;">- Empty Page -</div>`);
    } else {
        const grid = $(`<div class="uie-social-grid"></div>`);
        let avatarChanged = false;
        list.forEach((person, index) => {
            const isSel = deleteMode && selectedForDelete.includes(index);
            let avatar = String(person.avatar || "").trim();
            try {
                const m = avatar.match(/^<char(?::([^>]+))?>$/i);
                if (m) {
                    const want = String(m[1] || "").trim().toLowerCase();
                    if (!want) avatar = resolveCurrentCharAvatarUrl();
                    else {
                        const s2 = getSettings();
                        const pm = Array.isArray(s2?.party?.members) ? s2.party.members : [];
                        const hit = pm.find(x => String(x?.identity?.name || "").trim().toLowerCase() === want);
                        const p2 = String(hit?.images?.portrait || "").trim();
                        avatar = p2 || resolveCurrentCharAvatarUrl();
                    }
                }
            } catch (_) {}
            if (!avatar) {
                const fromChat = findAvatarForNameFromChat(person.name);
                if (fromChat) avatar = fromChat;
                else {
                    try {
                        const ctx = getContext?.();
                        const name2 = String(ctx?.name2 || "").trim().toLowerCase();
                        if (name2 && String(person.name || "").trim().toLowerCase() === name2) {
                            avatar = resolveCurrentCharAvatarUrl();
                        }
                    } catch (_) {}
                }
            }
            if (avatar && avatar !== person.avatar) {
                person.avatar = avatar;
                avatarChanged = true;
            }

            const avatarHtml = avatar
                ? `<img src="${esc(avatar)}" style="width:100%; height:100%; object-fit:cover;">`
                : `<i class="fa-solid fa-user"></i>`;

            const tag = (person?.met_physically === true) ? "" : (person?.known_from_past === true ? "PAST" : "MENTION");
            const tagHtml = tag ? `<div style="font-size:10px; opacity:0.75; border:1px solid rgba(255,255,255,0.18); padding:2px 8px; border-radius:999px;">${tag}</div>` : "";
            const card = $(`
                <div class="uie-social-card ${isSel ? 'delete-selected' : ''}" data-idx="${index}">
                    <div class="uie-s-avatar">${avatarHtml}</div>
                    <div class="uie-s-name">${esc(person.name)}</div>
                    ${tagHtml}
                </div>
            `);
            grid.append(card);
        });
        if (avatarChanged) saveSettings();
        container.prepend(grid);
    }
    
    if(deleteMode) $("#uie-delete-controls").css("display", "flex");
    else $("#uie-delete-controls").hide();
}

function safeUrl(raw) {
    let u = String(raw || "").trim();
    if (!u) return "";
    if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
    return u;
}

// ... (KEEPING YOUR OPENPROFILE LOGIC) ...
function openProfile(index, anchorEl) {
    const s = getSettings();
    normalizeSocial(s);
    const person = s.social[currentTab][index];
    if(!person) return;
    activeProfileIndex = index;
    if (!person.id) person.id = newId("person");
    if (!Array.isArray(person.memories)) person.memories = [];
    saveSettings();

    $(".uie-p-name-lg").text(person.name);
    $("#p-val-status").text(`"${person.thoughts || '...'}"`);
    $("#p-val-bday").text(person.birthday || "Unknown");
    $("#p-val-loc").text(person.location || "Unknown");
    $("#p-val-age").text(person.age || "Unknown");
    $("#p-val-family").text(person.knownFamily || "Unknown");
    $("#p-val-family-role").text(person.familyRole || "—");
    const affNum = Math.max(0, Math.min(100, Number(person.affinity ?? 50)));
    const disp = (() => {
        if (affNum <= 10) return "Hostile";
        if (affNum <= 25) return "Wary";
        if (affNum <= 45) return "Cold";
        if (affNum <= 60) return "Neutral";
        if (affNum <= 75) return "Warm";
        if (affNum <= 90) return "Friendly";
        return "Devoted";
    })();
    $("#p-val-rel-status").text(`${person.relationshipStatus || "—"} (${disp}, ${affNum}/100)`);
    try {
        const pres = person.met_physically === true ? "Present / met in scene" : (person.known_from_past === true ? "Known from the past (not present)" : "Mentioned only");
        $("#p-val-presence").text(pres);
    } catch (_) {}
    $("#p-val-likes").text(person.likes || "-");
    $("#p-val-dislikes").text(person.dislikes || "-");

    const av = String(person.avatar || "").trim();
    if(av) { $("#p-img-disp").attr("src", av).show(); $(".uie-p-portrait i").hide(); } 
    else { $("#p-img-disp").hide(); $(".uie-p-portrait i").show(); }

    const aff = Number(person.affinity || 0);
    const hearts = "❤".repeat(Math.floor(aff / 20)) + "♡".repeat(5 - Math.floor(aff / 20));
    $(".uie-p-hearts-lg").text(hearts);

    const $ov = $("#uie-social-overlay");
    $ov.attr("data-open", "1").show();
    const $paper = $ov.find(".uie-paper-box");
    try {
        const w = Math.max(240, Number($paper.outerWidth?.() || 0) || 360);
        const h = Math.max(240, Number($paper.outerHeight?.() || 0) || 520);
        const vw = window.innerWidth || document.documentElement.clientWidth || 0;
        const vh = window.innerHeight || document.documentElement.clientHeight || 0;
        const x = Math.max(14, Math.floor((vw - w) / 2));
        const y = Math.max(14, Math.floor((vh - h) / 2));
        $paper.css({ top: y, left: x, right: "", bottom: "", transform: "none" });
    } catch (_) {}
}

function readFileAsBase64(file) {
    return new Promise((resolve) => {
        if (!file) return resolve(null);
        const r = new FileReader();
        r.onload = (e) => resolve(String(e?.target?.result || ""));
        r.onerror = () => resolve(null);
        r.readAsDataURL(file);
    });
}

function openAddModal({ mode, index }) {
    const s = getSettings();
    const p = (mode === "edit" && Number.isFinite(index)) ? (s.social[currentTab][index] || {}) : {};
    editingIndex = (mode === "edit" && Number.isFinite(index)) ? index : null;
    tempImgBase64 = p.avatar || null;

    $("#uie-add-modal > div:first").text(mode === "edit" ? "EDIT CONTACT" : "NEW CONTACT");
    $("#uie-submit-add").text(mode === "edit" ? "Save" : "Add to Book");

    $("#uie-add-name").val(p.name || "");
    $("#uie-add-age").val(p.age || "");
    $("#uie-add-family").val(p.knownFamily || "");
    $("#uie-add-family-role").val(p.familyRole || "");
    $("#uie-add-rel-status").val(p.relationshipStatus || "");
    $("#uie-add-tab").val(p.tab || currentTab);
    $("#uie-add-affinity").val(Number(p.affinity || 0));
    $("#uie-add-url").val(p.url || "");
    $("#uie-add-bday").val(p.birthday || "");
    $("#uie-add-loc").val(p.location || "");
    $("#uie-add-thoughts").val(p.thoughts || "");
    $("#uie-add-likes").val(p.likes || "");
    $("#uie-add-dislikes").val(p.dislikes || "");
    try { $("#uie-add-known-past").prop("checked", p.known_from_past === true); } catch (_) {}
    try { $("#uie-add-met-phys").prop("checked", p.met_physically === true); } catch (_) {}

    if (tempImgBase64) {
        $("#uie-add-preview").attr("src", tempImgBase64).show();
        $("#uie-add-icon").hide();
    } else {
        $("#uie-add-preview").hide();
        $("#uie-add-icon").show();
    }

    $("#uie-social-menu").hide();
    $("#uie-add-modal").show();
}

function closeAddModal() {
    $("#uie-add-modal").hide();
    $("#uie-add-img-file").val("");
    editingIndex = null;
    tempImgBase64 = null;
}

function applyAddOrEdit() {
    const s = getSettings();
    normalizeSocial(s);

    const name = String($("#uie-add-name").val() || "").trim();
    if (!name) return;

    const tab = String($("#uie-add-tab").val() || currentTab);
    const affinity = Math.max(0, Math.min(100, Number($("#uie-add-affinity").val() || 0)));
    const person = {
        name,
        age: String($("#uie-add-age").val() || "").trim(),
        knownFamily: String($("#uie-add-family").val() || "").trim(),
        familyRole: String($("#uie-add-family-role").val() || "").trim(),
        relationshipStatus: String($("#uie-add-rel-status").val() || "").trim(),
        affinity,
        url: String($("#uie-add-url").val() || "").trim(),
        birthday: String($("#uie-add-bday").val() || "").trim(),
        location: String($("#uie-add-loc").val() || "").trim(),
        thoughts: String($("#uie-add-thoughts").val() || "").trim(),
        likes: String($("#uie-add-likes").val() || "").trim(),
        dislikes: String($("#uie-add-dislikes").val() || "").trim(),
        avatar: tempImgBase64 || "",
        tab,
        known_from_past: $("#uie-add-known-past").prop("checked") === true,
        met_physically: $("#uie-add-met-phys").prop("checked") === true
    };
    if (person.met_physically) person.known_from_past = false;

    if (editingIndex !== null && s.social[currentTab] && s.social[currentTab][editingIndex]) {
        const prev = s.social[currentTab][editingIndex];
        s.social[currentTab].splice(editingIndex, 1);
        const t = tab || currentTab;
        s.social[t].push({ ...prev, ...person });
    } else {
        const t = tab || currentTab;
        s.social[t].push({ id: newId("person"), memories: [], familyRole: "", relationshipStatus: "", ...person });
    }
    try { unforgetDeletedName(s, name); } catch (_) {}
    saveSettings();
    closeAddModal();
    renderSocial();
}

function toggleDeleteMode() {
    deleteMode = !deleteMode;
    selectedForDelete = [];
    $("#uie-social-menu").hide();
    try {
        if (deleteMode) window.toastr?.info?.("Mass delete: tap contacts to select, then CONFIRM DELETE.");
    } catch (_) {}
    renderSocial();
}

function confirmMassDelete() {
    const s = getSettings();
    normalizeSocial(s);
    const list = s.social[currentTab] || [];
    const selectedIdx = new Set((selectedForDelete || []).map(x => Number(x)).filter(n => Number.isFinite(n)));
    const selectedNames = new Set(
        (selectedForDelete || [])
            .map(x => (Number.isFinite(Number(x)) ? "" : String(x || "")))
            .map(x => x.trim().toLowerCase())
            .filter(Boolean)
    );
    const isSelected = (p, idx) => {
        if (selectedIdx.has(idx)) return true;
        const nm = String(p?.name || "").trim().toLowerCase();
        return nm && selectedNames.has(nm);
    };
    const removed = list.filter((p, idx) => isSelected(p, idx)).map(p => String(p?.name || "").trim()).filter(Boolean);
    if (!removed.length) {
        try { window.toastr?.info?.("No contacts selected."); } catch (_) {}
        return;
    }
    try { rememberDeletedNames(s, removed); } catch (_) {}
    const keep = list.filter((p, idx) => !isSelected(p, idx));
    s.social[currentTab] = keep;
    saveSettings();
    deleteMode = false;
    selectedForDelete = [];
    renderSocial();
    try { window.toastr?.success?.(`Deleted ${removed.length} contact(s).`); } catch (_) {}
}

function cancelMassDelete() {
    deleteMode = false;
    selectedForDelete = [];
    renderSocial();
}

function extractNamesFromChatDom(maxMessages) {
    const names = new Set();
    try {
        const nodes = getChatMessageNodes(maxMessages || 180);
        const ctx = getContext ? getContext() : {};
        const userName = String(ctx?.name1 || "").trim().toLowerCase();
        for (const m of nodes) {
            const isUser =
                m.classList?.contains("is_user") ||
                m.getAttribute?.("is_user") === "true" ||
                m.getAttribute?.("data-is-user") === "true" ||
                m.dataset?.isUser === "true";
            if (isUser) continue;
            const nm =
                m.querySelector(".mes_name")?.textContent ||
                m.querySelector(".name_text")?.textContent ||
                m.querySelector(".name")?.textContent ||
                m.querySelector(".ch_name")?.textContent ||
                m.getAttribute?.("ch_name") ||
                m.getAttribute?.("data-name") ||
                m.dataset?.name ||
                m.dataset?.chName ||
                "";
            const n = String(nm || "").trim();
            if (userName && n.toLowerCase() === userName) continue;
            if (n && n.length <= 64) names.add(n);
        }
    } catch (_) {}
    return Array.from(names);
}

function extractTaggedNamesFromChatText(maxMessages) {
    const names = new Set();
    try {
        const nodes = Array.from(document.querySelectorAll("#chat .mes_text, #chat .mes_text *")).map(n => n.textContent).filter(Boolean);
        const blob = nodes.join("\n");
        const lines = blob.split("\n").slice(-1 * Math.max(20, Number(maxMessages || 120)));
        const reA = /<char:([^>]{2,48})>/ig;
        const reB = /<npc:([^>]{2,48})>/ig;
        const reC = /^<([^>]{2,48})>:\s/;
        for (const line of lines) {
            const s = String(line || "");
            let m = null;
            while ((m = reA.exec(s)) !== null) names.add(String(m[1] || "").trim());
            while ((m = reB.exec(s)) !== null) names.add(String(m[1] || "").trim());
            const c = s.match(reC);
            if (c && c[1]) names.add(String(c[1] || "").trim());
        }
    } catch (_) {}
    return Array.from(names);
}

function shouldExcludeName(n, { userNames, deletedSet } = {}) {
    const name = String(n || "").trim();
    if (!name) return true;
    const k = name.toLowerCase();
    if (deletedSet && deletedSet.has(k)) return true;
    const hard = new Set(["you", "user", "narrator", "system", "assistant", "story", "gm", "game master"]);
    if (hard.has(k)) return true;
    if (Array.isArray(userNames) && userNames.some(u => String(u || "").toLowerCase().trim() === k)) return true;
    return false;
}

async function promptOrganizationForNewContacts(names) {
    const list = Array.isArray(names) ? names.map(x => String(x || "").trim()).filter(Boolean) : [];
    if (!list.length) return;
    const max = 8;
    const subset = list.slice(0, max);
    for (const nm of subset) {
        const tab = prompt(`Organize contact: ${nm}\nTab? (friends/associates/romance/family/rivals)\nBlank = keep default (friends)`, "") ?? "";
        if (tab === null) break;
        const t = String(tab || "").trim().toLowerCase();
        const wantTab =
            (t === "romance" || t === "relationships") ? "romance" :
            (t === "family") ? "family" :
            (t === "rivals" || t === "rival") ? "rivals" :
            (t === "associates" || t === "associate" || t === "acquaintance" || t === "acquaintances") ? "associates" :
            (t === "friends" ? "friends" : "");
        const rel = prompt(`Relationship status for ${nm}? (optional)`, "") ?? "";
        const affRaw = prompt(`Initial affinity for ${nm}? (0-100)`, "50");
        if (affRaw === null) break;
        const aff = Math.max(0, Math.min(100, Number(affRaw || 50)));
        const origin = prompt(`Origin / where did ${nm} come from? (optional)`, "") ?? "";

        const s = getSettings();
        normalizeSocial(s);
        const allTabs = ["friends","associates","romance","family","rivals"];
        let curTab = allTabs.find(k => (s.social[k] || []).some(p => String(p?.name || "").trim().toLowerCase() === nm.toLowerCase())) || "friends";
        let idx = (s.social[curTab] || []).findIndex(p => String(p?.name || "").trim().toLowerCase() === nm.toLowerCase());
        if (idx < 0) continue;
        const p = s.social[curTab][idx];
        p.affinity = aff;
        if (String(rel || "").trim()) p.relationshipStatus = String(rel || "").trim().slice(0, 80);
        if (String(origin || "").trim()) {
            const o = String(origin || "").trim().slice(0, 160);
            p.thoughts = p.thoughts ? String(p.thoughts).slice(0, 240) : `Origin: ${o}`;
        }
        const move = wantTab && wantTab !== curTab;
        if (move) {
            s.social[curTab].splice(idx, 1);
            p.tab = wantTab;
            s.social[wantTab].push(p);
        }
        saveSettings();
    }
    renderSocial();
    if (list.length > max) {
        try { notify("info", `Added ${list.length} names. Prompted for ${max}; organize the rest later in Social.`, "Social", "social"); } catch (_) {}
    }
}

function extractNamesFromTextHeuristics(maxMessages) {
    const names = new Set();
    try {
        const nodes = Array.from(document.querySelectorAll("#chat .mes_text, #chat .mes_text *")).map(n => n.textContent).filter(Boolean);
        const blob = nodes.join("\n");
        const lines = blob.split("\n").slice(-1 * Math.max(20, Number(maxMessages || 80)));
        const re1 = /^([A-Za-z][A-Za-z0-9' -]{2,48}):\s/;
        const re2 = /\b(?:NPC|Character|Speaker|Name)\s*[:=-]\s*([A-Za-z][A-Za-z0-9' -]{2,48})\b/;
        for (const line of lines) {
            const a = String(line || "").match(re1);
            if (a && a[1]) names.add(String(a[1]).trim());
            const b = String(line || "").match(re2);
            if (b && b[1]) names.add(String(b[1]).trim());
        }
    } catch (_) {}
    return Array.from(names);
}

async function aiExtractNamesFromChat(maxMessages) {
    try {
        const msgs = [];
        const nodes = getChatMessageNodes(maxMessages || 140);
        for (const m of nodes) {
            const nm =
                m.querySelector(".mes_name")?.textContent ||
                m.querySelector(".name_text")?.textContent ||
                m.querySelector(".name")?.textContent ||
                "";
            const tx =
                m.querySelector(".mes_text")?.textContent ||
                m.querySelector(".mes-text")?.textContent ||
                m.textContent ||
                "";
            const n = String(nm || "").trim() || "Unknown";
            const t = String(tx || "").trim();
            if (!t) continue;
            msgs.push(`${n}: ${t}`);
        }
        const transcript = msgs.join("\n").slice(-14000);
        if (!transcript) return { names: [], questions: [] };

        const ctx = getContext ? getContext() : {};
        const user = String(ctx?.name1 || "").trim();
        const main = String(ctx?.name2 || "").trim();

        const prompt = `[UIE_LOCKED]
Task: Extract a list of distinct NPC/person names that the user should add to a Social/Contacts list.

Input chat transcript (may include omniscient tool cards / metadata; ignore anything that is not an in-world speaker/name):
${transcript}

User name: "${user}"
Main character name: "${main}"

Return ONLY valid JSON:
{"names":["..."],"questions":["..."]}

Rules:
- names: 0 to 24 distinct person names seen in chat (speakers or explicitly referenced as characters).
- Exclude the User name. Include the Main character name if it appears in chat.
- Do not invent new people. Only output names that appear in the transcript.
- If uncertain about whether a token is a name, do NOT include it; instead add a short question in questions asking what it refers to.
- Keep names short (2–40 chars), no emojis, no titles like "Mr.", no roles like "Guard #2" unless that is literally used as the name.`;

        const res = await generateContent(prompt, "System Check");
        if (!res) return { names: [], questions: [] };
        const obj = JSON.parse(String(res).replace(/```json|```/g, "").trim());
        const names = Array.isArray(obj?.names) ? obj.names.map(x => String(x || "").trim()).filter(Boolean) : [];
        const questions = Array.isArray(obj?.questions) ? obj.questions.map(x => String(x || "").trim()).filter(Boolean) : [];
        return { names: names.slice(0, 24), questions: questions.slice(0, 6) };
    } catch (_) {
        return { names: [], questions: [] };
    }
}

async function scanChatIntoSocial({ silent } = {}) {
    const s = getSettings();
    normalizeSocial(s);
    const ctx = getContext ? getContext() : {};
    const userName = String(ctx?.name1 || "").trim();
    const deleted = deletedNameSet(s);

    // Grab raw text logic
    const transcript = getChatTranscript(240);
    if (!transcript) {
        if (!silent) notify("info", "No chat transcript found.", "Social", "social");
        return;
    }

    const prompt = `[UIE_LOCKED]
Analyze the following chat transcript to find characters/people for the Social Contacts list.
User Name: "${userName}"

Transcript:
${transcript.slice(-14000)}

Task: Identify all characters (NPCs, people) mentioned or present in the story.
Return ONLY valid JSON:
{"found":[{"name":"Name","role":"friend|rival|romance|family|associate|npc","affinity":50,"presence":"present|mentioned"}]}

Rules:
- "name": Extract the name exactly as it appears (e.g. "The Shopkeeper" -> "Shopkeeper", "John Doe" -> "John Doe").
- "presence": "present" if they are physically in the scene interacting. "mentioned" if only talked about/remembered.
- "role": Guess the relationship role based on context.
- Exclude: The user ("${userName}"), "System", "Narrator", "Game Master".
- Include everyone else found in the text, even if they didn't speak (e.g. "Bob stood silently in the corner").
`;

    try { window.toastr?.info?.("Scanning story for characters..."); } catch (_) {}

    let found = [];
    try {
        const res = await generateContent(prompt, "Social Scan");
        if (!res) {
            if (!silent) notify("warning", "AI returned no response.", "Social", "api");
            return;
        }
        const obj = JSON.parse(String(res || "").replace(/```json|```/g, "").trim());
        found = Array.isArray(obj?.found) ? obj.found : [];
    } catch (e) {
        console.warn("Social Scan Parse Error", e);
        if (!silent) notify("error", "Failed to parse AI response.", "Social", "api");
        return;
    }

    if (!found.length) {
        if (!silent) notify("info", "No new characters found in chat.", "Social", "social");
        return;
    }

    const normalizeRoleToTab = (role) => {
        const r = String(role || "").toLowerCase();
        if (r.includes("romance") || r.includes("lover") || r.includes("dating")) return "romance";
        if (r.includes("family") || r.includes("sister") || r.includes("brother") || r.includes("mother") || r.includes("father")) return "family";
        if (r.includes("rival") || r.includes("enemy") || r.includes("hostile")) return "rivals";
        return "friends";
    };

    const existingLower = new Set(["friends","associates","romance","family","rivals"].flatMap(k => (s.social[k] || []).map(p => String(p?.name || "").toLowerCase()).filter(Boolean)));
    let added = 0;
    
    for (const v of found.slice(0, 30)) {
        const nm = String(v?.name || "").trim();
        if (!nm) continue;
        const key = nm.toLowerCase();
        if (deleted.has(key)) continue;
        if (existingLower.has(key)) continue;
        if (key === "you" || key === "user" || key === "me" || key === userName.toLowerCase()) continue;

        const presence = String(v?.presence || "").toLowerCase().trim();
        const met = presence === "present";
        const knownPast = presence === "known_past"; // AI might infer this
        const tabRaw = String(v?.role || "").toLowerCase().trim(); // v.role mapped to tab sometimes
        
        // Logic to decide tab
        const tab = normalizeRoleToTab(v?.role || "associate");
        const aff = Math.max(0, Math.min(100, Math.round(Number(v?.affinity ?? 50))));
        const role = String(v?.role || (met ? "npc" : "mentioned")).trim().slice(0, 80);
        
        const p = { 
            id: newId("person"), 
            name: nm, 
            affinity: aff, 
            thoughts: "", 
            avatar: "", 
            likes: "", 
            dislikes: "", 
            birthday: "", 
            location: "", 
            age: "", 
            knownFamily: "", 
            familyRole: "", 
            relationshipStatus: role, 
            url: "", 
            tab, 
            memories: [], 
            met_physically: met, 
            known_from_past: knownPast 
        };
        
        // If "associate" but affinity is high/low, maybe move? For now stick to AI guess.
        // But force "associates" if just mentioned?
        // User wants "PULLING CHARACTERS FROM STORY". So if they are in story, add them.
        
        s.social[tab].push(p);
        existingLower.add(key);
        added++;
    }

    if (added) {
        saveSettings();
        renderSocial();
        if (!silent) notify("success", `Added ${added} character(s) from story.`, "Social", "social");
    } else {
        if (!silent) notify("info", "No new characters added (all exist or ignored).", "Social", "social");
    }
}

export async function updateRelationshipScore(name, text, source) {
    const nm = String(name || "").trim();
    const tx = String(text || "").trim();
    const src = String(source || "").trim();
    if (!nm || !tx) return;
    const s = getSettings();
    normalizeSocial(s);
    const deleted = deletedNameSet(s);
    if (deleted.has(nm.toLowerCase())) return;

    const tabs = ["friends", "associates", "romance", "family", "rivals"];
    let curTab = tabs.find(k => (s.social[k] || []).some(p => String(p?.name || "").trim().toLowerCase() === nm.toLowerCase())) || "friends";
    let idx = (s.social[curTab] || []).findIndex(p => String(p?.name || "").trim().toLowerCase() === nm.toLowerCase());
    if (idx < 0) {
        s.social.friends.push({ id: newId("person"), name: nm, affinity: 50, thoughts: "", avatar: "", likes: "", dislikes: "", birthday: "", location: "", age: "", knownFamily: "", familyRole: "", relationshipStatus: "", url: "", tab: "friends", memories: [], met_physically: false });
        curTab = "friends";
        idx = s.social.friends.length - 1;
    }
    const person = s.social[curTab][idx];
    const prevAff = Math.max(0, Math.min(100, Number(person?.affinity ?? 50)));
    const prevRole = String(person?.relationshipStatus || "").trim();
    const prevMet = person?.met_physically === true;

    const prompt = `[UIE_LOCKED]
Analyze this interaction and update relationship info.

Character: ${nm}
Source: ${src}
Message:
${tx.slice(0, 1200)}

Current:
{"affinity":${prevAff},"role":"${prevRole}","met_physically":${prevMet}}

Return ONLY valid JSON:
{"delta":0,"role":"","notes":""}

Rules:
- delta is integer -10..10 representing affinity change due to this message tone.
- role is a short updated role/status label (can be empty to keep).
- notes is optional (short).`;

    let delta = 0;
    let role = "";
    try {
        const res = await generateContent(prompt, "System Check");
        const obj = JSON.parse(String(res || "").replace(/```json|```/g, "").trim());
        delta = Math.max(-10, Math.min(10, Math.round(Number(obj?.delta || 0))));
        role = String(obj?.role || "").trim().slice(0, 80);
    } catch (_) {
        delta = 0;
        role = "";
    }

    const nextAff = Math.max(0, Math.min(100, prevAff + delta));
    if (delta !== 0) person.affinity = nextAff;
    if (role) person.relationshipStatus = role;
    if (src === "face_to_face") person.met_physically = true;
    else if (person.met_physically !== true) person.met_physically = false;

    if (delta !== 0 || (role && role !== prevRole)) {
        saveSettings();
        try { injectRpEvent(`[Canon Event: Interaction with ${nm}. Affinity: ${Math.round(Number(person.affinity || prevAff))}. Status: ${String(person.relationshipStatus || prevRole || "").trim() || "—"}.]`); } catch (_) {}
    } else {
        saveSettings();
    }
}

// --- INIT (Updated with Calendar Button) ---
export function initSocial() {
    const b = $("body");

    // Events
    b.off("click", "#uie-social-window .uie-tab");
    b.on("click", "#uie-social-window .uie-tab", function() {
        $("#uie-social-window .uie-tab").removeClass("active");
        $(this).addClass("active");
        currentTab = $(this).data("tab");
        renderSocial();
    });

    b.off("change.uieSocialImg", "#uie-add-img-file");
    b.on("change.uieSocialImg", "#uie-add-img-file", async function() {
        const f = this.files && this.files[0];
        const base64 = await readFileAsBase64(f);
        tempImgBase64 = base64;
        if (base64) {
            $("#uie-add-preview").attr("src", base64).show();
            $("#uie-add-icon").hide();
        }
    });

    b.off("pointerdown.uieSocialCard touchstart.uieSocialCard");
    b.on("pointerdown.uieSocialCard touchstart.uieSocialCard", ".uie-social-card", function(e) {
        const idx = Number($(this).data("idx"));
        if (!Number.isFinite(idx)) return;
        socialLongPressFired = false;
        try { clearTimeout(socialLongPressTimer); } catch (_) {}
        socialLongPressTimer = setTimeout(() => {
            socialLongPressFired = true;
            if (!deleteMode) {
                deleteMode = true;
                selectedForDelete = [];
            }
            if (selectedForDelete.includes(idx)) selectedForDelete = selectedForDelete.filter(x => x !== idx);
            else selectedForDelete.push(idx);
            renderSocial();
            try { window.toastr?.info?.("Mass delete: tap contacts to select, then CONFIRM DELETE."); } catch (_) {}
        }, 520);
    });

    b.off("pointerup.uieSocialCard pointercancel.uieSocialCard touchend.uieSocialCard touchcancel.uieSocialCard");
    b.on("pointerup.uieSocialCard pointercancel.uieSocialCard touchend.uieSocialCard touchcancel.uieSocialCard", ".uie-social-card", function() {
        try { clearTimeout(socialLongPressTimer); } catch (_) {}
    });

    b.on("click", ".uie-social-card", function(e) {
        e.stopPropagation();
        if (socialLongPressFired) {
            socialLongPressFired = false;
            return;
        }
        const idx = $(this).data("idx");
        if (deleteMode) {
            const i = Number(idx);
            if (!Number.isFinite(i)) return;
            if (selectedForDelete.includes(i)) selectedForDelete = selectedForDelete.filter(x => x !== i);
            else selectedForDelete.push(i);
            renderSocial();
            return;
        }
        openProfile(idx, this);
    });
    
    b.off("click.uieSocialClose");
    b.on("click.uieSocialClose", "#uie-social-close", (e) => { e.preventDefault(); e.stopPropagation(); $("#uie-social-window").hide(); $("#uie-social-menu").hide(); closeAddModal(); });
    b.on("click.uieSocialClose", ".uie-p-close", (e) => { e.preventDefault(); e.stopPropagation(); $("#uie-social-overlay").removeAttr("data-open").hide(); });
    b.on("click.uieSocialMemClose", "#uie-social-mem-close", (e) => { e.preventDefault(); e.stopPropagation(); $("#uie-social-mem-overlay").hide(); });
    b.on("click.uieSocialMemBackdrop", "#uie-social-mem-overlay", (e) => {
        if ($(e.target).closest(".uie-paper-box").length) return;
        $("#uie-social-mem-overlay").hide();
    });

    b.off("click.uieSocialMenu");
    b.on("click.uieSocialMenu", "#uie-social-sparkle", (e)=>{ e.preventDefault(); e.stopPropagation(); $("#uie-social-menu").toggle(); });
    b.on("click.uieSocialMenu", "body", (e) => {
        const $t = $(e.target);
        if ($t.closest("#uie-social-sparkle, #uie-social-menu").length) return;
        $("#uie-social-menu").hide();
    });

    b.off("click.uieSocialMemBtn");
    b.on("click.uieSocialMemBtn", "#uie-social-memories", (e) => {
        e.preventDefault();
        e.stopPropagation();
        $("#uie-social-mem-overlay").show();
        renderMemoryOverlay();
    });

    b.off("click.uieSocialMemActions");
    b.on("click.uieSocialMemActions", "#uie-social-mem-add, #uie-social-mem-clear, #uie-social-mem-scan, #uie-social-mem-inject", async function (e) {
        e.preventDefault();
        e.stopPropagation();
        const { person } = getActivePerson();
        if (!person) return;

        if (this.id === "uie-social-mem-add") {
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
            renderMemoryOverlay();
            return;
        }

        if (this.id === "uie-social-mem-clear") {
            const ok = confirm("Clear ALL memories for this character?");
            if (!ok) return;
            person.memories = [];
            saveSettings();
            renderMemoryOverlay();
            return;
        }

        if (this.id === "uie-social-mem-inject") {
            const block = buildMemoryBlock(person);
            if (!block) return;
            await injectRpEvent(block);
            try { window.toastr?.success?.("Injected memories into chat."); } catch (_) {}
            return;
        }

        if (this.id === "uie-social-mem-scan") {
            await scanMemoriesForActivePerson();
        }
    });

    b.off("click.uieSocialMemDel");
    b.on("click.uieSocialMemDel", ".uie-social-mem-del", function (e) {
        e.preventDefault();
        e.stopPropagation();
        const mid = String($(this).data("mid") || "");
        const { person } = getActivePerson();
        if (!person || !mid) return;
        person.memories = (Array.isArray(person.memories) ? person.memories : []).filter(m => String(m?.id || "") !== mid);
        saveSettings();
        renderMemoryOverlay();
    });

    b.off("click.uieSocialActions");
    b.on("click.uieSocialActions", "#uie-act-add", (e) => { e.preventDefault(); e.stopPropagation(); openAddModal({ mode: "add" }); });
    b.on("click.uieSocialActions", "#uie-cancel-add", (e) => { e.preventDefault(); e.stopPropagation(); closeAddModal(); });
    b.on("click.uieSocialActions", "#uie-submit-add", (e) => { e.preventDefault(); e.stopPropagation(); applyAddOrEdit(); });

    b.on("click.uieSocialActions", "#uie-act-delete", (e) => { e.preventDefault(); e.stopPropagation(); toggleDeleteMode(); });
    b.on("click.uieSocialActions", "#uie-delete-controls .uie-del-confirm", (e) => { e.preventDefault(); e.stopPropagation(); confirmMassDelete(); });
    b.on("click.uieSocialActions", "#uie-delete-controls .uie-del-cancel", (e) => { e.preventDefault(); e.stopPropagation(); cancelMassDelete(); });

    b.on("click.uieSocialActions", "#uie-act-scan", async (e) => { e.preventDefault(); e.stopPropagation(); $("#uie-social-menu").hide(); await scanChatIntoSocial(); });
    b.on("click.uieSocialActions", "#uie-act-toggle-auto", (e) => {
        e.preventDefault(); e.stopPropagation();
        const s = getSettings();
        if (!s.socialMeta) s.socialMeta = { autoScan: false };
        s.socialMeta.autoScan = !s.socialMeta.autoScan;
        saveSettings();
        $("#uie-auto-scan-state").text(s.socialMeta.autoScan ? "ON" : "OFF");
        notify("info", `Auto Scan: ${s.socialMeta.autoScan ? "ON" : "OFF"}`, "Social", "social");
    });

    b.on("click.uieSocialActions", "#uie-act-bg", (e) => {
        e.preventDefault();
        e.stopPropagation();
        $("#uie-social-menu").hide();
        const inp = document.createElement("input");
        inp.type = "file";
        inp.accept = "image/*";
        inp.onchange = async () => {
            try {
                const f = inp.files && inp.files[0];
                if (!f) return;
                const r = new FileReader();
                r.onload = () => {
                    const dataUrl = String(r.result || "");
                    if (!dataUrl) return;
                    const s = getSettings();
                    if (!s.ui) s.ui = { backgrounds: {}, css: { global: "" } };
                    if (!s.ui.backgrounds) s.ui.backgrounds = {};
                    s.ui.backgrounds.social = dataUrl;
                    saveSettings();
                    try { import("./core.js").then(core => core.updateLayout?.()); } catch (_) {}
                };
                r.readAsDataURL(f);
            } catch (_) {}
        };
        inp.click();
    });

    b.on("click.uieSocialActions", "#uie-social-edit", (e) => {
        e.preventDefault(); e.stopPropagation();
        if (activeProfileIndex === null) return;
        $("#uie-social-overlay").hide();
        openAddModal({ mode: "edit", index: activeProfileIndex });
    });

    b.on("click.uieSocialActions", "#uie-social-message", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const s2 = getSettings();
        const p = s2?.social?.[currentTab]?.[activeProfileIndex] || null;
        const nm = String(p?.name || "").trim();
        $("#uie-social-overlay").removeAttr("data-open").hide();
        await ensurePhoneThread(nm);
    });

    b.on("click.uieSocialActions", "#uie-social-del-one", (e) => {
        e.preventDefault(); e.stopPropagation();
        if (activeProfileIndex === null) return;
        const s = getSettings();
        normalizeSocial(s);
        if (!confirm("Delete this contact?")) return;
        try {
            const p = s?.social?.[currentTab]?.[activeProfileIndex] || null;
            const nm = String(p?.name || "").trim();
            if (nm) rememberDeletedNames(s, [nm]);
        } catch (_) {}
        s.social[currentTab].splice(activeProfileIndex, 1);
        saveSettings();
        activeProfileIndex = null;
        $("#uie-social-overlay").hide();
        renderSocial();
    });

    try {
        const s = getSettings();
        if (s.socialMeta && typeof s.socialMeta.autoScan === "boolean") $("#uie-auto-scan-state").text(s.socialMeta.autoScan ? "ON" : "OFF");
    } catch (_) {}

    const chatObserver = new MutationObserver(() => {
        try {
            const s = getSettings();
            if (!s?.socialMeta?.autoScan) return;
            if (autoScanTimer) clearTimeout(autoScanTimer);
            autoScanTimer = setTimeout(async () => {
                const now = Date.now();
                const min = Math.max(2000, Number(s?.generation?.systemCheckMinIntervalMs ?? 20000));
                if (autoScanInFlight) return;
                if (now - autoScanLastAt < min) return;
                if (s?.generation?.scanOnlyOnGenerateButtons === true) return;
                autoScanInFlight = true;
                autoScanLastAt = now;
                try {
                    const mod = await import("./stateTracker.js");
                    if (mod?.scanEverything) await mod.scanEverything();
                } finally { autoScanInFlight = false; }
            }, 4000);
        } catch (_) {}
    });
    const chatEl = document.querySelector('#chat');
    if(chatEl) chatObserver.observe(chatEl, { childList: true, subtree: true });
}
