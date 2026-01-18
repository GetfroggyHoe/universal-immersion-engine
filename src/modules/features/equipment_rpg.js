import { getSettings, saveSettings } from "../core.js";
import { injectRpEvent } from "./rp_log.js";

let layerIndex = 2;
let pageIndex = 0;
const PAGE_SIZE = 8;
 
const LAYERS = [
  {
    name: "INNER",
    slots: [
      { id: "undies", icon: "fa-venus-mars" },
      { id: "socks", icon: "fa-socks" },
      { id: "tattoo", icon: "fa-dragon" },
      { id: "scar", icon: "fa-heart-crack" },
      { id: "ears", icon: "fa-ear-listen" },
      { id: "face", icon: "fa-face-smile" },
      { id: "ink", icon: "fa-wand-sparkles" },
      { id: "soul", icon: "fa-ghost" }
    ]
  },
  {
    name: "CLOTH",
    slots: [
      { id: "shirt", icon: "fa-shirt" },
      { id: "pants", icon: "fa-user" },
      { id: "vest", icon: "fa-box" },
      { id: "belt", icon: "fa-grip-lines" },
      { id: "boots", icon: "fa-shoe-prints" },
      { id: "gloves", icon: "fa-hand" },
      { id: "bag", icon: "fa-bag-shopping" },
      { id: "cloak", icon: "fa-feather" }
    ]
  },
  {
    name: "ARMOR",
    slots: [
      { id: "head", icon: "fa-helmet-safety" },
      { id: "chest", icon: "fa-shield" },
      { id: "legs", icon: "fa-person" },
      { id: "feet", icon: "fa-shoe-prints" },
      { id: "hands", icon: "fa-hand-fist" },
      { id: "neck", icon: "fa-link" },
      { id: "main", icon: "fa-khanda" },
      { id: "off", icon: "fa-shield-halved" }
    ]
  },
  {
    name: "METAPHYSICAL",
    slots: [
      { id: "aura", icon: "fa-star" },
      { id: "origin", icon: "fa-compass" },
      { id: "wings", icon: "fa-dove" },
      { id: "tail", icon: "fa-dragon" },
      { id: "relic", icon: "fa-gem" },
      { id: "r1", icon: "fa-ring" },
      { id: "r2", icon: "fa-ring" },
      { id: "focus", icon: "fa-wand-sparkles" }
    ]
  }
];
 
function ensureEquip(s) {
  if (!s.inventory) s.inventory = {};
  if (!Array.isArray(s.inventory.items)) s.inventory.items = [];
  if (!Array.isArray(s.inventory.equipped)) s.inventory.equipped = [];
  if (!s.character) s.character = {};
  if (!s.character.stats || typeof s.character.stats !== "object") s.character.stats = {};
  const d = { str:10,dex:10,con:10,int:10,wis:10,cha:10,per:10,luk:10,agi:10,vit:10,end:10,spi:10 };
  for (const k of Object.keys(d)) {
    if (!Number.isFinite(Number(s.character.stats[k]))) s.character.stats[k] = d[k];
  }
  if (!Array.isArray(s.character.statusEffects)) s.character.statusEffects = [];
}
 
