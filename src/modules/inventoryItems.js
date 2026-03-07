import { inferItemType } from "./slot_types_infer.js";

export const INVENTORY_STACK_LIMIT = 999;

const ALLOWED_RARITIES = new Set(["common", "uncommon", "rare", "epic", "legendary"]);

const BOOK_TOKEN_RE = /\b(book|tome|grimoire|codex|manual|journal|diary|notebook|logbook|field\s*notes?|scroll|ledger)\b/i;
const CONTAINER_TOKEN_RE = /\b(chest|crate|cache|stash|bag|satchel|pack|duffel|locker|coffer|case|container|loot\s*box|supply\s*box)\b/i;
const EQUIPMENT_TOKEN_RE = /\b(weapon|armor|armour|shield|helmet|helm|boots?|gauntlet|gloves?|ring|amulet|necklace|cloak|robe|sword|blade|dagger|axe|bow|crossbow|spear|mace|staff|wand|pistol|rifle|smg|shotgun)\b/i;

function clipText(value, max = 600) {
  return String(value ?? "").trim().slice(0, Math.max(1, Number(max) || 1));
}

function normKey(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function asFinite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizedRarity(value) {
  const r = normKey(value || "common");
  return ALLOWED_RARITIES.has(r) ? r : "common";
}

function cloneJsonSafe(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_) {
    return null;
  }
}

function clampQty(value, { fallback = 1, cap = INVENTORY_STACK_LIMIT } = {}) {
  const raw = Number(value);
  const base = Number.isFinite(raw) ? Math.floor(raw) : Math.floor(Number(fallback) || 1);
  const out = Math.max(1, base);
  if (!Number.isFinite(Number(cap)) || cap <= 0) return out;
  return Math.min(out, Math.floor(cap));
}

function normalizeStatusEffects(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const v of raw) {
    const t = clipText(v, 60);
    const k = normKey(t);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= 12) break;
  }
  return out;
}

function normalizeMods(raw) {
  if (!raw || typeof raw !== "object") return {};
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    const key = clipText(k, 20);
    const n = Number(v);
    if (!key || !Number.isFinite(n)) continue;
    out[key] = n;
  }
  return out;
}

function isCurrencyItem(item) {
  return normKey(item?.type) === "currency";
}

function bookLikeFromBlob(blob) {
  return BOOK_TOKEN_RE.test(String(blob || ""));
}

function containerLikeFromBlob(blob) {
  return CONTAINER_TOKEN_RE.test(String(blob || ""));
}

function equipmentLikeFromBlob(blob) {
  return EQUIPMENT_TOKEN_RE.test(String(blob || ""));
}

export function isBookItem(item) {
  if (!item || typeof item !== "object") return false;
  if (item.book && typeof item.book === "object") return true;
  const blob = `${item.name || ""} ${item.type || ""} ${item.description || item.desc || ""}`;
  return bookLikeFromBlob(blob);
}

export function isContainerItem(item) {
  if (!item || typeof item !== "object") return false;
  if (item.openable && typeof item.openable === "object" && String(item.openable.kind || "").toLowerCase() === "container") return true;
  const blob = `${item.name || ""} ${item.type || ""} ${item.description || item.desc || ""}`;
  return containerLikeFromBlob(blob);
}

export function isOpenableItem(item) {
  return isContainerItem(item);
}

export function isEquipmentItem(item) {
  if (!item || typeof item !== "object") return false;
  const blob = `${item.name || ""} ${item.type || ""} ${item.description || item.desc || ""}`;
  return equipmentLikeFromBlob(blob);
}

function normalizeBookPayload(rawBook, item, nowTs) {
  if (rawBook && typeof rawBook === "object") {
    const title = clipText(rawBook.title || item.name || "Book", 120) || "Book";
    const text = clipText(rawBook.text || rawBook.content || "", 12000);
    return {
      title,
      text,
      generatedAt: Number(rawBook.generatedAt || nowTs) || nowTs,
      source: clipText(rawBook.source || "item", 40) || "item",
    };
  }

  if (typeof rawBook === "string" && rawBook.trim()) {
    return {
      title: clipText(item?.name || "Book", 120) || "Book",
      text: clipText(rawBook, 12000),
      generatedAt: nowTs,
      source: "item",
    };
  }

  return {
    title: clipText(item?.name || "Book", 120) || "Book",
    text: "",
    generatedAt: nowTs,
    source: "item",
  };
}

