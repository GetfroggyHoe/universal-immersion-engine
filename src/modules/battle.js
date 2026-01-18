import { getSettings, saveSettings } from "./core.js";
import { generateContent } from "./apiClient.js";
import { notify } from "./notifications.js";
import { injectRpEvent } from "./features/rp_log.js";

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
  saveSettings();

  if (!s.inventory) s.inventory = { items: [], skills: [], assets: [], statuses: [] };
  if (!Array.isArray(s.inventory.items)) s.inventory.items = [];

  const sym = String(s.currencySymbol || "G");
  const prompt = `
Return ONLY JSON:
{
  "items":[{"name":"","type":"","description":"","rarity":"common|uncommon|rare|epic|legendary","qty":1}],
  "currency":0,
  "xp":0
}
Rules:
- Reward should match the battle and outcomes in the chat.
- 0-3 items max.
- currency and xp are integers >= 0.
CHAT:
${String(chat || "").slice(0, 4200)}
`;
  const res = await generateContent(prompt.slice(0, 6000), "System Check");
  if (!res) return;
  let obj = null;
  try { obj = JSON.parse(String(res).replace(/```json|```/g, "").trim()); } catch (_) { obj = null; }
  if (!obj || typeof obj !== "object") return;

  const items = Array.isArray(obj.items) ? obj.items : [];
  const curDelta = Math.max(0, Math.round(Number(obj.currency || 0)));
  const xpDelta = Math.max(0, Math.round(Number(obj.xp || 0)));

  let addedItems = 0;
  for (const it of items.slice(0, 3)) {
    const name = String(it?.name || "").trim().slice(0, 80);
    if (!name) continue;
    s.inventory.items.push({
      kind: "item",
      name,
      type: String(it?.type || "Item").trim().slice(0, 40),
      description: String(it?.description || it?.desc || "").trim().slice(0, 700),
      rarity: String(it?.rarity || "common").trim().toLowerCase(),
      qty: Math.max(1, Math.round(Number(it?.qty || 1)))
    });
    addedItems++;
  }

  if (curDelta > 0) {
    s.currency = Math.max(0, Number(s.currency || 0) + curDelta);
    let curItem = s.inventory.items.find(it => String(it?.type || "").toLowerCase() === "currency" && String(it?.symbol || "") === sym);
    if (!curItem) {
      curItem = { kind: "item", name: `${sym} Currency`, type: "currency", symbol: sym, description: `Currency item for ${sym}.`, rarity: "common", qty: Number(s.currency || 0), mods: {}, statusEffects: [] };
      s.inventory.items.push(curItem);
    } else {
      curItem.qty = Number(s.currency || 0);
    }
  }
  if (xpDelta > 0) s.xp = Number(s.xp || 0) + xpDelta;

  saveSettings();
  $(document).trigger("uie:updateVitals");
  try { (await import("./features/items.js")).render?.(); } catch (_) {}

  if (addedItems) notify("success", `${addedItems} item(s) recovered`, "Post-battle", "postBattle");
  if (curDelta) notify("success", `+ ${curDelta} ${sym}`, "Post-battle", "postBattle");
  if (xpDelta) notify("success", `+ ${xpDelta} XP`, "Post-battle", "postBattle");
  if (!addedItems && !curDelta && !xpDelta) notify("info", "No rewards generated.", "Post-battle", "postBattle");
}

function pct(cur, max) {
  cur = Number(cur || 0);
  max = Number(max || 0);
  if (max <= 0) return 0;
  return Math.max(0, Math.min(100, (cur / max) * 100));
}

function readChatTail(n = 20) {
  try {
    let raw = "";
    const $txt = $(".chat-msg-txt");
    if ($txt.length) {
      $txt.slice(-n).each(function () { raw += $(this).text() + "\n"; });
      return raw.trim().slice(0, 4200);
    }
    const chatEl = document.querySelector("#chat");
    if (!chatEl) return "";
    const msgs = Array.from(chatEl.querySelectorAll(".mes")).slice(-n);
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
      raw += `${isUser ? "You" : "Story"}: ${String(t || "").trim()}\n`;
    }
    return raw.trim().slice(0, 4200);
  } catch (_) {
    return "";
  }
}

