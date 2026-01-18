import { getSettings, saveSettings, ensureChatStateLoaded } from "./core.js";
import { generateContent } from "./apiClient.js";

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function pad2(n) { return String(n).padStart(2, "0"); }
function ymd(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function monthKey(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`; }
function parseMonthCursor(cur) {
  const m = String(cur || "").match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mm = Number(m[2]) - 1;
  if (!Number.isFinite(y) || !Number.isFinite(mm)) return null;
  return new Date(y, mm, 1);
}

function getChatSnippet() {
  try {
    let raw = "";
    const $txt = $(".chat-msg-txt");
    if ($txt.length) {
      $txt.slice(-18).each(function () { raw += $(this).text() + "\n"; });
      return raw.trim().slice(0, 2200);
    }
    const chatEl = document.getElementById("chat");
    if (!chatEl) return "";
    const msgs = Array.from(chatEl.querySelectorAll(".mes")).slice(-18);
    for (const m of msgs) {
      const isUser =
        m.classList?.contains("is_user") ||
        m.getAttribute?.("is_user") === "true" ||
        m.getAttribute?.("data-is-user") === "true" ||
        m.dataset?.isUser === "true";
      const t =
        m.querySelector?.(".mes_text")?.textContent ||
        m.querySelector?.(".mes-text")?.textContent ||
        m.textContent ||
        "";
      const line = `${isUser ? "You" : "Story"}: ${String(t || "").trim()}`;
      if (!line.trim()) continue;
      raw += line.slice(0, 520) + "\n";
    }
    return raw.trim().slice(0, 2200);
  } catch (_) {
    return "";
  }
}

function ensureCalendar(s) {
  if (!s.calendar) s.calendar = { events: {}, cursor: "" };
  if (!s.calendar.events || typeof s.calendar.events !== "object") s.calendar.events = {};
  if (typeof s.calendar.cursor !== "string") s.calendar.cursor = "";
  if (typeof s.calendar.rpEnabled !== "boolean") s.calendar.rpEnabled = false;
  if (typeof s.calendar.rpDate !== "string") s.calendar.rpDate = "";

  if (s.calendar._phoneMerged !== true && s.phone?.calendar?.events && typeof s.phone.calendar.events === "object") {
    for (const k of Object.keys(s.phone.calendar.events)) {
      if (!Array.isArray(s.calendar.events[k])) s.calendar.events[k] = [];
      const list = s.phone.calendar.events[k];
      if (!Array.isArray(list)) continue;
      list.forEach(e => {
        const title = String(e?.title || "").trim();
        if (!title) return;
        const exists = s.calendar.events[k].some(x => String(x?.title || "") === title);
        if (exists) return;
        s.calendar.events[k].push({ title: title.slice(0, 80), notes: String(e?.notes || "").slice(0, 500), ts: Number(e?.ts || Date.now()) });
      });
    }
    s.calendar._phoneMerged = true;
  }
}

function parseYmdAny(str) {
  const m = String(str || "").trim().match(/^(\d{1,6})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mm = Number(m[2]);
  const dd = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mm) || !Number.isFinite(dd)) return null;
  if (y < 1 || y > 999999) return null;
  if (mm < 1 || mm > 12) return null;
  if (dd < 1 || dd > 31) return null;
  const d = new Date(y, mm - 1, dd);
  if (d.getFullYear() !== y || d.getMonth() !== (mm - 1) || d.getDate() !== dd) return null;
  return d;
}

function effectiveNow(s) {
  ensureCalendar(s);
  if (s.calendar.rpEnabled !== true) return new Date();
  const d = parseYmdAny(s.calendar.rpDate);
  if (d) return d;
  const now = new Date();
  s.calendar.rpDate = ymd(now);
  saveSettings();
  return now;
}

function setRpDate(s, dateObj) {
  ensureCalendar(s);
  const d = dateObj instanceof Date ? dateObj : null;
  if (!d) return false;
  s.calendar.rpEnabled = true;
  s.calendar.rpDate = ymd(d);
  s.calendar.cursor = monthKey(new Date(d.getFullYear(), d.getMonth(), 1));
  saveSettings();
  return true;
}

function advanceRpDays(s, deltaDays) {
  ensureCalendar(s);
  const now = effectiveNow(s);
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() + Number(deltaDays || 0));
  return setRpDate(s, d);
}

// === EXPORT / IMPORT ===
function exportCalendar() {
  const s = getSettings();
  ensureCalendar(s);
  const json = JSON.stringify(s.calendar.events, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `uie_calendar_${ymd(new Date())}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function importCalendar(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid format");
      const s = getSettings();
      ensureCalendar(s);
      // Merge strategy: Keep existing, add new if unique
      for (const k of Object.keys(data)) {
        if (!Array.isArray(data[k])) continue;
        if (!s.calendar.events[k]) s.calendar.events[k] = [];
        for (const ev of data[k]) {
          const title = String(ev?.title || "").trim();
          if (!title) continue;
          const exists = s.calendar.events[k].some(x => String(x?.title || "") === title);
          if (!exists) {
            s.calendar.events[k].push({ 
              title: title.slice(0, 80), 
              notes: String(ev?.notes || "").slice(0, 500), 
              ts: Number(ev?.ts || Date.now()) 
            });
          }
        }
      }
      saveSettings();
      renderCalendar();
      if (window.toastr) toastr.success("Calendar imported successfully.");
    } catch (err) {
      console.error(err);
      if (window.toastr) toastr.error("Failed to import calendar: " + err.message);
    }
  };
  reader.readAsText(file);
}