function normalizeOpenablePayload(rawOpenable, item, options = {}) {
  const nowTs = Number(options.now || Date.now()) || Date.now();
  const openable = rawOpenable && typeof rawOpenable === "object" ? rawOpenable : {};
  const provided = Array.isArray(openable.contents)
    ? openable.contents
    : (Array.isArray(options.contents) ? options.contents : []);

  const normalizedContents = [];
  for (const entry of provided) {
    const norm = normalizeInventoryItem(entry, {
      now: nowTs,
      depth: Math.max(1, Number(options.depth || 0) + 1),
      forceContainer: false,
      forceBook: false,
      chatHint: options.chatHint || "",
    });
    if (!norm || !norm.name) continue;
    normalizedContents.push(norm);
    if (normalizedContents.length >= 24) break;
  }

  return {
    kind: "container",
    containerType: clipText(openable.containerType || item.type || "Container", 80) || "Container",
    seededAt: Number(openable.seededAt || nowTs) || nowTs,
    openedCount: Math.max(0, Math.floor(asFinite(openable.openedCount, 0))),
    source: clipText(openable.source || options.source || "loot", 60) || "loot",
    theme: clipText(openable.theme || options.theme || "", 40),
    contents: normalizedContents,
  };
}

export function normalizeInventoryItem(rawItem, options = {}) {
  const nowTs = Number(options.now || Date.now()) || Date.now();
  const depth = Math.max(0, Math.floor(Number(options.depth || 0)));

  let src = rawItem;
  if (typeof src === "string") src = { name: src };
  if (!src || typeof src !== "object") return null;

  const name = clipText(src.name || src.title || src.item || "", 120);
  if (!name) return null;

  const type = clipText(src.type || src.category || src.kind || "Item", 80) || "Item";
  const isCurrency = normKey(type) === "currency";

  const item = {
    kind: "item",
    name,
    type,
    description: clipText(src.description || src.desc || "", 1600),
    rarity: normalizedRarity(src.rarity || "common"),
    qty: isCurrency
      ? Math.max(0, Math.floor(asFinite(src.qty, 0)))
      : clampQty(src.qty, { fallback: 1, cap: INVENTORY_STACK_LIMIT }),
    img: clipText(src.img || "", 1200),
    slotCategory: clipText(src.slotCategory || "", 60),
    tags: Array.isArray(src.tags) ? src.tags.map((x) => clipText(x, 30)).filter(Boolean).slice(0, 16) : [],
    statusEffects: normalizeStatusEffects(src.statusEffects),
    mods: normalizeMods(src.mods),
    _meta: (src._meta && typeof src._meta === "object")
      ? {
          ...src._meta,
          source: clipText(src._meta.source || options.source || src._meta.source || "", 60),
          createdAt: Number(src._meta.createdAt || nowTs) || nowTs,
          updatedAt: Number(src._meta.updatedAt || nowTs) || nowTs,
        }
      : {
          source: clipText(options.source || "", 60),
          createdAt: nowTs,
          updatedAt: nowTs,
        },
  };

  if (isCurrency) {
    item.symbol = clipText(src.symbol || "", 10);
  }

  const forceBook = options.forceBook === true;
  const forceContainer = options.forceContainer === true && depth === 0;

  if (forceBook || isBookItem({ ...item, book: src.book })) {
    item.type = clipText(src.type || "Book", 80) || "Book";
    item.book = normalizeBookPayload(src.book, item, nowTs);
    if (!String(item.slotCategory || "").trim()) {
      const inferred = inferItemType(item);
      const cat = clipText(inferred?.category || "", 60).toUpperCase();
      if (cat && cat !== "UNCATEGORIZED") item.slotCategory = cat;
      else if (inferred?.source !== "disabled") item.slotCategory = "KNOWLEDGE";
    }
  }

  if (forceContainer || (depth === 0 && isContainerItem({ ...item, openable: src.openable }))) {
    item.openable = normalizeOpenablePayload(src.openable, item, {
      now: nowTs,
      depth,
      source: item?._meta?.source || options.source || "loot",
      theme: options.theme || "",
      chatHint: options.chatHint || "",
      contents: Array.isArray(options.contents) ? options.contents : undefined,
    });
  }

  return item;
}

