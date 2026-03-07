import { getSettings, commitStateUpdate } from "./core.js";
import { generateContent } from "./apiClient.js";
import { notify } from "./notifications.js";
import { injectRpEvent } from "./features/rp_log.js";
import { SCAN_TEMPLATES } from "./scanTemplates.js";
import { getChatTranscriptText, getRecentChatSnippet } from "./chatLog.js";
import { safeJsonParseObject } from "./jsonUtil.js";
import { addInventoryItemWithStack, createOpenableContainerItem, normalizeInventoryItem, summarizeItemsForLog } from "./inventoryItems.js";

let bound = false;
let observer = null;
let lastHash = "";
let autoTimer = null;
let autoInFlight = false;
let autoLastAt = 0;

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function simpleHash(str) {
  let h = 0;
  const s = String(str || "");
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return String(h);
}

function ensureBattle(s) {
  if (!s.battle) s.battle = { auto: false, state: { active: false, enemies: [], turnOrder: [], log: [] } };
  if (typeof s.battle.auto !== "boolean") s.battle.auto = false;
  if (!s.battle.state) s.battle.state = { active: false, enemies: [], turnOrder: [], log: [] };
  if (!s.battle.dice || typeof s.battle.dice !== "object") s.battle.dice = { enabled: false, last: null };
  if (typeof s.battle.dice.enabled !== "boolean") s.battle.dice.enabled = false;
  if (!Array.isArray(s.battle.state.enemies)) s.battle.state.enemies = [];
  if (!Array.isArray(s.battle.state.turnOrder)) s.battle.state.turnOrder = [];
  if (!Array.isArray(s.battle.state.log)) s.battle.state.log = [];
  if (!s.ui) s.ui = {};
  if (!s.ui.notifications || typeof s.ui.notifications !== "object") s.ui.notifications = { css: "", categories: {}, lowHp: { enabled: false, threshold: 0.25, lastWarnAt: 0 }, postBattle: { enabled: false, lastSig: "" } };
  if (!s.ui.notifications.postBattle || typeof s.ui.notifications.postBattle !== "object") s.ui.notifications.postBattle = { enabled: false, lastSig: "" };
  if (s.ui.notifications.postBattle.enabled === undefined) s.ui.notifications.postBattle.enabled = false;
  if (s.ui.notifications.postBattle.lastSig === undefined) s.ui.notifications.postBattle.lastSig = "";
}

