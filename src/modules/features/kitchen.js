import { getSettings, saveSettings } from "../core.js";
import { inferItemType } from "../slot_types_infer.js";
import { injectRpEvent } from "./rp_log.js";

let mounted = false;
let openCtx = { onExit: null };
let tickInterval = null;
let pickCtx = null;
let saveTimer = null;

const STATES = ["idle", "prepping", "cooking", "paused", "done", "burned", "canceled"];

const RECIPES = [
  { id: "stew", name: "Hearty Stew", stationIds: ["stove", "campfire"], durationMs: 90000, burnGraceMs: 25000, tags: ["stew"], requires: [{ tag: "meat" }, { tag: "vegetable" }, { tag: "herb" }], stirNeededEveryMs: 15000 },
  { id: "flatbread", name: "Flatbread", stationIds: ["oven", "campfire"], durationMs: 70000, burnGraceMs: 20000, tags: ["baking"], requires: [{ tag: "grain" }, { tag: "dairy" }], stirNeededEveryMs: 0 },
  { id: "fried_fish", name: "Fried Fish", stationIds: ["stove", "campfire"], durationMs: 60000, burnGraceMs: 15000, tags: ["fry"], requires: [{ tag: "fish" }, { tag: "oil" }], stirNeededEveryMs: 0 },
  { id: "tea", name: "Herbal Tea", stationIds: ["stove", "campfire"], durationMs: 50000, burnGraceMs: 30000, tags: ["drink"], requires: [{ tag: "herb" }, { tag: "water" }], stirNeededEveryMs: 0 },
  { id: "manual", name: "Manual Cook", stationIds: ["stove", "oven", "campfire"], durationMs: 60000, burnGraceMs: 20000, tags: ["manual"], requires: [{ tag: "any" }], stirNeededEveryMs: 0 }
];

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function msToClock(ms) {
  ms = Math.max(0, Number(ms || 0));
  const sec = Math.ceil(ms / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function clamp01(n) {
  n = Number(n);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
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

function ensureKitchen(s) {
  if (!s.kitchen || typeof s.kitchen !== "object") s.kitchen = {};
  if (!Array.isArray(s.kitchen.log)) s.kitchen.log = [];
  if (!s.kitchenStyle) s.kitchenStyle = "modern";
  if (!s.kitchen.session || typeof s.kitchen.session !== "object") s.kitchen.session = {};
  const ses = s.kitchen.session;
  if (!STATES.includes(String(ses.state || ""))) ses.state = "idle";
  if (!ses.stationId) ses.stationId = "stove";
  if (!ses.heatLevel) ses.heatLevel = "med";
  if (!Array.isArray(ses.requires)) ses.requires = [];
  if (!Array.isArray(ses.slots)) ses.slots = [];
  if (!Array.isArray(ses.reserved)) ses.reserved = [];
  if (!Array.isArray(ses.events)) ses.events = [];
  if (typeof ses.pausedTotalMs !== "number") ses.pausedTotalMs = 0;
  if (typeof ses.mistakes !== "number") ses.mistakes = 0;
  return ses;
}

function addKitchenLog(s, line) {
  ensureKitchen(s);
  s.kitchen.log.push(String(line || "").slice(0, 240));
  s.kitchen.log = s.kitchen.log.slice(-120);
  saveKitchenDebounced();
  renderKitchen();
}

function addSessionEvent(s, line) {
  ensureKitchen(s);
  const ses = s.kitchen.session;
  ses.events.push({ ts: Date.now(), text: String(line || "").slice(0, 240) });
  ses.events = ses.events.slice(-80);
  addKitchenLog(s, line);
}

function saveKitchenDebounced() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveSettings();
  }, 350);
}

function setKitchenBackground() {
  const s = getSettings();
  if (!s) return;
  ensureKitchen(s);
  const style = String(s.kitchenStyle || "modern").toLowerCase() === "medieval" ? "medieval" : "modern";
  $("#uie-kitchen-overlay").attr("data-style", style);
}

