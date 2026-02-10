import { getSettings, commitStateUpdate } from "./core.js";
import { getContext } from "/scripts/extensions.js";
import { generateContent } from "./apiClient.js";
import { notify } from "./notifications.js";
import { normalizeStatusList, normalizeStatusEffect, statusKey } from "./statusFx.js";
import { getChatTranscriptText, getRecentChatSnippet } from "./chatLog.js";
import { safeJsonParseObject } from "./jsonUtil.js";

function cloneJsonSafe(v) {
    try {
        return JSON.parse(JSON.stringify(v));
    } catch (_) {
        return null;
    }
}

function ensureUndoStore() {
    try {
        const w = typeof window !== "undefined" ? window : globalThis;
        if (!w.UIE_scanUndo) w.UIE_scanUndo = { byMesId: {}, lastMesId: null };
        if (!w.UIE_scanUndo.byMesId || typeof w.UIE_scanUndo.byMesId !== "object") w.UIE_scanUndo.byMesId = {};
        return w.UIE_scanUndo;
    } catch (_) {
        return { byMesId: {}, lastMesId: null };
    }
}

function readUndoMesIdFromArgs(args) {
    try {
        const v = args && args.length ? args[0] : null;
        const n = Number(v);
        if (Number.isFinite(n) && n >= 0) return n;
    } catch (_) {}
    return null;
}

function fingerprintChatMessage(m) {
    try {
        if (!m || typeof m !== "object") return "";
        const name = String(m.name ?? "");
        const isUser = m.is_user ? "1" : "0";
        const send = String(m.send_date ?? "");
        const mes = String(m.mes ?? "");
        const head = mes.length > 240 ? mes.slice(0, 240) : mes;
        const tail = mes.length > 240 ? mes.slice(-120) : "";
        return `${isUser}|${name}|${send}|${mes.length}|${head}|${tail}`;
    } catch (_) {
        return "";
    }
}

function readChatTailFingerprint() {
    try {
        const w = typeof window !== "undefined" ? window : globalThis;
        const arr = Array.isArray(w?.chat) ? w.chat : null;
        if (!arr || !arr.length) return "";
        return fingerprintChatMessage(arr[arr.length - 1]);
    } catch (_) {
        return "";
    }
}

function snapshotScanTouchedState(s) {
    const keys = [
        "worldState",
        "inventory",
        "currency",
        "currencySymbol",
        "currencyRate",
        "hp",
        "maxHp",
        "mp",
        "maxMp",
        "life",
        "character",
        "quests",
        "journal",
        "databank",
        "phone",
        "social",
        "socialMeta",
        "party",
        "battle",
    ];
    const out = {};
    for (const k of keys) {
        if (k in s) out[k] = cloneJsonSafe(s[k]);
    }
    return out;
}

function restoreSnapshotIntoSettings(s, snap) {
    const keys = [
        "worldState",
        "inventory",
        "currency",
        "currencySymbol",
        "currencyRate",
        "hp",
        "maxHp",
        "mp",
        "maxMp",
        "life",
        "character",
        "quests",
        "journal",
        "databank",
        "phone",
        "social",
        "socialMeta",
        "party",
        "battle",
    ];
    for (const k of keys) {
        if (Object.prototype.hasOwnProperty.call(snap, k)) {
            const v = cloneJsonSafe(snap[k]);
            if (v === null || v === undefined) delete s[k];
            else s[k] = v;
        } else {
            try { delete s[k]; } catch (_) {}
        }
    }
}

/**
 * Ensures the state tracking object exists.
 */
function ensureState(s) {
    if (!s.worldState) s.worldState = {
        location: "Unknown",
        threat: "None",
        status: "Normal",
        time: "Day",
        weather: "Clear",
        custom: {} // For any other flexible keys
    };
    if (!s.inventory) s.inventory = {};
    if (!Array.isArray(s.inventory.items)) s.inventory.items = [];
    if (!s.life) s.life = {};
    if (!Array.isArray(s.life.trackers)) s.life.trackers = [];
    if (!s.character) s.character = {};
    if (!Array.isArray(s.character.statusEffects)) s.character.statusEffects = [];
}

function readChatSig() {
    try {
        let count = 0;
        let lastId = "";
        try {
            const w = typeof window !== "undefined" ? window : globalThis;
            if (Array.isArray(w?.chat) && w.chat.length) {
                count = w.chat.length;
                const last = w.chat[w.chat.length - 1] || null;
                lastId = String(last?.mesId ?? last?.mesid ?? last?.id ?? "");
                return { count, lastId };
            }
        } catch (_) {}

        const chatEl = document.getElementById("chat");
        if (!chatEl) return { count: 0, lastId: "" };
        const nodes = chatEl.querySelectorAll(".mes");
        count = nodes.length;
        const last = nodes[nodes.length - 1] || null;
        if (last) {
            lastId =
                String(last.getAttribute?.("mesid") || "") ||
                String(last.dataset?.mesId || "") ||
                String(last.getAttribute?.("data-mes-id") || "") ||
                String(last.getAttribute?.("data-id") || "");
        }
        return { count, lastId };
    } catch (_) {
        return { count: 0, lastId: "" };
    }
}