async function maybePostBattleRewards(chat) {
  const s = getSettings();
  if (!s) return;
  ensureBattle(s);
  if (s.ui?.notifications?.postBattle?.enabled !== true) return;
  if (s.ai && s.ai.loot === false) return;

  const sig = simpleHash(String(chat || "").slice(-800));
  if (sig && s.ui.notifications.postBattle.lastSig === sig) return;
  s.ui.notifications.postBattle.lastSig = sig;
  commitStateUpdate({ save: true, layout: false, emit: true });

  if (!s.inventory) s.inventory = { items: [], skills: [], assets: [], statuses: [] };
  if (!Array.isArray(s.inventory.items)) s.inventory.items = [];

  const sym = String(s.currencySymbol || "G");
  const prompt = `
Return ONLY JSON:
{
  "container": {
    "name":"",
    "type":"",
    "description":"",
    "rarity":"common|uncommon|rare|epic|legendary",
    "contents":[{"name":"","type":"","description":"","rarity":"common|uncommon|rare|epic|legendary","qty":1}]
  },
  "items":[{"name":"","type":"","description":"","rarity":"common|uncommon|rare|epic|legendary","qty":1}],
  "currency":0,
  "xp":0
}
Rules:
- Reward should match the battle and outcomes in the chat.
- Prefer one context-appropriate reward container (bag/crate/chest/case) with 1-6 contents.
- In zombie/post-apocalypse settings, prefer supply crates, duffel bags, and locker caches.
- Do NOT use fantasy treasure chests in modern/zombie settings unless CHAT explicitly mentions chest/treasure.
- If container is omitted, provide loose "items" as fallback.
- currency and xp are integers >= 0.
CHAT:
${String(chat || "").slice(0, 4200)}
`;
  const res = await generateContent(prompt.slice(0, 6000), "System Check");
  if (!res) return;
  const obj = safeJsonParseObject(res);
  if (!obj) return;
  if (!obj || typeof obj !== "object") return;

  const containerObj = (obj.container && typeof obj.container === "object") ? obj.container : null;
  const containerContents = Array.isArray(containerObj?.contents) ? containerObj.contents : [];
  const looseItems = Array.isArray(obj.items) ? obj.items : [];
  const curDelta = Math.max(0, Math.round(Number(obj.currency || 0)));
  const xpDelta = Math.max(0, Math.round(Number(obj.xp || 0)));

  const rewardEntriesRaw = (containerContents.length ? containerContents : looseItems).slice(0, 6);
  const rewardEntries = rewardEntriesRaw
    .map((it) => normalizeInventoryItem({
      kind: "item",
      name: String(it?.name || "").trim().slice(0, 80),
      type: String(it?.type || "Item").trim().slice(0, 50),
      description: String(it?.description || it?.desc || "").trim().slice(0, 900),
      rarity: String(it?.rarity || "common").trim().toLowerCase(),
      qty: Math.max(1, Math.round(Number(it?.qty || 1))),
    }, {
      source: "post_battle",
      chatHint: String(chat || "").slice(0, 2400),
    }))
    .filter((x) => !!x && !!x.name);

  let addedContainers = 0;
  let addedItems = 0;
  let lootSummary = "";
  if (rewardEntries.length) {
    const rewardContainer = createOpenableContainerItem({
      chatHint: String(chat || "").slice(0, 2600),
      containerName: String(containerObj?.name || "").trim().slice(0, 80),
      containerType: String(containerObj?.type || "").trim().slice(0, 60),
      description: String(containerObj?.description || "").trim().slice(0, 900),
      rarity: String(containerObj?.rarity || "uncommon").trim().toLowerCase(),
      contents: rewardEntries,
      source: "post_battle",
    });

    const addOut = addInventoryItemWithStack(s.inventory.items, rewardContainer, {
      source: "post_battle",
      chatHint: String(chat || "").slice(0, 2600),
    });
    if (Number(addOut?.addedStacks || 0) > 0 || Number(addOut?.stackedQty || 0) > 0) {
      addedContainers = 1;
      addedItems = rewardEntries.length;
      lootSummary = summarizeItemsForLog(rewardEntries, 5);
    }
  }

  if (curDelta > 0) {
    s.currency = Math.max(0, Number(s.currency || 0) + curDelta);
    let curItem = s.inventory.items.find(it => String(it?.type || "").toLowerCase() === "currency" && String(it?.symbol || "") === sym);
    if (!curItem) {
      addInventoryItemWithStack(s.inventory.items, {
        kind: "item",
        name: `${sym} Currency`,
        type: "currency",
        symbol: sym,
        description: `Currency item for ${sym}.`,
        rarity: "common",
        qty: Number(s.currency || 0),
        mods: {},
        statusEffects: []
      }, { source: "post_battle_currency" });
      curItem = s.inventory.items.find(it => String(it?.type || "").toLowerCase() === "currency" && String(it?.symbol || "") === sym);
    } else {
      curItem.qty = Number(s.currency || 0);
    }
  }
  if (xpDelta > 0) s.xp = Number(s.xp || 0) + xpDelta;

  commitStateUpdate({ save: true, layout: false, emit: true });
  $(document).trigger("uie:updateVitals");
  try { (await import("./features/items.js")).render?.(); } catch (_) {}

  if (addedContainers) notify("success", "Recovered 1 reward container", "Post-battle", "postBattle");
  if (addedItems) notify("success", `${addedItems} loot item(s) packed`, "Post-battle", "postBattle");
  if (curDelta) notify("success", `+ ${curDelta} ${sym}`, "Post-battle", "postBattle");
  if (xpDelta) notify("success", `+ ${xpDelta} XP`, "Post-battle", "postBattle");
  if (!addedContainers && !curDelta && !xpDelta) notify("info", "No rewards generated.", "Post-battle", "postBattle");

  if (addedContainers || curDelta || xpDelta) {
      const parts = [];
      if (addedContainers) parts.push(`${addedContainers} container`);
      if (addedItems) parts.push(`${addedItems} loot items`);
      if (curDelta) parts.push(`${curDelta} ${sym}`);
      if (xpDelta) parts.push(`${xpDelta} XP`);
      const extra = lootSummary ? ` Loot: ${lootSummary}.` : "";
      try { injectRpEvent(`[System: Post-Battle Rewards: ${parts.join(", ")}.${extra}]`); } catch (_) {}
  }
}

function pct(cur, max) {
  cur = Number(cur || 0);
  max = Number(max || 0);
  if (max <= 0) return 0;
  return Math.max(0, Math.min(100, (cur / max) * 100));
}

async function readChatTail(n = 20) {
  try {
    const t = await getChatTranscriptText({ maxMessages: Math.max(1, Number(n || 20)), maxChars: 4200 });
    if (t) return t;
  } catch (_) {}
  try {
    let raw = "";
    const $txt = $(".chat-msg-txt");
    if ($txt.length) {
      $txt.slice(-n).each(function () { raw += $(this).text() + "\n"; });
      return raw.trim().slice(0, 4200);
    }
  } catch (_) {}
  return "";
}