function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fxIconClass(raw) {
  const t = String(raw || "").trim().toLowerCase();
  if (!t) return "fa-circle-dot";
  if (/(tired|fatigue|exhaust|sleepy|drowsy)/.test(t)) return "fa-bed";
  if (/(hungry|starving|famished)/.test(t)) return "fa-utensils";
  if (/(thirst|dehydrat)/.test(t)) return "fa-droplet";
  if (/(poison|toxic|venom)/.test(t)) return "fa-skull-crossbones";
  if (/(bleed|hemorr)/.test(t)) return "fa-kit-medical";
  if (/(injur|wound|hurt|fractur)/.test(t)) return "fa-bandage";
  if (/(sick|ill|fever|nausea|dizzy|flu)/.test(t)) return "fa-viruses";
  if (/(infect|zombie|plague)/.test(t)) return "fa-biohazard";
  if (/(smell|smelly|stink|odor|stinky|reek)/.test(t)) return "fa-wind";
  if (/(drunk|intoxic|hungover)/.test(t)) return "fa-wine-bottle";
  if (/(burn|burning|on fire)/.test(t)) return "fa-fire";
  if (/(cold|frozen|hypotherm|chill)/.test(t)) return "fa-snowflake";
  if (/(wet|drench|soaked)/.test(t)) return "fa-water";
  if (/(stress|anxious|panic)/.test(t)) return "fa-brain";
  if (/(curs|hex)/.test(t)) return "fa-skull";
  if (/(shield|guard|ward)/.test(t)) return "fa-shield";
  if (/(invis|hidden|stealth)/.test(t)) return "fa-eye-slash";
  if (/(grade|gpa|exam|failing|school)/.test(t)) return "fa-graduation-cap";
  if (/(crumbl|collapse|broken|ruin)/.test(t)) return "fa-house-crack";
  return "fa-circle-dot";
}

function fxFindRelatedTracker(s, raw) {
  const name = String(raw || "").trim().toLowerCase();
  const trackers = Array.isArray(s?.life?.trackers) ? s.life.trackers : [];
  if (!name || !trackers.length) return null;
  const synonyms = [
    { re: /(tired|fatigue|exhaust|sleepy)/, keys: ["fatigue", "energy", "stamina", "sleep"] },
    { re: /(smell|smelly|stink|odor|reek)/, keys: ["hygiene", "clean", "odor", "smell"] },
    { re: /(crumbl|collapse|broken|ruin)/, keys: ["integrity", "condition", "structure", "base", "durability"] },
    { re: /(grade|gpa|exam|failing|school)/, keys: ["grade", "gpa", "school", "study"] },
    { re: /(hunger|hungry|starving)/, keys: ["hunger", "food"] },
    { re: /(thirst|dehydrat)/, keys: ["thirst", "water"] },
  ];
  const hinted = synonyms.find(x => x.re.test(name));
  const tokens = hinted ? hinted.keys : name.split(/[^a-z0-9]+/g).filter(Boolean).slice(0, 6);
  if (!tokens.length) return null;

  let best = null;
  let bestScore = 0;
  for (const tr of trackers) {
    const tn = String(tr?.name || "").trim().toLowerCase();
    if (!tn) continue;
    let score = 0;
    for (const tok of tokens) {
      if (!tok) continue;
      if (tn === tok) score += 4;
      else if (tn.includes(tok)) score += 2;
    }
    if (score > bestScore) { bestScore = score; best = tr; }
  }
  return bestScore ? best : null;
}

