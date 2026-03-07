import { getSettings, saveSettings, isMobileUI } from "./core.js";
import { getContext } from "/scripts/extensions.js";
import { injectRpEvent } from "./features/rp_log.js";
import { generateContent } from "./apiClient.js";
import { notify } from "./notifications.js";
import { MEDALLIONS } from "./inventory.js";
import { SCAN_TEMPLATES } from "./scanTemplates.js";
import { normalizeLifeTracker } from "./features/life.js";

let selectedId = null;
let tab = "roster";
let memberModalOpen = false;
let memberEdit = false;
let memberModalTab = "sheet";
let memberModalOpenedAt = 0;
let ignoreNextBackdropClick = false;
let partyInit = false;
let trackerModalEditId = "";

function esc(s) {
    return String(s ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function clampNum(n, min, max) {
    const v = Number(n);
    if (!Number.isFinite(v)) return min;
    return Math.max(min, Math.min(max, v));
}

function meterPct(cur, max) {
    const c = Number(cur || 0);
    const m = Number(max || 0);
    if (!Number.isFinite(c) || !Number.isFinite(m) || m <= 0) return 0;
    return Math.max(0, Math.min(100, (c / m) * 100));
}

function normalizeHexColor(v) {
    const raw = String(v || "").trim();
    return /^#[0-9a-fA-F]{6}$/.test(raw) ? raw : "#89b4fa";
}

function nextTrackerId() {
    return `trk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeMemberTracker(raw = {}) {
    const id = String(raw?.id || nextTrackerId()).trim() || nextTrackerId();
    const base = normalizeLifeTracker(raw);
    const max = Math.max(1, clampNum(base.max, 1, 999999));
    const current = clampNum(base.current, -999999, 999999);
    const color = normalizeHexColor(base.color);
    return {
        id,
        name: String(base.name || "Tracker").trim().slice(0, 60) || "Tracker",
        current,
        max,
        color,
        notes: String(base.notes || "").slice(0, 800),
    };
}

function getSheetTrackerRows(m) {
    const rows = [];

    const custom = Array.isArray(m?.trackers) ? m.trackers : [];
    for (let i = 0; i < custom.length; i++) {
        const t = normalizeMemberTracker(custom[i]);
        custom[i] = t;
        rows.push({
            kind: "custom",
            key: t.id,
            id: t.id,
            name: t.name,
            current: Number(t.current || 0),
            max: Math.max(1, Number(t.max || 1)),
            color: t.color,
            notes: t.notes,
        });
    }

    return rows;
}

function renderSheetTrackers(container, m) {
    const host = container.find(".party-member-trackers");
    if (!host.length) return;
    host.empty();

    const tmpl = document.getElementById("uie-party-tracker-row");
    if (!tmpl || !tmpl.content) return;

    const rows = getSheetTrackerRows(m);
    if (!rows.length) {
        host.html(`<div style="opacity:0.65; font-weight:800; padding:8px; border:1px dashed rgba(255,255,255,0.16); border-radius:10px;">No life trackers yet.</div>`);
        return;
    }

    rows.forEach((row) => {
        const el = $(tmpl.content.cloneNode(true));
        const card = el.find(".party-tracker-card");
        card.attr("data-track-kind", row.kind);
        card.attr("data-track-key", row.key);
        card.attr("data-track-id", row.id || "");

        el.find(".party-tracker-dot").css("background", row.color || "#89b4fa");
        el.find(".party-tracker-name").text(row.name || "Tracker");
        el.find(".party-tracker-meta").text(`${Math.round(Number(row.current || 0))}/${Math.round(Math.max(1, Number(row.max || 0)))}`);
        el.find(".party-tracker-fill").css({ width: `${meterPct(row.current, row.max)}%`, background: row.color || "#89b4fa" });

        const notes = String(row.notes || "").trim();
        if (notes) el.find(".party-tracker-notes").text(notes).show();

        if (row.kind === "custom") {
            el.find(".party-track-edit, .party-track-del").show();
        }

        host.append(el);
    });
}

function applyTrackerDelta(m, rowMeta, delta) {
    if (!m || !rowMeta) return false;
    const kind = String(rowMeta.kind || "");
    const key = String(rowMeta.key || "");
    const amt = Number(delta || 0);
    if (!Number.isFinite(amt) || amt === 0) return false;

    if (kind === "base") {
        if (!m.vitals) m.vitals = {};
        if (!m.progression) m.progression = { level: 1, xp: 0, skillPoints: 0, perkPoints: 0 };

        if (key === "hp" || key === "mp" || key === "ap") {
            const map = {
                hp: ["hp", "maxHp"],
                mp: ["mp", "maxMp"],
                ap: ["ap", "maxAp"],
            };
            const pair = map[key];
            if (!pair) return false;
            const curKey = pair[0];
            const maxKey = pair[1];
            const cur = Number(m.vitals?.[curKey] || 0);
            const max = Math.max(1, Number(m.vitals?.[maxKey] || 1));
            const next = clampNum(cur + amt, 0, max);
            if (next === cur) return false;
            m.vitals[curKey] = next;
            return true;
        }

        if (key === "xp") {
            let level = Math.max(1, Math.round(Number(m.progression?.level || 1)));
            let xp = Number(m.progression?.xp || 0);
            if (!Number.isFinite(xp)) xp = 0;
            xp += amt;

            const xpGoal = (lv) => Math.max(100, lv * 1000);
            while (xp >= xpGoal(level) && level < 999) {
                xp -= xpGoal(level);
                level += 1;
            }
            while (xp < 0 && level > 1) {
                level -= 1;
                xp += xpGoal(level);
            }
            if (level <= 1 && xp < 0) xp = 0;

            const nextXp = Math.max(0, Math.round(xp));
            const prevXp = Math.max(0, Math.round(Number(m.progression?.xp || 0)));
            const prevLevel = Math.max(1, Math.round(Number(m.progression?.level || 1)));
            if (nextXp === prevXp && level === prevLevel) return false;

            m.progression.level = level;
            m.progression.xp = nextXp;
            return true;
        }

        return false;
    }

    if (!Array.isArray(m.trackers)) m.trackers = [];
    const id = String(rowMeta.id || rowMeta.key || "").trim();
    if (!id) return false;
    const t = m.trackers.find((x) => String(x?.id || "").trim() === id);
    if (!t) return false;

    const cur = Number(t.current || 0);
    const next = clampNum(cur + amt, -999999, 999999);
    if (next === cur) return false;
    t.current = next;
    t.max = clampNum(t.max, 0, 999999);
    return true;
}

function getSelectedTrackerMember(s) {
    ensureParty(s);
    const m = selectedId ? getMember(s, selectedId) : (Array.isArray(s.party?.members) ? s.party.members[0] : null);
    if (!m) return null;
    ensureMember(m);
    if (!selectedId && m.id) selectedId = String(m.id);
    return m;
}

function openMemberTrackerModal(m, trackerId = "") {
    if (!m) return;
    ensureMember(m);
    if (!Array.isArray(m.trackers)) m.trackers = [];

    const id = String(trackerId || "").trim();
    const existing = id ? m.trackers.find((x) => String(x?.id || "").trim() === id) : null;
    trackerModalEditId = existing ? String(existing.id || "") : "";

    const normalized = normalizeMemberTracker(existing || {
        id: nextTrackerId(),
        name: "",
        current: 0,
        max: 100,
        color: "#89b4fa",
        notes: "",
    });

    $("#party-track-modal-title").text(existing ? `Edit Tracker: ${normalized.name}` : "New Tracker");
    $("#party-track-modal-name").val(existing ? normalized.name : "");
    $("#party-track-modal-color").val(normalized.color || "#89b4fa");
    $("#party-track-modal-current").val(Number(normalized.current || 0));
    $("#party-track-modal-max").val(Math.max(1, Number(normalized.max || 100)));
    $("#party-track-modal-notes").val(normalized.notes || "");
    $("#party-track-modal-delete").toggle(!!existing);
    $("#uie-party-tracker-modal").css({ display: "flex", zIndex: String(getMemberModalZIndex() + 2) });
}

function closeMemberTrackerModal() {
    trackerModalEditId = "";
    $("#uie-party-tracker-modal").hide();
}

function saveMemberTrackerModal() {
    const s = getSettings();
    const m = getSelectedTrackerMember(s);
    if (!m) return;
    if (!Array.isArray(m.trackers)) m.trackers = [];

    const normalized = normalizeMemberTracker({
        id: trackerModalEditId || nextTrackerId(),
        name: $("#party-track-modal-name").val(),
        color: $("#party-track-modal-color").val(),
        current: $("#party-track-modal-current").val(),
        max: $("#party-track-modal-max").val(),
        notes: $("#party-track-modal-notes").val(),
    });

    const idx = trackerModalEditId
        ? m.trackers.findIndex((x) => String(x?.id || "").trim() === String(trackerModalEditId))
        : -1;
    if (idx >= 0) m.trackers[idx] = normalized;
    else m.trackers.push(normalized);

    saveSettings();
    closeMemberTrackerModal();
    render();
    if (memberModalOpen) {
        try { renderMemberModal(s, m); } catch (_) {}
    }
}

function deleteMemberTrackerFromModal() {
    if (!trackerModalEditId) return;
    const s = getSettings();
    const m = getSelectedTrackerMember(s);
    if (!m || !Array.isArray(m.trackers)) return;

    const idx = m.trackers.findIndex((x) => String(x?.id || "").trim() === String(trackerModalEditId));
    if (idx < 0) return;
    if (!window.confirm("Delete this tracker?")) return;

    m.trackers.splice(idx, 1);
    saveSettings();
    closeMemberTrackerModal();
    render();
    if (memberModalOpen) {
        try { renderMemberModal(s, m); } catch (_) {}
    }
}

function downloadJsonFile(filename, data) {
    try {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = String(filename || "party_export.json");
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    } catch (_) {}
}

function pickJsonFile() {
    return new Promise((resolve) => {
        try {
            const input = document.createElement("input");
            input.type = "file";
            input.accept = "application/json,.json";
            input.style.display = "none";
            document.body.appendChild(input);
            input.onchange = async () => {
                try {
                    const f = input.files && input.files[0] ? input.files[0] : null;
                    if (!f) { input.remove(); return resolve(null); }
                    const r = new FileReader();
                    r.onload = () => {
                        const txt = String(r.result || "");
                        try { input.remove(); } catch (_) {}
                        resolve(txt || null);
                    };
                    r.onerror = () => {
                        try { input.remove(); } catch (_) {}
                        resolve(null);
                    };
                    r.readAsText(f);
                } catch (_) {
                    try { input.remove(); } catch (_) {}
                    resolve(null);
                }
            };
            input.click();
        } catch (_) {
            resolve(null);
        }
    });
}

function skillKey(name) {
    return String(name || "").trim().toLowerCase();
}

function normalizeSkill(x, source) {
    if (!x) return null;
    const name = typeof x === "string" ? x : (x.name || x.title || x.skill || "");
    const n = String(name || "").trim();
    if (!n) return null;
    const desc = typeof x === "string" ? "" : String(x.desc || x.description || x.text || "").trim();
    return { name: n.slice(0, 80), desc: desc.slice(0, 320), source: String(source || "Party") };
}

function resolveMemberSkills(s, m) {
    const out = [];
    const seen = new Set();
    const add = (sk) => {
        if (!sk) return;
        const k = skillKey(sk.name);
        if (!k || seen.has(k)) return;
        seen.add(k);
        out.push(sk);
    };

    const partySkills = Array.isArray(m?.skills) ? m.skills : [];
    for (const x of partySkills) add(normalizeSkill(x, "Party"));

    const nm = String(m?.identity?.name || "").trim().toLowerCase();
    const coreNm = String(s?.character?.name || "").trim().toLowerCase();
    const isUser = (Array.isArray(m?.roles) && m.roles.includes("User")) || (nm && coreNm && nm === coreNm);

    if (isUser) {
        const invSkills = Array.isArray(s?.inventory?.skills) ? s.inventory.skills : [];
        for (const x of invSkills) add(normalizeSkill(x, "Inventory"));
    }

    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
}

function ensureParty(s) {
    if (!s.party) s.party = { members: [], sharedItems: [], relationships: {}, partyTactics: {}, formation: { lanes: { front:[], mid:[], back:[] } } };
    if (!Array.isArray(s.party.members)) s.party.members = [];
    if (!Array.isArray(s.party.sharedItems)) s.party.sharedItems = [];
    if (!s.party.partyTactics) s.party.partyTactics = { preset: "Balanced" };
}

function isUserMember(s, m) {
    const memberName = String(m?.identity?.name || "").trim().toLowerCase();
    const coreName = String(s?.character?.name || "").trim().toLowerCase();
    return (Array.isArray(m?.roles) && m.roles.includes("User")) || (!!memberName && !!coreName && memberName === coreName);
}

function findUserMember(s) {
    const members = Array.isArray(s?.party?.members) ? s.party.members : [];
    const m = members.find((x) => isUserMember(s, x));
    return m || null;
}

function applyCoreToMember(s, m) {
    if (!s || !m) return false;
    ensureMember(m);
    const before = JSON.stringify({ n: m.identity?.name, c: m.identity?.class, v: m.vitals, p: m.progression, st: m.stats, img: m.images });
    const nm = String(s?.character?.name || "User");
    if (nm) m.identity.name = nm;
    const cls = String(s?.character?.className || "").trim();
    if (cls) m.identity.class = cls;
    const coreStats = s?.character?.stats && typeof s.character.stats === "object" ? s.character.stats : null;
    if (coreStats) {
        if (!m.stats || typeof m.stats !== "object") m.stats = {};
        for (const k of Object.keys(coreStats)) {
            const v = Number(coreStats[k]);
            if (Number.isFinite(v)) m.stats[k] = v;
        }
    }
    const av = String(s?.character?.avatar || "").trim();
    const pt = String(s?.character?.portrait || "").trim();
    if (!m.images) m.images = { portrait: "" };
    if (av) m.images.portrait = av;
    else if (pt) m.images.portrait = pt;
    m.vitals.hp = Number(s.hp || 0);
    m.vitals.maxHp = Number(s.maxHp || 0);
    m.vitals.mp = Number(s.mp || 0);
    m.vitals.maxMp = Number(s.maxMp || 0);
    m.vitals.ap = Number(s.ap || 0);
    m.vitals.maxAp = Number(s.maxAp || 0);
    if (!m.progression) m.progression = { level: 1, xp: 0, skillPoints: 0, perkPoints: 0 };
    m.progression.level = Number(s?.character?.level || 1);
    m.progression.xp = Number(s.xp || 0);
    const after = JSON.stringify({ n: m.identity?.name, c: m.identity?.class, v: m.vitals, p: m.progression, st: m.stats, img: m.images });
    return before !== after;
}

function applyMemberToCore(s, m) {
    if (!s || !m) return false;
    ensureMember(m);
    const before = JSON.stringify({ hp: s.hp, maxHp: s.maxHp, mp: s.mp, maxMp: s.maxMp, ap: s.ap, maxAp: s.maxAp, xp: s.xp, lvl: s?.character?.level, name: s?.character?.name, cls: s?.character?.className, st: s?.character?.stats, av: s?.character?.avatar });
    if (!s.character) s.character = {};
    s.character.name = String(m.identity?.name || s.character.name || "User");
    s.character.className = String(m.identity?.class || s.character.className || "").trim() || s.character.className;
    if (!s.character.stats || typeof s.character.stats !== "object") s.character.stats = {};
    const memberStats = m?.stats && typeof m.stats === "object" ? m.stats : null;
    if (memberStats) {
        for (const k of Object.keys(s.character.stats)) {
            const v = Number(memberStats[k]);
            if (Number.isFinite(v)) s.character.stats[k] = v;
        }
    }
    const av = String(m?.images?.portrait || "").trim();
    if (av) s.character.avatar = av;
    s.hp = Number(m.vitals?.hp || 0);
    s.maxHp = Number(m.vitals?.maxHp || 0);
    s.mp = Number(m.vitals?.mp || 0);
    s.maxMp = Number(m.vitals?.maxMp || 0);
    s.ap = Number(m.vitals?.ap || 0);
    s.maxAp = Number(m.vitals?.maxAp || 0);
    s.xp = Number(m.progression?.xp || s.xp || 0);
    s.character.level = Number(m.progression?.level || s.character.level || 1);
    const after = JSON.stringify({ hp: s.hp, maxHp: s.maxHp, mp: s.mp, maxMp: s.maxMp, ap: s.ap, maxAp: s.maxAp, xp: s.xp, lvl: s?.character?.level, name: s?.character?.name, cls: s?.character?.className, st: s?.character?.stats, av: s?.character?.avatar });
    return before !== after;
}

export function syncPartyUserFromCore() {
    const s = getSettings();
    if (!s) return;
    ensureParty(s);
    const m = findUserMember(s);
    if (!m) return;
    const changed = applyCoreToMember(s, m);
    if (changed) saveSettings();
}

function defaultMember(name) {
    return {
        id: Date.now() + Math.random().toString(36).substr(2, 5),
        identity: { name: name || "Member", class: "Adventurer", species: "Human", alignment: "Neutral" },
        images: { portrait: "" },
        stats: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10, per: 10, luk: 10 },
        vitals: { hp: 100, maxHp: 100, mp: 50, maxMp: 50, ap: 10, maxAp: 10, stamina: 100, maxStamina: 100 },
        progression: { level: 1, xp: 0, skillPoints: 0, perkPoints: 0, reborn: false, activeMedallion: null },
        equipment: {},
        trackers: [],
        partyRole: "DPS",
        roles: [],
        statusEffects: [],
        bio: "",
        notes: "",
        customCSS: "",
        active: true,
        tactics: { preset: "Balanced", focus: "auto", protectId: "", conserveMana: false }
    };
}

function getMember(s, id) {
    return s.party.members.find(m => String(m.id) === String(id));
}

function ensureMember(m) {
    if (!m.identity) m.identity = { name: "Member" };
    if (!m.images) m.images = { portrait: "" };
    if (typeof m.images.paperDoll !== "string") m.images.paperDoll = "";
    if (!Array.isArray(m.skills)) m.skills = [];
    m.skills = m.skills
        .map((x) => {
            if (!x) return null;
            if (typeof x === "string") return { name: x, description: "", skillType: "active" };
            if (typeof x !== "object") return null;
            const name = String(x.name || x.title || x.skill || "").trim();
            const description = String(x.description || x.desc || x.text || "").trim();
            const skillType = String(x.skillType || x.type || "active").toLowerCase();
            return { ...x, name, description, skillType: (skillType === "passive" ? "passive" : "active") };
        })
        .filter(Boolean);

    // Ensure stats object exists
    if (!m.stats) m.stats = {};
    // Fill missing stats with defaults
    const defaultStats = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10, per: 10, luk: 10 };
    for (const k in defaultStats) {
        if (typeof m.stats[k] !== "number") m.stats[k] = defaultStats[k];
    }

    // Ensure vitals object exists
    if (!m.vitals) m.vitals = {};
    const defaultVitals = { hp: 100, maxHp: 100, mp: 50, maxMp: 50, ap: 10, maxAp: 10 };
    for (const k in defaultVitals) {
        if (typeof m.vitals[k] !== "number") m.vitals[k] = defaultVitals[k];
    }

    if (!m.equipment) m.equipment = {};
    if (!Array.isArray(m.trackers)) m.trackers = [];
    m.trackers = m.trackers.map((t) => normalizeMemberTracker(t)).filter(Boolean).slice(0, 24);
    if (!m.tactics) m.tactics = { preset: "Balanced" };
    if (!Array.isArray(m.statusEffects)) m.statusEffects = [];
    if (!m.partyRole) m.partyRole = "DPS";
}

function resolvePortraitUrl(s, m) {
    const directRaw = String(m?.images?.portrait || "").trim();
    let direct = directRaw;
    try {
        const mm = directRaw.match(/^<char(?::([^>]+))?>$/i);
        if (mm) {
            const want = String(mm[1] || "").trim().toLowerCase();
            const friends = Array.isArray(s?.social?.friends) ? s.social.friends : [];
            const hit = friends.find(x => String(x?.name || "").trim().toLowerCase() === want) || null;
            direct = String(hit?.avatar || "").trim();
            if (!direct && want && Array.isArray(s?.party?.members)) {
                const pm = s.party.members.find(x => String(x?.identity?.name || "").trim().toLowerCase() === want);
                direct = String(pm?.images?.portrait || "").trim();
            }
        }
    } catch (_) {}
    if (direct) return direct;
    const nm = String(m?.identity?.name || "").trim().toLowerCase();
    if (nm) {
        const friends = Array.isArray(s?.social?.friends) ? s.social.friends : [];
        const f = friends.find(x => String(x?.name || "").trim().toLowerCase() === nm);
        const av = String(f?.avatar || f?.img || "").trim();
        if (av) return av;
    }
    const isUser = isUserMember(s, m);
    if (isUser) {
        const ua = String(s?.character?.avatar || "").trim();
        if (ua) return ua;
    }
    return "";
}

function pickLocalImage() {
    return new Promise((resolve) => {
        const input = document.getElementById("uie-party-file");
        if (!input) return resolve(null);

        // Reset value so change event triggers even if same file selected
        input.value = "";

        const prev = {
            display: input.style.display,
            position: input.style.position,
            left: input.style.left,
            top: input.style.top,
            width: input.style.width,
            height: input.style.height,
            opacity: input.style.opacity,
            pointerEvents: input.style.pointerEvents,
            zIndex: input.style.zIndex
        };
        try {
            input.style.display = "block";
            input.style.position = "fixed";
            input.style.left = "-9999px";
            input.style.top = "0px";
            input.style.width = "1px";
            input.style.height = "1px";
            input.style.opacity = "0";
            input.style.pointerEvents = "none";
            input.style.zIndex = "2147483647";
        } catch (_) {}

        input.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) {
                try { Object.assign(input.style, prev); } catch (_) {}
                return resolve(null);
            }
            const reader = new FileReader();
            reader.onload = (ev) => {
                try { Object.assign(input.style, prev); } catch (_) {}
                resolve(ev.target.result);
            };
            reader.readAsDataURL(file);
        };
        input.click();
    });
}

function renderRoster(s) {
    const container = $("#uie-party-body").empty();
    const controls = document.getElementById("uie-party-roster-controls").content.cloneNode(true);
    container.append(controls);

    const list = container.find(".party-list");
    const members = s.party.members || [];

    if (members.length === 0) {
        container.find(".party-empty").show();
    } else {
        const tmpl = document.getElementById("uie-party-roster-item").content;
        members.forEach(m => {
            const el = $(tmpl.cloneNode(true));
            const row = el.find(".party-row");
            row.attr("data-id", m.id);
            row.css({ cursor: "pointer", pointerEvents: "auto" });
            if (selectedId === String(m.id)) row.addClass("active");

            const portraitUrl = resolvePortraitUrl(s, m);
            const imgContainer = el.find(".party-row-img-container");
            if (portraitUrl) {
                imgContainer.html(`<img src="${esc(portraitUrl)}" style="width:100%;height:100%;object-fit:cover;">`);
            } else {
                imgContainer.html(`<i class="fa-solid fa-user" style="color:#333; font-size:24px;"></i>`);
            }

            el.find(".party-row-name").text(m.identity.name);
            el.find(".party-row-name").css("color", m.active ? "#fff" : "#888");

            el.find(".party-row-desc").text(`Lv.${m.progression?.level || 1} â€¢ ${m.partyRole || "DPS"} â€¢ ${m.identity.class || "Adventurer"}`);

            el.find("[data-act='toggleActive']").css("color", m.active ? "#2ecc71" : "#444");
            el.find("[data-act='leader']").css("color", s.party.leaderId === String(m.id) ? "#f1c40f" : "#444");

            el.find("button").attr("data-id", m.id);

            list.append(el);
        });
    }
}

function renderSheet(s) {
    const members = s.party.members || [];
    if (!members.length) {
        $("#uie-party-body").html(`<div style="opacity:0.75; text-align:center; padding:30px; border-radius:14px; border:1px dashed rgba(255,255,255,0.18);">Add a party member first.</div>`);
        return;
    }

    const m = selectedId ? getMember(s, selectedId) : members[0];
    if (m && !selectedId) selectedId = String(m.id);
    ensureMember(m);

    const container = $("#uie-party-body").empty();
    const content = $(document.getElementById("uie-party-sheet-view").content.cloneNode(true));
    container.append(content);

    // Portrait
    const portraitUrl = m.images.portrait;
    if (portraitUrl) {
        container.find(".sheet-portrait").html(`<img src="${esc(portraitUrl)}" style="width:100%;height:100%;object-fit:cover;">`);
    } else {
        container.find(".sheet-portrait").html(`<i class="fa-solid fa-user" style="font-size:32px; color:#333; position:absolute; top:50%; left:50%; transform:translate(-50%,-50%);"></i>`);
    }

    // Header info
    container.find(".sheet-name").text(m.identity.name);
    container.find(".sheet-details").text(`${m.identity.class || "Adventurer"} â€¢ Lv.${Number(m.progression?.level || 1)} â€¢ ${m.partyRole || "DPS"}`);

    // Member select
    const select = container.find(".party-sheet-member-select");
    select.attr("id", "party-sheet-member");
    members.forEach(x => {
        const opt = $("<option>").val(x.id).text(x.identity?.name || "Member");
        if (String(x.id) === String(m.id)) opt.prop("selected", true);
        select.append(opt);
    });

    // Stats Grid
    const statGrid = container.find(".stats-grid");
    const statTmpl = document.getElementById("uie-party-stat-row").content;
    const stats = [
        { l: "STR", k: "str" }, { l: "DEX", k: "dex" }, { l: "CON", k: "con" }, { l: "INT", k: "int" },
        { l: "WIS", k: "wis" }, { l: "CHA", k: "cha" }, { l: "PER", k: "per" }, { l: "LUK", k: "luk" }
    ];
    stats.forEach(st => {
        const el = $(statTmpl.cloneNode(true));
        el.find(".stat-lbl").text(st.l);
        el.find(".stat-val").text(Number(m.stats[st.k] || 0));
        statGrid.append(el);
    });

    // Vitals
    container.find(".val-hp").text(`${Number(m.vitals?.hp||0)} / ${Number(m.vitals?.maxHp||0)}`);
    container.find(".val-mp").text(`${Number(m.vitals?.mp||0)} / ${Number(m.vitals?.maxMp||0)}`);
    container.find(".val-ap").text(`${Number(m.vitals?.ap||0)} / ${Number(m.vitals?.maxAp||0)}`);
    container.find(".val-xp").text(`${Number(m.progression?.xp||0)} / ${Math.max(1, Number(m.progression?.level||1)) * 1000}`);
    renderSheetTrackers(container, m);

    // Bio & CSS
    container.find(".bio-text").text(m.bio || "â€”");
    container.find(".css-text").text(m.customCSS || "â€”");

    // Events
    container.find(".uie-party-subtab").on("click", function() {
        container.find(".uie-party-subtab").removeClass("active").css({background:"transparent", color:"#aaa"});
        $(this).addClass("active").css({background:"rgba(255,255,255,0.1)", color:"#fff"});
        const sub = $(this).data("sub");
        container.find("#pm-sub-stats, #pm-sub-bio, #pm-sub-css").hide();
        container.find(`#pm-sub-${sub}`).show();
    });

    select.on("change", function() {
        selectedId = $(this).val();
        render();
    });
}

