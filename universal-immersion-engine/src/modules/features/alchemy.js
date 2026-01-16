import { getSettings, saveSettings } from "../core.js";
import { inferItemType } from "../slot_types_infer.js";
import { injectRpEvent } from "./rp_log.js";

let selectedIds = new Set();

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function ensureIds(s) {
  if (!s.inventory) s.inventory = { items: [] };
  if (!Array.isArray(s.inventory.items)) s.inventory.items = [];
  for (const it of s.inventory.items) {
    if (!it || typeof it !== "object") continue;
    if (!it.id) it.id = `uie_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    if (!it.slotCategory) {
      const inf = inferItemType(it);
      it.slotCategory = String(inf?.category || "UNCATEGORIZED");
    }
  }
}

function addLog(line) {
  const s = getSettings();
  if (!s) return;
  if (!s.alchemy) s.alchemy = { log: [] };
  if (!Array.isArray(s.alchemy.log)) s.alchemy.log = [];
  s.alchemy.log.push(String(line || "").slice(0, 220));
  s.alchemy.log = s.alchemy.log.slice(-80);
  saveSettings();
  render();
}

function filteredReagents(q) {
  const s = getSettings();
  ensureIds(s);
  const query = String(q || "").toLowerCase().trim();
  return (s.inventory.items || []).filter(it => {
    const cat = String(it?.slotCategory || "").toUpperCase();
    if (cat !== "ALCHEMY") return false;
    if (!query) return true;
    return `${String(it?.name || "")} ${String(it?.description || it?.desc || "")}`.toLowerCase().includes(query);
  });
}

function renderReagents() {
  const q = String($("#uie-alchemy-search").val() || "");
  const list = filteredReagents(q);
  const $wrap = $("#uie-alchemy-reagents");
  if (!$wrap.length) return;
  $wrap.empty();
  if (!list.length) {
    $wrap.html(`<div style="opacity:0.7; font-weight:900;">No reagents.</div>`);
    return;
  }
  for (const it of list.slice(0, 220)) {
    const id = String(it.id);
    const active = selectedIds.has(id);
    const img = it.img ? `<img src="${esc(it.img)}" alt="">` : `<i class="fa-solid fa-flask" style="opacity:0.85;"></i>`;
    const qty = Number(it.qty || 1);
    $wrap.append(`
      <div class="uie-alchemy-row ${active ? "active" : ""}" data-id="${esc(id)}">
        <div class="icon">${img}</div>
        <div class="mid">
          <div class="name">${esc(it.name || "Reagent")}</div>
          <div class="sub">${esc(it.type || "alchemy")} • x${esc(qty)}</div>
        </div>
        <div class="uie-alchemy-pill">${active ? "Selected" : "Pick"}</div>
      </div>
    `);
  }
}

function renderSelected() {
  const s = getSettings();
  ensureIds(s);
  const $sel = $("#uie-alchemy-selected");
  if (!$sel.length) return;
  $sel.empty();
  const picked = (s.inventory.items || []).filter(it => selectedIds.has(String(it?.id || "")));
  if (!picked.length) {
    $sel.html(`<div style="opacity:0.7; font-weight:900;">None</div>`);
    return;
  }
  picked.slice(0, 16).forEach(it => {
    $sel.append(`<span class="uie-alchemy-pill">${esc(it.name || "Reagent")}</span>`);
  });
}

function renderLog() {
  const s = getSettings();
  const lines = Array.isArray(s?.alchemy?.log) ? s.alchemy.log : [];
  $("#uie-alchemy-log").text(lines.join("\n"));
}

export function render() {
  renderReagents();
  renderSelected();
  renderLog();
}

function resetAlchemy() {
  selectedIds = new Set();
  $("#uie-alchemy-out-name").val("");
  $("#uie-alchemy-out-fx").val("");
  $("#uie-alchemy-out-desc").val("");
  $("#uie-alchemy-use-hint").val("");
  addLog("Reset.");
  render();
}

function takeOne(s, itemId) {
  const items = s.inventory.items || [];
  const idx = items.findIndex(x => String(x?.id || "") === itemId);
  if (idx < 0) return null;
  const it = items[idx];
  const q = Number(it.qty || 1);
  if (Number.isFinite(q) && q > 1) {
    it.qty = q - 1;
    return { ...it, qty: 1 };
  }
  items.splice(idx, 1);
  return { ...it, qty: 1 };
}

async function brew() {
  const s = getSettings();
  ensureIds(s);
  const name = String($("#uie-alchemy-out-name").val() || "").trim() || "Brewed Potion";
  const hint = String($("#uie-alchemy-use-hint").val() || "").trim();
  const fx = String($("#uie-alchemy-out-fx").val() || "").split(",").map(x => x.trim()).filter(Boolean).slice(0, 10);
  const desc = String($("#uie-alchemy-out-desc").val() || "").trim();

  const picked = Array.from(selectedIds);
  if (!picked.length) { addLog("Pick at least one reagent."); return; }

  const used = [];
  for (const id of picked.slice(0, 6)) {
    const one = takeOne(s, id);
    if (one) used.push(one);
  }
  if (!used.length) { addLog("No usable reagents found."); saveSettings(); return; }

  const out = {
    kind: "item",
    name,
    type: "consumable",
    rarity: "common",
    qty: 1,
    description: desc || `Brewed from: ${used.map(x => x.name).join(", ")}.`,
    mods: {},
    statusEffects: fx,
    use: { hint: hint || "Drink to apply effects.", consumes: true, apCost: 0, mpCost: 0 },
    slotCategory: "ALCHEMY"
  };
  out.id = `uie_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  s.inventory.items.push(out);
  saveSettings();

  selectedIds = new Set();
  addLog(`Brewed: ${name} using ${used.map(x => x.name).join(", ")}`);
  await injectRpEvent(`Brewed ${name} using ${used.map(x => x.name).join(", ")}.`, { uie: { type: "alchemy", item: name } });
}

export function init() {
  $(document)
    .off("input.uieAlchemySearch", "#uie-alchemy-search")
    .on("input.uieAlchemySearch", "#uie-alchemy-search", function() { renderReagents(); });

  $(document)
    .off("click.uieAlchemyPick", "#uie-alchemy-reagents .uie-alchemy-row")
    .on("click.uieAlchemyPick", "#uie-alchemy-reagents .uie-alchemy-row", function(e) {
      e.preventDefault();
      e.stopPropagation();
      const id = String($(this).data("id") || "");
      if (!id) return;
      if (selectedIds.has(id)) selectedIds.delete(id);
      else selectedIds.add(id);
      renderReagents();
      renderSelected();
    });

  $(document)
    .off("click.uieAlchemyReset", "#uie-alchemy-reset")
    .on("click.uieAlchemyReset", "#uie-alchemy-reset", function(e) { e.preventDefault(); e.stopPropagation(); resetAlchemy(); });

  $(document)
    .off("click.uieAlchemyBrew", "#uie-alchemy-brew")
    .on("click.uieAlchemyBrew", "#uie-alchemy-brew", async function(e) {
      e.preventDefault(); e.stopPropagation();
      const btn = $(this);
      btn.prop("disabled", true).text("Brewing...");
      try { await brew(); } finally { btn.prop("disabled", false).text("Brew"); }
    });

  render();
}

