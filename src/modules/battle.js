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
let battleStateBridgeBound = false;
let battleStateLastActive = false;

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

function normalizeRpgMode(modeRaw) {
  const m = String(modeRaw || "adventurer").trim().toLowerCase();
  if (["pipsqueak", "storyteller", "adventurer", "master"].includes(m)) return m;
  return "adventurer";
}

function modeRewardScale(modeRaw) {
  const mode = normalizeRpgMode(modeRaw);
  if (mode === "pipsqueak") return 1.55;
  if (mode === "storyteller") return 1.25;
  if (mode === "master") return 0.8;
  return 1;
}

function modeDangerGap(modeRaw) {
  const mode = normalizeRpgMode(modeRaw);
  if (mode === "pipsqueak") return 10;
  if (mode === "storyteller") return 8;
  if (mode === "master") return 4;
  return 6;
}

function modeLabel(modeRaw) {
  const mode = normalizeRpgMode(modeRaw);
  return mode.charAt(0).toUpperCase() + mode.slice(1);
}

function normalizeSkillType(v) {
  return String(v || "active").trim().toLowerCase() === "passive" ? "passive" : "active";
}

function normalizeBattleSkill(raw, source = "") {
  if (!raw) return null;
  if (typeof raw === "string") {
    const name = String(raw).trim();
    if (!name) return null;
    return {
      name: name.slice(0, 80),
      description: "",
      skillType: "active",
      level: "1",
      source: String(source || "").trim().slice(0, 40),
    };
  }
  if (typeof raw !== "object") return null;
  const name = String(raw?.name || raw?.title || raw?.skill || "").trim();
  if (!name) return null;
  const description = String(raw?.description || raw?.desc || "").trim().slice(0, 240);
  const skillType = normalizeSkillType(raw?.skillType || raw?.type);
  const level = String(raw?.level || raw?.rank || raw?.tier || "1").replace(/[^0-9]/g, "").trim() || "1";
  return {
    name: name.slice(0, 80),
    description,
    skillType,
    level,
    source: String(source || raw?.source || "").trim().slice(0, 40),
  };
}

function mergeSkillLists(...lists) {
  const out = [];
  const seen = new Set();
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const raw of list) {
      const sk = normalizeBattleSkill(raw);
      if (!sk) continue;
      const key = sk.name.toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(sk);
    }
  }
  return out;
}