export function canStackInventoryItem(item) {
  if (!item || typeof item !== "object") return false;
  if (isCurrencyItem(item)) return true;
  if (isOpenableItem(item)) return false;
  if (isBookItem(item)) return false;
  if (item.stackable === false) return false;
  return true;
}

function stableStringifyObject(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return "";
  const keys = Object.keys(input).sort();
  const out = {};
  for (const k of keys) out[k] = input[k];
  try {
    return JSON.stringify(out);
  } catch (_) {
    return "";
  }
}

function stackSignature(item) {
  const modsSig = stableStringifyObject(item?.mods || {});
  const fxSig = Array.isArray(item?.statusEffects)
    ? item.statusEffects.map((x) => normKey(x)).filter(Boolean).sort().join("|")
    : "";
  const tagsSig = Array.isArray(item?.tags)
    ? item.tags.map((x) => normKey(x)).filter(Boolean).sort().join("|")
    : "";
  const slot = normKey(item?.slotCategory || "");
  const symbol = normKey(item?.symbol || "");
  return [
    normKey(item?.name || ""),
    normKey(item?.type || ""),
    normKey(item?.rarity || "common"),
    slot,
    symbol,
    modsSig,
    fxSig,
    tagsSig,
  ].join("::");
}

export function addInventoryItemWithStack(list, rawItem, options = {}) {
  if (!Array.isArray(list)) return { addedStacks: 0, addedQty: 0, stackedQty: 0 };

  const item = normalizeInventoryItem(rawItem, options);
  if (!item || !item.name) return { addedStacks: 0, addedQty: 0, stackedQty: 0 };

  const canStack = canStackInventoryItem(item);
  const noCap = isCurrencyItem(item);
  const cap = noCap ? Number.POSITIVE_INFINITY : INVENTORY_STACK_LIMIT;
  let remaining = noCap
    ? Math.max(0, Math.floor(asFinite(item.qty, 0)))
    : clampQty(item.qty, { fallback: 1, cap: INVENTORY_STACK_LIMIT });

  if (!canStack) {
    list.push(item);
    return { addedStacks: 1, addedQty: Math.max(1, remaining), stackedQty: 0 };
  }

  const sig = stackSignature(item);
  let addedStacks = 0;
  let stackedQty = 0;
  let addedQty = 0;

  while (remaining > 0) {
    let target = null;
    for (const candidate of list) {
      if (!candidate || typeof candidate !== "object") continue;
      if (!canStackInventoryItem(candidate)) continue;
      if (stackSignature(candidate) !== sig) continue;
      const q = Math.max(0, Math.floor(asFinite(candidate.qty, 0)));
      if (q >= cap) continue;
      target = candidate;
      break;
    }

    if (!target) {
      const put = noCap ? remaining : Math.min(INVENTORY_STACK_LIMIT, remaining);
      const next = { ...cloneJsonSafe(item), qty: put };
      list.push(next);
      addedStacks += 1;
      addedQty += put;
      remaining -= put;
      continue;
    }

    const cur = Math.max(0, Math.floor(asFinite(target.qty, 0)));
    const room = cap - cur;
    const put = Math.max(0, Math.min(room, remaining));
    if (put <= 0) break;
    target.qty = cur + put;
    stackedQty += put;
    addedQty += put;
    remaining -= put;
  }

  return { addedStacks, addedQty, stackedQty };
}

