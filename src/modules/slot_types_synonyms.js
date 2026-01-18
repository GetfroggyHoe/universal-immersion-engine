/**
 * Slot Types Synonyms / Alias Map (Hybrid inference)
 * Goal: catch different AI model wording.
 *
 * - Keys should be normalized tokens (lowercase).
 * - Values can set: category, group, subtype
 */

export const SLOT_SYNONYMS = {
  // Enchantment / Spirit / Containers
  "soul jar":        { category:"ENCHANTMENT", group:"Catalysts", subtype:"Phylactery" },
  "spirit jar":      { category:"ENCHANTMENT", group:"Spirit", subtype:"Spirit Orb" },
  "lich jar":        { category:"ENCHANTMENT", group:"Catalysts", subtype:"Phylactery" },
  "soul container":  { category:"ENCHANTMENT", group:"Catalysts", subtype:"Phylactery" },
  "binding thread":  { category:"ENCHANTMENT", group:"Binding Agents" },
  "runeword":        { category:"ENCHANTMENT", group:"Sockets (Runewords)" },

  // Alchemy
  "healing brew":    { category:"ALCHEMY", group:"Refined States", subtype:"Solution" },
  "healing potion":  { category:"ALCHEMY", group:"Refined States", subtype:"Solution" },
  "antidote":        { category:"ALCHEMY", group:"Refined States", subtype:"Solution" },
  "sleep gas":       { category:"ALCHEMY", group:"Gases", subtype:"Gas (Sleep)" },
  "poison gas":      { category:"ALCHEMY", group:"Gases", subtype:"Gas (Poison)" },

  // Crafting / Engineering
  "pcb":             { category:"CRAFTING", group:"Electronics", subtype:"Circuit Board" },
  "microcontroller": { category:"CRAFTING", group:"Electronics", subtype:"Microchip" },
  "duct tape":       { category:"CRAFTING", group:"Adhesives", subtype:"Tape (Duct)" },
  "electrical tape": { category:"CRAFTING", group:"Adhesives", subtype:"Tape (Electrical)" },

  // Fishing
  "fishing license": { category:"FISHING", group:"Utility", subtype:"License" },
  "crab trap":       { category:"FISHING", group:"Traps", subtype:"Crab Pot" },

  // Entomology
  "bug net":         { category:"ENTOMOLOGY", group:"Collection Tools", subtype:"Net (Bug)" },
  "specimen jar":    { category:"ENTOMOLOGY", group:"Collection Tools", subtype:"Jar (Specimen)" },

  // Quest
  "access card":     { category:"QUEST", group:"Keys", subtype:"Card Key" },
  "keycard":         { category:"QUEST", group:"Keys", subtype:"Card Key" },
  "evidence bag":    { category:"QUEST", group:"Crime", subtype:"Evidence (Bagged)" },

  // Merchant
  "bill of lading":  { category:"MERCHANT", group:"Documents", subtype:"Bill of Lading" },
  "shipping invoice":{ category:"MERCHANT", group:"Documents", subtype:"Invoice" },
};

export function normalizeToken(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[_\-]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