function renderGear(s) {
    const members = s.party.members || [];
    if (!members.length) {
        $("#uie-party-body").html(`<div style="opacity:0.75; text-align:center; padding:30px; border-radius:14px; border:1px dashed rgba(255,255,255,0.18);">Add a party member first.</div>`);
        return;
    }

    const m = selectedId ? getMember(s, selectedId) : members[0];
    if (m && !selectedId) selectedId = String(m.id);
    ensureMember(m);

    const container = $("#uie-party-body").empty();
    const content = $(document.getElementById("uie-party-gear-view").content.cloneNode(true));
    container.append(content);

    // Member Select
    const select = container.find(".party-gear-member-select");
    select.attr("id", "party-gear-member");
    members.forEach(x => {
        const opt = $("<option>").val(x.id).text(x.identity?.name || "Member");
        if (String(x.id) === String(m.id)) opt.prop("selected", true);
        select.append(opt);
    });

    // Slots
    const grid = container.find(".gear-grid");
    const slotTmpl = document.getElementById("uie-party-gear-slot").content;
    const slots = ["head","chest","hands","legs","boots","ring","amulet","weapon","offhand"];

    slots.forEach(slot => {
        const el = $(slotTmpl.cloneNode(true));
        const slotEl = el.find(".party-slot");
        slotEl.attr("data-slot", slot);

        const item = m.equipment?.[slot];
        const iconContainer = el.find(".slot-icon-container");

        if (item?.img) {
            iconContainer.html(`<img src="${esc(item.img)}" style="width:100%;height:100%;object-fit:cover;">`);
        } else {
            iconContainer.html(`<div style="opacity:0.3;font-size:20px;text-transform:uppercase;">${slot[0]}</div>`);
        }

        el.find(".slot-label").text(slot);
        grid.append(el);
    });

    select.on("change", function() {
        selectedId = $(this).val();
        render();
    });
}

