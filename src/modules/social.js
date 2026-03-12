import { getSettings, commitStateUpdate } from "./core.js";
import { generateContent } from "./apiClient.js";
import { getContext } from "/scripts/extensions.js";
import { notify } from "./notifications.js";
import { injectRpEvent } from "./features/rp_log.js";
import { getChatTranscriptText } from "./chatLog.js";
import { safeJsonParseObject } from "./jsonUtil.js";
import { SCAN_TEMPLATES } from "./scanTemplates.js";

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
let autoScanLastSig = "";

const SOCIAL_AUTO_SCAN_INTERVAL_MS = 12000;

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

function normalizeAffinity(value, fallback = 50) {
    const fb = Number.isFinite(Number(fallback)) ? Number(fallback) : 50;
    const n = Number(value);
    if (!Number.isFinite(n)) return Math.max(0, Math.min(100, Math.round(fb)));
    return Math.max(0, Math.min(100, Math.round(n)));
}

function cleanFieldValue(value, maxLen = 160) {
    const cap = Math.max(1, Number(maxLen) || 160);
    return String(value ?? "").trim().slice(0, cap);
}

function firstNonEmpty(...values) {
    for (const v of values) {
        const s = String(v ?? "").trim();
        if (s) return s;
    }
    return "";
}

function toBoolFlag(value) {
    if (value === true) return true;
    if (value === false) return false;
    const s = String(value ?? "").trim().toLowerCase();
    return s === "1" || s === "true" || s === "yes" || s === "y";
}

function derivePresenceFlags(scanObj) {
    const presence = String(scanObj?.presence || "").trim().toLowerCase();
    const met =
        toBoolFlag(scanObj?.met_physically) ||
        presence === "present" ||
        presence === "in_scene" ||
        presence === "in scene" ||
        presence === "onscreen" ||
        presence === "met";
    const knownPast =
        !met &&
        (toBoolFlag(scanObj?.known_from_past) ||
            presence === "known_past" ||
            presence === "known past" ||
            presence === "from_past" ||
            presence === "from past" ||
            presence === "history");
    return { met, knownPast };
}

function maybeUpdateTextField(person, field, value, maxLen = 160) {
    const next = cleanFieldValue(value, maxLen);
    if (!next) return false;
    const prev = cleanFieldValue(person?.[field], maxLen);
    if (prev === next) return false;
    person[field] = next;
    return true;
}

function baseUrl() {
    try {
        const u = String(window.UIE_BASEURL || "");
        if (u) return u.endsWith("/") ? u : `${u}/`;
    } catch (_) {}
    return "/scripts/extensions/third-party/universal-immersion-engine/";
}

