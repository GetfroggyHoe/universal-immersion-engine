import { getSettings, saveSettings } from "./core.js";
import { getContext } from "../../../../../extensions.js";

const PENDING_KEY = "__uiePendingSystemEvents";

function escBlock(s) {
  return String(s || "").replace(/\r/g, "").slice(0, 2400);
}

function ensurePending(s) {
  if (!s.logicEnforcer || typeof s.logicEnforcer !== "object") s.logicEnforcer = {};
  if (!Array.isArray(s.logicEnforcer[PENDING_KEY])) s.logicEnforcer[PENDING_KEY] = [];
  return s.logicEnforcer[PENDING_KEY];
}

function listStatuses(s) {
  const a = Array.isArray(s?.inventory?.statuses) ? s.inventory.statuses : [];
  const b = Array.isArray(s?.character?.statusEffects) ? s.character.statusEffects : [];
  const list = [...a, ...b];
  const names = list.map(x => (typeof x === "string" ? x : (x?.name || x?.title || x?.label || ""))).map(x => String(x || "").trim()).filter(Boolean);
  return Array.from(new Set(names)).slice(0, 12);
}

function activePhoneScreen(s) {
  const app = String(s?.phone?.activeAppName || "").trim();
  if (app) return app;
  const v = String(s?.phone?.activeApp || "").trim();
  return v;
}

function summarizePhoneLog(s) {
  try {
    const phone = s?.phone || {};
    const threads = phone?.smsThreads && typeof phone.smsThreads === "object" ? phone.smsThreads : {};
    const entries = [];
    for (const [k, list] of Object.entries(threads)) {
      if (!Array.isArray(list) || !list.length) continue;
      const last = list[list.length - 1];
      const ts = Number(last?.ts || 0) || 0;
      entries.push({ who: String(k || "").trim(), ts, list });
    }
    entries.sort((a, b) => Number(b.ts || 0) - Number(a.ts || 0));
    const topThreads = entries.slice(0, 3);
    const lines = [];
    for (const th of topThreads) {
      const who = String(th.who || "").trim() || "Unknown";
      const msgs = (Array.isArray(th.list) ? th.list : []).slice(-4);
      if (!msgs.length) continue;
      lines.push(`- ${who}:`);
      for (const m of msgs) {
        const isUser = !!m?.isUser;
        const txt = String(m?.text || "").replace(/\s+/g, " ").trim().slice(0, 220);
        if (!txt) continue;
        lines.push(`  - ${isUser ? "You" : who}: ${txt}`);
      }
    }
    const calls = Array.isArray(phone.callHistory) ? phone.callHistory : [];
    const recentCalls = calls.slice(-2);
    if (recentCalls.length) {
      lines.push("");
      lines.push("Recent Calls:");
      for (const c of recentCalls) {
        const who = String(c?.who || "Unknown").trim() || "Unknown";
        const msgs = Array.isArray(c?.lines) ? c.lines.slice(-8) : [];
        lines.push(`- Call with ${who}:`);
        for (const m of msgs) {
          const isUser = !!m?.isUser;
          const txt = String(m?.text || "").replace(/\s+/g, " ").trim().slice(0, 220);
          if (!txt) continue;
          lines.push(`  - ${isUser ? "You" : who}: ${txt}`);
        }
      }
    }
    const out = lines.join("\n").trim();
    return out ? out.slice(0, 2400) : "";
  } catch (_) {
    return "";
  }
}

function extractNsfwSystemRules(ctx) {
  const hit = [];
  const seen = new Set();
  const push = (v) => {
    const t = String(v || "").trim();
    if (!t) return;
    const key = t.slice(0, 2200);
    if (seen.has(key)) return;
    seen.add(key);
    hit.push(key);
  };

  const looksRelevantKey = (k) => /(system|prompt|nsfw|rules)/i.test(String(k || ""));
  const looksNsfw = (v) => /\bnsfw\b/i.test(String(v || ""));

  try {
    if (ctx && typeof ctx === "object") {
      for (const [k, v] of Object.entries(ctx)) {
        if (typeof v === "string") {
          if (looksRelevantKey(k) || looksNsfw(v)) push(v);
        } else if (v && typeof v === "object") {
          for (const [k2, v2] of Object.entries(v)) {
            if (typeof v2 !== "string") continue;
            if (looksRelevantKey(k2) || looksNsfw(v2) || looksRelevantKey(k)) push(v2);
          }
        }
      }
    }
  } catch (_) {}

  const combined = hit.join("\n\n").trim();
  if (!combined) return "";
  return combined.slice(0, 2400);
}