function renderInventory(s) {
    const container = $("#uie-party-body").empty();
    const content = $(document.getElementById("uie-party-inventory-view").content.cloneNode(true));
    container.append(content);

    const btn = container.find(".party-inv-add");
    btn.attr("id", "party-inv-add");

    const items = s.party.sharedItems || [];
    const list = container.find(".party-inv-list");

    if (items.length) {
        const itemTmpl = document.getElementById("uie-party-inventory-item").content;
        items.forEach((it, i) => {
            const el = $(itemTmpl.cloneNode(true));
            el.find(".inv-name").text(it.name || "Item");
            el.find(".inv-type").text(it.type || "Misc");
            const delBtn = el.find(".party-inv-del");
            delBtn.attr("data-idx", i);
            list.append(el);
        });
    } else {
        container.find(".party-inv-empty").show();
    }
}

function renderTactics(s) {
    const container = $("#uie-party-body").empty();
    const content = $(document.getElementById("uie-party-tactics-view").content.cloneNode(true));
    container.append(content);

    const members = Array.isArray(s.party.members) ? s.party.members : [];
    const activeMembers = members.filter(m => m && m.active !== false);
    const presets = ["Balanced", "Aggressive", "Defensive", "Support", "Stealth"];
    if (!s.party.partyTactics) s.party.partyTactics = { preset: "Balanced", conserveMana: false, protectLeader: false };
    const pt = s.party.partyTactics;

    // Party Settings
    const presetSel = container.find(".party-tac-preset");
    presetSel.attr("id", "party-tac-preset");
    presets.forEach(p => {
        const opt = $("<option>").val(p).text(p);
        if ((pt.preset||"Balanced") === p) opt.prop("selected", true);
        presetSel.append(opt);
    });

    const conserveCheck = container.find(".party-tac-conserve");
    conserveCheck.attr("id", "party-tac-conserve");
    conserveCheck.prop("checked", pt.conserveMana);

    const protectCheck = container.find(".party-tac-protect-leader");
    protectCheck.attr("id", "party-tac-protect-leader");
    protectCheck.prop("checked", pt.protectLeader);

    // Member Tactics
    const list = container.find(".tactics-list");
    if (activeMembers.length) {
        const rowTmpl = document.getElementById("uie-party-tactics-row").content;

        activeMembers.forEach(m => {
            ensureMember(m);
            const el = $(rowTmpl.cloneNode(true));
            el.find(".tac-name").text(m.identity?.name || "Member");
            el.find(".tac-details").text(`Lv ${Number(m.progression?.level||1)} â€¢ ${m.partyRole||"DPS"}`);

            // Preset
            const mPreset = el.find(".member-tac-preset");
            mPreset.attr("data-id", m.id);
            presets.forEach(p => {
                const opt = $("<option>").val(p).text(p);
                if ((m.tactics?.preset||"Balanced")===p) opt.prop("selected", true);
                mPreset.append(opt);
            });

            // Focus
            const mFocus = el.find(".member-tac-focus");
            mFocus.attr("data-id", m.id);
            const focusOpts = [
                { v: "auto", t: "Auto" },
                { v: "weakest", t: "Weakest" },
                { v: "strongest", t: "Strongest" },
                { v: "protect", t: "Protect" }
            ];
            focusOpts.forEach(o => {
                const opt = $("<option>").val(o.v).text(o.t);
                if ((m.tactics?.focus||"auto")===o.v) opt.prop("selected", true);
                mFocus.append(opt);
            });

            // Protect
            const mProtect = el.find(".member-tac-protect");
            mProtect.attr("data-id", m.id);
            mProtect.append(`<option value="">â€”</option>`);
            // Add member options, disable self
            activeMembers.forEach(am => {
                const opt = $("<option>").val(am.id).text(am.identity?.name || "Member");
                if (String(am.id) === String(m.id)) opt.prop("disabled", true);
                if (String(m.tactics?.protectId) === String(am.id)) opt.prop("selected", true);
                mProtect.append(opt);
            });

            // Conserve MP
            const mMana = el.find(".member-tac-mana");
            mMana.attr("data-id", m.id);
            mMana.prop("checked", m.tactics?.conserveMana);

            list.append(el);
        });
    } else {
        container.find(".tactics-empty").show();
    }
}

