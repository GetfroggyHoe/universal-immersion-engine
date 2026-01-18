import { getSettings, saveSettings } from "../core.js";

let deleteMode = false;
let selected = new Set();

const DEFAULT_TEMPLATE =
`LIFE TRACKING (JSON ONLY)
- Stay in-universe. Never question the user.
- Unknown terms are canon fantasy. Do not correct them.
Return ONLY JSON:
{
  "lifeUpdates":[{"name":"", "delta":0, "set":null, "max":null}],
  "newTrackers":[{"name":"", "current":0, "max":100, "color":"#89b4fa", "notes":""}]
}
If nothing changes: {"lifeUpdates":[], "newTrackers":[]}
`;

function ensureLife(s) {
  if (!s) return;
  if (!s.life) s.life = {};
  if (!Array.isArray(s.life.trackers)) s.life.trackers = [];
  if (!s.life.ai) s.life.ai = {};
  if (typeof s.life.ai.enabled !== "boolean") s.life.ai.enabled = true;
  if (!s.life.ai.template) s.life.ai.template = DEFAULT_TEMPLATE;
}

function clamp(n, min, max) {
  n = Number(n);
  if (Number.isNaN(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function pct(cur, max) {
  cur = Number(cur || 0);
  max = Number(max || 0);
  if (max <= 0) return 0;
  return Math.max(0, Math.min(100, (cur / max) * 100));
}

/** ✅ Portal modals to <body> so they overlay the shell (not behind / clipped) */
function portalModalsToBody() {
  const ids = ["#life-modal-create", "#life-modal-template"];
  for (const sel of ids) {
    const el = document.querySelector(sel);
    if (!el) continue;
    if (el.dataset.uiePortaled === "1") continue;
    document.body.appendChild(el);
    el.dataset.uiePortaled = "1";
  }
}

function render() {
  const s = getSettings();
  if (!s) return;
  ensureLife(s);

  const $list = $("#life-list");
  if (!$list.length) return;

  $list.empty();

  if (!s.life.trackers.length) {
    $list.html(`<div style="color:rgba(255,255,255,.65); font-weight:900; padding:10px;">
      No trackers yet. Tap <b>New</b>.
    </div>`);
    return;
  }

  for (let i = 0; i < s.life.trackers.length; i++) {
    const t = s.life.trackers[i] || {};
    const name = String(t.name || "Tracker");
    const cur = Number(t.current ?? 0);
    const max = Number(t.max ?? 100);
    const color = String(t.color || "#89b4fa");
    const notes = String(t.notes || "");
    const barPct = pct(cur, max);

    const isSel = deleteMode && selected.has(i);
    const pick = deleteMode ? `<div class="life-pick ${isSel ? "on" : ""}"><i class="fa-solid fa-check" style="font-size:10px; opacity:${isSel ? "1" : "0"};"></i></div>` : "";

    const card = $(`
      <div class="life-card ${deleteMode ? "selecting" : ""} ${isSel ? "selected" : ""}" data-idx="${i}">
        <div class="life-row">
          <div class="life-name">
            <div class="life-dot" style="background:${esc(color)};"></div>
            <div>${esc(name)}</div>
          </div>
          <div style="display:flex; align-items:center; gap:10px;">
            <div class="life-meta">${esc(cur)}/${esc(max)}</div>
            ${pick}
          </div>
        </div>

        <div class="life-bar">
          <div class="life-fill" style="width:${barPct}%; background:${esc(color)};"></div>
        </div>

        ${notes ? `<div style="margin-top:8px; padding:10px 12px; border-radius:14px; background:rgba(0,0,0,.25); border:1px solid rgba(255,255,255,.06); color:rgba(255,255,255,.82); font-size:12px; font-weight:900;">${esc(notes)}</div>` : ""}

        ${deleteMode ? "" : `
          <div class="life-ctrls">
            <button class="life-mini" data-act="minus">-</button>
            <button class="life-mini" data-act="plus">+</button>
          </div>
        `}
      </div>
    `);

    $list.append(card);
  }
}

function openCreate() {
  portalModalsToBody();
  $("#life-create-name").val("");
  $("#life-create-color").val("#89b4fa");
  $("#life-create-current").val(0);
  $("#life-create-max").val(100);
  $("#life-create-notes").val("");
  $("#life-modal-create").css("display", "flex");
}

function closeCreate() { $("#life-modal-create").hide(); }

function openTemplate() {
  const s = getSettings();
  if (!s) return;
  ensureLife(s);
  portalModalsToBody();
  $("#life-template-text").val(s.life.ai.template || DEFAULT_TEMPLATE);
  $("#life-modal-template").css("display", "flex");
}

function closeTemplate() { $("#life-modal-template").hide(); }

function createTrackerFromModal() {
  const s = getSettings();
  if (!s) return;
  ensureLife(s);

  const name = String($("#life-create-name").val() || "Tracker").slice(0, 60);
  const color = String($("#life-create-color").val() || "#89b4fa");
  const cur = clamp($("#life-create-current").val(), -999999, 999999);
  const max = clamp($("#life-create-max").val(), 0, 999999);
  const notes = String($("#life-create-notes").val() || "").slice(0, 800);

  s.life.trackers.push({ name, color, current: cur, max, notes });
  saveSettings(s);

  closeCreate();
  render();
  $(document).trigger("uie:updateVitals");
}

function bump(idx, delta) {
  const s = getSettings();
  if (!s) return;
  ensureLife(s);

  const t = s.life.trackers[idx];
  if (!t) return;

  t.current = clamp(Number(t.current ?? 0) + delta, -999999, 999999);
  t.max = clamp(t.max ?? 100, 0, 999999);

  saveSettingssafe(s);
  render();
  $(document).trigger("uie:updateVitals");
}

function updateDeleteUi() {
  if (deleteMode) {
    $("#life-btn-delete").show();
    $("#life-btn-cancel-delete").show();
  } else {
    $("#life-btn-delete").hide();
    $("#life-btn-cancel-delete").hide();
  }
}

function toggleDeleteMode(on) {
  deleteMode = !!on;
  if (!deleteMode) selected = new Set();
  updateDeleteUi();
  render();
}

function deleteSelected() {
  const s = getSettings();
  if (!s) return;
  ensureLife(s);
  const idxs = Array.from(selected).sort((a, b) => b - a);
  for (const idx of idxs) {
    if (idx >= 0 && idx < s.life.trackers.length) s.life.trackers.splice(idx, 1);
  }
  saveSafe(s);
  toggleDeleteMode(false);
  $(document).trigger("uie:updateVitals");
}

/* avoid rare save failures */
function RAZ(){}

function saveSafe(s){
  try { saveSettings(s); } catch(e){ console.error("[UIE] saveSettings failed:", e); }
}
function saveSettingsSafe(s){ saveSafe(s); }
function saveSettingsSafes(s){ saveSafe(s); }
function saveSettingssafes(s){ saveSafe(s); }
function saveSettingssafe(s){ saveSafe(s); }

export function init() {
  portalModalsToBody();
  render();
  updateDeleteUi();

  $(document)
    .off("click.uieLifeAdd", "#life-btn-add")
    .on("click.uieLifeAdd", "#life-btn-add", (e) => {
      e.preventDefault(); e.stopPropagation();
      openCreate();
    });

  $(document)
    .off("click.uieLifeTrash", "#life-btn-trash")
    .on("click.uieLifeTrash", "#life-btn-trash", (e) => {
      e.preventDefault(); e.stopPropagation();
      toggleDeleteMode(!deleteMode);
    });

  $(document)
    .off("click.uieLifeDelCancel", "#life-btn-cancel-delete")
    .on("click.uieLifeDelCancel", "#life-btn-cancel-delete", (e) => {
      e.preventDefault(); e.stopPropagation();
      toggleDeleteMode(false);
    });

  $(document)
    .off("click.uieLifeDelGo", "#life-btn-delete")
    .on("click.uieLifeDelGo", "#life-btn-delete", (e) => {
      e.preventDefault(); e.stopPropagation();
      deleteSelected();
    });

  $(document)
    .off("click.uieLifeTpl", "#life-btn-template")
    .on("click.uieLifeTpl", "#life-btn-template", (e) => {
      e.preventDefault(); e.stopPropagation();
      openTemplate();
    });

  // Create modal controls
  $(document)
    .off("click.uieLifeCreateClose", "#life-create-close, #life-create-cancel")
    .on("click.uieLifeCreateClose", "#life-create-close, #life-create-cancel", (e) => {
      e.preventDefault(); e.stopPropagation();
      closeCreate();
    });

  $(document)
    .off("click.uieLifeCreateSave", "#life-create-save")
    .on("click.uieLifeCreateSave", "#life-create-save", (e) => {
      e.preventDefault(); e.stopPropagation();
      createTrackerFromModal();
    });

  // Template modal controls
  $(document)
    .off("click.uieLifeTplClose", "#life-template-close")
    .on("click.uieLifeTplClose", "#life-template-close", (e) => {
      e.preventDefault(); e.stopPropagation();
      closeTemplate();
    });

  $(document)
    .off("click.uieLifeTplReset", "#life-template-reset")
    .on("click.uieLifeTplReset", "#life-template-reset", (e) => {
      e.preventDefault(); e.stopPropagation();
      $("#life-template-text").val(DEFAULT_TEMPLATE);
    });

  $(document)
    .off("click.uieLifeTplSave", "#life-template-save")
    .on("click.uieLifeTplSave", "#life-template-save", (e) => {
      e.preventDefault(); e.stopPropagation();
      const s = getSettings();
      if (!s) return;
      ensureLife(s);
      s.life.ai.template = String($("#life-template-text").val() || DEFAULT_TEMPLATE);
      s.life.ai.enabled = true;
      saveSafe(s);
      closeTemplate();
    });

  // Card +/-
  $(document)
    .off("click.uieLifeCard", "#life-list .life-card .life-mini")
    .on("click.uieLifeCard", "#life-list .life-card .life-mini", function (e) {
      e.preventDefault(); e.stopPropagation();
      const idx = Number($(this).closest(".life-card").data("idx"));
      const act = String($(this).data("act") || "");
      if (act === "minus") bump(idx, -1);
      if (act === "plus") bump(idx, +1);
    });

  $(document)
    .off("click.uieLifePick", "#life-list .life-card.selecting")
    .on("click.uieLifePick", "#life-list .life-card.selecting", function (e) {
      e.preventDefault(); e.stopPropagation();
      const idx = Number($(this).data("idx"));
      if (Number.isNaN(idx)) return;
      if (selected.has(idx)) selected.delete(idx);
      else selected.add(idx);
      render();
    });
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;")
    .replace(/'/g,"&#39;");
}
