
/**
 * RP Log / Injection helper for SillyTavern.
 * Goal: when inventory actions happen (USE/EQUIP/etc),
 * inject a message into chat so the model sees it in context.
 * 
 * Updated to support "Hidden from User" injection via buffer.
 */

// Buffer for events that should be hidden from UI but sent to AI
export const hiddenEventBuffer = [];

export function peekHiddenEvents() {
    if (hiddenEventBuffer.length === 0) return "";
    return hiddenEventBuffer.join("\n");
}

export function flushHiddenEvents() {
    if (hiddenEventBuffer.length === 0) return "";
    const events = [...hiddenEventBuffer];
    hiddenEventBuffer.length = 0; // Clear buffer
    return events.join("\n");
}

export async function injectRpEvent(text, opts = {}) {
  const msg = String(text || "").trim();
  if (!msg) return false;

  // If user requested "hidden" (implied by "System:" prefix usually, or explicit opt)
  // For now, we will treat ALL system messages from UIE as "hidden from UI, visible to AI" 
  // because that is what the user explicitly requested for "Equipment, activities...".
  // However, we still want to show a toast so the user knows it happened.
  
  // Always buffer for AI context
  hiddenEventBuffer.push(msg);

  // Show Toast
  try { if (window.toastr) window.toastr.info(msg); } catch (_) {}

  // Trigger update immediately so prompt is ready before user types
  try { $(document).trigger("uie:events-buffered"); } catch (_) {}

  // We DO NOT add to chat log anymore, to satisfy "hidden from user".
  // The 'interaction.js' module must pick up 'hiddenEventBuffer' and inject it into the prompt.
  
  return true;
}
