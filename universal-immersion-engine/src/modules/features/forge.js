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

function parseMods(raw) {
  const out = {};
  const s = String(raw || "");
  const parts = s.split(",").map(x => x.trim()).filter(Boolean);
  for (const p of parts) {
    const m = p.split(":").map(x => x.trim());
    if (m.length !== 2) continue;
    const k = String(m[0]).toLowerCase();
    const v = Number(m[1]);
    if (!k) continue;
    if (!Number.isFinite(v)) continue;
    out[k] = v;
  }
  return out;
}

function addLog(line) {
  const s = getSettings();
  if (!s) return;
  if (!s.forge) s.forge = { log: [] };
  if (!Array.isArray(s.forge.log)) s.forge.log = [];
  s.forge.log.push(String(line || "").slice(0, 220));
  s.forge.log = s.forge.log.slice(-80);
  saveSettings();
  render();
}

function setForgeBackground() {
  const isMobile = window.matchMedia && window.matchMedia("(max-width: 700px), (pointer: coarse)").matches;
  const bg = isMobile ? "https://user.uploads.dev/file/37b729db6c04c7591ca5bff1f010b999.jpg" : "https://user.uploads.dev/file/2e5d529ea57a81eecaa77913204d51e4.jpg";
  $("#uie-forge-bg").css("background-image", `url('${bg}')`);
}

function filteredMaterials(q) {
  const s = getSettings();
  ensureIds(s);
  const query = String(q || "").toLowerCase().trim();
  return (s.inventory.items || []).filter(it => {
    const cat = String(it?.slotCategory || "").toUpperCase();
    if (cat !== "CRAFTING") return false;
    if (!query) return true;
    return `${String(it?.name || "")} ${String(it?.description || it?.desc || "")}`.toLowerCase().includes(query);
  });
}

function renderMaterials() {
  const q = String($("#uie-forge-search").val() || "");
  const list = filteredMaterials(q);
  const $wrap = $("#uie-forge-materials");
  if (!$wrap.length) return;
  $wrap.empty();
  if (!list.length) {
    $wrap.html(`<div style="opacity:0.7; font-weight:900;">No crafting materials.</div>`);
    return;
  }
  for (const it of list.slice(0, 200)) {
    const id = String(it.id);
    const active = selectedIds.has(id);
    const img = it.img ? `<img src="${esc(it.img)}" alt="">` : `<i class="fa-solid fa-hammer" style="opacity:0.85;"></i>`;
    const qty = Number(it.qty || 1);
    $wrap.append(`
      <div class="uie-forge-row ${active ? "active" : ""}" data-id="${esc(id)}">
        <div class="icon">${img}</div>
        <div class="mid">
          <div class="name">${esc(it.name || "Material")}</div>
          <div class="sub">${esc(it.type || "crafting")} • x${esc(qty)}</div>
        </div>
        <div class="uie-forge-pill">${active ? "Selected" : "Pick"}</div>
      </div>
    `);
  }
}

function renderSelected() {
  const s = getSettings();
  ensureIds(s);
  const $sel = $("#uie-forge-selected");
  if (!$sel.length) return;
  $sel.empty();
  const picked = (s.inventory.items || []).filter(it => selectedIds.has(String(it?.id || "")));
  if (!picked.length) {
    $sel.html(`<div style="opacity:0.7; font-weight:900;">None</div>`);
    return;
  }
  picked.slice(0, 16).forEach(it => {
    $sel.append(`<span class="uie-forge-pill">${esc(it.name || "Material")}</span>`);
  });
}

function renderLog() {
  const s = getSettings();
  const lines = Array.isArray(s?.forge?.log) ? s.forge.log : [];
  $("#uie-forge-log").text(lines.join("\n"));
}

export function render() {
  setForgeBackground();
  renderMaterials();
  renderSelected();
  renderLog();
}

function resetForge() {
  selectedIds = new Set();
  $("#uie-forge-out-name").val("");
  $("#uie-forge-out-slot").val("main");
  $("#uie-forge-out-rarity").val("common");
  $("#uie-forge-out-mods").val("");
  $("#uie-forge-out-fx").val("");
  $("#uie-forge-out-desc").val("");
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

async function craft() {
  const s = getSettings();
  ensureIds(s);
  const name = String($("#uie-forge-out-name").val() || "").trim() || "Forged Item";
  const slotId = String($("#uie-forge-out-slot").val() || "main");
  const rarity = String($("#uie-forge-out-rarity").val() || "common");
  const mods = parseMods($("#uie-forge-out-mods").val());
  const fx = String($("#uie-forge-out-fx").val() || "").split(",").map(x => x.trim()).filter(Boolean).slice(0, 10);
  const desc = String($("#uie-forge-out-desc").val() || "").trim();

  const picked = Array.from(selectedIds);
  if (!picked.length) { addLog("Pick at least one material."); return; }

  const used = [];
  for (const id of picked.slice(0, 6)) {
    const one = takeOne(s, id);
    if (one) used.push(one);
  }
  if (!used.length) { addLog("No usable materials found."); saveSettings(); return; }

  const out = {
    kind: "item",
    name,
    type: "weapon",
    rarity,
    qty: 1,
    description: desc || `Forged at the anvil using: ${used.map(x => x.name).join(", ")}.`,
    mods,
    statusEffects: fx,
    slotCategory: "EQUIPMENT_CLASS",
    equipSlot: slotId
  };
  out.id = `uie_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  s.inventory.items.push(out);
  saveSettings();

  selectedIds = new Set();
  addLog(`Forged: ${name} (slot ${slotId}) using ${used.map(x => x.name).join(", ")}`);
  await injectRpEvent(`Forged ${name} using ${used.map(x => x.name).join(", ")}.`, { uie: { type: "forge", item: name } });
}

export function init() {
  $(document)
    .off("input.uieForgeSearch", "#uie-forge-search")
    .on("input.uieForgeSearch", "#uie-forge-search", function() { renderMaterials(); });

  $(document)
    .off("click.uieForgePick", "#uie-forge-materials .uie-forge-row")
    .on("click.uieForgePick", "#uie-forge-materials .uie-forge-row", function(e) {
      e.preventDefault();
      e.stopPropagation();
      const id = String($(this).data("id") || "");
      if (!id) return;
      if (selectedIds.has(id)) selectedIds.delete(id);
      else selectedIds.add(id);
      renderMaterials();
      renderSelected();
    });

  $(document)
    .off("click.uieForgeReset", "#uie-forge-reset")
    .on("click.uieForgeReset", "#uie-forge-reset", function(e) { e.preventDefault(); e.stopPropagation(); resetForge(); });

  $(document)
    .off("click.uieForgeCraft", "#uie-forge-craft")
    .on("click.uieForgeCraft", "#uie-forge-craft", async function(e) {
      e.preventDefault(); e.stopPropagation();
      const btn = $(this);
      btn.prop("disabled", true).text("Forging...");
      try { await craft(); } finally { btn.prop("disabled", false).text("Forge"); }
    });

  render();
}

