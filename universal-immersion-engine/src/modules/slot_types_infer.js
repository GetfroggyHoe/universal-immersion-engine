import { SLOT_TYPES_CORE } from "./slot_types_core.js";
import { SLOT_SYNONYMS, normalizeToken } from "./slot_types_synonyms.js";
import { getSettings } from "./core.js";

/**
 * Hybrid inference:
 * 1) If item.type exists -> trust it
 * 2) If tags contain category/group/subtype -> trust tags
 * 3) Synonym lookup (model-agnostic)
 * 4) Keyword scan by category
 */
export function inferItemType(item) {
  if (!item) return { category:"UNCATEGORIZED", confidence:0 };
  try {
    const s = getSettings?.();
    if (s?.inventory?.ui?.slotTypesEnabled === false) return { category: "UNCATEGORIZED", confidence: 0, source: "disabled" };
  } catch (_) {}

  // 1) Existing explicit type wins
  if (item.type && item.type.category) {
    return { ...item.type, confidence: 1, source: "explicit" };
  }

  const typeStr = typeof item.type === "string" ? normalizeToken(item.type) : "";
  const name = normalizeToken(item.name);
  const desc = normalizeToken(item.desc || item.description || "");
  const tagsArr = Array.isArray(item.tags) ? item.tags : [];
  const tags = normalizeToken(tagsArr.join(" "));
  const blob = `${typeStr} ${name} ${desc} ${tags}`.trim();

  // 2) Tag-driven (hybrid preferred)
  // If tags include "category:ALCHEMY" or "group:Metals" etc.
  const tagCategory = tagsArr.find(t => String(t).toLowerCase().startsWith("category:"));
  if (tagCategory) {
    const cat = String(tagCategory).split(":").slice(1).join(":").trim().toUpperCase();
    if (SLOT_TYPES_CORE[cat]) return { category: cat, confidence: 0.95, source: "tag" };
  }

  // 3) Synonym map: scan for any alias phrase inside blob
  // (Fast enough for mobile: map is a plain object; phrases are short)
  for (const [alias, mapped] of Object.entries(SLOT_SYNONYMS)) {
    if (!alias) continue;
    if (blob.includes(alias)) {
      return { ...mapped, confidence: 0.9, source: "synonym", matched: alias };
    }
  }

  // 4) Keyword scan by category
  let best = { category:"UNCATEGORIZED", confidence:0.1, source:"fallback" };

  for (const [category, cfg] of Object.entries(SLOT_TYPES_CORE)) {
    if (!cfg || !Array.isArray(cfg.keywords) || category === "UNCATEGORIZED") continue;

    let hits = 0;
    for (const kw of cfg.keywords) {
      const k = normalizeToken(kw);
      if (k && blob.includes(k)) hits++;
    }
    if (hits > 0) {
      // simple scoring; can be improved later
      const score = Math.min(0.85, 0.25 + hits * 0.15);
      if (score > best.confidence) best = { category, confidence: score, source:"keyword", hits };
    }
  }

  return best;
}

// Helper: apply inferred type onto item if missing (optional)
export function applyInferredType(item) {
  if (!item) return item;
  if (item.type && item.type.category) return item;
  const t = inferItemType(item);
  item.type = { category: t.category, group: t.group || "", subtype: t.subtype || "" };
  return item;
}
