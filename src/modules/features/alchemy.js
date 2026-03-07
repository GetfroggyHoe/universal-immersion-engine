import { getSettings, saveSettings } from "../core.js";
import { inferItemType } from "../slot_types_infer.js";
import { injectRpEvent } from "./rp_log.js";
import { addInventoryItemWithStack } from "../inventoryItems.js";

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
    // ideally use a template for empty state too, or toggle a hidden element
    $wrap.append($("<div>").css({opacity:0.7, fontWeight:900}).text("No reagents."));
    return;
  }
  
  const template = document.getElementById("uie-alchemy-row-template");
  
  for (const it of list.slice(0, 220)) {
    const clone = template.content.cloneNode(true);
    const $row = $(clone).find(".uie-alchemy-row");
    
    const id = String(it.id);
    const active = selectedIds.has(id);
    
    $row.attr("data-id", id);
    if (active) $row.addClass("active");
    
    const $icon = $row.find(".icon");
    if (it.img) {
      $("<img>").attr("src", it.img).appendTo($icon);
    } else {
      $("<i>").addClass("fa-solid fa-flask").css("opacity", "0.85").appendTo($icon);
    }
    
    $row.find(".name").text(it.name || "Reagent");
    $row.find(".sub").text(`${it.type || "alchemy"} • x${it.qty || 1}`);
    $row.find(".uie-alchemy-pill").text(active ? "Selected" : "Pick");
    
    $wrap.append($row);
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
    $sel.append($("<div>").css({opacity:0.7, fontWeight:900}).text("None"));
    return;
  }
  
  const template = document.getElementById("uie-alchemy-pill-template");
  
  picked.slice(0, 16).forEach(it => {
    const clone = template.content.cloneNode(true);
    $(clone).find(".uie-alchemy-pill").text(it.name || "Reagent");
    $sel.append(clone);
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
  addInventoryItemWithStack(s.inventory.items, out, { source: "alchemy" });
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

