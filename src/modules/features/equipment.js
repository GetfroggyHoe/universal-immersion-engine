import { getSettings, saveSettings } from "../core.js";
import { injectRpEvent } from "./rp_log.js";
import { addInventoryItemWithStack } from "../inventoryItems.js";

let currentLayerIndex = 2; // ARMOR default
let currentPage = 0;       // page within layer (3 per side)

const SLOT_LABELS = {
  // INNER
  undies: "Undies", socks: "Socks", tattoo: "Tattoo", scar: "Scar",
  ears: "Ears", face: "Face", ink: "Ink", soul: "Soul",

  // CLOTH
  shirt: "Shirt", pants: "Pants", vest: "Vest", belt: "Belt",
  boots: "Boots", gloves: "Gloves", aura: "Aura", bag: "Bag",

  // ARMOR
  head: "Head", chest: "Chest", legs: "Legs", feet: "Feet",
  hands: "Hands", shldr: "Shoulder", back: "Back", neck: "Neck",

  // GEAR
  main: "Main", off: "Off", range: "Range", ammo: "Ammo",
  r1: "Ring 1", r2: "Ring 2", relic: "Relic", tool: "Tool",

  // Extra utility (kept)
  trinket: "Trinket", focus: "Focus", quick: "Quick", utility: "Utility",
};

// Your canonical slot sets (unchanged)
const LAYERS = [
  { name: "INNER", slots: [
    { id:"undies", side:"left",  icon:"fa-venus-mars" },
    { id:"socks",  side:"left",  icon:"fa-socks" },
    { id:"tattoo", side:"left",  icon:"fa-dragon" },
    { id:"scar",   side:"left",  icon:"fa-heart-crack" },

    { id:"ears", side:"right", icon:"fa-ear-listen" },
    { id:"face", side:"right", icon:"fa-face-smile" },
    { id:"ink",  side:"right", icon:"fa-wand-sparkles" },
    { id:"soul", side:"right", icon:"fa-ghost" },
  ]},
  { name: "CLOTH", slots: [
    { id:"shirt",  side:"left",  icon:"fa-shirt" },
    { id:"vest",   side:"left",  icon:"fa-box" },
    { id:"gloves", side:"left",  icon:"fa-hand" },
    { id:"aura",   side:"left",  icon:"fa-star" },

    { id:"pants", side:"right", icon:"fa-user" },
    { id:"belt",  side:"right", icon:"fa-grip-lines" },
    { id:"boots", side:"right", icon:"fa-shoe-prints" },
    { id:"bag",   side:"right", icon:"fa-bag-shopping" },
  ]},
  { name: "ARMOR", slots: [
    { id:"head",  side:"left",  icon:"fa-helmet-safety" },
    { id:"chest", side:"left",  icon:"fa-shield" },
    { id:"legs",  side:"left",  icon:"fa-person" },
    { id:"feet",  side:"left",  icon:"fa-shoe-prints" },

    { id:"hands", side:"right", icon:"fa-hand-fist" },
    { id:"shldr", side:"right", icon:"fa-user-shield" },
    { id:"back",  side:"right", icon:"fa-feather" },
    { id:"neck",  side:"right", icon:"fa-link" },
  ]},
  { name: "GEAR", slots: [
    // left (6)
    { id:"main",  side:"left",  icon:"fa-khanda" },
    { id:"off",   side:"left",  icon:"fa-shield-halved" },
    { id:"range", side:"left",  icon:"fa-bow-arrow" },
    { id:"ammo",  side:"left",  icon:"fa-bullseye" },
    { id:"tool",  side:"left",  icon:"fa-screwdriver-wrench" },
    { id:"relic", side:"left",  icon:"fa-gem" },

    // right (6)
    { id:"r1",      side:"right", icon:"fa-ring" },
    { id:"r2",      side:"right", icon:"fa-ring" },
    { id:"trinket", side:"right", icon:"fa-diamond" },
    { id:"focus",   side:"right", icon:"fa-wand-sparkles" },
    { id:"quick",   side:"right", icon:"fa-bolt" },
    { id:"utility", side:"right", icon:"fa-toolbox" },
  ]},
];

/**
 * Immersion padding:
 * When a layer side has < 3 slots on the current page, we pad it with other
 * thematic slots (ink/soul/etc) so page 2 doesn't feel empty on mobile.
 *
 * This does NOT remove your slot types — it only displays extra slots as "bonus views".
 */
