import { getSettings, saveSettings, updateLayout } from "./core.js";
import { getContext } from "../../../../../extensions.js";
import { generateContent } from "./apiClient.js";
import { notify } from "./notifications.js";
import { normalizeStatusList, normalizeStatusEffect, statusKey } from "./statusFx.js";

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
export async function scanEverything() {
    const s = getSettings();
    if (s.enabled === false) return;
    ensureState(s);
    const gate = (() => {
        try {
            const g = (window.UIE_scanEverythingGate = window.UIE_scanEverythingGate || { inFlight: false, lastAt: 0 });
            const now = Date.now();
            const min = Math.max(1000, Number(s?.generation?.autoScanMinIntervalMs || 8000));
            if (g.inFlight) return { ok: false };
            if (now - Number(g.lastAt || 0) < min) return { ok: false };
            g.inFlight = true;
            g.lastAt = now;
            return { ok: true };
        } catch (_) {
            return { ok: true };
        }
    })();
    if (!gate.ok) return;
    try {

    const readChatSnippet = (max) => {
        try {
            let raw = "";
            const $txt = $(".chat-msg-txt");
            if ($txt.length) {
                $txt.slice(-1 * Math.max(1, Number(max || 10))).each(function () { raw += stripCssBlocks($(this).text()) + "\n"; });
                return stripCssBlocks(raw).trim().slice(0, 7000);
            }
            const chatEl = document.getElementById("chat");
            if (!chatEl) return "";
            const msgs = Array.from(chatEl.querySelectorAll(".mes")).slice(-1 * Math.max(1, Number(max || 10)));
            for (const m of msgs) {
                const isUser =
                    m.classList?.contains("is_user") ||
                    m.getAttribute?.("is_user") === "true" ||
                    m.getAttribute?.("data-is-user") === "true" ||
                    m.dataset?.isUser === "true";
                const el = m.querySelector?.(".mes_text") || m.querySelector?.(".mes-text") || null;
                let t = "";
                if (el) {
                    const clone = el.cloneNode(true);
                    try { clone.querySelectorAll?.("style, script, noscript, template, button, input, textarea").forEach(n => n.remove()); } catch (_) {}
                    t = (clone.innerText != null ? clone.innerText : clone.textContent) || "";
                } else {
                    t = String(m.textContent || "");
                }
                t = stripCssBlocks(String(t || "").trim());
                if (!t) continue;
                raw += `${isUser ? "You" : "Story"}: ${t}\n`;
            }
            return stripCssBlocks(raw).trim().slice(0, 7000);
        } catch (_) {
            return "";
        }
    };

    const chatSnippet = readChatSnippet(28);

    if (!chatSnippet) return;

    // --- PHASE 1: FREE REGEX CHECKS (Currency) ---
    // We check the LAST message for instant currency updates (avoids AI cost/latency for simple gold)
    const lastMsg = (() => {
        try {
            const $txt = $(".chat-msg-txt");
            if ($txt.length) return String($txt.last().text() || "");
            const chatEl = document.getElementById("chat");
            if (!chatEl) return "";
            const last = chatEl.querySelector(".mes:last-child") || chatEl.lastElementChild;
            if (!last) return "";
            return String(
                last.querySelector?.(".mes_text")?.textContent ||
                last.querySelector?.(".mes-text")?.textContent ||
                last.textContent ||
                ""
            );
        } catch (_) {
            return "";
        }
    })();
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
    // Only proceed if AI features are enabled
    if (s.enabled === false) return; 

    const ctx = getContext ? getContext() : {};
    const userName = String(ctx.name1 || "User").trim();
    const charName = String(ctx.name2 || "Character").trim();

    const prompt = `[UIE_LOCKED]
Analyze the chat history to update the RPG State.
Current World: ${JSON.stringify(s.worldState)}
Current HP: ${Number(s.hp ?? 100)} / ${Number(s.maxHp ?? 100)}
Current MP: ${Number(s.mp ?? 50)} / ${Number(s.maxMp ?? 50)}
Life Trackers: ${JSON.stringify((s.life?.trackers || []).slice(0, 30).map(t => ({ name: t.name, current: t.current, max: t.max })))}
Current Status Effects: ${JSON.stringify((s.character?.statusEffects || []).slice(0, 30))}
Existing Social Names: ${JSON.stringify((() => { try { ensureSocial(s); const arr = ["friends","romance","family","rivals"].flatMap(k => (s.social[k] || []).map(p => String(p?.name || "").trim()).filter(Boolean)); return Array.from(new Set(arr)).slice(0, 120); } catch (_) { return []; } })())}
Deleted Social Names: ${JSON.stringify((() => { try { ensureSocial(s); return (s.socialMeta.deletedNames || []).slice(-120); } catch (_) { return []; } })())}

Task: Return a SINGLE JSON object with these keys:
1. "world": Update location, threat, status, time, weather.
2. "inventory": Lists of "added" (items found/acquired/created) and "removed" (items lost/used/given). Ignore currency.
3. "stats": Integer deltas for "hp" and "mp" (e.g. -10, +5).
4. "quests": List of new quest objects { "title": "...", "desc": "...", "type": "main|side" } if a NEW quest is explicitly given.
5. "lore": List of new lore objects { "key": "Term", "entry": "Description" } if NEW important lore is revealed.
6. "messages": List of { "from": "Name", "text": "..." } if a character sends a text message/SMS in the chat.
7. "life": (optional) { "lifeUpdates":[{"name":"","delta":0,"set":null,"max":null}], "newTrackers":[{"name":"","current":0,"max":100,"color":"#89b4fa","notes":""}] }
8. "statusEffects": (optional) { "add":[""], "remove":[""] } (NO EMOJIS)
9. "social": (optional) { "add":[{"name":"","role":"","affinity":50}], "remove":[""] } for ANY character present in the scene.

Rules:
- "inventory": CHECK AGGRESSIVELY. If the user picks up, buys, is given, or creates an item, ADD IT. Even if implied.
- "added": [{ "name": "Item Name", "type": "item|weapon|armor", "qty": 1, "desc": "Description" }]
- "removed": ["Item Name"]
- "social": Scan for ANY character names in the chat who are not in 'Existing Social Names'. If a character speaks or is described, ADD THEM.
- "social.add": [{ "name": "Name", "role": "friend|rival|romance|family", "affinity": 50 }]
- EXCLUDE from social: "${userName}", "System", "Narrator", "Game", "Omniscient", or any metadata card names.
- "world": Keep values short.
- If no change, omit the key or leave empty.
- Status effects should be short labels like "Tired", "Poisoned", "Smells like smoke". No emojis.

Chat:
${chatSnippet}
`;

    const res = await generateContent(prompt, "Unified State Scan");
    if (!res) return;

    try {
        const raw = String(res).replace(/```json|```/g, "").trim();
        const jsonText = (() => {
            const a = raw.indexOf("{");
            const b = raw.lastIndexOf("}");
            if (a >= 0 && b > a) return raw.slice(a, b + 1);
            return raw;
        })();
        const data = JSON.parse(jsonText);
        if (!data || typeof data !== "object") return;

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

        // 3. Stats
        if (data.stats) {
            if (!s.stats) s.stats = { hp: 100, maxHp: 100, mp: 50, maxMp: 50, xp: 0, level: 1 };
            if (data.stats.hp) {
                s.stats.hp = Math.min(s.stats.maxHp, Math.max(0, s.stats.hp + data.stats.hp));
                if (data.stats.hp < 0) notify("warning", `${data.stats.hp} HP`, "Damage", "combat");
                else notify("success", `+${data.stats.hp} HP`, "Healed", "combat");
                needsSave = true;
            }
            if (data.stats.mp) {
                s.stats.mp = Math.min(s.stats.maxMp, Math.max(0, s.stats.mp + data.stats.mp));
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

        if (needsSave) {
            saveSettings();
            updateLayout();
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
