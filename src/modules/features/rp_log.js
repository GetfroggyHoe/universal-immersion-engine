/**
 * RP Log / Injection helper for SillyTavern.
 * Goal: when inventory actions happen (USE/EQUIP/etc),
 * inject a message into chat so the model sees it in context.
 *
 * Uses dynamic import + fallbacks so it works across ST builds.
 */

export async function injectRpEvent(text, opts = {}) {
  const msg = String(text || "").trim();
  if (!msg) return false;

  // Prefer: add as a "system" style message, but use whatever exists.
  try {
    const mod = await import("../../../../../../script.js").catch(() => null);

    // Common function names across versions/builds (best-effort)
    const candidates = [
      mod?.addOneMessage,
      mod?.appendOneMessage,
      mod?.addMessage,
      mod?.pushMessage,
      mod?.sendSystemMessage,
    ].filter(Boolean);

    // If ST exports a chat message helper, use it
    for (const fn of candidates) {
      try {
        const before = (() => {
          try {
            const el = document.querySelector("#chat .mes:last-child");
            if (!el) return "";
            return String(el.getAttribute("mesid") || el.getAttribute("data-id") || "");
          } catch (_) { return ""; }
        })();
        // Try common call signatures
        // 1) object style
        fn({ role: "system", content: msg, ...opts });
        await new Promise(r => setTimeout(r, 0));
        const after = (() => {
          try {
            const el = document.querySelector("#chat .mes:last-child");
            if (!el) return "";
            return String(el.getAttribute("mesid") || el.getAttribute("data-id") || "");
          } catch (_) { return ""; }
        })();
        const mesid = after && after !== before ? after : after || null;
        return { ok: true, mesid };
      } catch (_) {
        try {
          const before = (() => {
            try {
              const el = document.querySelector("#chat .mes:last-child");
              if (!el) return "";
              return String(el.getAttribute("mesid") || el.getAttribute("data-id") || "");
            } catch (_) { return ""; }
          })();
          // 2) string style
          fn(msg);
          await new Promise(r => setTimeout(r, 0));
          const after = (() => {
            try {
              const el = document.querySelector("#chat .mes:last-child");
              if (!el) return "";
              return String(el.getAttribute("mesid") || el.getAttribute("data-id") || "");
            } catch (_) { return ""; }
          })();
          const mesid = after && after !== before ? after : after || null;
          return { ok: true, mesid };
        } catch (_) {}
      }
    }
  } catch (_) {}

  // Fallback: dispatch DOM event (your own extension could listen later)
  try {
    window.dispatchEvent(new CustomEvent("uie:rp_event", { detail: { text: msg, ...opts } }));
  } catch (_) {}

  // Last fallback: at least show a toast so user sees it happened
  try { if (window.toastr) window.toastr.info(msg); } catch (_) {}

  return false;
}

export const injectSpineEvent = injectRpEvent;

