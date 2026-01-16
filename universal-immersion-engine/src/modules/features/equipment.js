import { getSettings, saveSettings } from "../core.js";

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

function ensureUI() {
  const container = $("#uie-view-equip");
  if (!container.length) return;
  if (container.find(".uie-equip-frame").length) return;

  container.html(
    '<style>' +
      /* do NOT force #uie-view-equip display (prevents tab hijack) */
      '#uie-view-equip .uie-equip-frame{width:100% !important; max-width:360px !important; margin:0 auto !important; padding:4px 6px 10px !important;}' +

      '#uie-view-equip .doll-nav{display:flex !important; justify-content:center !important; align-items:center !important; gap:14px !important; padding:6px 0 4px !important;}' +
      '#uie-view-equip .slot-nav{display:flex !important; justify-content:center !important; align-items:center !important; gap:12px !important; padding:0 0 8px !important; color:#a6adc8 !important; font-size:12px !important;}' +
      '#uie-view-equip .slot-nav .navbtn{cursor:pointer !important; color:#89b4fa !important; font-size:18px !important; padding:2px 8px !important; user-select:none !important;}' +
      '#uie-view-equip .slot-nav .navbtn.disabled{opacity:0.35 !important; pointer-events:none !important;}' +

      /* 3 / Doll / 3 */
      '#uie-view-equip .uie-doll-row{display:grid !important; grid-template-columns: 1fr 140px 1fr !important; gap:10px !important; padding:0 6px 10px !important; align-items:start !important;}' +
      '#uie-view-equip .uie-doll-col{display:grid !important; grid-auto-rows:min-content !important; gap:8px !important; justify-items:center !important;}' +

      '#uie-view-equip .uie-doll-center{width:140px !important; height:260px !important; display:flex !important; align-items:center !important; justify-content:center !important; pointer-events:none !important;}' +
      '#uie-view-equip #uie-doll-img{width:100% !important; height:100% !important; object-fit:contain !important; border-radius:16px !important; display:none;}' +
      '#uie-view-equip .uie-doll-placeholder{width:140px !important; height:260px !important; border-radius:16px !important; opacity:0.15 !important; border:2px dashed rgba(205,214,244,0.35) !important;}' +

      '#uie-view-equip .uie-equip-wrap{width:78px !important; display:flex !important; flex-direction:column !important; align-items:center !important; gap:4px !important;}' +
      '#uie-view-equip .uie-equip-slot{width:52px !important; height:52px !important; border-radius:14px !important; display:flex !important; align-items:center !important; justify-content:center !important; cursor:pointer !important; user-select:none !important; background: var(--bp-surface) !important; border:2px solid transparent !important;}' +
      '#uie-view-equip .uie-equip-slot.filled{border:2px solid var(--bp-accent) !important; background:#1e1e2e !important; box-shadow:0 0 8px rgba(137,180,250,0.18) !important;}' +
      '#uie-view-equip .uie-equip-slot.pad{opacity:0.20 !important; cursor:default !important;}' +
      '#uie-view-equip .uie-slot-label{font-size:10px !important; line-height:1 !important; color:#a6adc8 !important; text-align:center !important; max-width:78px !important; white-space:nowrap !important; overflow:hidden !important; text-overflow:ellipsis !important;}' +
    '</style>' +

    '<div class="uie-equip-frame">' +
      '<div class="doll-nav">' +
        '<div id="btn-layer-prev" style="cursor:pointer;font-size:1.4em;color:#89b4fa;">&lt;</div>' +
        '<div id="lbl-layer-name" style="font-weight:bold;color:#fff;">ARMOR</div>' +
        '<div id="btn-layer-next" style="cursor:pointer;font-size:1.4em;color:#89b4fa;">&gt;</div>' +
      '</div>' +

      '<div class="slot-nav">' +
        '<div id="btn-page-prev" class="navbtn">&lsaquo;</div>' +
        '<div id="lbl-page" style="min-width:70px;text-align:center;">1/1</div>' +
        '<div id="btn-page-next" class="navbtn">&rsaquo;</div>' +
      '</div>' +

      '<div class="uie-doll-row">' +
        '<div class="uie-doll-col" id="doll-col-left"></div>' +
        '<div class="uie-doll-center" id="uie-doll-center">' +
          '<img id="uie-doll-img" src="" alt="">' +
          '<div class="uie-doll-placeholder" id="uie-doll-placeholder"></div>' +
        '</div>' +
        '<div class="uie-doll-col" id="doll-col-right"></div>' +
      '</div>' +
    '</div>'
  );
}