function mergeEnemies(existing, incoming) {
  const byName = new Map();
  (existing || []).forEach((e) => {
    const k = String(e?.name || "").toLowerCase().trim();
    if (k) byName.set(k, e);
  });

  const toFiniteOrNull = (value, fallback = null) => {
    if (value === null || value === undefined || value === "") return fallback;
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  };

  const mergeStatusEffects = (enemy, prev) => {
    const bits = [];
    const add = (value, maxLen = 50) => {
      const t = String(value || "").trim().slice(0, maxLen);
      if (!t || bits.includes(t)) return;
      bits.push(t);
    };

    if (Array.isArray(enemy?.statusEffects)) {
      enemy.statusEffects.forEach((x) => add(x, 50));
    }

    const status = String(enemy?.status || "").trim();
    const threat = String(enemy?.threat || "").trim();
    if (status) add(status, 50);
    if (threat) add(`Threat: ${threat}`, 48);

    if (Array.isArray(prev?.statusEffects)) {
      prev.statusEffects.forEach((x) => add(x, 50));
    }

    return bits.slice(0, 8);
  };

  const out = [];
  (incoming || []).forEach((e) => {
    const name = String(e?.name || "").trim().slice(0, 60);
    if (!name) return;
    const k = name.toLowerCase();
    const prev = byName.get(k) || {};

    const prevHp = toFiniteOrNull(prev?.hp, null);
    const hp = toFiniteOrNull(e?.hp, prevHp);

    const prevMaxHp = toFiniteOrNull(prev?.maxHp, null);
    const maxHpCandidate = toFiniteOrNull(e?.maxHp, prevMaxHp);
    const maxHp = (maxHpCandidate !== null && maxHpCandidate > 0) ? maxHpCandidate : null;

    const prevLevel = toFiniteOrNull(prev?.level, 0);
    const level = Math.max(0, Math.round(toFiniteOrNull(e?.level, prevLevel) || 0));

    out.push({
      name,
      hp: hp === null ? null : Math.max(0, Math.round(hp)),
      maxHp: maxHp === null ? null : Math.max(1, Math.round(maxHp)),
      level,
      boss: (typeof e?.boss === "boolean")
        ? e.boss
        : (typeof prev?.boss === "boolean" ? prev.boss : /boss|elite/i.test(String(e?.threat || ""))),
      statusEffects: mergeStatusEffects(e, prev)
    });
  });

  return out.slice(0, 12);
}

function laneForRole(role) {
  const r = String(role || "").toLowerCase();
  if (/(tank|bruiser|guardian|vanguard|front)/.test(r)) return "front";
  if (/(healer|mage|caster|ranger|support|sniper|back)/.test(r)) return "back";
  return "mid";
}

function normalizeBattleMember(s, m) {
  if (!m || typeof m !== "object") return null;
  const name = String(m?.identity?.name || m?.name || "").trim();
  if (!name) return null;

  const coreName = String(s?.character?.name || "").trim().toLowerCase();
  const isUser = (Array.isArray(m?.roles) && m.roles.includes("User")) || (!!coreName && name.toLowerCase() === coreName);

  const level = Math.max(1, Math.round(Number(isUser ? (s?.character?.level ?? m?.progression?.level ?? 1) : (m?.progression?.level ?? 1)) || 1));
  const hp = Math.max(0, Number(isUser ? (s?.hp ?? m?.vitals?.hp ?? 0) : (m?.vitals?.hp ?? 0)) || 0);
  const maxHp = Math.max(1, Number(isUser ? (s?.maxHp ?? m?.vitals?.maxHp ?? Math.max(100, hp)) : (m?.vitals?.maxHp ?? Math.max(100, hp))) || 100);
  const mp = Math.max(0, Number(isUser ? (s?.mp ?? m?.vitals?.mp ?? 0) : (m?.vitals?.mp ?? 0)) || 0);
  const maxMp = Math.max(1, Number(isUser ? (s?.maxMp ?? m?.vitals?.maxMp ?? Math.max(50, mp)) : (m?.vitals?.maxMp ?? Math.max(50, mp))) || 50);
  const ap = Math.max(0, Number(isUser ? (s?.ap ?? m?.vitals?.ap ?? 0) : (m?.vitals?.ap ?? 0)) || 0);
  const maxAp = Math.max(1, Number(isUser ? (s?.maxAp ?? m?.vitals?.maxAp ?? Math.max(10, ap)) : (m?.vitals?.maxAp ?? Math.max(10, ap))) || 10);
  const xp = Math.max(0, Number(isUser ? (s?.xp ?? m?.progression?.xp ?? 0) : (m?.progression?.xp ?? 0)) || 0);
  const nextXp = Math.max(100, level * 1000);

  return {
    id: String(m?.id ?? `name:${name.toLowerCase()}`),
    name,
    role: String(m?.partyRole || "DPS").trim() || "DPS",
    className: String(m?.identity?.class || "Adventurer").trim() || "Adventurer",
    level,
    hp,
    maxHp,
    mp,
    maxMp,
    ap,
    maxAp,
    xp,
    nextXp,
    statusEffects: Array.isArray(m?.statusEffects) ? m.statusEffects.slice(0, 6).map(x => String(x || "").trim()).filter(Boolean) : [],
    active: m?.active !== false,
    isUser
  };
}

