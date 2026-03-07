
import { getRealityEngineV3 } from "./reality.js";
import { notify } from "./notifications.js";
import { getSettings } from "./core.js";

const reV3 = getRealityEngineV3();

/**
 * Encodes a prompt for Pollinations AI
 * @param {string} prompt 
 * @returns {string}
 */
function encodePrompt(prompt) {
    return encodeURIComponent(String(prompt || "").trim());
}

/**
 * Generates a background image using Pollinations AI
 * @param {string} locationName 
 * @param {string} biome 
 * @returns {Promise<string>}
 */
async function generateBackground(locationName, biome) {
    const prompt = `${locationName}, ${biome}, visual novel background, anime style, high detail, 8k, masterpiece, no text, no ui`;
    const url = `https://image.pollinations.ai/prompt/${encodePrompt(prompt)}?width=1280&height=720&nologo=true&seed=${Math.floor(Math.random() * 100000)}`;
    
    // We fetch it as a blob to cache it locally if possible, or just return the URL
    // For now, returning the URL is enough as Pollinations caches by seed/prompt
    // But to ensure it's persistent even if offline, we might want to blob it.
    // However, the prompt asked to "Save this URL/Blob to the local registry". 
    // Storing full blobs in localStorage is bad. Let's try to store the URL.
    // But Pollinations URLs are permanent if the seed is fixed.
    
    // To verify it works, we try to fetch it.
    try {
        const r = await fetch(url);
        if (!r.ok) throw new Error("Pollinations fetch failed");
        const blob = await r.blob();
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.readAsDataURL(blob);
        });
    } catch (e) {
        console.warn("Pollinations generation failed", e);
        return "";
    }
}

/**
 * The "Check-Gen-Cache" Loop
 * Listens for missing background events and resolves them.
 */
export function initBackgroundManager() {
    reV3.on("background:missing", async ({ id, location }) => {
        // Double check if it's already being handled
        if (reV3.getBackground(id)) return;

        const locName = location?.name || id || "Unknown Place";
        const biome = location?.biome || "fantasy";
        
        notify("info", `Painting ${locName}...`, "Reality Engine");

        try {
            const dataUrl = await generateBackground(locName, biome);
            if (dataUrl) {
                reV3.setBackground(id, dataUrl);
                notify("success", `Background created for ${locName}`, "Reality Engine");
            } else {
                notify("warn", `Failed to paint ${locName}`, "Reality Engine");
            }
        } catch (err) {
            console.error(err);
        }
    });

    // Also handle location changes to ensure we have a background
    reV3.on("location:changed", ({ id, location }) => {
        reV3.ensureBackgroundOrRequest();
    });

    console.log("[UIE] Background Manager Initialized");
}
