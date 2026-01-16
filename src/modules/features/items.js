import { getSettings, saveSettings } from "../core.js";
import { generateContent } from "../apiClient.js";
import { getContext } from "../../../../../../extensions.js";
import { SLOT_TYPES_CORE } from "../slot_types_core.js";
import { inferItemType } from "../slot_types_infer.js";
import { injectRpEvent } from "./rp_log.js";
 
let mounted = false;
let activeIdx = null;
let viewMode = "items";
let genNeedsConfirm = false;

function ensureModel(s) {
  if (!s) return;
  if (!s.inventory) s.inventory = {};
  if (!Array.isArray(s.inventory.items)) s.inventory.items = [];
  if (!Array.isArray(s.inventory.skills)) s.inventory.skills = [];
  if (!Array.isArray(s.inventory.assets)) s.inventory.assets = [];
  if (!Array.isArray(s.inventory.statuses)) s.inventory.statuses = [];
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function loreKeys() {
  try {
    const ctx = getContext?.();
    const maybe = ctx?.world_info || ctx?.lorebook || ctx?.lore || ctx?.worldInfo;
    const keys = [];
    if (Array.isArray(maybe)) {
      for (const it of maybe) {
        const k = it?.key || it?.name || it?.title;
        if (k) keys.push(String(k));
      }
    } else if (maybe && typeof maybe === "object") {
      const entries = maybe.entries || maybe.world_info || maybe.items;
      if (Array.isArray(entries)) {
        for (const it of entries) {
          const k = it?.key || it?.name || it?.title;
          if (k) keys.push(String(k));
        }
      }
    }
    return Array.from(new Set(keys)).slice(0, 80);
  } catch (_) {
    return [];
  }
}

function chatSnippet() {
  try {
    let raw = "";
    const $txt = $(".chat-msg-txt");
    if ($txt.length) {
      $txt.slice(-20).each(function () { raw += $(this).text() + "\n"; });
      return raw.trim().slice(0, 2200);
    }
    const chatEl = document.querySelector("#chat");
    if (!chatEl) return "";
    const msgs = Array.from(chatEl.querySelectorAll(".mes")).slice(-20);
    for (const m of msgs) {
      const isUser =
        m.classList?.contains("is_user") ||
        m.getAttribute("is_user") === "true" ||
        m.getAttribute("data-is-user") === "true" ||
        m.dataset?.isUser === "true";
      const t =
        m.querySelector(".mes_text")?.textContent ||
        m.querySelector(".mes-text")?.textContent ||
        m.textContent ||
        "";
      raw += `${isUser ? "You" : "Story"}: ${String(t || "").trim()}\n`;
    }
    return raw.trim().slice(0, 2200);
  } catch (_) {
    return "";
  }
}

function normalizeKind(k) {
  const t = String(k || "").toLowerCase();
  if (t === "skills" || t === "skill") return "skill";
  if (t === "assets" || t === "asset") return "asset";
  return "item";
}

function cleanJsonText(t) {
  return String(t || "").replace(/```json|```/g, "").trim();
}

function contextBlob() {
  const lk = loreKeys();
  const chat = chatSnippet();
  return `${lk.join(", ")}\n${chat}`;
}

function filterEvidence(evidence, blob) {
  const out = [];
  const b = String(blob || "");
  const ev = Array.isArray(evidence) ? evidence : [];
  for (const e of ev) {
    const s = String(e || "").trim();
    if (!s) continue;
    if (s.length > 120) continue;
    if (b.includes(s)) out.push(s);
  }
  return Array.from(new Set(out)).slice(0, 8);
}

function validateEntry(kind, obj) {
  const k = normalizeKind(kind);
  const o = obj && typeof obj === "object" ? obj : {};
  const errors = [];

  const name = String(o.name || "").trim();
  if (!name) errors.push("Missing name");

  if (k === "item") {
    const type = String(o.type || "").trim();
    if (!type) errors.push("Missing type");
    const description = String(o.description || o.desc || "").trim();
    if (!description) errors.push("Missing description");
  }

  if (k === "skill") {
    const st = String(o.skillType || o.type || "").toLowerCase();
    if (!["active", "passive"].includes(st)) errors.push("skillType must be active or passive");
    const description = String(o.description || o.desc || "").trim();
    if (!description) errors.push("Missing description");
  }

  if (k === "asset") {
    const category = String(o.category || o.type || "").trim();
    if (!category) errors.push("Missing category");
    const description = String(o.description || o.desc || "").trim();
    if (!description) errors.push("Missing description");
    const location = String(o.location || "").trim();
    if (!location) errors.push("Missing location");
  }

  return { ok: errors.length === 0, errors };
}

const SLOT_ICON = {
  EQUIPMENT_CLASS: "fa-shield-halved",
  ALCHEMY: "fa-flask",
  ENCHANTMENT: "fa-wand-magic-sparkles",
  CRAFTING: "fa-hammer",
  COOKING: "fa-utensils",
  QUEST: "fa-key",
  FARMING: "fa-seedling",
  HUSBANDRY: "fa-horse",
  FISHING: "fa-fish",
  ENTOMOLOGY: "fa-bug",
  MERCHANT: "fa-receipt",
  MISC: "fa-box",
  UNCATEGORIZED: "fa-tags"
};

function titleCase(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function ensureSlotCategory(s, it) {
  if (!it || typeof it !== "object") return "UNCATEGORIZED";
  try {
    if (s?.inventory?.ui?.slotTypesEnabled === false) {
      it.slotCategory = "UNCATEGORIZED";
      return "UNCATEGORIZED";
    }
  } catch (_) {}
  const existing = String(it.slotCategory || "").trim().toUpperCase();
  if (existing) return existing;
  const inferred = inferItemType(it);
  const cat = String(inferred?.category || "UNCATEGORIZED").toUpperCase();
  it.slotCategory = cat;
  return cat;
}

function getCategoryKeys() {
  return Object.keys(SLOT_TYPES_CORE || {}).filter((k) => k && k !== "UNCATEGORIZED");
}

function renderCategoryUi(viewMode) {
  const $sel = $("#uie-items-category");
  const $chips = $("#uie-items-cat-chips");
  if (!$sel.length || !$chips.length) return;

  if (String(viewMode) !== "items") {
    $chips.hide();
    return;
  }

  const s = getSettings();
  if (s?.inventory?.ui?.slotTypesEnabled === false) {
    $chips.hide();
    $sel.hide();
    $sel.val("all");
    return;
  }
  $sel.show();
  $chips.show();

  const keys = getCategoryKeys();
  const cur = String($sel.val() || "all");

  $sel.empty();
  $sel.append(`<option value="all">All</option>`);
  keys.forEach((k) => $sel.append(`<option value="${esc(k.toLowerCase())}">${esc(titleCase(k))}</option>`));
  $sel.val(cur);

  $chips.empty();
  const mkChip = (cat, title, icon) =>
    `<button class="uie-cat-chip" data-cat="${esc(cat)}" title="${esc(title)}"><i class="fa-solid ${esc(icon)}"></i></button>`;
  $chips.append(mkChip("all", "All", "fa-layer-group"));
  keys.forEach((k) => {
    const c = k.toLowerCase();
    $chips.append(mkChip(c, titleCase(k), SLOT_ICON[k] || "fa-tags"));
  });
}

export async function init() {
  const $root = $("#uie-items-root");
  if (!$root.length) return;
  if (mounted) return;
  mounted = true;
  bind();
  render();
}

export function render() {
  const s = getSettings();
  if (!s) return;
  ensureModel(s);

  viewMode = "items";
  renderCategoryUi(viewMode);
  const list = s.inventory.items;
  const $grid = $("#uie-items-grid-inner");
  const $empty = $("#uie-items-empty");
  if (!$grid.length) return;

  const q = String($("#uie-items-search").val() || "").toLowerCase();
  const cat = String($("#uie-items-category").val() || "all");
  $(".uie-cat-chip").removeClass("active");
  $(`.uie-cat-chip[data-cat="${cat}"]`).addClass("active");

  let didMutate = false;
  const filtered = list.filter((it) => {
    const name = String(it?.name || "");
    let okCat = true;
    const slotCat = ensureSlotCategory(s, it).toLowerCase();
    okCat = cat === "all" ? true : slotCat === cat;
    if (!it.slotCategory) didMutate = true;
    const okQ = !q ? true : name.toLowerCase().includes(q);
    return okCat && okQ;
  });
  if (didMutate) saveSettings();

  $grid.empty();

  if (!filtered.length) {
    if ($empty.length) $empty.show();
    return;
  }
  if ($empty.length) $empty.hide();

  filtered.forEach((it) => {
    const idx = list.indexOf(it);
    const rarity = String(it?.rarity || "common").toLowerCase();
    const cls =
      rarity === "uncommon"
        ? "rarity-uncommon"
        : rarity === "rare"
          ? "rarity-rare"
          : rarity === "epic"
            ? "rarity-epic"
            : rarity === "legendary"
              ? "rarity-legendary"
              : "rarity-common";

    const slotCat = String(it?.slotCategory || "UNCATEGORIZED").toUpperCase();
    const icon = SLOT_ICON[slotCat] || "fa-box";
    const img = it?.img ? `<img src="${esc(it.img)}" alt="">` : `<i class="fa-solid ${esc(icon)}" style="font-size:34px; opacity:0.92; color: rgba(241,196,15,0.95);"></i>`;
    const fx = it?.statusEffects && Array.isArray(it.statusEffects) && it.statusEffects.length ? esc(it.statusEffects.join(", ")) : "";
    const fxHtml = fx ? `<div class="uie-item-notes">${fx}</div>` : "";
    const qty = Number.isFinite(Number(it?.qty)) ? Number(it.qty) : (String(it?.qty || "").trim() ? it.qty : "");
    const qtyHtml = qty !== "" && qty !== null && qty !== undefined ? `<div class="uie-item-qty">${esc(qty)}</div>` : "";

    $grid.append(`
      <div class="uie-item ${cls}" data-idx="${idx}" data-view="${esc(viewMode)}">
        <div class="uie-item-iconbadge"><i class="fa-solid ${esc(icon)}"></i></div>
        ${qtyHtml}
        <div class="uie-thumb">${img}</div>
        <div class="uie-item-body">
          <div class="uie-item-name">${esc(it?.name || "Unnamed")}</div>
          <div class="uie-item-sub">
          </div>
          ${fxHtml}
        </div>
      </div>
    `);
  });
}

function bind() {
  const doc = $(document);

  doc.off("input.uieItemsSearch", "#uie-items-search").on("input.uieItemsSearch", "#uie-items-search", () => render());
  doc.off("change.uieItemsCat", "#uie-items-category").on("change.uieItemsCat", "#uie-items-category", () => render());
  doc.off("click.uieItemsCatChip", ".uie-cat-chip").on("click.uieItemsCatChip", ".uie-cat-chip", function(e){
    e.preventDefault();
    e.stopPropagation();
    const cat = String($(this).data("cat") || "all");
    $("#uie-items-category").val(cat);
    render();
  });

  doc.off("click.uieItemsCard", "#uie-items-grid-inner .uie-item").on("click.uieItemsCard", "#uie-items-grid-inner .uie-item", function (e) {
    e.preventDefault();
    e.stopPropagation();

    const idx = Number($(this).data("idx"));
    const editMode = typeof window.UIE_isInventoryEditMode === "function" ? !!window.UIE_isInventoryEditMode() : false;
    if (editMode) {
      if (typeof window.UIE_openItemEditor === "function") window.UIE_openItemEditor(idx);
      return;
    }

    openItemModal(idx, this);
  });

  doc.off("click.uieItemModalClose", "#uie-item-modal-close").on("click.uieItemModalClose", "#uie-item-modal-close", (e) => {
    e.preventDefault(); e.stopPropagation();
    closeItemModal();
  });

  doc.off("click.uieItemModalBackdrop", "#uie-item-modal").on("click.uieItemModalBackdrop", "#uie-item-modal", function (e) {
    if (e.target !== this) return;
    e.preventDefault();
    e.stopPropagation();
    closeItemModal();
  });

  doc.off("click.uieItemUse", "#uie-item-use").on("click.uieItemUse", "#uie-item-use", () => actOnItem("use"));
  doc.off("click.uieItemCustomUse", "#uie-item-custom-use").on("click.uieItemCustomUse", "#uie-item-custom-use", () => actOnItem("custom_use"));
  doc.off("click.uieItemEquip", "#uie-item-equip").on("click.uieItemEquip", "#uie-item-equip", () => actOnItem("equip"));
  doc.off("click.uieItemCustomEquip", "#uie-item-custom-equip").on("click.uieItemCustomEquip", "#uie-item-custom-equip", () => actOnItem("custom_equip"));
  doc.off("click.uieItemDiscard", "#uie-item-discard").on("click.uieItemDiscard", "#uie-item-discard", () => actOnItem("discard"));
  doc.off("click.uieItemSendParty", "#uie-item-send-party").on("click.uieItemSendParty", "#uie-item-send-party", () => actOnItem("send_party"));
}

function closeItemModal() {
  activeIdx = null;
  $("#uie-item-modal").hide();
}

function openItemModal(idx, anchorEl) {
  const s = getSettings();
  ensureModel(s);
  const list = s.inventory.items;
  const it = list[idx];
  if (!it) return;
  activeIdx = idx;
  $("#uie-item-modal").attr("data-mode", "items");

  $("#uie-item-modal-title").text(String(it.name || "Item"));
  $("#uie-item-modal-sub").text(String(it.slotCategory ? titleCase(it.slotCategory) : (it.type || "item")));
  const tags = [];
  if (it.rarity) tags.push(String(it.rarity));
  const fx = Array.isArray(it.statusEffects) ? it.statusEffects : [];
  if (fx.length) tags.push(fx.join(", "));
  if (it.needsUserConfirm) tags.push("UNVERIFIED");
  if (typeof it.confidence === "number") tags.push(`conf ${Math.round(it.confidence * 100)}%`);
  $("#uie-item-modal-tags").text(tags.length ? tags.join(" • ") : "—");
  $("#uie-item-modal-desc").text(String(it.description || it.desc || "No description."));
  const meta = [];
  const slotCat = String(it.slotCategory || "");
  const type = String(it.type || "");
  meta.push(`<div><strong>Category:</strong> ${esc(slotCat ? titleCase(slotCat) : "UNCATEGORIZED")}</div>`);
  meta.push(`<div><strong>Type:</strong> ${esc(type || "—")}</div>`);
  meta.push(`<div><strong>Qty:</strong> ${esc(it.qty ?? 1)}</div>`);
  meta.push(`<div><strong>Status Effects:</strong> ${esc(fx.length ? fx.join(", ") : "—")}</div>`);
  const mods = it.mods && typeof it.mods === "object" ? it.mods : {};
  const modKeys = ["str","dex","int","vit","luk","cha"];
  const modPairs = modKeys
    .map(k => [k, Number(mods?.[k] ?? 0)])
    .filter(([,v]) => Number.isFinite(v) && v !== 0)
    .map(([k,v]) => `${k.toUpperCase()} ${v > 0 ? `+${v}` : `${v}`}`);
  meta.push(`<div><strong>Stat Mods:</strong> ${esc(modPairs.length ? modPairs.join(" • ") : "—")}</div>`);
  const eq = isEquippable(it);
  if (eq) {
    const guess = inferEquipSlotId(it);
    meta.push(`<div><strong>Equip Slot (suggested):</strong> ${esc(guess || "manual")}</div>`);
  }
  $("#uie-item-modal-meta").html(meta.join(""));

  if (it.img) {
    $("#uie-item-modal-icon").html(`<img src="${esc(it.img)}" style="width:100%;height:100%;object-fit:cover;border-radius:16px;">`);
  } else {
    $("#uie-item-modal-icon").html(`<i class="fa-solid fa-box" style="font-size:22px; color: rgba(241,196,15,0.95);"></i>`);
  }

  const equippable = isEquippable(it);
  $("#uie-item-equip").toggle(!!equippable);
  $("#uie-item-custom-equip").toggle(!!equippable);
  const $modal = $("#uie-item-modal");
  const $card = $("#uie-item-modal > div").first();
  $modal.css("display", "flex");
  $modal.css({ alignItems: "stretch", justifyContent: "flex-start", padding: "0" });
  $card.css({
    position: "fixed",
    inset: "auto",
    width: "min(360px, 92vw)",
    maxHeight: "66vh",
    borderRadius: "8px",
  });

  try {
    const a = anchorEl && anchorEl.getBoundingClientRect ? anchorEl.getBoundingClientRect() : null;
    if (!a) return;

    $card.css({ visibility: "hidden", top: "0px", left: "0px" });
    const rect = $card.get(0)?.getBoundingClientRect?.();
    const w = rect?.width || 340;
    const h = rect?.height || 420;
    const vw = window.innerWidth || document.documentElement.clientWidth || 0;
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    const pad = 10;

    const preferRight = (vw - a.right) >= w + pad;
    let left = preferRight ? Math.round(a.right + 10) : Math.round(a.left - w - 10);
    left = Math.max(pad, Math.min(left, vw - w - pad));

    let top = Math.round(a.top + (a.height / 2) - (h / 2));
    top = Math.max(pad, Math.min(top, vh - h - pad));

    $card.css({ left: `${left}px`, top: `${top}px`, visibility: "" });
  } catch (_) {}
}

function logAction(s, entry) {
  if (!s.logs) s.logs = {};
  if (!Array.isArray(s.logs.inventory)) s.logs.inventory = [];
  s.logs.inventory.push({ ts: Date.now(), ...entry });
}

function isEquippable(it) {
  return !!it;
}

function inferEquipSlotId(it) {
  const t = `${String(it?.type || "")} ${String(it?.name || "")} ${String(it?.description || it?.desc || "")}`.toLowerCase();
  if (/(shield|buckler)/.test(t)) return "off";
  if (/(ring)/.test(t)) return "r1";
  if (/(amulet|necklace|torc)/.test(t)) return "neck";
  if (/(helmet|helm|hood|crown|hat)/.test(t)) return "head";
  if (/(boots|shoe|greaves)/.test(t)) return "feet";
  if (/(glove|gauntlet)/.test(t)) return "hands";
  if (/(pants|trouser|leggings)/.test(t)) return "legs";
  if (/(chest|armor|plate|mail|robe|tunic|shirt)/.test(t)) return "chest";
  if (/(cloak|cape)/.test(t)) return "cloak";
  if (/(belt|strap)/.test(t)) return "belt";
  if (/(socks)/.test(t)) return "socks";
  if (/(undies|underwear)/.test(t)) return "undies";
  if (/(wand|staff|orb|focus|talisman)/.test(t)) return "focus";
  if (/(weapon|sword|dagger|bow|crossbow|mace|hammer|spear|axe|blade)/.test(t)) return "main";
  return "";
}

function equipItemToSlot(s, item, slotId) {
  if (!s.inventory) s.inventory = {};
  if (!Array.isArray(s.inventory.items)) s.inventory.items = [];
  if (!Array.isArray(s.inventory.equipped)) s.inventory.equipped = [];
  const sid = String(slotId || "").trim();
  if (!sid) return { ok: false, reason: "No slot selected." };

  const idxExisting = s.inventory.equipped.findIndex(e => String(e?.slotId || "") === sid);
  if (idxExisting >= 0) {
    const prev = { ...s.inventory.equipped[idxExisting] };
    delete prev.slotId;
    s.inventory.items.push(prev);
    s.inventory.equipped.splice(idxExisting, 1);
  }

  const put = { ...item, slotId: sid };
  s.inventory.equipped.push(put);
  return { ok: true };
}

function takeOneFromStack(list, idx) {
  const it = list[idx];
  if (!it || typeof it !== "object") return null;
  const q = Number(it.qty || 1);
  if (Number.isFinite(q) && q > 1) {
    it.qty = q - 1;
    return { ...it, qty: 1 };
  }
  list.splice(idx, 1);
  return { ...it, qty: 1 };
}

async function actOnItem(kind) {
  const s = getSettings();
  ensureModel(s);
  const idx = Number(activeIdx);
  const list = s.inventory.items;
  const it = list[idx];
  if (!it) return;

  const name = String(it.name || "Item");

  if (kind === "custom_use") {
    const note = prompt("Custom Use (what happened?)") || "";
    const msg = String(note || "").trim() ? `Custom use: ${name} — ${String(note).trim()}` : `Custom use: ${name}`;
    logAction(s, { action: "custom_use", item: name, note: String(note).slice(0, 500) });
    saveSettings();
    closeItemModal();
    await injectRpEvent(msg, { uie: { type: "custom_use", item: name } });
    return;
  }

  if (kind === "custom_equip") {
    const slotGuess = inferEquipSlotId(it) || "main";
    const slotId = (prompt("Equip slot? (examples: head, chest, legs, feet, hands, neck, main, off, cloak, belt, r1, r2, focus)", slotGuess) || "").trim();
    if (!slotId) return;
    const note = prompt("Custom Equip (what happened?)") || "";
    const one = takeOneFromStack(list, idx);
    if (!one) return;
    const out = equipItemToSlot(s, one, slotId);
    if (!out.ok) return;
    logAction(s, { action: "custom_equip", item: name, slotId, note: String(note).slice(0, 500) });
    saveSettings();
    closeItemModal();
    render();
    try { const mod = await import("./equipment_rpg.js"); if (mod?.render) mod.render(); } catch (_) {}
    const msg = String(note || "").trim()
      ? `[System: User equipped ${name}. Stats updated.] (${String(note).trim()})`
      : `[System: User equipped ${name}. Stats updated.]`;
    await injectRpEvent(msg);
    return;
  }

  if (kind === "equip") {
    let slotId = inferEquipSlotId(it);
    if (!slotId) slotId = (prompt("Equip slot? (examples: head, chest, legs, feet, hands, neck, main, off, cloak, belt, r1, r2, focus)", "main") || "").trim();
    if (!slotId) return;
    const one = takeOneFromStack(list, idx);
    if (!one) return;
    const out = equipItemToSlot(s, one, slotId);
    if (!out.ok) return;
    logAction(s, { action: "equip", item: name, slotId });
    saveSettings();
    closeItemModal();
    render();
    try { const mod = await import("./equipment_rpg.js"); if (mod?.render) mod.render(); } catch (_) {}
    await injectRpEvent(`[System: User equipped ${name}. Stats updated.]`);
    return;
  }

  if (kind === "discard") {
    if (!confirm(`Discard ${name}?`)) return;
    logAction(s, { action: "discard", item: name });
    list.splice(idx, 1);
    saveSettings();
    closeItemModal();
    render();
    await injectRpEvent(`Discarded ${name}.`, { uie: { type: "discard", item: name } });
    return;
  }

  if (kind === "send_party") {
    if (!s.party) s.party = { members: [], sharedItems: [] };
    if (!Array.isArray(s.party.sharedItems)) s.party.sharedItems = [];
    let qty = 1;
    const cur = Number(it.qty || 1);
    if (Number.isFinite(cur) && cur > 1) {
      const raw = String(prompt("Send how many to party? (number or 'all')", "1") || "").trim().toLowerCase();
      if (!raw) return;
      if (raw === "all") qty = cur;
      else {
        const qn = Number(raw);
        if (!Number.isFinite(qn) || qn <= 0) return;
        qty = Math.min(cur, Math.floor(qn));
      }
    }

    const moved = [];
    for (let i = 0; i < qty; i++) {
      const one = takeOneFromStack(list, idx);
      if (!one) break;
      moved.push(one);
    }
    if (!moved.length) return;

    const base = moved[0];
    const keyName = String(base?.name || name);
    const keyType = String(base?.type || it.type || "");
    const existing = s.party.sharedItems.find(x => String(x?.name || "") === keyName && String(x?.type || "") === keyType);
    if (existing) existing.qty = Number(existing.qty || 1) + moved.length;
    else s.party.sharedItems.push({ ...base, qty: moved.length });

    logAction(s, { action: "send_party", item: name, qty: moved.length });
    saveSettings();
    closeItemModal();
    render();
    await injectRpEvent(`Sent ${moved.length}x ${name} to the party stash.`, { uie: { type: "send_party", item: name, qty: moved.length } });
    return;
  }

  const consumes = !!it?.use?.consumes;
  const note = consumes ? "consumed" : "";
  logAction(s, { action: "use", item: name, note });
  if (consumes) {
    const q = Number(it.qty || 1);
    it.qty = Math.max(0, q - 1);
    if (it.qty <= 0) list.splice(idx, 1);
  }
  saveSettings();
  closeItemModal();
  render();
  if (consumes) {
    const eff = String(it?.use?.desc || it?.desc || it?.effect || it?.description || "").trim().slice(0, 220) || "—";
    await injectRpEvent(`[System: User consumed ${name}. Effect: ${eff}.]`);
  } else {
    await injectRpEvent(`[System: User used ${name}.]`);
  }
}