function buildBattlePartyContext(s) {
  const party = (s?.party && typeof s.party === "object") ? s.party : {};
  const membersRaw = Array.isArray(party.members) ? party.members : [];
  let members = membersRaw.map((m) => normalizeBattleMember(s, m)).filter(Boolean);

  const coreName = String(s?.character?.name || "").trim();
  if (coreName) {
    const hasCore = members.some((m) => m.isUser || m.name.toLowerCase() === coreName.toLowerCase());
    if (!hasCore) {
      const level = Math.max(1, Math.round(Number(s?.character?.level || 1) || 1));
      members.unshift({
        id: "__uie_core_user__",
        name: coreName,
        role: "Leader",
        className: String(s?.character?.className || "Adventurer").trim() || "Adventurer",
        level,
        hp: Math.max(0, Number(s?.hp ?? 0) || 0),
        maxHp: Math.max(1, Number(s?.maxHp ?? 100) || 100),
        mp: Math.max(0, Number(s?.mp ?? 0) || 0),
        maxMp: Math.max(1, Number(s?.maxMp ?? 50) || 50),
        ap: Math.max(0, Number(s?.ap ?? 0) || 0),
        maxAp: Math.max(1, Number(s?.maxAp ?? 10) || 10),
        xp: Math.max(0, Number(s?.xp ?? 0) || 0),
        nextXp: Math.max(100, level * 1000),
        statusEffects: Array.isArray(s?.character?.statusEffects) ? s.character.statusEffects.slice(0, 6).map((x) => String(x || "").trim()).filter(Boolean) : [],
        active: true,
        isUser: true
      });
    }
  }

  const activeMembers = members.filter((m) => m.active !== false);
  members = activeMembers.length ? activeMembers : members;

  const lanesRaw = (party?.formation?.lanes && typeof party.formation.lanes === "object") ? party.formation.lanes : {};
  const lanes = { front: [], mid: [], back: [] };
  const laneById = {};
  const byId = new Map(members.map((m) => [String(m.id), m]));
  const byName = new Map(members.map((m) => [m.name.toLowerCase(), m]));
  const assigned = new Set();

  for (const key of ["front", "mid", "back"]) {
    const ids = Array.isArray(lanesRaw[key]) ? lanesRaw[key] : [];
    for (const rawId of ids) {
      const id = String(rawId || "");
      let m = byId.get(id);
      if (!m && id) m = byName.get(id.toLowerCase());
      if (!m || assigned.has(m.id)) continue;
      lanes[key].push(m);
      laneById[String(m.id)] = key;
      assigned.add(m.id);
    }
  }

  let unassigned = members.filter((m) => !assigned.has(m.id));
  if (!lanes.front.length && !lanes.mid.length && !lanes.back.length && unassigned.length) {
    for (const m of unassigned) {
      const key = laneForRole(m.role);
      lanes[key].push(m);
      laneById[String(m.id)] = key;
    }
    unassigned = [];
  }

  return {
    members,
    lanes,
    unassigned,
    ordered: [...lanes.front, ...lanes.mid, ...lanes.back, ...unassigned],
    laneById,
    tacticPreset: String(party?.partyTactics?.preset || "Balanced"),
    conserveMana: !!party?.partyTactics?.conserveMana,
    protectLeader: !!party?.partyTactics?.protectLeader,
  };
}

function meterRow(label, cur, max, color) {
  const safeMax = Math.max(1, Number(max || 0));
  const safeCur = Math.max(0, Math.min(safeMax, Number(cur || 0)));
  const p = pct(safeCur, safeMax);
  return `<div style="margin-top:6px;">
    <div style="display:flex; justify-content:space-between; font-size:11px; opacity:0.9; font-weight:800;">
      <span>${esc(label)}</span>
      <span>${Math.round(safeCur)}/${Math.round(safeMax)}</span>
    </div>
    <div style="height:7px; border-radius:999px; background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.08); overflow:hidden; margin-top:2px;">
      <div style="height:100%; width:${p}%; background:${color};"></div>
    </div>
  </div>`;
}

