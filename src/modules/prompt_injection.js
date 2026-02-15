
import { extension_prompt_types, setExtensionPrompt, event_types, eventSource } from '/script.js';
import { rootProtocolBlock } from './apiClient.js';
import { flushHiddenEvents, peekHiddenEvents } from './features/rp_log.js';
import { getSettings } from './core.js';

const PROMPT_ID = 'universal_immersion_engine_prompt';

let initTries = 0;
let retryInterval = null;

export function initPromptInjection() {
    try {
        const w = typeof window !== "undefined" ? window : globalThis;
        const es = eventSource ?? w?.eventSource;
        const et = event_types ?? w?.event_types;

        if (!es || !et || typeof es.on !== "function") {
            initTries++;
            if (initTries < 120) {
                setTimeout(initPromptInjection, 250);
            } else {
                console.error("[UIE] Failed to find eventSource after 30s.");
            }
            return;
        }

        if (w?.UIE_promptBound) return;
        w.UIE_promptBound = true;
        w.UIE_promptBoundAt = Date.now();

        console.log("[UIE] Initializing prompt injection...");

        es.on(et.MESSAGE_RECEIVED, async () => {
            await updateUiePrompt();
        });

        es.on(et.GENERATION_ENDED, async () => {
            try { flushHiddenEvents(); } catch (_) {}
            await updateUiePrompt();
        });

        setTimeout(() => {
            console.log("[UIE] Triggering initial prompt update");
            updateUiePrompt();
        }, 2000);

        const $ = w?.jQuery ?? w?.$;
        if (typeof $ === "function" && typeof $().on === "function") {
            let deb = null;
            $(document).on("uie:events-buffered", () => {
                if (deb) clearTimeout(deb);
                deb = setTimeout(updateUiePrompt, 500);
            });
        }

        if (retryInterval) clearInterval(retryInterval);
        retryInterval = setInterval(() => {
            updateUiePrompt();
        }, 60000);

    } catch (e) {
        console.error("[UIE] initPromptInjection fatal error", e?.message ?? e);
    }
}

let isUpdating = false;

export async function updateUiePrompt() {
    if (isUpdating) return;
    isUpdating = true;
    try {
        try { window.UIE_promptLastUpdateAt = Date.now(); } catch (_) {}
        // Do NOT flush here. We want buffered RP events to be available for the next
        // generation call (either SillyTavern chat generation or UIE module generation).
        const events = peekHiddenEvents();

        // Generate the full UIE context (Inventory, Status, etc.)
        const context = await rootProtocolBlock("");

        let finalPrompt = context;

        if (events) {
            finalPrompt += "\n\n[RECENT_ACTIVITY_LOG]\n" + events;
        }

        if (!finalPrompt) {
            isUpdating = false;
            return;
        }

        // Register/Update the prompt in SillyTavern
        // IN_PROMPT (0) = System Prompt
        // depth 0 = Appended to end of system prompt
        // scan = true (allow macro replacement)
        setExtensionPrompt(PROMPT_ID, finalPrompt, extension_prompt_types.IN_PROMPT, 0, true, 'system');

    } catch (e) {
        console.error("[UIE] Prompt update failed", e);
        try { window.UIE_promptLastError = String(e?.message || e || ""); } catch (_) {}
    } finally {
        isUpdating = false;
    }
}