function renderFormation(s) {
    const container = $("#uie-party-body").empty();
    const content = $(document.getElementById("uie-party-formation-view").content.cloneNode(true));
    container.append(content);

    const members = Array.isArray(s.party.members) ? s.party.members : [];
    const activeMembers = members.filter(m => m && m.active !== false);
    if (!s.party.formation) s.party.formation = { lanes: { front: [], mid: [], back: [] } };
    if (!s.party.formation.lanes) s.party.formation.lanes = { front: [], mid: [], back: [] };
    const lanes = s.party.formation.lanes;
    const allIds = new Set([...(lanes.front||[]), ...(lanes.mid||[]), ...(lanes.back||[])].map(String));
    const available = activeMembers.filter(m => !allIds.has(String(m.id)));
    const roleOptions = ["Tank","Healer","DPS","Support","Mage","Ranger","Scout","Leader","Bruiser"];

    const lanesContainer = container.find(".formation-lanes");
    const laneTmpl = document.getElementById("uie-party-formation-lane").content;
    const memberTmpl = document.getElementById("uie-party-formation-member").content;

    const laneConfigs = [
        { key: "front", title: "Front Line" },
        { key: "mid", title: "Mid Line" },
        { key: "back", title: "Back Line" }
    ];

    laneConfigs.forEach(cfg => {
        const laneEl = $(laneTmpl.cloneNode(true));
        lanesContainer.append(laneEl);
        laneEl.find(".lane-title").text(cfg.title);

        // Add Select
        const addSel = laneEl.find(".form-add-select");
        addSel.attr("id", `form-add-${cfg.key}`);
        addSel.append(`<option value="">Select memberâ€¦</option>`);
        available.forEach(m => {
            addSel.append($("<option>").val(m.id).text(m.identity?.name || "Member"));
        });

        // Add Button
        const addBtn = laneEl.find(".form-add-btn");
        addBtn.addClass("form-add"); // for event
        addBtn.attr("data-lane", cfg.key);

        const list = laneEl.find(".lane-list");
        const laneIds = lanes[cfg.key] || [];

        if (laneIds.length) {
            laneIds.forEach(id => {
                const m = getMember(s, id);
                if (!m) return;
                ensureMember(m);

                const memEl = $(memberTmpl.cloneNode(true));
                const memDiv = memEl.find(".party-form-member");
                memDiv.attr("data-id", m.id);

                memEl.find(".form-mem-name").text(m.identity?.name || "Member");
                memEl.find(".form-mem-details").text(`Lv ${Number(m.progression?.level||1)} â€¢ ${m.identity?.class||"Adventurer"}`);

                const roleSel = memEl.find(".form-role");
                roleSel.attr("data-id", m.id);
                roleOptions.forEach(r => {
                    const opt = $("<option>").val(r).text(r);
                    if ((m.partyRole||"DPS")===r) opt.prop("selected", true);
                    roleSel.append(opt);
                });

                memEl.find(".form-mv-up").addClass("form-mv").attr("data-act", "up").attr("data-lane", cfg.key).attr("data-id", m.id);
                memEl.find(".form-mv-down").addClass("form-mv").attr("data-act", "down").attr("data-lane", cfg.key).attr("data-id", m.id);
                memEl.find(".form-rm").attr("data-lane", cfg.key).attr("data-id", m.id);

                list.append(memEl);
            });
        } else {
            laneEl.find(".lane-empty").show();
        }
    });
}

function ensurePartyWindowClickable() {
    try {
        const win = document.getElementById("uie-party-window");
        if (!win) return;
        win.style.pointerEvents = "auto";
        win.style.position = "fixed";
        win.style.left = "0px";
        win.style.top = "0px";
        win.style.right = "auto";
        win.style.bottom = "auto";
        win.style.width = "100vw";
        win.style.height = "100vh";
        win.style.maxWidth = "none";
        win.style.maxHeight = "none";
        win.style.borderRadius = "0";
        win.style.transform = "none";
    } catch (_) {}
}

function getMemberModalZIndex() {
    let z = 2147483656;
    try {
        const party = document.getElementById("uie-party-window");
        if (!party) return z;
        const partyZ = Number(window.getComputedStyle(party).zIndex || 0);
        if (Number.isFinite(partyZ) && partyZ > 0) z = Math.max(z, partyZ + 2);
    } catch (_) {}
    return z;
}

function applyMemberModalFullscreenStyles(show = memberModalOpen) {
    try {
        const z = String(getMemberModalZIndex());
        const mm = $("[id='uie-party-member-modal']");
        mm.css({
            display: show ? "block" : "none",
            pointerEvents: show ? "auto" : "none",
            background: "rgba(0,0,0,0.65)",
            position: "fixed",
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
            width: "100vw",
            height: "100vh",
            zIndex: z
        });

        const card = $("[id='uie-party-member-card']");
        if (card && card.length) {
            card.css({
                position: "fixed",
                left: 0,
                top: 0,
                right: 0,
                bottom: 0,
                width: "100vw",
                height: "100vh",
                maxWidth: "none",
                maxHeight: "none",
                borderRadius: 0,
                margin: 0,
                transform: "none"
            });
        }
    } catch (_) {}
}

function render() {
    const s = getSettings();
    ensureParty(s);
    applyMemberModalFullscreenStyles(memberModalOpen);
    ensurePartyWindowClickable();
    if (!s.ui) s.ui = {};
    if (!s.ui.backgrounds) s.ui.backgrounds = {};
    const partyBg = String(s.ui.backgrounds.party || "");
    if (partyBg) {
        $("#uie-party-window").css({
            backgroundImage: `linear-gradient(180deg, rgba(0,0,0,0.92), rgba(0,0,0,0.75)), url("${partyBg}")`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            pointerEvents: "auto",
            position: "fixed"
        });
    } else {
        $("#uie-party-window").css({
            background: "rgba(5,5,8,0.98)",
            backgroundImage: "",
            backgroundSize: "",
            backgroundPosition: "",
            pointerEvents: "auto",
            position: "fixed"
        });
    }

    try { syncPartyUserFromCore(); } catch (_) {}

    // Render Header
    $("#uie-party-name").text(s.party.name || "My Party");
    const leader = s.party.members.find(m => String(m.id) === String(s.party.leaderId));
    $("#uie-party-leader").text(leader ? leader.identity.name : "None");
    $("#uie-party-name-input").val(s.party.name || "");

    // Tabs
    if (tab === "gear") tab = "sheet";
    $(".uie-party-tab").css({background:"rgba(0,0,0,0.95)", color:"#fff", borderColor:"rgba(255,255,255,0.1)", cursor:"pointer", pointerEvents:"auto", touchAction:"manipulation"});
    $(`.uie-party-tab[data-tab="${tab}"]`).css({background:"rgba(241,196,15,0.15)", color:"#f1c40f", borderColor:"rgba(241,196,15,0.3)"});
    $("#uie-party-body").css({ pointerEvents: "auto" });

    if (tab === "roster") renderRoster(s);
    else if (tab === "sheet") renderSheet(s);
    else if (tab === "inventory") renderInventory(s);
    else if (tab === "tactics") renderTactics(s);
    else if (tab === "formation") renderFormation(s);
}

function importUser(s) {
    try {
        const ctx = getContext ? getContext() : {};
        const name = ctx.name1 || "User";
        const m = defaultMember(name);
        m.roles.push("User");
        // Try to find avatar
        m.images.portrait = s.character?.avatar || ""; // s.character might be null
        s.party.members.push(m);
        saveSettings();
        try { injectRpEvent(`[System: ${String(name || "User")} joined the party.]`); } catch (_) {}
        render();
        if(window.toastr) toastr.success(`Imported User: ${name}`);
    } catch(e) { console.error(e); }
}

function importChatChar(s) {
    try {
        const ctx = getContext ? getContext() : {};
        const name = ctx.name2 || "Character";
        const input = prompt("Enter character name to import:", name);
        if (input === null) return;
        const finalName = input.trim() || name;

        const m = defaultMember(finalName);
        m.roles.push("Character");
        s.party.members.push(m);
        saveSettings();
        try { injectRpEvent(`[System: ${String(finalName || "Member")} joined the party.]`); } catch (_) {}
        render();
        if(window.toastr) toastr.success(`Imported Character: ${finalName}`);
    } catch(e) { console.error(e); }
}