function renderFormationPanel($root, ctx) {
  if (!$root || !$root.length) return;
  const laneDefs = [
    { key: "front", label: "Front Lane", color: "#e67e22" },
    { key: "mid", label: "Mid Lane", color: "#f1c40f" },
    { key: "back", label: "Back Lane", color: "#5dade2" },
  ];

  const html = laneDefs.map((lane) => {
    const list = Array.isArray(ctx?.lanes?.[lane.key]) ? ctx.lanes[lane.key] : [];
    const members = list.length
      ? list.slice(0, 8).map((m) => `<div style="padding:4px 8px; border-radius:10px; border:1px solid rgba(255,255,255,0.10); background:rgba(0,0,0,0.22); font-size:12px; font-weight:800; display:flex; justify-content:space-between; gap:8px;">
          <span style="min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(m.name)}</span>
          <span style="opacity:0.72;">Lv${Math.max(1, Number(m.level || 1))}</span>
        </div>`).join("")
      : `<div style="opacity:0.58; font-size:12px; font-weight:700;">Empty</div>`;
    return `<div style="margin-bottom:8px;">
      <div style="font-size:11px; text-transform:uppercase; letter-spacing:0.8px; color:${lane.color}; font-weight:900; margin-bottom:5px;">${lane.label}</div>
      <div style="display:flex; flex-direction:column; gap:5px;">${members}</div>
    </div>`;
  }).join("");

  const reserve = Array.isArray(ctx?.unassigned) ? ctx.unassigned : [];
  const reserveHtml = reserve.length
    ? `<div style="margin-top:6px; padding-top:8px; border-top:1px dashed rgba(255,255,255,0.14);">
        <div style="font-size:11px; text-transform:uppercase; letter-spacing:0.8px; color:#95a5a6; font-weight:900; margin-bottom:5px;">Reserve</div>
        <div style="display:flex; flex-wrap:wrap; gap:6px;">
          ${reserve.slice(0, 8).map((m) => `<span style="padding:3px 7px; border-radius:999px; border:1px solid rgba(255,255,255,0.12); font-size:11px; font-weight:800;">${esc(m.name)}</span>`).join("")}
        </div>
      </div>`
    : "";

  $root.html(html + reserveHtml);
}

function renderPartyStatusPanel($root, ctx) {
  if (!$root || !$root.length) return;
  const members = Array.isArray(ctx?.ordered) ? ctx.ordered : [];
  if (!members.length) {
    $root.html(`<div style="opacity:0.7; font-weight:800;">No party members tracked yet.</div>`);
    return;
  }

  const cards = members.slice(0, 10).map((m) => {
    const lane = String(ctx?.laneById?.[String(m.id)] || "reserve");
    const laneLabel = lane === "front" ? "FRONT" : lane === "mid" ? "MID" : lane === "back" ? "BACK" : "RES";
    const fx = Array.isArray(m.statusEffects) && m.statusEffects.length
      ? esc(m.statusEffects.slice(0, 3).join(", "))
      : "Stable";
    return `<div style="padding:8px; border-radius:12px; border:1px solid rgba(255,255,255,0.10); background:rgba(0,0,0,0.24);">
      <div style="display:flex; align-items:center; gap:8px;">
        <div style="font-weight:900; color:#fff; flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(m.name)}</div>
        <div style="font-size:11px; opacity:0.75; font-weight:900;">${laneLabel}</div>
        <div style="font-size:11px; color:#cba35c; font-weight:900;">Lv${Math.max(1, Number(m.level || 1))}</div>
      </div>
      <div style="font-size:11px; opacity:0.72; margin-top:2px; font-weight:700;">${esc(m.className)} - ${esc(m.role)}</div>
      ${meterRow("HP", m.hp, m.maxHp, "linear-gradient(90deg,#e74c3c,#c0392b)")}
      ${meterRow("MP", m.mp, m.maxMp, "linear-gradient(90deg,#3498db,#2980b9)")}
      ${meterRow("AP", m.ap, m.maxAp, "linear-gradient(90deg,#f1c40f,#d4ac0d)")}
      ${meterRow("XP", m.xp, m.nextXp, "linear-gradient(90deg,#2ecc71,#27ae60)")}
      <div style="margin-top:6px; font-size:11px; opacity:0.82;">${fx}</div>
    </div>`;
  }).join("");

  $root.html(`<div style="display:flex; flex-direction:column; gap:8px;">${cards}</div>`);
}