function transitionAllowed(from, to) {
  const f = String(from);
  const t = String(to);
  if (f === t) return true;
  if (f === "idle" && t === "prepping") return true;
  if (f === "prepping" && t === "cooking") return true;
  if (f === "cooking" && t === "paused") return true;
  if (f === "paused" && t === "cooking") return true;
  if (f === "cooking" && (t === "done" || t === "burned")) return true;
  if (f === "done" && t === "idle") return true;
  if ((f === "cooking" || f === "paused") && t === "canceled") return true;
  return false;
}

async function setState(next, reason) {
  const s = getSettings();
  if (!s) return false;
  ensureIds(s);
  const ses = ensureKitchen(s);
  const from = String(ses.state);
  const to = String(next);
  if (!transitionAllowed(from, to)) return false;
  ses.state = to;
  if (reason) addSessionEvent(s, reason);
  saveKitchenDebounced();
  renderKitchen();
  return true;
}

function findRecipe(id) {
  return RECIPES.find(r => r.id === String(id)) || null;
}

function computeElapsed(ses, now) {
  const startAt = Number(ses.startAt || 0);
  if (!startAt) return 0;
  const pausedTotal = Number(ses.pausedTotalMs || 0);
  const elapsed = (now - startAt) - pausedTotal;
  return Math.max(0, elapsed);
}

function computeProgress(ses, now) {
  const dur = Number(ses.durationMs || 0);
  const elapsed = computeElapsed(ses, now);
  const pct = dur > 0 ? clamp01(elapsed / dur) : 0;
  const rem = dur > 0 ? Math.max(0, dur - elapsed) : 0;
  return { elapsed, pct, rem };
}

function tagForItem(it) {
  const text = `${String(it?.name || "")} ${String(it?.description || it?.desc || "")}`.toLowerCase();
  if (/(fish|salmon|trout)/.test(text)) return "fish";
  if (/(meat|beef|pork|chicken|venison)/.test(text)) return "meat";
  if (/(herb|mint|basil|thyme|sage|leaf)/.test(text)) return "herb";
  if (/(water|spring)/.test(text)) return "water";
  if (/(milk|butter|cheese|egg)/.test(text)) return "dairy";
  if (/(grain|flour|bread|dough|wheat)/.test(text)) return "grain";
  if (/(oil|fat|lard)/.test(text)) return "oil";
  if (/(vegetable|carrot|potato|onion|mushroom)/.test(text)) return "vegetable";
  return "any";
}

function inventoryMatchesTag(it, tag) {
  if (!it) return false;
  const t = String(tag || "any");
  if (t === "any") return true;
  const cat = String(it?.slotCategory || "").toUpperCase();
  if (cat === "COOKING") return tagForItem(it) === t || t === "any";
  return tagForItem(it) === t;
}

function listRecipeRows(query) {
  const q = String(query || "").toLowerCase().trim();
  return RECIPES.filter(r => !q || r.name.toLowerCase().includes(q) || r.id.includes(q));
}

function renderRecipes() {
  const s = getSettings();
  if (!s) return;
  const ses = ensureKitchen(s);
  const q = String($("#uie-k-recipe-search").val() || "");
  const list = listRecipeRows(q);
  const $wrap = $("#uie-k-recipes");
  if (!$wrap.length) return;
  $wrap.empty();
  list.forEach(r => {
    const active = String(ses.recipeId || "") === r.id;
    const okStation = r.stationIds.includes(String(ses.stationId || "stove"));
    $wrap.append(`<div class="uie-krow ${active ? "active" : ""}" data-recipe="${esc(r.id)}">
      <div style="display:flex; gap:10px; align-items:center;">
        <div style="font-weight:900; flex:1; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${esc(r.name)}</div>
        <div class="uie-kpill" style="opacity:${okStation ? "0.9" : "0.5"};">${esc(okStation ? "OK" : "Station")}</div>
      </div>
      <div style="margin-top:6px; opacity:0.75; font-size:12px; font-weight:800;">${esc(r.stationIds.join(" / "))} • ${esc(msToClock(r.durationMs))}</div>
    </div>`);
  });
}

