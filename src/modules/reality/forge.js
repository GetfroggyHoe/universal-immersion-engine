import { getSettings } from "../core.js";
import { generateImageAPI } from "../imageGen.js";
import { getRealityEngineV3 } from "./engine.js";

const slug = (s) => String(s || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80);

function buildPrompt({ location, biome, timeOfDay, lore } = {}) {
    const parts = [];
    if (location) parts.push(String(location));
    if (biome) parts.push(`Biome: ${String(biome)}`);
    if (timeOfDay) parts.push(`Time: ${String(timeOfDay)}`);
    if (lore) parts.push(String(lore));
    const base = parts.filter(Boolean).join("\n").trim();
    return base || "A detailed background scene for a visual novel style roleplay.";
}

export function initForgeV3() {
    const eng = getRealityEngineV3();
    if (window.UIE_realityForgeV3Bound) return;
    window.UIE_realityForgeV3Bound = true;

    eng.on("background:missing", async ({ id, location } = {}) => {
        const s = getSettings();
        const wd = eng.getState();
        const locId = slug(id || wd?.player?.locationId || "default") || "default";
        const loc = location || wd.locations?.[locId] || wd.locations?.default || {};
        const prompt = buildPrompt({
            location: loc?.name || locId,
            biome: loc?.biome || "default",
            timeOfDay: wd?.player?.timeOfDay || "day",
            lore: String(s?.worldState?.status || "").trim()
        });
        const img = await generateImageAPI(`[UIE_LOCKED] ${prompt}`);
        if (!img) return;
        eng.setBackground(locId, img);
    });
}