function fxRenderPopover(anchorRect, raw, tracker) {
  let box = document.getElementById("uie-equip-fx-pop");
  if (!box) {
    box = document.createElement("div");
    box.id = "uie-equip-fx-pop";
    box.style.cssText = "position:fixed;z-index:2147483655;max-width:min(360px,92vw);padding:12px 14px;border-radius:14px;border:1px solid rgba(255,255,255,0.12);background:rgba(15,10,8,0.96);color:#fff;font-weight:900;box-sizing:border-box;";
    document.body.appendChild(box);
    box.addEventListener("click", () => { try { box.remove(); } catch (_) {} });
  }
  box.innerHTML = "";
  const head = document.createElement("div");
  head.style.cssText = "display:flex;gap:10px;align-items:center;margin-bottom:10px;";
  const ico = document.createElement("i");
  ico.className = `fa-solid ${fxIconClass(raw)}`;
  ico.style.cssText = "width:18px;text-align:center;opacity:0.95;";
  const ttl = document.createElement("div");
  ttl.textContent = String(raw || "");
  ttl.style.cssText = "flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
  head.appendChild(ico);
  head.appendChild(ttl);
  box.appendChild(head);

  if (tracker && typeof tracker === "object") {
    const name = String(tracker?.name || "Tracker");
    const cur = Number(tracker?.current ?? 0);
    const max = Math.max(1, Number(tracker?.max ?? 100));
    const color = String(tracker?.color || "#89b4fa");
    const pct = Math.max(0, Math.min(100, (cur / max) * 100));
    const meta = document.createElement("div");
    meta.textContent = `${name}: ${cur}/${max}`;
    meta.style.cssText = "opacity:0.78;font-size:12px;letter-spacing:0.2px;margin-bottom:8px;";
    box.appendChild(meta);
    const bar = document.createElement("div");
    bar.style.cssText = "position:relative;height:14px;border-radius:7px;border:1px solid rgba(255,255,255,0.10);background:rgba(0,0,0,0.30);overflow:hidden;";
    const fill = document.createElement("div");
    fill.style.cssText = `height:100%;width:${pct}%;background:${color};`;
    const txt = document.createElement("div");
    txt.textContent = `${cur}/${max}`;
    txt.style.cssText = "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:900;color:rgba(255,255,255,0.92);text-shadow:0 1px 2px rgba(0,0,0,0.7);";
    bar.appendChild(fill);
    bar.appendChild(txt);
    box.appendChild(bar);
  }

  box.style.left = "0px";
  box.style.top = "0px";
  box.style.transform = "none";
  const pad = 8;
  const br = box.getBoundingClientRect();
  let left = (anchorRect.left + anchorRect.right) / 2 - br.width / 2;
  left = Math.max(pad, Math.min(window.innerWidth - br.width - pad, left));
  let top = anchorRect.bottom + 8;
  if (top + br.height + pad > window.innerHeight) top = anchorRect.top - br.height - 8;
  top = Math.max(pad, Math.min(window.innerHeight - br.height - pad, top));
  box.style.left = `${Math.round(left)}px`;
  box.style.top = `${Math.round(top)}px`;
}
 
function findEquipped(s, slotId) {
  const eq = s.inventory.equipped || [];
  for (let i = 0; i < eq.length; i++) {
    if (String(eq[i]?.slotId || "") === slotId) return { item: eq[i], index: i };
  }
  return { item: null, index: -1 };
}
 
function isEditMode() {
  const root = document.getElementById("uie-inventory-window");
  return !!root && root.dataset.editMode === "1";
}
 
function renderTop(s) {
  $("#equip-layer-name").text(LAYERS[layerIndex]?.name || "ARMOR");
  $("#equip-edit-chip").css("display", isEditMode() ? "inline-flex" : "none");

  const wrap = $("#equip-status-wrap");
  if (wrap.length) {
    wrap.empty();
    const fx = Array.isArray(s.character.statusEffects) ? s.character.statusEffects : [];
    if (!fx.length) {
      wrap.append(`<div class="equip-chip" style="opacity:0.55;">No Status</div>`);
    } else {
      fx.slice(0, 10).forEach((x, i) => {
        const raw = String(x || "").trim().slice(0, 120);
        const del = isEditMode() ? ` data-act="delStatus" data-idx="${i}"` : "";
        wrap.append(`<div class="equip-fx-icon" data-fx="${esc(raw)}" title="${esc(raw)}"${del}><i class="fa-solid ${esc(fxIconClass(raw))}"></i></div>`);
      });
    }
  }
}

function renderPaperDoll(s) {
  const url = String(s?.character?.paperDoll || s?.character?.portrait || "");
  const img = document.getElementById("equip-doll-img");
  const empty = document.getElementById("equip-doll-empty");
  if (!img || !empty) return;
  if (url) {
    img.src = url;
    img.style.display = "block";
    empty.style.display = "none";
  } else {
    img.removeAttribute("src");
    img.style.display = "none";
    empty.style.display = "block";
  }
}

function slotLabel(slotId) {
  const t = String(slotId || "");
  return t ? t.toUpperCase().replace(/_/g, " ") : "SLOT";
}
 