function renderSlots() {
  const s = getSettings();
  if (!s) return;
  ensureIds(s);
  const ses = ensureKitchen(s);
  const r = findRecipe(ses.recipeId);
  const reqs = r ? r.requires : [];
  if (!Array.isArray(ses.slots) || ses.slots.length !== reqs.length) {
    ses.slots = reqs.map((x, i) => ({ slot: i, tag: x.tag, itemId: "", name: "", img: "" }));
  }
  const $wrap = $("#uie-k-slots");
  if (!$wrap.length) return;
  $wrap.empty();
  ses.slots.forEach(sl => {
    const filled = !!sl.itemId;
    $wrap.append(`<div class="uie-krow ${filled ? "active" : ""}" data-slot="${esc(sl.slot)}">
      <div style="display:flex; gap:10px; align-items:center;">
        <div style="font-weight:900;">${esc(filled ? sl.name : `Slot ${sl.slot + 1}`)}</div>
        <div style="margin-left:auto;" class="uie-kpill">${esc(sl.tag)}</div>
      </div>
      <div style="margin-top:6px; opacity:0.75; font-size:12px; font-weight:800;">${filled ? "Click to change" : "Click to choose from inventory"}</div>
    </div>`);
  });
  saveKitchenDebounced();
}

function renderSession() {
  const s = getSettings();
  if (!s) return;
  const ses = ensureKitchen(s);
  $("#uie-k-state").text(String(ses.state || "idle").toUpperCase());
  $("#uie-k-station").val(String(ses.stationId || "stove"));
  $("#uie-k-heat").val(String(ses.heatLevel || "med"));

  const r = findRecipe(ses.recipeId);
  $("#uie-k-active-recipe").text(r ? r.name : "No recipe selected");

  const now = Date.now();
  const prog = computeProgress(ses, now);
  $("#uie-kprogress > div").css("width", `${Math.round(prog.pct * 100)}%`);
  $("#uie-k-percent").text(`${Math.round(prog.pct * 100)}%`);

  const burnGrace = Number(ses.burnGraceMs || 0);
  const dur = Number(ses.durationMs || 0);
  const elapsed = computeElapsed(ses, now);
  const burnIn = Math.max(0, dur + burnGrace - elapsed);
  $("#uie-k-burn").text(dur ? `${msToClock(burnIn)}` : "—");

  $("#uie-k-remaining").text(dur ? msToClock(prog.rem) : "—");
  $("#uie-k-mistakes").text(`mistakes: ${Number(ses.mistakes || 0)}`);

  const quality = ses.state === "burned" ? "burned" : (Number(ses.mistakes || 0) === 0 ? "perfect" : Number(ses.mistakes || 0) <= 1 ? "ok" : "rough");
  $("#uie-k-quality").text(`quality: ${quality}`);

  const warn = [];
  if (ses.state === "cooking" || ses.state === "done") {
    if (dur && burnGrace && elapsed >= dur && elapsed < dur + burnGrace) warn.push("BURN WARNING: serve soon.");
    if (dur && burnGrace && elapsed >= dur + burnGrace) warn.push("BURNED.");
  }
  $("#uie-k-warning").text(warn.join(" "));
  $("#uie-k-outcome").text(outcomeText(s, quality));

  const log = Array.isArray(s.kitchen?.log) ? s.kitchen.log.slice(-18) : [];
  $("#uie-klog").text(log.join("\n"));

  const st = String(ses.state);
  $("#uie-k-start").prop("disabled", !(st === "prepping"));
  $("#uie-k-pause").prop("disabled", !(st === "cooking"));
  $("#uie-k-resume").prop("disabled", !(st === "paused"));
  $("#uie-k-stir").prop("disabled", !(st === "cooking" && Number(ses.stirNeededEveryMs || 0) > 0));
  $("#uie-k-cancel").prop("disabled", !((st === "cooking") || (st === "paused")));
  $("#uie-k-serve").prop("disabled", !(st === "done"));
}