function renderLayer() {
  ensureUI();

  const s = getSettings();
  if (!s) return;
  ensureEquipArrays(s);

  const layer = LAYERS[currentLayerIndex];
  const pageInfo = splitBySide(layer);

  if (currentPage < 0) currentPage = 0;
  if (currentPage > pageInfo.totalPages - 1) currentPage = pageInfo.totalPages - 1;

  $("#lbl-layer-name").text(layer.name);

  const showPager = pageInfo.totalPages > 1;
  $("#btn-page-prev, #btn-page-next, #lbl-page").toggle(showPager);
  $("#lbl-page").text(`${currentPage + 1}/${pageInfo.totalPages}`);
  $("#btn-page-prev").toggleClass("disabled", currentPage === 0);
  $("#btn-page-next").toggleClass("disabled", currentPage >= pageInfo.totalPages - 1);

  const avatar = s.avatar || "";
  if (avatar) {
    $("#uie-doll-img").attr("src", avatar).show();
    $("#uie-doll-placeholder").hide();
  } else {
    $("#uie-doll-img").hide();
    $("#uie-doll-placeholder").show();
  }

  const leftCol = $("#doll-col-left");
  const rightCol = $("#doll-col-right");
  if (!leftCol.length || !rightCol.length) return;

  leftCol.empty();
  rightCol.empty();

  const equipped = s.inventory.equipped;
  const start = currentPage * 3;

  let leftSlice = pageInfo.left.slice(start, start + 3);
  let rightSlice = pageInfo.right.slice(start, start + 3);

  // Only pad when needed (this is what makes page 2 feel immersive)
  const used = new Set();
  for (const sl of leftSlice) used.add(sl.id);
  for (const sr of rightSlice) used.add(sr.id);

  if (leftSlice.length < 3) leftSlice = padToThree(leftSlice, "left", layer.name, used);
  if (rightSlice.length < 3) rightSlice = padToThree(rightSlice, "right", layer.name, used);

  function makeWrap(slot) {
    const isPad = !!slot._pad || String(slot.id).startsWith("pad_");
    const label = isPad ? "—" : (SLOT_LABELS[slot.id] || slot.id);

    let inner = `<i class="fa-solid ${slot.icon}" style="color:#6c7086;font-size:1.25em;"></i>`;

    if (!isPad) {
      const found = findEquippedBySlot(equipped, slot.id);
      const eqItem = found.item;

      if (eqItem && eqItem.image) {
        inner = `<img src="${eqItem.image}" style="width:100%;height:100%;object-fit:cover;border-radius:10px;">`;
      }
      return $(`
        <div class="uie-equip-wrap">
          <div class="uie-equip-slot ${eqItem ? "filled" : ""}" data-id="${slot.id}">${inner}</div>
          <div class="uie-slot-label">${label}</div>
        </div>
      `);
    }

    // pad slot (non-clickable)
    return $(`
      <div class="uie-equip-wrap">
        <div class="uie-equip-slot pad">${inner}</div>
        <div class="uie-slot-label">${label}</div>
      </div>
    `);
  }

  leftSlice.forEach(slot => leftCol.append(makeWrap(slot)));
  rightSlice.forEach(slot => rightCol.append(makeWrap(slot)));
}

export function init() {
  try {
    $(document)
      .off("click.uieEquipPrev", "#btn-layer-prev")
      .on("click.uieEquipPrev", "#btn-layer-prev", (e) => {
        e.preventDefault();
        currentLayerIndex = (currentLayerIndex - 1 + LAYERS.length) % LAYERS.length;
        currentPage = 0;
        renderLayer();
      });

    $(document)
      .off("click.uieEquipNext", "#btn-layer-next")
      .on("click.uieEquipNext", "#btn-layer-next", (e) => {
        e.preventDefault();
        currentLayerIndex = (currentLayerIndex + 1) % LAYERS.length;
        currentPage = 0;
        renderLayer();
      });

    $(document)
      .off("click.uieEquipPagePrev", "#btn-page-prev")
      .on("click.uieEquipPagePrev", "#btn-page-prev", (e) => {
        e.preventDefault();
        currentPage -= 1;
        renderLayer();
      });

    $(document)
      .off("click.uieEquipPageNext", "#btn-page-next")
      .on("click.uieEquipPageNext", "#btn-page-next", (e) => {
        e.preventDefault();
        currentPage += 1;
        renderLayer();
      });

    $(document)
      .off("click.uieEquipSlot", "#uie-view-equip .uie-equip-slot")
      .on("click.uieEquipSlot", "#uie-view-equip .uie-equip-slot", function (e) {
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
          s.inventory.items.push(putBack);
          saveSettings();
          renderLayer();
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