async function calendarGenerateFromDescription(desc) {
  const s = getSettings();
  try { ensureChatStateLoaded(); } catch (_) {}
  ensureCalendar(s);
  const now = effectiveNow(s);
  const prompt = `
Return JSON only: {"events":[{"date":"YYYY-MM-DD","time":"","title":"","notes":""}]}
Rules:
- This is a fantasy/RP calendar; do not apply real-world timezone logic
- 1-12 events max
- "time" is optional (examples: "morning", "14:00", "midnight")
- Use future dates when possible; if a birthday is known, set next occurrence
- No narration, no markdown
Current RP date (if set): ${ymd(now)}
User description: ${desc}
`;
  const res = await generateContent(prompt.slice(0, 6000), "System Check");
  if (!res) return;
  let obj = null;
  try { obj = JSON.parse(String(res).replace(/```json|```/g, "").trim()); } catch (_) { obj = null; }
  const arr = Array.isArray(obj?.events) ? obj.events : [];
  for (const e of arr) {
    const date = String(e?.date || "").trim();
    const time = String(e?.time || "").trim().slice(0, 40);
    const title = String(e?.title || "").trim();
    if (!date || !title) continue;
    if (!s.calendar.events[date]) s.calendar.events[date] = [];
    s.calendar.events[date].push({ title: title.slice(0, 80), time, notes: String(e?.notes || "").slice(0, 500), ts: Date.now() });
  }
  saveSettings();
  renderCalendar();
}