function renderSlots(s) {
  const layer = LAYERS[layerIndex] || LAYERS[2];
  const $left = $("#equip-slot-left");
  const $right = $("#equip-slot-right");
  if (!$left.length || !$right.length) return;
  $left.empty();
  $right.empty();

  const slots = Array.isArray(layer?.slots) ? layer.slots : [];
  const pages = Math.max(1, Math.ceil(slots.length / PAGE_SIZE));
  pageIndex = Math.max(0, Math.min(pages - 1, Number(pageIndex) || 0));
  $("#equip-page-ind").text(`${pageIndex + 1}/${pages}`);
  const pager = document.querySelector("#uie-view-equip .equip-page");
  if (pager) pager.style.display = pages <= 1 ? "none" : "";

  const start = pageIndex * PAGE_SIZE;
  const slice = slots.slice(start, start + PAGE_SIZE);
  const half = Math.ceil(slice.length / 2);
  const leftSlots = slice.slice(0, half);
  const rightSlots = slice.slice(half);

  const renderSlot = (slot) => {
    const sid = String(slot.id);
    const found = findEquipped(s, sid);
    const it = found.item;
 
    const iconHtml = it?.img
      ? `<img src="${esc(it.img)}" alt="">`
      : `<i class="fa-solid ${esc(slot.icon || "fa-square")}"></i>`;
 
    const itemName = it ? esc(it.name || "Equipped") : "Empty";
    const badges = [];
 
    if (it?.rarity) badges.push(`<span class="equip-badge">${esc(it.rarity)}</span>`);
    if (it?.type) badges.push(`<span class="equip-badge">${esc(it.type)}</span>`);
    const fx = Array.isArray(it?.statusEffects) ? it.statusEffects : [];
    if (fx.length) badges.push(`<span class="equip-badge">${esc(fx.join(", "))}</span>`);
 
    const actions = it
      ? `<button class="equip-btn danger" data-act="unequip" data-slot="${esc(sid)}">Unequip</button>`
      : (isEditMode() ? `<button class="equip-btn" data-act="setimg" data-slot="${esc(sid)}">Pick Image</button>` : "");
 
    return `
      <div class="equip-slot" data-slot="${esc(sid)}">
        <div class="equip-icon">${iconHtml}</div>
        <div class="equip-mid">
          <div class="slot-name">${slotLabel(sid)}</div>
          <div class="item-name">${itemName}</div>
          <div class="meta">${badges.join("")}</div>
        </div>
        <div class="equip-actions">
          ${actions}
        </div>
      </div>
    `;
  };

  leftSlots.forEach(slt => $left.append(renderSlot(slt)));
  rightSlots.forEach(slt => $right.append(renderSlot(slt)));
}
 
export function render() {
  const s = getSettings();
  if (!s) return;
  ensureEquip(s);
  renderTop(s);
  renderPaperDoll(s);
  renderSlots(s);
}
 