export function addManyInventoryItemsWithStack(list, rawItems, options = {}) {
  const arr = Array.isArray(rawItems) ? rawItems : [];
  let addedStacks = 0;
  let addedQty = 0;
  let stackedQty = 0;
  for (const it of arr) {
    const out = addInventoryItemWithStack(list, it, options);
    addedStacks += Number(out?.addedStacks || 0);
    addedQty += Number(out?.addedQty || 0);
    stackedQty += Number(out?.stackedQty || 0);
  }
  return { addedStacks, addedQty, stackedQty };
}

export function normalizeInventoryStacksInPlace(list, options = {}) {
  if (!Array.isArray(list)) return false;
  const before = cloneJsonSafe(list);
  const out = [];
  for (const raw of list) {
    addInventoryItemWithStack(out, raw, options);
  }
  list.length = 0;
  list.push(...out);

  try {
    return JSON.stringify(before) !== JSON.stringify(out);
  } catch (_) {
    return true;
  }
}

function hashString(input) {
  const text = String(input || "");
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
  }
  return Math.abs(h >>> 0);
}

export function inferLootThemeFromText(text) {
  const blob = String(text || "").toLowerCase();
  if (/\b(zombie|infected|undead|walker|apocalypse|post\s*-?\s*apoc|wasteland|survivor|radiation)\b/.test(blob)) return "zombie";
  if (/\b(cyber|android|mech|spaceship|space\s*station|plasma|laser|quantum|ai\b|credits?)\b/.test(blob)) return "scifi";
  if (/\b(dungeon|dragon|kingdom|mana|arcane|wizard|sorcer|goblin|knight|elf|orc|fantasy)\b/.test(blob)) return "fantasy";
  if (/\b(soldier|military|warzone|bunker|rifle|ammo|tactical|operation)\b/.test(blob)) return "military";
  if (/\b(city|modern|street|office|mall|subway|apartment|detective)\b/.test(blob)) return "modern";
  return "generic";
}

export function pickContainerForTheme(theme, preferredName = "", preferredType = "") {
  const explicit = `${preferredName} ${preferredType}`.trim();
  if (explicit && CONTAINER_TOKEN_RE.test(explicit)) {
    return {
      name: clipText(preferredName || preferredType || "Loot Container", 80),
      type: clipText(preferredType || "Container", 50),
      rarity: "common",
      description: "A recovered container filled with salvage.",
    };
  }

  switch (String(theme || "generic")) {
    case "zombie":
      return {
        name: "Weathered Supply Crate",
        type: "Supply Crate",
        rarity: "common",
        description: "A battered crate packed with practical survival gear.",
      };
    case "scifi":
      return {
        name: "Sealed Tech Case",
        type: "Tech Case",
        rarity: "uncommon",
        description: "A reinforced case carrying calibrated tech loot.",
      };
    case "fantasy":
      return {
        name: "Runed Treasure Chest",
        type: "Treasure Chest",
        rarity: "uncommon",
        description: "An old chest etched with protective runes.",
      };
    case "military":
      return {
        name: "Tactical Locker Cache",
        type: "Locker Cache",
        rarity: "uncommon",
        description: "A military lockbox loaded with mission supplies.",
      };
    case "modern":
      return {
        name: "Heavy Duffel Bag",
        type: "Duffel Bag",
        rarity: "common",
        description: "A dense duffel packed with street-ready gear.",
      };
    default:
      return {
        name: "Loot Bag",
        type: "Loot Bag",
        rarity: "common",
        description: "A recovered bag containing mixed loot.",
      };
  }
}