async function scanPartyFromChat() {
    const s = getSettings();
    ensureParty(s);

    // Gather Chat Context
    let raw = "";
    $(".chat-msg-txt").slice(-25).each(function() { raw += $(this).text() + "\n"; });
    if (!raw.trim()) {
        notify("warning", "Not enough chat history to scan.", "Party", "scan");
        return;
    }

    const currentMembers = s.party.members.map(m => m.identity.name).join(", ");
    const prompt = SCAN_TEMPLATES.party.roster(currentMembers, raw.slice(0, 3000));

    const res = await generateContent(prompt, "Party Scan");
    if (!res) return;

    let data;
    try { data = JSON.parse(String(res).replace(/```json|```/g, "").trim()); } catch(_) { return; }

    if (!data || typeof data !== "object") return;

    let changes = 0;

    // Handle Leavers
    if (Array.isArray(data.left)) {
        for (const name of data.left) {
            const idx = s.party.members.findIndex(m => m.identity.name.toLowerCase() === name.toLowerCase());
            if (idx !== -1) {
                // We don't delete, just mark inactive or remove? User asked for "leave or join".
                // Safest is to remove from roster if explicitly left.
                // Or just set active=false?
                // Let's remove to keep roster clean as per "people can always leave or join".
                s.party.members.splice(idx, 1);
                changes++;
                notify("info", `${name} left the party.`, "Party", "scan");
            }
        }
    }

    // Handle Joiners / Updates
    if (Array.isArray(data.active)) {
        for (const char of data.active) {
            const name = String(char.name || "").trim();
            if (!name) continue;

            let m = s.party.members.find(x => x.identity.name.toLowerCase() === name.toLowerCase());
            if (!m) {
                // New Member
                m = defaultMember(name);
                m.roles.push("Character");
                s.party.members.push(m);
                changes++;
                notify("success", `${name} joined the party!`, "Party", "scan");
            }

            // Update Info
            if (char.class) m.identity.class = char.class;
            if (char.role) m.partyRole = char.role;
            if (char.level && Number(char.level) > (m.progression.level || 0)) m.progression.level = Number(char.level);

            // Try to auto-link portrait if friend exists
            if (!m.images.portrait) {
                const friend = s.social?.friends?.find(f => f.name.toLowerCase() === name.toLowerCase());
                if (friend && friend.img) m.images.portrait = friend.img;
            }
        }
    }

    if (changes > 0) {
        saveSettings();
        render();
        notify("success", "Party Roster Updated.", "Party", "scan");
        try { injectRpEvent(`[System: Party roster updated via chat scan.]`); } catch (_) {}
    } else {
        notify("info", "No roster changes detected.", "Party", "scan");
    }
}

function resolveMemberModalLayoutTemplate() {
    const ids = isMobileUI()
        ? ["uie-party-modal-layout-mobile", "uie-party-modal-layout-desktop", "uie-party-modal-layout"]
        : ["uie-party-modal-layout-desktop", "uie-party-modal-layout-mobile", "uie-party-modal-layout"];
    for (const id of ids) {
        const el = document.getElementById(id);
        if (el && el.content) return el;
    }
    return null;
}

function renderMemberModal(s, m) {
    ensureMember(m);
    $("#uie-party-member-title").text(`${m.identity?.name || "Member"}`);
    try {
        const bg = String(s?.ui?.backgrounds?.partyMember || "");
        const card = document.getElementById("uie-party-member-card");
        if (card) {
            if (bg) {
                card.style.backgroundImage = `linear-gradient(180deg, rgba(0,0,0,0.95), rgba(0,0,0,0.55)), url("${bg}")`;
                card.style.backgroundSize = "cover";
                card.style.backgroundPosition = "center";
            } else {
                card.style.backgroundImage = "";
                card.style.backgroundSize = "";
                card.style.backgroundPosition = "";
            }
        }
    } catch (_) {}

    const container = $("#uie-party-member-content").empty().css({ minHeight: "200px", overflow: "auto" });
    const layoutTmpl = resolveMemberModalLayoutTemplate();
    if (!layoutTmpl || !layoutTmpl.content) {
        container.html(`<div style="padding:20px;color:#fff;">Member: ${esc(m.identity?.name || "Unknown")}</div>`);
        return;
    }
    const layout = $(layoutTmpl.content.cloneNode(true));
    container.append(layout);

    // Active Tab
    container.find(".party-mm-tab").css({ pointerEvents: "auto", touchAction: "manipulation" });
    container.find(`.party-mm-tab[data-tab="${memberModalTab}"]`)
        .css({background: "rgba(241,196,15,0.18)", color: "#f1c40f"});

    container.find(`#party-mm-pane-${memberModalTab}`).show();

    // --- SHEET PANE ---
    const sheetPane = container.find("#party-mm-pane-sheet");
    const sheetTmplEl = document.getElementById("uie-party-modal-sheet-pane");
    if (sheetTmplEl && sheetTmplEl.content) {
        sheetPane.append(sheetTmplEl.content.cloneNode(true));
    }

    // Portrait
    const portrait = resolvePortraitUrl(s, m);
    const pContainer = sheetPane.find(".sheet-portrait-container");
    if (portrait) {
        pContainer.html(`<img src="${esc(portrait)}" style="width:100%;height:100%;object-fit:cover;">`);
    } else {
        pContainer.html(`<div style="width:100%;height:100%;display:grid;place-items:center;opacity:0.55;font-weight:900;">Portrait</div>`);
    }

    // Inputs
    const dis = memberEdit ? false : true;
    const pe = memberEdit ? {} : { "pointer-events": "none", "opacity": "0.85" };

    sheetPane.find("#party-mm-name").val(m.identity?.name || "").prop("disabled", dis).css(pe);
    sheetPane.find("#party-mm-class").val(m.identity?.class || "").prop("disabled", dis).css(pe);
    sheetPane.find("#party-mm-level").val(Number(m.progression?.level || 1)).prop("disabled", dis).css(pe);

    const roleSel = sheetPane.find("#party-mm-role");
    ["Tank","Healer","DPS","Support","Mage","Ranger","Scout","Leader","Bruiser"].forEach(r => {
        const opt = $("<option>").val(r).text(r);
        if ((m.partyRole||"DPS")===r) opt.prop("selected", true);
        roleSel.append(opt);
    });
    roleSel.prop("disabled", dis).css(pe);

    // Bars
    const barTmplEl = document.getElementById("uie-party-modal-bar");
    const barTmpl = barTmplEl && barTmplEl.content ? barTmplEl.content : null;
    const vitalsSection = sheetPane.find(".vitals-section");
    const bars = [
        { l: "HP", c: m.vitals?.hp, m: m.vitals?.maxHp, col: "#e74c3c", k: "hp" },
        { l: "MP", c: m.vitals?.mp, m: m.vitals?.maxMp, col: "#3498db", k: "mp" },
        { l: "AP", c: m.vitals?.ap, m: m.vitals?.maxAp, col: "#f1c40f", k: "ap" },
        { l: "XP", c: m.progression?.xp, m: (m.progression?.level||1)*1000, col: "#2ecc71", k: "xp" }
    ];
    bars.forEach(b => {
        if (!barTmpl) return;
        const el = $(barTmpl.cloneNode(true));
        el.find(".bar-lbl").text(b.l);
        const cur = Number(b.c||0);
        const max = Math.max(1, Number(b.m||0));
        const pct = Math.max(0, Math.min(100, (cur/max)*100));
        el.find(".bar-fill").css({ width: `${pct}%`, background: b.col });
        el.find(".bar-text").text(`${cur}/${max}`);

        vitalsSection.append(el);
    });

    renderSheetTrackers(sheetPane, m);
    sheetPane.find("#party-mm-track-add").show();

    // Status FX
    const fxList = sheetPane.find(".status-fx-list");
    const fx = Array.isArray(m.statusEffects) ? m.statusEffects : [];
    if (fx.length === 0) fxList.html(`<div style="opacity:0.6; font-weight:900;">None</div>`);
    else {
        fx.slice(0, 16).forEach(x => {
            const raw = String(x||"").trim();
            const label = raw ? raw[0].toUpperCase() : "!";
            const icon = $(`<div class="party-fx" title="${esc(raw)}" style="width:28px;height:28px;border-radius:10px;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.95);display:grid;place-items:center;font-weight:900;color:rgba(255,255,255,0.9);user-select:none;">${esc(label)}</div>`);
            fxList.append(icon);
        });
    }

    if (memberEdit) {
        sheetPane.find("#party-mm-fx").val(fx.join(", ")).show();
        sheetPane.find("#party-mm-save").show();
    }

    // Stats
    const statsGrid = sheetPane.find(".stats-grid");
    const statInputTmpl = document.getElementById("uie-party-modal-stat-input").content;
    const statKeys = ["str","dex","con","int","wis","cha","per","luk"];
    statKeys.forEach(k => {
        const el = $(statInputTmpl.cloneNode(true));
        el.find(".stat-lbl").text(k.toUpperCase());
        const input = el.find(".stat-val");
        input.val(Number(m.stats?.[k] || 0));
        input.attr("data-stat", k); // for save handler
        input.prop("disabled", dis).css(pe);
        statsGrid.append(el);
    });

    // --- EQUIP PANE ---
    const equipPane = container.find("#party-mm-pane-equip");
    const equipTmpl = document.getElementById("uie-party-modal-equip-pane").content.cloneNode(true);
    equipPane.append(equipTmpl);

    const pdPick = equipPane.find("#party-paperdoll-pick");
    pdPick.css("cursor", memberEdit ? "pointer" : "default");
    if (m.images.paperDoll) {
        pdPick.addClass("has-image");
        pdPick.html(`<img class="party-paperdoll-img" src="${esc(m.images.paperDoll)}" alt="Paper Doll">`);
    } else {
        pdPick.removeClass("has-image");
        pdPick.html(`<div class="party-paperdoll-empty">Paper Doll</div>`);
    }

    const equipRows = equipPane.find(".equip-rows");
    const eqRowTmpl = document.getElementById("uie-party-modal-equip-row").content;
    const slotLabel = {
        head: "Head", chest: "Chest", legs: "Legs", feet: "Feet", hands: "Hands",
        weapon: "Main Hand", offhand: "Off Hand", accessory1: "Accessory 1", accessory2: "Accessory 2"
    };
    ["head","chest","legs","feet","hands","weapon","offhand","accessory1","accessory2"].forEach(k => {
        const el = $(eqRowTmpl.cloneNode(true));
        el.find(".eq-lbl").text(slotLabel[k] || k);
        const input = el.find(".eq-val");
        input.val(m.equipment?.[k] || "");
        input.attr("data-eq", k); // for save handler
        input.prop("disabled", dis).css(pe);
        equipRows.append(el);
    });

    if (memberEdit) equipPane.find(".party-mm-save-btn").show();

    // --- SKILLS PANE ---
    const skillsPane = container.find("#party-mm-pane-skills");
    const skillsTmpl = document.getElementById("uie-party-modal-skills-pane").content.cloneNode(true);
    skillsPane.append(skillsTmpl);

    // Rebirth
    if (m.progression.level >= 150 || m.progression.reborn || memberEdit) {
        const rbSec = skillsPane.find(".rebirth-section");
        rbSec.show();
        rbSec.find("#party-mm-reborn").prop("checked", m.progression.reborn).prop("disabled", dis);
        const medSel = rbSec.find("#party-mm-medallion");
        medSel.prop("disabled", dis);
        Object.values(MEDALLIONS).forEach(md => {
            const opt = $("<option>").val(md.id).text(md.name);
            if (m.progression.activeMedallion === md.id) opt.prop("selected", true);
            medSel.append(opt);
        });
    }

    if (memberEdit) skillsPane.find("#party-mm-add-skill").show();

    const skillsList = skillsPane.find(".skills-list");
    if (memberEdit) {
        // Edit Mode: Rows
        const editRowTmpl = document.getElementById("uie-party-modal-skill-edit-row").content;
        const skillData = Array.isArray(m.skills) ? m.skills : [];
        if (skillData.length === 0) {
            skillsList.html(`<div style="opacity:0.7; font-weight:900; padding:10px; border:1px dashed rgba(255,255,255,0.18); border-radius:14px;">No skills yet.</div>`);
        } else {
            skillData.forEach((sk, idx) => {
                const el = $(editRowTmpl.cloneNode(true));
                el.find(".skill-name-in").val(sk.name || "").attr("data-skill-name", idx);
                el.find(".skill-desc-in").val(sk.description || "").attr("data-skill-desc", idx);
                const typeSel = el.find(".skill-type-in").attr("data-skill-type", idx);
                typeSel.val((sk.skillType||"active") === "passive" ? "passive" : "active");
                el.find(".party-mm-skill-del").attr("data-skill-del", idx);
                skillsList.append(el);
            });
        }
        skillsPane.find(".skills-save-container").show();
    } else {
        // View Mode: Items
        const viewRowTmpl = document.getElementById("uie-party-modal-skill-view-row").content;
        const resolvedSkills = resolveMemberSkills(s, m);
        if (resolvedSkills.length === 0) {
            skillsList.html(`<div style="opacity:0.6; font-weight:900;">No skills</div>`);
        } else {
            resolvedSkills.forEach(sk => {
                const el = $(viewRowTmpl.cloneNode(true));
                const src = sk.source === "Inventory" ? "INV" : "PTY";
                const color = sk.source === "Inventory" ? "rgba(52,152,219,0.85)" : "rgba(241,196,15,0.85)";
                el.find(".skill-src").text(src).css("color", color);
                el.find(".skill-name").text(sk.name);
                el.find(".skill-desc").text(sk.desc || "");

                const skillDiv = el.find(".party-skill");
                skillDiv.attr("data-name", sk.name);
                skillDiv.attr("data-desc", sk.desc || "");

                skillsList.append(el);
            });
        }
    }
}