async function calendarScanChatLog() {
  const s = getSettings();
  try { ensureChatStateLoaded(); } catch (_) {}
  ensureCalendar(s);
  const now = effectiveNow(s);
  const chat = getChatSnippet();
  const prompt = `
Return JSON only: {"events":[{"date":"YYYY-MM-DD","time":"","title":"","notes":""}]}
Rules:
- Extract explicit/implicit calendar events mentioned in chat (birthdays, meetings, holidays, deadlines)
- This is a fantasy/RP calendar; do not apply real-world timezone logic
- If the date is missing, infer a best-effort date relative to the current month, else skip it
- "time" is optional (examples: "morning", "14:00", "midnight")
- No narration, no markdown
Current RP date (if set): ${ymd(now)}
CHAT:
${chat}
`;
  const res = await generateContent(prompt.slice(0, 6000), "System Check");
  if (!res) return;
  let obj = null;
  try { obj = JSON.parse(String(res).replace(/```json|```/g, "").trim()); } catch (_) { obj = null; }
  const arr = Array.isArray(obj?.events) ? obj.events : [];
  for (const e of arr) {
    const date = String(e?.date || "").trim();
    const time = String(e?.time || "").trim().slice(0, 40);
    const title = String(e?.title || "").trim();
    if (!date || !title) continue;
    if (!s.calendar.events[date]) s.calendar.events[date] = [];
    const exists = s.calendar.events[date].some(x => String(x?.title || "") === title);
    if (exists) continue;
    s.calendar.events[date].push({ title: title.slice(0, 80), time, notes: String(e?.notes || "").slice(0, 500), ts: Date.now() });
  }
  saveSettings();
  renderCalendar();
}

function renderCalModalList() {
  const s = getSettings();
  ensureCalendar(s);
  const dateKey = String($("#cal-modal").data("date") || "");
  const list = $("#cal-modal-list");
  if (!list.length) return;
  list.empty();
  const ev = Array.isArray(s.calendar.events[dateKey]) ? s.calendar.events[dateKey] : [];
  if (!ev.length) {
    list.html(`<div style="opacity:0.75; padding:10px 12px; border-radius:14px; border:1px dashed rgba(255,255,255,0.12); text-align:center;">No events.</div>`);
    return;
  }
  ev.forEach((e, i) => {
    const t = String(e?.time || "").trim();
    list.append(`
      <div style="padding:10px 12px; border-radius:6px; border:1px solid rgba(255,255,255,0.12); background:rgba(0,0,0,0.22); display:flex; gap:10px; align-items:flex-start;">
        <div style="flex:1; min-width:0;">
          <div style="font-weight:900;">${t ? `<span style="opacity:0.8;">${esc(t)}</span> ` : ""}${esc(e.title || "Event")}</div>
          ${e.notes ? `<div style="opacity:0.75; font-size:12px; margin-top:4px; white-space:pre-wrap;">${esc(e.notes)}</div>` : ""}
        </div>
        <button class="cal-del" data-idx="${i}" style="height:34px; width:38px; border-radius:6px; border:1px solid rgba(243,139,168,0.35); background:rgba(0,0,0,0.25); color:#f38ba8; font-weight:900;">×</button>
      </div>
    `);
  });
}

function openCalModal(dateKey, anchorEl) {
  $("#cal-modal-title").text(dateKey);
  const $modal = $("#cal-modal");
  $modal.css("display", "block").data("date", dateKey);
  renderCalModalList();

  const win = document.getElementById("uie-calendar-window");
  const card = document.getElementById("cal-modal-card");
  if (!win || !card) return;

  const winRect = win.getBoundingClientRect();
  const anchorRect = anchorEl?.getBoundingClientRect ? anchorEl.getBoundingClientRect() : winRect;

  card.style.visibility = "hidden";
  card.style.left = "10px";
  card.style.top = "10px";

  requestAnimationFrame(() => {
    const cardRect = card.getBoundingClientRect();
    const pad = 10;
    let left = Math.round(anchorRect.left - winRect.left);
    let top = Math.round(anchorRect.bottom - winRect.top + 8);

    const maxLeft = Math.max(pad, Math.floor(winRect.width - cardRect.width - pad));
    const maxTop = Math.max(pad, Math.floor(winRect.height - cardRect.height - pad));

    left = Math.max(pad, Math.min(left, maxLeft));
    top = Math.max(pad, Math.min(top, maxTop));

    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
    card.style.visibility = "visible";
  });
}