function buildBattleAdvice(s, st, ctx) {
  const tips = [];
  const members = Array.isArray(ctx?.ordered) ? ctx.ordered : [];
  const enemies = Array.isArray(st?.enemies) ? st.enemies : [];

  if (!members.length) {
    tips.push("No active party members detected. Add members in Party > Roster.");
    return tips;
  }

  const down = members.filter((m) => Number(m.hp || 0) <= 0);
  const low = members.filter((m) => Number(m.hp || 0) > 0 && pct(m.hp, m.maxHp) <= 35);
  if (down.length) tips.push(`${down.length} member(s) are down. Prioritize revive or retreat.`);
  if (low.length) tips.push(`${low.slice(0, 2).map((m) => m.name).join(", ")} need immediate healing.`);

  if (enemies.length && !ctx?.lanes?.front?.length) {
    tips.push("Front lane is empty. Move a tank/bruiser to absorb hits.");
  }

  const knownEnemyLevels = enemies.map((e) => Number(e?.level)).filter((n) => Number.isFinite(n) && n > 0);
  if (knownEnemyLevels.length && members.length) {
    const enemyAvg = knownEnemyLevels.reduce((a, b) => a + b, 0) / knownEnemyLevels.length;
    const partyAvg = members.reduce((a, m) => a + Math.max(1, Number(m.level || 1)), 0) / members.length;
    if (enemyAvg >= partyAvg + 8) {
      tips.push(`Enemy level advantage detected (${Math.round(enemyAvg)} vs ${Math.round(partyAvg)}). Avoid direct trades.`);
    }
  }

  if (enemies.length >= members.length + 2) {
    tips.push("You are outnumbered. Focus-fire weakest targets and protect healers.");
  }

  if (!tips.length) {
    if (st?.active) {
      tips.push(`Formation stable. Preset: ${ctx?.tacticPreset || "Balanced"}.`);
      if (ctx?.conserveMana) tips.push("Mana conservation enabled: rotate basic attacks between skills.");
      if (ctx?.protectLeader) tips.push("Protect Leader is enabled: keep leader out of front lane if fragile.");
    } else {
      tips.push(`Battle idle. Preset: ${ctx?.tacticPreset || "Balanced"}.`);
    }
  }

  return tips.slice(0, 4);
}

function renderAdvicePanel($root, tips) {
  if (!$root || !$root.length) return;
  const lines = Array.isArray(tips) ? tips.filter(Boolean) : [];
  if (!lines.length) {
    $root.empty();
    return;
  }
  $root.html(`<div style="padding:8px; border-radius:12px; border:1px dashed rgba(203,163,92,0.35); background:rgba(30,22,8,0.22); display:flex; flex-direction:column; gap:6px;">
    ${lines.map((t) => `<div style="font-size:12px; line-height:1.35; color:rgba(255,255,255,0.9);">- ${esc(t)}</div>`).join("")}
  </div>`);
}

function fallbackTurnOrder(st, ctx) {
  const explicit = Array.isArray(st?.turnOrder) ? st.turnOrder.map((x) => String(x || "").trim()).filter(Boolean) : [];
  if (explicit.length) return explicit.slice(0, 24);
  const out = [];
  const party = Array.isArray(ctx?.ordered) ? ctx.ordered : [];
  for (const m of party.slice(0, 12)) out.push(`${m.name} (Lv${Math.max(1, Number(m.level || 1))})`);
  const enemies = Array.isArray(st?.enemies) ? st.enemies : [];
  for (const e of enemies.slice(0, 12)) {
    const nm = String(e?.name || "").trim();
    if (nm) out.push(nm);
  }
  return out.slice(0, 24);
}

export function renderBattle() {
  const s = getSettings();
  if (!s) return;
  ensureBattle(s);

  const st = s.battle.state;
  const partyCtx = buildBattlePartyContext(s);
  $("#uie-battle-auto-state").text(s.battle.auto ? "ON" : "OFF");
  $("#uie-battle-dice-state").text(s.battle.dice?.enabled ? "ON" : "OFF");
  $("#uie-battle-sub").text(st.active ? "Battle ACTIVE" : "Battle idle");

  const $en = $("#uie-battle-enemies");
  const $to = $("#uie-battle-turn");
  const $log = $("#uie-battle-log");
  const $formation = $("#uie-battle-formation");
  const $party = $("#uie-battle-party");
  const $advice = $("#uie-battle-advice");
  if (!$en.length || !$to.length || !$log.length) return;

  $en.empty();
  if (!st.enemies.length) {
    $en.html(`<div style="opacity:0.7; font-weight:800;">No enemies tracked.</div>`);
  } else {
    const tmpl = document.getElementById("uie-battle-enemy-row").content;
    st.enemies.forEach((e) => {
      const hpValue = (e?.hp === null || e?.hp === undefined || e?.hp === "") ? null : Number(e.hp);
      const maxHpValue = (e?.maxHp === null || e?.maxHp === undefined || e?.maxHp === "") ? null : Number(e.maxHp);
      const hpKnown = Number.isFinite(hpValue);
      const maxHpKnown = Number.isFinite(maxHpValue);

      const hpDisplay = hpKnown ? Math.max(0, Math.round(hpValue)) : "?";
      const maxHpDisplay = maxHpKnown ? Math.max(1, Math.round(maxHpValue)) : "?";
      const bar = (hpKnown && maxHpKnown) ? pct(hpDisplay, maxHpDisplay) : 0;

      const el = $(tmpl.cloneNode(true));
      el.find(".en-name").text(e.name);
      if (e.boss) el.find(".en-boss").show();
      el.find(".en-hp-text").text(`HP ${hpDisplay}/${maxHpDisplay}`);
      el.find(".en-bar-fill").css({ width: `${bar}%` });

      const fxContainer = el.find(".en-fx");
      if (Array.isArray(e.statusEffects) && e.statusEffects.length) {
        fxContainer.text(e.statusEffects.join(", "));
      } else {
        fxContainer.remove();
      }
      $en.append(el);
    });
  }

  $to.empty();
  const turnOrder = fallbackTurnOrder(st, partyCtx);
  if (!turnOrder.length) $to.html(`<div style="opacity:0.7; font-weight:800;">No turn order yet.</div>`);
  else {
    const tmpl = document.getElementById("uie-battle-turn-row").content;
    const list = $(`<div style="display:flex; flex-direction:column; gap:8px;"></div>`);
    turnOrder.slice(0, 24).forEach((n, i) => {
        const el = $(tmpl.cloneNode(true));
        el.find(".turn-text").text(`${i + 1}. ${n}`);
        list.append(el);
    });
    $to.append(list);
  }

  const lines = Array.isArray(st.log) ? st.log.slice(-50) : [];
  $log.text(lines.join("\n") || "No log yet.");

  renderFormationPanel($formation, partyCtx);
  renderPartyStatusPanel($party, partyCtx);
  renderAdvicePanel($advice, buildBattleAdvice(s, st, partyCtx));
}