export const UnifiedSpine = {
    inject: injectRpEvent,
    
    async handleEquip(item, slotId) {
        const itemName = String(item?.name || "Item");
        const slot = String(slotId || "unknown slot");
        // Inject a system message that the AI will see
        // Format: [System: User equipped "Sword" to "Main Hand".]
        const msg = `[System: User equipped "${itemName}" to ${slot}. Context: The user is now wearing/holding this item.]`;
        await injectRpEvent(msg, { uie: { type: "equip", item: itemName, slot } });
    },

    async handleUnequip(item, slotId) {
        const itemName = String(item?.name || "Item");
        const slot = String(slotId || "unknown slot");
        const msg = `[System: User unequipped "${itemName}" from ${slot}.]`;
        await injectRpEvent(msg, { uie: { type: "unequip", item: itemName, slot } });
    },

    async handlePhone(type, data) {
        let msg = "";
        if (type === "call_start") {
            msg = `[System: User started a phone call with ${data.who}.]`;
        } else if (type === "call_end") {
            msg = `[System: Phone call with ${data.who} ended.]`;
        } else if (type === "text_sent") {
            msg = `[System: User sent a text to ${data.who}: "${data.text}"]`;
        } else if (type === "text_received") {
            msg = `[System: ${data.who} sent a text to User: "${data.text}"]`;
        }
        if (msg) return await injectRpEvent(msg, { uie: { type: "phone", subtype: type, ...data } });
        return false;
    },

    async handleBattle(type, data) {
        let msg = "";
        if (type === "start") {
            const names = Array.isArray(data.enemies) ? data.enemies.join(", ") : "unknown enemies";
            msg = `[System: Combat Started against ${names}. Context: The user is now in a battle scenario.]`;
        } else if (type === "defeat") {
            msg = `[System: ${data.enemy} has been defeated.]`;
        } else if (type === "roll") {
            msg = `[System: War Room dice roll: ${data.expr} => ${data.total}.]`;
        }
        if (msg) return await injectRpEvent(msg, { uie: { type: "battle", subtype: type, ...data } });
        return false;
    },

    async handleParty(type, data) {
        let msg = "";
        if (type === "join") {
            msg = `[System: ${data.name} joined the party. Context: This character is now travelling with the user.]`;
        } else if (type === "leave") {
            msg = `[System: ${data.name} left the party.]`;
        }
        if (msg) return await injectRpEvent(msg, { uie: { type: "party", subtype: type, ...data } });
        return false;
    },

    async handleSocial(type, data) {
        let msg = "";
        if (type === "interaction") {
             msg = `[Canon Event: Interaction with ${data.name}. Affinity: ${data.affinity}. Status: ${data.status}.]`;
        } else if (type === "memory") {
            msg = data.block;
        }
        if (msg) return await injectRpEvent(msg, { uie: { type: "social", subtype: type, ...data } });
        return false;
    },

    async handleCrafting(type, data) {
        let msg = "";
        const rName = data.recipeName || "recipe";
        const item = data.item || "item";
        
        switch (type) {
            case "kitchen_start":
                msg = `[System: Started cooking ${rName}.]`;
                break;
            case "kitchen_done":
                msg = `[System: Finished cooking ${rName}.]`;
                break;
            case "kitchen_burned":
                msg = `[System: Burned the dish (${data.reason || "mistakes"}).]`;
                break;
            case "kitchen_stir":
                msg = `[System: User stirred the pot.]`;
                break;
            case "kitchen_cancel":
                msg = `[System: Canceled cooking.]`;
                break;
            case "kitchen_serve":
                msg = `[System: Served ${item}.]`;
                break;
            case "craft_start":
                msg = `[System: Started crafting ${rName}.]`;
                break;
            case "craft_complete":
                msg = `[System: Successfully crafted ${item}.]`;
                break;
        }
        
        if (msg) return await injectRpEvent(msg, { uie: { type: "crafting", subtype: type, ...data } });
        return false;
    },

    async handleAlchemy(type, data) {
        let msg = "";
        if (type === "brew") {
            msg = `[System: User brewed ${data.item} using reagents: ${data.reagents}.]`;
        }
        if (msg) return await injectRpEvent(msg, { uie: { type: "alchemy", subtype: type, ...data } });
        return false;
    },

    async handleEnchant(type, data) {
        let msg = "";
        if (type === "enchant") {
            msg = `[System: User enchanted ${data.item} with ${data.enchantment}.]`;
        }
        if (msg) return await injectRpEvent(msg, { uie: { type: "enchant", subtype: type, ...data } });
        return false;
    },

    async handleForge(type, data) {
        let msg = "";
        if (type === "craft") {
            msg = `[System: User forged ${data.item} using materials: ${data.materials}.]`;
        }
        if (msg) return await injectRpEvent(msg, { uie: { type: "forge", subtype: type, ...data } });
        return false;
    },

    async handleShop(type, data) {
        let msg = "";
        if (type === "purchase") {
            msg = `[System: User purchased ${data.item} for ${data.price} ${data.currency}.]`;
        }
        if (msg) return await injectRpEvent(msg, { uie: { type: "shop", subtype: type, ...data } });
        return false;
    },

    async handleItem(type, data) {
        let msg = "";
        const item = data.item || "Item";
        
        switch (type) {
            case "custom_use":
                msg = data.note ? `Custom use: ${item} — ${data.note}` : `Custom use: ${item}`;
                break;
            case "custom_equip":
                msg = data.note 
                    ? `[System: User equipped ${item}. Stats updated.] (${data.note})`
                    : `[System: User equipped ${item}. Stats updated.]`;
                break;
            case "equip":
                msg = `[System: User equipped ${item}. Stats updated.]`;
                break;
            case "discard":
                msg = `Discarded ${item}.`;
                break;
            case "send_party":
                msg = `Sent ${data.qty || 1}x ${item} to the party stash.`;
                break;
            case "use":
                msg = `[System: User used ${item}.]`;
                break;
            case "consume":
                msg = `[System: User consumed ${item}. Effect: ${data.effect || "—"}.]`;
                break;
        }
        
        if (msg) return await injectRpEvent(msg, { uie: { type: "item", subtype: type, ...data } });
        return false;
    }
};