const FILLERS = {
  // Armor page 2 feels empty -> show spiritual/cosmetic slots as immersion
  ARMOR: {
    left:  ["tattoo","scar","undies","socks","shirt","belt"],
    right: ["ink","soul","ears","face","aura","bag"],
  },
  // Cloth page 2 feels empty -> show body/ritual slots as immersion
  CLOTH: {
    left:  ["tattoo","scar","undies","socks","head","neck"],
    right: ["ink","soul","ears","face","relic","r1"],
  },
  // Optional (not really needed, but keeps symmetry if you ever change paging)
  INNER: {
    left:  ["shirt","vest","gloves"],
    right: ["pants","belt","boots"],
  },
  // GEAR already fills 3/3 on both pages, so no fillers needed
  GEAR: { left: [], right: [] },
};

// Build icon lookup from every known slot (across layers)
const ICON_BY_ID = (() => {
  const map = {};
  for (const layer of LAYERS) {
    for (const s of layer.slots) map[s.id] = s.icon;
  }
  // Provide sensible icons for any filler ids not already mapped (rare)
  map.relic = map.relic || "fa-gem";
  map.r1 = map.r1 || "fa-ring";
  map.r2 = map.r2 || "fa-ring";
  return map;
})();

function ensureEquipArrays(s) {
  if (!s.inventory) s.inventory = { items: [], skills: [], assets: [], statuses: [], equipped: [] };
  if (!Array.isArray(s.inventory.items)) s.inventory.items = [];
  if (!Array.isArray(s.inventory.equipped)) s.inventory.equipped = [];
}

function findEquippedBySlot(equippedArr, slotId) {
  for (let i = 0; i < equippedArr.length; i++) {
    if (String(equippedArr[i].slotId) === slotId) return { item: equippedArr[i], index: i };
  }
  return { item: null, index: -1 };
}

function splitBySide(layer) {
  const left = layer.slots.filter(s => s.side === "left");
  const right = layer.slots.filter(s => s.side === "right");
  const leftPages = Math.max(1, Math.ceil(left.length / 3));
  const rightPages = Math.max(1, Math.ceil(right.length / 3));
  const totalPages = Math.max(leftPages, rightPages);
  return { left, right, totalPages };
}

// Pads a slice up to 3 slots using immersion fillers (unique per page)
function padToThree(slice, side, layerName, alreadyUsedIds) {
  const out = [...slice];
  const want = 3 - out.length;
  if (want <= 0) return out;

  const pool = (FILLERS[layerName] && FILLERS[layerName][side]) ? FILLERS[layerName][side] : [];
  for (const id of pool) {
    if (out.length >= 3) break;
    if (alreadyUsedIds.has(id)) continue;
    alreadyUsedIds.add(id);
    out.push({ id, side, icon: ICON_BY_ID[id] || "fa-circle-question" });
  }

  // If still short (unlikely), add blank pads (non-interactive)
  while (out.length < 3) {
    const pid = `pad_${layerName}_${side}_${out.length}`;
    alreadyUsedIds.add(pid);
    out.push({ id: pid, side, icon: "fa-circle" , _pad: true });
  }

  return out;
}

