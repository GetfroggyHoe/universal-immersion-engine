import { getSettings, saveSettings } from "./core.js";
import { getContext } from "../../../../../extensions.js";
import { injectRpEvent } from "./features/rp_log.js";
import { generateContent } from "./apiClient.js";
import { notify } from "./notifications.js";
import { MEDALLIONS } from "./inventory.js";

let selectedId = null;
let tab = "roster";
let memberModalOpen = false;
let memberEdit = false;
let memberModalTab = "sheet";

function esc(s) {
    return String(s ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
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

function findUserMember(s) {
    const name = String(s?.character?.name || "").trim().toLowerCase();
    const members = Array.isArray(s?.party?.members) ? s.party.members : [];
    let m = members.find(x => Array.isArray(x?.roles) && x.roles.includes("User"));
    if (!m && name) m = members.find(x => String(x?.identity?.name || "").trim().toLowerCase() === name);
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
    const isUser = (Array.isArray(m?.roles) && m.roles.includes("User"));
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
    const members = s.party.members || [];
    const html = members.map(m => `
        <div class="party-row ${selectedId === String(m.id) ? "active" : ""}" data-id="${m.id}" style="
            display:flex; align-items:center; gap:12px; padding:10px; 
            background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); border-radius:8px; margin-bottom:8px; cursor:pointer;
        ">
            <div style="width:46px; height:46px; border-radius:6px; background:#000; overflow:hidden; border:1px solid rgba(255,255,255,0.12);">
                ${resolvePortraitUrl(s, m) ? `<img src="${esc(resolvePortraitUrl(s, m))}" style="width:100%;height:100%;object-fit:cover;">` : `<i class="fa-solid fa-user" style="color:#333; font-size:24px; display:flex; justify-content:center; align-items:center; height:100%;"></i>`}
            </div>
            <div style="flex:1;">
                <div style="font-weight:900; color:${m.active ? '#fff' : '#888'}; font-size:1.1em;">${esc(m.identity.name)}</div>
                <div style="font-size:0.8em; color:#aaa;">Lv.${m.progression?.level || 1} • ${esc(m.partyRole || "DPS")} • ${esc(m.identity.class || "Adventurer")}</div>
            </div>
            <div style="display:flex; gap:5px;">
                <button class="party-mini" data-act="edit" data-id="${m.id}" title="Edit" style="background:none; border:none; color:#f1c40f; cursor:pointer;"><i class="fa-solid fa-pen-to-square"></i></button>
                <button class="party-mini" data-act="toggleActive" data-id="${m.id}" title="Toggle Active" style="background:none; border:none; color:${m.active ? '#2ecc71' : '#444'}; cursor:pointer;"><i class="fa-solid fa-power-off"></i></button>
                <button class="party-mini" data-act="leader" data-id="${m.id}" title="Make Leader" style="background:none; border:none; color:${s.party.leaderId === String(m.id) ? '#f1c40f' : '#444'}; cursor:pointer;"><i class="fa-solid fa-crown"></i></button>
                <button class="party-mini" data-act="delete" data-id="${m.id}" title="Delete" style="background:none; border:none; color:#e74c3c; cursor:pointer;"><i class="fa-solid fa-trash"></i></button>
            </div>
        </div>
    `).join("");

    $("#uie-party-body").html(`
        <div style="display:flex; gap:10px; margin-bottom:15px; justify-content:center; flex-wrap:wrap;">
            <button id="party-scan-chat" style="padding:8px 12px; border-radius:6px; border:1px solid rgba(241,196,15,0.4); background:rgba(241,196,15,0.15); color:#f1c40f; cursor:pointer; font-weight:900; width:100%;">Scan Roster from Chat</button>
            <button id="party-add" style="padding:8px 12px; border-radius:6px; border:1px solid #444; background:#222; color:#ccc; cursor:pointer; font-weight:900;">+ Empty</button>
            <button id="party-import-user" style="padding:8px 12px; border-radius:6px; border:1px solid #2ecc71; background:rgba(46,204,113,0.1); color:#2ecc71; cursor:pointer; font-weight:900;">Import User</button>
            <button id="party-import-char" style="padding:8px 12px; border-radius:6px; border:1px solid #3498db; background:rgba(52,152,219,0.1); color:#3498db; cursor:pointer; font-weight:900;">Import Character</button>
        </div>
        <div style="display:flex; flex-direction:column;">
            ${html || `<div style="text-align:center; padding:40px; color:#666;">No party members.</div>`}
        </div>
    `);
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

    const opts = members.map(x => `<option value="${esc(x.id)}" ${String(x.id) === String(m.id) ? "selected" : ""}>${esc(x.identity?.name || "Member")}</option>`).join("");
    
    const statRow = (lbl, key) => `
        <div style="display:flex; flex-direction:column; gap:4px; background:rgba(0,0,0,0.22); padding:10px; border-radius:12px; border:1px solid rgba(255,255,255,0.10);">
            <div style="font-size:10px; color:#aaa; font-weight:900; text-transform:uppercase; letter-spacing:0.7px;">${lbl}</div>
            <div style="color:#fff; font-weight:900; font-size:16px; width:100%; text-align:center;">${Number(m.stats[key] || 0)}</div>
        </div>`;

    $("#uie-party-body").html(`
        <div style="display:flex; gap:10px; align-items:center; margin-bottom:15px;">
            <div style="width:80px; height:80px; border-radius:14px; background:#000; border:1px solid #444; position:relative; overflow:hidden;">
                ${m.images.portrait ? `<img src="${esc(m.images.portrait)}" style="width:100%;height:100%;object-fit:cover;">` : `<i class="fa-solid fa-user" style="font-size:32px; color:#333; position:absolute; top:50%; left:50%; transform:translate(-50%,-50%);"></i>`}
            </div>
            <div style="flex:1; min-width:0;">
                <div style="color:#f1c40f; font-weight:900; font-size:1.4em; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${esc(m.identity.name)}</div>
                <div style="color:#aaa; font-weight:800; font-size:0.9em; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${esc(m.identity.class || "Adventurer")} • Lv.${Number(m.progression?.level || 1)} • ${esc(m.partyRole || "DPS")}</div>
            </div>
            <select id="party-sheet-member" style="background:#000; border:1px solid #333; color:#fff; padding:8px; border-radius:8px;">${opts}</select>
        </div>

        <div style="display:flex; gap:10px; margin-bottom:15px;">
            <button class="uie-party-subtab active" data-sub="stats">Stats</button>
            <button class="uie-party-subtab" data-sub="bio">Bio & Notes</button>
            <button class="uie-party-subtab" data-sub="css">Style</button>
        </div>

        <div id="pm-sub-stats">
            <div style="display:grid; grid-template-columns: repeat(4, 1fr); gap:8px; margin-bottom:15px;">
                ${statRow("STR", "str")} ${statRow("DEX", "dex")} ${statRow("CON", "con")} ${statRow("INT", "int")}
                ${statRow("WIS", "wis")} ${statRow("CHA", "cha")} ${statRow("PER", "per")} ${statRow("LUK", "luk")}
            </div>
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-bottom:10px;">
                <div style="background:rgba(0,0,0,0.22); border:1px solid rgba(255,255,255,0.10); border-radius:12px; padding:10px;"><label style="font-size:10px; color:#aaa; font-weight:900; text-transform:uppercase;">HP</label><div style="margin-top:6px; font-weight:900; color:#e74c3c;">${Number(m.vitals?.hp||0)} / ${Number(m.vitals?.maxHp||0)}</div></div>
                <div style="background:rgba(0,0,0,0.22); border:1px solid rgba(255,255,255,0.10); border-radius:12px; padding:10px;"><label style="font-size:10px; color:#aaa; font-weight:900; text-transform:uppercase;">MP</label><div style="margin-top:6px; font-weight:900; color:#3498db;">${Number(m.vitals?.mp||0)} / ${Number(m.vitals?.maxMp||0)}</div></div>
            </div>
        </div>

        <div id="pm-sub-bio" style="display:none;">
            <div style="padding:12px; border-radius:12px; border:1px solid rgba(255,255,255,0.10); background:rgba(0,0,0,0.22); color:#ddd; white-space:pre-wrap;">${esc(m.bio || "") || "—"}</div>
        </div>
        
        <div id="pm-sub-css" style="display:none;">
            <div style="padding:12px; border-radius:12px; border:1px solid rgba(255,255,255,0.10); background:rgba(0,0,0,0.22); color:#f1c40f; font-family:monospace; white-space:pre-wrap;">${esc(m.customCSS || "") || "—"}</div>
        </div>
    `);
    
    $(".uie-party-subtab").on("click", function() {
        $(".uie-party-subtab").removeClass("active").css({background:"transparent", color:"#aaa"});
        $(this).addClass("active").css({background:"rgba(255,255,255,0.1)", color:"#fff"});
        const sub = $(this).data("sub");
        $("#pm-sub-stats, #pm-sub-bio, #pm-sub-css").hide();
        $(`#pm-sub-${sub}`).show();
    });
    
    $("#party-sheet-member").on("change", function() {
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

    const opts = members.map(x => `<option value="${esc(x.id)}" ${String(x.id) === String(m.id) ? "selected" : ""}>${esc(x.identity?.name || "Member")}</option>`).join("");
    const slots = ["head","chest","hands","legs","boots","ring","amulet","weapon","offhand"];
    
    const slotHtml = slots.map(slot => {
        const item = m.equipment?.[slot];
        const icon = item?.img ? `<img src="${esc(item.img)}" style="width:100%;height:100%;object-fit:cover;">` : `<div style="opacity:0.3;font-size:20px;text-transform:uppercase;">${slot[0]}</div>`;
        return `
            <div class="party-slot" data-slot="${slot}" style="aspect-ratio:1; background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.15); border-radius:12px; display:flex; align-items:center; justify-content:center; cursor:pointer; position:relative;">
                ${icon}
                <div style="position:absolute; bottom:2px; right:4px; font-size:9px; opacity:0.7; text-transform:uppercase;">${slot}</div>
            </div>
        `;
    }).join("");

    $("#uie-party-body").html(`
        <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-bottom:10px;">
            <div style="font-weight:900; color:#f1c40f;">Member</div>
            <select id="party-gear-member" style="flex:1; min-width:220px; background:#000; border:1px solid #333; color:#fff; padding:10px; border-radius:12px;">${opts}</select>
        </div>
        <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap:12px; max-width:400px; margin:0 auto;">
            ${slotHtml}
        </div>
    `);
    
    $("#party-gear-member").on("change", function() {
        selectedId = $(this).val();
        render();
    });
}

function renderInventory(s) {
    const items = s.party.sharedItems || [];
    const html = items.length 
        ? items.map((it, i) => `
            <div style="display:flex; gap:10px; align-items:center; padding:8px; border-bottom:1px solid rgba(255,255,255,0.1);">
                <div style="flex:1; font-weight:700; color:#ccc;">${esc(it.name || "Item")}</div>
                <div style="font-size:12px; color:#888;">${esc(it.type || "Misc")}</div>
                <button class="party-inv-del" data-idx="${i}" style="color:#e74c3c; background:none; border:none; cursor:pointer;"><i class="fa-solid fa-trash"></i></button>
            </div>`).join("")
        : `<div style="text-align:center; padding:20px; color:#666;">Empty Party Stash</div>`;

    $("#uie-party-body").html(`
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
            <div style="font-weight:900; color:#f1c40f;">Shared Stash</div>
            <button id="party-inv-add" style="padding:6px 12px; border-radius:8px; background:rgba(255,255,255,0.1); color:#fff; border:none; cursor:pointer;">+ Add Item</button>
        </div>
        <div style="background:rgba(0,0,0,0.2); border:1px solid rgba(255,255,255,0.1); border-radius:12px; overflow:hidden;">
            ${html}
        </div>
    `);
}

function renderTactics(s) {
    const members = Array.isArray(s.party.members) ? s.party.members : [];
    const activeMembers = members.filter(m => m && m.active !== false);
    const presets = ["Balanced", "Aggressive", "Defensive", "Support", "Stealth"];
    if (!s.party.partyTactics) s.party.partyTactics = { preset: "Balanced", conserveMana: false, protectLeader: false };
    const pt = s.party.partyTactics;
    const memberOpts = activeMembers.map(m => `<option value="${esc(m.id)}">${esc(m.identity?.name || "Member")}</option>`).join("");
    const rows = activeMembers.map(m => {
        ensureMember(m);
        const focusOpts = [
            { v: "auto", t: "Auto" },
            { v: "weakest", t: "Weakest" },
            { v: "strongest", t: "Strongest" },
            { v: "protect", t: "Protect" }
        ];
        const presetSel = presets.map(p => `<option value="${esc(p)}" ${String(m.tactics?.preset||"Balanced")===p ? "selected":""}>${esc(p)}</option>`).join("");
        const focusSel = focusOpts.map(o => `<option value="${esc(o.v)}" ${String(m.tactics?.focus||"auto")===o.v ? "selected":""}>${esc(o.t)}</option>`).join("");
        const protectSel = `<option value="">—</option>` + memberOpts.replace(`value="${esc(m.id)}"`, `value="${esc(m.id)}" disabled`);
        return `
          <div style="border:1px solid rgba(255,255,255,0.10); background:rgba(0,0,0,0.18); border-radius:10px; padding:10px; margin-bottom:10px;">
            <div style="display:flex; gap:10px; align-items:center;">
              <div style="font-weight:900; min-width:0; flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${esc(m.identity?.name || "Member")}</div>
              <div style="opacity:0.75; font-weight:900; font-size:12px;">Lv ${Number(m.progression?.level||1)} • ${esc(m.partyRole||"DPS")}</div>
            </div>
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-top:10px;">
              <div>
                <div style="font-size:11px; opacity:0.7; font-weight:900; margin-bottom:6px;">Preset</div>
                <select class="member-tac-preset" data-id="${esc(m.id)}" style="width:100%; height:34px; border-radius:10px; border:1px solid rgba(255,255,255,0.10); background:rgba(0,0,0,0.18); color:#fff; padding:0 10px;">${presetSel}</select>
              </div>
              <div>
                <div style="font-size:11px; opacity:0.7; font-weight:900; margin-bottom:6px;">Focus</div>
                <select class="member-tac-focus" data-id="${esc(m.id)}" style="width:100%; height:34px; border-radius:10px; border:1px solid rgba(255,255,255,0.10); background:rgba(0,0,0,0.18); color:#fff; padding:0 10px;">${focusSel}</select>
              </div>
              <div style="grid-column:1 / -1;">
                <div style="font-size:11px; opacity:0.7; font-weight:900; margin-bottom:6px;">Protect Target (when Focus=Protect)</div>
                <select class="member-tac-protect" data-id="${esc(m.id)}" style="width:100%; height:34px; border-radius:10px; border:1px solid rgba(255,255,255,0.10); background:rgba(0,0,0,0.18); color:#fff; padding:0 10px;">${protectSel}</select>
              </div>
              <div style="grid-column:1 / -1; display:flex; gap:10px; align-items:center;">
                <label style="display:flex; gap:10px; align-items:center; font-weight:900; opacity:0.85;">
                  <input class="member-tac-mana" data-id="${esc(m.id)}" type="checkbox" ${m.tactics?.conserveMana ? "checked":""}>
                  Conserve MP
                </label>
              </div>
            </div>
          </div>
        `;
    }).join("");

    $("#uie-party-body").html(`
      <div style="font-weight:900; color:#f1c40f; margin-bottom:10px;">Party Tactics</div>
      <div style="border:1px solid rgba(255,255,255,0.10); background:rgba(0,0,0,0.18); border-radius:10px; padding:10px; margin-bottom:12px;">
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
          <div>
            <div style="font-size:11px; opacity:0.7; font-weight:900; margin-bottom:6px;">Preset</div>
            <select id="party-tac-preset" style="width:100%; height:34px; border-radius:10px; border:1px solid rgba(255,255,255,0.10); background:rgba(0,0,0,0.18); color:#fff; padding:0 10px;">
              ${presets.map(p => `<option value="${esc(p)}" ${String(pt.preset||"Balanced")===p ? "selected":""}>${esc(p)}</option>`).join("")}
            </select>
          </div>
          <div style="display:flex; flex-direction:column; justify-content:flex-end; gap:8px;">
            <label style="display:flex; gap:10px; align-items:center; font-weight:900; opacity:0.85;">
              <input id="party-tac-conserve" type="checkbox" ${pt.conserveMana ? "checked":""}>
              Conserve MP
            </label>
            <label style="display:flex; gap:10px; align-items:center; font-weight:900; opacity:0.85;">
              <input id="party-tac-protect-leader" type="checkbox" ${pt.protectLeader ? "checked":""}>
              Protect Leader
            </label>
          </div>
        </div>
      </div>
      <div style="font-weight:900; color:#f1c40f; margin-bottom:10px;">Member Tactics</div>
      ${rows || `<div style="opacity:0.75; text-align:center; padding:30px; border-radius:14px; border:1px dashed rgba(255,255,255,0.18);">Add party members first.</div>`}
    `);
}

function renderFormation(s) {
    const members = Array.isArray(s.party.members) ? s.party.members : [];
    const activeMembers = members.filter(m => m && m.active !== false);
    if (!s.party.formation) s.party.formation = { lanes: { front: [], mid: [], back: [] } };
    if (!s.party.formation.lanes) s.party.formation.lanes = { front: [], mid: [], back: [] };
    const lanes = s.party.formation.lanes;
    const allIds = new Set([...(lanes.front||[]), ...(lanes.mid||[]), ...(lanes.back||[])].map(String));
    const available = activeMembers.filter(m => !allIds.has(String(m.id)));
    const roleOptions = ["Tank","Healer","DPS","Support","Mage","Ranger","Scout","Leader","Bruiser"];

    const availOpts = `<option value="">Select member…</option>` + available.map(m => `<option value="${esc(m.id)}">${esc(m.identity?.name || "Member")}</option>`).join("");

    const laneBlock = (key, title) => {
        const list = (lanes[key] || []).map(id => {
            const m = getMember(s, id);
            if (!m) return "";
            ensureMember(m);
            const roleSel = roleOptions.map(r => `<option value="${esc(r)}" ${String(m.partyRole||"DPS")===r ? "selected":""}>${esc(r)}</option>`).join("");
            return `
              <div class="party-form-member" data-id="${esc(m.id)}" style="display:flex; gap:10px; align-items:center; padding:8px 10px; border-radius:10px; border:1px solid rgba(255,255,255,0.10); background:rgba(0,0,0,0.18); margin-bottom:8px; cursor:pointer;">
                <div style="flex:1; min-width:0;">
                  <div style="font-weight:900; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${esc(m.identity?.name || "Member")}</div>
                  <div style="font-size:12px; opacity:0.75; font-weight:900;">Lv ${Number(m.progression?.level||1)} • ${esc(m.identity?.class||"Adventurer")}</div>
                </div>
                <select class="form-role" data-id="${esc(m.id)}" style="width:140px; height:34px; border-radius:10px; border:1px solid rgba(255,255,255,0.10); background:rgba(0,0,0,0.18); color:#fff; padding:0 10px;">${roleSel}</select>
                <div style="display:flex; gap:6px; align-items:center;">
                  <button class="form-mv" data-act="up" data-lane="${esc(key)}" data-id="${esc(m.id)}" style="width:34px; height:34px; border-radius:10px; border:1px solid rgba(255,255,255,0.10); background:rgba(0,0,0,0.18); color:#fff; font-weight:900;">↑</button>
                  <button class="form-mv" data-act="down" data-lane="${esc(key)}" data-id="${esc(m.id)}" style="width:34px; height:34px; border-radius:10px; border:1px solid rgba(255,255,255,0.10); background:rgba(0,0,0,0.18); color:#fff; font-weight:900;">↓</button>
                  <button class="form-rm" data-lane="${esc(key)}" data-id="${esc(m.id)}" style="width:34px; height:34px; border-radius:10px; border:1px solid rgba(243,139,168,0.35); background:rgba(0,0,0,0.18); color:#f38ba8; font-weight:900;">×</button>
                </div>
              </div>
            `;
        }).join("");

        return `
          <div style="border:1px solid rgba(255,255,255,0.10); background:rgba(0,0,0,0.18); border-radius:12px; padding:10px;">
            <div style="display:flex; gap:10px; align-items:center; margin-bottom:10px;">
              <div style="font-weight:900; color:#f1c40f;">${esc(title)}</div>
              <div style="margin-left:auto; display:flex; gap:8px; align-items:center;">
                <select id="form-add-${esc(key)}" style="height:34px; border-radius:10px; border:1px solid rgba(255,255,255,0.10); background:rgba(0,0,0,0.18); color:#fff; padding:0 10px; min-width:200px;">${availOpts}</select>
                <button class="form-add" data-lane="${esc(key)}" style="height:34px; padding:0 12px; border-radius:10px; border:none; background:#2ecc71; color:#000; font-weight:900;">Add</button>
              </div>
            </div>
            ${list || `<div style="opacity:0.7; font-weight:900; padding:10px;">Empty lane</div>`}
          </div>
        `;
    };

    $("#uie-party-body").html(`
      <div style="font-weight:900; color:#f1c40f; margin-bottom:10px;">Formation & Roles</div>
      <div style="opacity:0.75; font-weight:900; margin-bottom:12px;">Assign members to lanes and set their combat roles.</div>
      <div style="display:flex; flex-direction:column; gap:12px;">
        ${laneBlock("front", "Front Line")}
        ${laneBlock("mid", "Mid Line")}
        ${laneBlock("back", "Back Line")}
      </div>
    `);
}

function render() {
    const s = getSettings();
    ensureParty(s);
    try {
        const mm = $("#uie-party-member-modal");
        if (memberModalOpen) mm.css({ display: "block", pointerEvents: "auto" });
        else mm.css({ display: "none", pointerEvents: "none" });
    } catch (_) {}
    if (!s.ui) s.ui = {};
    if (!s.ui.backgrounds) s.ui.backgrounds = {};
    const partyBg = String(s.ui.backgrounds.party || "");
    if (partyBg) {
        $("#uie-party-window").css({ backgroundImage: `url("${partyBg}")`, backgroundSize: "cover", backgroundPosition: "center" });
    } else {
        $("#uie-party-window").css({ backgroundImage: "", backgroundSize: "", backgroundPosition: "" });
    }

    try { syncPartyUserFromCore(); } catch (_) {}
    
    // Render Header
    $("#uie-party-name").text(s.party.name || "My Party");
    const leader = s.party.members.find(m => String(m.id) === String(s.party.leaderId));
    $("#uie-party-leader").text(leader ? leader.identity.name : "None");
    $("#uie-party-name-input").val(s.party.name || "");

    // Tabs
    $(".uie-party-tab").css({background:"rgba(0,0,0,0.18)", color:"#fff", borderColor:"rgba(255,255,255,0.1)"});
    $(`.uie-party-tab[data-tab="${tab}"]`).css({background:"rgba(241,196,15,0.15)", color:"#f1c40f", borderColor:"rgba(241,196,15,0.3)"});

    if (tab === "roster") renderRoster(s);
    else if (tab === "sheet") renderSheet(s);
    else if (tab === "gear") renderGear(s);
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
    } else {
        notify("info", "No roster changes detected.", "Party", "scan");
    }
}

function renderMemberModal(s, m) {
    ensureMember(m);
    $("#uie-party-member-title").text(`${m.identity?.name || "Member"}`);
    try {
        const bg = String(s?.ui?.backgrounds?.partyMember || "");
        const card = document.getElementById("uie-party-member-card");
        if (card) {
            if (bg) {
                card.style.backgroundImage = `linear-gradient(180deg, rgba(0,0,0,0.25), rgba(0,0,0,0.55)), url("${bg}")`;
                card.style.backgroundSize = "cover";
                card.style.backgroundPosition = "center";
            } else {
                card.style.backgroundImage = "";
                card.style.backgroundSize = "";
                card.style.backgroundPosition = "";
            }
        }
    } catch (_) {}

    const dis = memberEdit ? "" : "disabled";
    const pe = memberEdit ? "" : "pointer-events:none;opacity:0.85;";
    const roleOptions = ["Tank","Healer","DPS","Support","Mage","Ranger","Scout","Leader","Bruiser"];
    const roleSelect = `<select id="party-mm-role" style="flex:1; min-width:160px; height:34px; border:1px solid rgba(255,255,255,0.10); background:rgba(0,0,0,0.18); color:#fff; padding:0 10px; border-radius:10px;">
        ${roleOptions.map(r => `<option value="${esc(r)}" ${String(m.partyRole||"DPS")===r ? "selected" : ""}>${esc(r)}</option>`).join("")}
    </select>`;
    const slots = ["head","chest","legs","feet","hands","weapon","offhand","accessory1","accessory2"];
    const slotLabel = {
        head: "Head",
        chest: "Chest",
        legs: "Legs",
        feet: "Feet",
        hands: "Hands",
        weapon: "Main Hand",
        offhand: "Off Hand",
        accessory1: "Accessory 1",
        accessory2: "Accessory 2"
    };
    const equipRows = slots.map(k => {
        const val = String(m.equipment?.[k] || "");
        return `<div style="display:grid; grid-template-columns: 132px 1fr; gap:10px; align-items:center; padding:8px 10px; border-radius:6px; border:1px solid rgba(255,255,255,0.10); background:rgba(0,0,0,0.18);">
            <div style="font-weight:900; opacity:0.9; letter-spacing:0.2px;">${esc(slotLabel[k] || k)}</div>
            <input ${dis} data-eq="${esc(k)}" value="${esc(val)}" style="height:34px; border-radius:6px; border:1px solid rgba(255,255,255,0.10); background:rgba(0,0,0,0.18); color:#fff; padding:0 10px; ${pe}">
        </div>`;
    }).join("");

    const statKeys = ["str","dex","con","int","wis","cha","per","luk"];
    const statGrid = statKeys.map(k => {
        const val = Number(m.stats?.[k] || 0);
        return `<div style="display:flex; flex-direction:column; gap:4px; padding:8px; border-radius:12px; border:1px solid rgba(255,255,255,0.10); background:rgba(0,0,0,0.22);">
            <div style="font-size:10px; font-weight:900; opacity:0.75; letter-spacing:0.6px;">${esc(k.toUpperCase())}</div>
            <input ${dis} data-stat="${esc(k)}" type="number" value="${val}" style="height:34px; border-radius:10px; border:1px solid rgba(255,255,255,0.10); background:rgba(0,0,0,0.25); color:#fff; text-align:center; font-weight:900; ${pe}">
        </div>`;
    }).join("");

    const bar = (lbl, cur, max, color) => {
        const c = Number(cur || 0);
        const mxx = Math.max(1, Number(max || 0));
        const pct = Math.max(0, Math.min(100, (c / mxx) * 100));
        return `<div style="margin-bottom:10px;">
            <div style="display:flex; justify-content:space-between; font-size:12px; font-weight:900; opacity:0.9; margin-bottom:6px;"><div>${lbl}</div></div>
            <div style="position:relative;height:14px; border-radius:7px; border:1px solid rgba(255,255,255,0.10); background:rgba(0,0,0,0.35); overflow:hidden;">
                <div style="height:100%; width:${pct}%; background:${color};"></div>
                <div style="position:absolute; inset:0; display:flex; align-items:center; justify-content:center; font-size:11px; font-weight:900; color:rgba(255,255,255,0.92); text-shadow:0 1px 2px rgba(0,0,0,0.7);">${c}/${mxx}</div>
            </div>
        </div>`;
    };

    const skillsText = Array.isArray(m.skills) ? m.skills.map(x => String(x?.name || x || "").trim()).filter(Boolean).join("\n") : "";
    const resolvedSkills = resolveMemberSkills(s, m);
    const skillsList = resolvedSkills.map((sk) => {
        const src = sk.source === "Inventory" ? "INV" : "PTY";
        const srcColor = sk.source === "Inventory" ? "rgba(52,152,219,0.85)" : "rgba(241,196,15,0.85)";
        return `<div class="party-skill" data-name="${esc(sk.name)}" data-desc="${esc(sk.desc || "")}" style="display:flex; gap:10px; align-items:flex-start; padding:10px; border-radius:14px; border:1px solid rgba(255,255,255,0.10); background:rgba(0,0,0,0.20); cursor:pointer;">
            <div style="flex:0 0 auto; min-width:44px; height:24px; border-radius:999px; border:1px solid rgba(255,255,255,0.12); background:rgba(0,0,0,0.25); display:grid; place-items:center; font-weight:900; font-size:11px; color:${srcColor};">${src}</div>
            <div style="flex:1; min-width:0;">
                <div style="font-weight:900; color:#fff; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(sk.name)}</div>
                <div style="opacity:0.72; font-size:12px; line-height:1.35; margin-top:2px; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;">${esc(sk.desc || "")}</div>
            </div>
        </div>`;
    }).join("");
    const fx = Array.isArray(m.statusEffects) ? m.statusEffects : [];
    const fxIcons = fx.slice(0, 16).map((x) => {
        const raw = String(x || "").trim().slice(0, 120);
        const label = raw ? raw[0].toUpperCase() : "!";
        return `<div class="party-fx" title="${esc(raw)}" style="width:28px;height:28px;border-radius:10px;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.25);display:grid;place-items:center;font-weight:900;color:rgba(255,255,255,0.9);user-select:none;">${esc(label)}</div>`;
    }).join("");
    const fxText = fx.join(", ");

    const mmTabs = `
        <div style="display:flex; gap:8px; padding:10px 12px; border-bottom:1px solid rgba(255,255,255,0.10); background:rgba(0,0,0,0.20);">
            <button class="party-mm-tab" data-tab="sheet" style="height:32px; padding:0 12px; border:1px solid rgba(255,255,255,0.12); background:${memberModalTab === "sheet" ? "rgba(241,196,15,0.18)" : "rgba(0,0,0,0.25)"}; color:${memberModalTab === "sheet" ? "#f1c40f" : "#fff"}; font-weight:900; cursor:pointer;">Sheet</button>
            <button class="party-mm-tab" data-tab="equip" style="height:32px; padding:0 12px; border:1px solid rgba(255,255,255,0.12); background:${memberModalTab === "equip" ? "rgba(241,196,15,0.18)" : "rgba(0,0,0,0.25)"}; color:${memberModalTab === "equip" ? "#f1c40f" : "#fff"}; font-weight:900; cursor:pointer;">Equip</button>
            <button class="party-mm-tab" data-tab="skills" style="height:32px; padding:0 12px; border:1px solid rgba(255,255,255,0.12); background:${memberModalTab === "skills" ? "rgba(241,196,15,0.18)" : "rgba(0,0,0,0.25)"}; color:${memberModalTab === "skills" ? "#f1c40f" : "#fff"}; font-weight:900; cursor:pointer;">Skills</button>
        </div>
    `;

    const portrait = resolvePortraitUrl(s, m);
    const sheetPane = `
        <div style="padding:12px; display:flex; flex-direction:column; gap:12px;">
            <div style="display:flex; gap:12px; align-items:flex-start; flex-wrap:wrap;">
                <div style="width:120px; height:120px; border-radius:6px; background:rgba(0,0,0,0.18); overflow:hidden; border:1px solid rgba(255,255,255,0.12);">
                    ${portrait ? `<img src="${esc(portrait)}" style="width:100%;height:100%;object-fit:cover;">` : `<div style="width:100%;height:100%;display:grid;place-items:center;opacity:0.55;font-weight:900;">Portrait</div>`}
                </div>
                <div style="flex:1; min-width:200px;">
                    <input ${dis} id="party-mm-name" value="${esc(m.identity?.name || "")}" style="width:100%; height:36px; border:1px solid rgba(255,255,255,0.12); background:rgba(0,0,0,0.22); color:#f1c40f; font-weight:900; padding:0 10px; ${pe}">
                    <div style="display:flex; gap:10px; margin-top:8px; flex-wrap:wrap;">
                        <input ${dis} id="party-mm-class" value="${esc(m.identity?.class || "")}" style="flex:1; min-width:160px; height:34px; border:1px solid rgba(255,255,255,0.10); background:rgba(0,0,0,0.18); color:#fff; padding:0 10px; ${pe}">
                        <input ${dis} id="party-mm-level" type="number" value="${Number(m.progression?.level || 1)}" style="width:110px; height:34px; border:1px solid rgba(255,255,255,0.10); background:rgba(0,0,0,0.18); color:#fff; text-align:center; font-weight:900; ${pe}">
                        ${roleSelect}
                    </div>
                </div>
            </div>

            <div style="border-top:1px solid rgba(255,255,255,0.10); padding-top:12px;">
                ${bar("HP", m.vitals?.hp, m.vitals?.maxHp, "#e74c3c")}
                ${bar("MP", m.vitals?.mp, m.vitals?.maxMp, "#3498db")}
                ${bar("AP", m.vitals?.ap, m.vitals?.maxAp, "#f1c40f")}
            </div>

            <div style="border-top:1px solid rgba(255,255,255,0.10); padding-top:12px;">
                <div style="display:flex; align-items:center; gap:10px; margin-bottom:8px;">
                    <div style="font-weight:900;">Status</div>
                </div>
                <div style="display:flex; gap:8px; flex-wrap:wrap;">${fxIcons || `<div style="opacity:0.6; font-weight:900;">None</div>`}</div>
                ${memberEdit ? `<input id="party-mm-fx" value="${esc(fxText)}" placeholder="comma-separated" style="margin-top:10px; width:100%; height:34px; border:1px solid rgba(255,255,255,0.10); background:rgba(0,0,0,0.25); color:#fff; padding:0 10px;">` : ``}
            </div>

            <div style="border-top:1px solid rgba(255,255,255,0.10); padding-top:12px;">
                <div style="font-weight:900; margin-bottom:8px;">Stats</div>
                <div style="display:grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap:8px;">
                    ${statGrid}
                </div>
            </div>

            ${memberEdit ? `<button id="party-mm-save" style="width:100%; height:42px; border:1px solid rgba(241,196,15,0.30); background:rgba(241,196,15,0.18); color:#f1c40f; font-weight:900; cursor:pointer;">Save Changes</button>` : ``}
        </div>
    `;

    const equipPane = `
        <div style="padding:12px; display:flex; flex-direction:column; gap:12px;">
            <div style="display:grid; grid-template-columns: minmax(0, 1.55fr) minmax(0, 1fr); gap:12px; align-items:start;">
                <div style="border-radius:14px; border:1px solid rgba(255,255,255,0.12); background:rgba(0,0,0,0.16); overflow:hidden;">
                    <div id="party-paperdoll-pick" style="width:100%; height:min(62vh, 560px); background:rgba(0,0,0,0.12); display:grid; place-items:center; cursor:${memberEdit ? "pointer" : "default"};">
                        ${m.images.paperDoll ? `<img src="${esc(m.images.paperDoll)}" style="width:100%;height:100%;object-fit:contain; background:rgba(0,0,0,0.10);">` : `<div style="opacity:0.7; font-weight:900;">Paper Doll</div>`}
                    </div>
                </div>
                <div style="display:flex; flex-direction:column; gap:10px;">
                    <div style="font-weight:900;">Equipment</div>
                    <div style="display:flex; flex-direction:column; gap:8px;">${equipRows}</div>
                </div>
            </div>
            ${memberEdit ? `<button id="party-mm-save" style="width:100%; height:42px; border:1px solid rgba(241,196,15,0.30); background:rgba(241,196,15,0.18); color:#f1c40f; font-weight:900; cursor:pointer;">Save Changes</button>` : ``}
        </div>
    `;

    const skillsEditRows = (Array.isArray(m.skills) ? m.skills : []).slice(0, 60).map((sk, idx) => `
        <div style="border:1px solid rgba(255,255,255,0.10); background:rgba(0,0,0,0.20); border-radius:14px; padding:10px; margin-bottom:10px;">
            <div style="display:flex; gap:8px; align-items:center; margin-bottom:8px;">
                <input data-skill-name="${idx}" value="${esc(sk?.name || "")}" placeholder="Skill name" style="flex:1; min-width:0; height:34px; border-radius:12px; border:1px solid rgba(255,255,255,0.12); background:rgba(0,0,0,0.22); color:#fff; padding:0 10px; font-weight:900;">
                <select data-skill-type="${idx}" style="height:34px; border-radius:12px; border:1px solid rgba(255,255,255,0.12); background:rgba(0,0,0,0.22); color:#fff; padding:0 10px; font-weight:900;">
                    <option value="active" ${String(sk?.skillType||"active")==="active" ? "selected" : ""}>Active</option>
                    <option value="passive" ${String(sk?.skillType||"active")==="passive" ? "selected" : ""}>Passive</option>
                </select>
                <button class="party-mm-skill-del" data-skill-del="${idx}" style="width:38px; height:34px; border-radius:12px; border:1px solid rgba(243,139,168,0.35); background:rgba(0,0,0,0.18); color:#f38ba8; font-weight:900; cursor:pointer;">×</button>
            </div>
            <textarea data-skill-desc="${idx}" placeholder="Description" style="width:100%; height:86px; border-radius:12px; border:1px solid rgba(255,255,255,0.12); background:rgba(0,0,0,0.22); color:#fff; padding:10px 12px; resize:vertical;">${esc(sk?.description || "")}</textarea>
        </div>
    `).join("");

    const medalOpts = Object.values(MEDALLIONS).map(md => `<option value="${md.id}" ${m.progression.activeMedallion === md.id ? "selected" : ""}>${md.name}</option>`).join("");
    
    const rebirthSection = (m.progression.level >= 150 || m.progression.reborn || memberEdit) ? `
        <div style="border-top:1px solid rgba(255,255,255,0.10); padding-top:12px;">
            <div style="font-weight:900; margin-bottom:8px; color:#9b59b6;">Rebirth & Medallions</div>
            <div style="display:flex; gap:10px; align-items:center;">
                <label style="display:flex; gap:8px; align-items:center; font-weight:bold;">
                    <input type="checkbox" id="party-mm-reborn" ${m.progression.reborn ? "checked" : ""} ${dis}> Is Reborn
                </label>
                <select id="party-mm-medallion" ${dis} style="flex:1; height:34px; border-radius:10px; border:1px solid rgba(255,255,255,0.10); background:rgba(0,0,0,0.18); color:#fff; padding:0 10px;">
                    <option value="">(No Medallion)</option>
                    ${medalOpts}
                </select>
            </div>
        </div>
    ` : "";

    const skillsPane = `
        <div style="padding:12px;">
            ${rebirthSection}
            <div style="display:flex; gap:10px; align-items:center; margin-bottom:10px; margin-top:15px;">
                <div style="font-weight:900;">Skills</div>
                ${memberEdit ? `<button id="party-mm-add-skill" style="margin-left:auto; height:34px; padding:0 12px; border-radius:12px; border:1px solid rgba(241,196,15,0.30); background:rgba(241,196,15,0.18); color:#f1c40f; font-weight:900; cursor:pointer;">Add</button>` : ``}
            </div>
            ${memberEdit
                ? (skillsEditRows || `<div style="opacity:0.7; font-weight:900; padding:10px; border:1px dashed rgba(255,255,255,0.18); border-radius:14px;">No skills yet.</div>`)
                : `<div style="max-height:min(60vh, 420px); overflow:auto; display:flex; flex-direction:column; gap:8px;">${skillsList || `<div style="opacity:0.6; font-weight:900;">No skills</div>`}</div>`
            }
            ${memberEdit ? `<div style="margin-top:12px;"><button id="party-mm-save" style="width:100%; height:42px; border:1px solid rgba(241,196,15,0.30); background:rgba(241,196,15,0.18); color:#f1c40f; font-weight:900; cursor:pointer;">Save Changes</button></div>` : ``}
        </div>
    `;

    $("#uie-party-member-content").html(`
        <div style="display:flex; flex-direction:column; min-height:0;">
            ${mmTabs}
            <div style="flex:1; min-height:0; overflow:auto; padding-bottom:18px;">
                <div id="party-mm-pane-sheet" style="display:${memberModalTab === "sheet" ? "block" : "none"};">${sheetPane}</div>
                <div id="party-mm-pane-equip" style="display:${memberModalTab === "equip" ? "block" : "none"};">${equipPane}</div>
                <div id="party-mm-pane-skills" style="display:${memberModalTab === "skills" ? "block" : "none"};">${skillsPane}</div>
            </div>
        </div>
    `);
}

function openMemberModal(s, id, edit = false) {
    const m = getMember(s, id);
    if (!m) return;
    ensureMember(m);
    selectedId = String(m.id);
    memberModalOpen = true;
    memberEdit = edit === true;
    $("#uie-party-member-modal").css({ display: "block" });
    const card = $("#uie-party-member-card");
    if (card && card.length) {
        try {
            const vw = window.innerWidth || document.documentElement.clientWidth || 0;
            const vh = window.innerHeight || document.documentElement.clientHeight || 0;
            const w = Math.min(680, Math.floor(vw * 0.96));
            const h = Math.min(740, Math.floor(vh * 0.92));
            const x = Math.max(10, Math.floor((vw - w) / 2));
            const y = Math.max(10, Math.floor((vh - h) / 2));
            card.css({ left: x, top: y, right: "", bottom: "", width: w, height: h });
        } catch (_) {}
    }
    renderMemberModal(s, m);
}

function closeMemberModal() {
    memberModalOpen = false;
    memberEdit = false;
    $("#uie-party-member-modal").hide();
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
    const s = getSettings();
    ensureParty(s);

    $(document).off("click.party change.party");
    let lastTouchOpenAt = 0;
    
    $(document).on("click.party", ".uie-party-tab", function() {
        tab = $(this).data("tab");
        render();
    });

    $(document).on("click.party", ".party-mm-tab", function (e) {
        e.preventDefault();
        e.stopPropagation();
        memberModalTab = String($(this).data("tab") || "sheet");
        const s2 = getSettings();
        const m = selectedId ? getMember(s2, selectedId) : null;
        if (m) renderMemberModal(s2, m);
    });

    $(document).on("click.party", "#party-add", function() {
        const s = getSettings();
        s.party.members.push(defaultMember("New Member"));
        saveSettings();
        render();
    });

    $(document).on("click.party", "#party-import-user", function() {
        importUser(getSettings());
    });

    $(document).on("click.party", "#party-import-char", function() {
        importChatChar(getSettings());
    });

    $(document).on("click.party", "#uie-party-save-meta", function() {
        const s = getSettings();
        s.party.name = $("#uie-party-name-input").val();
        saveSettings();
        render();
        if(window.toastr) toastr.success("Party info saved.");
    });

    $(document).on("click.party", "#uie-party-bg-edit", async function (e) {
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

    $(document).on("click.party", "#uie-party-member-bg-edit", async function (e) {
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
            card.style.backgroundImage = `linear-gradient(180deg, rgba(0,0,0,0.25), rgba(0,0,0,0.55)), url("${img}")`;
            card.style.backgroundSize = "cover";
            card.style.backgroundPosition = "center";
        }
    });

    $(document).on("click.party pointerup.party", ".party-row", function(e) {
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
        openMemberModal(getSettings(), String($(this).data("id")));
    });

    $(document).on("click.party pointerup.party", ".party-form-member", function(e) {
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
        openMemberModal(getSettings(), String($(this).data("id")));
    });

    $(document).on("click.party", "#uie-party-member-close", function(e){
        e.preventDefault();
        e.stopPropagation();
        closeMemberModal();
    });

    $(document).on("click.party", "#uie-party-member-modal", function(e){
        if (e.target && e.target.id !== "uie-party-member-modal") return;
        e.preventDefault();
        e.stopPropagation();
        closeMemberModal();
    });

    $(document).on("click.party", "#party-paperdoll-pick", async function(e){
        e.preventDefault();
        e.stopPropagation();
        const s2 = getSettings();
        const m = selectedId ? getMember(s2, selectedId) : null;
        if (!m) return;
        await pickPortraitForMember(s2, m, "paperDoll");
    });

    $(document).on("click.party", "#party-mm-add-skill", function (e) {
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

    $(document).on("click.party", ".party-mm-skill-del", function (e) {
        e.preventDefault();
        e.stopPropagation();
        const idx = Number($(this).data("skill-del"));
        if (!Number.isFinite(idx)) return;
        const s2 = getSettings();
        const m = selectedId ? getMember(s2, selectedId) : null;
        if (!m) return;
        ensureMember(m);
        m.skills.splice(idx, 1);
        saveSettings();
        renderMemberModal(s2, m);
    });

    $(document).on("click.party", "#party-mm-save", function(e){
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

    $(document).on("click.party", ".party-fx", function (e) {
        e.preventDefault();
        e.stopPropagation();
        const txt = String(this.getAttribute("title") || "").trim();
        if (!txt) return;
        let box = document.getElementById("uie-party-fx-pop");
        if (!box) {
            box = document.createElement("div");
            box.id = "uie-party-fx-pop";
            box.style.cssText = "position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:2147483656;max-width:min(380px,92vw);padding:12px 14px;border-radius:16px;border:1px solid rgba(255,255,255,0.12);background:rgba(15,10,8,0.96);color:#fff;font-weight:900;";
            document.body.appendChild(box);
            box.addEventListener("click", () => { try { box.remove(); } catch (_) {} });
        }
        box.textContent = txt;
    });

    $(document).on("click.party", ".party-skill", function (e) {
        e.preventDefault();
        e.stopPropagation();
        const name = String(this.getAttribute("data-name") || "").trim();
        const desc = String(this.getAttribute("data-desc") || "").trim();
        const txt = desc ? `${name}\n\n${desc}` : name;
        if (!txt.trim()) return;
        let box = document.getElementById("uie-party-skill-pop");
        if (!box) {
            box = document.createElement("div");
            box.id = "uie-party-skill-pop";
            box.style.cssText = "position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:2147483647;max-width:min(420px,92vw);max-height:min(60vh,520px);overflow:auto;white-space:pre-wrap;padding:12px 14px;border-radius:16px;border:1px solid rgba(255,255,255,0.12);background:rgba(15,10,8,0.96);color:#fff;font-weight:900;";
            document.body.appendChild(box);
            box.addEventListener("click", () => { try { box.remove(); } catch (_) {} });
        }
        box.textContent = txt;
    });

    $(document).on("click.party", ".party-mini", function(e) {
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

    $(document).on("change.party", "#party-tac-preset, #party-tac-conserve, #party-tac-protect-leader", function(e){
        e.preventDefault();
        const s2 = getSettings();
        ensureParty(s2);
        if (!s2.party.partyTactics) s2.party.partyTactics = { preset: "Balanced", conserveMana: false, protectLeader: false };
        s2.party.partyTactics.preset = String($("#party-tac-preset").val() || "Balanced");
        s2.party.partyTactics.conserveMana = !!$("#party-tac-conserve").prop("checked");
        s2.party.partyTactics.protectLeader = !!$("#party-tac-protect-leader").prop("checked");
        saveSettings();
    });

    $(document).on("change.party", ".member-tac-preset, .member-tac-focus, .member-tac-protect, .member-tac-mana", function(e){
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

    $(document).on("click.party", ".form-add", function(e){
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

    $(document).on("click.party", ".form-rm", function(e){
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

    $(document).on("click.party", ".form-mv", function(e){
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

    $(document).on("change.party", ".form-role", function(e){
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

    $(document).on("click.party", "#pm-save", function() {
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

        const isUser = Array.isArray(m.roles) && m.roles.includes("User");
        if (isUser) {
            applyMemberToCore(s, m);
            try { $(document).trigger("uie:updateVitals"); } catch (_) {}
        }

        saveSettings();
        if(window.toastr) toastr.success("Member saved.");
        render();
    });

    $(document).on("click.party", "#party-pick-portrait", async function() {
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