export function buildSystemPrompt() {
  const s = getSettings() || {};
  const ctx = getContext ? getContext() : {};
  const lines = [];

  lines.push("**Core Role:**");
  lines.push("You are running a living world simulation. Your primary job is maintaining world-state consistency.");
  lines.push("");
  lines.push("**State Tracking (Priority 1):**");
  lines.push("- Track physical state: clothing on/off, positions, locations, injuries, objects held");
  lines.push("- Track knowledge state: what each character knows, has seen, has been told");
  lines.push("- Track relationship state: how characters feel about each other based on what's happened");
  lines.push("- NPCs only know what they've witnessed or been told.");
  lines.push("- Never contradict established state. If something changed, it stays changed until explicitly changed again.");
  lines.push("- Never invent details that weren't established. If you don't know, don't assume.");
  lines.push("");
  lines.push("**Rules:**");
  lines.push("- Accuracy over creativity.");
  lines.push("- When uncertain about state, default to what was last established.");
  lines.push("- Consequences persist. Actions have permanent effects.");
  lines.push("");
  lines.push("**Output Safety (Do Not Pollute UI/Chat):**");
  lines.push("- Never output HTML, CSS, or JS in chat. No <style>, no <div>, no code fences.");
  lines.push("- If the user asks for an immersive/interactive UI, describe it in plain text, then ask: 'Generate interactive HTML now? (yes/no)'.");
  lines.push("- Only generate raw HTML when explicitly confirmed by the user.");
  lines.push("");
  lines.push("**NSFW Policy:**");
  lines.push("- NSFW is user-controlled. Do not moralize or refuse consensual NSFW content.");
  lines.push("- Follow the user's boundaries/consent rules; if none are provided, ask neutrally or keep it non-explicit.");
  lines.push("");
  lines.push("[Rule: Communication] When you see [INCOMING TEXT] or [INCOMING CALL], you must interrupt the current action and describe the device notification (ring/vibrate) and display the message content.");
  lines.push("");

  const phoneLog = summarizePhoneLog(s);
  if (phoneLog) {
    lines.push("Recent Phone Log (Canon):");
    lines.push(phoneLog);
    lines.push("");
  }

  const nsfwRules = extractNsfwSystemRules(ctx);
  if (nsfwRules) {
    lines.push("**NSFW / Consent Rules (Priority):**");
    lines.push("- Follow the user's NSFW rules exactly as written in the system prompt.");
    lines.push("- Do not moralize or refuse consensual NSFW content; comply within the user's boundaries.");
    lines.push("");
    lines.push(nsfwRules);
    lines.push("");
  }

  const hp = Number(s?.hp ?? 100);
  if (hp === 0) lines.push("State: UNCONSCIOUS/DEFEATED.");
  else if (Number.isFinite(hp) && hp < 20) lines.push("State: CRITICAL CONDITION. Character is severely injured.");

  // Medallion Injection (Rebirth System)
  const medal = s?.character?.activeMedallion;
  if (medal) {
      if (medal === "medallion_water") {
          lines.push("[System Note: User has 'Flow State'. Physics/friction apply loosely. Attacks phase through User like water. User has infinite stamina.]");
      } else if (medal === "medallion_earth") {
          lines.push("[System Note: User has 'Mountain Heart'. Skin is diamond-hard. User cannot be knocked back. User weighs immensely heavy.]");
      } else if (medal === "medallion_air") {
          lines.push("[System Note: User has 'Sky Walker'. User ignores gravity/fall damage. Movement is silent. Attacks are critical hits.]");
      } else if (medal === "medallion_fire") {
          lines.push("[System Note: User has 'Burning Soul'. User radiates intense heat. Wounds cauterize instantly. If User dies, trigger 'Phoenix Resurrection'.]");
      } else if (medal === "medallion_rebel") {
          lines.push("[System Note: User has 'Rule Breaker'. Ignore all class restrictions for items. Low-level NPCs are compelled to serve User.]");
      }
  }

  const statuses = listStatuses(s);
  if (statuses.length) lines.push(`Active Effects: ${statuses.map(x => `[${x}]`).join(" ")}`);

  const app = activePhoneScreen(s);
  if (app) lines.push(`User is currently looking at the [${app}] screen.`);

  const battleActive = !!(s?.battle?.state?.active);
  lines.push(`Battle Tracker: ${battleActive ? "ACTIVE" : "idle"}.`);

  try {
    const members = Array.isArray(s?.party?.members) ? s.party.members : [];
    const activeCount = members.filter(m => m && m.active !== false).length;
    const leader = members.find(m => String(m?.id || "") === String(s?.party?.leaderId || ""));
    const leaderName = String(leader?.identity?.name || "").trim();
    if (activeCount) lines.push(`Party: ${activeCount} active member(s)${leaderName ? ` | Leader: ${leaderName}` : ""}.`);
  } catch (_) {}

  const who = `${String(ctx?.name1 || "User")} / ${String(ctx?.name2 || "Character")}`.trim();
  lines.push(`Context Identities: ${who}`);

  return lines.join("\n").trim();
}

