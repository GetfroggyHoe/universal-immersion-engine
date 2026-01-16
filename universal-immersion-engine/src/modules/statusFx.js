function fxId() {
  const a = Math.floor(Math.random() * 1e9).toString(16);
  const b = Date.now().toString(16);
  return `fx_${b}_${a}`;
}

export function parseDurationToMs(raw) {
  const s = String(raw || "").trim();
  if (!s) return 0;
  const m = s.match(/^(\d+(?:\.\d+)?)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)?$/i);
  if (!m) return 0;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return 0;
  const u = String(m[2] || "m").toLowerCase();
  if (u.startsWith("d")) return Math.round(n * 24 * 60 * 60 * 1000);
  if (u.startsWith("h")) return Math.round(n * 60 * 60 * 1000);
  return Math.round(n * 60 * 1000);
}

export function extractInlineDuration(text) {
  const raw = String(text || "").trim();
  if (!raw) return { name: "", durationMs: 0 };
  const re = /(?:\(|\[)\s*(\d+(?:\.\d+)?)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)\s*(?:\)|\])\s*$/i;
  const m = raw.match(re);
  if (!m) return { name: raw, durationMs: 0 };
  const ms = parseDurationToMs(`${m[1]}${m[2]}`);
  const name = raw.replace(re, "").trim();
  return { name, durationMs: ms };
}

export function statusName(x) {
  if (typeof x === "string") return String(x || "").trim();
  if (!x || typeof x !== "object") return "";
  const n = String(x.name || x.title || x.label || "").trim();
  return n;
}

export function statusKey(x) {
  return statusName(x).toLowerCase();
}

function clampNum(v, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(min, Math.min(max, n));
}

function ensureMods(m) {
  const out = (m && typeof m === "object") ? m : {};
  if (!out.stats || typeof out.stats !== "object") out.stats = {};
  return out;
}

function guessMods(name) {
  const n = String(name || "").toLowerCase();
  const mods = { maxHp: 0, maxMp: 0, maxAp: 0, maxXp: 0, hpPerMin: 0, mpPerMin: 0, apPerMin: 0, stats: {} };
  const addStat = (k, v) => { mods.stats[k] = (mods.stats[k] || 0) + v; };
  if (/(poison|toxic|venom)/.test(n)) mods.hpPerMin -= 1;
  if (/(bleed|hemorr)/.test(n)) mods.hpPerMin -= 2;
  if (/(burn|burning|on fire)/.test(n)) mods.hpPerMin -= 1;
  if (/(regen|regeneration)/.test(n)) mods.hpPerMin += 1;
  if (/(mana drain|silence)/.test(n)) mods.mpPerMin -= 1;
  if (/(energized|inspired|haste)/.test(n)) mods.maxAp += 5;
  if (/(tired|fatigue|exhaust|sleepy|drowsy)/.test(n)) { mods.maxAp -= 10; addStat("dex", -1); addStat("end", -1); }
  if (/(drunk|intoxic|hungover)/.test(n)) { addStat("dex", -1); addStat("luk", -1); }
  if (/(bless|blessed)/.test(n)) { addStat("luk", 1); addStat("spi", 1); }
  if (/(curse|cursed|hex)/.test(n)) { addStat("luk", -1); addStat("spi", -1); }
  return mods;
}

export function normalizeStatusEffect(x, now = Date.now()) {
  if (typeof x === "string") {
    const { name, durationMs } = extractInlineDuration(x);
    const nm = String(name || "").trim().slice(0, 80);
    if (!nm) return null;
    const mods = guessMods(nm);
    return { id: fxId(), name: nm, desc: "", startedAt: now, expiresAt: durationMs ? (now + durationMs) : null, mods };
  }
  if (!x || typeof x !== "object") return null;
  const nm0 = statusName(x);
  const { name, durationMs } = extractInlineDuration(nm0);
  const nm = String(name || "").trim().slice(0, 80);
  if (!nm) return null;
  const id = String(x.id || "").trim() || fxId();
  const startedAt = Number.isFinite(Number(x.startedAt)) ? Number(x.startedAt) : now;
  let expiresAt = (x.expiresAt === null || x.expiresAt === undefined) ? null : Number(x.expiresAt);
  if (!Number.isFinite(expiresAt)) expiresAt = null;
  if (!expiresAt && durationMs) expiresAt = now + durationMs;
  const desc = String(x.desc || x.description || "").trim().slice(0, 500);
  const mods0 = ensureMods(x.mods);
  const mods = {
    maxHp: clampNum(mods0.maxHp, -999999, 999999),
    maxMp: clampNum(mods0.maxMp, -999999, 999999),
    maxAp: clampNum(mods0.maxAp, -999999, 999999),
    maxXp: clampNum(mods0.maxXp, -999999, 999999),
    hpPerMin: clampNum(mods0.hpPerMin, -9999, 9999),
    mpPerMin: clampNum(mods0.mpPerMin, -9999, 9999),
    apPerMin: clampNum(mods0.apPerMin, -9999, 9999),
    stats: {},
  };
  const stats = mods0.stats || {};
  for (const [k, v] of Object.entries(stats)) {
    const key = String(k || "").trim().toLowerCase();
    if (!key) continue;
    mods.stats[key] = clampNum(v, -9999, 9999);
  }
  if (!x.mods && !desc) {
    const g = guessMods(nm);
    if (g) {
      mods.maxHp += g.maxHp || 0;
      mods.maxMp += g.maxMp || 0;
      mods.maxAp += g.maxAp || 0;
      mods.maxXp += g.maxXp || 0;
      mods.hpPerMin += g.hpPerMin || 0;
      mods.mpPerMin += g.mpPerMin || 0;
      mods.apPerMin += g.apPerMin || 0;
      for (const [k, v] of Object.entries(g.stats || {})) mods.stats[k] = (mods.stats[k] || 0) + Number(v || 0);
    }
  }
  return { id, name: nm, desc, startedAt, expiresAt, mods };
}