function openMemberModal(s, id, edit = false) {
    const m = getMember(s, id);
    if (!m) return;
    ensureMember(m);
    selectedId = String(m.id);
    memberModalOpen = true;
    memberModalOpenedAt = Date.now();
    ignoreNextBackdropClick = true;
    memberEdit = edit === true;
    const modalEls = Array.from(document.querySelectorAll("[id='uie-party-member-modal']"));
    if (!modalEls.length) return;
    const modal = modalEls[0];
    if (modalEls.length > 1) {
        for (let i = 1; i < modalEls.length; i++) {
            try { modalEls[i].remove(); } catch (_) {}
        }
    }
    if (modal.parentElement !== document.body) {
        document.body.appendChild(modal);
    }
    applyMemberModalFullscreenStyles(true);
    renderMemberModal(s, m);
}

function closeMemberModal() {
    memberModalOpen = false;
    ignoreNextBackdropClick = false;
    memberEdit = false;
    closeMemberTrackerModal();
    applyMemberModalFullscreenStyles(false);
}

export function refreshParty() {
    if (!partyInit) {
        initParty();
        return;
    }
    render();
}

async function pickPortraitForMember(s, m, kind) {
    const img = await pickLocalImage();
    if (!img) return;
    if (kind === "paperDoll") m.images.paperDoll = img;
    else m.images.portrait = img;
    saveSettings();
    renderMemberModal(s, m);
}