async function ensurePaperTemplate(name) {
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
    if (!s.socialMeta || typeof s.socialMeta !== "object") s.socialMeta = { autoScan: false, deletedNames: [] };
    if (typeof s.socialMeta.autoScan !== "boolean") s.socialMeta.autoScan = false;
    if (!Array.isArray(s.socialMeta.deletedNames)) s.socialMeta.deletedNames = [];
    ["friends","associates","romance","family","rivals"].forEach(k => { if (!Array.isArray(s.social[k])) s.social[k] = []; });
    ["friends","associates","romance","family","rivals"].forEach(k => {
        (s.social[k] || []).forEach(p => {
            if (!p || typeof p !== "object") return;
            if (!p.id) p.id = newId("person");
            if (p.thoughts === undefined) p.thoughts = "";
            if (p.likes === undefined) p.likes = "";
            if (p.dislikes === undefined) p.dislikes = "";
            if (p.birthday === undefined) p.birthday = "";
            if (p.location === undefined) p.location = "";
            if (p.age === undefined) p.age = "";
            if (p.knownFamily === undefined) p.knownFamily = "";
            if (p.familyRole === undefined) p.familyRole = "";
            if (p.relationshipStatus === undefined) p.relationshipStatus = "";
            if (p.url === undefined) p.url = "";
            if (p.avatar === undefined) p.avatar = "";
            if (p.met_physically === undefined) p.met_physically = false;
            if (p.known_from_past === undefined) p.known_from_past = false;
            if (!Array.isArray(p.memories)) p.memories = [];
            if (p.affinity === undefined || p.affinity === null || p.affinity === "") p.affinity = 50;
            p.affinity = normalizeAffinity(p.affinity, 50);
        });
    });
    const hateThreshold = 20;
    const rivals = s.social.rivals;
    const rivalNames = new Set(rivals.map(p => String(p?.name || "").toLowerCase()).filter(Boolean));

    const moveToRivals = (arr) => {
        const keep = [];
        for (const p of arr) {
            const aff = normalizeAffinity(p?.affinity, 50);
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

async function getChatTranscript(maxMessages) {
    try {
        const t = await getChatTranscriptText({ maxMessages: Math.max(10, Number(maxMessages || 90)), maxChars: 150000 });
        if (t) return t;
    } catch (_) {}
    const out = [];
    try {
        const nodes = getChatMessageNodes(maxMessages || 5000);
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
    return out.join("\n").slice(-150000);
}

function getChatMessageNodes(maxMessages) {
    const max = Math.max(20, Number(maxMessages || 5000));
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

function readSocialChatSignature() {
    try {
        const ctx = getContext ? getContext() : {};
        const chatId = String(ctx?.chatId ?? "");
        const w = typeof window !== "undefined" ? window : globalThis;
        const arr = Array.isArray(w?.chat) ? w.chat : null;
        if (arr && arr.length) {
            const last = arr[arr.length - 1] || {};
            const lastId = String(last?.mesId ?? last?.mesid ?? last?.id ?? arr.length);
            const tail = String(last?.mes ?? last?.text ?? last?.message ?? "").trim().slice(-220);
            return `${chatId}|${arr.length}|${lastId}|${tail}`;
        }
    } catch (_) {}

    try {
        const ctx = getContext ? getContext() : {};
        const chatId = String(ctx?.chatId ?? "");
        const nodes = document.querySelectorAll("#chat .mes");
        if (!nodes || !nodes.length) return "";
        const last = nodes[nodes.length - 1];
        const lastId = String(last?.getAttribute?.("mesid") || last?.dataset?.mesId || nodes.length);
        const tail = String(
            last?.querySelector?.(".mes_text")?.textContent ||
            last?.querySelector?.(".mes-text")?.textContent ||
            last?.textContent ||
            ""
        ).trim().slice(-220);
        return `${chatId}|${nodes.length}|${lastId}|${tail}`;
    } catch (_) {
        return "";
    }
}

function stopSocialAutoScanLoop() {
    if (!autoScanTimer) return;
    try { clearInterval(autoScanTimer); } catch (_) {}
    autoScanTimer = null;
    autoScanLastSig = "";
}

async function runSocialAutoScanPass() {
    try {
        const s = getSettings();
        normalizeSocial(s);
        if (s?.socialMeta?.autoScan !== true) return;
        if (autoScanInFlight) return;

        const sig = readSocialChatSignature();
        if (!sig || sig === autoScanLastSig) return;

        await scanChatIntoSocial({ silent: true });
        autoScanLastSig = sig;
    } catch (_) {}
}

function syncSocialAutoScanLoop({ immediate = false } = {}) {
    try {
        const s = getSettings();
        normalizeSocial(s);
        const enabled = s?.socialMeta?.autoScan === true;

        if (!enabled) {
            stopSocialAutoScanLoop();
            return;
        }

        if (!autoScanTimer) {
            autoScanTimer = setInterval(() => {
                void runSocialAutoScanPass();
            }, SOCIAL_AUTO_SCAN_INTERVAL_MS);
        }

        if (immediate) {
            void runSocialAutoScanPass();
        }
    } catch (_) {}
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

function parseTagsInput(raw, fallback = []) {
    const tags = String(raw || "")
        .split(",")
        .map((t) => String(t || "").trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 6);
    if (tags.length) return tags;
    const fb = Array.isArray(fallback)
        ? fallback.map((t) => String(t || "").trim().toLowerCase()).filter(Boolean).slice(0, 6)
        : [];
    return fb;
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

    const rowTmpl = document.getElementById("uie-social-memory-row")?.content;
    if (!rowTmpl) return;

    for (const mem of list) {
        const id = String(mem?.id || "");
        const text = String(mem?.text || "").trim();
        const impact = String(mem?.impact || "").trim();
        const tags = Array.isArray(mem?.tags) ? mem.tags.map(t => String(t || "").trim()).filter(Boolean).slice(0, 6) : [];

        const el = $(rowTmpl.cloneNode(true));
        el.find(".mem-text").text(text || "-");

        if (impact) {
            el.find(".mem-impact").html(`<strong>Impact:</strong> ${esc(impact)}`);
        } else {
            el.find(".mem-impact").remove();
        }

        const tagContainer = el.find(".mem-tags");
        if (tags.length) {
            tags.forEach(t => {
                tagContainer.append(`<span style="font-size:11px; padding:3px 8px; border-radius:999px; background:rgba(0,0,0,0.08); border:1px solid rgba(74,46,22,0.18); color:#4a2e16; font-weight:900;">${esc(t)}</span>`);
            });
        } else {
            tagContainer.remove();
        }

        const $edit = el.find(".uie-social-mem-edit");
        if ($edit.length) $edit.attr("data-mid", id);
        el.find(".uie-social-mem-del").attr("data-mid", id);
        $list.append(el);
    }
    commitStateUpdate({ save: true, layout: false, emit: true });
}

async function scanMemoriesForActivePerson() {
    const { person } = getActivePerson();
    if (!person) return;
    const ctx = getContext ? getContext() : {};
    const user = String(ctx?.name1 || "User");
    const transcript = await getChatTranscript(120);
    if (!transcript) {
        try { window.toastr?.info?.("No chat transcript found."); } catch (_) {}
        return;
    }

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
- Be specific and consequence-based. 1-2 sentences per memory.
- Tags are short (e.g., "promise", "betrayal", "injury", "secret", "favor", "trauma", "trust").`;

    try { window.toastr?.info?.("Scanning memories..."); } catch (_) {}
    const res = await generateContent(prompt.slice(0, 16000), "System Check");
    if (!res) return;
    const obj = safeJsonParseObject(res) || {};
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

    commitStateUpdate({ save: true, layout: false, emit: true });
    renderMemoryOverlay();
    try { window.toastr?.success?.(added ? `Added ${added} ${added === 1 ? "memory" : "memories"}.` : "No new vital memories found."); } catch (_) {}
}

export function renderSocial() {
    if (!isInitialized) {
        initSocial();
        isInitialized = true;
    }

    const s = getSettings();
    const changed = normalizeSocial(s);
    if (changed) commitStateUpdate({ save: true, layout: false, emit: true });

    const bgUrl = s.ui?.backgrounds?.social;
    if (bgUrl) {
        $("#uie-social-window").css({
            backgroundImage: `url("${bgUrl}")`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            backgroundRepeat: "no-repeat",
        });
    }

    const list = s.social[currentTab] || [];
    const container = $("#uie-social-content");
    container.find(".uie-social-grid, .no-data-msg").remove();

    if (list.length === 0) {
        const emptyTemplate = document.getElementById("uie-social-empty-msg")?.content;
        if (emptyTemplate) container.prepend(emptyTemplate.cloneNode(true));
    } else {
        const grid = $("<div class=\"uie-social-grid\"></div>");
        const cardTemplate = document.getElementById("uie-social-card-template")?.content;
        if (cardTemplate) {
            let avatarChanged = false;
            list.forEach((person, index) => {
                const isSel = deleteMode && selectedForDelete.includes(index);
                let avatar = String(person.avatar || "").trim();

                try {
                    const token = avatar.match(/^<char(?::([^>]+))?>$/i);
                    if (token) {
                        const want = String(token[1] || "").trim().toLowerCase();
                        if (!want) {
                            avatar = resolveCurrentCharAvatarUrl();
                        } else {
                            const s2 = getSettings();
                            const members = Array.isArray(s2?.party?.members) ? s2.party.members : [];
                            const hit = members.find(x => String(x?.identity?.name || "").trim().toLowerCase() === want);
                            avatar = String(hit?.images?.portrait || "").trim() || resolveCurrentCharAvatarUrl();
                        }
                    }
                } catch (_) {}

                if (!avatar) {
                    const fromChat = findAvatarForNameFromChat(person.name);
                    if (fromChat) {
                        avatar = fromChat;
                    } else {
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

                const el = $(cardTemplate.cloneNode(true));
                const cardDiv = el.find(".uie-social-card");
                cardDiv.attr("data-idx", index);
                if (isSel) cardDiv.addClass("delete-selected");

                const avContainer = el.find(".uie-s-avatar");
                if (avatar) {
                    avContainer.html(`<img src="${esc(avatar)}" style="width:100%; height:100%; object-fit:cover;">`);
                } else {
                    avContainer.html('<i class="fa-solid fa-user"></i>');
                }

                el.find(".uie-s-name").text(person.name);

                const tag = person?.met_physically === true ? "" : (person?.known_from_past === true ? "PAST" : "MENTION");
                if (tag) {
                    el.find(".uie-s-tag-container").html(`<div style="font-size:10px; opacity:0.75; border:1px solid rgba(255,255,255,0.18); padding:2px 8px; border-radius:999px;">${tag}</div>`);
                }

                grid.append(el);
            });
            if (avatarChanged) commitStateUpdate({ save: true, layout: false, emit: true });
        }

        container.prepend(grid);
    }

    if (deleteMode) {
        $("#uie-delete-controls").css("display", "flex");
    } else {
        $("#uie-delete-controls").hide();
    }
}

export function render() {
    renderSocial();
}

function safeUrl(raw) {
    let u = String(raw || "").trim();
    if (!u) return "";
    if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
    return u;
}

function openProfile(index, anchorEl) {
    const s = getSettings();
    normalizeSocial(s);
    const person = s.social[currentTab][index];
    if (!person) return;

    activeProfileIndex = index;
    if (!person.id) person.id = newId("person");
    if (!Array.isArray(person.memories)) person.memories = [];
    commitStateUpdate({ save: true, layout: false, emit: true });

    $(".uie-p-name-lg").text(person.name);
    $("#p-val-status").text(`"${person.thoughts || "..."}"`);
    $("#p-val-bday").text(person.birthday || "Unknown");
    $("#p-val-loc").text(person.location || "Unknown");
    $("#p-val-age").text(person.age || "Unknown");
    $("#p-val-family").text(person.knownFamily || "Unknown");
    $("#p-val-family-role").text(person.familyRole || "-");

    const affinity = Math.max(0, Math.min(100, Number(person.affinity ?? 50)));
    const affinityLabel = (() => {
        if (affinity <= 10) return "Hostile";
        if (affinity <= 25) return "Wary";
        if (affinity <= 45) return "Cold";
        if (affinity <= 60) return "Neutral";
        if (affinity <= 75) return "Warm";
        if (affinity <= 90) return "Friendly";
        return "Devoted";
    })();
    $("#p-val-rel-status").text(`${person.relationshipStatus || "-"} (${affinityLabel}, ${affinity}/100)`);

    try {
        const presence = person.met_physically === true
            ? "Present / met in scene"
            : (person.known_from_past === true ? "Known from the past (not present)" : "Mentioned only");
        $("#p-val-presence").text(presence);
    } catch (_) {}

    $("#p-val-likes").text(person.likes || "-");
    $("#p-val-dislikes").text(person.dislikes || "-");

    const avatar = String(person.avatar || "").trim();
    if (avatar) {
        $("#p-img-disp").attr("src", avatar).show();
        $(".uie-p-portrait i").hide();
    } else {
        $("#p-img-disp").hide();
        $(".uie-p-portrait i").show();
    }

    const filledCount = Math.floor(affinity / 20);
    const emptyCount = 5 - filledCount;
    const heartIcon = s.ui?.icons?.heart;
    if (heartIcon) {
        const filled = `<img src="${heartIcon}" style="width:24px; height:24px; object-fit:contain; vertical-align:middle; margin-right:2px;">`.repeat(filledCount);
        const empty = `<img src="${heartIcon}" style="width:24px; height:24px; object-fit:contain; vertical-align:middle; margin-right:2px; opacity:0.25; filter:grayscale(1);">`.repeat(emptyCount);
        $(".uie-p-hearts-lg").html(filled + empty);
    } else {
        $(".uie-p-hearts-lg").text("❤".repeat(filledCount) + "♡".repeat(emptyCount));
    }

    const $overlay = $("#uie-social-overlay");
    $overlay.attr("data-open", "1").show();

    const $paper = $overlay.find(".uie-paper-box");
    try {
        const w = Math.max(240, Number($paper.outerWidth?.() || 0) || 360);
        const h = Math.max(240, Number($paper.outerHeight?.() || 0) || 520);
        const vw = window.innerWidth || document.documentElement.clientWidth || 0;
        const vh = window.innerHeight || document.documentElement.clientHeight || 0;
        const isCoarse = (() => {
            try { return window.matchMedia?.("(max-width: 700px), (pointer: coarse)")?.matches === true; } catch (_) { return false; }
        })();
        const x = isCoarse ? 6 : Math.max(14, Math.floor((vw - w) / 2));
        const y = isCoarse ? 6 : Math.max(14, Math.floor((vh - h) / 2));
        const css = { top: y, left: x, right: "", bottom: "", transform: "none", maxHeight: "", overflowY: "", width: "" };
        if (isCoarse && vh > 0) {
            css.maxHeight = `${Math.max(220, vh - 12)}px`;
            css.overflowY = "auto";
            if (vw > 0) css.width = `${Math.max(220, vw - 12)}px`;
        }
        $paper.css(css);
    } catch (_) {}
}

function readFileAsBase64(file) {
    return new Promise((resolve) => {
        if (!file) return resolve(null);
        const reader = new FileReader();
        reader.onload = (e) => resolve(String(e?.target?.result || ""));
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(file);
    });
}

function openAddModal({ mode, index }) {
    const s = getSettings();
    const person = (mode === "edit" && Number.isFinite(index)) ? (s.social[currentTab][index] || {}) : {};

    editingIndex = (mode === "edit" && Number.isFinite(index)) ? index : null;
    tempImgBase64 = person.avatar || null;

    $("#uie-add-modal > div:first").text(mode === "edit" ? "EDIT CONTACT" : "NEW CONTACT");
    $("#uie-submit-add").text(mode === "edit" ? "Save" : "Add to Book");

    $("#uie-add-name").val(person.name || "");
    $("#uie-add-age").val(person.age || "");
    $("#uie-add-family").val(person.knownFamily || "");
    $("#uie-add-family-role").val(person.familyRole || "");
    $("#uie-add-rel-status").val(person.relationshipStatus || "");
    $("#uie-add-tab").val(person.tab || currentTab);
    $("#uie-add-affinity").val(Number.isFinite(Number(person?.affinity)) ? Number(person.affinity) : 50);
    $("#uie-add-url").val(person.url || "");
    $("#uie-add-bday").val(person.birthday || "");
    $("#uie-add-loc").val(person.location || "");
    $("#uie-add-thoughts").val(person.thoughts || "");
    $("#uie-add-likes").val(person.likes || "");
    $("#uie-add-dislikes").val(person.dislikes || "");
    try { $("#uie-add-known-past").prop("checked", person.known_from_past === true); } catch (_) {}
    try { $("#uie-add-met-phys").prop("checked", person.met_physically === true); } catch (_) {}

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
    const affinity = normalizeAffinity($("#uie-add-affinity").val(), 50);
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
        met_physically: $("#uie-add-met-phys").prop("checked") === true,
    };
    if (person.met_physically) person.known_from_past = false;

    if (editingIndex !== null && s.social[currentTab] && s.social[currentTab][editingIndex]) {
        const prev = s.social[currentTab][editingIndex];
        s.social[currentTab].splice(editingIndex, 1);
        const nextTab = tab || currentTab;
        s.social[nextTab].push({ ...prev, ...person });
    } else {
        const nextTab = tab || currentTab;
        s.social[nextTab].push({
            id: newId("person"),
            memories: [],
            familyRole: "",
            relationshipStatus: "",
            ...person,
        });
    }

    try { unforgetDeletedName(s, name); } catch (_) {}
    commitStateUpdate({ save: true, layout: false, emit: true });
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
    s.social[currentTab] = list.filter((p, idx) => !isSelected(p, idx));
    commitStateUpdate({ save: true, layout: false, emit: true });

    deleteMode = false;
    selectedForDelete = [];
    renderSocial();

    try { window.toastr?.success?.(`Deleted ${removed.length} contact(s).`); } catch (_) {}
    try { injectRpEvent(`[System: Deleted ${removed.length} social contact(s): ${removed.join(", ")}.]`); } catch (_) {}
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

function isLikelyToolOrMetaCardName(name) {
    const raw = String(name || "").trim();
    if (!raw) return true;
    const key = normalizeNameKey(raw).replace(/^[\[{(<\s]+|[\]})>\s]+$/g, "").trim();
    if (!key) return true;

    const exact = new Set([
        "system",
        "narrator",
        "story",
        "story narrator",
        "game",
        "game master",
        "gm",
        "assistant",
        "omniscient",
        "omniscent",
        "metadata",
        "meta",
        "tool",
        "tool card",
        "npc tool",
        "npc controller",
        "director",
        "story director",
        "lorebook",
        "author note",
        "author's note",
        "a/n",
        "an",
        "ooc",
        "ic",
    ]);
    if (exact.has(key)) return true;

    if (/^(meta|metadata|ooc|system|narrator|story|tool|gm|game master)\b/.test(key)) return true;
    if (/\b(omniscient|omniscent|tool\s*card|npc\s*tool|metadata\s*card|lorebook|author'?s?\s*note|control\s*card|system\s*prompt|stage\s*direction)\b/.test(key)) return true;
    if (/^[\[{(<].*[\]})>]$/.test(raw) && /\b(system|meta|ooc|narrator|tool|gm|omniscient|omniscent)\b/i.test(raw)) return true;

    return false;
}

function isLikelyRoleOnlyName(name) {
    const raw = String(name || "").trim();
    if (!raw) return true;
    const key = normalizeNameKey(raw).replace(/^[\[{(<\s"']+|[\]})>\s"']+$/g, "").trim();
    if (!key) return true;

    if (/^(mr|mrs|ms|dr|prof)\.?$/.test(key)) return true;

    const roleSingles = new Set([
        "captain", "commander", "general", "admiral", "colonel", "major", "lieutenant", "sergeant", "officer",
        "chief", "director", "agent", "master", "mistress", "professor", "doctor", "doc", "teacher",
        "king", "queen", "prince", "princess", "duke", "duchess", "lord", "lady", "sir", "madam",
        "merchant", "shopkeeper", "bartender", "innkeeper", "guard", "soldier", "knight", "nurse", "pilot",
        "driver", "clerk", "receptionist", "villager", "stranger", "boss",
    ]);
    if (roleSingles.has(key)) return true;

    if (/^(?:the\s+)?(?:captain|commander|general|admiral|colonel|major|lieutenant|sergeant|officer|chief|director|agent|merchant|shopkeeper|bartender|innkeeper|guard|soldier|knight|villager|stranger)(?:\s*#?\d+|\s+[ivx]+)?$/.test(key)) {
        return true;
    }

    return false;
}

function shouldExcludeName(n, { userNames, deletedSet } = {}) {
    const name = String(n || "").trim();
    if (!name) return true;
    if (name.length > 64) return true;
    const k = normalizeNameKey(name).replace(/^[\[{(<\s"']+|[\]})>\s"']+$/g, "").trim();
    if (!k) return true;
    if (deletedSet && deletedSet.has(k)) return true;
    if (isLikelyToolOrMetaCardName(name)) return true;
    if (isLikelyRoleOnlyName(name)) return true;

    const hard = new Set(["you", "user", "narrator", "system", "assistant", "story", "gm", "game master", "unknown"]);
    if (hard.has(k)) return true;
    if (Array.isArray(userNames) && userNames.some(u => normalizeNameKey(u).replace(/^[\[{(<\s"']+|[\]})>\s"']+$/g, "").trim() === k)) return true;
    return false;
}

async function promptOrganizationForNewContacts(names) {
    const list = Array.isArray(names) ? names.map(x => String(x || "").trim()).filter(Boolean) : [];
    if (!list.length) return;

    const max = 8;
    const subset = list.slice(0, max);
    for (const nm of subset) {
        const tabRaw = prompt(`Organize contact: ${nm}\nTab? (friends/associates/romance/family/rivals)\nBlank = keep default (friends)`, "");
        if (tabRaw === null) break;

        const t = String(tabRaw || "").trim().toLowerCase();
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
        const allTabs = ["friends", "associates", "romance", "family", "rivals"];
        const curTab = allTabs.find(k => (s.social[k] || []).some(p => String(p?.name || "").trim().toLowerCase() === nm.toLowerCase())) || "friends";
        const idx = (s.social[curTab] || []).findIndex(p => String(p?.name || "").trim().toLowerCase() === nm.toLowerCase());
        if (idx < 0) continue;

        const p = s.social[curTab][idx];
        p.affinity = aff;
        if (String(rel || "").trim()) p.relationshipStatus = String(rel || "").trim().slice(0, 80);
        if (String(origin || "").trim()) {
            const o = String(origin || "").trim().slice(0, 160);
            p.thoughts = p.thoughts ? String(p.thoughts).slice(0, 240) : `Origin: ${o}`;
        }

        if (wantTab && wantTab !== curTab) {
            s.social[curTab].splice(idx, 1);
            p.tab = wantTab;
            s.social[wantTab].push(p);
        }
        commitStateUpdate({ save: true, layout: false, emit: true });
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
- Keep names short (2-40 chars), no emojis, no titles like "Mr.", no roles like "Guard #2" unless that is literally used as the name.`;

        const res = await generateContent(prompt, "System Check");
        if (!res) return { names: [], questions: [] };
        const obj = safeJsonParseObject(res) || {};
        const names = Array.isArray(obj?.names) ? obj.names.map(x => String(x || "").trim()).filter(Boolean) : [];
        const questions = Array.isArray(obj?.questions) ? obj.questions.map(x => String(x || "").trim()).filter(Boolean) : [];
        return { names: names.slice(0, 24), questions: questions.slice(0, 6) };
    } catch (_) {
        return { names: [], questions: [] };
    }
}

async function scanChatIntoSocial({ silent } = {}) {
    const now = Date.now();
    if (autoScanInFlight) {
        if (!silent) notify("info", "Social scan already running.", "Social", "social");
        return;
    }
    if (now - autoScanLastAt < 1500) {
        if (!silent) notify("info", "Social scan already triggered. Please wait a moment.", "Social", "social");
        return;
    }

    autoScanInFlight = true;
    autoScanLastAt = now;

    try {
        const s = getSettings();
        normalizeSocial(s);

        const ctx = getContext ? getContext() : {};
        const userName = String(ctx?.name1 || "").trim();
        const mainCharName = String(ctx?.name2 || "").trim();
        const deleted = deletedNameSet(s);
        const userNames = [userName, mainCharName].filter(Boolean);

        const transcript = await getChatTranscript(240);
        if (!transcript) {
            if (!silent) notify("info", "No chat transcript found.", "Social", "social");
            return;
        }

        const prompt = `[UIE_LOCKED]
Analyze the following chat transcript to find characters/people for the Social Contacts list.
User Name: "${userName}"

Transcript:
${transcript.slice(-22000)}

Task: Identify characters (NPCs/people) mentioned or present in the story and return profile fields.
Return ONLY valid JSON:
{"found":[{"name":"Name","role":"friend|rival|romance|family|associate|npc","affinity":50,"presence":"present|mentioned|known_past","relationshipStatus":"","thoughts":"","location":"","age":"","knownFamily":"","familyRole":"","birthday":"","likes":"","dislikes":"","url":"","met_physically":false,"known_from_past":false}]}

Rules:
- Include everyone found in transcript context. Do not invent.
- Exclude user/system/meta/tool controller names.
- affinity must be 0..100; if unknown use 50.
- Fill unknown text fields with empty string.
- name must be concise and stable.`;

        try { window.toastr?.info?.("Scanning story for characters..."); } catch (_) {}

        let found = [];
        let res = "";
        try {
            res = await generateContent(prompt, "Social Scan");
        } catch (_) {
            res = "";
        }

        if (res) {
            const obj = safeJsonParseObject(res) || {};
            if (Array.isArray(obj?.found)) {
                found = obj.found;
            } else if (Array.isArray(obj?.names)) {
                found = obj.names
                    .map((name) => ({ name: String(name || "").trim(), role: "associate", affinity: 50, presence: "mentioned" }))
                    .filter((x) => x.name);
            }
        }

        if (!found.length) {
            try {
                const alt = await aiExtractNamesFromChat(240);
                const names = Array.isArray(alt?.names) ? alt.names : [];
                found = names
                    .map((name) => ({ name: String(name || "").trim(), role: "associate", affinity: 50, presence: "mentioned" }))
                    .filter((x) => x.name);
            } catch (_) {}
        }

        if (!found.length) {
            const fallbackNames = [
                ...extractNamesFromChatDom(240),
                ...extractTaggedNamesFromChatText(240),
                ...extractNamesFromTextHeuristics(240),
            ];
            const uniq = Array.from(new Set(fallbackNames.map(n => String(n || "").trim()).filter(Boolean)));
            found = uniq.map((name) => ({ name, role: "associate", affinity: 50, presence: "mentioned" }));
        }

        if (!found.length) {
            if (!silent) notify("info", "No characters found in chat.", "Social", "social");
            return;
        }

        const normalizeRoleToTab = (role, affinity = 50, familyRole = "", relationshipStatus = "") => {
            const r = `${String(role || "")} ${String(relationshipStatus || "")} ${String(familyRole || "")}`.toLowerCase();
            if (r.includes("family") || r.includes("mother") || r.includes("father") || r.includes("sister") || r.includes("brother") || r.includes("daughter") || r.includes("son")) return "family";
            if (r.includes("romance") || r.includes("lover") || r.includes("dating") || r.includes("spouse") || r.includes("wife") || r.includes("husband")) return "romance";
            if (r.includes("rival") || r.includes("enemy") || r.includes("hostile") || Number(affinity) <= 20) return "rivals";
            if (r.includes("associate") || r.includes("acquaintance") || r.includes("contact") || r.includes("npc") || r.includes("merchant") || r.includes("stranger")) return "associates";
            return "friends";
        };

        const tabPriority = { friends: 1, associates: 2, family: 3, romance: 4, rivals: 5 };
        const tabs = ["friends", "associates", "romance", "family", "rivals"];
        const findByNameKey = (nameKey) => {
            for (const tab of tabs) {
                const idx = (s.social[tab] || []).findIndex(p => normalizeNameKey(p?.name || "") === nameKey);
                if (idx >= 0) return { tab, idx, person: s.social[tab][idx] };
            }
            return { tab: "friends", idx: -1, person: null };
        };

        let added = 0;
        let updated = 0;
        let accepted = 0;
        const seenThisRun = new Set();

        for (const v of found) {
            const nm = cleanFieldValue(v?.name, 64);
            if (!nm) continue;

            const key = normalizeNameKey(nm);
            if (!key || seenThisRun.has(key)) continue;
            seenThisRun.add(key);

            if (shouldExcludeName(nm, { userNames, deletedSet: deleted })) continue;
            accepted++;
            if (accepted > 40) break;

            const flags = derivePresenceFlags(v);
            const familyRole = cleanFieldValue(firstNonEmpty(v?.familyRole, v?.family_role), 80);
            const relationshipRaw = cleanFieldValue(firstNonEmpty(v?.relationshipStatus, v?.relationship, v?.status, v?.role), 80);
            const aff = normalizeAffinity(v?.affinity, 50);
            const tab = normalizeRoleToTab(v?.role || relationshipRaw, aff, familyRole, relationshipRaw);

            const thoughts = cleanFieldValue(firstNonEmpty(v?.thoughts, v?.notes, v?.summary, v?.description), 240);
            const location = cleanFieldValue(v?.location, 120);
            const age = cleanFieldValue(v?.age, 40);
            const knownFamily = cleanFieldValue(firstNonEmpty(v?.knownFamily, v?.known_family, v?.family), 120);
            const birthday = cleanFieldValue(v?.birthday, 48);
            const likes = cleanFieldValue(v?.likes, 180);
            const dislikes = cleanFieldValue(v?.dislikes, 180);
            const url = safeUrl(cleanFieldValue(v?.url, 240));
            const avatar = findAvatarForNameFromChat(nm);

            let relationshipStatus = relationshipRaw;
            if (!relationshipStatus && tab === "family") relationshipStatus = familyRole ? `Family: ${familyRole}` : "Family";
            if (!relationshipStatus && tab === "romance") relationshipStatus = "Romantic connection";
            if (!relationshipStatus && tab === "rivals") relationshipStatus = "Hostile / rival";
            if (!relationshipStatus && tab === "friends") relationshipStatus = "Friendly";
            if (!relationshipStatus) relationshipStatus = flags.met ? "Known contact" : "Mentioned in story";

            const hit = findByNameKey(key);
            if (hit.person) {
                const person = hit.person;
                let changed = false;

                if (!person.id) { person.id = newId("person"); changed = true; }
                if (!Array.isArray(person.memories)) { person.memories = []; changed = true; }
                if (!Number.isFinite(Number(person.affinity))) { person.affinity = 50; changed = true; }

                const prevAff = normalizeAffinity(person.affinity, 50);
                if (prevAff !== aff && (prevAff === 50 || aff <= 30 || aff >= 70)) {
                    person.affinity = aff;
                    changed = true;
                }

                if (avatar && !String(person.avatar || "").trim()) {
                    person.avatar = avatar;
                    changed = true;
                }

                changed = maybeUpdateTextField(person, "relationshipStatus", relationshipStatus, 80) || changed;
                changed = maybeUpdateTextField(person, "thoughts", thoughts, 240) || changed;
                changed = maybeUpdateTextField(person, "location", flags.met ? (location || "In current scene") : location, 120) || changed;
                changed = maybeUpdateTextField(person, "age", age, 40) || changed;
                changed = maybeUpdateTextField(person, "knownFamily", knownFamily, 120) || changed;
                changed = maybeUpdateTextField(person, "familyRole", familyRole, 80) || changed;
                changed = maybeUpdateTextField(person, "birthday", birthday, 48) || changed;
                changed = maybeUpdateTextField(person, "likes", likes, 180) || changed;
                changed = maybeUpdateTextField(person, "dislikes", dislikes, 180) || changed;

                if (url && String(person.url || "").trim() !== url) {
                    person.url = url;
                    changed = true;
                }

                if (flags.met && person.met_physically !== true) {
                    person.met_physically = true;
                    changed = true;
                }
                if (flags.knownPast && person.known_from_past !== true) {
                    person.known_from_past = true;
                    changed = true;
                }
                if (person.met_physically === true && person.known_from_past === true) {
                    person.known_from_past = false;
                    changed = true;
                }

                if (tab !== hit.tab && (tabPriority[tab] || 0) >= (tabPriority[hit.tab] || 0)) {
                    s.social[hit.tab].splice(hit.idx, 1);
                    person.tab = tab;
                    s.social[tab].push(person);
                    changed = true;
                }

                if (changed) updated++;
                continue;
            }

            const p = {
                id: newId("person"),
                name: nm,
                affinity: aff,
                thoughts,
                avatar: avatar || "",
                likes,
                dislikes,
                birthday,
                location: flags.met ? (location || "In current scene") : location,
                age,
                knownFamily,
                familyRole,
                relationshipStatus,
                url,
                tab,
                memories: [],
                met_physically: flags.met,
                known_from_past: flags.met ? false : flags.knownPast,
            };

            s.social[tab].push(p);
            added++;
        }

        if (added || updated) {
            commitStateUpdate({ save: true, layout: false, emit: true });
            renderSocial();
            if (!silent) {
                const parts = [];
                if (added) parts.push(`${added} added`);
                if (updated) parts.push(`${updated} updated`);
                notify("success", `Social scan complete: ${parts.join(", ")}.`, "Social", "social");
            }
        } else if (!silent) {
            notify("info", "No social updates found (all exist or ignored).", "Social", "social");
        }
    } finally {
        autoScanInFlight = false;
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

    const prompt = SCAN_TEMPLATES.social.relationship(nm, src, tx.slice(0, 1200), prevAff, prevRole, prevMet);

    let delta = 0;
    let role = "";
    try {
        const res = await generateContent(prompt, "System Check");
        const obj = safeJsonParseObject(res || "") || {};
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
        commitStateUpdate({ save: true, layout: false, emit: true });
        try {
            injectRpEvent(`[Canon Event: Interaction with ${nm}. Affinity: ${Math.round(Number(person.affinity || prevAff))}. Status: ${String(person.relationshipStatus || prevRole || "").trim() || "-"}.]`);
        } catch (_) {}
    } else {
        commitStateUpdate({ save: true, layout: false, emit: true });
    }
}

export function initSocial() {
    const $win = $("#uie-social-window");

    $win.off("click", ".uie-tab");
    $win.on("click", ".uie-tab", function() {
        $win.find(".uie-tab").removeClass("active");
        $(this).addClass("active");
        currentTab = $(this).data("tab");
        renderSocial();
    });

    $win.off("change.uieSocialImg", "#uie-add-img-file");
    $win.on("change.uieSocialImg", "#uie-add-img-file", async function() {
        const f = this.files && this.files[0];
        const base64 = await readFileAsBase64(f);
        tempImgBase64 = base64;
        if (base64) {
            $("#uie-add-preview").attr("src", base64).show();
            $("#uie-add-icon").hide();
        }
    });

    $win.off("pointerdown.uieSocialCard touchstart.uieSocialCard");
    $win.on("pointerdown.uieSocialCard touchstart.uieSocialCard", ".uie-social-card", function() {
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

    $win.off("pointerup.uieSocialCard pointercancel.uieSocialCard touchend.uieSocialCard touchcancel.uieSocialCard");
    $win.on("pointerup.uieSocialCard pointercancel.uieSocialCard touchend.uieSocialCard touchcancel.uieSocialCard", ".uie-social-card", function() {
        try { clearTimeout(socialLongPressTimer); } catch (_) {}
    });

    $win.off("click", ".uie-social-card");
    $win.on("click", ".uie-social-card", function(e) {
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

    $win.off("click.uieSocialClose");
    $win.on("click.uieSocialClose", "#uie-social-close", (e) => { e.preventDefault(); e.stopPropagation(); $("#uie-social-overlay").removeAttr("data-open").hide(); $win.hide(); $("#uie-social-menu").hide(); closeAddModal(); });
    $win.on("click.uieSocialClose", ".uie-p-close", (e) => { e.preventDefault(); e.stopPropagation(); $("#uie-social-overlay").removeAttr("data-open").hide(); });
    $win.on("click.uieSocialMemClose", "#uie-social-mem-close", (e) => { e.preventDefault(); e.stopPropagation(); $("#uie-social-mem-overlay").hide(); });
    $win.on("click.uieSocialMemBackdrop", "#uie-social-mem-overlay", (e) => {
        if ($(e.target).closest(".uie-paper-box").length) return;
        $("#uie-social-mem-overlay").hide();
    });

    $win.off("click.uieSocialMenu");
    $win.on("click.uieSocialMenu", "#uie-social-sparkle", (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        $("#uie-social-menu").toggle();
    });
    $win.on("click.uieSocialMenu", function(e) {
        const $t = $(e.target);
        if ($t.closest("#uie-social-sparkle, #uie-social-menu").length) return;
        $("#uie-social-menu").hide();
    });

    $win.off("click.uieSocialMemBtn");
    $win.on("click.uieSocialMemBtn", "#uie-social-memories", (e) => {
        e.preventDefault();
        e.stopPropagation();
        $("#uie-social-mem-overlay").show();
        renderMemoryOverlay();
    });

    $win.off("click.uieSocialMemActions");
    $win.on("click.uieSocialMemActions", "#uie-social-mem-add, #uie-social-mem-clear, #uie-social-mem-scan, #uie-social-mem-inject", async function(e) {
        e.preventDefault();
        e.stopPropagation();
        const { person } = getActivePerson();
        if (!person) return;

        if (this.id === "uie-social-mem-add") {
            const text = prompt("Add a vital memory (consequence-based):", "");
            if (text === null) return;
            let t = String(text || "").trim();
            if (!t) return;
            if (!lineMentionsName(t, person.name)) t = `${person.name}: ${t}`;
            const impact = prompt("Impact on the character (optional):", "") ?? "";
            const tagsRaw = prompt("Tags (comma-separated, optional):", "") ?? "";
            if (isTrivialMemory(t) || isMetaMemoryText(t)) {
                try { window.toastr?.info?.("That looks trivial or meta. Keep only vital, in-world memories."); } catch (_) {}
                return;
            }
            person.memories.push({
                id: newId("mem"),
                t: Date.now(),
                text: t.slice(0, 320),
                impact: String(impact || "").trim().slice(0, 240),
                tags: parseTagsInput(tagsRaw, []),
            });
            commitStateUpdate({ save: true, layout: false, emit: true });
            renderMemoryOverlay();
            return;
        }

        if (this.id === "uie-social-mem-clear") {
            const ok = confirm("Clear ALL memories for this character?");
            if (!ok) return;
            person.memories = [];
            commitStateUpdate({ save: true, layout: false, emit: true });
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

    $win.off("click.uieSocialMemEdit");
    $win.on("click.uieSocialMemEdit", ".uie-social-mem-edit", function(e) {
        e.preventDefault();
        e.stopPropagation();
        const mid = String($(this).data("mid") || "");
        const { person } = getActivePerson();
        if (!person || !mid) return;
        const mem = (Array.isArray(person.memories) ? person.memories : []).find(m => String(m?.id || "") === mid);
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
        commitStateUpdate({ save: true, layout: false, emit: true });
        renderMemoryOverlay();
    });

    $win.off("click.uieSocialMemDel");
    $win.on("click.uieSocialMemDel", ".uie-social-mem-del", function(e) {
        e.preventDefault();
        e.stopPropagation();
        const mid = String($(this).data("mid") || "");
        const { person } = getActivePerson();
        if (!person || !mid) return;
        person.memories = (Array.isArray(person.memories) ? person.memories : []).filter(m => String(m?.id || "") !== mid);
        commitStateUpdate({ save: true, layout: false, emit: true });
        renderMemoryOverlay();
    });

    $win.off("click.uieSocialActions");
    $win.on("click.uieSocialActions", "#uie-act-add", (e) => { e.preventDefault(); e.stopPropagation(); $("#uie-social-menu").hide(); openAddModal({ mode: "add" }); });
    $win.on("click.uieSocialActions", "#uie-cancel-add", (e) => { e.preventDefault(); e.stopPropagation(); closeAddModal(); });
    $win.on("click.uieSocialActions", "#uie-submit-add", (e) => { e.preventDefault(); e.stopPropagation(); applyAddOrEdit(); });

    $win.on("click.uieSocialActions", "#uie-act-delete", (e) => { e.preventDefault(); e.stopPropagation(); $("#uie-social-menu").hide(); toggleDeleteMode(); });
    $win.on("click.uieSocialActions", "#uie-delete-controls .uie-del-confirm", (e) => { e.preventDefault(); e.stopPropagation(); confirmMassDelete(); });
    $win.on("click.uieSocialActions", "#uie-delete-controls .uie-del-cancel", (e) => { e.preventDefault(); e.stopPropagation(); cancelMassDelete(); });

    $win.on("click.uieSocialActions", "#uie-act-scan", async (e) => { e.preventDefault(); e.stopPropagation(); $("#uie-social-menu").hide(); await scanChatIntoSocial(); });
    $win.on("click.uieSocialActions", "#uie-act-toggle-auto", (e) => {
        e.preventDefault();
        e.stopPropagation();
        $("#uie-social-menu").hide();
        const s = getSettings();
        if (!s.socialMeta) s.socialMeta = { autoScan: false };
        s.socialMeta.autoScan = !s.socialMeta.autoScan;
        commitStateUpdate({ save: true, layout: false, emit: true });
        $("#uie-auto-scan-state").text(s.socialMeta.autoScan ? "ON" : "OFF");
        notify("info", `Auto Scan: ${s.socialMeta.autoScan ? "ON" : "OFF"}`, "Social", "social");
        syncSocialAutoScanLoop({ immediate: s.socialMeta.autoScan === true });
    });

    $win.on("click.uieSocialActions", "#uie-act-bg", (e) => {
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
                    commitStateUpdate({ save: true, layout: false, emit: true });
                    try { import("./core.js").then(core => core.updateLayout?.()); } catch (_) {}
                };
                r.readAsDataURL(f);
            } catch (_) {}
        };
        inp.click();
    });

    $win.on("click.uieSocialActions", "#uie-act-heart", (e) => {
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
                    if (!s.ui.icons) s.ui.icons = { heart: "" };
                    s.ui.icons.heart = dataUrl;
                    commitStateUpdate({ save: true, layout: false, emit: true });
                };
                r.readAsDataURL(f);
            } catch (_) {}
        };
        inp.click();
    });

    $win.on("click.uieSocialActions", "#uie-social-edit", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (activeProfileIndex === null) return;
        $("#uie-social-overlay").removeAttr("data-open").hide();
        openAddModal({ mode: "edit", index: activeProfileIndex });
    });

    $win.on("click.uieSocialActions", "#uie-social-message", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const s2 = getSettings();
        const p = s2?.social?.[currentTab]?.[activeProfileIndex] || null;
        const nm = String(p?.name || "").trim();
        $("#uie-social-overlay").removeAttr("data-open").hide();
        await ensurePaperTemplate(nm);
    });

    $win.on("click.uieSocialActions", "#uie-social-del-one", (e) => {
        e.preventDefault();
        e.stopPropagation();
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
        commitStateUpdate({ save: true, layout: false, emit: true });
        activeProfileIndex = null;
        $("#uie-social-overlay").removeAttr("data-open").hide();
        renderSocial();
    });

    try {
        const s = getSettings();
        if (s.socialMeta && typeof s.socialMeta.autoScan === "boolean") {
            $("#uie-auto-scan-state").text(s.socialMeta.autoScan ? "ON" : "OFF");
        }
    } catch (_) {}

    syncSocialAutoScanLoop();

    import("./stateTracker.js").then(mod => {
        if (typeof mod.initAutoScanning === "function") mod.initAutoScanning();
    });
}