function mergeEnemies(existing, incoming) {
  const byName = new Map();
  (existing || []).forEach(e => {
    const k = String(e?.name || "").toLowerCase().trim();
    if (k) byName.set(k, e);
  });

  const out = [];
  (incoming || []).forEach(e => {
    const name = String(e?.name || "").trim().slice(0, 60);
    if (!name) return;
    const k = name.toLowerCase();
    const prev = byName.get(k) || {};
    const hp = Number.isFinite(Number(e?.hp)) ? Number(e.hp) : Number(prev.hp || 0);
    const maxHp = Number.isFinite(Number(e?.maxHp)) ? Number(e.maxHp) : Number(prev.maxHp || 0);
    out.push({
      name,
      hp,
      maxHp,
      level: Number.isFinite(Number(e?.level)) ? Number(e.level) : Number(prev.level || 0),
      boss: typeof e?.boss === "boolean" ? e.boss : !!prev.boss,
      statusEffects: Array.isArray(e?.statusEffects) ? e.statusEffects.slice(0, 8).map(x => String(x || "").slice(0, 50)) : (Array.isArray(prev.statusEffects) ? prev.statusEffects : [])
    });
  });

  return out;
}

export function renderBattle() {
  const s = getSettings();
  if (!s) return;
  ensureBattle(s);

  const st = s.battle.state;
  $("#uie-battle-auto-state").text(s.battle.auto ? "ON" : "OFF");
  $("#uie-battle-dice-state").text(s.battle.dice?.enabled ? "ON" : "OFF");
  $("#uie-battle-sub").text(st.active ? "Battle ACTIVE" : "Battle idle");

  const $en = $("#uie-battle-enemies");
  const $to = $("#uie-battle-turn");
  const $log = $("#uie-battle-log");
  if (!$en.length || !$to.length || !$log.length) return;

  $en.empty();
  if (!st.enemies.length) {
    $en.html(`<div style="opacity:0.7; font-weight:800;">No enemies tracked.</div>`);
  } else {
    st.enemies.forEach(e => {
      const bar = pct(e.hp, e.maxHp);
      $en.append(`
        <div style="padding:10px 12px; border-radius:14px; border:1px solid rgba(255,255,255,0.10); background:rgba(0,0,0,0.18); margin-bottom:8px;">
          <div style="display:flex; gap:10px; align-items:center;">
            <div style="font-weight:900; color:#fff; flex:1; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${esc(e.name)}${e.boss ? ` <span style="color:#f38ba8;">(BOSS)</span>` : ""}</div>
            <div style="opacity:0.75; font-size:12px; font-weight:900;">${esc(e.hp)}/${esc(e.maxHp)}</div>
          </div>
          <div style="height:10px; border-radius:999px; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.08); overflow:hidden; margin-top:8px;">
            <div style="height:100%; width:${bar}%; background:linear-gradient(90deg,#e74c3c,#f1c40f);"></div>
          </div>
          ${Array.isArray(e.statusEffects) && e.statusEffects.length ? `<div style="margin-top:8px; opacity:0.85; font-size:12px;">${esc(e.statusEffects.join(", "))}</div>` : ""}
        </div>
      `);
    });
  }

  $to.empty();
  if (!st.turnOrder.length) $to.html(`<div style="opacity:0.7; font-weight:800;">No turn order yet.</div>`);
  else $to.html(`<div style="display:flex; flex-direction:column; gap:8px;">${st.turnOrder.slice(0, 24).map((n, i) => `<div style="padding:8px 10px; border-radius:12px; border:1px solid rgba(255,255,255,0.10); background:rgba(0,0,0,0.18); font-weight:900; color:#fff;">${i + 1}. ${esc(n)}</div>`).join("")}</div>`);

  const lines = Array.isArray(st.log) ? st.log.slice(-50) : [];
  $log.text(lines.join("\n") || "No log yet.");
}