export function initParty() {
    if (partyInit) {
        render();
        return;
    }
    partyInit = true;
    const s = getSettings();
    ensureParty(s);

    ensurePartyWindowClickable();

    const $win = $("#uie-party-window");
    const $modal = $("#uie-party-member-modal");
    const $body = $("body");

    $(document).off("click.party change.party pointerup.party");
    $win.off("click.party change.party pointerup.party");
    $modal.off("click.party change.party pointerup.party");
    $body.off("click.party pointerup.party", "[id='uie-party-member-modal'] [id='uie-party-member-close']");
    $body.off("click.party pointerup.party", "[id='uie-party-member-modal']");

    let lastTouchOpenAt = 0;
    let lastTouchTabAt = 0;

    const shouldHandleTouchPointer = (e) => {
        if (e?.type !== "pointerup") return true;
        const pt = String(e.pointerType || "").toLowerCase();
        return !pt || pt === "touch" || pt === "pen";
    };

    $(document).on("click.party pointerup.party", "#uie-party-window .uie-party-tab", function(e) {
        if (!shouldHandleTouchPointer(e)) return;
        if (e.type === "pointerup") {
            lastTouchTabAt = Date.now();
            e.preventDefault();
            e.stopPropagation();
        } else {
            const t = Number(lastTouchTabAt || 0);
            if (t && Date.now() - t < 650) return;
        }
        tab = $(this).data("tab");
        render();
    });

    $(document).on("click.party pointerup.party", "#uie-party-member-modal .party-mm-tab", function (e) {
        if (!shouldHandleTouchPointer(e)) return;
        if (e.type === "pointerup") {
            lastTouchTabAt = Date.now();
            e.preventDefault();
            e.stopPropagation();
        } else {
            const t = Number(lastTouchTabAt || 0);
            if (t && Date.now() - t < 650) return;
            e.preventDefault();
            e.stopPropagation();
        }
        memberModalTab = String($(this).data("tab") || "sheet");
        const s2 = getSettings();
        const m = selectedId ? getMember(s2, selectedId) : null;
        if (m) renderMemberModal(s2, m);
    });

    $(document).on("click.party", "#uie-party-window #party-add", function() {
        const s = getSettings();
        s.party.members.push(defaultMember("New Member"));
        saveSettings();
        render();
    });

    $(document).on("click.party", "#uie-party-window #party-track-add, #uie-party-member-modal #party-mm-track-add", function(e) {
        e.preventDefault();
        e.stopPropagation();
        const s2 = getSettings();
        const m = getSelectedTrackerMember(s2);
        if (!m) return;
        openMemberTrackerModal(m);
    });

    $(document).on("click.party", "#uie-party-window .party-track-btn, #uie-party-member-modal .party-track-btn", function(e) {
        e.preventDefault();
        e.stopPropagation();
        const card = $(this).closest(".party-tracker-card");
        if (!card.length) return;
        const act = String($(this).attr("data-act") || "").trim();
        const delta = act === "minus" ? -1 : act === "plus" ? 1 : 0;
        if (!delta) return;

        const s2 = getSettings();
        ensureParty(s2);
        const m = selectedId ? getMember(s2, selectedId) : null;
        if (!m) return;
        ensureMember(m);

        const rowMeta = {
            kind: String(card.attr("data-track-kind") || ""),
            key: String(card.attr("data-track-key") || ""),
            id: String(card.attr("data-track-id") || ""),
        };
        const changed = applyTrackerDelta(m, rowMeta, delta);
        if (!changed) return;

        const isUser = isUserMember(s2, m);
        if (isUser) {
            applyMemberToCore(s2, m);
            try { $(document).trigger("uie:updateVitals"); } catch (_) {}
        }

        saveSettings();
        render();
        if (memberModalOpen) {
            try { renderMemberModal(s2, m); } catch (_) {}
        }
    });

    $(document).on("click.party", "#uie-party-window .party-track-edit, #uie-party-member-modal .party-track-edit", function(e) {
        e.preventDefault();
        e.stopPropagation();
        const card = $(this).closest(".party-tracker-card");
        if (!card.length) return;

        const id = String(card.attr("data-track-id") || "").trim();
        if (!id) return;

        const s2 = getSettings();
        const m = getSelectedTrackerMember(s2);
        if (!m) return;
        openMemberTrackerModal(m, id);
    });

    $(document).on("click.party", "#party-track-modal-close, #party-track-modal-cancel", function(e) {
        e.preventDefault();
        e.stopPropagation();
        closeMemberTrackerModal();
    });

    $(document).on("click.party", "#party-track-modal-save", function(e) {
        e.preventDefault();
        e.stopPropagation();
        saveMemberTrackerModal();
    });

    $(document).on("click.party", "#party-track-modal-delete", function(e) {
        e.preventDefault();
        e.stopPropagation();
        deleteMemberTrackerFromModal();
    });

    $(document).on("click.party", "#uie-party-tracker-modal", function(e) {
        e.stopPropagation();
        if ($(e.target).closest("#party-track-modal-box").length) return;
        closeMemberTrackerModal();
    });

    $(document).on("click.party", "#uie-party-window .party-track-del, #uie-party-member-modal .party-track-del", function(e) {
        e.preventDefault();
        e.stopPropagation();
        const card = $(this).closest(".party-tracker-card");
        if (!card.length) return;
        const id = String(card.attr("data-track-id") || "").trim();
        if (!id) return;

        const s2 = getSettings();
        ensureParty(s2);
        const m = selectedId ? getMember(s2, selectedId) : null;
        if (!m) return;
        ensureMember(m);

        const idx = m.trackers.findIndex((x) => String(x?.id || "").trim() === id);
        if (idx < 0) return;
        if (!window.confirm("Delete this tracker?")) return;
        m.trackers.splice(idx, 1);
        saveSettings();
        render();
        if (memberModalOpen) {
            try { renderMemberModal(s2, m); } catch (_) {}
        }
    });

    $(document).on("click.party", "#uie-party-window #party-import-user", function() {
        importUser(getSettings());
    });

    $(document).on("click.party", "#uie-party-window #party-import-char", function() {
        importChatChar(getSettings());
    });

    $(document).on("click.party", "#uie-party-window #party-scan-chat", async function(e) {
        e.preventDefault();
        e.stopPropagation();
        await scanPartyFromChat();
    });

    $(document).on("click.party", "#uie-party-window #uie-party-export", function(e) {
        e.preventDefault();
        e.stopPropagation();
        const s2 = getSettings();
        ensureParty(s2);
        downloadJsonFile(`uie_party_${new Date().toISOString().slice(0, 10)}.json`, s2.party);
        try { window.toastr?.success?.("Party exported."); } catch (_) {}
    });

    $(document).on("click.party", "#uie-party-window #uie-party-import", async function(e) {
        e.preventDefault();
        e.stopPropagation();
        const txt = await pickJsonFile();
        if (!txt) return;
        let obj = null;
        try {
            const cleaned = String(txt || "").replace(/^\uFEFF/, "").trim();
            obj = JSON.parse(cleaned);
        } catch (_) {
            obj = null;
        }
        const incoming = obj && typeof obj === "object" ? (obj.party && typeof obj.party === "object" ? obj.party : obj) : null;
        if (!incoming || typeof incoming !== "object") {
            try { window.toastr?.error?.("Invalid party file."); } catch (_) {}
            return;
        }
        const s2 = getSettings();
        s2.party = { ...incoming };
        ensureParty(s2);
        if (!Array.isArray(s2.party.members)) s2.party.members = [];
        for (const m of s2.party.members) ensureMember(m);
        saveSettings();
        render();
        try { window.toastr?.success?.("Party imported."); } catch (_) {}
    });

    $(document).on("click.party", "#uie-party-window #uie-party-save-meta", function() {
        const s = getSettings();
        s.party.name = $("#uie-party-name-input").val();
        saveSettings();
        render();
        if(window.toastr) toastr.success("Party info saved.");
    });

    $(document).on("click.party", "#uie-party-window #party-inv-add", function(e) {
        e.preventDefault();
        e.stopPropagation();
        const s2 = getSettings();
        ensureParty(s2);
        const name = String(window.prompt("Item name:", "") || "").trim();
        if (!name) return;
        const type = String(window.prompt("Item type:", "misc") || "misc").trim() || "misc";
        const qtyIn = Number(window.prompt("Quantity:", "1"));
        const qty = Number.isFinite(qtyIn) && qtyIn > 0 ? Math.floor(qtyIn) : 1;
        s2.party.sharedItems.push({ name, type, qty });
        saveSettings();
        render();
    });

    $(document).on("click.party", "#uie-party-window .party-inv-del", function(e) {
        e.preventDefault();
        e.stopPropagation();
        const idx = Number($(this).attr("data-idx"));
        if (!Number.isFinite(idx)) return;
        const s2 = getSettings();
        ensureParty(s2);
        if (!Array.isArray(s2.party.sharedItems)) s2.party.sharedItems = [];
        if (idx < 0 || idx >= s2.party.sharedItems.length) return;
        s2.party.sharedItems.splice(idx, 1);
        saveSettings();
        render();
    });

    $(document).on("click.party", "#uie-party-window .party-slot", function(e) {
        e.preventDefault();
        e.stopPropagation();
        const slot = String($(this).attr("data-slot") || "").trim();
        if (!slot) return;
        const s2 = getSettings();
        ensureParty(s2);
        const memberId = String($("#party-gear-member").val() || selectedId || "");
        const m = memberId ? getMember(s2, memberId) : null;
        if (!m) return;
        ensureMember(m);
        const shared = Array.isArray(s2.party.sharedItems) ? s2.party.sharedItems : [];
        const names = shared.map((it, i) => `${i + 1}. ${String(it?.name || "Item")} (${String(it?.type || "misc")})`);
        const msg = `Equip slot: ${slot}\n0. Unequip\n${names.join("\n")}\n\nEnter number:`;
        const pick = Number(window.prompt(msg, "0"));
        if (!Number.isFinite(pick)) return;
        if (pick <= 0) {
            if (m.equipment && m.equipment[slot]) delete m.equipment[slot];
            saveSettings();
            render();
            return;
        }
        const chosen = shared[pick - 1];
        if (!chosen) return;
        m.equipment[slot] = {
            name: String(chosen.name || "Item"),
            type: String(chosen.type || "misc"),
            img: String(chosen.img || "")
        };
        saveSettings();
        render();
    });

    $(document).on("click.party", "#uie-party-window #uie-party-bg-edit", async function (e) {
        e.preventDefault();
        e.stopPropagation();
        const s2 = getSettings();
        if (!s2.ui) s2.ui = {};
        if (!s2.ui.backgrounds) s2.ui.backgrounds = {};
        const img = await pickLocalImage();
        if (!img) return;
        s2.ui.backgrounds.party = img;
        saveSettings();
        render();
    });

    $(document).on("click.party", "#uie-party-member-modal #uie-party-member-bg-edit", async function (e) {
        e.preventDefault();
        e.stopPropagation();
        const s2 = getSettings();
        if (!s2.ui) s2.ui = {};
        if (!s2.ui.backgrounds) s2.ui.backgrounds = {};
        const img = await pickLocalImage();
        if (!img) return;
        s2.ui.backgrounds.partyMember = img;
        saveSettings();
        const card = document.getElementById("uie-party-member-card");
        if (card) {
            card.style.backgroundImage = `linear-gradient(180deg, rgba(0,0,0,0.95), rgba(0,0,0,0.55)), url("${img}")`;
            card.style.backgroundSize = "cover";
            card.style.backgroundPosition = "center";
        }
    });

    $(document).on("click.party pointerup.party", "#uie-party-window .party-row", function(e) {
        if (e.type === "pointerup") {
            const pt = String(e.pointerType || "").toLowerCase();
            if (pt && pt !== "touch" && pt !== "pen") return;
        }
        if ($(e.target).closest("button").length) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.type === "pointerup") {
            lastTouchOpenAt = Date.now();
        } else {
            const t = Number(lastTouchOpenAt || 0);
            if (t && Date.now() - t < 650) return;
        }
        const id = String($(this).data("id"));
        setTimeout(() => openMemberModal(getSettings(), id), 0);
    });

    $(document).on("click.party pointerup.party", "#uie-party-window .party-form-member", function(e) {
        if (e.type === "pointerup") {
            const pt = String(e.pointerType || "").toLowerCase();
            if (pt && pt !== "touch" && pt !== "pen") return;
        }
        if ($(e.target).closest("button, select, option").length) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.type === "pointerup") {
            lastTouchOpenAt = Date.now();
        } else {
            const t = Number(lastTouchOpenAt || 0);
            if (t && Date.now() - t < 650) return;
        }
        const id = String($(this).data("id"));
        setTimeout(() => openMemberModal(getSettings(), id), 0);
    });

    $body.on("click.party pointerup.party", "[id='uie-party-member-modal'] [id='uie-party-member-close']", function(e){
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        closeMemberModal();
    });

    $body.on("click.party pointerup.party", "[id='uie-party-member-modal']", function(e){
        e.stopPropagation();
        e.stopImmediatePropagation();
        if ($(e.target).closest("[id='uie-party-member-card']").length) return;
        if ($(e.target).closest("[id='uie-party-member-close']").length) {
            closeMemberModal();
            return;
        }
        const now = Date.now();
        const openedAgo = now - Number(memberModalOpenedAt || 0);
        if (ignoreNextBackdropClick || openedAgo < 220) {
            ignoreNextBackdropClick = false;
            return;
        }
        closeMemberModal();
    });

    $(document).on("click.party", "#uie-party-member-modal #party-paperdoll-pick", async function(e){
        e.preventDefault();
        e.stopPropagation();
        const s2 = getSettings();
        const m = selectedId ? getMember(s2, selectedId) : null;
        if (!m) return;
        await pickPortraitForMember(s2, m, "paperDoll");
    });

    $(document).on("click.party", "#uie-party-member-modal #party-mm-add-skill", function (e) {
        e.preventDefault();
        e.stopPropagation();
        const s2 = getSettings();
        const m = selectedId ? getMember(s2, selectedId) : null;
        if (!m) return;
        ensureMember(m);
        m.skills.push({ name: "", description: "", skillType: "active" });
        saveSettings();
        renderMemberModal(s2, m);
    });

    $(document).on("click.party", "#uie-party-member-modal .party-mm-skill-del", function (e) {
        e.preventDefault();
        e.stopPropagation();
        const idx = Number($(this).data("skill-del"));
        if (!Number.isFinite(idx)) return;
        const s2 = getSettings();
        const m = selectedId ? getMember(s2, selectedId) : null;
        if (!m) return;
        ensureMember(m);
        const removed = m.skills[idx];
        m.skills.splice(idx, 1);
        saveSettings();
        renderMemberModal(s2, m);
        try { injectRpEvent(`[System: Removed skill '${removed?.name || "Unknown"}' from ${m.identity.name}.]`); } catch (_) {}
    });

    $(document).on("click.party", "#uie-party-member-modal #party-mm-save", function(e){
        e.preventDefault();
        e.stopPropagation();
        const s2 = getSettings();
        const m = selectedId ? getMember(s2, selectedId) : null;
        if (!m) return;
        ensureMember(m);

        m.identity.name = String($("#party-mm-name").val() || "").trim() || m.identity.name;
        m.identity.class = String($("#party-mm-class").val() || "").trim();
        m.partyRole = String($("#party-mm-role").val() || m.partyRole || "DPS");
        if (!m.progression) m.progression = { level: 1, xp: 0, skillPoints: 0, perkPoints: 0 };
        m.progression.level = Number($("#party-mm-level").val() || m.progression.level || 1);

        $("#uie-party-member-content [data-stat]").each(function(){
            const k = String($(this).data("stat") || "");
            if (!k) return;
            m.stats[k] = Number($(this).val() || m.stats[k] || 0);
        });
        $("#uie-party-member-content [data-vital]").each(function(){
            const k = String($(this).data("vital") || "");
            if (!k) return;
            m.vitals[k] = Number($(this).val() || m.vitals[k] || 0);
        });
        $("#uie-party-member-content [data-eq]").each(function(){
            const k = String($(this).data("eq") || "");
            if (!k) return;
            const v = String($(this).val() || "").trim();
            if (!m.equipment) m.equipment = {};
            if (v) m.equipment[k] = v;
            else delete m.equipment[k];
        });

        const skillInputs = $("#uie-party-member-content [data-skill-name]");
        if (skillInputs.length) {
            const out = [];
            skillInputs.each(function () {
                const idx = Number($(this).attr("data-skill-name"));
                if (!Number.isFinite(idx)) return;
                const name = String($(this).val() || "").trim();
                const desc = String($(`#uie-party-member-content [data-skill-desc="${idx}"]`).val() || "").trim();
                const type = String($(`#uie-party-member-content [data-skill-type="${idx}"]`).val() || "active").toLowerCase();
                if (!name) return;
                out.push({ name: name.slice(0, 80), description: desc.slice(0, 1200), skillType: (type === "passive" ? "passive" : "active") });
            });
            m.skills = out;
        } else {
            const sk = String($("#party-mm-skills").val() || "");
            m.skills = sk.split("\n").map(x => x.trim()).filter(Boolean);
        }
        const fx = String($("#party-mm-fx").val() || "");
        m.statusEffects = fx.split(",").map(x => x.trim()).filter(Boolean).slice(0, 30);

        saveSettings();
        render();
        renderMemberModal(s2, m);
    });

    $(document).on("click.party", "#uie-party-member-modal .party-fx", function (e) {
        e.preventDefault();
        e.stopPropagation();
        const txt = String(this.getAttribute("title") || "").trim();
        if (!txt) return;
        let box = document.getElementById("uie-party-fx-pop");
        const popZ = String(getMemberModalZIndex() + 2);
        if (!box) {
            box = document.createElement("div");
            box.id = "uie-party-fx-pop";
            box.style.cssText = `position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:${popZ};max-width:min(380px,92vw);padding:12px 14px;border-radius:16px;border:1px solid rgba(255,255,255,0.12);background:rgba(15,10,8,0.96);color:#fff;font-weight:900;`;
            document.body.appendChild(box);
            box.addEventListener("click", () => { try { box.remove(); } catch (_) {} });
        }
        box.style.zIndex = popZ;
        box.textContent = txt;
    });

    $(document).on("click.party", "#uie-party-member-modal .party-skill", function (e) {
        e.preventDefault();
        e.stopPropagation();
        const name = String(this.getAttribute("data-name") || "").trim();
        const desc = String(this.getAttribute("data-desc") || "").trim();
        const txt = desc ? `${name}\n\n${desc}` : name;
        if (!txt.trim()) return;
        let box = document.getElementById("uie-party-skill-pop");
        const popZ = String(getMemberModalZIndex() + 2);
        if (!box) {
            box = document.createElement("div");
            box.id = "uie-party-skill-pop";
            box.style.cssText = `position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:${popZ};max-width:min(420px,92vw);max-height:min(60vh,520px);overflow:auto;white-space:pre-wrap;padding:12px 14px;border-radius:16px;border:1px solid rgba(255,255,255,0.12);background:rgba(15,10,8,0.96);color:#fff;font-weight:900;`;
            document.body.appendChild(box);
            box.addEventListener("click", () => { try { box.remove(); } catch (_) {} });
        }
        box.style.zIndex = popZ;
        box.textContent = txt;
    });

    $(document).on("click.party", "#uie-party-window .party-mini", function(e) {
        e.stopPropagation();
        const act = $(this).data("act");
        const id = String($(this).data("id"));
        const s = getSettings();
        const idx = s.party.members.findIndex(m => String(m.id) === id);
        if (idx === -1) return;

        if (act === "edit") {
            openMemberModal(getSettings(), id, true);
        } else if (act === "delete") {
            if (confirm("Remove this member?")) {
                const leavingName = String(s.party?.members?.[idx]?.identity?.name || s.party?.members?.[idx]?.name || "Member");
                if (selectedId === id) {
                    try { closeMemberModal(); } catch (_) {}
                    selectedId = null;
                }
                if (s.party.leaderId === id) s.party.leaderId = null;
                try {
                    const lanes = s.party?.formation?.lanes || null;
                    if (lanes && typeof lanes === "object") {
                        for (const key of ["front", "mid", "back"]) {
                            if (!Array.isArray(lanes[key])) lanes[key] = [];
                            lanes[key] = lanes[key].filter(x => String(x || "") !== id);
                        }
                    }
                } catch (_) {}
                try {
                    const members = Array.isArray(s.party?.members) ? s.party.members : [];
                    for (const m of members) {
                        if (!m || typeof m !== "object") continue;
                        if (m?.tactics?.protectId && String(m.tactics.protectId) === id) m.tactics.protectId = "";
                    }
                } catch (_) {}
                try {
                    if (s.party?.partyTactics?.protectId && String(s.party.partyTactics.protectId) === id) s.party.partyTactics.protectId = "";
                } catch (_) {}
                try {
                    const rel = s.party?.relationships;
                    if (rel && typeof rel === "object") {
                        delete rel[id];
                        for (const [k, v] of Object.entries(rel)) {
                            if (!v || typeof v !== "object") continue;
                            if (v[id] !== undefined) delete v[id];
                        }
                    }
                } catch (_) {}
                s.party.members.splice(idx, 1);
                try { injectRpEvent(`[System: ${leavingName} left the party.]`); } catch (_) {}
                if (!selectedId) {
                    const next = s.party.members.find(m => m && m.active !== false);
                    selectedId = next ? String(next.id || "") : null;
                }
                saveSettings();
                render();
            }
        } else if (act === "leader") {
            s.party.leaderId = id;
            saveSettings();
            render();
        } else if (act === "toggleActive") {
            s.party.members[idx].active = s.party.members[idx].active === false;
            saveSettings();
            render();
        }
    });

    $(document).on("change.party", "#uie-party-window #party-tac-preset, #uie-party-window #party-tac-conserve, #uie-party-window #party-tac-protect-leader", function(e){
        e.preventDefault();
        const s2 = getSettings();
        ensureParty(s2);
        if (!s2.party.partyTactics) s2.party.partyTactics = { preset: "Balanced", conserveMana: false, protectLeader: false };
        s2.party.partyTactics.preset = String($("#party-tac-preset").val() || "Balanced");
        s2.party.partyTactics.conserveMana = !!$("#party-tac-conserve").prop("checked");
        s2.party.partyTactics.protectLeader = !!$("#party-tac-protect-leader").prop("checked");
        saveSettings();
    });

    $(document).on("change.party", "#uie-party-window .member-tac-preset, #uie-party-window .member-tac-focus, #uie-party-window .member-tac-protect, #uie-party-window .member-tac-mana", function(e){
        e.preventDefault();
        const id = String($(this).data("id") || "");
        if (!id) return;
        const s2 = getSettings();
        ensureParty(s2);
        const m = getMember(s2, id);
        if (!m) return;
        ensureMember(m);
        const preset = String($(`.member-tac-preset[data-id="${id}"]`).val() || m.tactics?.preset || "Balanced");
        const focus = String($(`.member-tac-focus[data-id="${id}"]`).val() || m.tactics?.focus || "auto");
        const protectId = String($(`.member-tac-protect[data-id="${id}"]`).val() || m.tactics?.protectId || "");
        const conserveMana = !!$(`.member-tac-mana[data-id="${id}"]`).prop("checked");
        m.tactics = { ...(m.tactics || {}), preset, focus, protectId, conserveMana };
        saveSettings();
    });

    $(document).on("click.party", "#uie-party-window .form-add", function(e){
        e.preventDefault();
        e.stopPropagation();
        const lane = String($(this).data("lane") || "");
        const s2 = getSettings();
        ensureParty(s2);
        if (!s2.party.formation) s2.party.formation = { lanes: { front: [], mid: [], back: [] } };
        if (!s2.party.formation.lanes) s2.party.formation.lanes = { front: [], mid: [], back: [] };
        const id = String($(`#form-add-${lane}`).val() || "");
        if (!id) return;
        const lanes = s2.party.formation.lanes;
        for (const k of ["front","mid","back"]) lanes[k] = (lanes[k] || []).filter(x => String(x) !== id);
        if (!Array.isArray(lanes[lane])) lanes[lane] = [];
        lanes[lane].push(id);
        saveSettings();
        render();
    });

    $(document).on("click.party", "#uie-party-window .form-rm", function(e){
        e.preventDefault();
        e.stopPropagation();
        const lane = String($(this).data("lane") || "");
        const id = String($(this).data("id") || "");
        const s2 = getSettings();
        ensureParty(s2);
        const lanes = s2.party.formation?.lanes;
        if (!lanes || !Array.isArray(lanes[lane])) return;
        lanes[lane] = lanes[lane].filter(x => String(x) !== id);
        saveSettings();
        render();
    });

    $(document).on("click.party", "#uie-party-window .form-mv", function(e){
        e.preventDefault();
        e.stopPropagation();
        const act = String($(this).data("act") || "");
        const lane = String($(this).data("lane") || "");
        const id = String($(this).data("id") || "");
        const s2 = getSettings();
        ensureParty(s2);
        const lanes = s2.party.formation?.lanes;
        if (!lanes || !Array.isArray(lanes[lane])) return;
        const arr = lanes[lane].map(String);
        const idx = arr.findIndex(x => x === id);
        if (idx < 0) return;
        const next = act === "up" ? idx - 1 : idx + 1;
        if (next < 0 || next >= arr.length) return;
        const tmp = arr[idx];
        arr[idx] = arr[next];
        arr[next] = tmp;
        lanes[lane] = arr;
        saveSettings();
        render();
    });

    $(document).on("change.party", "#uie-party-window .form-role", function(e){
        e.preventDefault();
        const id = String($(this).data("id") || "");
        if (!id) return;
        const s2 = getSettings();
        ensureParty(s2);
        const m = getMember(s2, id);
        if (!m) return;
        ensureMember(m);
        m.partyRole = String($(this).val() || m.partyRole || "DPS");
        saveSettings();
        render();
    });

    $(document).on("click.party", "#uie-party-window #pm-save", function() {
        const s = getSettings();
        const m = getMember(s, selectedId);
        if (!m) return;

        m.identity.name = $("#pm-name").val();
        m.identity.class = $("#pm-class").val();
        m.stats.str = Number($("#pm-str").val());
        m.stats.dex = Number($("#pm-dex").val());
        m.stats.con = Number($("#pm-con").val());
        m.stats.int = Number($("#pm-int").val());
        m.stats.wis = Number($("#pm-wis").val());
        m.stats.cha = Number($("#pm-cha").val());
        m.stats.per = Number($("#pm-per").val());
        m.stats.luk = Number($("#pm-luk").val());

        m.vitals.hp = Number($("#pm-hp").val());
        m.vitals.maxHp = Number($("#pm-maxhp").val());
        m.vitals.mp = Number($("#pm-mp").val());
        m.vitals.maxMp = Number($("#pm-maxmp").val());

        m.bio = $("#pm-bio").val();
        m.notes = $("#pm-notes").val();
        m.customCSS = $("#pm-css").val();

        const isUser = isUserMember(s, m);
        if (isUser) {
            applyMemberToCore(s, m);
            try { $(document).trigger("uie:updateVitals"); } catch (_) {}
        }

        saveSettings();
        if(window.toastr) toastr.success("Member saved.");
        render();
    });

    $(document).on("click.party", "#uie-party-window #party-pick-portrait", async function() {
        const id = $(this).data("id");
        const s = getSettings();
        const m = getMember(s, id);
        if (!m) return;
        const img = await pickLocalImage();
        if (img) {
            m.images.portrait = img;
            saveSettings();
            render();
        }
    });

    render();
}


