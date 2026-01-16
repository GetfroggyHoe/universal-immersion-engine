import { getSettings, saveSettings } from "./core.js";

function ensureNotificationsModel(s) {
  if (!s) return;
  if (!s.ui) s.ui = {};
  if (s.ui.showPopups === undefined) s.ui.showPopups = true;
  if (!s.ui.notifications || typeof s.ui.notifications !== "object") s.ui.notifications = {};
  const n = s.ui.notifications;
  if (!n.categories || typeof n.categories !== "object") n.categories = {};
  if (!n.lowHp || typeof n.lowHp !== "object") n.lowHp = { enabled: false, threshold: 0.25, lastWarnAt: 0 };
  if (n.lowHp.enabled === undefined) n.lowHp.enabled = false;
  if (!Number.isFinite(Number(n.lowHp.threshold))) n.lowHp.threshold = 0.25;
  if (!Number.isFinite(Number(n.lowHp.lastWarnAt))) n.lowHp.lastWarnAt = 0;
  if (!n.postBattle || typeof n.postBattle !== "object") n.postBattle = { enabled: false };
  if (n.postBattle.enabled === undefined) n.postBattle.enabled = false;
  if (n.css === undefined) n.css = "";
}

export function shouldNotify(category) {
  const s = getSettings();
  ensureNotificationsModel(s);
  if (s?.ui?.showPopups === false) return false;
  if (!category) return true;
  const key = String(category || "").trim();
  if (!key) return true;
  const enabled = s.ui.notifications?.categories?.[key];
  return enabled !== false;
}

export function notify(level, message, title, category, options) {
  const s = getSettings();
  ensureNotificationsModel(s);
  if (s?.ui?.showPopups === false) return;
  if (!shouldNotify(category)) return;
  if (!window.toastr) return;

  const lvl = String(level || "info");
  const fn =
    lvl === "success" ? window.toastr.success :
    lvl === "warning" ? window.toastr.warning :
    lvl === "error" ? window.toastr.error :
    window.toastr.info;

  const opts = options && typeof options === "object" ? { ...options } : {};
  const key = String(category || "").trim();
  if (key) {
    const safe = key.replace(/[^a-z0-9_-]/gi, "-").toLowerCase();
    const base = String(opts.toastClass || "toast");
    const parts = base.split(/\s+/).filter(Boolean);
    if (!parts.includes(`toast-uie-cat-${safe}`)) parts.push(`toast-uie-cat-${safe}`);
    opts.toastClass = parts.join(" ");
  }
  try { fn.call(window.toastr, String(message || ""), title ? String(title) : undefined, opts); } catch (_) {}
}

export function notifyLowHpIfNeeded() {
  const s = getSettings();
  ensureNotificationsModel(s);
  if (!shouldNotify("lowHp")) return;
  if (s.ui.notifications.lowHp?.enabled !== true) return;

  const hp = Number(s.hp || 0);
  const maxHp = Math.max(1, Number(s.maxHp || 100));
  const pct = hp / maxHp;
  const threshold = Math.max(0.05, Math.min(0.9, Number(s.ui.notifications.lowHp.threshold || 0.25)));
  if (pct > threshold) return;

  const now = Date.now();
  const last = Number(s.ui.notifications.lowHp.lastWarnAt || 0);
  if (now - last < 90000) return;

  s.ui.notifications.lowHp.lastWarnAt = now;
  saveSettings();
  notify("warning", `Low HP: ${Math.max(0, Math.round(pct * 100))}%`, "Warning", "lowHp");
}