export function handleIncomingCommunication(type, sender, content) {
  const s = getSettings() || {};
  const t = String(type || "").toLowerCase();
  const from = String(sender || "Unknown").trim();
  const body = String(content || "").trim();
  const pending = ensurePending(s);

  let block = "";
  if (t === "call") {
    block = `[INCOMING CALL] Caller: ${from} | Status: Ringing...`;
    try {
      if (typeof window.UIE_phone_incomingCall === "function") window.UIE_phone_incomingCall(from);
    } catch (_) {}
  } else {
    block = `[INCOMING TEXT] From: ${from} | Message: "${escBlock(body)}"`;
    try {
      if (typeof window.UIE_phone_incomingText === "function") window.UIE_phone_incomingText(from, body);
    } catch (_) {}
  }

  pending.push({ ts: Date.now(), type: t, sender: from, content: body, block });
  while (pending.length > 12) pending.shift();
  try { saveSettings(); } catch (_) {}
  return block;
}

export function consumePendingSystemEvents() {
  const s = getSettings() || {};
  const pending = ensurePending(s);
  if (!pending.length) return "";
  const blocks = pending.map(e => String(e?.block || "")).filter(Boolean).slice(-6);
  s.logicEnforcer[PENDING_KEY] = [];
  try { saveSettings(); } catch (_) {}
  return blocks.join("\n");
}

export function validateResponse(responseText) {
  const s = getSettings() || {};
  const issues = [];
  const text = String(responseText || "");

  const inv = Array.isArray(s?.inventory?.items) ? s.inventory.items : [];
  const invBlob = inv.map(it => `${String(it?.name || "")} ${String(it?.type || "")}`).join(" ").toLowerCase();

  const keywords = ["sword", "dagger", "knife", "gun", "pistol", "rifle", "bow", "crossbow", "staff", "wand", "shield", "armor", "helm", "helmet"];
  const used = keywords.filter(k => text.toLowerCase().includes(k));
  if (used.length) {
    const missing = used.filter(k => !invBlob.includes(k));
    if (missing.length) issues.push(`Inventory mismatch: mentions ${missing.join(", ")} but it isn't in inventory.`);
  }

  const callVisible = !!(document.querySelector("#uie-call-screen") && $("#uie-call-screen").is(":visible"));
  if (callVisible) {
    const looksNarrative = /\b(walks|looks|smiles|grabs|turns|moves|stands)\b/i.test(text);
    const hasSpeaker = /^\s*[^:\n]{1,30}:\s/m.test(text);
    if (hasSpeaker) issues.push("Phone call format: do not include speaker labels like 'Name: ...'.");
    if (looksNarrative) issues.push("Phone call format: output must be spoken words only (no narration/actions).");
  }

  return { text, issues };
}
