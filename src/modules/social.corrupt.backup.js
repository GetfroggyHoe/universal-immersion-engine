import { getSettings, commitStateUpdate } from "./core.js";
import { generateContent } from "./apiClient.js";
import { getContext } from "/scripts/extensions.js";
import { notify } from "./notifications.js";
import { injectRpEvent } from "./features/rp_log.js";
import { getChatTranscriptText } from "./chatLog.js";
import { safeJsonParseObject } from "./jsonUtil.js";

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

async function ensurePaperTemplate() {
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
    $("#uie-social-mem-sub").text(`${person.name} â†” ${user}`);

    const list = Array.isArray(person.memories) ? person.memories.slice() : [];
    list.sort((a, b) => Number(b?.t || 0) - Number(a?.t || 0));
    const $list = $("#uie-social-mem-list");
    $list.empty();
    if (!list.length) {
        $("#uie-social-mem-empty").show();
        return;
    }
    $("#uie-social-mem-empty").hide();

    const rowTmpl = document.getElementById("uie-social-memory-row").content;

    for (const mem of list) {
        const id = String(mem?.id || "");
        const text = String(mem?.text || "").trim();
        const impact = String(mem?.impact || "").trim();
        const tags = Array.isArray(mem?.tags) ? mem.tags.map(t => String(t || "").trim()).filter(Boolean).slice(0, 6) : [];

        const el = $(rowTmpl.cloneNode(true));
        el.find(".mem-text").text(text || "â€”");

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
    const transcript = await getChatTranscript(90);
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
- No trivial entries (no greetings, walking in, â€œthey talkedâ€, generic vibes).
- Be specific and consequence-based. 1â€“2 sentences per memory.
- Tags are short (e.g., "promise", "betrayal", "injury", "secret", "favor", "trauma", "trust").`;

    try { window.toastr?.info?.("Scanning memories..."); } catch (_) {}
    const res = await generateContent(prompt.slice(0, 16000), "System Check");
    if (!res) return;
    const obj = safeJsonParseObject(res);
    const mems = Array.isArray(obj?.memories) ? obj.memories : [];
    const existing = new Set((person.memories || []).map(m => String(m?.text || "").toLowerCase().replace(/\s+/g, " ").trim()).filter(Boolean));
    let added = 0;
    let updated = 0;
    let accepted = 0;

    for (const v of found) {
        const nm = String(v?.name || "").trim();
        if (!nm) continue;
        if (shouldExcludeName(nm, { userNames, deletedSet: deleted })) continue;
        accepted++;
        if (accepted > 30) break;
        const key = normalizeNameKey(nm);
        if (!nameAppearsInTranscript(transcriptLower, nm)) continue;

        const presence = String(v?.presence || "").toLowerCase().trim();
        const met = toBool(v?.met_physically) || presence === "present" || presence === "in_scene" || presence === "in room";
        const knownPast = toBool(v?.known_from_past) || presence === "known_past";
        const familyRole = String(v?.family_role || v?.familyRole || "").trim().slice(0, 80);
        const relationship = String(v?.relationship || v?.status || v?.role || "").trim().slice(0, 80);
        const knowsUser = String(v?.knows_user || "").trim().toLowerCase();
        const aff = normalizeSocialAffinity(v?.affinity, v?.role, relationship);
        const tab = normalizeRoleToTab(v?.role || relationship, aff, familyRole, relationship);
        const location = met ? "In current scene" : String(v?.location || "").trim().slice(0, 80);
        const avatar = findAvatarForNameFromChat(nm);

        let relationshipStatus = relationship;
        if (!relationshipStatus && tab === "family") relationshipStatus = familyRole ? `Family: ${familyRole}` : "Family";
        if (!relationshipStatus && tab === "romance") relationshipStatus = "Romantic connection";
        if (!relationshipStatus && tab === "rivals") relationshipStatus = "Hostile / rival";
        if (!relationshipStatus && tab === "friends") relationshipStatus = "Friendly";
        if (!relationshipStatus) relationshipStatus = met ? "Known contact" : "Mentioned in story";
        if (knowsUser === "no") relationshipStatus = "Does not know user yet";
        else if (knowsUser === "yes" && !relationshipStatus.toLowerCase().includes("know")) relationshipStatus = `${relationshipStatus}; knows user`;

        const foundHit = findByName(nm);
        if (foundHit.person) {
            const person = foundHit.person;
            let changed = false;

            if (!person.id) {
                person.id = newId("person");
                changed = true;
            }
            if (!Array.isArray(person.memories)) {
                person.memories = [];
                changed = true;
            }

            if (avatar && !String(person.avatar || "").trim()) {
                person.avatar = avatar;
                changed = true;
            }

            const prevAff = Math.max(0, Math.min(100, Number(person?.affinity ?? 50)));
            if (!Number.isFinite(prevAff) || prevAff === 50 || aff <= 30 || aff >= 70) {
                if (prevAff !== aff) {
                    person.affinity = aff;
                    changed = true;
                }
            }

            if (relationshipStatus && String(person.relationshipStatus || "").trim() !== relationshipStatus) {
                person.relationshipStatus = relationshipStatus;
                changed = true;
            }
            if (familyRole && String(person.familyRole || "").trim() !== familyRole) {
                person.familyRole = familyRole;
                changed = true;
            }
            if (met && person.met_physically !== true) {
                person.met_physically = true;
                changed = true;
            }
            if (knownPast && person.known_from_past !== true) {
                person.known_from_past = true;
                changed = true;
            }
            if (location && String(person.location || "").trim() !== location) {
                person.location = location;
                changed = true;
            }

            const curTab = foundHit.tab;
            if (tab !== curTab && (tabPriority[tab] || 0) >= (tabPriority[curTab] || 0)) {
                s.social[curTab].splice(foundHit.index, 1);
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
            thoughts: "",
            avatar: avatar || "",
            likes: "",
            dislikes: "",
            birthday: "",
            location,
            age: "",
            knownFamily: "",
            familyRole,
            relationshipStatus,
            url: "",
            tab,
            memories: [],
            met_physically: met,
            known_from_past: knownPast
        };

        s.social[tab].push(p);
        if (key) {
            // No-op map update kept local via key eval to prevent duplicate work in this run.
        }
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
        try { injectRpEvent(`[Canon Event: Interaction with ${nm}. Affinity: ${Math.round(Number(person.affinity || prevAff))}. Status: ${String(person.relationshipStatus || prevRole || "").trim() || "â€”"}.]`); } catch (_) {}
    } else {
        commitStateUpdate({ save: true, layout: false, emit: true });
    }
}

// --- INIT (Updated with Calendar Button) ---
export function initSocial() {
    const $win = $("#uie-social-window");

    // Events
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
    $win.on("pointerdown.uieSocialCard touchstart.uieSocialCard", ".uie-social-card", function(e) {
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
    $win.on("click.uieSocialClose", "#uie-social-close", (e) => { e.preventDefault(); e.stopPropagation(); $win.hide(); $("#uie-social-menu").hide(); closeAddModal(); });
    $win.on("click.uieSocialClose", ".uie-p-close", (e) => { e.preventDefault(); e.stopPropagation(); $("#uie-social-overlay").removeAttr("data-open").hide(); });
    $win.on("click.uieSocialMemClose", "#uie-social-mem-close", (e) => { e.preventDefault(); e.stopPropagation(); $("#uie-social-mem-overlay").hide(); });
    $win.on("click.uieSocialMemBackdrop", "#uie-social-mem-overlay", (e) => {
        if ($(e.target).closest(".uie-paper-box").length) return;
        $("#uie-social-mem-overlay").hide();
    });

    $win.off("click.uieSocialMenu");
    $win.on("click.uieSocialMenu", "#uie-social-sparkle", (e)=>{ e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); $("#uie-social-menu").toggle(); });
    // Close menu if clicking elsewhere in the window
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
    $win.on("click.uieSocialMemActions", "#uie-social-mem-add, #uie-social-mem-clear, #uie-social-mem-scan, #uie-social-mem-inject", async function (e) {
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

    $win.off("click.uieSocialMemDel");
    $win.on("click.uieSocialMemDel", ".uie-social-mem-del", function (e) {
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
    $win.on("click.uieSocialActions", "#uie-act-add", (e) => { e.preventDefault(); e.stopPropagation(); openAddModal({ mode: "add" }); });
    $win.on("click.uieSocialActions", "#uie-cancel-add", (e) => { e.preventDefault(); e.stopPropagation(); closeAddModal(); });
    $win.on("click.uieSocialActions", "#uie-submit-add", (e) => { e.preventDefault(); e.stopPropagation(); applyAddOrEdit(); });

    $win.on("click.uieSocialActions", "#uie-act-delete", (e) => { e.preventDefault(); e.stopPropagation(); toggleDeleteMode(); });
    $win.on("click.uieSocialActions", "#uie-delete-controls .uie-del-confirm", (e) => { e.preventDefault(); e.stopPropagation(); confirmMassDelete(); });
    $win.on("click.uieSocialActions", "#uie-delete-controls .uie-del-cancel", (e) => { e.preventDefault(); e.stopPropagation(); cancelMassDelete(); });

    $win.on("click.uieSocialActions", "#uie-act-scan", async (e) => { e.preventDefault(); e.stopPropagation(); $("#uie-social-menu").hide(); await scanChatIntoSocial(); });
    $win.on("click.uieSocialActions", "#uie-act-toggle-auto", (e) => {
        e.preventDefault(); e.stopPropagation();
        const s = getSettings();
        if (!s.socialMeta) s.socialMeta = { autoScan: false };
        s.socialMeta.autoScan = !s.socialMeta.autoScan;
        commitStateUpdate({ save: true, layout: false, emit: true });
        $("#uie-auto-scan-state").text(s.socialMeta.autoScan ? "ON" : "OFF");
        notify("info", `Auto Scan: ${s.socialMeta.autoScan ? "ON" : "OFF"}`, "Social", "social");
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
        e.preventDefault(); e.stopPropagation();
        if (activeProfileIndex === null) return;
        $("#uie-social-overlay").hide();
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
        commitStateUpdate({ save: true, layout: false, emit: true });
        activeProfileIndex = null;
        $("#uie-social-overlay").hide();
        renderSocial();
    });

    try {
        const s = getSettings();
        if (s.socialMeta && typeof s.socialMeta.autoScan === "boolean") $("#uie-auto-scan-state").text(s.socialMeta.autoScan ? "ON" : "OFF");
    } catch (_) {}

    // Init auto-scanner hooks (Event-based instead of DOM observer)
    import("./stateTracker.js").then(mod => {
        if (typeof mod.initAutoScanning === "function") mod.initAutoScanning();
    });
}