function openRpModal() {
  const $m = $("#cal-rp-modal");
  const win = document.getElementById("uie-calendar-window");
  const card = document.getElementById("cal-rp-card");
  if (!$m.length || !win || !card) return;
  $m.css("display", "block");

  const winRect = win.getBoundingClientRect();
  card.style.visibility = "hidden";
  card.style.left = `${Math.round(winRect.left + 10)}px`;
  card.style.top = `${Math.round(winRect.top + 10)}px`;

  requestAnimationFrame(() => {
    const cardRect = card.getBoundingClientRect();
    const pad = 12;
    let left = Math.round(winRect.left + (winRect.width - cardRect.width) / 2);
    let top = Math.round(winRect.top + (winRect.height - cardRect.height) / 2);
    const maxLeft = Math.max(pad, Math.floor(winRect.width - cardRect.width - pad));
    const maxTop = Math.max(pad, Math.floor(winRect.height - cardRect.height - pad));
    left = Math.max(Math.round(winRect.left + pad), Math.min(left, Math.round(winRect.left + maxLeft)));
    top = Math.max(Math.round(winRect.top + pad), Math.min(top, Math.round(winRect.top + maxTop)));
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
    card.style.visibility = "visible";
  });
}

export function renderCalendar() {
  try { ensureChatStateLoaded(); } catch (_) {}
  const s = getSettings();
  ensureCalendar(s);

  try {
    const loc = String(s?.worldState?.location || "In-world").trim() || "In-world";
    const time = String(s?.worldState?.time || "").trim();
    $("#cal-tz").text(time ? `${loc} • ${time}` : loc);
  } catch (_) {
    $("#cal-tz").text("In-world");
  }

  const now = effectiveNow(s);
  let cursor = parseMonthCursor(s.calendar.cursor);
  if (!cursor) cursor = new Date(now.getFullYear(), now.getMonth(), 1);
  s.calendar.cursor = monthKey(cursor);

  const title = cursor.toLocaleString(undefined, { month: "long", year: "numeric" });
  $("#cal-month-title").text(title);

  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const startDay = first.getDay();
  const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
  const grid = $("#cal-grid");
  if (!grid.length) return;
  grid.empty();

  const todayKey = ymd(now);
  try {
    const cb = document.getElementById("cal-use-rp-date");
    const inp = document.getElementById("cal-rp-date");
    if (cb) cb.checked = s.calendar.rpEnabled === true;
    if (inp && document.activeElement !== inp) inp.value = String(s.calendar.rpDate || (s.calendar.rpEnabled ? todayKey : "")).trim();
  } catch (_) {}
  for (let i = 0; i < startDay; i++) {
    grid.append(`<div style="height:58px; border-radius:6px; border:1px solid rgba(255,255,255,0.05); background:rgba(255,255,255,0.02); opacity:0.3;"></div>`);
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const dt = new Date(cursor.getFullYear(), cursor.getMonth(), d);
    const key = ymd(dt);
    const ev = Array.isArray(s.calendar.events[key]) ? s.calendar.events[key] : [];
    const isToday = key === todayKey;
    const dots = ev.slice(0, 3).map(() => `<span style="width:6px;height:6px;border-radius:2px;background:#f1c40f;display:inline-block;"></span>`).join("");
    grid.append(`
      <div class="cal-day" data-date="${key}" style="height:58px; border-radius:6px; border:1px solid rgba(255,255,255,0.10); background:${isToday ? "rgba(255,59,48,0.20)" : "rgba(0,0,0,0.18)"}; padding:8px; display:flex; flex-direction:column; gap:6px; cursor:pointer;">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div style="font-weight:900; opacity:${isToday ? "1" : "0.9"};">${d}</div>
          <div style="display:flex; gap:4px;">${dots}</div>
        </div>
        <div style="font-size:11px; opacity:0.75; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${ev[0] ? esc(ev[0].title || "") : ""}</div>
      </div>
    `);
  }
}