async function scanBattle() {
  const s = getSettings();
  if (!s) return;
  ensureBattle(s);

  const chat = readChatTail(20);
  if (!chat) return;

  const prompt = `
You are a combat parser.
Return ONLY JSON:
{
  "active": true,
  "enemies":[{"name":"","hp":0,"maxHp":0,"level":0,"boss":false,"statusEffects":[""]}],
  "turnOrder":[""],
  "log":["short combat log lines (newest last)"]
}
Rules:
- If no combat is happening, return {"active":false,"enemies":[],"turnOrder":[],"log":[]}
- Use conservative numbers; if unknown, keep previous values by omitting or setting null.
- statusEffects are short labels.

CHAT (last 20 messages):
${chat}
`;

  const res = await generateContent(prompt.slice(0, 6000), "System Check");
  if (!res) return;
  let obj = null;
  try { obj = JSON.parse(String(res).replace(/```json|```/g, "").trim()); } catch (_) { obj = null; }
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

  saveSettings();
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
      const hp = Number(e?.hp || 0);
      if (prevHp > 0 && hp <= 0) injectRpEvent(`[System: ${String(e?.name || "Enemy")} has been defeated.]`);
    }
  } catch (_) {}
  if (prevActive && !st.active) {
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
    if (!s.battle.auto) return;
    try {
      if (autoTimer) clearTimeout(autoTimer);
      autoTimer = setTimeout(async () => {
        const now = Date.now();
        const min = Math.max(2000, Number(s?.generation?.systemCheckMinIntervalMs ?? 20000));
        if (autoInFlight) return;
        if (now - autoLastAt < min) return;
        if (s?.generation?.scanOnlyOnGenerateButtons === true) return;
        const last = $(".chat-msg-txt").last();
        const txt = last.length ? (last.text() || "") : "";
        const h = simpleHash(txt);
        if (h === lastHash) return;
        lastHash = h;
        autoInFlight = true;
        autoLastAt = now;
        try {
          const mod = await import("./stateTracker.js");
          if (mod?.scanEverything) await mod.scanEverything();
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

  $(document).off(".uieBattle");

  const hideMenu = () => { try { $("#uie-battle-menu").hide(); } catch (_) {} };

  $(document).on("pointerup.uieBattle", "#uie-battle-close", function(e){ e.preventDefault(); e.stopPropagation(); hideMenu(); $("#uie-battle-window").hide(); });

  $(document).on("pointerup.uieBattle", "#uie-battle-wand", function (e) {
    e.preventDefault();
    e.stopPropagation();
    const $m = $("#uie-battle-menu");
    if (!$m.length) return;
    if ($m.is(":visible")) $m.hide();
    else $m.css("display", "flex");
  });

  $(document).on("pointerup.uieBattle", function (e) {
    const $m = $("#uie-battle-menu");
    if (!$m.length || !$m.is(":visible")) return;
    if ($(e.target).closest("#uie-battle-menu, #uie-battle-wand").length) return;
    hideMenu();
  });

  $(document).on("pointerup.uieBattle", "#uie-battle-scan", async function(e){
    e.preventDefault(); e.stopPropagation();
    hideMenu();
    const el = this;
    if (el?.dataset?.busy === "1") return;
    if (el?.dataset) el.dataset.busy = "1";
    const prev = $(this).text();
    $(this).text("Scanning...");
    try { await scanBattle(); } finally { if (el?.dataset) el.dataset.busy = "0"; $(this).text(prev || "Scan"); }
  });

  $(document).on("pointerup.uieBattle", "#uie-battle-auto", function(e){
    e.preventDefault(); e.stopPropagation();
    const s = getSettings();
    ensureBattle(s);
    s.battle.auto = !s.battle.auto;
    saveSettings();
    renderBattle();
  });

  $(document).on("pointerup.uieBattle", "#uie-battle-dice-toggle", function(e){
    e.preventDefault(); e.stopPropagation();
    const s = getSettings();
    ensureBattle(s);
    s.battle.dice.enabled = !s.battle.dice.enabled;
    saveSettings();
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

  $(document).on("pointerup.uieBattle", "#uie-battle-dice-roll", async function(e){
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
    saveSettings();
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