async function scanBattle() {
  const s = getSettings();
  if (!s) return;
  ensureBattle(s);

  const chat = await readChatTail(24);
  if (!chat) return;

  const prompt = SCAN_TEMPLATES.warroom.battle(chat);

  const res = await generateContent(prompt.slice(0, 6000), "System Check");
  if (!res) return;
  const obj = safeJsonParseObject(res);
  if (!obj) return;
  if (!obj || typeof obj !== "object") {
    notify("error", "Scan failed: AI returned invalid data.", "War Room", "api");
    return;
  }

  const st = s.battle.state;
  const prevActive = !!st.active;
  const prevEnemyHp = new Map((Array.isArray(st.enemies) ? st.enemies : []).map(e => [String(e?.name || "").toLowerCase().trim(), Number(e?.hp || 0)]).filter(x => x[0]));
  st.active = !!obj.active;
  const incomingEnemies = Array.isArray(obj.enemies) ? obj.enemies : [];
  st.enemies = mergeEnemies(st.enemies, incomingEnemies);
  st.turnOrder = Array.isArray(obj.turnOrder) ? obj.turnOrder.slice(0, 30).map(x => String(x || "").slice(0, 60)).filter(Boolean) : st.turnOrder;
  const newLog = Array.isArray(obj.log) ? obj.log.slice(0, 80).map(x => String(x || "").slice(0, 160)).filter(Boolean) : [];
  if (newLog.length) st.log = newLog;

  if (!incomingEnemies.length && !obj.active) notify("info", "No combat detected.", "War Room", "api");

  commitStateUpdate({ save: true, layout: false, emit: true });
  renderBattle();
  if (!prevActive && st.active) {
    try {
      const names = (Array.isArray(st.enemies) ? st.enemies : []).map(e => String(e?.name || "").trim()).filter(Boolean).slice(0, 6);
      injectRpEvent(`[System: Combat Started against ${names.length ? names.join(", ") : "unknown enemies"}.]`);
    } catch (_) {}
  }
  try {
    for (const e of (Array.isArray(st.enemies) ? st.enemies : [])) {
      const k = String(e?.name || "").toLowerCase().trim();
      if (!k) continue;
      const prevHp = Number(prevEnemyHp.get(k) || 0);
      const hp = (e?.hp === null || e?.hp === undefined || e?.hp === "") ? NaN : Number(e.hp);
      if (!Number.isFinite(hp)) continue;
      if (prevHp > 0 && hp <= 0) injectRpEvent(`[System: ${String(e?.name || "Enemy")} has been defeated.]`);
    }
  } catch (_) {}
  if (prevActive && !st.active) {
    try { await maybePostBattleRewards(chat); } catch (_) {}
    try { notify("info", "Combat ended. Generate rewards manually if desired.", "War Room", "postBattle"); } catch (_) {}
  }
}

export async function scanBattleNow() {
  return await scanBattle();
}

function startAuto() {
  if (observer) return;
  const chatEl = document.querySelector("#chat");
  if (!chatEl) return;
  observer = new MutationObserver(() => {
    const s = getSettings();
    if (!s) return;
    ensureBattle(s);
      if (s.generation?.scanAllEnabled === false) return;
      if (s.generation?.allowSystemChecks === false) return;
    if (!s.battle.auto) return;
    try {
      if (autoTimer) clearTimeout(autoTimer);
      autoTimer = setTimeout(async () => {
        const now = Date.now();
        const min = Math.max(2000, Number(s?.generation?.systemCheckMinIntervalMs ?? 20000));
        if (autoInFlight) return;
        if (now - autoLastAt < min) return;
        if (s?.generation?.scanOnlyOnGenerateButtons === true) return;
        const txt = await getRecentChatSnippet(1);
        const h = simpleHash(txt);
        if (h === lastHash) return;
        lastHash = h;
        autoInFlight = true;
        autoLastAt = now;
        try {
          const mod = await import("./stateTracker.js");
          if (mod?.scanEverything) await mod.scanEverything({ scope: "battle" });
        } finally { autoInFlight = false; }
      }, 2500);
    } catch (_) {}
  });
  observer.observe(chatEl, { childList: true, subtree: true });
}