function clamp(n, min, max) {
    n = Number(n);
    if (Number.isNaN(n)) return min;
    return Math.max(min, Math.min(max, n));
}

function findLifeTracker(s, name) {
    const n = String(name || "").trim().toLowerCase();
    if (!n) return null;
    const list = Array.isArray(s?.life?.trackers) ? s.life.trackers : [];
    for (const t of list) {
        if (String(t?.name || "").trim().toLowerCase() === n) return t;
    }
    return null;
}

function ensureSocial(s) {
    if (!s.social || typeof s.social !== "object") s.social = { friends: [], romance: [], family: [], rivals: [] };
    for (const k of ["friends", "romance", "family", "rivals"]) {
        if (!Array.isArray(s.social[k])) s.social[k] = [];
    }
    if (!s.socialMeta || typeof s.socialMeta !== "object") s.socialMeta = { autoScan: false, deletedNames: [] };
    if (!Array.isArray(s.socialMeta.deletedNames)) s.socialMeta.deletedNames = [];
}

function ensureParty(s) {
    if (!s.party) s.party = { members: [], sharedItems: [], relationships: {}, partyTactics: {}, formation: { lanes: { front:[], mid:[], back:[] } } };
    if (!Array.isArray(s.party.members)) s.party.members = [];
    if (!Array.isArray(s.party.sharedItems)) s.party.sharedItems = [];
}

function createMember(name) {
    return {
        id: Date.now() + Math.random().toString(36).substr(2, 5),
        identity: { name: name || "Member", class: "Adventurer", species: "Human" },
        images: { portrait: "" },
        stats: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10, per: 10, luk: 10 },
        vitals: { hp: 100, maxHp: 100, mp: 50, maxMp: 50, ap: 10, maxAp: 10 },
        progression: { level: 1, xp: 0, skillPoints: 0, perkPoints: 0 },
        equipment: {},
        partyRole: "DPS",
        roles: ["Character"],
        statusEffects: [],
        active: true,
        tactics: { preset: "Balanced", focus: "auto" }
    };
}

function ensureEquipArrays(s) {
    if (!s.inventory) s.inventory = {};
    if (!Array.isArray(s.inventory.items)) s.inventory.items = [];
    if (!Array.isArray(s.inventory.equipped)) s.inventory.equipped = [];
}

function roleToTab(role) {
    const r = String(role || "").toLowerCase();
    if (r.includes("romance") || r.includes("lover") || r.includes("dating")) return "romance";
    if (r.includes("family") || r.includes("sister") || r.includes("brother") || r.includes("mother") || r.includes("father")) return "family";
    if (r.includes("rival") || r.includes("enemy") || r.includes("hostile")) return "rivals";
    return "friends";
}