export function init() {
  const s = getSettings();
  if (!s) return;
  ensureEquip(s);
 
  $(document)
    .off("click.uieEquipLayerPrev", "#equip-layer-prev")
    .on("click.uieEquipLayerPrev", "#equip-layer-prev", (e) => {
      e.preventDefault();
      e.stopPropagation();
      layerIndex = (layerIndex - 1 + LAYERS.length) % LAYERS.length;
      pageIndex = 0;
      render();
    });

  $(document)
    .off("click.uieEquipFx", "#equip-status-wrap .equip-fx-icon")
    .on("click.uieEquipFx", "#equip-status-wrap .equip-fx-icon", function (e) {
      e.preventDefault();
      e.stopPropagation();
      const act = String($(this).data("act") || "");
      const idx = Number($(this).data("idx"));
      const s2 = getSettings();
      ensureEquip(s2);
      if (act === "delStatus" && Number.isFinite(idx) && isEditMode()) {
        const fx = Array.isArray(s2.character.statusEffects) ? s2.character.statusEffects : [];
        if (idx >= 0 && idx < fx.length) {
          fx.splice(idx, 1);
          s2.character.statusEffects = fx;
          saveSettings();
          render();
        }
        return;
      }
      const tip = String(this.getAttribute("title") || "").trim();
      if (!tip) return;
      const rect = this.getBoundingClientRect();
      const tracker = fxFindRelatedTracker(s2, tip);
      fxRenderPopover(rect, tip, tracker);
    });
 
  $(document)
    .off("click.uieEquipLayerNext", "#equip-layer-next")
    .on("click.uieEquipLayerNext", "#equip-layer-next", (e) => {
      e.preventDefault();
      e.stopPropagation();
      layerIndex = (layerIndex + 1) % LAYERS.length;
      pageIndex = 0;
      render();
    });

  $(document)
    .off("click.uieEquipPagePrev", "#equip-page-prev")
    .on("click.uieEquipPagePrev", "#equip-page-prev", (e) => {
      e.preventDefault();
      e.stopPropagation();
      pageIndex = Math.max(0, Number(pageIndex || 0) - 1);
      render();
    });

  $(document)
    .off("click.uieEquipPageNext", "#equip-page-next")
    .on("click.uieEquipPageNext", "#equip-page-next", (e) => {
      e.preventDefault();
      e.stopPropagation();
      pageIndex = Number(pageIndex || 0) + 1;
      render();
    });
 
  $(document)
    .off("click.uieEquipAct", "#equip-slot-left [data-act], #equip-slot-right [data-act]")
    .on("click.uieEquipAct", "#equip-slot-left [data-act], #equip-slot-right [data-act]", async function (e) {
      e.preventDefault();
      e.stopPropagation();
 
      const act = String($(this).data("act") || "");
      const slotId = String($(this).data("slot") || "");
      if (!slotId) return;
 
      const s2 = getSettings();
      if (!s2) return;
      ensureEquip(s2);
 
      if (act === "unequip") {
        const found = findEquipped(s2, slotId);
        if (found.item) {
          const putBack = { ...found.item };
          const name = String(putBack.name || "Item");
          delete putBack.slotId;
          s2.inventory.equipped.splice(found.index, 1);
          s2.inventory.items.push(putBack);
          saveSettings();
          render();
          injectRpEvent(`Unequipped ${name} from ${slotLabel(slotId)}.`, { uie: { type: "unequip", item: name, slot: slotId } });
        }
        return;
      }
 
      if (act === "setimg") {
        if (!isEditMode()) return;
        const input = document.getElementById("uie-inv-file");
        if (!input) return;
        input.value = "";
        input.onchange = async () => {
          const f = input.files && input.files[0];
          if (!f) return;
          const r = new FileReader();
          r.onload = () => {
            const dataUrl = String(r.result || "");
            const found = findEquipped(s2, slotId);
            if (found.item) {
              found.item.img = dataUrl;
            } else {
              s2.inventory.equipped.push({ slotId, name: slotLabel(slotId), img: dataUrl, type: "equip", rarity: "common" });
            }
            saveSettings();
            render();
          };
          r.readAsDataURL(f);
        };
        input.click();
      }
    });

  $(document)
    .off("click.uieEquipPickDoll", "#equip-doll-frame")
    .on("click.uieEquipPickDoll", "#equip-doll-frame", function(e){
      if (!isEditMode()) return;
      e.preventDefault();
      e.stopPropagation();
      const input = document.getElementById("uie-inv-file");
      if (!input) return;
      input.value = "";
      input.onchange = async () => {
        const f = input.files && input.files[0];
        if (!f) return;
        const r = new FileReader();
        r.onload = () => {
          const dataUrl = String(r.result || "");
          const s2 = getSettings();
          ensureEquip(s2);
          if (!s2.character) s2.character = {};
          s2.character.paperDoll = dataUrl;
          saveSettings();
          render();
        };
        r.readAsDataURL(f);
      };
      input.click();
    });

  $(document)
    .off("click.uieEquipStatus", "#equip-status-wrap [data-act='delStatus']")
    .on("click.uieEquipStatus", "#equip-status-wrap [data-act='delStatus']", function(e) {
      e.preventDefault();
      e.stopPropagation();
      if (!isEditMode()) return;
      const idx = Number($(this).data("idx"));
      const s2 = getSettings();
      ensureEquip(s2);
      if (!Array.isArray(s2.character.statusEffects)) s2.character.statusEffects = [];
      if (idx >= 0 && idx < s2.character.statusEffects.length) {
        s2.character.statusEffects.splice(idx, 1);
        saveSettings();
        render();
      }
    });
 
  render();
}