export function initCalendar() {
  $(document).off("click.uieCal change.uieCal");

  // Menu Toggle
  $(document).on("click.uieCal", "#cal-menu-btn", function(e) {
    e.preventDefault(); e.stopPropagation();
    const menu = $("#cal-menu-dropdown");
    if (menu.is(":visible")) menu.hide();
    else menu.css("display", "flex");
  });

  // Close menu when clicking outside
  $(document).on("click.uieCal", function(e) {
    if (!$(e.target).closest("#cal-menu-btn, #cal-menu-dropdown").length) {
      $("#cal-menu-dropdown").hide();
    }
  });

  $(document).on("click.uieCal", "#cal-prev", function(e){
    e.preventDefault(); e.stopPropagation();
    const s = getSettings(); ensureCalendar(s);
    const cur = parseMonthCursor(s.calendar.cursor) || new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    s.calendar.cursor = monthKey(new Date(cur.getFullYear(), cur.getMonth() - 1, 1));
    saveSettings();
    renderCalendar();
  });

  $(document).on("click.uieCal", "#cal-next", function(e){
    e.preventDefault(); e.stopPropagation();
    const s = getSettings(); ensureCalendar(s);
    const cur = parseMonthCursor(s.calendar.cursor) || new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    s.calendar.cursor = monthKey(new Date(cur.getFullYear(), cur.getMonth() + 1, 1));
    saveSettings();
    renderCalendar();
  });

  $(document).on("click.uieCal", "#cal-rp-open-btn", function (e) {
    e.preventDefault(); e.stopPropagation();
    $("#cal-menu-dropdown").hide();
    openRpModal();
  });

  $(document).on("click.uieCal", "#cal-rp-modal-close", function (e) {
    e.preventDefault(); e.stopPropagation();
    $("#cal-rp-modal").hide();
  });

  $(document).on("click.uieCal", "#cal-rp-modal", function (e) {
    if ($(e.target).closest("#cal-rp-card").length) return;
    $("#cal-rp-modal").hide();
  });

  $(document).on("change.uieCal", "#cal-use-rp-date", function (e) {
    e.preventDefault(); e.stopPropagation();
    const s = getSettings(); ensureCalendar(s);
    s.calendar.rpEnabled = !!this.checked;
    if (s.calendar.rpEnabled && !parseYmdAny(s.calendar.rpDate)) s.calendar.rpDate = ymd(new Date());
    if (s.calendar.rpEnabled) {
      const d = effectiveNow(s);
      s.calendar.cursor = monthKey(new Date(d.getFullYear(), d.getMonth(), 1));
    }
    saveSettings();
    renderCalendar();
  });

  $(document).on("click.uieCal", "#cal-rp-set", function (e) {
    e.preventDefault(); e.stopPropagation();
    const raw = String($("#cal-rp-date").val() || "").trim();
    const d = parseYmdAny(raw);
    if (!d) {
      try { window.toastr?.error?.("Invalid date. Use YYYY-MM-DD (example: 2230-01-01)."); } catch (_) {}
      return;
    }
    const s = getSettings();
    setRpDate(s, d);
    renderCalendar();
  });

  $(document).on("click.uieCal", "#cal-rp-prev-day", function (e) {
    e.preventDefault(); e.stopPropagation();
    const s = getSettings();
    advanceRpDays(s, -1);
    renderCalendar();
  });
  $(document).on("click.uieCal", "#cal-rp-next-day", function (e) {
    e.preventDefault(); e.stopPropagation();
    const s = getSettings();
    advanceRpDays(s, 1);
    renderCalendar();
  });
  $(document).on("click.uieCal", "#cal-rp-next-week", function (e) {
    e.preventDefault(); e.stopPropagation();
    const s = getSettings();
    advanceRpDays(s, 7);
    renderCalendar();
  });
  $(document).on("click.uieCal", "#cal-today-btn, #cal-rp-today", function (e) {
    e.preventDefault(); e.stopPropagation();
    $("#cal-menu-dropdown").hide();
    const s = getSettings(); ensureCalendar(s);
    s.calendar.rpEnabled = false;
    saveSettings();
    renderCalendar();
  });

  $(document).on("click.uieCal", "#cal-refresh-btn, #cal-refresh", async function(e){
    e.preventDefault(); e.stopPropagation();
    $("#cal-menu-dropdown").hide();
    const btn = $("#cal-refresh-btn");
    btn.prop("disabled", true);
    try { await calendarScanChatLog(); } finally { btn.prop("disabled", false); }
  });

  $(document).on("click.uieCal", "#cal-sparkle-gen-btn", async function(e){
    e.preventDefault(); e.stopPropagation();
    $("#cal-menu-dropdown").hide();
    const desc = (prompt("Describe the dates/events you want to add to the calendar:") || "").trim();
    if(!desc) return;
    const btn = $("#cal-sparkle-gen-btn");
    btn.prop("disabled", true);
    try { await calendarGenerateFromDescription(desc); } finally { btn.prop("disabled", false); }
  });

  $(document).on("click.uieCal", "#cal-add-btn", function(e){
    e.preventDefault(); e.stopPropagation();
    $("#cal-menu-dropdown").hide();
    const s = getSettings();
    const now = effectiveNow(s);
    const dateKey = ymd(now);
    openCalModal(dateKey);
  });

  $(document).on("click.uieCal", "#cal-grid .cal-day", function(e){
    e.preventDefault(); e.stopPropagation();
    openCalModal(String($(this).data("date") || ""), this);
  });

  $(document).on("click.uieCal", "#cal-modal-close", function(e){
    e.preventDefault(); e.stopPropagation();
    $("#cal-modal").hide();
  });

  $(document).on("click.uieCal", "#cal-add", function(e){
    e.preventDefault(); e.stopPropagation();
    const dateKey = String($("#cal-modal").data("date") || "");
    if(!dateKey) return;
    const title = String($("#cal-new-title").val() || "").trim();
    const time = String($("#cal-new-time").val() || "").trim().slice(0, 40);
    const notes = String($("#cal-new-notes").val() || "").trim();
    if(!title) return;
    const s = getSettings(); ensureCalendar(s);
    if(!s.calendar.events[dateKey]) s.calendar.events[dateKey] = [];
    s.calendar.events[dateKey].push({ title: title.slice(0,80), time, notes: notes.slice(0,500), ts: Date.now() });
    saveSettings();
    $("#cal-new-title").val("");
    $("#cal-new-time").val("");
    $("#cal-new-notes").val("");
    renderCalModalList();
    renderCalendar();
  });

  $(document).on("click.uieCal", "#cal-modal-list .cal-del", function(e){
    e.preventDefault(); e.stopPropagation();
    const idx = Number($(this).data("idx"));
    const dateKey = String($("#cal-modal").data("date") || "");
    const s = getSettings(); ensureCalendar(s);
    const ev = s.calendar.events[dateKey];
    if (!Array.isArray(ev)) return;
    if (idx >= 0 && idx < ev.length) {
      ev.splice(idx, 1);
      if (!ev.length) delete s.calendar.events[dateKey];
      saveSettings();
      renderCalModalList();
      renderCalendar();
    }
  });

  // Export/Import UI bindings
  $(document).on("click.uieCal", "#cal-export-btn", function(e) {
    e.preventDefault(); e.stopPropagation();
    $("#cal-menu-dropdown").hide();
    exportCalendar();
  });

  $(document).on("click.uieCal", "#cal-import-btn", function(e) {
    e.preventDefault(); e.stopPropagation();
    $("#cal-menu-dropdown").hide();
    $("#cal-import-file").click();
  });

  $(document).on("change.uieCal", "#cal-import-file", function(e) {
    if (this.files && this.files[0]) {
      importCalendar(this.files[0]);
      $(this).val(""); // Reset
    }
  });
}

export function openCalendar() {
  initCalendar();
  renderCalendar();
}