const THEME_POOLS = {
  zombie: [
    { name: "Bandage Roll", type: "consumable", description: "A clean wrap for emergency wounds.", qty: 2, rarity: "common" },
    { name: "Canned Rations", type: "consumable", description: "Long-life food with a metallic aftertaste.", qty: 2, rarity: "common" },
    { name: "Makeshift Machete", type: "weapon", description: "A sharpened blade built for close survival.", qty: 1, rarity: "uncommon" },
    { name: "Survivor Field Notes", type: "book", description: "Scrawled routes, danger marks, and hard lessons.", qty: 1, rarity: "common", book: { title: "Survivor Field Notes", text: "- Keep noise low near collapsed districts.\n- Check rooftops for clean rainwater.\n- Never trust a quiet alley after dusk." } },
  ],
  scifi: [
    { name: "Energy Cell", type: "component", description: "A compact charge unit for powered devices.", qty: 2, rarity: "common" },
    { name: "Nano Medkit", type: "consumable", description: "A fast-acting medical patch with nanite gel.", qty: 1, rarity: "uncommon" },
    { name: "Arc Baton", type: "weapon", description: "A shock baton tuned for close defense.", qty: 1, rarity: "uncommon" },
    { name: "Maintenance Log 7A", type: "book", description: "Technical entries from a station engineer.", qty: 1, rarity: "common", book: { title: "Maintenance Log 7A", text: "Cycle 142: Coolant pressure keeps spiking in Ring C.\nCycle 145: Security drones rerouted due to power starvation.\nCycle 149: Someone disabled alert beacons in the cargo spine." } },
  ],
  fantasy: [
    { name: "Healing Herb Bundle", type: "consumable", description: "Fresh herbs with restorative properties.", qty: 2, rarity: "common" },
    { name: "Mana Vial", type: "consumable", description: "A vial of concentrated mana.", qty: 1, rarity: "uncommon" },
    { name: "Tempered Longsword", type: "weapon", description: "A reliable blade with a balanced edge.", qty: 1, rarity: "uncommon" },
    { name: "Bestiary Primer", type: "book", description: "An annotated guide to common regional beasts.", qty: 1, rarity: "common", book: { title: "Bestiary Primer", text: "Wolves hunt where moonlight is broken by pine.\nBog wretches fear torch oil and iron filings.\nNever approach a wyvern nest from downwind." } },
  ],
  military: [
    { name: "Field Dressing Kit", type: "consumable", description: "Compact trauma supplies.", qty: 2, rarity: "common" },
    { name: "Ballistic Plate", type: "armor", description: "A replacement plate for tactical vests.", qty: 1, rarity: "uncommon" },
    { name: "Combat Knife", type: "weapon", description: "A full-tang utility blade.", qty: 1, rarity: "common" },
    { name: "After-Action Brief", type: "book", description: "A debrief folder with mission notes.", qty: 1, rarity: "common", book: { title: "After-Action Brief", text: "Objective secured at 0317 hours.\nHostile resistance was light but coordinated.\nRecommend reinforced patrols at the east approach." } },
  ],
  modern: [
    { name: "First Aid Pouch", type: "consumable", description: "Bandages, disinfectant, and gauze.", qty: 1, rarity: "common" },
    { name: "Battery Pack", type: "utility", description: "A universal rechargeable battery set.", qty: 2, rarity: "common" },
    { name: "Utility Knife", type: "weapon", description: "A foldable multi-purpose blade.", qty: 1, rarity: "common" },
    { name: "Case Notes", type: "book", description: "A detective notebook of leads and timelines.", qty: 1, rarity: "common", book: { title: "Case Notes", text: "Witness timeline does not match station footage.\nTwo deliveries to Unit 12 came from fake vendor IDs.\nFollow the money trail through the midnight transfer." } },
  ],
  generic: [
    { name: "Ration Pack", type: "consumable", description: "A dense emergency ration bar.", qty: 2, rarity: "common" },
    { name: "Utility Coil", type: "component", description: "A multipurpose wire spool.", qty: 1, rarity: "common" },
    { name: "Sturdy Dagger", type: "weapon", description: "A short blade with a reinforced grip.", qty: 1, rarity: "common" },
    { name: "Traveler Journal", type: "book", description: "A weathered journal of routes and warnings.", qty: 1, rarity: "common", book: { title: "Traveler Journal", text: "Roadside inns exchange gossip faster than maps.\nStorm paths changed after the bridge collapse.\nKeep spare water in every camp, no exceptions." } },
  ],
};

