import { getSettings, saveSettings } from "../core.js";
import { inferItemType } from "../slot_types_infer.js";
import { injectRpEvent } from "./rp_log.js";

let baseRef = null;
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
  if (!Array.isArray(s.inventory.equipped)) s.inventory.equipped = [];
  const touch = (it) => {
    if (!it || typeof it !== "object") return;
    if (!it.id) it.id = `uie_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    if (!it.slotCategory) {
      const inf = inferItemType(it);
      it.slotCategory = String(inf?.category || "UNCATEGORIZED");
    }
  };
  s.inventory.items.forEach(touch);
  s.inventory.equipped.forEach(touch);
}

function isEquipment(it) {
  const cat = String(it?.slotCategory || "").toUpperCase();
  if (cat === "EQUIPMENT_CLASS") return true;
  const type = String(it?.type || "").toLowerCase();
  return ["weapon", "armor", "shield", "ring", "amulet", "cloak", "robe", "helmet", "boots", "gloves"].some(k => type.includes(k));
}

function addLog(line) {
  const s = getSettings();
  if (!s) return;
  if (!s.enchant) s.enchant = { log: [] };
  if (!Array.isArray(s.enchant.log)) s.enchant.log = [];
  s.enchant.log.push(String(line || "").slice(0, 220));
  s.enchant.log = s.enchant.log.slice(-80);
  saveSettings();
  render();
}

function listBases(s) {
  ensureIds(s);
  const items = (s.inventory.items || []).filter(isEquipment).map(it => ({ ref: { src: "items", id: String(it.id) }, it }));
  const eq = (s.inventory.equipped || []).filter(isEquipment).map(it => ({ ref: { src: "equipped", id: String(it.id), slotId: String(it.slotId || "") }, it }));
  return [...eq, ...items];
}

function listComponents(s, q) {
  ensureIds(s);
  const query = String(q || "").toLowerCase().trim();
  return (s.inventory.items || []).filter(it => {
    const cat = String(it?.slotCategory || "").toUpperCase();
    if (cat !== "ENCHANTMENT") return false;
    if (!query) return true;
    return `${String(it?.name || "")} ${String(it?.description || it?.desc || "")}`.toLowerCase().includes(query);
  });
}

function renderBases() {
  const s = getSettings();
  ensureIds(s);
  const list = listBases(s);
  const $wrap = $("#uie-enchant-base");
  if (!$wrap.length) return;
  $wrap.empty();
  if (!list.length) {
    $wrap.append($("<div>").css({opacity:0.7, fontWeight:900}).text("No equipment found."));
    return;
  }
  
  const template = document.getElementById("uie-enchant-row-template");
  
  list.slice(0, 120).forEach(({ ref, it }) => {
    const clone = template.content.cloneNode(true);
    const $row = $(clone).find(".uie-enchant-row");
    
    const key = `${ref.src}:${ref.id}`;
    const active = baseRef && `${baseRef.src}:${baseRef.id}` === key;
    
    $row.attr("data-src", ref.src);
    $row.attr("data-id", ref.id);
    $row.attr("data-slot", ref.slotId || "");
    if (active) $row.addClass("active");
    
    const $icon = $row.find(".icon");
    if (it.img) {
      $("<img>").attr("src", it.img).appendTo($icon);
    } else {
      $("<i>").addClass("fa-solid fa-shield-halved").css("opacity", "0.85").appendTo($icon);
    }
    
    $row.find(".name").text(it.name || "Item");
    $row.find(".sub").text(ref.src === "equipped" ? `equipped ${ref.slotId}` : "inventory");
    $row.find(".uie-enchant-pill").text(active ? "Base" : "Pick");
    
    $wrap.append($row);
  });
}

function renderComponents() {
  const s = getSettings();
  ensureIds(s);
  const q = String($("#uie-enchant-search").val() || "");
  const list = listComponents(s, q);
  const $wrap = $("#uie-enchant-components");
  if (!$wrap.length) return;
  $wrap.empty();
  if (!list.length) {
    $wrap.append($("<div>").css({opacity:0.7, fontWeight:900}).text("No enchantment components."));
    return;
  }
  
  const template = document.getElementById("uie-enchant-row-template");
  
  list.slice(0, 200).forEach(it => {
    const clone = template.content.cloneNode(true);
    const $row = $(clone).find(".uie-enchant-row");
    
    const id = String(it.id);
    const active = selectedIds.has(id);
    
    $row.attr("data-id", id);
    if (active) $row.addClass("active");
    
    const $icon = $row.find(".icon");
    if (it.img) {
      $("<img>").attr("src", it.img).appendTo($icon);
    } else {
      $("<i>").addClass("fa-solid fa-gem").css("opacity", "0.85").appendTo($icon);
    }
    
    $row.find(".name").text(it.name || "Component");
    $row.find(".sub").text(`${it.type || "enchant"} • x${it.qty || 1}`);
    $row.find(".uie-enchant-pill").text(active ? "Selected" : "Pick");
    
    $wrap.append($row);
  });
}

function renderSelected() {
  const s = getSettings();
  ensureIds(s);
  const $sel = $("#uie-enchant-selected");
  if (!$sel.length) return;
  $sel.empty();
  const picked = (s.inventory.items || []).filter(it => selectedIds.has(String(it?.id || "")));
  
  const template = document.getElementById("uie-enchant-pill-template");
  
  // Base item pill
  const baseClone = template.content.cloneNode(true);
  $(baseClone).find(".uie-enchant-pill").text(baseRef ? `Base: ${baseRef.src}` : "Base: none");
  $sel.append(baseClone);
  
  // Component pills
  picked.slice(0, 10).forEach(it => {
    const clone = template.content.cloneNode(true);
    $(clone).find(".uie-enchant-pill").text(it.name || "Component");
    $sel.append(clone);
  });
}

function renderLog() {
  const s = getSettings();
  const lines = Array.isArray(s?.enchant?.log) ? s.enchant.log : [];
  $("#uie-enchant-log").text(lines.join("\n"));
}

export function render() {
  renderBases();
  renderComponents();
  renderSelected();
  renderLog();
}

function resetEnchant() {
  baseRef = null;
  selectedIds = new Set();
  $("#uie-enchant-name").val("");
  $("#uie-enchant-fx").val("");
  $("#uie-enchant-desc").val("");
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

function findByRef(s, ref) {
  if (!ref) return null;
  ensureIds(s);
  if (ref.src === "equipped") {
    const idx = (s.inventory.equipped || []).findIndex(x => String(x?.id || "") === ref.id);
    if (idx < 0) return null;
    return { list: s.inventory.equipped, idx };
  }
  const idx = (s.inventory.items || []).findIndex(x => String(x?.id || "") === ref.id);
  if (idx < 0) return null;
  return { list: s.inventory.items, idx };
}

async function applyEnchant() {
  const s = getSettings();
  ensureIds(s);
  if (!baseRef) { addLog("Pick a base item."); return; }
  const picked = Array.from(selectedIds);
  if (!picked.length) { addLog("Pick at least one component."); return; }
  const name = String($("#uie-enchant-name").val() || "").trim() || "Enchantment";
  const fx = String($("#uie-enchant-fx").val() || "").split(",").map(x => x.trim()).filter(Boolean).slice(0, 10);
  const desc = String($("#uie-enchant-desc").val() || "").trim();

  const target = findByRef(s, baseRef);
  if (!target) { addLog("Base item not found."); return; }
  const base = target.list[target.idx];
  if (!base) return;

  const used = [];
  for (const id of picked.slice(0, 4)) {
    const one = takeOne(s, id);
    if (one) used.push(one);
  }
  if (!used.length) { addLog("No usable components found."); saveSettings(); return; }

  if (!Array.isArray(base.statusEffects)) base.statusEffects = [];
  for (const x of fx) if (x && !base.statusEffects.includes(x)) base.statusEffects.push(x);
  if (desc) base.description = desc;
  base.enchant = { name, components: used.map(u => u.name) };
  saveSettings();

  selectedIds = new Set();
  addLog(`Applied ${name} to ${base.name} using ${used.map(x => x.name).join(", ")}`);
  try { const mod = await import("./equipment_rpg.js"); if (mod?.render) mod.render(); } catch (_) {}
  await injectRpEvent(`Enchanted ${base.name} with ${name}.`, { uie: { type: "enchant", item: base.name } });
}

export function init() {
  $(document)
    .off("input.uieEnchantSearch", "#uie-enchant-search")
    .on("input.uieEnchantSearch", "#uie-enchant-search", function() { renderComponents(); });

  $(document)
    .off("click.uieEnchantPickBase", "#uie-enchant-base .uie-enchant-row")
    .on("click.uieEnchantPickBase", "#uie-enchant-base .uie-enchant-row", function(e) {
      e.preventDefault(); e.stopPropagation();
      baseRef = { src: String($(this).data("src") || ""), id: String($(this).data("id") || ""), slotId: String($(this).data("slot") || "") };
      renderBases();
      renderSelected();
    });

  $(document)
    .off("click.uieEnchantPickComp", "#uie-enchant-components .uie-enchant-row")
    .on("click.uieEnchantPickComp", "#uie-enchant-components .uie-enchant-row", function(e) {
      e.preventDefault(); e.stopPropagation();
      const id = String($(this).data("id") || "");
      if (!id) return;
      if (selectedIds.has(id)) selectedIds.delete(id);
      else selectedIds.add(id);
      renderComponents();
      renderSelected();
    });

  $(document)
    .off("click.uieEnchantReset", "#uie-enchant-reset")
    .on("click.uieEnchantReset", "#uie-enchant-reset", function(e) { e.preventDefault(); e.stopPropagation(); resetEnchant(); });

  $(document)
    .off("click.uieEnchantApply", "#uie-enchant-apply")
    .on("click.uieEnchantApply", "#uie-enchant-apply", async function(e) {
      e.preventDefault(); e.stopPropagation();
      const btn = $(this);
      btn.prop("disabled", true).text("Applying...");
      try { await applyEnchant(); } finally { btn.prop("disabled", false).text("Apply"); }
    });

  render();
}