function outcomeText(s, quality) {
  const ses = ensureKitchen(s);
  const r = findRecipe(ses.recipeId);
  if (!r) return "Pick a recipe, select ingredients, then Start.";
  if (ses.state === "idle") return "Select a recipe to begin.";
  if (ses.state === "prepping") return "Fill ingredient slots, set station/heat, then Start.";
  if (ses.state === "cooking") return "Cooking in progress.";
  if (ses.state === "paused") return "Paused.";
  if (ses.state === "burned") return "Burned. Cancel/Dump to clear.";
  if (ses.state === "done") return `Ready to serve (${quality}).`;
  if (ses.state === "canceled") return "Canceled.";
  return "—";
}

function renderKitchen() {
  setKitchenBackground();
  renderRecipes();
  renderSlots();
  renderSession();
}

function startTick() {
  if (tickInterval) return;
  tickInterval = setInterval(() => tick(), 250);
}

function stopTick() {
  if (!tickInterval) return;
  clearInterval(tickInterval);
  tickInterval = null;
}

async function tick() {
  const s = getSettings();
  if (!s) return;
  const ses = ensureKitchen(s);
  const st = String(ses.state);
  if (!(st === "cooking" || st === "done")) { renderSession(); return; }
  const now = Date.now();
  const dur = Number(ses.durationMs || 0);
  const burnGrace = Number(ses.burnGraceMs || 0);
  const elapsed = computeElapsed(ses, now);

  if (st === "cooking" && dur && elapsed >= dur) {
    await setState("done", `Finished cooking ${findRecipe(ses.recipeId)?.name || "recipe"}.`);
    await injectRpEvent(`Finished cooking ${findRecipe(ses.recipeId)?.name || "a recipe"}.`, { uie: { type: "kitchen_done" } });
  }

  const tooLate = dur && burnGrace && elapsed >= dur + burnGrace;
  const tooManyMistakes = Number(ses.mistakes || 0) >= 3;
  if ((st === "cooking" || st === "done") && (tooLate || tooManyMistakes)) {
    await setState("burned", tooLate ? "Burned: left past burn window." : "Burned: too many mistakes.");
    await injectRpEvent(`Burned the dish (${tooLate ? "overtime" : "mistakes"}).`, { uie: { type: "kitchen_burned" } });
  }

  if (st === "cooking" && Number(ses.stirNeededEveryMs || 0) > 0) {
    const last = Number(ses.lastStirAt || ses.startAt || now);
    const need = Number(ses.stirNeededEveryMs || 0);
    if (need && now - last > need + 2500) {
      ses.mistakes = Number(ses.mistakes || 0) + 1;
      ses.lastStirAt = now;
      addSessionEvent(s, "Missed stir window. Mistake +1.");
    }
  }

  renderSession();
}

function openPicker(slotIdx) {
  const s = getSettings();
  if (!s) return;
  ensureIds(s);
  const ses = ensureKitchen(s);
  const slot = ses.slots.find(x => Number(x.slot) === Number(slotIdx));
  if (!slot) return;
  pickCtx = { slot: Number(slotIdx), tag: String(slot.tag || "any"), query: "" };
  $("#uie-k-pick-search").val("");
  $("#uie-kitchen-picker").css("display", "flex");
  $("#uie-k-pick-title").text(`Pick Ingredient (${slot.tag})`);
  renderPicker();
}

function closePicker() {
  pickCtx = null;
  $("#uie-kitchen-picker").hide();
}

function renderPicker() {
  const s = getSettings();
  if (!s || !pickCtx) return;
  ensureIds(s);
  const ses = ensureKitchen(s);
  const tag = String(pickCtx.tag || "any");
  const q = String($("#uie-k-pick-search").val() || "").toLowerCase().trim();
  const list = (s.inventory.items || []).filter(it => {
    const okTag = inventoryMatchesTag(it, tag);
    if (!okTag) return false;
    if (!q) return true;
    return `${String(it?.name || "")} ${String(it?.description || it?.desc || "")}`.toLowerCase().includes(q);
  }).slice(0, 120);

  const $wrap = $("#uie-k-pick-list");
  if (!$wrap.length) return;
  $wrap.empty();
  if (!list.length) {
    $wrap.html(`<div style="opacity:0.7; font-weight:900; padding:10px;">No matches.</div>`);
    return;
  }
  list.forEach(it => {
    const img = it.img ? `<img src="${esc(it.img)}" alt="">` : `<i class="fa-solid fa-utensils" style="opacity:0.85;"></i>`;
    const qty = Number(it.qty || 1);
    $wrap.append(`
      <div class="pick-row" data-id="${esc(it.id)}">
        <div class="icon">${img}</div>
        <div class="mid">
          <div class="name">${esc(it.name || "Item")}</div>
          <div class="sub">${esc(tagForItem(it))} • x${esc(qty)}</div>
        </div>
        <div class="uie-kpill">Pick</div>
      </div>
    `);
  });
}