function createBattleId() {
  return `battle_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function addBattleLogLine(s, line) {
  ensureBattle(s);
  const t = String(line || "").trim();
  if (!t) return;
  s.battle.state.log.push(t.slice(0, 220));
  s.battle.state.log = s.battle.state.log.slice(-140);
}

function pushDefeatedEnemyHistory(s, name, battleId = "") {
  ensureBattle(s);
  const nm = String(name || "").trim().slice(0, 60);
  if (!nm) return false;
  const bid = String(battleId || "").trim();
  const recent = (Array.isArray(s.battle.history.defeated) ? s.battle.history.defeated : []).slice(-50);
  const dup = recent.some((x) => String(x?.name || "").toLowerCase() === nm.toLowerCase() && String(x?.battleId || "") === bid);
  if (dup) return false;
  s.battle.history.defeated.push({ name: nm, battleId: bid, ts: Date.now() });
  s.battle.history.defeated = s.battle.history.defeated.slice(-300);
  return true;
}

function pushDeathHistory(s, name, battleId = "") {
  ensureBattle(s);
  const nm = String(name || "").trim().slice(0, 60);
  if (!nm) return false;
  const bid = String(battleId || "").trim();
  const recent = (Array.isArray(s.battle.history.deaths) ? s.battle.history.deaths : []).slice(-50);
  const dup = recent.some((x) => String(x?.name || "").toLowerCase() === nm.toLowerCase() && String(x?.battleId || "") === bid);
  if (dup) return false;
  s.battle.history.deaths.push({ name: nm, battleId: bid, ts: Date.now() });
  s.battle.history.deaths = s.battle.history.deaths.slice(-300);
  return true;
}

function pushOutcomeHistory(s, result, enemies = [], battleId = "") {
  ensureBattle(s);
  const out = ["win", "loss", "draw", "unknown"].includes(String(result || "").toLowerCase())
    ? String(result || "unknown").toLowerCase()
    : "unknown";
  const bid = String(battleId || "").trim();
  const recent = (Array.isArray(s.battle.history.outcomes) ? s.battle.history.outcomes : []).slice(-30);
  const dup = bid && recent.some((x) => String(x?.battleId || "") === bid);
  if (dup) return false;
  s.battle.history.outcomes.push({
    result: out,
    enemies: Array.isArray(enemies) ? enemies.map((x) => String(x || "").trim().slice(0, 60)).filter(Boolean).slice(0, 10) : [],
    battleId: bid,
    ts: Date.now(),
  });
  s.battle.history.outcomes = s.battle.history.outcomes.slice(-300);
  return true;
}

function inferBattleOutcome(chat, st, ctx) {
  const chatText = String(chat || "");
  const logTail = Array.isArray(st?.log) ? st.log.slice(-16).join("\n") : "";
  const text = `${chatText}\n${logTail}`;

  if (/(party\s*wiped|you\s+were\s+defeated|total\s+defeat|game\s+over|retreat\s+failed|forced\s+to\s+retreat|forced\s+to\s+flee|overrun|slaughtered)/i.test(text)) return "loss";
  if (/(victory|enemies?\s+(?:defeated|slain|routed)|battle\s+won|you\s+won|combat\s+cleared|all\s+hostiles?\s+(?:neutralized|down)|threat\s+eliminated|last\s+enemy\s+falls?)/i.test(text)) return "win";
  if (/(stalemate|draw|ceasefire|mutual\s+retreat|both\s+sides?\s+withdrew?|disengaged?)/i.test(text)) return "draw";

  const members = Array.isArray(ctx?.ordered) ? ctx.ordered : [];
  const aliveMembers = members.filter((m) => Number(m?.hp || 0) > 0);
  const enemies = Array.isArray(st?.enemies) ? st.enemies : [];
  const knownEnemyHp = enemies
    .map((e) => {
      const hp = Number(e?.hp);
      return Number.isFinite(hp) ? hp : null;
    })
    .filter((v) => v !== null);
  const anyEnemyAliveKnown = knownEnemyHp.some((x) => x > 0);
  const allKnownEnemyDown = knownEnemyHp.length > 0 && knownEnemyHp.every((x) => x <= 0);

  if (!aliveMembers.length) return "loss";
  if (!anyEnemyAliveKnown && (allKnownEnemyDown || !enemies.length)) return "win";
  if (!st?.active && /retreat|withdrew|fled/i.test(text)) return aliveMembers.length ? "draw" : "loss";
  return "unknown";
}

async function inferBattleOutcomeWithPrompt(s, chat, st, ctx) {
  const initial = inferBattleOutcome(chat, st, ctx);
  if (initial !== "unknown") return initial;
  if (s?.generation?.allowSystemChecks === false) return initial;

  const members = Array.isArray(ctx?.ordered) ? ctx.ordered : [];
  const enemies = Array.isArray(st?.enemies) ? st.enemies : [];
  const memberState = members.slice(0, 10)
    .map((m) => `${String(m?.name || "member").slice(0, 40)} HP:${Math.max(0, Math.round(Number(m?.hp || 0)))}`)
    .join(" | ") || "unknown";
  const enemyState = enemies.slice(0, 10)
    .map((e) => `${String(e?.name || "enemy").slice(0, 40)} HP:${Number.isFinite(Number(e?.hp)) ? Math.max(0, Math.round(Number(e?.hp))) : "?"}`)
    .join(" | ") || "none";
  const logTail = Array.isArray(st?.log) ? st.log.slice(-18).join("\n") : "";

  const prompt = `
Return ONLY JSON:
{"outcome":"win|loss|draw|unknown"}

Determine the FINAL battle outcome for the party from these signals.
Rules:
- win: enemies defeated / battle won.
- loss: party defeated / wiped / forced failed retreat.
- draw: disengage, ceasefire, or both sides withdraw without clear victory.
- unknown: genuinely inconclusive.

Party state:
${memberState}

Enemy state:
${enemyState}

Battle log tail:
${logTail}

Chat tail:
${String(chat || "").slice(-2600)}
`;

  const res = await generateContent(prompt.slice(0, 5200), "System Check");
  if (!res) return initial;
  const obj = safeJsonParseObject(res);
  const raw = String(obj?.outcome || obj?.result || "").trim().toLowerCase();
  if (["win", "loss", "draw", "unknown"].includes(raw)) return raw;
  const token = String(res || "").toLowerCase().match(/\b(win|loss|draw|unknown)\b/);
  return token ? token[1] : initial;
}

function triggerBattleContinue(summary = "") {
  const pick = (sels = []) => {
    for (const sel of sels) {
      try {
        const el = document.querySelector(sel);
        if (el) return el;
      } catch (_) {}
    }
    return null;
  };

  const cont = pick(["#continue_but", "#continue_button", "[data-testid='continue']"]);
  if (cont && !cont.disabled) {
    cont.click();
    return true;
  }

  const ta = pick(["textarea#send_textarea", "textarea#send_text", "textarea"]);
  const send = pick(["#send_but", "#send_button", "#send", "[data-testid='send']"]);
  if (ta && send && !send.disabled) {
    const existing = String(ta.value || "").trim();
    if (!existing) {
      ta.value = String(summary || "Battle turn submitted.").slice(0, 300);
      try { ta.dispatchEvent(new Event("input", { bubbles: true })); } catch (_) {}
      try { ta.dispatchEvent(new Event("change", { bubbles: true })); } catch (_) {}
    }
    send.click();
    return true;
  }

  return false;
}

function memberNameKey(value) {
  return String(value || "").trim().toLowerCase();
}

function getPartyMemberByName(s, name) {
  const key = memberNameKey(name);
  if (!key) return null;
  const members = Array.isArray(s?.party?.members) ? s.party.members : [];
  for (const m of members) {
    const nm = memberNameKey(m?.identity?.name || m?.name || "");
    if (nm === key) return m;
  }
  return null;
}

function resolveActorBattleSkills(s, actor) {
  if (!actor) return [];
  const member = getPartyMemberByName(s, actor.name);
  const partySkills = Array.isArray(member?.skills) ? member.skills : [];
  const inventorySkills = actor?.isUser && Array.isArray(s?.inventory?.skills) ? s.inventory.skills : [];
  const merged = mergeSkillLists(partySkills, inventorySkills);
  const active = merged.filter((sk) => normalizeSkillType(sk?.skillType) !== "passive");
  return (active.length ? active : merged).slice(0, 24);
}

function battleTimeLabel(ts) {
  const t = Number(ts || 0);
  if (!Number.isFinite(t) || t <= 0) return "";
  try {
    return new Date(t).toLocaleString();
  } catch (_) {
    return "";
  }
}

function shortBattleId(id) {
  const raw = String(id || "").trim();
  if (!raw) return "";
  if (raw.length <= 16) return raw;
  return `${raw.slice(0, 10)}...${raw.slice(-4)}`;
}

function normalizeBattleMainTab(raw) {
  const tab = String(raw || "combat").trim().toLowerCase();
  if (["combat", "planner", "rewards", "log"].includes(tab)) return tab;
  return "combat";
}

function isDuplicateBattleTap(el, type = "") {
  if (!el || !el.dataset) return false;
  const now = Date.now();
  const key = "uieBattleTapAt";
  const last = Number(el.dataset[key] || 0);
  if (type === "click" && Number.isFinite(last) && last > 0 && (now - last) < 420) return true;
  el.dataset[key] = String(now);
  return false;
}

function buildTurnActionText(entry) {
  if (!entry || typeof entry !== "object") return "";
  const actorName = String(entry.actorName || "Member").trim().slice(0, 60) || "Member";
  const skillName = String(entry.skillName || "").trim().slice(0, 80);
  const action = String(entry.action || "").trim().slice(0, 180);
  const target = String(entry.target || "").trim().slice(0, 80);

  let line = actorName;
  if (skillName) line += ` uses ${skillName}`;
  if (action) line += skillName ? ` and ${action}` : `: ${action}`;
  if (target) line += ` -> ${target}`;
  return line.slice(0, 260);
}

function evaluateBattleReadiness(s, st, ctx) {
  const mode = normalizeRpgMode(s?.character?.mode);
  const members = Array.isArray(ctx?.ordered) ? ctx.ordered : [];
  const enemies = Array.isArray(st?.enemies) ? st.enemies : [];
  const reasons = [];

  if (!enemies.length) {
    return { ready: true, mode, reasons: [], message: "", sig: "" };
  }

  if (!members.length) reasons.push("No active party members are tracked.");
  const aliveMembers = members.filter((m) => Number(m?.hp || 0) > 0);
  if (!aliveMembers.length) reasons.push("All tracked party members are down.");

  const downCount = members.filter((m) => Number(m?.hp || 0) <= 0).length;
  if (downCount > 0) reasons.push(`${downCount} member(s) are currently down.`);

  const enemyLevels = enemies.map((e) => Number(e?.level)).filter((n) => Number.isFinite(n) && n > 0);
  const enemyAvg = enemyLevels.length ? (enemyLevels.reduce((a, b) => a + b, 0) / enemyLevels.length) : 0;
  const partyAvg = aliveMembers.length
    ? (aliveMembers.reduce((a, m) => a + Math.max(1, Number(m?.level || 1)), 0) / aliveMembers.length)
    : 0;
  const gap = modeDangerGap(mode);
  if (enemyAvg > 0 && partyAvg > 0 && enemyAvg >= (partyAvg + gap)) {
    reasons.push(`Enemy average level ${Math.round(enemyAvg)} exceeds party average ${Math.round(partyAvg)}.`);
  }

  const outnumberMargin = mode === "pipsqueak" ? 4 : 2;
  if (enemies.length >= aliveMembers.length + outnumberMargin) {
    reasons.push("Enemy count heavily outnumbers your active party.");
  }

  let membersWithSkills = 0;
  for (const m of aliveMembers) {
    if (resolveActorBattleSkills(s, m).length > 0) membersWithSkills += 1;
  }
  if (aliveMembers.length > 0 && membersWithSkills === 0) {
    reasons.push("No active combat skills detected for the party.");
  } else if (aliveMembers.length >= 2 && membersWithSkills < Math.ceil(aliveMembers.length / 2)) {
    reasons.push("Several party members do not have usable active skills.");
  }

  const statObj = (s?.character?.stats && typeof s.character.stats === "object") ? s.character.stats : null;
  const statVals = statObj ? Object.values(statObj).map((x) => Number(x)).filter((n) => Number.isFinite(n)) : [];
  const statAvg = statVals.length ? (statVals.reduce((a, b) => a + b, 0) / statVals.length) : 0;
  if (enemyAvg > 0 && statAvg > 0) {
    const recommended = Math.max(10, enemyAvg * 1.6);
    if (statAvg + 3 < recommended) {
      reasons.push(`Core stats look low for this enemy tier (${Math.round(statAvg)} vs ~${Math.round(recommended)}).`);
    }
  }

  const message = reasons.slice(0, 2).join(" ");
  const sig = simpleHash(`${mode}|${Math.round(enemyAvg)}|${Math.round(partyAvg)}|${enemies.length}|${aliveMembers.length}|${reasons.join("|")}`);
  return { ready: reasons.length === 0, mode, reasons, message, sig };
}

function maybeNotifyBattleReadiness(s, st, ctx) {
  ensureBattle(s);
  if (!st?.active) return;

  const readiness = evaluateBattleReadiness(s, st, ctx);
  if (readiness.ready) return;

  const now = Date.now();
  const lastAt = Number(s?.battle?.meta?.lastReadinessNotifyAt || 0);
  const sameSig = readiness.sig && readiness.sig === String(s?.battle?.ui?.lastReadinessSig || "");
  if (sameSig && (now - lastAt) < 45000) return;

  s.battle.ui.lastReadinessSig = readiness.sig;
  s.battle.meta.lastReadinessNotifyAt = now;

  const modeTxt = modeLabel(readiness.mode);
  const msg = `${readiness.message || "Party may be underprepared for this encounter."} (${modeTxt} mode)`;
  notify("warning", msg.slice(0, 240), "War Room", "readiness");
  addBattleLogLine(s, `Readiness warning: ${msg}`);
  try {
    injectRpEvent(`[System: Battle readiness warning (${modeTxt}): ${readiness.message || "Party may be underprepared."}]`);
  } catch (_) {}
}

function ensureBattle(s) {
  if (!s.battle) s.battle = { auto: false, state: { active: false, enemies: [], turnOrder: [], log: [] } };
  if (typeof s.battle.auto !== "boolean") s.battle.auto = false;
  if (!s.battle.state) s.battle.state = { active: false, enemies: [], turnOrder: [], log: [] };
  if (!s.battle.dice || typeof s.battle.dice !== "object") s.battle.dice = { enabled: false, last: null };
  if (typeof s.battle.dice.enabled !== "boolean") s.battle.dice.enabled = false;
  if (!s.battle.turnPlan || typeof s.battle.turnPlan !== "object") s.battle.turnPlan = {};
  if (!s.battle.history || typeof s.battle.history !== "object") s.battle.history = { defeated: [], outcomes: [], deaths: [] };
  if (!Array.isArray(s.battle.history.defeated)) s.battle.history.defeated = [];
  if (!Array.isArray(s.battle.history.outcomes)) s.battle.history.outcomes = [];
  if (!Array.isArray(s.battle.history.deaths)) s.battle.history.deaths = [];
  if (!s.battle.rewards || typeof s.battle.rewards !== "object") s.battle.rewards = { pending: null, inbox: [], claimed: [] };
  if (s.battle.rewards.pending !== null && typeof s.battle.rewards.pending !== "object") s.battle.rewards.pending = null;
  if (!Array.isArray(s.battle.rewards.inbox)) s.battle.rewards.inbox = [];
  if (!Array.isArray(s.battle.rewards.claimed)) s.battle.rewards.claimed = [];
  if (!s.battle.rewards.inbox.length) {
    s.battle.rewards.pending = null;
  } else {
    const pendingId = String(s?.battle?.rewards?.pending?.id || "").trim();
    const hasPending = pendingId
      ? s.battle.rewards.inbox.some((pkg) => String(pkg?.id || "") === pendingId)
      : false;
    if (!hasPending) s.battle.rewards.pending = s.battle.rewards.inbox[0];
  }
  if (!s.battle.ui || typeof s.battle.ui !== "object") s.battle.ui = { logTab: "combat", mainTab: "combat", lastReadinessSig: "" };
  if (!["combat", "defeated", "outcomes", "deaths"].includes(String(s.battle.ui.logTab || "").toLowerCase())) s.battle.ui.logTab = "combat";
  s.battle.ui.mainTab = normalizeBattleMainTab(s.battle.ui.mainTab);
  if (typeof s.battle.ui.lastReadinessSig !== "string") s.battle.ui.lastReadinessSig = "";
  if (!s.battle.meta || typeof s.battle.meta !== "object") {
    s.battle.meta = {
      currentBattleId: "",
      lastEndSig: "",
      lastRewardSig: "",
      lastReadinessNotifyAt: 0,
      enemyHpByName: {},
      partyHpByName: {},
    };
  }
  if (!s.battle.meta.enemyHpByName || typeof s.battle.meta.enemyHpByName !== "object") s.battle.meta.enemyHpByName = {};
  if (!s.battle.meta.partyHpByName || typeof s.battle.meta.partyHpByName !== "object") s.battle.meta.partyHpByName = {};
  if (typeof s.battle.meta.currentBattleId !== "string") s.battle.meta.currentBattleId = "";
  if (typeof s.battle.meta.lastEndSig !== "string") s.battle.meta.lastEndSig = "";
  if (typeof s.battle.meta.lastRewardSig !== "string") s.battle.meta.lastRewardSig = "";
  if (!Number.isFinite(Number(s.battle.meta.lastReadinessNotifyAt))) s.battle.meta.lastReadinessNotifyAt = 0;
  if (!Array.isArray(s.battle.state.enemies)) s.battle.state.enemies = [];
  if (!Array.isArray(s.battle.state.turnOrder)) s.battle.state.turnOrder = [];
  if (!Array.isArray(s.battle.state.log)) s.battle.state.log = [];
  if (!s.ui) s.ui = {};
  if (!s.ui.notifications || typeof s.ui.notifications !== "object") s.ui.notifications = { css: "", categories: {}, lowHp: { enabled: false, threshold: 0.25, lastWarnAt: 0 }, postBattle: { enabled: true, lastSig: "" } };
  if (!s.ui.notifications.postBattle || typeof s.ui.notifications.postBattle !== "object") s.ui.notifications.postBattle = { enabled: true, lastSig: "" };
  if (s.ui.notifications.postBattle.enabled === undefined) s.ui.notifications.postBattle.enabled = true;
  if (s.ui.notifications.postBattle.lastSig === undefined) s.ui.notifications.postBattle.lastSig = "";
}

function cloneJsonValue(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_) {
    return null;
  }
}

function rewardPackageItems(pkg) {
  if (!pkg || typeof pkg !== "object") return [];
  const fromContainer = Array.isArray(pkg?.container?.openable?.contents) ? pkg.container.openable.contents : [];
  if (fromContainer.length) return fromContainer;
  return Array.isArray(pkg?.items) ? pkg.items : [];
}

function rewardPackageSummary(pkg, sym = "G") {
  if (!pkg || typeof pkg !== "object") return "No rewards";
  const parts = [];
  const items = rewardPackageItems(pkg);
  if (pkg?.container?.name) {
    parts.push(`1x ${String(pkg.container.name || "Container").trim().slice(0, 60) || "Container"}`);
    if (items.length) parts.push(`contents: ${summarizeItemsForLog(items, 4)}`);
  } else if (items.length) {
    parts.push(summarizeItemsForLog(items, 4));
  }
  if (Number(pkg?.currency || 0) > 0) parts.push(`${Math.max(0, Math.round(Number(pkg.currency || 0)))} ${sym}`);
  if (Number(pkg?.xp || 0) > 0) parts.push(`${Math.max(0, Math.round(Number(pkg.xp || 0)))} XP`);
  return parts.join(", ") || "No rewards";
}

function queueBattleRewardPackage(s, rewardPkg) {
  ensureBattle(s);
  if (!rewardPkg || typeof rewardPkg !== "object") return false;
  const sig = String(rewardPkg?.sig || "").trim();
  if (sig) {
    const dup = (Array.isArray(s.battle.rewards.inbox) ? s.battle.rewards.inbox : []).some((x) => String(x?.sig || "") === sig);
    if (dup) return false;
  }
  s.battle.rewards.inbox.push(rewardPkg);
  s.battle.rewards.inbox = s.battle.rewards.inbox.slice(-80);
  s.battle.rewards.pending = s.battle.rewards.inbox[0] || null;
  return true;
}

async function maybePostBattleRewards(chat, options = {}) {
  const s = getSettings();
  if (!s) return null;
  ensureBattle(s);
  if (s.ui?.notifications?.postBattle?.enabled !== true) return null;
  if (s.ai && s.ai.loot === false) return null;

  const battleId = String(options?.battleId || s.battle.meta.currentBattleId || "").trim();
  const outcome = String(options?.outcome || "unknown").trim().toLowerCase();
  const sourceSig = simpleHash(`${battleId}|${outcome}|${simpleHash(String(chat || "").slice(-1200))}`);
  if (sourceSig && s.battle.meta.lastRewardSig === sourceSig) return null;

  const mode = normalizeRpgMode(s?.character?.mode);
  const modeScale = modeRewardScale(mode);
  const qtyScale = Math.max(0.75, Math.min(2.1, modeScale));
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
- RPG mode: ${modeLabel(mode)}. Outcome: ${outcome || "unknown"}.
CHAT:
${String(chat || "").slice(0, 4200)}
`;
  const res = await generateContent(prompt.slice(0, 6000), "System Check");
  if (!res) return null;
  const obj = safeJsonParseObject(res);
  if (!obj || typeof obj !== "object") return null;

  const containerObj = (obj.container && typeof obj.container === "object") ? obj.container : null;
  const containerContents = Array.isArray(containerObj?.contents) ? containerObj.contents : [];
  const looseItems = Array.isArray(obj.items) ? obj.items : [];
  const rewardEntriesRaw = (containerContents.length ? containerContents : looseItems).slice(0, 6);

  const rewardEntries = rewardEntriesRaw
    .map((it) => normalizeInventoryItem({
      kind: "item",
      name: String(it?.name || "").trim().slice(0, 80),
      type: String(it?.type || "Item").trim().slice(0, 50),
      description: String(it?.description || it?.desc || "").trim().slice(0, 900),
      rarity: String(it?.rarity || "common").trim().toLowerCase(),
      qty: Math.max(1, Math.min(99, Math.round(Math.max(1, Number(it?.qty || 1)) * qtyScale))),
    }, {
      source: "battle_reward_pending",
      chatHint: String(chat || "").slice(0, 2400),
    }))
    .filter((x) => !!x && !!x.name);

  const curBase = Math.max(0, Math.round(Number(obj.currency || 0)));
  const xpBase = Math.max(0, Math.round(Number(obj.xp || 0)));
  const curDelta = Math.max(0, Math.round(curBase * modeScale));
  const xpDelta = Math.max(0, Math.round(xpBase * modeScale));

  let rewardContainer = null;
  if (rewardEntries.length || containerObj) {
    rewardContainer = createOpenableContainerItem({
      chatHint: String(chat || "").slice(0, 2600),
      containerName: String(containerObj?.name || "Battle Spoils Bag").trim().slice(0, 80),
      containerType: String(containerObj?.type || "Bag").trim().slice(0, 60),
      description: String(containerObj?.description || "Rewards recovered after combat.").trim().slice(0, 900),
      rarity: String(containerObj?.rarity || (outcome === "win" ? "uncommon" : "common")).trim().toLowerCase(),
      contents: rewardEntries,
      source: "battle_reward_pending",
    });
    if (rewardContainer && rewardEntries.length === 0 && rewardContainer.openable && Array.isArray(rewardContainer.openable.contents)) {
      rewardContainer.openable.contents = [];
    }
  }

  const rewardPkg = {
    id: `reward_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    sig: sourceSig,
    battleId,
    outcome,
    mode,
    createdAt: Date.now(),
    currency: curDelta,
    xp: xpDelta,
    container: rewardContainer ? cloneJsonValue(rewardContainer) : null,
    items: rewardContainer ? [] : rewardEntries.map((x) => cloneJsonValue(x)).filter(Boolean),
  };
  rewardPkg.summary = rewardPackageSummary(rewardPkg, sym);

  const hasValue = !!rewardPkg.container || rewardPackageItems(rewardPkg).length > 0 || rewardPkg.currency > 0 || rewardPkg.xp > 0;
  if (!hasValue) {
    s.battle.meta.lastRewardSig = sourceSig;
    commitStateUpdate({ save: true, layout: false, emit: true });
    return null;
  }

  if (!queueBattleRewardPackage(s, rewardPkg)) return null;
  s.battle.meta.lastRewardSig = sourceSig;
  s.ui.notifications.postBattle.lastSig = sourceSig;

  addBattleLogLine(s, `Rewards ready to claim: ${rewardPkg.summary}`);
  commitStateUpdate({ save: true, layout: false, emit: true });
  notify("success", `Battle rewards ready to claim: ${rewardPkg.summary}`.slice(0, 240), "War Room", "postBattle");
  try {
    injectRpEvent(`[System: Battle rewards generated and waiting for manual claim (${modeLabel(mode)}): ${rewardPkg.summary}]`);
  } catch (_) {}
  return rewardPkg;
}

function applyRewardPackageClaim(s, rewardId = "") {
  ensureBattle(s);
  if (!s.inventory) s.inventory = { items: [], skills: [], assets: [], statuses: [] };
  if (!Array.isArray(s.inventory.items)) s.inventory.items = [];

  const targetId = String(rewardId || "").trim();
  const inbox = Array.isArray(s.battle.rewards.inbox) ? s.battle.rewards.inbox : [];
  if (!inbox.length) return null;

  const idx = targetId
    ? inbox.findIndex((x) => String(x?.id || "") === targetId)
    : 0;
  if (idx < 0) return null;

  const pkg = inbox[idx];
  const sym = String(s.currencySymbol || "G");
  const lootItems = rewardPackageItems(pkg);

  let addedContainers = 0;
  let addedItems = 0;

  if (pkg?.container && typeof pkg.container === "object") {
    const addOut = addInventoryItemWithStack(s.inventory.items, cloneJsonValue(pkg.container) || pkg.container, {
      source: "battle_reward_claim",
      chatHint: String(pkg?.summary || ""),
    });
    if (Number(addOut?.addedStacks || 0) > 0 || Number(addOut?.stackedQty || 0) > 0) {
      addedContainers = 1;
      addedItems = lootItems.length;
    }
  } else {
    for (const it of lootItems) {
      const addOut = addInventoryItemWithStack(s.inventory.items, cloneJsonValue(it) || it, {
        source: "battle_reward_claim",
        chatHint: String(pkg?.summary || ""),
      });
      if (Number(addOut?.addedStacks || 0) > 0 || Number(addOut?.stackedQty || 0) > 0) addedItems += 1;
    }
  }

  const curDelta = Math.max(0, Math.round(Number(pkg?.currency || 0)));
  const xpDelta = Math.max(0, Math.round(Number(pkg?.xp || 0)));
  if (curDelta > 0) {
    s.currency = Math.max(0, Number(s.currency || 0) + curDelta);
    let curItem = s.inventory.items.find((it) => String(it?.type || "").toLowerCase() === "currency" && String(it?.symbol || "") === sym);
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
        statusEffects: [],
      }, { source: "battle_reward_claim_currency" });
    } else {
      curItem.qty = Number(s.currency || 0);
    }
  }
  if (xpDelta > 0) s.xp = Number(s.xp || 0) + xpDelta;

  const claimedEntry = {
    ...cloneJsonValue(pkg),
    claimedAt: Date.now(),
  };
  s.battle.rewards.claimed.push(claimedEntry);
  s.battle.rewards.claimed = s.battle.rewards.claimed.slice(-240);
  s.battle.rewards.inbox.splice(idx, 1);
  s.battle.rewards.pending = s.battle.rewards.inbox[0] || null;

  const summary = rewardPackageSummary(pkg, sym);
  addBattleLogLine(s, `Rewards claimed: ${summary}`);
  return { pkg, summary, addedContainers, addedItems, curDelta, xpDelta };
}

async function claimBattleRewardById(rewardId = "") {
  const s = getSettings();
  if (!s) return false;
  ensureBattle(s);

  const out = applyRewardPackageClaim(s, rewardId);
  if (!out) {
    notify("info", "No pending reward to claim.", "War Room", "postBattle");
    return false;
  }

  commitStateUpdate({ save: true, layout: false, emit: true });
  $(document).trigger("uie:updateVitals");
  try { (await import("./features/items.js")).render?.(); } catch (_) {}

  notify("success", `Rewards claimed: ${out.summary}`.slice(0, 240), "War Room", "postBattle");
  try { injectRpEvent(`[System: Claimed battle rewards: ${out.summary}]`); } catch (_) {}
  return true;
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

function turnPlanActorKey(actor) {
  return memberNameKey(actor?.id || actor?.name || "");
}

function getTurnPlanEntryForActor(s, actor) {
  ensureBattle(s);
  const key = turnPlanActorKey(actor);
  const raw = (key && s?.battle?.turnPlan && typeof s.battle.turnPlan === "object") ? s.battle.turnPlan[key] : null;
  return {
    actorId: String(raw?.actorId || actor?.id || actor?.name || "").trim(),
    actorName: String(raw?.actorName || actor?.name || "Member").trim().slice(0, 60) || "Member",
    skillName: String(raw?.skillName || "").trim().slice(0, 80),
    target: String(raw?.target || "").trim().slice(0, 80),
    action: String(raw?.action || "").trim().slice(0, 180),
    ts: Number(raw?.ts || 0) || 0,
  };
}

function syncTurnPlanRowToState(s, rowEl) {
  ensureBattle(s);
  const $row = $(rowEl).closest(".uie-turn-row");
  if (!$row.length) return false;

  const actorId = String($row.attr("data-actor-id") || "").trim();
  const actorName = String($row.attr("data-actor-name") || "").trim().slice(0, 60);
  const key = memberNameKey(actorId || actorName);
  if (!key) return false;

  const skillName = String($row.find(".uie-turn-skill").val() || "").trim().slice(0, 80);
  const target = String($row.find(".uie-turn-target").val() || "").trim().slice(0, 80);
  const action = String($row.find(".uie-turn-action").val() || "").trim().slice(0, 180);

  if (!skillName && !target && !action) {
    delete s.battle.turnPlan[key];
    return true;
  }

  s.battle.turnPlan[key] = {
    actorId,
    actorName: actorName || "Member",
    skillName,
    target,
    action,
    ts: Date.now(),
  };
  return true;
}

function collectPlannedTurnEntries(s, ctx) {
  ensureBattle(s);
  const out = [];
  const used = new Set();
  const actors = Array.isArray(ctx?.ordered) ? ctx.ordered : [];

  for (const actor of actors.slice(0, 12)) {
    const key = turnPlanActorKey(actor);
    if (!key) continue;
    used.add(key);
    const entry = getTurnPlanEntryForActor(s, actor);
    if (!entry.skillName && !entry.target && !entry.action) continue;
    out.push(entry);
  }

  const planObj = (s?.battle?.turnPlan && typeof s.battle.turnPlan === "object") ? s.battle.turnPlan : {};
  for (const [key, raw] of Object.entries(planObj)) {
    if (used.has(key)) continue;
    const entry = {
      actorId: String(raw?.actorId || "").trim(),
      actorName: String(raw?.actorName || "Member").trim().slice(0, 60) || "Member",
      skillName: String(raw?.skillName || "").trim().slice(0, 80),
      target: String(raw?.target || "").trim().slice(0, 80),
      action: String(raw?.action || "").trim().slice(0, 180),
      ts: Number(raw?.ts || 0) || 0,
    };
    if (!entry.skillName && !entry.target && !entry.action) continue;
    out.push(entry);
  }

  return out.slice(0, 16);
}

function renderTurnPlannerControls(s, ctx) {
  ensureBattle(s);
  const entries = collectPlannedTurnEntries(s, ctx);
  const count = entries.length;
  const $submit = $("#uie-battle-submit-turn");
  const $clear = $("#uie-battle-clear-turn");

  if ($submit.length) {
    const busy = String($submit.attr("data-busy") || "") === "1";
    $submit.prop("disabled", busy || count === 0);
    if (!busy) $submit.text(count > 0 ? `Battle Turn (${Math.min(12, count)})` : "Battle Turn");
    $submit.css({
      opacity: (busy || count === 0) ? "0.56" : "1",
      cursor: (busy || count === 0) ? "not-allowed" : "pointer",
      filter: (busy || count === 0) ? "saturate(0.7)" : "none",
    });
  }

  if ($clear.length) {
    const submitBusy = String($submit.attr("data-busy") || "") === "1";
    $clear.prop("disabled", submitBusy || count === 0);
    $clear.css({
      opacity: (submitBusy || count === 0) ? "0.56" : "1",
      cursor: (submitBusy || count === 0) ? "not-allowed" : "pointer",
    });
  }
}

function setRewardClaimBusy($scope, busy = false) {
  const $root = $scope?.find ? $scope.find("#uie-battle-rewards") : $("#uie-battle-rewards");
  if (!$root || !$root.length) return;
  if (busy) $root.attr("data-claim-busy", "1");
  else $root.removeAttr("data-claim-busy");
}

function renderTurnPlannerPanel($root, s, ctx) {
  if (!$root || !$root.length) return;
  const members = Array.isArray(ctx?.ordered) ? ctx.ordered : [];
  if (!members.length) {
    $root.html(`<div style="opacity:0.7; font-weight:800;">No party members available for turn planning.</div>`);
    return;
  }

  const rows = members.slice(0, 8).map((actor) => {
    const plan = getTurnPlanEntryForActor(s, actor);
    const skills = resolveActorBattleSkills(s, actor);
    const selectedKey = String(plan.skillName || "").toLowerCase();
    const options = [`<option value="">- No Skill -</option>`]
      .concat(skills.map((sk) => {
        const nm = String(sk?.name || "").trim();
        if (!nm) return "";
        const key = nm.toLowerCase();
        const src = String(sk?.source || "").trim();
        const srcTxt = src ? ` [${esc(src)}]` : "";
        const selected = (key === selectedKey) ? " selected" : "";
        return `<option value="${esc(nm)}"${selected}>${esc(nm)}${srcTxt}</option>`;
      }))
      .filter(Boolean)
      .join("");

    return `<div class="uie-turn-row" data-actor-id="${esc(actor.id)}" data-actor-name="${esc(actor.name)}" style="padding:8px; border-radius:12px; border:1px solid rgba(255,255,255,0.12); background:rgba(0,0,0,0.20); display:flex; flex-direction:column; gap:6px;">
      <div style="display:flex; justify-content:space-between; gap:8px; align-items:center;">
        <div style="font-weight:900; color:#fff; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(actor.name)}</div>
        <div style="font-size:11px; color:rgba(255,255,255,0.72); font-weight:800;">Lv${Math.max(1, Number(actor.level || 1))} ${esc(actor.role || "")}</div>
      </div>
      <div style="display:flex; gap:6px; flex-wrap:wrap;">
        <select class="uie-turn-plan-field uie-turn-skill" style="flex:1; min-width:160px; border-radius:8px; border:1px solid rgba(255,255,255,0.16); background:rgba(10,12,18,0.95); color:#fff; padding:6px;">${options}</select>
        <input class="uie-turn-plan-field uie-turn-target" value="${esc(plan.target)}" maxlength="80" placeholder="Target" style="flex:1; min-width:130px; border-radius:8px; border:1px solid rgba(255,255,255,0.16); background:rgba(10,12,18,0.95); color:#fff; padding:6px;" />
      </div>
      <input class="uie-turn-plan-field uie-turn-action" value="${esc(plan.action)}" maxlength="180" placeholder="Action details (optional)" style="border-radius:8px; border:1px solid rgba(255,255,255,0.16); background:rgba(10,12,18,0.95); color:#fff; padding:6px;" />
      ${skills.length ? "" : `<div style="font-size:11px; opacity:0.68;">No active skills detected. You can still enter an action.</div>`}
    </div>`;
  }).join("");

  $root.html(rows);
}

function renderRewardsPanel($root, s) {
  if (!$root || !$root.length) return;
  ensureBattle(s);

  const sym = String(s?.currencySymbol || "G");
  const claimBusy = String($root.attr("data-claim-busy") || "") === "1";
  const inbox = Array.isArray(s?.battle?.rewards?.inbox) ? s.battle.rewards.inbox : [];
  const claimed = Array.isArray(s?.battle?.rewards?.claimed) ? s.battle.rewards.claimed : [];

  if (!inbox.length) {
    const lastClaim = claimed.length ? claimed[claimed.length - 1] : null;
    const lastTxt = lastClaim
      ? `Last claimed: ${rewardPackageSummary(lastClaim, sym)} (${battleTimeLabel(lastClaim?.claimedAt || lastClaim?.createdAt) || "recent"})`
      : "No reward claims yet.";
    const busyTxt = claimBusy ? `<div style="margin-bottom:6px; font-size:11px; color:#d1fae5; font-weight:900;">Updating rewards...</div>` : "";
    $root.html(`${busyTxt}<div style="opacity:0.78; font-weight:800;">No pending rewards.</div><div style="margin-top:6px; font-size:11px; opacity:0.62;">${esc(lastTxt)}</div>`);
    return;
  }

  const pending = inbox[0];
  const pendingSummary = rewardPackageSummary(pending, sym);
  const pendingMode = modeLabel(pending?.mode || normalizeRpgMode(s?.character?.mode));
  const pendingBattle = shortBattleId(pending?.battleId || "");
  const pendingTime = battleTimeLabel(pending?.createdAt) || "Just now";

  const queueRows = inbox.slice(1, 6).map((pkg) => {
    const summary = rewardPackageSummary(pkg, sym);
    const when = battleTimeLabel(pkg?.createdAt) || "recent";
    return `<div style="padding:8px; border-radius:10px; border:1px solid rgba(255,255,255,0.10); background:rgba(255,255,255,0.03); display:flex; gap:8px; align-items:center;">
      <div style="flex:1; min-width:0;">
        <div style="font-size:12px; font-weight:800; color:#fff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${esc(summary)}</div>
        <div style="font-size:11px; opacity:0.64;">${esc(when)}</div>
      </div>
      <button class="uie-battle-claim-id" data-reward-id="${esc(pkg?.id || "")}" ${claimBusy ? "disabled" : ""} style="height:30px; padding:0 10px; border-radius:8px; border:1px solid rgba(46,204,113,0.45); background:rgba(46,204,113,0.16); color:#d1fae5; font-weight:900; cursor:${claimBusy ? "not-allowed" : "pointer"}; opacity:${claimBusy ? "0.6" : "1"};">Claim</button>
    </div>`;
  }).join("");

  const busyBanner = claimBusy
    ? `<div style="margin-bottom:8px; font-size:11px; color:#d1fae5; font-weight:900;">Updating rewards inbox...</div>`
    : "";

  $root.html(`${busyBanner}<div style="padding:10px; border-radius:12px; border:1px solid rgba(46,204,113,0.30); background:rgba(18,32,24,0.45); display:flex; flex-direction:column; gap:8px;">
    <div style="display:flex; justify-content:space-between; gap:8px; align-items:center;">
      <div style="font-size:12px; font-weight:900; color:#fff;">Pending Reward</div>
      <div style="font-size:11px; opacity:0.75;">${esc(pendingMode)}${pendingBattle ? ` | ${esc(pendingBattle)}` : ""}</div>
    </div>
    <div style="font-size:13px; font-weight:800; color:#e5ffe9;">${esc(pendingSummary)}</div>
    <div style="font-size:11px; opacity:0.68;">${esc(pendingTime)}</div>
    <div style="display:flex; gap:8px; flex-wrap:wrap;">
      <button id="uie-battle-claim-reward" data-reward-id="${esc(pending?.id || "")}" ${claimBusy ? "disabled" : ""} style="height:34px; padding:0 12px; border-radius:9px; border:1px solid rgba(46,204,113,0.52); background:rgba(46,204,113,0.22); color:#eaffef; font-weight:900; cursor:${claimBusy ? "not-allowed" : "pointer"}; opacity:${claimBusy ? "0.6" : "1"};">Claim Pending</button>
    </div>
  </div>
  ${queueRows ? `<div style="margin-top:8px; display:flex; flex-direction:column; gap:6px;"><div style="font-size:11px; opacity:0.74; font-weight:900;">Queue (${inbox.length - 1})</div>${queueRows}</div>` : ""}
  <div style="margin-top:8px; font-size:11px; opacity:0.7;">Claimed total: ${claimed.length}</div>`);
}

function renderBattleLogTabPanel($log, $meta, s) {
  if (!$log || !$log.length) return;
  ensureBattle(s);

  const tab = String(s?.battle?.ui?.logTab || "combat").toLowerCase();
  const st = s.battle.state;
  const history = s.battle.history || { defeated: [], outcomes: [], deaths: [] };

  let lines = [];
  let metaText = "";

  if (tab === "defeated") {
    const rows = Array.isArray(history.defeated) ? history.defeated.slice(-120).reverse() : [];
    lines = rows.map((x) => {
      const t = battleTimeLabel(x?.ts) || "Unknown time";
      const bid = shortBattleId(x?.battleId || "");
      const nm = String(x?.name || "Enemy").trim() || "Enemy";
      return `[${t}] ${nm}${bid ? ` [${bid}]` : ""}`;
    });
    metaText = `Defeated tracked: ${rows.length}`;
  } else if (tab === "outcomes") {
    const rows = Array.isArray(history.outcomes) ? history.outcomes.slice(-120).reverse() : [];
    lines = rows.map((x) => {
      const t = battleTimeLabel(x?.ts) || "Unknown time";
      const result = String(x?.result || "unknown").toUpperCase();
      const enemies = Array.isArray(x?.enemies) && x.enemies.length ? ` vs ${x.enemies.join(", ")}` : "";
      const bid = shortBattleId(x?.battleId || "");
      return `[${t}] ${result}${enemies}${bid ? ` [${bid}]` : ""}`;
    });
    const wins = rows.filter((x) => String(x?.result || "").toLowerCase() === "win").length;
    const losses = rows.filter((x) => String(x?.result || "").toLowerCase() === "loss").length;
    metaText = `Wins: ${wins} | Losses: ${losses} | Total outcomes: ${rows.length}`;
  } else if (tab === "deaths") {
    const rows = Array.isArray(history.deaths) ? history.deaths.slice(-120).reverse() : [];
    lines = rows.map((x) => {
      const t = battleTimeLabel(x?.ts) || "Unknown time";
      const bid = shortBattleId(x?.battleId || "");
      const nm = String(x?.name || "Member").trim() || "Member";
      return `[${t}] ${nm}${bid ? ` [${bid}]` : ""}`;
    });
    metaText = `Deaths tracked: ${rows.length}`;
  } else {
    const rows = Array.isArray(st?.log) ? st.log.slice(-120) : [];
    lines = rows;
    metaText = `Combat log entries: ${rows.length}`;
  }

  $log.text(lines.length ? lines.join("\n") : "No entries yet.");
  if ($meta && $meta.length) $meta.text(metaText);

  $(".uie-battle-log-tab").each(function () {
    const key = String($(this).attr("data-tab") || "").toLowerCase();
    const active = key === tab;
    $(this).css({
      background: active ? "rgba(203,163,92,0.18)" : "rgba(255,255,255,0.04)",
      color: active ? "#f6e3b4" : "#ddd",
    });
  });
}

function renderBattleMainTabPanel(s) {
  ensureBattle(s);
  const tab = normalizeBattleMainTab(s?.battle?.ui?.mainTab);

  $(".uie-battle-main-tab").each(function () {
    const key = String($(this).attr("data-tab") || "").toLowerCase();
    const active = key === tab;
    $(this).css({
      background: active ? "rgba(203,163,92,0.18)" : "rgba(255,255,255,0.04)",
      color: active ? "#f6e3b4" : "#ddd",
      borderColor: active ? "rgba(203,163,92,0.5)" : "rgba(255,255,255,0.18)",
    });
  });

  $(".uie-battle-main-panel").each(function () {
    const panelKey = String($(this).attr("data-tab-panel") || "").toLowerCase();
    const show = panelKey === tab;
    $(this).css("display", show ? "block" : "none");
  });
}

export function renderBattle() {
  const s = getSettings();
  if (!s) return;
  ensureBattle(s);

  const $win = $("#uie-battle-window");
  if (!$win.length || !$win.is(":visible")) return;

  const st = s.battle.state;
  const partyCtx = buildBattlePartyContext(s);
  const rewardCount = Array.isArray(s?.battle?.rewards?.inbox) ? s.battle.rewards.inbox.length : 0;
  const statusText = `${st.active ? "Battle ACTIVE" : "Battle idle"}${rewardCount > 0 ? ` | ${rewardCount} reward${rewardCount === 1 ? "" : "s"} pending` : ""}`;
  $("#uie-battle-auto-state").text(s.battle.auto ? "ON" : "OFF");
  $("#uie-battle-dice-state").text(s.battle.dice?.enabled ? "ON" : "OFF");
  $("#uie-battle-sub").text(statusText);
  renderBattleMainTabPanel(s);

  const $en = $("#uie-battle-enemies");
  const $to = $("#uie-battle-turn");
  const $log = $("#uie-battle-log");
  const $logMeta = $("#uie-battle-log-meta");
  const $formation = $("#uie-battle-formation");
  const $party = $("#uie-battle-party");
  const $advice = $("#uie-battle-advice");
  const $turnPlanner = $("#uie-battle-turn-actions");
  const $rewards = $("#uie-battle-rewards");
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

  renderTurnPlannerPanel($turnPlanner, s, partyCtx);
  renderTurnPlannerControls(s, partyCtx);
  renderRewardsPanel($rewards, s);
  renderBattleLogTabPanel($log, $logMeta, s);
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
  const prevBattleId = String(s?.battle?.meta?.currentBattleId || "").trim();
  const prevEnemyHp = new Map((Array.isArray(st.enemies) ? st.enemies : []).map(e => [String(e?.name || "").toLowerCase().trim(), Number(e?.hp || 0)]).filter(x => x[0]));
  const prevPartyHpByName = (s?.battle?.meta?.partyHpByName && typeof s.battle.meta.partyHpByName === "object") ? s.battle.meta.partyHpByName : {};

  st.active = !!obj.active;
  const incomingEnemies = Array.isArray(obj.enemies) ? obj.enemies : [];
  st.enemies = mergeEnemies(st.enemies, incomingEnemies);
  st.turnOrder = Array.isArray(obj.turnOrder) ? obj.turnOrder.slice(0, 30).map(x => String(x || "").slice(0, 60)).filter(Boolean) : st.turnOrder;
  const newLog = Array.isArray(obj.log) ? obj.log.slice(0, 80).map(x => String(x || "").slice(0, 160)).filter(Boolean) : [];
  if (newLog.length) st.log = newLog;

  const activeBattleId = st.active
    ? String(prevBattleId || s?.battle?.meta?.currentBattleId || createBattleId()).trim()
    : "";
  if (st.active) s.battle.meta.currentBattleId = activeBattleId;

  const enemyHpByName = {};
  for (const e of (Array.isArray(st.enemies) ? st.enemies : [])) {
    const k = String(e?.name || "").toLowerCase().trim();
    if (!k) continue;
    const hp = (e?.hp === null || e?.hp === undefined || e?.hp === "") ? NaN : Number(e.hp);
    if (Number.isFinite(hp)) enemyHpByName[k] = hp;
  }

  const partyCtx = buildBattlePartyContext(s);
  const partyHpByName = {};
  for (const m of (Array.isArray(partyCtx?.ordered) ? partyCtx.ordered : [])) {
    const key = memberNameKey(m?.id || m?.name || "");
    const hp = Number(m?.hp || 0);
    if (!key || !Number.isFinite(hp)) continue;
    partyHpByName[key] = hp;
  }

  let endedBattleId = "";
  let endedOutcome = "";
  if (!prevActive && st.active) {
    s.battle.ui.lastReadinessSig = "";
    addBattleLogLine(s, `Battle started${activeBattleId ? ` [${shortBattleId(activeBattleId)}]` : ""}.`);
  }

  for (const e of (Array.isArray(st.enemies) ? st.enemies : [])) {
    const k = String(e?.name || "").toLowerCase().trim();
    if (!k) continue;
    const prevHp = Number(prevEnemyHp.get(k));
    const hp = Number(enemyHpByName[k]);
    if (Number.isFinite(prevHp) && Number.isFinite(hp) && prevHp > 0 && hp <= 0) {
      if (pushDefeatedEnemyHistory(s, e?.name || "Enemy", activeBattleId || prevBattleId)) {
        addBattleLogLine(s, `${String(e?.name || "Enemy").slice(0, 60)} defeated.`);
      }
      try { injectRpEvent(`[System: ${String(e?.name || "Enemy")} has been defeated.]`); } catch (_) {}
    }
  }

  for (const m of (Array.isArray(partyCtx?.ordered) ? partyCtx.ordered : [])) {
    const key = memberNameKey(m?.id || m?.name || "");
    if (!key) continue;
    const prevHp = Number(prevPartyHpByName[key]);
    const hp = Number(partyHpByName[key]);
    if (Number.isFinite(prevHp) && Number.isFinite(hp) && prevHp > 0 && hp <= 0) {
      if (pushDeathHistory(s, m?.name || "Member", activeBattleId || prevBattleId)) {
        addBattleLogLine(s, `${String(m?.name || "Member").slice(0, 60)} is down.`);
      }
    }
  }

  s.battle.meta.enemyHpByName = enemyHpByName;
  s.battle.meta.partyHpByName = partyHpByName;

  if (prevActive && !st.active) {
    endedBattleId = String(prevBattleId || activeBattleId || createBattleId()).trim();
    endedOutcome = await inferBattleOutcomeWithPrompt(s, chat, st, partyCtx);
    const endSig = simpleHash(`${endedBattleId}|${endedOutcome}|${simpleHash(String(chat || "").slice(-1200))}`);
    if (s.battle.meta.lastEndSig !== endSig) {
      s.battle.meta.lastEndSig = endSig;
      const enemyNames = (Array.isArray(st.enemies) ? st.enemies : [])
        .map((e) => String(e?.name || "").trim())
        .filter(Boolean)
        .slice(0, 10);
      pushOutcomeHistory(s, endedOutcome, enemyNames, endedBattleId);
      addBattleLogLine(s, `Battle ended: ${String(endedOutcome || "unknown").toUpperCase()}.`);
    }
    s.battle.meta.currentBattleId = "";
    s.battle.meta.enemyHpByName = {};
    s.battle.meta.partyHpByName = {};
  }

  maybeNotifyBattleReadiness(s, st, partyCtx);

  if (!incomingEnemies.length && !obj.active) notify("info", "No combat detected.", "War Room", "api");

  commitStateUpdate({ save: true, layout: false, emit: true });
  renderBattle();

  if (!prevActive && st.active) {
    try {
      const names = (Array.isArray(st.enemies) ? st.enemies : []).map(e => String(e?.name || "").trim()).filter(Boolean).slice(0, 6);
      injectRpEvent(`[System: Combat Started${activeBattleId ? ` [${shortBattleId(activeBattleId)}]` : ""} against ${names.length ? names.join(", ") : "unknown enemies"}.]`);
    } catch (_) {}
  }
  if (prevActive && !st.active) {
    try {
      injectRpEvent(`[System: Combat Ended${endedBattleId ? ` [${shortBattleId(endedBattleId)}]` : ""}. Outcome: ${String(endedOutcome || "unknown").toUpperCase()}.]`);
    } catch (_) {}
    try { await maybePostBattleRewards(chat, { battleId: endedBattleId, outcome: endedOutcome }); } catch (_) {}
    try { notify("info", "Combat ended. Check Rewards panel to manually claim loot.", "War Room", "postBattle"); } catch (_) {}
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

  $win.on("change.uieBattle", ".uie-turn-plan-field", function(e){
    e.stopPropagation();
    const s = getSettings();
    if (!s) return;
    ensureBattle(s);
    if (!syncTurnPlanRowToState(s, this)) return;
    commitStateUpdate({ save: true, layout: false, emit: true });
    renderTurnPlannerControls(s, buildBattlePartyContext(s));
  });

  $win.on("pointerup.uieBattle", "#uie-battle-clear-turn", function(e){
    e.preventDefault(); e.stopPropagation();
    const s = getSettings();
    if (!s) return;
    ensureBattle(s);
    s.battle.turnPlan = {};
    addBattleLogLine(s, "Turn planner cleared.");
    commitStateUpdate({ save: true, layout: false, emit: true });
    renderBattle();
  });

  $win.on("pointerup.uieBattle", "#uie-battle-submit-turn", async function(e){
    e.preventDefault(); e.stopPropagation();
    const el = this;
    if (el?.dataset?.busy === "1") return;
    if (el?.dataset) el.dataset.busy = "1";
    const prev = $(this).text();
    $(this).text("Submitting...");
    try {
      const s = getSettings();
      if (!s) return;
      ensureBattle(s);
      renderTurnPlannerControls(s, buildBattlePartyContext(s));

      $win.find(".uie-turn-row").each(function(){ syncTurnPlanRowToState(s, this); });

      const ctx = buildBattlePartyContext(s);
      const entries = collectPlannedTurnEntries(s, ctx);
      if (!entries.length) {
        notify("info", "Plan at least one action before submitting a battle turn.", "War Room", "api");
        return;
      }

      const lines = entries.map((entry) => buildTurnActionText(entry)).filter(Boolean).slice(0, 12);
      if (!lines.length) {
        notify("info", "No valid turn actions found.", "War Room", "api");
        return;
      }

      if (s.battle.state.active && !String(s?.battle?.meta?.currentBattleId || "").trim()) {
        s.battle.meta.currentBattleId = createBattleId();
      }

      const battleId = String(s?.battle?.meta?.currentBattleId || "").trim();
      const summary = lines.join(" | ").slice(0, 460);
      addBattleLogLine(s, `Turn plan submitted: ${summary}`);
      commitStateUpdate({ save: true, layout: false, emit: true });
      renderBattle();

      const lastDice = s?.battle?.dice?.last;
      const diceContext = (s?.battle?.dice?.enabled && lastDice && Number.isFinite(Number(lastDice?.total || NaN)))
        ? ` Dice context: ${String(lastDice.expr || "roll")}=${Math.round(Number(lastDice.total || 0))}.`
        : "";

      try {
        injectRpEvent(`[System: Battle turn submitted${battleId ? ` [${shortBattleId(battleId)}]` : ""}: ${summary}.${diceContext}]`, {
          uie: {
            type: "battle_turn_plan",
            battleId,
            entries: entries.map((x) => ({ actor: x.actorName, skill: x.skillName, target: x.target, action: x.action })),
            dice: (s?.battle?.dice?.enabled && lastDice) ? { expr: String(lastDice?.expr || ""), total: Number(lastDice?.total || 0) } : null,
          },
        });
      } catch (_) {}

      const continued = triggerBattleContinue(`Battle Turn: ${summary}`);
      notify("success", continued ? "Battle turn submitted and chat continued." : "Battle turn submitted. Continue chat when ready.", "War Room", "api");
    } finally {
      if (el?.dataset) el.dataset.busy = "0";
      const sAfter = getSettings();
      if (sAfter) {
        ensureBattle(sAfter);
        renderTurnPlannerControls(sAfter, buildBattlePartyContext(sAfter));
      } else {
        $(this).text(prev || "Battle Turn");
      }
    }
  });

  $win.on("pointerup.uieBattle", "#uie-battle-claim-reward, .uie-battle-claim-id", async function(e){
    e.preventDefault(); e.stopPropagation();
    const el = this;
    if (el?.dataset?.busy === "1") return;
    if (el?.dataset) el.dataset.busy = "1";
    setRewardClaimBusy($win, true);
    renderBattle();
    try {
      const rewardId = String($(this).attr("data-reward-id") || "").trim();
      await claimBattleRewardById(rewardId);
    } finally {
      if (el?.dataset) el.dataset.busy = "0";
      setRewardClaimBusy($win, false);
      renderBattle();
    }
  });

  $win.on("pointerup.uieBattle click.uieBattle", ".uie-battle-main-tab", function(e){
    e.preventDefault(); e.stopPropagation();
    if (isDuplicateBattleTap(this, e.type)) return;
    const tab = normalizeBattleMainTab($(this).attr("data-tab"));
    const s = getSettings();
    if (!s) return;
    ensureBattle(s);
    if (normalizeBattleMainTab(s?.battle?.ui?.mainTab) === tab) return;
    s.battle.ui.mainTab = tab;
    commitStateUpdate({ save: true, layout: false, emit: true });
    renderBattle();
  });

  $win.on("pointerup.uieBattle click.uieBattle", ".uie-battle-log-tab", function(e){
    e.preventDefault(); e.stopPropagation();
    if (isDuplicateBattleTap(this, e.type)) return;
    const tab = String($(this).attr("data-tab") || "combat").toLowerCase();
    if (!["combat", "defeated", "outcomes", "deaths"].includes(tab)) return;
    const s = getSettings();
    if (!s) return;
    ensureBattle(s);
    if (String(s?.battle?.ui?.logTab || "combat").toLowerCase() === tab) return;
    s.battle.ui.logTab = tab;
    commitStateUpdate({ save: true, layout: false, emit: true });
    renderBattle();
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




