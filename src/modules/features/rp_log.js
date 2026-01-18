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