export function normalizeStatusList(list, now = Date.now()) {
  const src = Array.isArray(list) ? list : [];
  const out = [];
  const seen = new Set();
  for (const it of src) {
    const fx = normalizeStatusEffect(it, now);
    if (!fx) continue;
    const k = statusKey(fx);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(fx);
  }
  return out;
}

export function formatRemaining(expiresAt, now = Date.now()) {
  const t = Number(expiresAt);
  if (!Number.isFinite(t) || t <= 0) return "";
  const ms = t - now;
  if (ms <= 0) return "expired";
  const min = Math.floor(ms / 60000);
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

export function summarizeMods(mods) {
  const m = ensureMods(mods);
  const out = [];
  const push = (label, v) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n === 0) return;
    out.push(`${label} ${n > 0 ? `+${n}` : `${n}`}`);
  };
  push("Max HP", m.maxHp);
  push("Max MP", m.maxMp);
  push("Max AP", m.maxAp);
  push("Max XP", m.maxXp);
  push("HP/min", m.hpPerMin);
  push("MP/min", m.mpPerMin);
  push("AP/min", m.apPerMin);
  const stats = (m.stats && typeof m.stats === "object") ? m.stats : {};
  for (const k of Object.keys(stats)) {
    const v = Number(stats[k]);
    if (!Number.isFinite(v) || v === 0) continue;
    out.push(`${k.toUpperCase()} ${v > 0 ? `+${v}` : `${v}`}`);
  }
  return out.slice(0, 24);
}

export function computeStatusTotals(fxList) {
  const list = Array.isArray(fxList) ? fxList : [];
  const totals = { maxHp: 0, maxMp: 0, maxAp: 0, maxXp: 0, hpPerMin: 0, mpPerMin: 0, apPerMin: 0, stats: {} };
  for (const fx of list) {
    if (!fx || typeof fx !== "object") continue;
    const m = ensureMods(fx.mods);
    totals.maxHp += Number(m.maxHp || 0);
    totals.maxMp += Number(m.maxMp || 0);
    totals.maxAp += Number(m.maxAp || 0);
    totals.maxXp += Number(m.maxXp || 0);
    totals.hpPerMin += Number(m.hpPerMin || 0);
    totals.mpPerMin += Number(m.mpPerMin || 0);
    totals.apPerMin += Number(m.apPerMin || 0);
    const stats = (m.stats && typeof m.stats === "object") ? m.stats : {};
    for (const [k, v] of Object.entries(stats)) {
      const key = String(k || "").trim().toLowerCase();
      if (!key) continue;
      totals.stats[key] = (totals.stats[key] || 0) + Number(v || 0);
    }
  }
  return totals;
}

export function applyStatusTickToVitals(s, fxList, now = Date.now()) {
  const totals = computeStatusTotals(fxList);
  const perMin = { hp: Number(totals.hpPerMin || 0), mp: Number(totals.mpPerMin || 0), ap: Number(totals.apPerMin || 0) };
  if (!perMin.hp && !perMin.mp && !perMin.ap) return false;
  if (!s || typeof s !== "object") return false;
  if (!s.character || typeof s.character !== "object") s.character = {};
  const last = Number(s.character.fxTickAt || 0);
  const start = last && Number.isFinite(last) ? last : now;
  const dt = Math.max(0, Math.min(6 * 60 * 60 * 1000, now - start));
  if (dt < 5000) { s.character.fxTickAt = now; return false; }
  const mins = dt / 60000;
  const carry = (s.character.fxTickCarry && typeof s.character.fxTickCarry === "object") ? s.character.fxTickCarry : { hp: 0, mp: 0, ap: 0 };
  const step = (key, curKey) => {
    const rate = Number(perMin[key] || 0);
    if (!rate) return 0;
    const raw = rate * mins + Number(carry[key] || 0);
    const whole = raw >= 0 ? Math.floor(raw) : Math.ceil(raw);
    carry[key] = raw - whole;
    const cur = Number(s[curKey] || 0);
    const next = cur + whole;
    s[curKey] = next;
    return whole;
  };
  const dHp = step("hp", "hp");
  const dMp = step("mp", "mp");
  const dAp = step("ap", "ap");
  s.character.fxTickCarry = carry;
  s.character.fxTickAt = now;
  return !!(dHp || dMp || dAp);
}