export function buildDefaultContainerContents({ theme = "generic", seedText = "" } = {}) {
  const key = String(theme || "generic").toLowerCase();
  const pool = Array.isArray(THEME_POOLS[key]) ? THEME_POOLS[key] : THEME_POOLS.generic;
  const seed = hashString(`${key}|${seedText}`);
  const targetCount = 2 + (seed % 3); // 2-4 entries

  const out = [];
  for (let i = 0; i < targetCount; i++) {
    const picked = pool[(seed + i) % pool.length];
    if (!picked) continue;
    const copy = cloneJsonSafe(picked) || null;
    if (!copy) continue;
    out.push(copy);
  }

  if (!out.some((x) => isBookItem(x)) && (seed % 2 === 0)) {
    const fallbackBook = pool.find((x) => isBookItem(x));
    if (fallbackBook) out.push(cloneJsonSafe(fallbackBook));
  }

  return out
    .map((x) => normalizeInventoryItem(x, { forceContainer: false, forceBook: isBookItem(x) }))
    .filter((x) => !!x && !!x.name)
    .slice(0, 8);
}

export function createOpenableContainerItem({
  chatHint = "",
  containerName = "",
  containerType = "",
  description = "",
  rarity = "common",
  contents = [],
  source = "loot",
  now,
} = {}) {
  const nowTs = Number(now || Date.now()) || Date.now();
  const theme = inferLootThemeFromText(chatHint);
  const picked = pickContainerForTheme(theme, containerName, containerType);
  const seededContents = Array.isArray(contents) && contents.length
    ? contents
    : buildDefaultContainerContents({ theme, seedText: `${containerName}|${containerType}|${chatHint}` });

  return normalizeInventoryItem({
    kind: "item",
    name: clipText(containerName || picked.name || "Loot Container", 80),
    type: clipText(containerType || picked.type || "Container", 60),
    description: clipText(description || picked.description || "A container with assorted loot.", 1200),
    rarity: normalizedRarity(rarity || picked.rarity || "common"),
    qty: 1,
    openable: {
      kind: "container",
      containerType: clipText(containerType || picked.type || "Container", 60),
      seededAt: nowTs,
      openedCount: 0,
      source: clipText(source || "loot", 60),
      theme,
      contents: seededContents,
    },
    _meta: {
      source: clipText(source || "loot", 60),
      createdAt: nowTs,
      updatedAt: nowTs,
    },
  }, {
    now: nowTs,
    forceContainer: true,
    chatHint,
    source,
    theme,
  });
}

export function ensureOpenableContents(item, chatHint = "") {
  if (!item || typeof item !== "object") return [];
  if (!isContainerItem(item)) return [];

  const openable = item.openable && typeof item.openable === "object" ? item.openable : { kind: "container" };
  const existing = Array.isArray(openable.contents) ? openable.contents : [];

  let nextContents = existing
    .map((x) => normalizeInventoryItem(x, { forceContainer: false, forceBook: isBookItem(x) }))
    .filter((x) => !!x && !!x.name);

  if (!nextContents.length) {
    const theme = inferLootThemeFromText(`${chatHint}\n${item.name || ""}\n${item.type || ""}\n${item.description || ""}`);
    nextContents = buildDefaultContainerContents({ theme, seedText: `${item.name}|${item.type}|${chatHint}` });
    openable.theme = theme;
  }

  openable.kind = "container";
  openable.containerType = clipText(openable.containerType || item.type || "Container", 60);
  openable.seededAt = Number(openable.seededAt || Date.now()) || Date.now();
  openable.openedCount = Math.max(0, Math.floor(asFinite(openable.openedCount, 0)));
  openable.contents = nextContents.slice(0, 24);
  item.openable = openable;
  return openable.contents;
}

export function summarizeItemsForLog(items, max = 4) {
  const arr = Array.isArray(items) ? items : [];
  const out = [];
  for (const it of arr) {
    const nm = clipText(it?.name || "", 60);
    if (!nm) continue;
    const qty = Math.max(1, Math.floor(asFinite(it?.qty, 1)));
    out.push(`${qty}x ${nm}`);
    if (out.length >= Math.max(1, Number(max) || 4)) break;
  }
  if (!out.length) return "(no loot)";
  return out.join(", ");
}
