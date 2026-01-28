
import { extension_prompt_types, setExtensionPrompt, event_types, eventSource } from '/script.js';
import { rootProtocolBlock } from './apiClient.js';
import { flushHiddenEvents, peekHiddenEvents } from './features/rp_log.js';

const PROMPT_ID = 'universal_immersion_engine_prompt';

export function initPromptInjection() {
    console.log("[UIE] Initializing prompt injection...");

    // Update prompt when user sends a message (before AI replies)
    eventSource.on(event_types.MESSAGE_RECEIVED, async () => {
        await updateUiePrompt();
    });

    // Update when a message is generated (to clear buffer if any events happened during generation?)
    eventSource.on(event_types.GENERATION_ENDED, async () => {
        // Drain any buffered RP-log events after a generation completes so they don't
        // repeat forever in later prompts.
        try { flushHiddenEvents(); } catch (_) {}
        await updateUiePrompt();
    });

    // Initial update
    setTimeout(updateUiePrompt, 2000);

    // Update on buffer change (debounced)
    let deb = null;
    $(document).on("uie:events-buffered", () => {
        if (deb) clearTimeout(deb);
        deb = setTimeout(updateUiePrompt, 500);
    });
}

let isUpdating = false;

export async function updateUiePrompt() {
    if (isUpdating) return;
    isUpdating = true;
    try {
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
    } finally {
        isUpdating = false;
    }
}