function applyHeatModifiers(ses) {
  const heat = String(ses.heatLevel || "med");
  let dur = Number(ses.durationMs || 0);
  let grace = Number(ses.burnGraceMs || 0);
  if (heat === "high") { dur = Math.round(dur * 0.9); grace = Math.round(grace * 0.6); }
  if (heat === "low") { dur = Math.round(dur * 1.15); grace = Math.round(grace * 1.2); }
  ses.durationMs = dur;
  ses.burnGraceMs = grace;
}

function takeOneById(s, itemId) {
  ensureIds(s);
  const list = s.inventory.items || [];
  const idx = list.findIndex(x => String(x?.id || "") === String(itemId));
  if (idx < 0) return null;
  const it = list[idx];
  const q = Number(it.qty || 1);
  if (Number.isFinite(q) && q > 1) {
    it.qty = q - 1;
    const unit = { ...it, qty: 1 };
    unit.id = `uie_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    return unit;
  }
  list.splice(idx, 1);
  return { ...it, qty: 1 };
}

function mergeBack(s, unit) {
  ensureIds(s);
  const list = s.inventory.items || [];
  const key = `${String(unit?.name || "")}::${String(unit?.slotCategory || "")}::${String(unit?.rarity || "")}`;
  const idx = list.findIndex(x => `${String(x?.name || "")}::${String(x?.slotCategory || "")}::${String(x?.rarity || "")}` === key);
  if (idx >= 0) {
    const q = Number(list[idx].qty || 1);
    list[idx].qty = q + 1;
    return;
  }
  list.push({ ...unit, qty: 1, id: `uie_${Date.now()}_${Math.random().toString(16).slice(2)}` });
}

async function startCooking() {
  const s = getSettings();
  if (!s) return;
  ensureIds(s);
  const ses = ensureKitchen(s);
  const r = findRecipe(ses.recipeId);
  if (!r) return;
  if (!r.stationIds.includes(String(ses.stationId || ""))) {
    ses.mistakes = Number(ses.mistakes || 0) + 1;
    addSessionEvent(s, `Wrong station for ${r.name}. Mistake +1.`);
  }
  const filled = (ses.slots || []).every(x => x.itemId);
  if (!filled) { addSessionEvent(s, "Missing ingredients."); return; }

  ses.reserved = [];
  for (const sl of ses.slots) {
    const unit = takeOneById(s, sl.itemId);
    if (unit) ses.reserved.push({ unit });
  }
  if (!ses.reserved.length) { addSessionEvent(s, "Could not reserve ingredients."); return; }

  ses.startAt = Date.now();
  ses.pausedAt = 0;
  ses.pausedTotalMs = 0;
  ses.durationMs = Number(r.durationMs);
  ses.burnGraceMs = Number(r.burnGraceMs);
  ses.stirNeededEveryMs = Number(r.stirNeededEveryMs || 0);
  ses.lastStirAt = ses.startAt;
  ses.mistakes = Number(ses.mistakes || 0);
  applyHeatModifiers(ses);

  await setState("cooking", `Started cooking ${r.name}.`);
  saveKitchenDebounced();
  await injectRpEvent(`Started cooking ${r.name}.`, { uie: { type: "kitchen_start", recipe: r.id } });
}

async function pauseCooking() {
  const s = getSettings();
  if (!s) return;
  const ses = ensureKitchen(s);
  if (ses.state !== "cooking") return;
  ses.pausedAt = Date.now();
  await setState("paused", "Paused.");
}

async function resumeCooking() {
  const s = getSettings();
  if (!s) return;
  const ses = ensureKitchen(s);
  if (ses.state !== "paused") return;
  const now = Date.now();
  const pausedAt = Number(ses.pausedAt || now);
  ses.pausedTotalMs = Number(ses.pausedTotalMs || 0) + Math.max(0, now - pausedAt);
  ses.pausedAt = 0;
  await setState("cooking", "Resumed.");
}

async function stir() {
  const s = getSettings();
  if (!s) return;
  const ses = ensureKitchen(s);
  if (ses.state !== "cooking") return;
  ses.lastStirAt = Date.now();
  addSessionEvent(s, "Stirred.");
  await injectRpEvent("Stirred the pot.", { uie: { type: "kitchen_stir" } });
}

async function cancelCooking() {
  const s = getSettings();
  if (!s) return;
  ensureIds(s);
  const ses = ensureKitchen(s);
  if (!(ses.state === "cooking" || ses.state === "paused" || ses.state === "burned")) return;
  for (const r of ses.reserved || []) {
    if (r?.unit) mergeBack(s, r.unit);
  }
  ses.reserved = [];
  await setState("canceled", "Canceled/Dumped.");
  await injectRpEvent("Canceled cooking.", { uie: { type: "kitchen_cancel" } });
  ses.recipeId = "";
  ses.slots = [];
  ses.requires = [];
  ses.startAt = 0;
  ses.durationMs = 0;
  ses.burnGraceMs = 0;
  ses.pausedAt = 0;
  ses.pausedTotalMs = 0;
  ses.stirNeededEveryMs = 0;
  ses.lastStirAt = 0;
  ses.mistakes = 0;
  await setState("idle", "Back to idle.");
}

function outputItemFor(s, quality) {
  const ses = ensureKitchen(s);
  const r = findRecipe(ses.recipeId);
  const nameBase = r ? r.name : "Meal";
  const burned = ses.state === "burned";
  const name = burned ? `Burned ${nameBase}` : `${nameBase}`;
  const fx = [];
  if (burned) fx.push("Nauseated (short)");
  else if (quality === "perfect") fx.push("Well Fed (10m)");
  else if (quality === "ok") fx.push("Well Fed (6m)");
  else fx.push("Well Fed (3m)");
  const out = {
    kind: "item",
    name,
    type: "consumable",
    rarity: burned ? "common" : "uncommon",
    qty: 1,
    description: `Cooked on ${ses.stationId}. Ingredients: ${(ses.reserved || []).map(x => x?.unit?.name).filter(Boolean).join(", ")}`,
    mods: {},
    statusEffects: fx,
    use: { hint: "Eat to apply effects.", consumes: true, apCost: 0, mpCost: 0 },
    slotCategory: "COOKING"
  };
  out.id = `uie_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  return out;
}

async function serve() {
  const s = getSettings();
  if (!s) return;
  ensureIds(s);
  const ses = ensureKitchen(s);
  if (ses.state !== "done") return;
  const quality = Number(ses.mistakes || 0) === 0 ? "perfect" : Number(ses.mistakes || 0) <= 1 ? "ok" : "rough";
  const out = outputItemFor(s, quality);
  s.inventory.items.push(out);
  ses.reserved = [];
  await injectRpEvent(`Served ${out.name}.`, { uie: { type: "kitchen_serve", item: out.name } });
  await setState("idle", `Served ${out.name}.`);
  ses.recipeId = "";
  ses.slots = [];
  ses.requires = [];
  ses.startAt = 0;
  ses.durationMs = 0;
  ses.burnGraceMs = 0;
  ses.pausedAt = 0;
  ses.pausedTotalMs = 0;
  ses.stirNeededEveryMs = 0;
  ses.lastStirAt = 0;
  ses.mistakes = 0;
  saveKitchenDebounced();
  renderKitchen();
}

function resetKitchen() {
  const s = getSettings();
  if (!s) return;
  ensureIds(s);
  const ses = ensureKitchen(s);
  ses.state = "idle";
  ses.recipeId = "";
  ses.slots = [];
  ses.requires = [];
  ses.reserved = [];
  ses.startAt = 0;
  ses.durationMs = 0;
  ses.burnGraceMs = 0;
  ses.pausedAt = 0;
  ses.pausedTotalMs = 0;
  ses.stirNeededEveryMs = 0;
  ses.lastStirAt = 0;
  ses.mistakes = 0;
  addKitchenLog(s, "Reset.");
  saveKitchenDebounced();
  renderKitchen();
}

function onPickItem(itemId) {
  const s = getSettings();
  if (!s || !pickCtx) return;
  ensureIds(s);
  const ses = ensureKitchen(s);
  const sl = ses.slots.find(x => Number(x.slot) === Number(pickCtx.slot));
  const it = (s.inventory.items || []).find(x => String(x?.id || "") === String(itemId));
  if (!sl || !it) return;
  sl.itemId = String(it.id);
  sl.name = String(it.name || "Item");
  sl.img = String(it.img || "");
  saveKitchenDebounced();
  renderSlots();
  closePicker();
}

function mountToBody() {
  const $overlay = $("#uie-kitchen-overlay");
  if (!$overlay.length) return;
  if (!$overlay.parent().is("body")) $overlay.detach().appendTo(document.body);
  mounted = true;
}

export function open(opts = {}) {
    const s = getSettings();
  const mode = String(opts?.mode || "body");
  const zIndex = Number.isFinite(Number(opts?.zIndex)) ? Number(opts.zIndex) : 2147483662;
  openCtx = { onExit: (typeof opts?.onExit === "function") ? opts.onExit : null };

  if (mode === "inline") {
    const hostEl = opts?.hostEl || null;
    const $overlay = $("#uie-kitchen-overlay");
    if ($overlay.length && hostEl && $overlay.parent().get(0) !== hostEl) $overlay.detach().appendTo(hostEl);
    mounted = true;
  } else {
    mountToBody();
  }

  if (!mounted || !$("#uie-kitchen-overlay").length) return;
  ensureIds(s);
  ensureKitchen(s);
  setKitchenBackground();
  $("#uie-kitchen-overlay").css({ position: mode === "inline" ? "absolute" : "fixed", inset: "0", zIndex, isolation: "isolate" });
  $("#uie-kitchen-overlay").show();
  startTick();
  renderKitchen();
}

function closeKitchen() {
  $("#uie-kitchen-overlay").hide();
  stopTick();
  if (openCtx?.onExit) {
    try { openCtx.onExit(); } catch (_) {}
    return;
  }
  $("#uie-feature-container").hide().empty();
  $("#uie-craft-home").show();
}

function toggleStyle() {
  const s = getSettings();
  if (!s) return;
  ensureKitchen(s);
  s.kitchenStyle = String(s.kitchenStyle || "modern").toLowerCase() === "medieval" ? "modern" : "medieval";
  saveSettings();
  setKitchenBackground();
}

function ensurePrepping() {
  const s = getSettings();
  if (!s) return;
  const ses = ensureKitchen(s);
  if (ses.state === "idle") setState("prepping", "Prepping.");
}

export function init() {
  mountToBody();
  if (!mounted) return;

  $(document)
    .off("click.uieKitchenExit", "#uie-kitchen-exit")
    .on("click.uieKitchenExit", "#uie-kitchen-exit", function(e){ e.preventDefault(); e.stopPropagation(); closeKitchen(); });

  $(document)
    .off("click.uieKitchenStyle", "#uie-kitchen-style")
    .on("click.uieKitchenStyle", "#uie-kitchen-style", function(e){ e.preventDefault(); e.stopPropagation(); toggleStyle(); });

  $(document)
    .off("click.uieKitchenReset", "#uie-kitchen-reset")
    .on("click.uieKitchenReset", "#uie-kitchen-reset", function(e){ e.preventDefault(); e.stopPropagation(); resetKitchen(); });

  $(document)
    .off("change.uieKitchenStation", "#uie-k-station")
    .on("change.uieKitchenStation", "#uie-k-station", function(){
      const s = getSettings();
      if (!s) return;
      const ses = ensureKitchen(s);
      ses.stationId = String($(this).val() || "stove");
      saveKitchenDebounced();
      ensurePrepping();
      renderKitchen();
    });

  $(document)
    .off("change.uieKitchenHeat", "#uie-k-heat")
    .on("change.uieKitchenHeat", "#uie-k-heat", function(){
      const s = getSettings();
      if (!s) return;
      const ses = ensureKitchen(s);
      ses.heatLevel = String($(this).val() || "med");
      addSessionEvent(s, `Heat set to ${ses.heatLevel}.`);
      saveKitchenDebounced();
      renderKitchen();
    });

  $(document)
    .off("input.uieKitchenRecipeSearch", "#uie-k-recipe-search")
    .on("input.uieKitchenRecipeSearch", "#uie-k-recipe-search", function(){ renderRecipes(); });

  $(document)
    .off("click.uieKitchenPickRecipe", "#uie-k-recipes .uie-krow")
    .on("click.uieKitchenPickRecipe", "#uie-k-recipes .uie-krow", async function(e){
      e.preventDefault(); e.stopPropagation();
      const id = String($(this).data("recipe") || "");
      const s = getSettings();
      if (!s) return;
      const ses = ensureKitchen(s);
      if (ses.state !== "idle" && ses.state !== "prepping") return;
      ses.recipeId = id;
      const r = findRecipe(id);
      ses.requires = r ? r.requires : [];
      ses.slots = [];
      await setState("prepping", `Selected recipe: ${r?.name || id}.`);
      saveKitchenDebounced();
      renderKitchen();
    });

  $(document)
    .off("click.uieKitchenPickSlot", "#uie-k-slots .uie-krow")
    .on("click.uieKitchenPickSlot", "#uie-k-slots .uie-krow", function(e){
      e.preventDefault(); e.stopPropagation();
      const s = getSettings();
      if (!s) return;
      const ses = ensureKitchen(s);
      if (ses.state !== "prepping") return;
      const idx = Number($(this).data("slot"));
      openPicker(idx);
    });

  $(document)
    .off("click.uieKitchenPickClose", "#uie-k-pick-close")
    .on("click.uieKitchenPickClose", "#uie-k-pick-close", function(e){ e.preventDefault(); e.stopPropagation(); closePicker(); });

  $(document)
    .off("input.uieKitchenPickSearch", "#uie-k-pick-search")
    .on("input.uieKitchenPickSearch", "#uie-k-pick-search", function(){ renderPicker(); });

  $(document)
    .off("click.uieKitchenPickRow", "#uie-k-pick-list .pick-row")
    .on("click.uieKitchenPickRow", "#uie-k-pick-list .pick-row", function(e){
      e.preventDefault(); e.stopPropagation();
      const id = String($(this).data("id") || "");
      if (!id) return;
      onPickItem(id);
    });

  $(document)
    .off("click.uieKitchenStart", "#uie-k-start")
    .on("click.uieKitchenStart", "#uie-k-start", async function(e){ e.preventDefault(); e.stopPropagation(); await startCooking(); });

  $(document)
    .off("click.uieKitchenPause", "#uie-k-pause")
    .on("click.uieKitchenPause", "#uie-k-pause", async function(e){ e.preventDefault(); e.stopPropagation(); await pauseCooking(); });

  $(document)
    .off("click.uieKitchenResume", "#uie-k-resume")
    .on("click.uieKitchenResume", "#uie-k-resume", async function(e){ e.preventDefault(); e.stopPropagation(); await resumeCooking(); });

  $(document)
    .off("click.uieKitchenStir", "#uie-k-stir")
    .on("click.uieKitchenStir", "#uie-k-stir", async function(e){ e.preventDefault(); e.stopPropagation(); await stir(); });

  $(document)
    .off("click.uieKitchenCancel", "#uie-k-cancel")
    .on("click.uieKitchenCancel", "#uie-k-cancel", async function(e){ e.preventDefault(); e.stopPropagation(); await cancelCooking(); });

  $(document)
    .off("click.uieKitchenServe", "#uie-k-serve")
    .on("click.uieKitchenServe", "#uie-k-serve", async function(e){ e.preventDefault(); e.stopPropagation(); await serve(); });

  renderKitchen();
}