function renderLayer() {
  const s = getSettings();
  if (!s) return;
  ensureEquipArrays(s);

  const layer = LAYERS[currentLayerIndex];
  const pageInfo = splitBySide(layer);

  $("#equip-layer-name").text(layer.name);

  // Desktop Mode: Show ALL slots (No Paging)
  $("#equip-page-prev, #equip-page-next, #equip-page-ind").hide();

  const avatar = s.avatar || "";
  if (avatar) {
    $("#equip-doll-img").attr("src", avatar).show();
    $("#equip-doll-empty").hide();
  } else {
    $("#equip-doll-img").hide();
    $("#equip-doll-empty").show();
  }

  const leftCol = $("#equip-slot-left");
  const rightCol = $("#equip-slot-right");
  if (!leftCol.length || !rightCol.length) return;

  leftCol.empty();
  rightCol.empty();

  const equipped = s.inventory.equipped;

  // Show ALL slots for the layer
  let leftSlice = pageInfo.left;
  let rightSlice = pageInfo.right;

  // GLOBAL MAX LENGTH FIX:
  // The user wants "all paper dolls to be the longest one".
  // The 'GEAR' layer has 6 slots per side. We must force ALL layers to have 6 slots per side.
  const GLOBAL_MAX = 6;

  // Pad left side to GLOBAL_MAX
  if (leftSlice.length < GLOBAL_MAX) {
      const used = new Set(leftSlice.map(s => s.id));
      while(leftSlice.length < GLOBAL_MAX) {
          const pid = `pad_${layer.name}_left_${leftSlice.length}`;
          leftSlice.push({ id: pid, side: "left", icon: "fa-circle", _pad: true });
      }
  }

  // Pad right side to GLOBAL_MAX
  if (rightSlice.length < GLOBAL_MAX) {
      const used = new Set(rightSlice.map(s => s.id));
      while(rightSlice.length < GLOBAL_MAX) {
          const pid = `pad_${layer.name}_right_${rightSlice.length}`;
          rightSlice.push({ id: pid, side: "right", icon: "fa-circle", _pad: true });
      }
  }

  function makeWrap(slot) {
    const isPad = !!slot._pad || String(slot.id).startsWith("pad_");
    const label = isPad ? "Empty Slot" : (SLOT_LABELS[slot.id] || slot.id);

    let inner = `<i class="fa-solid ${slot.icon}" style="font-size:1.5em; color:rgba(255,255,255,0.5);"></i>`;
    let itemName = "Empty";
    let isEquipped = false;
    let eqItem = null;

    if (!isPad) {
      const found = findEquippedBySlot(equipped, slot.id);
      eqItem = found.item;

      if (eqItem) {
        isEquipped = true;
        itemName = eqItem.name || "Unknown Item";
        if (eqItem.image) {
          inner = `<img src="${eqItem.image}" style="width:100%;height:100%;object-fit:contain;border-radius:8px;">`;
        } else {
           // If item has no image, keep default icon but maybe brighter?
           // Or use a generic bag icon. Let's stick to the slot icon but brighter.
           inner = `<i class="fa-solid ${slot.icon}" style="font-size:1.5em; color:#f1c40f;"></i>`;
        }
      }
    }

    // New Desktop-Friendly Row Structure
    // Uses 'equip-slot' class to match equipment.html CSS
    return $(`
      <div class="equip-slot ${isPad ? 'pad' : ''} ${isEquipped ? 'filled' : ''}" data-id="${slot.id}">
        <div class="equip-icon">
          ${inner}
        </div>
        <div class="equip-mid">
          <div class="slot-name">${label}</div>
          <div class="item-name" style="${isEquipped ? '' : 'opacity:0.4; font-weight:normal;'}">${itemName}</div>
        </div>
      </div>
    `);
  }

  leftSlice.forEach(slot => leftCol.append(makeWrap(slot)));
  rightSlice.forEach(slot => rightCol.append(makeWrap(slot)));
}

export function init() {
  try {
    $(document)
      .off("click.uieEquipPrev", "#equip-layer-prev")
      .on("click.uieEquipPrev", "#equip-layer-prev", (e) => {
        e.preventDefault();
        currentLayerIndex = (currentLayerIndex - 1 + LAYERS.length) % LAYERS.length;
        currentPage = 0;
        renderLayer();
      });

    $(document)
      .off("click.uieEquipNext", "#equip-layer-next")
      .on("click.uieEquipNext", "#equip-layer-next", (e) => {
        e.preventDefault();
        currentLayerIndex = (currentLayerIndex + 1) % LAYERS.length;
        currentPage = 0;
        renderLayer();
      });

    $(document)
      .off("click.uieEquipPagePrev", "#equip-page-prev")
      .on("click.uieEquipPagePrev", "#equip-page-prev", (e) => {
        e.preventDefault();
        currentPage -= 1;
        renderLayer();
      });

    $(document)
      .off("click.uieEquipPageNext", "#equip-page-next")
      .on("click.uieEquipPageNext", "#equip-page-next", (e) => {
        e.preventDefault();
        currentPage += 1;
        renderLayer();
      });

    // Updated selector to match new class name '.equip-slot'
    $(document)
      .off("click.uieEquipSlot", "#uie-view-equip .equip-slot")
      .on("click.uieEquipSlot", "#uie-view-equip .equip-slot", function (e) {
        e.preventDefault();

        // ignore pad slots
        if ($(this).hasClass("pad")) return;

        const slotId = String($(this).data("id") || "");
        if (!slotId) return;

        const s = getSettings();
        if (!s) return;
        ensureEquipArrays(s);

        const found = findEquippedBySlot(s.inventory.equipped, slotId);
        if (found.item) {
          const putBack = { ...found.item };
          delete putBack.slotId;
          s.inventory.equipped.splice(found.index, 1);
          addInventoryItemWithStack(s.inventory.items, putBack, { source: "unequip" });
          saveSettings();
          renderLayer();
          injectRpEvent(`[System: User unequipped ${putBack.name}.]`);
        }
      });

    renderLayer();
  } catch (err) {
    console.error("[UIE] equipment.js init prevented crash:", err);
  }
}

export function render() {
  // Only re-render when the Equip tab is active
  try {
    if (!$("#uie-inventory-window .pop-tab[data-tab='equip']").hasClass("active")) return;
  } catch (e) {
    // If DOM isn't ready, just bail safely
    return;
  }

  try { renderLayer(); }
  catch (e) { console.error("[UIE] Equipment.render failed", e); }
}