export function initBattle() {
  if (bound) return;
  bound = true;
  startAuto();

  const $win = $("#uie-battle-window");
  $win.off(".uieBattle");
  $(document).off(".uieBattle");

  const hideMenu = () => { try { $("#uie-battle-menu").hide(); } catch (_) {} };

  $win.on("pointerup.uieBattle", "#uie-battle-close", function(e){ e.preventDefault(); e.stopPropagation(); hideMenu(); $win.hide(); });

  $win.on("pointerup.uieBattle", "#uie-battle-wand", function (e) {
    e.preventDefault();
    e.stopPropagation();
    const $m = $("#uie-battle-menu");
    if (!$m.length) return;
    if ($m.is(":visible")) $m.hide();
    else $m.css("display", "flex");
  });

  // Close menu if clicked elsewhere in the window
  $win.on("pointerup.uieBattle", function (e) {
    const $m = $("#uie-battle-menu");
    if (!$m.length || !$m.is(":visible")) return;
    if ($(e.target).closest("#uie-battle-menu, #uie-battle-wand").length) return;
    hideMenu();
  });

  $win.on("pointerup.uieBattle", "#uie-battle-scan", async function(e){
    e.preventDefault(); e.stopPropagation();
    hideMenu();
    const el = this;
    if (el?.dataset?.busy === "1") return;
    if (el?.dataset) el.dataset.busy = "1";
    const prev = $(this).text();
    $(this).text("Scanning...");
    try { await scanBattle(); } finally { if (el?.dataset) el.dataset.busy = "0"; $(this).text(prev || "Scan"); }
  });

  $win.on("pointerup.uieBattle", "#uie-battle-auto", function(e){
    e.preventDefault(); e.stopPropagation();
    const s = getSettings();
    ensureBattle(s);
    s.battle.auto = !s.battle.auto;
    commitStateUpdate({ save: true, layout: false, emit: true });
    renderBattle();
  });

  $win.on("pointerup.uieBattle", "#uie-battle-dice-toggle", function(e){
    e.preventDefault(); e.stopPropagation();
    const s = getSettings();
    ensureBattle(s);
    s.battle.dice.enabled = !s.battle.dice.enabled;
    commitStateUpdate({ save: true, layout: false, emit: true });
    renderBattle();
    notify("info", `Dice influence: ${s.battle.dice.enabled ? "ON" : "OFF"}`, "War Room", "api");
  });

  const rollExpr = (expr) => {
    const raw = String(expr || "").trim().toLowerCase().replace(/\s+/g, "");
    const m = raw.match(/^(\d{0,2})d(\d{1,3})([+-]\d{1,4})?$/i);
    if (!m) return null;
    const count = Math.max(1, Math.min(50, Number(m[1] || 1)));
    const sides = Math.max(2, Math.min(1000, Number(m[2] || 20)));
    const mod = Number(m[3] || 0) || 0;
    const rolls = [];
    let sum = 0;
    for (let i = 0; i < count; i++) {
      const r = 1 + Math.floor(Math.random() * sides);
      rolls.push(r);
      sum += r;
    }
    const total = sum + mod;
    return { expr: `${count}d${sides}${mod ? (mod > 0 ? `+${mod}` : `${mod}`) : ""}`, rolls, mod, total };
  };

  $win.on("pointerup.uieBattle", "#uie-battle-dice-roll", async function(e){
    e.preventDefault(); e.stopPropagation();
    hideMenu();
    const s = getSettings();
    ensureBattle(s);
    const expr = (prompt("Roll which dice? (examples: d20, 2d6+1, d100)", "d20") || "").trim();
    const res = rollExpr(expr);
    if (!res) { notify("warning", "Invalid dice expression.", "War Room", "api"); return; }
    const line = `DICE ${res.expr} => ${res.total}${res.rolls.length ? ` [${res.rolls.join(",")}]` : ""}`;
    s.battle.state.log.push(line.slice(0, 180));
    s.battle.dice.last = { ...res, ts: Date.now() };
    commitStateUpdate({ save: true, layout: false, emit: true });
    renderBattle();
    if (s.battle.dice.enabled) {
      try {
        const mod = await import("./features/rp_log.js");
        const inject = mod?.injectRpEvent;
        if (typeof inject === "function") await inject(`War Room dice roll: ${line}`, { uie: { type: "dice_roll", expr: res.expr, total: res.total } });
      } catch (_) {}
    }
  });

  renderBattle();
}




