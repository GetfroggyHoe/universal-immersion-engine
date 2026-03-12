import { getSettings, saveSettings } from "../core.js";
import { generateContent } from "../apiClient.js";
import { getContext } from "/scripts/extensions.js";
import { SLOT_TYPES_CORE } from "../slot_types_core.js";
import { inferItemType } from "../slot_types_infer.js";
import { injectRpEvent } from "./rp_log.js";
import {
  INVENTORY_STACK_LIMIT,
  addInventoryItemWithStack,
  addManyInventoryItemsWithStack,
  ensureOpenableContents,
  isBookItem,
  isContainerItem,
  isOpenableItem,
  normalizeInventoryStacksInPlace,
  summarizeItemsForLog,
} from "../inventoryItems.js";

let mounted = false;
let activeIdx = null;
let viewMode = "items";
let genNeedsConfirm = false;

export function init() {
  const $root = $("#uie-items-root");
  if (!$root.length) return;
  if (mounted) {
    try { render(); } catch (_) {}
    return;
  }
  mounted = true;
  try { bind(); } catch (_) {}
  try { render(); } catch (_) {}
}

function ensureModel(s) {
  if (!s) return;
  if (!s.inventory) s.inventory = {};
  if (!Array.isArray(s.inventory.items)) s.inventory.items = [];
  if (!Array.isArray(s.inventory.skills)) s.inventory.skills = [];
  if (!Array.isArray(s.inventory.assets)) s.inventory.assets = [];
  if (!Array.isArray(s.inventory.statuses)) s.inventory.statuses = [];
  try { normalizeInventoryStacksInPlace(s.inventory.items, { source: "items_module" }); } catch (_) {}
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

function closeBookReader() {
  $("#uie-item-reader-modal").hide();
}

function openBookReader(title, text) {
  const safeTitle = String(title || "Book").trim() || "Book";
  const safeText = String(text || "").trim() || "(This book has no readable text yet.)";
  $("#uie-item-reader-title").text(safeTitle);
  $("#uie-item-reader-body").text(safeText);
  $("#uie-item-reader-modal").css("display", "flex");
}

function consumeOneFromStack(list, idx) {
  const it = list[idx];
  if (!it || typeof it !== "object") return false;
  const q = Number(it.qty || 1);
  if (Number.isFinite(q) && q > 1) {
    it.qty = q - 1;
    return true;
  }
  list.splice(idx, 1);
  return true;
}

async function ensureBookText(it) {
  if (!it || typeof it !== "object") return null;
  if (!it.book || typeof it.book !== "object") {
    it.book = {
      title: String(it.name || "Book").trim().slice(0, 120) || "Book",
      text: "",
      generatedAt: Date.now(),
      source: "item_open",
    };
  }

  if (String(it.book.text || "").trim()) return it.book;

  const itemName = String(it.name || "Book").trim().slice(0, 120) || "Book";
  const itemType = String(it.type || "Book").trim().slice(0, 80) || "Book";
  const itemDesc = String(it.description || it.desc || "").trim().slice(0, 1200);
  const context = String(chatSnippet() || "").trim().slice(0, 2400);

  let title = String(it.book.title || itemName || "Book").trim().slice(0, 120) || "Book";
  let text = String(it.book.text || "").trim();

  const prompt = `Return ONLY JSON object:\n{"title":"","text":""}\n\nTask: Write the readable in-world content of a physical item book.\nBook item:\n- Name: ${itemName}\n- Type: ${itemType}\n- Description: ${itemDesc || "(none)"}\n\nRules:\n- Match the setting and tone of the context.\n- 3-8 short paragraphs or bullet notes.\n- Max 1800 characters.\n- No markdown code fences.\n\nContext excerpt:\n${context || "(no context)"}`;

  try {
    const res = await generateContent(prompt.slice(0, 6000), "System Check");
    const cleaned = String(res || "").replace(/```json|```/g, "").trim();
    if (cleaned) {
      try {
        const obj = JSON.parse(cleaned);
        if (obj && typeof obj === "object") {
          title = String(obj.title || title || itemName || "Book").trim().slice(0, 120) || "Book";
          text = String(obj.text || obj.content || "").trim();
        }
      } catch (_) {
        text = cleaned;
      }
    }
  } catch (_) {}

  if (!text) {
    text = itemDesc
      ? `Title: ${title}\n\n${itemDesc}`
      : `${title}\n\nThe pages are mostly blank, but a few faint lines suggest this text has weathered many journeys.`;
  }

  it.book = {
    title,
    text: String(text).trim().slice(0, 12000),
    generatedAt: Number(it.book.generatedAt || Date.now()) || Date.now(),
    source: String(it.book.source || "item_open").trim().slice(0, 40) || "item_open",
  };

  return it.book;
}

function openContainerAndLoot(list, idx, it) {
  const hint = `${String(it?.description || it?.desc || "")}\n${String(chatSnippet() || "").slice(0, 1600)}`;
  const contents = ensureOpenableContents(it, hint);
  const loot = Array.isArray(contents) ? contents : [];

  if (it?.openable && typeof it.openable === "object") {
    it.openable.openedCount = Math.max(0, Number(it.openable.openedCount || 0)) + 1;
    it.openable.lastOpenedAt = Date.now();
  }

  const out = addManyInventoryItemsWithStack(list, loot, {
    source: "container_open",
    chatHint: hint,
  });

  consumeOneFromStack(list, idx);
  return {
    loot,
    addedQty: Number(out?.addedQty || 0),
    addedStacks: Number(out?.addedStacks || 0),
    stackedQty: Number(out?.stackedQty || 0),
  };
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
  let cat = String(inferred?.category || "UNCATEGORIZED").toUpperCase();
  if (cat === "UNCATEGORIZED" && isBookItem(it) && inferred?.source !== "disabled") {
    cat = "KNOWLEDGE";
  }
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
  $sel.append(new Option("All", "all"));
  keys.forEach((k) => $sel.append(new Option(titleCase(k), k.toLowerCase())));
  $sel.val(cur);

  $chips.empty();
  const chipTemplate = document.getElementById("uie-cat-chip-template");

  const addChip = (cat, title, icon) => {
    const clone = chipTemplate.content.cloneNode(true);
    const $btn = $(clone).find("button");
    $btn.attr("data-cat", cat).attr("title", title);
    $btn.find("i").addClass(icon);
    $chips.append($btn);
  };

  addChip("all", "All", "fa-layer-group");
  keys.forEach((k) => {
    addChip(k.toLowerCase(), titleCase(k), SLOT_ICON[k] || "fa-tags");
  });
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
  const $root = $("#uie-items-root");
  if (!$grid.length) return;
  if ($root.length) {
    $root.css({ display: "flex", flexDirection: "column", minHeight: "120px", overflow: "auto" });
  }
  $grid.css({ display: "flex", flexWrap: "wrap", gap: "10px", alignContent: "flex-start", minWidth: "0" });

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

  const cardTemplate = document.getElementById("uie-item-card-template");

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

    const clone = cardTemplate.content.cloneNode(true);
    const $el = $(clone).find(".uie-item");

    $el.addClass(cls).attr("data-idx", idx).attr("data-view", viewMode);
    $el.find(".uie-item-iconbadge i").addClass(icon);

    // Qty
    const qty = Number.isFinite(Number(it?.qty)) ? Number(it.qty) : (String(it?.qty || "").trim() ? it.qty : "");
    if (qty !== "" && qty !== null && qty !== undefined) {
        $el.find(".uie-item-qty").text(qty);
    } else {
        $el.find(".uie-item-qty").remove();
    }

    // Thumb
    const $thumb = $el.find(".uie-thumb");
    if (it?.img) {
        $("<img>").attr("src", it.img).attr("alt", "").appendTo($thumb);
    } else {
        $("<i>").addClass(`fa-solid ${icon}`).css({fontSize:"34px", opacity:"0.92", color:"rgba(241,196,15,0.95)"}).appendTo($thumb);
    }

    // Body
    $el.find(".uie-item-name").text(it?.name || "Unnamed");

    // Notes/FX
    const fx = it?.statusEffects && Array.isArray(it.statusEffects) && it.statusEffects.length ? it.statusEffects.join(", ") : "";
    if (fx) {
        $el.find(".uie-item-notes").text(fx);
    } else {
        $el.find(".uie-item-notes").remove();
    }

    $grid.append($el);
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

  doc.off("contextmenu.uieItemsCard", "#uie-items-grid-inner .uie-item").on("contextmenu.uieItemsCard", "#uie-items-grid-inner .uie-item", function (e) {
    e.preventDefault();
    e.stopPropagation();
    const idx = Number($(this).data("idx"));
    openItemContextMenu(idx, e.clientX, e.clientY);
  });

  doc.off("click.uieItemModalClose", "#uie-item-modal-close").on("click.uieItemModalClose", "#uie-item-modal-close", (e) => {
    e.preventDefault(); 
    e.stopPropagation();
    e.stopImmediatePropagation();
    closeItemModal();
  });

  doc.off("click.uieItemModalBackdrop", "#uie-item-modal").on("click.uieItemModalBackdrop", "#uie-item-modal", function (e) {
    if (e.target !== this) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    closeItemModal();
  });

  doc.off("click.uieItemUse", "#uie-item-use").on("click.uieItemUse", "#uie-item-use", () => actOnItem("use"));
  doc.off("click.uieItemOpen", "#uie-item-open").on("click.uieItemOpen", "#uie-item-open", () => actOnItem("open"));
  doc.off("click.uieItemCustomUse", "#uie-item-custom-use").on("click.uieItemCustomUse", "#uie-item-custom-use", () => actOnItem("custom_use"));
  doc.off("click.uieItemUseChat", "#uie-item-use-chat").on("click.uieItemUseChat", "#uie-item-use-chat", () => actOnItem("use_chat"));

  doc.off("click.uieCtxItem", ".uie-ctx-item").on("click.uieCtxItem", ".uie-ctx-item", function(e) {
      e.preventDefault(); e.stopPropagation();
      const act = $(this).data("action");
      const idx = Number($(this).data("idx"));
      if (Number.isFinite(idx)) activeIdx = idx;
      if (act) actOnItem(act);
      $(".uie-ctx-menu-overlay").remove();
  });

  doc.off("click.uieItemEquip", "#uie-item-equip").on("click.uieItemEquip", "#uie-item-equip", () => actOnItem("equip"));
  doc.off("click.uieItemCustomEquip", "#uie-item-custom-equip").on("click.uieItemCustomEquip", "#uie-item-custom-equip", () => actOnItem("custom_equip"));
  doc.off("click.uieItemDiscard", "#uie-item-discard").on("click.uieItemDiscard", "#uie-item-discard", () => actOnItem("discard"));
  doc.off("click.uieItemSendParty", "#uie-item-send-party").on("click.uieItemSendParty", "#uie-item-send-party", () => actOnItem("send_party"));

  doc.off("click.uieItemReaderClose", "#uie-item-reader-close").on("click.uieItemReaderClose", "#uie-item-reader-close", (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeBookReader();
  });
  doc.off("click.uieItemReaderBackdrop", "#uie-item-reader-modal").on("click.uieItemReaderBackdrop", "#uie-item-reader-modal", function (e) {
    if (e.target !== this) return;
    e.preventDefault();
    e.stopPropagation();
    closeBookReader();
  });
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
  if (isContainerItem(it)) {
    const count = Array.isArray(it?.openable?.contents) ? it.openable.contents.length : 0;
    meta.push(`<div><strong>Openable:</strong> ${esc(count > 0 ? `${count} cached loot entries` : "Yes")}</div>`);
  }
  if (isBookItem(it)) {
    const title = String(it?.book?.title || it?.name || "Book").trim().slice(0, 120) || "Book";
    meta.push(`<div><strong>Readable Book:</strong> ${esc(title)}</div>`);
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
  const openable = isOpenableItem(it);
  const readableBook = isBookItem(it);
  $("#uie-item-open")
    .text(readableBook ? "Read" : "Open")
    .toggle(openable || readableBook);
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

    const mobileNow = (() => {
      try {
        const touch = (typeof navigator !== "undefined" && Number(navigator.maxTouchPoints || 0) > 0);
        return touch || (vw > 0 && vw <= 820);
      } catch (_) {
        return false;
      }
    })();

    const preferRight = (vw - a.right) >= w + pad;
    let left = preferRight ? Math.round(a.right + 10) : Math.round(a.left - w - 10);
    left = Math.max(pad, Math.min(left, vw - w - pad));

    let top = Math.round(a.top + (a.height / 2) - (h / 2));
    if (mobileNow) top = Math.round(top + (vh * 0.30));
    top = Math.max(pad, Math.min(top, vh - h - pad));

    $card.css({ left: `${left}px`, top: `${top}px`, visibility: "" });
  } catch (_) {}
}

function openItemContextMenu(idx, x, y) {
  const s = getSettings();
  ensureModel(s);
  const list = s.inventory.items;
  const it = list[idx];
  if (!it) return;

  // Remove existing
  $(".uie-ctx-menu-overlay").remove();

  const overlay = $(`<div class="uie-ctx-menu-overlay" style="position:fixed; inset:0; z-index:2147483660; cursor:default;"></div>`);
  const menu = $(`<div class="uie-ctx-menu" style="position:absolute; background:rgba(15,10,8,0.98); border:1px solid rgba(255,255,255,0.15); border-radius:8px; padding:6px; min-width:140px; box-shadow:0 4px 12px rgba(0,0,0,0.5); display:flex; flex-direction:column; gap:2px;"></div>`);

  const mkBtn = (lbl, act, icon, color="#fff") => {
      return $(`<div class="uie-ctx-item" data-action="${act}" data-idx="${idx}" style="padding:8px 12px; border-radius:6px; cursor:pointer; display:flex; align-items:center; gap:8px; color:${color}; font-weight:600; font-size:13px;">
        <i class="fa-solid ${icon}" style="width:20px; text-align:center; opacity:0.8;"></i> ${lbl}
      </div>`).hover(
          function(){ $(this).css("background", "rgba(255,255,255,0.1)"); },
          function(){ $(this).css("background", "transparent"); }
      );
  };

  menu.append(mkBtn("Inspect", "inspect", "fa-circle-info"));
  if (isOpenableItem(it) || isBookItem(it)) {
    menu.append(mkBtn(isBookItem(it) ? "Read" : "Open", "open", isBookItem(it) ? "fa-book-open" : "fa-box-open"));
  }
  menu.append(mkBtn("Use", "use", "fa-hand-sparkles"));
  menu.append(mkBtn("Use (Chat)", "use_chat", "fa-comment-dots"));

  if (isEquippable(it)) {
      menu.append(mkBtn("Equip", "equip", "fa-shield-halved"));
      menu.append(mkBtn("Custom Equip", "custom_equip", "fa-pen-ruler"));
  }

  menu.append(mkBtn("Send to Party", "send_party", "fa-users"));

  // Separator
  menu.append($(`<div style="height:1px; background:rgba(255,255,255,0.1); margin:4px 0;"></div>`));

  menu.append(mkBtn("Discard", "discard", "fa-trash", "#e74c3c"));

  // Positioning
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  // Temporary append to measure
  menu.css({ visibility: "hidden" }).appendTo(document.body);
  const mw = 160; // Approx
  const mh = 240; // Approx
  menu.detach();
  menu.css({ visibility: "" });

  let left = x;
  let top = y;

  try {
    const touch = (typeof navigator !== "undefined" && Number(navigator.maxTouchPoints || 0) > 0);
    const mobileNow = touch || (vw > 0 && vw <= 820);
    if (mobileNow) top = Math.round(top + (vh * 0.30));
  } catch (_) {}

  if (left + mw > vw) left = x - mw;
  if (top + mh > vh) top = y - mh;

  const pad = 10;
  left = Math.max(pad, Math.min(left, vw - mw - pad));
  top = Math.max(pad, Math.min(top, vh - mh - pad));

  menu.css({ left: left + "px", top: top + "px" });

  overlay.append(menu);
  $("body").append(overlay);
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
    addInventoryItemWithStack(s.inventory.items, prev, { source: "unequip_swap" });
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

  try {
    const confirmKinds = new Set(["use", "use_chat", "custom_use", "equip", "custom_equip", "send_party", "open"]);
    if (it.needsUserConfirm && confirmKinds.has(String(kind || ""))) {
      const ok = confirm(`${name} is marked as UNVERIFIED. Continue?`);
      if (!ok) return;
      it.needsUserConfirm = false;
      saveSettings();
    }
  } catch (_) {}

  if (kind === "inspect") {
    openItemModal(idx);
    return;
  }

  if (kind === "open") {
    if (isBookItem(it)) {
      const book = await ensureBookText(it);
      logAction(s, { action: "read", item: name });
      saveSettings();
      openBookReader(book?.title || name, book?.text || it.description || "(No readable text)");
      return;
    }

    if (isContainerItem(it)) {
      const out = openContainerAndLoot(list, idx, it);
      logAction(s, { action: "open", item: name, qty: Number(out?.addedQty || 0) });
      saveSettings();
      closeItemModal();
      render();

      const lootLine = summarizeItemsForLog(out?.loot || [], 4);
      const addedQty = Number(out?.addedQty || 0);
      if (addedQty > 0) {
        try { window.toastr?.success?.(`Opened ${name}: ${lootLine}`); } catch (_) {}
      } else {
        try { window.toastr?.info?.(`${name} was empty.`); } catch (_) {}
      }
      try { await injectRpEvent(`[System: Opened ${name}. Loot: ${lootLine}.]`); } catch (_) {}
      return;
    }
  }

  if (kind === "use_chat") {
    const consumes = !!it?.use?.consumes;
    const eff = String(it?.use?.desc || it?.desc || it?.effect || it?.description || "").trim().slice(0, 220) || "";
    let msg = `*uses ${name}*`;
    if (consumes && eff) msg += `\n(Effect: ${eff})`;

    // Log internally
    logAction(s, { action: "use_chat", item: name, note: consumes ? "consumed" : "" });

    // Consume
    if (consumes) {
        const q = Number(it.qty || 1);
        it.qty = Math.max(0, q - 1);
        if (it.qty <= 0) list.splice(idx, 1);
    }

    saveSettings();
    closeItemModal();
    render();

    // Send to Chat
    const textarea = document.getElementById("send_textarea");
    if (textarea) {
        textarea.value = msg;
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
        const sendBtn = document.getElementById("send_but");
        if (sendBtn) sendBtn.click();
    }
    return;
  }

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
    try { const mod = await import("./equipment.js"); if (mod?.render) mod.render(); } catch (_) {}
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
    try { const mod = await import("./equipment.js"); if (mod?.render) mod.render(); } catch (_) {}
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
    let remaining = moved.length;
    const shared = Array.isArray(s.party.sharedItems) ? s.party.sharedItems : [];
    for (const row of shared) {
      if (remaining <= 0) break;
      const same = String(row?.name || "") === keyName && String(row?.type || "") === keyType;
      if (!same) continue;
      const cur = Math.max(0, Math.floor(Number(row.qty || 0)));
      const room = Math.max(0, INVENTORY_STACK_LIMIT - cur);
      if (!room) continue;
      const put = Math.min(room, remaining);
      row.qty = cur + put;
      remaining -= put;
    }
    while (remaining > 0) {
      const put = Math.min(INVENTORY_STACK_LIMIT, remaining);
      shared.push({ ...base, qty: put });
      remaining -= put;
    }

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