function stripCssBlocks(text) {
    const src = String(text || "").replace(/\r/g, "");
    const lines = src.split("\n");
    const out = [];
    let depth = 0;
    for (const line of lines) {
        const t = String(line || "");
        const s = t.trim();
        if (!s) {
            if (depth === 0) out.push("");
            continue;
        }
        const opens = (s.match(/\{/g) || []).length;
        const closes = (s.match(/\}/g) || []).length;
        if (depth > 0) {
            depth = Math.max(0, depth + opens - closes);
            continue;
        }
        const looksCssStart =
            /^(\.|\#|:root\b|@keyframes\b|@media\b|@font-face\b)/i.test(s) ||
            (s.includes("--") && s.includes(":")) ||
            (s.includes("{") && s.includes(":") && !/\bhttps?:\/\//i.test(s));
        if (looksCssStart) {
            depth = Math.max(1, opens - closes);
            continue;
        }
        out.push(t);
    }
    return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * UNIFIED SCANNER: Scans World State, Loot, and Status in ONE call.
 */
export async function scanEverything(opts = {}) {
    const s = getSettings();
    if (s.enabled === false) return;
    const force = !!opts?.force;
    if (!force && s.generation?.scanAllEnabled === false) return;
    ensureState(s);

    const sourceMesId = (() => {
        const n = Number(opts?.sourceMesId);
        return Number.isFinite(n) && n >= 0 ? n : null;
    })();

    const undo = ensureUndoStore();
    try {
        const sig = readChatSig();
        undo.lastChatLen = Number(sig?.count || 0) || 0;
        undo.lastChatTailFp = readChatTailFingerprint();
    } catch (_) {}
    if (sourceMesId !== null && !undo.byMesId[String(sourceMesId)]) {
        undo.byMesId[String(sourceMesId)] = { before: snapshotScanTouchedState(s), at: Date.now() };
    }

    const gate = (() => {
        try {
            const g = (window.UIE_scanEverythingGate = window.UIE_scanEverythingGate || { inFlight: false, lastAt: 0 });
            const now = Date.now();
            const min = Math.max(1000, Number(s?.generation?.autoScanMinIntervalMs || 8000));
            if (g.inFlight) return { ok: false };
            if (!force && now - Number(g.lastAt || 0) < min) return { ok: false };
            g.inFlight = true;
            g.lastAt = now;
            return { ok: true };
        } catch (_) {
            return { ok: true };
        }
    })();
    if (!gate.ok) return;
    try {

    const chatSnippet = await getChatTranscriptText({ maxMessages: 80, maxChars: 30000 });

    if (!chatSnippet) return;

    // --- PHASE 1: FREE REGEX CHECKS (Currency) ---
    // We check the LAST message for instant currency updates (avoids AI cost/latency for simple gold)
    const lastMsg = await getRecentChatSnippet(1);
    const currencyGain = lastMsg.match(/(?:found|received|gained|picked up|looted|loot|earned|rewarded|added)\s+(\d+)\s*(?:gp|gold|credits|coins|silver)/i);
    const currencyLoss = lastMsg.match(/(?:lost|paid|spent|gave|removed|pay|subtracted)\s+(\d+)\s*(?:gp|gold|credits|coins|silver)/i);

    let currencyChanged = false;
    if (currencyGain) {
        const amt = parseInt(currencyGain[1]);
        s.currency = Math.max(0, Number(s.currency || 0) + amt);
        notify("success", `+ ${amt} ${s.currencySymbol || "G"}`, "Currency", "currency");
        currencyChanged = true;
    }
    if (currencyLoss) {
        const amt = parseInt(currencyLoss[1]);
        s.currency = Math.max(0, Number(s.currency || 0) - amt);
        notify("warning", `- ${amt} ${s.currencySymbol || "G"}`, "Currency", "currency");
        currencyChanged = true;
    }
    if (currencyChanged) {
        // Update currency item display if exists
        const sym = String(s.currencySymbol || "G");
        const curItem = s.inventory.items.find(it => String(it?.type || "").toLowerCase() === "currency" && String(it?.symbol || "") === sym);
        if (curItem) curItem.qty = s.currency;
        else if (currencyGain) { // Auto-create if gained
             s.inventory.items.push({ kind: "item", name: `${sym} Currency`, type: "currency", symbol: sym, description: `Currency item for ${sym}.`, rarity: "common", qty: s.currency, mods: {}, statusEffects: [] });
        }
        saveSettings();
        updateLayout();
    }

    // --- PHASE 2: AI SCAN (Everything Else) ---
    // Only proceed if system checks are allowed
    if (s.enabled === false || s.generation?.allowSystemChecks === false) return;

    const ctx = getContext ? getContext() : {};
    const userName = String(ctx.name1 || "User").trim();
    const charName = String(ctx.name2 || "Character").trim();

    const invNames = (() => {
        try {
            const items = Array.isArray(s?.inventory?.items) ? s.inventory.items : [];
            return Array.from(new Set(items.map(x => String(x?.name || "").trim()).filter(Boolean))).slice(0, 160);
        } catch (_) {
            return [];
        }
    })();
    const skillNames = (() => {
        try {
            const skills = Array.isArray(s?.inventory?.skills) ? s.inventory.skills : [];
            return Array.from(new Set(skills.map(x => String(x?.name || "").trim()).filter(Boolean))).slice(0, 160);
        } catch (_) {
            return [];
        }
    })();
    const prompt = `[UIE_LOCKED]
Analyze the chat history to update the RPG State.
Current World: ${JSON.stringify(s.worldState)}
Current HP: ${Number(s.hp ?? 100)} / ${Number(s.maxHp ?? 100)}
Current MP: ${Number(s.mp ?? 50)} / ${Number(s.maxMp ?? 50)}
Life Trackers: ${JSON.stringify((s.life?.trackers || []).slice(0, 30).map(t => ({ name: t.name, current: t.current, max: t.max })))}
Current Status Effects: ${JSON.stringify((s.character?.statusEffects || []).slice(0, 30))}
Existing Inventory Items: ${JSON.stringify(invNames)}
Existing Skills: ${JSON.stringify(skillNames)}
Existing Social Names: ${JSON.stringify((() => { try { ensureSocial(s); const arr = ["friends","romance","family","rivals"].flatMap(k => (s.social[k] || []).map(p => String(p?.name || "").trim()).filter(Boolean)); return Array.from(new Set(arr)).slice(0, 120); } catch (_) { return []; } })())}
Deleted Social Names: ${JSON.stringify((() => { try { ensureSocial(s); return (s.socialMeta.deletedNames || []).slice(-120); } catch (_) { return []; } })())}

Task: Return a SINGLE JSON object with these keys:
1. "world": Update location, threat, status, time, weather.
2. "inventory": Lists of "added" (items found/acquired/created) and "removed" (items lost/used/given). Ignore currency.
3. "stats": Integer deltas for "hp" and "mp" (e.g. -10, +5).
4. "skills": (optional) { "add":[{"name":"","desc":"","type":"active|passive"}] } for NEW skills learned, purchased, revealed, or used by name.
5. "assets": (optional) { "add":[{"name":"","desc":"","category":""}] } for NEW titles, deeds, key lore assets, etc.
6. "quests": List of new quest objects { "title": "...", "desc": "...", "type": "main|side" } if a NEW quest is explicitly given.
7. "lore": List of new lore objects { "key": "Term", "entry": "Description" } if NEW important lore is revealed.
8. "messages": List of { "from": "Name", "text": "..." } if a character sends a text message/SMS in the chat.
9. "phoneNumbers": (optional) [{ "name":"", "number":"" }] if a phone number is shown/saved (e.g. 404-555-0192).
10. "life": (optional) { "lifeUpdates":[{"name":"","delta":0,"set":null,"max":null}], "newTrackers":[{"name":"","current":0,"max":100,"color":"#89b4fa","notes":""}] }
11. "statusEffects": (optional) { "add":[""], "remove":[""] } (NO EMOJIS)
12. "social": (optional) { "add":[{"name":"","role":"","affinity":50}], "remove":[""] } for ANY character present in the scene.
13. "battle": (optional) { "active": true|false, "enemies":[{"name":"","hp":null,"status":"","threat":""}], "log":[\"...\"] } when combat happens.
14. "party": (optional) { "joined": [{"name":"","class":"","role":""}], "left": ["Name"] } for party roster changes.
15. "equipped": (optional) { "equip": [{"item":"","slot":""}], "unequip": ["slot" or "item"] } if user equips/unequips gear.

Rules:
- "inventory": CHECK AGGRESSIVELY. If the user picks up, buys, is given, or creates an item, ADD IT. Even if implied.
- "added": [{ "name": "Item Name", "type": "item|weapon|armor", "qty": 1, "desc": "Description" }]
- "removed": ["Item Name"]
- "equipped": Only if explicitly stated (e.g. "User equips the sword"). Slot examples: "head","chest","main","off".
- "skills.add": Only add if it is NEW (not in Existing Skills).
- "social": Scan for ANY character names in the chat who are not in 'Existing Social Names'. If a character speaks or is described, ADD THEM.
- "social.add": [{ "name": "Name", "role": "friend|rival|romance|family", "affinity": 50 }]
- "party": Only if they explicitly JOIN or LEAVE the player's traveling party.
- EXCLUDE from social: "${userName}", "System", "Narrator", "Game", "Omniscient", or any metadata card names.
- "world": Keep values short.
- If no change, omit the key or leave empty.
- Status effects should be short labels like "Tired", "Poisoned", "Smells like smoke". No emojis.

Chat:
${chatSnippet}
`;

    const res = await generateContent(prompt, "Unified State Scan");
    if (!res) {
        if (force) {
            try { notify("warning", "Scan blocked: enable 'Allow System Checks (AI)' in UIE Settings.", "Scan", "scanBlocked"); } catch (_) {}
        }
        return;
    }

    try {
        const data = safeJsonParseObject(res);
        if (!data) return;

        let needsSave = false;

        // 1. World State
        if (data.world) {
            s.worldState = { ...s.worldState, ...data.world };
            needsSave = true;
        }

        // 2. Inventory
        if (data.inventory) {
            if (Array.isArray(data.inventory.added)) {
                data.inventory.added.forEach(it => {
                    if (!it || !it.name) return;
                    const exist = s.inventory.items.find(x => x.name === it.name);
                    if (exist) {
                        exist.qty = (exist.qty || 1) + (it.qty || 1);
                        notify("info", `Added ${it.qty || 1}x ${it.name}`, "Inventory", "loot");
                    } else {
                        s.inventory.items.push({
                            kind: "item",
                            name: it.name,
                            type: it.type || "item",
                            description: it.desc || "Found item.",
                            qty: it.qty || 1,
                            rarity: "common",
                            mods: {},
                            statusEffects: []
                        });
                        notify("success", `Found ${it.name}`, "Inventory", "loot");
                    }
                    needsSave = true;
                });
            }
            if (Array.isArray(data.inventory.removed)) {
                data.inventory.removed.forEach(name => {
                    const idx = s.inventory.items.findIndex(x => x.name.toLowerCase().includes(String(name).toLowerCase()));
                    if (idx !== -1) {
                        const it = s.inventory.items[idx];
                        if (it.qty > 1) it.qty--;
                        else s.inventory.items.splice(idx, 1);
                        notify("warning", `Removed ${it.name}`, "Inventory", "loot");
                        needsSave = true;
                    }
                });
            }
        }

        // 3. Stats (HP/MP)
        if (data.stats && typeof data.stats === "object") {
            const dhp = Number(data.stats.hp);
            const dmp = Number(data.stats.mp);
            if (Number.isFinite(dhp) && dhp !== 0) {
                const max = Number.isFinite(Number(s.maxHp)) ? Number(s.maxHp) : 100;
                s.hp = clamp(Number(s.hp ?? max), 0, max);
                s.hp = clamp(s.hp + dhp, 0, max);
                if (dhp < 0) notify("warning", `${dhp} HP`, "Damage", "combat");
                else notify("success", `+${dhp} HP`, "Healed", "combat");
                needsSave = true;
            }
            if (Number.isFinite(dmp) && dmp !== 0) {
                const max = Number.isFinite(Number(s.maxMp)) ? Number(s.maxMp) : 50;
                s.mp = clamp(Number(s.mp ?? max), 0, max);
                s.mp = clamp(s.mp + dmp, 0, max);
                needsSave = true;
            }
        }

        // 3.2 Skills
        if (data.skills && (typeof data.skills === "object" || Array.isArray(data.skills))) {
            const add = Array.isArray(data.skills) ? data.skills : (Array.isArray(data.skills.add) ? data.skills.add : []);
            if (!Array.isArray(s.inventory.skills)) s.inventory.skills = [];
            const have = new Set(s.inventory.skills.map(x => String(x?.name || "").trim().toLowerCase()).filter(Boolean));
            let added = 0;
            for (const sk of add.slice(0, 40)) {
                const nm = String(sk?.name || "").trim();
                if (!nm) continue;
                const key = nm.toLowerCase();
                if (have.has(key)) continue;
                s.inventory.skills.push({
                    kind: "skill",
                    name: nm,
                    description: String(sk?.desc || "").trim().slice(0, 1200),
                    type: String(sk?.type || "active").trim()
                });
                have.add(key);
                added++;
            }
            if (added) {
                notify("success", `Learned ${added} skill(s).`, "Skills", "loot");
                needsSave = true;
            }
        }

        // 3.3 Assets
        if (data.assets && (typeof data.assets === "object" || Array.isArray(data.assets))) {
            const add = Array.isArray(data.assets) ? data.assets : (Array.isArray(data.assets.add) ? data.assets.add : []);
            if (!Array.isArray(s.inventory.assets)) s.inventory.assets = [];
            const have = new Set(s.inventory.assets.map(x => String(x?.name || "").trim().toLowerCase()).filter(Boolean));
            let added = 0;
            for (const a of add.slice(0, 40)) {
                const nm = String(a?.name || "").trim();
                if (!nm) continue;
                const key = nm.toLowerCase();
                if (have.has(key)) continue;
                s.inventory.assets.push({
                    kind: "asset",
                    name: nm,
                    description: String(a?.desc || "").trim().slice(0, 1200),
                    category: String(a?.category || "").trim().slice(0, 80)
                });
                have.add(key);
                added++;
            }
            if (added) {
                notify("info", `Added ${added} asset(s).`, "Assets", "loot");
                needsSave = true;
            }
        }

        // 3.5 Life Trackers
        if (data.life && typeof data.life === "object") {
            const lifeUpdates = Array.isArray(data.life.lifeUpdates) ? data.life.lifeUpdates : [];
            const newTrackers = Array.isArray(data.life.newTrackers) ? data.life.newTrackers : [];
            let changed = false;

            for (const nt of newTrackers) {
                const nm = String(nt?.name || "").trim();
                if (!nm) continue;
                if (findLifeTracker(s, nm)) continue;
                const cur = Number(nt?.current ?? 0);
                const mx = Number(nt?.max ?? 100);
                const color = String(nt?.color || "#89b4fa");
                const notes = String(nt?.notes || "");
                s.life.trackers.push({ name: nm.slice(0, 60), current: cur, max: mx, color: color.slice(0, 30), notes: notes.slice(0, 240), updatedAt: Date.now() });
                changed = true;
            }

            for (const u of lifeUpdates) {
                const nm = String(u?.name || "").trim();
                if (!nm) continue;
                let t = findLifeTracker(s, nm);
                if (!t) {
                    t = { name: nm.slice(0, 60), current: 0, max: 100, color: "#89b4fa", notes: "" };
                    s.life.trackers.push(t);
                }
                if (u?.max !== null && u?.max !== undefined && Number.isFinite(Number(u.max))) t.max = Number(u.max);
                if (u?.set !== null && u?.set !== undefined && Number.isFinite(Number(u.set))) t.current = Number(u.set);
                else if (Number.isFinite(Number(u?.delta))) t.current = Number(t.current ?? 0) + Number(u.delta);
                t.current = clamp(t.current, 0, Math.max(1, Number(t.max ?? 100)));
                t.updatedAt = Date.now();
                changed = true;
            }
            if (changed) needsSave = true;
        }

        // 3.6 Status Effects
        if (data.statusEffects && typeof data.statusEffects === "object") {
            const add = Array.isArray(data.statusEffects.add) ? data.statusEffects.add : [];
            const rem = Array.isArray(data.statusEffects.remove) ? data.statusEffects.remove : [];
            const now = Date.now();
            const cur = normalizeStatusList(s.character.statusEffects, now);
            const map = new Map(cur.map(x => [statusKey(x), x]).filter(([k, v]) => k && v));
            let changed = false;
            for (const r of rem) {
                const k = statusKey(r);
                if (k && map.has(k)) { map.delete(k); changed = true; }
            }
            for (const a of add) {
                const fx = normalizeStatusEffect(a, now);
                if (!fx) continue;
                const k = statusKey(fx);
                if (!k || map.has(k)) continue;
                map.set(k, fx);
                changed = true;
            }
            if (changed) {
                s.character.statusEffects = Array.from(map.values()).slice(0, 40);
                needsSave = true;
            }
        }

        // 4. Quests
        if (Array.isArray(data.quests)) {
            if (!s.journal) s.journal = []; // Wait, journal is array of pages or quests?
            // Checking journal.js structure: s.journal is likely Quest Log or Diary?
            // Earlier I saw diary.js using s.diary.
            // journal.js uses s.journal for quests.
            if (!s.journal) s.journal = { quests: [], active: 0 };
            if (Array.isArray(s.journal)) { // Legacy fix? Or is it s.quests?
                 // Let's assume s.quests for Quests and s.diary for Diary.
                 // Checking journal.js again...
                 // It uses s.quests (implied by "ingestQuestsFromChatText"?)
                 // No, earlier grep showed "s.diary".
                 // Let's use s.quests for Quests.
            }
            if (!s.quests) s.quests = [];

            data.quests.forEach(q => {
                if (!q.title) return;
                // Check dupes
                if (s.quests.some(x => x.title === q.title)) return;
                s.quests.push({
                    id: Date.now() + Math.random(),
                    title: q.title,
                    desc: q.desc || "",
                    status: "active",
                    type: q.type || "side"
                });
                notify("info", `New Quest: ${q.title}`, "Journal", "quest");
                needsSave = true;
            });
        }

        // 5. Lore (Databank)
        if (Array.isArray(data.lore)) {
            if (!s.databank) s.databank = [];
            data.lore.forEach(l => {
                if (!l.key || !l.entry) return;
                if (s.databank.some(x => x.key === l.key)) return;
                s.databank.push({
                    key: l.key,
                    content: l.entry,
                    tags: ["auto"],
                    created: Date.now()
                });
                notify("info", `New Lore: ${l.key}`, "Databank", "database");
                needsSave = true;
            });
        }

        // 6. Messages (Phone)
        if (Array.isArray(data.messages)) {
            if (!s.phone) s.phone = { smsThreads: {} };
            if (!s.phone.smsThreads) s.phone.smsThreads = {};

            data.messages.forEach(m => {
                if (!m.from || !m.text) return;
                const threadId = m.from;
                if (!s.phone.smsThreads[threadId]) s.phone.smsThreads[threadId] = [];
                s.phone.smsThreads[threadId].push({
                    isUser: false,
                    text: m.text,
                    ts: Date.now()
                });
                notify("success", `Message from ${m.from}`, "Phone", "phoneMessages");
                needsSave = true;
            });
        }

        // 7. Social
        if (data.social && typeof data.social === "object") {
            ensureSocial(s);
            const deleted = new Set((s.socialMeta.deletedNames || []).map(x => String(x || "").toLowerCase().trim()).filter(Boolean));
            const existingLower = new Set(["friends", "romance", "family", "rivals"].flatMap(k => (s.social[k] || []).map(p => String(p?.name || "").toLowerCase().trim()).filter(Boolean)));
            const addList = Array.isArray(data.social.add) ? data.social.add : [];
            let added = 0;
            for (const v of addList.slice(0, 24)) {
                const nm = String(v?.name || "").trim();
                if (!nm) continue;
                const key = nm.toLowerCase();
                if (deleted.has(key)) continue;
                if (existingLower.has(key)) continue;
                const tab = roleToTab(v?.role);
                const aff = Math.max(0, Math.min(100, Math.round(Number(v?.affinity ?? 50))));
                s.social[tab].push({
                    id: `person_${Date.now().toString(16)}_${Math.floor(Math.random() * 1e9).toString(16)}`,
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
                    relationshipStatus: String(v?.role || "").trim().slice(0, 80),
                    url: "",
                    tab,
                    memories: [],
                    met_physically: true
                });
                existingLower.add(key);
                added++;
            }
            if (added) needsSave = true;
        }

        // 7.5 Phone Numbers
        if (Array.isArray(data.phoneNumbers)) {
            if (!s.phone || typeof s.phone !== "object") s.phone = { smsThreads: {}, numberBook: [] };
            if (!Array.isArray(s.phone.numberBook)) s.phone.numberBook = [];
            const normalizeNumber = (raw) => String(raw || "").replace(/[^\d+]/g, "").replace(/^1(?=\d{10}$)/, "");
            const seen = new Set(s.phone.numberBook.map(x => normalizeNumber(x?.number || "")).filter(Boolean));
            let added = 0;
            for (const it of data.phoneNumbers.slice(0, 30)) {
                const nm = String(it?.name || "").trim() || "Unknown";
                const numRaw = String(it?.number || "").trim();
                const digits = normalizeNumber(numRaw);
                if (!digits) continue;
                if (seen.has(digits)) continue;
                s.phone.numberBook.push({ name: nm.slice(0, 60), number: numRaw.slice(0, 40), ts: Date.now() });
                seen.add(digits);
                added++;
            }
            if (added) {
                notify("success", `Saved ${added} contact(s).`, "Phone", "phoneCalls");
                needsSave = true;
            }
        }

        // 8. Battle
        if (data.battle && typeof data.battle === "object") {
            if (!s.battle || typeof s.battle !== "object") s.battle = { auto: false, state: { active: false, enemies: [], turnOrder: [], log: [] } };
            if (!s.battle.state || typeof s.battle.state !== "object") s.battle.state = { active: false, enemies: [], turnOrder: [], log: [] };
            if (typeof data.battle.active === "boolean") s.battle.state.active = data.battle.active;
            if (Array.isArray(data.battle.enemies)) {
                const normEnemies = data.battle.enemies
                    .map(e => ({
                        name: String(e?.name || "").trim(),
                        hp: (e?.hp === null || e?.hp === undefined) ? null : Number(e.hp),
                        status: String(e?.status || "").trim().slice(0, 60),
                        threat: String(e?.threat || "").trim().slice(0, 60)
                    }))
                    .filter(e => e.name)
                    .slice(0, 12);
                if (!Array.isArray(s.battle.state.enemies)) s.battle.state.enemies = [];
                s.battle.state.enemies = normEnemies;
                needsSave = true;
            }
            if (Array.isArray(data.battle.log)) {
                if (!Array.isArray(s.battle.state.log)) s.battle.state.log = [];
                for (const line of data.battle.log.slice(0, 10)) {
                    const t = String(line || "").trim();
                    if (!t) continue;
                    s.battle.state.log.push(t.slice(0, 200));
                }
                s.battle.state.log = s.battle.state.log.slice(-120);
                needsSave = true;
            }
        }

        // 9. Party
        if (data.party && typeof data.party === "object") {
            ensureParty(s);
            // Joined
            if (Array.isArray(data.party.joined)) {
                for (const p of data.party.joined) {
                    const nm = String(p?.name || "").trim();
                    if (!nm) continue;
                    // Check duplicate
                    if (s.party.members.some(m => m.identity.name.toLowerCase() === nm.toLowerCase())) continue;

                    const m = createMember(nm);
                    if (p.class) m.identity.class = String(p.class).trim().slice(0, 40);
                    if (p.role) m.partyRole = String(p.role).trim().slice(0, 40);

                    // Try to link avatar from social
                    ensureSocial(s);
                    const friend = ["friends","romance","family","rivals"].flatMap(k => s.social[k]).find(x => x.name.toLowerCase() === nm.toLowerCase());
                    if (friend && friend.avatar) m.images.portrait = friend.avatar;

                    s.party.members.push(m);
                    notify("success", `${nm} joined the party!`, "Party", "party");
                    needsSave = true;
                }
            }
            // Left
            if (Array.isArray(data.party.left)) {
                for (const name of data.party.left) {
                    const idx = s.party.members.findIndex(m => m.identity.name.toLowerCase() === String(name).toLowerCase());
                    if (idx !== -1) {
                        const m = s.party.members[idx];
                        s.party.members.splice(idx, 1);
                        notify("info", `${m.identity.name} left the party.`, "Party", "party");
                        needsSave = true;
                    }
                }
            }
        }

        // 10. Equipped (User)
        if (data.equipped && typeof data.equipped === "object") {
            ensureEquipArrays(s);
            // Equip
            if (Array.isArray(data.equipped.equip)) {
                for (const eq of data.equipped.equip) {
                    const itemName = String(eq?.item || "").trim();
                    const slot = String(eq?.slot || "").trim().toLowerCase();
                    if (!itemName || !slot) continue;

                    // Find item in inventory
                    const idx = s.inventory.items.findIndex(x => x.name.toLowerCase().includes(itemName.toLowerCase()));
                    if (idx === -1) continue;

                    const item = s.inventory.items[idx];

                    // Unequip existing slot if any
                    const existingIdx = s.inventory.equipped.findIndex(x => x.slotId === slot);
                    if (existingIdx !== -1) {
                         const old = s.inventory.equipped[existingIdx];
                         delete old.slotId;
                         s.inventory.items.push(old);
                         s.inventory.equipped.splice(existingIdx, 1);
                    }

                    // Move new item
                    s.inventory.items.splice(idx, 1);
                    item.slotId = slot;
                    s.inventory.equipped.push(item);
                    notify("success", `Equipped ${item.name}`, "Equipment", "armor");
                    needsSave = true;
                }
            }
            // Unequip
            if (Array.isArray(data.equipped.unequip)) {
                for (const val of data.equipped.unequip) {
                    const v = String(val || "").trim().toLowerCase();
                    if (!v) continue;

                    // Try by slot first
                    let eIdx = s.inventory.equipped.findIndex(x => x.slotId === v);
                    // Then by name
                    if (eIdx === -1) eIdx = s.inventory.equipped.findIndex(x => x.name.toLowerCase().includes(v));

                    if (eIdx !== -1) {
                        const item = s.inventory.equipped[eIdx];
                        delete item.slotId;
                        s.inventory.equipped.splice(eIdx, 1);
                        s.inventory.items.push(item);
                        notify("info", `Unequipped ${item.name}`, "Equipment", "armor");
                        needsSave = true;
                    }
                }
            }
        }

        if (needsSave) {
            commitStateUpdate({ save: true, layout: true, emit: true });
            if (sourceMesId !== null) {
                const u = ensureUndoStore();
                u.lastMesId = sourceMesId;
            }
        }

    } catch (e) {
        console.warn("UIE Unified Scan Parse Error:", e);
    }
    } finally {
        try { if (window.UIE_scanEverythingGate) window.UIE_scanEverythingGate.inFlight = false; } catch (_) {}
    }
}

/**
 * Returns the current world state for other modules to use.
 */
export function getWorldState() {
    const s = getSettings();
    ensureState(s);
    return s.worldState;
}

// Deprecated individual exports if needed for backward compat, but we replace usage.
export const scanWorldState = scanEverything;

// Event-based auto scan (no interval)
export function initAutoScanning() {
    try {
        if (window.UIE_autoScanBound) return;
        window.UIE_autoScanBound = true;
    } catch (_) {}

    try {
        const src = window.eventSource;
        const types = window.event_types;
        if (!src || !types) return;

        let t = null;
        const trigger = (...args) => {
            try {
                const s = getSettings();
                if (!s || s.enabled === false) return;
                if (s.generation?.scanAllEnabled === false) return;
                if (s.generation?.scanOnlyOnGenerateButtons === true) return;
            } catch (_) {}
            const mesId = readUndoMesIdFromArgs(args);

            try {
                const u = ensureUndoStore();
                const sig = readChatSig();
                u.lastChatLen = Number(sig?.count || 0) || 0;
                u.lastChatTailFp = readChatTailFingerprint();
            } catch (_) {}

            if (t) clearTimeout(t);
            t = setTimeout(() => { scanEverything({ sourceMesId: mesId }).catch(() => {}); }, 400);
        };

        src.on(types.MESSAGE_RECEIVED, trigger);
        src.on(types.GENERATION_ENDED, trigger);

        src.on(types.MESSAGE_DELETED, () => {
            try {
                const u = ensureUndoStore();
                const prevLen = Number(u.lastChatLen || 0) || 0;
                const prevTailFp = String(u.lastChatTailFp || "");

                const sig = readChatSig();
                const curLen = Number(sig?.count || 0) || 0;
                const curTailFp = readChatTailFingerprint();

                const looksLikeSingleDeletion = prevLen > 0 && curLen >= 0 && prevLen === curLen + 1;
                const tailChanged = prevTailFp && curTailFp !== prevTailFp;

                if (looksLikeSingleDeletion && tailChanged) {
                    const deletedIndex = curLen; // when last message is deleted, the old last index equals new length
                    const last = Number(u.lastMesId);
                    if (Number.isFinite(last) && last === deletedIndex) {
                        const rec = u.byMesId[String(deletedIndex)];
                        if (rec && rec.before && typeof rec.before === "object") {
                            const s2 = getSettings();
                            restoreSnapshotIntoSettings(s2, rec.before);
                            delete u.byMesId[String(deletedIndex)];
                            u.lastMesId = null;
                            commitStateUpdate({ save: true, layout: true, emit: true, undo: true, mesId: deletedIndex });
                        }
                    }
                } else {
                    // Middle deletions shift indices; without the deleted ID we can't safely undo.
                    // Clear undo buffer to avoid restoring the wrong snapshot later.
                    u.byMesId = {};
                    u.lastMesId = null;
                }

                u.lastChatLen = curLen;
                u.lastChatTailFp = curTailFp;
            } catch (_) {}
        });
    } catch (_) {}
}
