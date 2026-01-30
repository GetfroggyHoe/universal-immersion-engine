
import { getSettings, saveSettings } from "./core.js";

let bound = false;
let activeSet = "";
let category = "default";

// --- EXISTING CONFIG LOGIC (Preserved) ---
const DEFAULT_KEYS = [
    "admiration","amusement","anger","annoyance","approval",
    "caring","confusion","curiosity","desire","disappointment",
    "disapproval","disgust","embarrassment","excitement","fear",
    "gratitude","grief","joy","love","nervousness","neutral",
    "optimism","pride","realization","relief","remorse","sadness","surprise"
];

const LIFE_SIM_KEYS = [
    "awake","sleepy","tired","hungry","eating","working","studying","walking","running","relaxing",
    "happy","bored","stressed","sick","injured","shy","flirty","blushing","laughing","crying",
    "phone","texting","shopping","cooking","cleaning","driving"
];

const FANTASY_RPG_KEYS = [
    "battle","victory","defeat","casting","healing","stealth","danger","hurt","critical","levelup",
    "loot","merchant","quest","boss","taunt","guard","attack","parry","dodge","magic"
];

const normalizeKey = (k) => String(k || "").trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_-]+/g, "").slice(0, 64);

function ensureSpriteStore(s) {
    if (!s.realityEngine || typeof s.realityEngine !== "object") s.realityEngine = {};
    if (!s.realityEngine.sprites || typeof s.realityEngine.sprites !== "object") s.realityEngine.sprites = {};
    const sp = s.realityEngine.sprites;
    if (!sp.sets || typeof sp.sets !== "object") sp.sets = {};
    if (!sp.speakerMap || typeof sp.speakerMap !== "object") sp.speakerMap = {};
    // Custom sprite folder path - defaults to empty (use SillyTavern's default)
    if (typeof sp.customSpriteFolder !== "string") sp.customSpriteFolder = "";
}

function getCustomSpriteFolder() {
    const s = getSettings();
    ensureSpriteStore(s);
    // Sanitize path: replace backslashes with forward slashes and remove trailing slashes
    return String(s.realityEngine.sprites.customSpriteFolder || "").trim().replace(/\\/g, "/").replace(/\/+$/, "");
}

function getSets() {
    const s = getSettings();
    ensureSpriteStore(s);
    return s.realityEngine.sprites.sets;
}

function getSetNames() {
    const sets = getSets();
    return Object.keys(sets).sort((a, b) => String(a).localeCompare(String(b)));
}

function renderSetSelect() {
    const sel = document.getElementById("uie-sprites-set");
    if (!sel) return;
    const names = getSetNames();
    sel.innerHTML = "";
    const opt0 = document.createElement("option");
    opt0.value = "";
    opt0.textContent = "(None)";
    sel.appendChild(opt0);
    for (const n of names) {
        const o = document.createElement("option");
        o.value = n;
        o.textContent = n;
        sel.appendChild(o);
    }
    if (!activeSet && names.length) activeSet = names[0];
    sel.value = activeSet || "";
}

function getKeysForCategory(cat) {
    if (cat === "life_sim") return LIFE_SIM_KEYS.slice();
    if (cat === "fantasy_rpg") return FANTASY_RPG_KEYS.slice();
    if (cat === "custom") return [];
    return DEFAULT_KEYS.slice();
}

function getActiveSetObj() {
    const sets = getSets();
    if (!activeSet) return null;
    const obj = sets[activeSet];
    if (!obj || typeof obj !== "object") return null;
    if (!obj.expressions || typeof obj.expressions !== "object") obj.expressions = {};
    return obj;
}

function getLinkedNames(setName) {
    const s = getSettings();
    const map = s.realityEngine?.sprites?.speakerMap || {};
    // Return unique names (ignoring lowercase duplicates if possible, but for display just show what matches)
    // Filter out auto-generated lowercase keys if the original case key exists?
    // Let's just show all keys that map to this set, filtering out duplicates
    const keys = Object.entries(map)
        .filter(([k, v]) => v === setName)
        .map(([k]) => k);

    // Clean up: if we have "Seraphina" and "seraphina", just show "Seraphina"
    const unique = [];
    keys.forEach(k => {
        // If there is another key that is same letters but different case, prefer the one with capitals
        // If this key is lowercase, and we have a case-insensitive match in the list that isn't this one, skip
        if (k === k.toLowerCase() && keys.some(other => other.toLowerCase() === k && other !== k)) return;
        unique.push(k);
    });
    return unique.join(", ");
}

function renderList() {
    const list = document.getElementById("uie-sprites-list");
    if (!list) return;
    const setObj = getActiveSetObj();

    const linkInput = document.getElementById("uie-sprites-link-name");
    if (linkInput) {
        linkInput.value = activeSet ? getLinkedNames(activeSet) : "";
        linkInput.disabled = !activeSet;
    }

    if (!setObj) {
        list.innerHTML = `<div style="opacity:0.8; font-weight:900;">Create/select a sprite set first.</div>`;
        return;
    }
    list.innerHTML = "";

    const expr = setObj.expressions || {};
    const base = getKeysForCategory(category);
    const customKeys = Object.keys(expr || {}).sort((a, b) => String(a).localeCompare(String(b)));
    const keys = Array.from(new Set([...base, ...customKeys])).filter(Boolean);

    const tmpl = document.getElementById("uie-template-sprites-row");
    if (!tmpl) return;

    const frag = document.createDocumentFragment();

    keys.forEach(key => {
        const k = String(key || "").trim();
        const nk = normalizeKey(k);
        const v = expr?.[nk] || null;
        const has = !!(v && typeof v === "object" && typeof v.dataUrl === "string" && v.dataUrl.startsWith("data:"));

        const clone = tmpl.content.cloneNode(true);
        const row = clone.querySelector(".uie-spr-row");
        if (row) row.setAttribute("data-key", nk);

        const thumb = clone.querySelector(".uie-spr-thumb");
        if (thumb) {
            if (has) {
                thumb.style.backgroundImage = `url('${v.dataUrl}')`;
                thumb.style.backgroundSize = "cover";
                thumb.textContent = "";
                thumb.style.background = ""; // Clear default background color if any, keeping image
                thumb.style.backgroundImage = `url('${v.dataUrl}')`; // Re-apply just in case
            } else {
                thumb.style.background = "rgba(0,0,0,0.25)";
                thumb.style.opacity = "0.8";
                thumb.textContent = "—";
            }
        }

        const keyEl = clone.querySelector(".uie-spr-key");
        if (keyEl) keyEl.textContent = k;

        const statusEl = clone.querySelector(".uie-spr-status");
        if (statusEl) statusEl.textContent = has ? "Image set" : "No image";

        frag.appendChild(clone);
    });

    list.appendChild(frag);
}

function saveSetExpression(setName, key, dataUrl, fileName) {
    const s = getSettings();
    ensureSpriteStore(s);
    const sets = s.realityEngine.sprites.sets;
    if (!sets[setName] || typeof sets[setName] !== "object") sets[setName] = { expressions: {} };
    if (!sets[setName].expressions || typeof sets[setName].expressions !== "object") sets[setName].expressions = {};
    const nk = normalizeKey(key);
    if (!nk) return;
    if (!dataUrl) {
        delete sets[setName].expressions[nk];
    } else {
        sets[setName].expressions[nk] = { dataUrl: String(dataUrl), fileName: String(fileName || "").slice(0, 120) };
    }
    saveSettings();
}

function readFileAsDataUrl(file) {
    return new Promise((resolve) => {
        if (!file) return resolve("");
        const r = new FileReader();
        r.onload = (e) => resolve(String(e?.target?.result || ""));
        r.onerror = () => resolve("");
        r.readAsDataURL(file);
    });
}

// --- NEW REALITY ENGINE LOGIC (Stage Manager) ---

function extractTagValue(text, key) {
    const re = new RegExp(`\\[\\s*${key}\\s*:\\s*([^\\]]+)\\]`, "ig");
    let out = [];
    let m = null;
    while ((m = re.exec(String(text || ""))) !== null) out.push(String(m[1] || "").trim());
    return out.length ? out[out.length - 1] : "";
}

// Wait for reality-stage to be ready
async function waitForRealityStage(maxWait = 5000) {
    const startTime = Date.now();
    while (Date.now() - startTime < maxWait) {
        const stage = document.getElementById("reality-stage");
        if (stage) {
            // Also check if sprite layer exists or can be created
            const spriteLayer = document.getElementById("re-sprites-layer");
            if (spriteLayer || stage.querySelector("#re-sprites-layer")) {
                return stage;
            }
            // If stage exists but no sprite layer, we can create it
            return stage;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    return null;
}

/**
 * Updates the sprite's position, scale, and emotional animation based on chat tags.
 * Sprite launcher works by character name - pulls sprite packs by name.
 * Smart detection: Only shows sprites for characters actually in the scene (speaking or shown via [Show: Name]),
 * not just mentioned in the text.
 * @param {string} text - The last chat message
 * @param {string} charName - The character name
 * @param {boolean} isInScene - Whether character is actually in scene (speaking/shown) vs just mentioned
 */
export async function updateSpriteStage(text, charName, isInScene = true) {
    if (!charName || charName === "SillyTavern System" || charName === "System") {
        if (!charName) console.warn(`[UIE] updateSpriteStage called without charName`);
        return;
    }

    console.log(`[UIE] updateSpriteStage called for ${charName} with text: ${text?.substring(0, 50)}...`);

    const s = getSettings();

    // Wait for reality stage to be ready (it's loaded from world.html template)
    let stage = document.getElementById("reality-stage");
    if (!stage) {
        console.log(`[UIE] Reality stage not found, waiting for template to load...`);
        stage = await waitForRealityStage(3000);
        if (!stage) {
            console.error(`[UIE] Reality stage not found after waiting - template may not be loaded`);
            return;
        }
    }

    // If stage is currently hidden, do NOT force it visible just to show a sprite.
    // Forcing the stage visible is a major source of projection glitches.
    try {
        const stageStyle = window.getComputedStyle(stage);
        if (stageStyle.display === "none" || stageStyle.visibility === "hidden") {
            return;
        }
    } catch (_) {}

    if (!stage) {
        console.error(`[UIE] Cannot proceed - reality-stage not available`);
        return;
    }

    // Check if sprite layer exists, create if missing
    let spriteLayer = document.getElementById("re-sprites-layer");
    if (!spriteLayer) {
        // Also check if it's inside the stage
        spriteLayer = stage.querySelector("#re-sprites-layer");
    }

    if (!spriteLayer) {
        console.log(`[UIE] Sprite layer (re-sprites-layer) not found - creating it`);
        spriteLayer = document.createElement("div");
        spriteLayer.id = "re-sprites-layer";
        spriteLayer.setAttribute("style", `
            position: absolute !important;
            inset: 0 !important;
            pointer-events: none !important;
            overflow: visible !important;
            display: block !important;
            visibility: visible !important;
            opacity: 1 !important;
            z-index: 20 !important;
        `);
        // Insert into stage - try to find re-ui and insert before it, or just append
        const reUi = stage.querySelector("#re-ui");
        if (reUi) {
            stage.insertBefore(spriteLayer, reUi);
        } else {
            stage.appendChild(spriteLayer);
        }
        console.log(`[UIE] ✅ Created sprite layer for ${charName} inside reality-stage`);
    }

    // Force sprite layer to be visible with multiple methods
    spriteLayer.setAttribute("style", spriteLayer.getAttribute("style") + " display: block !important; visibility: visible !important; opacity: 1 !important;");
    spriteLayer.style.display = "block";
    spriteLayer.style.visibility = "visible";
    spriteLayer.style.opacity = "1";
    spriteLayer.style.pointerEvents = "none";
    spriteLayer.style.zIndex = "20";
    spriteLayer.style.position = "absolute";
    spriteLayer.style.inset = "0";
    spriteLayer.style.overflow = "visible";

    // Allow sprite updates even if reality engine is not enabled (for character selection)
    // OR if Character Expressions extension is available (we can mirror those sprites)
    if (!s.realityEngine?.enabled) {
        // Check if we have sprite sets configured OR if Character Expressions extension exists
        const sets = s.realityEngine?.sprites?.sets || {};
        const hasCharacterExpressions = document.querySelector("#expression-holder, #expression-wrapper") !== null;

        // Allow updates if we have sprite sets OR Character Expressions extension is present
        if (!Object.keys(sets).length && !hasCharacterExpressions) {
            // No sprite sets and no Character Expressions - skip
            return;
        }
    }

    // Smart detection: If character is only mentioned (not in scene), don't show sprite
    // Characters are "in scene" if:
    // 1. They are the speaker (charName matches message sender)
    // 2. They have [Show: Name] or [Appear: Name] tag
    // 3. isInScene parameter is explicitly true
    if (!isInScene) {
        // Check if character is actually shown via tags
        const showTags = /\[(?:Show|Appear|Spawn)\s*:\s*([^\]]+)\]/gi;
        const matches = text.matchAll(showTags);
        let isShown = false;
        for (const m of matches) {
            const shownName = String(m[1] || "").trim();
            if (shownName.toLowerCase() === charName.toLowerCase()) {
                isShown = true;
                break;
            }
        }
        if (!isShown) {
            // Character is only mentioned, not in scene - don't show sprite
            return;
        }
    }

    // 1. Resolve Character Set by name (for UIE sprite sets)
    // BUT: If no UIE set exists, we can still use Character Expressions extension sprites
    ensureSpriteStore(s);
    const map = s.realityEngine.sprites.speakerMap || {};
    // Try exact name or slug
    let setName = map[charName] || map[String(charName).toLowerCase().trim()];

    // Fallback: Check if a set exists with the character's name directly (Case-insensitive)
    if (!setName) {
        const sets = s.realityEngine.sprites.sets || {};
        if (sets[charName]) {
            setName = charName;
        } else {
            const lower = String(charName).toLowerCase().trim();
            const found = Object.keys(sets).find(k => k.toLowerCase().trim() === lower);
            if (found) setName = found;
        }
    }

    // If no UIE set found, we'll still try Character Expressions extension API (don't return early)
    // This allows mirroring Character Expressions sprites even without UIE sprite sets configured

    // 2. Determine Expression
    // Priority: [Mood: x] tag > [Sprite: x] tag > Keyword Analysis
    // NOTE: We don't call Character Expressions' getExpressionLabel to avoid interfering with its functionality
    // Instead, we mirror the sprites it already shows via API/DOM
    let mood = extractTagValue(text, "Mood").toLowerCase() || extractTagValue(text, "Sprite").toLowerCase();

    // Try UIE sprite sets first (if configured)
    let dataUrl = null;
    if (setName) {
        const sets = s.realityEngine.sprites.sets || {};
        const setObj = sets[setName];
        if (setObj && setObj.expressions) {
            // If no explicit tag, try simple keyword matching against available keys
            if (!mood) {
                const lower = text.toLowerCase();
                const available = Object.keys(setObj.expressions);
                // Sort by length desc to match longer phrases first
                available.sort((a, b) => b.length - a.length);

                // Get list of character names to avoid false positives on mentions
                const charNames = new Set();
                try {
                    if (Array.isArray(window.characters)) {
                        window.characters.forEach(c => charNames.add(String(c.name).toLowerCase().trim()));
                    }
                } catch (_) {}

                for (const k of available) {
                    // Skip if the key is a character name (prevent "I see Bob" triggering Bob sprite)
                    const cleanKey = k.replace(/_/g, " ");
                    if (charNames.has(cleanKey)) continue;

                    // Simple check: is the emotion key in the text?
                    if (lower.includes(cleanKey)) {
                        mood = k;
                        break;
                    }
                }
            }

            if (!mood) mood = "neutral"; // Fallback

            // Normalize mood key
            const targetKey = normalizeKey(mood);
            let expr = setObj.expressions[targetKey];

            // Fallback to neutral if specific emotion not found
            if (!expr && targetKey !== "neutral") {
                expr = setObj.expressions["neutral"];
            }

            if (expr && expr.dataUrl) {
                dataUrl = expr.dataUrl;
            }
        }
    }

    // If no mood determined yet, default to neutral
    if (!mood) mood = "neutral";

    // If no UIE sprite set data, we'll try Character Expressions extension API below
    // This allows mirroring Character Expressions sprites even without UIE sprite sets configured

    // PRIORITY METHOD 1: MIRROR Character Expression extension API
    // This uses the SAME API that Character Expressions extension uses: /api/sprites/get
    // This ensures we get the exact same sprites that Character Expressions shows
    if (!dataUrl) {
        console.log(`[UIE] Mirroring Character Expression sprites from API for ${charName} with mood ${mood}`);
        try {
            const spriteApiUrl = `/api/sprites/get?name=${encodeURIComponent(charName)}`;
            const spriteResponse = await fetch(spriteApiUrl);
            if (spriteResponse.ok) {
                const sprites = await spriteResponse.json();
                if (Array.isArray(sprites) && sprites.length > 0) {
                    console.log(`[UIE] Received ${sprites.length} sprites from Character Expressions API for ${charName}`);

                    // Use same matching logic as Character Expressions extension
                    // First try exact match
                    const targetMood = (mood || "neutral").toLowerCase().trim();
                    let matchingSprite = sprites.find(s => {
                        const spriteLabel = String(s.label || "").toLowerCase().trim();
                        return spriteLabel === targetMood;
                    });

                    // Then try fuzzy match (partial match)
                    if (!matchingSprite) {
                        matchingSprite = sprites.find(s => {
                            const spriteLabel = String(s.label || "").toLowerCase().trim();
                            return spriteLabel.includes(targetMood) || targetMood.includes(spriteLabel);
                        });
                    }

                    // If no match, try neutral as fallback
                    if (!matchingSprite && targetMood !== "neutral") {
                        matchingSprite = sprites.find(s => {
                            const spriteLabel = String(s.label || "").toLowerCase().trim();
                            return spriteLabel === "neutral";
                        });
                    }

                    // Use first sprite if no match found
                    if (!matchingSprite && sprites.length > 0) {
                        matchingSprite = sprites[0];
                    }

                    if (matchingSprite && matchingSprite.path) {
                        // Convert to absolute URL using Character Expressions extension's helper if available
                        if (typeof window.getAbsoluteSpriteUrl === "function") {
                            dataUrl = window.getAbsoluteSpriteUrl(matchingSprite.path);
                        } else {
                            // Manual conversion (same as Character Expressions extension)
                            if (matchingSprite.path.startsWith('http://') || matchingSprite.path.startsWith('https://') || matchingSprite.path.startsWith('data:')) {
                                dataUrl = matchingSprite.path;
                            } else if (matchingSprite.path.startsWith('/')) {
                                dataUrl = new URL(matchingSprite.path, window.location.origin).href;
                            } else {
                                // Relative path - Character Expressions uses /characters/[name]/[file]
                                dataUrl = new URL(`/characters/${charName}/${matchingSprite.path}`, window.location.origin).href;
                            }
                        }
                        console.log(`[UIE] ✅ Mirrored Character Expression sprite: ${matchingSprite.label} -> ${dataUrl}`);
                    } else {
                        console.warn(`[UIE] No matching sprite found in Character Expressions API results for ${charName} with mood ${mood}`);
                    }
                } else {
                    console.warn(`[UIE] Character Expressions API returned empty array for ${charName}`);
                }
            } else {
                console.warn(`[UIE] Character Expressions API returned ${spriteResponse.status} for ${charName}`);
            }
        } catch (apiErr) {
            console.warn("[UIE] Failed to fetch sprites from Character Expressions API:", apiErr);
        }
    }

    // Fallback: Try custom sprite folder first, then SillyTavern's default
    if (!dataUrl) {
        try {
            const customFolder = getCustomSpriteFolder();
            const charSlug = String(charName).toLowerCase().replace(/[^a-z0-9]+/g, "_");
            const moodSlug = String(mood || "neutral").toLowerCase().replace(/[^a-z0-9]+/g, "_");

            // Method 2: Try custom sprite folder first (if configured)
            if (customFolder) {
                const customPaths = [
                    `${customFolder}/${charSlug}/${moodSlug}.png`,
                    `${customFolder}/${charName}/${mood || "neutral"}.png`,
                    `${customFolder}/${charSlug}/${moodSlug}.webp`,
                    `${customFolder}/${charName}/${mood || "neutral"}.webp`,
                    `${customFolder}/${charSlug}/neutral.png`, // Fallback to neutral
                    `${customFolder}/${charName}/neutral.png`
                ];
                // We'll test these paths in the image loader
                dataUrl = customPaths[0];
            }

            // Method 3: Check Character Expression extension API (if available)
            if (!dataUrl && window.CharacterExpression) {
                try {
                    // Try multiple API methods
                    let exprResult = null;
                    if (typeof window.CharacterExpression.getExpression === "function") {
                        exprResult = window.CharacterExpression.getExpression(charName, mood || "neutral");
                    } else if (typeof window.CharacterExpression.getCurrentExpression === "function") {
                        exprResult = window.CharacterExpression.getCurrentExpression(charName);
                    }

                    if (exprResult) {
                        if (typeof exprResult === "string") {
                            dataUrl = exprResult;
                        } else if (exprResult && exprResult.url) {
                            dataUrl = exprResult.url;
                        } else if (exprResult && exprResult.path) {
                            dataUrl = exprResult.path;
                        }
                        // Convert to absolute URL if relative
                        if (dataUrl && !dataUrl.startsWith("data:") && !dataUrl.startsWith("http")) {
                            dataUrl = new URL(dataUrl, window.location.origin).href;
                        }
                    }
                } catch (_) {}

                // Also check Character Expression extension's stored data
                if (!dataUrl) {
                    try {
                        // Character Expression extension stores data in character objects
                        const chars = window.characters;
                        if (Array.isArray(chars)) {
                            const char = chars.find(c => c.name === charName || c.name.toLowerCase() === charName.toLowerCase());
                            if (char) {
                                // Check for Character Expression extension's sprite override folder
                                const spriteFolderOverride = char.spriteFolderOverride || char.sprite_folder_override || "";
                                // Character Expression extension uses /characters/[name]/[expression].png
                                const basePath = spriteFolderOverride && spriteFolderOverride.includes('/')
                                    ? spriteFolderOverride
                                    : `/characters/${charName}`;

                                // Try expression files with variations (neutral-0, neutral-1, etc.)
                                const exprVariations = [
                                    `${basePath}/${mood || "neutral"}.png`,
                                    `${basePath}/${mood || "neutral"}.webp`,
                                    `${basePath}/${moodSlug}.png`,
                                    `${basePath}/${moodSlug}.webp`,
                                    `${basePath}/neutral.png`, // Fallback
                                    `${basePath}/neutral.webp`
                                ];

                                // Also try numbered variations (neutral-0, neutral-1, etc.)
                                for (let i = 0; i < 10; i++) {
                                    exprVariations.push(`${basePath}/${mood || "neutral"}-${i}.png`);
                                    exprVariations.push(`${basePath}/${mood || "neutral"}-${i}.webp`);
                                }

                                // Convert to absolute URL
                                dataUrl = new URL(exprVariations[0], window.location.origin).href;
                            }
                        }
                    } catch (_) {}
                }
            }

            // Method 3: Direct DOM check - Mirror Character Expression extension's current sprite
            // Check the expression-holder directly (Character Expressions extension's main container)
            if (!dataUrl) {
                try {
                    // Check expression-holder first (most direct)
                    const exprHolder = document.querySelector("#expression-holder img, #expression-wrapper img");
                    if (exprHolder && exprHolder.src && !exprHolder.src.includes("data:image/svg") && !exprHolder.src.includes("default-expressions")) {
                        // Verify this sprite belongs to the current character
                        const context = typeof window.getContext === "function" ? window.getContext() : null;
                        if (context && (context.name2 === charName || context.name === charName)) {
                            dataUrl = exprHolder.src;
                            if (dataUrl && !dataUrl.startsWith("data:") && !dataUrl.startsWith("http")) {
                                dataUrl = new URL(dataUrl, window.location.origin).href;
                            }
                            console.log(`[UIE] ✅ Directly mirrored Character Expression sprite from expression-holder: ${dataUrl}`);
                        }
                    }

                    // Also check chat messages for injected sprites
                    if (!dataUrl) {
                        const chatEl = document.getElementById("chat");
                        if (chatEl) {
                            // Find the last message from this character
                            const allMessages = Array.from(chatEl.querySelectorAll(".mes") || []);
                            let lastMsg = null;
                            for (let i = allMessages.length - 1; i >= 0; i--) {
                                const msg = allMessages[i];
                                const msgCharName = msg.querySelector?.(".mes_name, .name_text, .name")?.textContent?.trim() ||
                                                 msg.getAttribute?.("ch_name") ||
                                                 msg.getAttribute?.("data-name") ||
                                                 "";
                                if (msgCharName && msgCharName.toLowerCase() === charName.toLowerCase()) {
                                    lastMsg = msg;
                                    break;
                                }
                            }

                            // If no character-specific message, use last message
                            if (!lastMsg) {
                                lastMsg = chatEl.querySelector(".mes:last-child");
                            }

                            if (lastMsg) {
                                // Character Expression extension injects images - look for them
                                const exprImgSelectors = [
                                    "img[data-expression]",
                                    "img.expression",
                                    ".expression img",
                                    "#expression-holder img",
                                    "#expression-wrapper img",
                                    "img[data-char-expression]",
                                    ".char-expression img",
                                    ".character-expression img",
                                    "img.character-expression",
                                    "[class*='expression'] img",
                                    "img[class*='expression']"
                                ];

                                for (const selector of exprImgSelectors) {
                                    const exprImg = lastMsg.querySelector(selector) || document.querySelector(selector);
                                    if (exprImg && exprImg.src && !exprImg.src.includes("data:image/svg") && !exprImg.src.includes("default-expressions")) {
                                        dataUrl = exprImg.src;
                                        // Ensure it's an absolute URL
                                        if (dataUrl && !dataUrl.startsWith("data:") && !dataUrl.startsWith("http")) {
                                            dataUrl = new URL(dataUrl, window.location.origin).href;
                                        }
                                        // Validate: ignore root URL
                                        if (dataUrl === window.location.origin + "/") {
                                            dataUrl = null;
                                            continue; // Try next selector
                                        }

                                        console.log(`[UIE] Found Character Expression sprite in DOM: ${dataUrl}`);
                                        break;
                                    }
                                }

                                // Also check for expression data attributes
                                if (!dataUrl) {
                                    const exprData = lastMsg.getAttribute("data-expression") ||
                                                   lastMsg.getAttribute("data-char-expression") ||
                                                   lastMsg.querySelector?.("[data-expression]")?.getAttribute("data-expression");
                                    if (exprData) {
                                        // Character Expression extension uses /characters/[name]/[expression].png
                                        const chars = window.characters;
                                        if (Array.isArray(chars)) {
                                            const char = chars.find(c => c.name === charName || c.name.toLowerCase() === charName.toLowerCase());
                                            if (char) {
                                                const spriteFolderOverride = char.spriteFolderOverride || char.sprite_folder_override || "";
                                                const basePath = spriteFolderOverride && spriteFolderOverride.includes('/')
                                                    ? spriteFolderOverride
                                                    : `/characters/${charName}`;
                                                dataUrl = new URL(`${basePath}/${exprData}.png`, window.location.origin).href;
                                            } else {
                                                dataUrl = new URL(`/characters/${charName}/${exprData}.png`, window.location.origin).href;
                                            }
                                        } else {
                                            dataUrl = new URL(`/characters/${charName}/${exprData}.png`, window.location.origin).href;
                                        }
                                    }
                                }
                            }
                        }
                    }
                } catch (e) {
                    console.warn("[UIE] Error checking Character Expression DOM:", e);
                }
            }

            // Method 4: Try Character Expression extension's standard folder structure
            // Character Expression uses: /characters/[character_name]/[expression].[ext]
            // With support for numbered variations: [expression]-0.png, [expression]-1.png, etc.
            if (!dataUrl) {
                const chars = window.characters;
                if (Array.isArray(chars)) {
                    const char = chars.find(c => c.name === charName || c.name.toLowerCase() === charName.toLowerCase());
                    if (char) {
                        // Character Expression extension uses /characters/[name]/[expression].png
                        // Check for sprite folder override (Character Expression extension supports this)
                        const spriteFolderOverride = char.spriteFolderOverride || char.sprite_folder_override || "";
                        // Character Expression extension paths are always /characters/[name]/[file]
                        const basePath = spriteFolderOverride && spriteFolderOverride.includes('/')
                            ? spriteFolderOverride
                            : `/characters/${charName}`;

                        // Try expression files - Character Expression extension pattern (absolute URLs)
                        const exprPaths = [
                            `${basePath}/${mood || "neutral"}.png`,
                            `${basePath}/${mood || "neutral"}.webp`,
                            `${basePath}/${moodSlug}.png`,
                            `${basePath}/${moodSlug}.webp`
                        ];

                        // Try numbered variations (neutral-0, neutral-1, etc.) - Character Expression extension supports these
                        for (let i = 0; i < 10; i++) {
                            exprPaths.push(`${basePath}/${mood || "neutral"}-${i}.png`);
                            exprPaths.push(`${basePath}/${mood || "neutral"}-${i}.webp`);
                            exprPaths.push(`${basePath}/${moodSlug}-${i}.png`);
                            exprPaths.push(`${basePath}/${moodSlug}-${i}.webp`);
                        }

                        // Fallback to neutral
                        exprPaths.push(`${basePath}/neutral.png`);
                        exprPaths.push(`${basePath}/neutral.webp`);
                        for (let i = 0; i < 10; i++) {
                            exprPaths.push(`${basePath}/neutral-${i}.png`);
                            exprPaths.push(`${basePath}/neutral-${i}.webp`);
                        }

                        // Convert first path to absolute URL
                        dataUrl = new URL(exprPaths[0], window.location.origin).href;
                    }
                }
            }

            // Method 5: Try direct path based on character name (custom folder first, then SillyTavern default)
            if (!dataUrl) {
                // Character Expression extension uses /characters/[name]/[expression].png
                // SillyTavern serves these at /characters/[name]/[file]
                const paths = customFolder ? [
                    // Custom folder paths first (convert to absolute)
                    new URL(`${customFolder}/${charSlug}/${moodSlug}.png`, window.location.origin).href,
                    new URL(`${customFolder}/${charName}/${mood || "neutral"}.png`, window.location.origin).href,
                    new URL(`${customFolder}/${charSlug}/${moodSlug}.webp`, window.location.origin).href,
                    new URL(`${customFolder}/${charName}/${mood || "neutral"}.webp`, window.location.origin).href,
                    // Then SillyTavern default paths (Character Expression extension uses /characters/)
                    new URL(`/characters/${charSlug}/${moodSlug}.png`, window.location.origin).href,
                    new URL(`/characters/${charName}/${mood || "neutral"}.png`, window.location.origin).href,
                    new URL(`/characters/${charSlug}/${moodSlug}.webp`, window.location.origin).href,
                    new URL(`/characters/${charName}/${mood || "neutral"}.webp`, window.location.origin).href
                ] : [
                    // Only SillyTavern default paths if no custom folder (Character Expression extension paths)
                    new URL(`/characters/${charSlug}/${moodSlug}.png`, window.location.origin).href,
                    new URL(`/characters/${charName}/${mood || "neutral"}.png`, window.location.origin).href,
                    new URL(`/characters/${charSlug}/${moodSlug}.webp`, window.location.origin).href,
                    new URL(`/characters/${charName}/${mood || "neutral"}.webp`, window.location.origin).href
                ];
                // Use first path
                dataUrl = paths[0];
            }
        } catch (_) {}
    }

    // If still no image, we can't show anything (or hide it?)
    if (!dataUrl) {
        console.warn(`[UIE] No sprite found for ${charName} with mood ${mood} - tried API, sprite sets, and fallbacks`);
        try { hideSprite(charName); } catch (_) {}
        return;
    }

    console.log(`[UIE] Using sprite URL for ${charName}: ${dataUrl}`);

    // 3. Get or Create Image Element
    const slug = (s) => String(s || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    const id = `re-sprite-${slug(charName)}`;

    // Fix for stacking: If NOT a group chat, hide all other sprites first
    const context = (typeof window.getContext === "function") ? window.getContext() : null;
    // Robust group chat detection: checks for non-empty groupId
    const isGroupChat = !!(context && context.groupId && String(context.groupId).trim() !== "");

    if (!isGroupChat && spriteLayer) {
        // Aggressively hide other sprites
        const otherSprites = Array.from(spriteLayer.querySelectorAll(".re-sprite"));
        otherSprites.forEach(s => {
            if (s.id !== id) {
                s.style.display = "none";
                s.style.visibility = "hidden";
                s.style.opacity = "0";
                // Also remove them from flow to prevent spacing issues
                s.style.position = "absolute";
            }
        });
    }

    let img = document.getElementById(id);

    // Calculate position for group chat (multiple sprites side-by-side)
    const calculateSpritePosition = (charName) => {
        if (!spriteLayer) return { left: "50%", transform: "translateX(-50%)" };

        const ctx = (typeof window.getContext === "function") ? window.getContext() : null;
        const isGroup = !!(ctx && ctx.groupId && String(ctx.groupId).trim() !== "");

        if (!isGroup) {
             return { left: "50%", transform: "translateX(-50%)" };
        }

        // Get all visible sprites
        const allSprites = Array.from(spriteLayer.querySelectorAll(".re-sprite, [id^='re-sprite-']"));
        const visibleSprites = allSprites.filter(s => {
            const style = window.getComputedStyle(s);
            return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
        });

        // Check if it's a group chat (or simply multiple sprites)
        // We now ignore isGroupChat check and simply distribute if > 1 sprite
        if (visibleSprites.length > 1 || (visibleSprites.length > 0 && !visibleSprites.find(s => s.id === id))) {
            // Group chat: position sprites side-by-side
            let currentIndex = visibleSprites.findIndex(s => s.id === id || s.getAttribute("data-char-name") === charName);

            // If new sprite (not in list), append to end
            if (currentIndex === -1) currentIndex = visibleSprites.length;

            // Re-calculate for all, including this one
            const totalSprites = Math.max(visibleSprites.length, currentIndex + 1);
            const spacing = 100 / (totalSprites + 1); // Distribute across viewport
            const leftPercent = spacing * (currentIndex + 1);
            return { left: `${leftPercent}%`, transform: "translateX(-50%)" };
        } else {
            // Single character: center
            return { left: "50%", transform: "translateX(-50%)" };
        }
    };

    if (!img) {
        // Use the spriteLayer we already ensured exists above
        if (!spriteLayer) {
            console.error("[UIE] Sprite layer (re-sprites-layer) not found - cannot create sprite");
            return;
        }
        console.log(`[UIE] Creating new sprite element for ${charName} with ID: ${id}`);
        img = document.createElement("img");
        img.id = id;
        img.className = "re-sprite"; // Use correct class name for CSS styling
        img.alt = charName; // Set alt for interaction
        img.style.position = "absolute";
        img.style.bottom = "22dvh"; // Match CSS default

        // Calculate position (will be updated after all sprites are loaded)
        const pos = calculateSpritePosition(charName);
        img.style.left = pos.left;
        img.style.transform = pos.transform;

        img.style.height = "62dvh"; // Match CSS default
        img.style.width = "auto";
        img.style.maxWidth = "96vw";
        img.style.objectFit = "contain";
        img.style.transition = "left 0.5s ease, height 0.5s ease, filter 0.3s";
        img.style.zIndex = "20"; // Higher z-index to ensure visibility
        img.style.pointerEvents = "none"; // Let clicks pass through to BG
        img.style.display = "block";
        img.style.visibility = "hidden";
        img.style.opacity = "0";
        img.style.maxWidth = "96vw";
        img.style.maxHeight = "96vh";
        img.style.imageRendering = "auto";
        img.setAttribute("data-char-name", charName);
        img.setAttribute("data-sprite-loaded", "false");

        // Force layer to be visible before appending
        spriteLayer.style.display = "block";
        spriteLayer.style.visibility = "visible";
        spriteLayer.style.opacity = "1";

        // Ensure sprite layer is in the DOM and visible before appending
        if (!spriteLayer.parentNode) {
            const reUi = stage.querySelector("#re-ui");
            if (reUi) {
                stage.insertBefore(spriteLayer, reUi);
            } else {
                stage.appendChild(spriteLayer);
            }
            console.log(`[UIE] Sprite layer inserted into reality-stage`);
        }

        spriteLayer.appendChild(img);
        console.log(`[UIE] ✅ Sprite element created and added to layer for ${charName}`);
        console.log(`[UIE] Layer parent: ${spriteLayer.parentNode?.id || 'none'}, display: ${window.getComputedStyle(spriteLayer).display}, visibility: ${window.getComputedStyle(spriteLayer).visibility}`);
        console.log(`[UIE] Stage display: ${stage ? window.getComputedStyle(stage).display : 'N/A'}, visibility: ${stage ? window.getComputedStyle(stage).visibility : 'N/A'}`);
        console.log(`[UIE] Sprite element added to DOM at ${img.offsetLeft},${img.offsetTop}, size: ${img.offsetWidth}x${img.offsetHeight}, waiting for image load...`);
    } else {
        console.log(`[UIE] Using existing sprite element for ${charName}`);
    }

    // Always ensure sprites don't capture pointer (prevents hover/glitch near sprites)
    try { img.style.pointerEvents = "none"; } catch (_) {}

    // Helper function to convert relative paths to absolute URLs
    const toAbsoluteUrl = (path) => {
        if (!path) return "";
        let p = String(path).trim();
        if (!p) return "";

        // If already absolute, return as-is
        if (p.startsWith('http://') || p.startsWith('https://') || p.startsWith('data:')) {
            return p;
        }

        // Handle filesystem paths (backslashes) -> convert to forward slashes
        p = p.replace(/\\/g, '/');

        // Convert relative path to absolute URL
        try {
            // Handle paths starting with / (absolute from root)
            if (p.startsWith('/')) {
                return new URL(p, window.location.origin).href;
            }
            // Handle paths like "user/images/..." - ensure they are treated as relative to root if they look like system paths
            if (p.startsWith('user/') || p.startsWith('characters/') || p.startsWith('scripts/')) {
                return new URL('/' + p, window.location.origin).href;
            }

            // Handle paths that might be relative to current page (which is root)
            return new URL(p, window.location.origin).href;
        } catch (e) {
            console.warn('[UIE] Failed to convert sprite path to absolute URL:', p, e);
            return p;
        }
    };

    // 4. Update Source
    if (img.src !== dataUrl && !img.src.endsWith(dataUrl)) {
        // Convert dataUrl to absolute if it's relative
        if (dataUrl && !dataUrl.startsWith("data:") && !dataUrl.startsWith("http")) {
            dataUrl = toAbsoluteUrl(dataUrl);
        }

        // Validation: Don't try to load if URL is empty or just root
        if (!dataUrl || dataUrl === window.location.origin + "/") {
            console.warn(`[UIE] Invalid sprite URL for ${charName}: ${dataUrl}`);
            img.style.display = "none";
            return;
        }

        // Hide while loading to avoid browser "missing image" placeholders on the projection screen.
        try {
            img.style.visibility = "hidden";
            img.style.opacity = "0";
        } catch (_) {}

        // Try multiple path variations if first attempt fails
        // Priority: Character Expression extension paths first, then custom folder, then SillyTavern default
        let attempts = [dataUrl];
        if (dataUrl && !dataUrl.startsWith("data:") && !dataUrl.startsWith("http")) {
            const customFolder = getCustomSpriteFolder();
            const charSlug = String(charName).toLowerCase().replace(/[^a-z0-9]+/g, "_");
            const moodSlug = String(mood || "neutral").toLowerCase().replace(/[^a-z0-9]+/g, "_");

            // Get Character Expression extension folder override if available
            let charExprFolder = null;
            try {
                const chars = window.characters;
                if (Array.isArray(chars)) {
                    const char = chars.find(c => c.name === charName || c.name.toLowerCase() === charName.toLowerCase());
                    if (char) {
                        const spriteFolderOverride = char.spriteFolderOverride || char.sprite_folder_override || "";
                        // Character Expression extension uses /characters/[name]/[expression].png
                        charExprFolder = spriteFolderOverride && spriteFolderOverride.includes('/')
                            ? spriteFolderOverride
                            : `/characters/${charName}`;
                    }
                }
            } catch (_) {}

            if (charExprFolder) {
                // Character Expression extension paths first (with numbered variations)
                // Convert to absolute URLs - Character Expression uses /characters/[name]/[expression].png
                const charExprBase = charExprFolder.includes('/characters/')
                    ? charExprFolder
                    : `/characters/${charName}`;

                attempts = [
                    dataUrl, // Original path (already converted to absolute)
                    dataUrl.replace(".png", ".webp"), // Same path, different extension
                    // Character Expression extension paths with variations (absolute URLs)
                    toAbsoluteUrl(`${charExprBase}/${mood || "neutral"}.png`),
                    toAbsoluteUrl(`${charExprBase}/${mood || "neutral"}.webp`),
                    toAbsoluteUrl(`${charExprBase}/${moodSlug}.png`),
                    toAbsoluteUrl(`${charExprBase}/${moodSlug}.webp`)
                ];
                // Add numbered variations (neutral-0, neutral-1, etc.)
                for (let i = 0; i < 10; i++) {
                    attempts.push(toAbsoluteUrl(`${charExprBase}/${mood || "neutral"}-${i}.png`));
                    attempts.push(toAbsoluteUrl(`${charExprBase}/${mood || "neutral"}-${i}.webp`));
                }
                // Then custom folder if configured
                if (customFolder) {
                    attempts.push(toAbsoluteUrl(`${customFolder}/${charSlug}/${moodSlug}.png`));
                    attempts.push(toAbsoluteUrl(`${customFolder}/${charName}/${mood || "neutral"}.png`));
                }
                // Finally SillyTavern default paths (convert to absolute)
                attempts.push(toAbsoluteUrl(`/characters/${charSlug}/${moodSlug}.png`));
                attempts.push(toAbsoluteUrl(`/characters/${charName}/${mood || "neutral"}.png`));
            } else if (customFolder) {
                // Custom folder paths first, then SillyTavern default
                attempts = [
                    dataUrl,
                    dataUrl.replace(".png", ".webp"),
                    // Custom folder variations (convert to absolute)
                    toAbsoluteUrl(`${customFolder}/${charSlug}/${moodSlug}.png`),
                    toAbsoluteUrl(`${customFolder}/${charSlug}/${moodSlug}.webp`),
                    toAbsoluteUrl(`${customFolder}/${charName}/${mood || "neutral"}.png`),
                    toAbsoluteUrl(`${customFolder}/${charName}/${mood || "neutral"}.webp`),
                    // SillyTavern default paths (fallback - convert to absolute)
                    toAbsoluteUrl(`/characters/${charSlug}/${moodSlug}.png`),
                    toAbsoluteUrl(`/characters/${charSlug}/${moodSlug}.webp`),
                    toAbsoluteUrl(`/characters/${charName}/${mood || "neutral"}.png`),
                    toAbsoluteUrl(`/characters/${charName}/${mood || "neutral"}.webp`)
                ];
            } else {
                // Only SillyTavern default paths (convert to absolute)
                attempts = [
                    dataUrl,
                    dataUrl.replace(".png", ".webp"),
                    // Try assets/sprites as requested by user
                    toAbsoluteUrl(`/assets/sprites/${charSlug}/${moodSlug}.png`),
                    toAbsoluteUrl(`/assets/sprites/${charName}/${mood || "neutral"}.png`),
                    toAbsoluteUrl(`/assets/sprites/${charSlug}/${moodSlug}.webp`),
                    toAbsoluteUrl(`/assets/sprites/${charName}/${mood || "neutral"}.webp`),
                    // Standard paths
                    toAbsoluteUrl(`/characters/${charSlug}/${moodSlug}.png`),
                    toAbsoluteUrl(`/characters/${charSlug}/${moodSlug}.webp`),
                    toAbsoluteUrl(`/characters/${charName}/${mood || "neutral"}.png`),
                    toAbsoluteUrl(`/characters/${charName}/${mood || "neutral"}.webp`)
                ];
            }
        }

        let attemptIndex = 0;
        // Filter out empty or invalid URLs from attempts
        attempts = attempts.filter(url => url && url.trim() !== "" && url !== window.location.origin + "/");

        const tryNext = () => {
            if (attemptIndex >= attempts.length) {
                img.style.display = "none";
                img.style.visibility = "hidden";
                img.style.opacity = "0";
                return;
            }
            img.src = attempts[attemptIndex];
            attemptIndex++;
        };

        img.onerror = function() {
            console.warn(`[UIE] Failed to load sprite image (attempt ${attemptIndex}/${attempts.length}): ${this.src}`);
            if (attemptIndex >= attempts.length) {
                console.error(`[UIE] All sprite loading attempts failed for ${charName}. Tried:`, attempts);
            }
            tryNext();
        };
        img.onload = function() {
            console.log(`[UIE] Image onload fired for ${charName}`);

            // Force visibility with !important via setAttribute and style
            const currentStyle = this.getAttribute("style") || "";
            this.setAttribute("style", currentStyle + " display: block !important; visibility: visible !important; opacity: 1 !important;");
            this.style.setProperty("display", "block", "important");
            this.style.setProperty("visibility", "visible", "important");
            this.style.setProperty("opacity", "1", "important");
            this.style.display = "block";
            this.style.visibility = "visible";
            this.style.opacity = "1";
            this.setAttribute("data-sprite-loaded", "true");
            this.onerror = null; // Clear error handler once loaded

            // Ensure parent layer is visible and in DOM
            if (spriteLayer) {
                if (!spriteLayer.parentNode && stage) {
                    const reUi = stage.querySelector("#re-ui");
                    if (reUi) {
                        stage.insertBefore(spriteLayer, reUi);
                    } else {
                        stage.appendChild(spriteLayer);
                    }
                    console.log(`[UIE] Sprite layer re-inserted into stage on image load`);
                }
                spriteLayer.style.setProperty("display", "block", "important");
                spriteLayer.style.setProperty("visibility", "visible", "important");
                spriteLayer.style.setProperty("opacity", "1", "important");
                spriteLayer.style.display = "block";
                spriteLayer.style.visibility = "visible";
                spriteLayer.style.opacity = "1";
            }

            // Ensure stage is visible
            if (stage) {
                const stageStyle = window.getComputedStyle(stage);
                if (stageStyle.display === "none" || stageStyle.visibility === "hidden") {
                    console.warn(`[UIE] Reality stage is hidden - forcing visibility for sprite`);
                    stage.style.setProperty("display", "block", "important");
                    stage.style.setProperty("visibility", "visible", "important");
                    stage.style.setProperty("opacity", "1", "important");
                    stage.style.display = "block";
                    stage.style.visibility = "visible";
                    stage.style.opacity = "1";

                    // Also enable in settings
                    try {
                        const s = getSettings();
                        if (s && s.realityEngine) {
                            s.realityEngine.enabled = true;
                            saveSettings();
                        }
                    } catch (_) {}
                }
            }

            // Reposition all sprites for group chat (side-by-side layout)
            if (spriteLayer) {
                const allSprites = Array.from(spriteLayer.querySelectorAll(".re-sprite, [id^='re-sprite-']"));
                const visibleSprites = allSprites.filter(s => {
                    const style = window.getComputedStyle(s);
                    return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
                });

                // Reposition if multiple sprites
                if (visibleSprites.length > 1) {
                    // Reposition all sprites side-by-side
                    visibleSprites.forEach((sprite, index) => {
                        const spacing = 100 / (visibleSprites.length + 1);
                        const leftPercent = spacing * (index + 1);
                        sprite.style.left = `${leftPercent}%`;
                        sprite.style.transform = "translateX(-50%)";
                    });
                    console.log(`[UIE] Repositioned ${visibleSprites.length} sprites for group chat`);
                } else if (visibleSprites.length === 1) {
                    // Single sprite: center it
                    visibleSprites[0].style.left = "50%";
                    visibleSprites[0].style.transform = "translateX(-50%)";
                }
            }

            // Force a reflow to ensure rendering
            void this.offsetWidth;

            console.log(`[UIE] ✅ Sprite loaded successfully: ${charName} (${this.src})`);
            console.log(`[UIE] Sprite computed: display=${window.getComputedStyle(this).display}, visibility=${window.getComputedStyle(this).visibility}, opacity=${window.getComputedStyle(this).opacity}`);
            console.log(`[UIE] Sprite dimensions: ${this.naturalWidth}x${this.naturalHeight}, displayed: ${this.offsetWidth}x${this.offsetHeight}`);
            console.log(`[UIE] Sprite position: left=${this.style.left}, bottom=${this.style.bottom}, z-index=${window.getComputedStyle(this).zIndex}`);
            console.log(`[UIE] Sprite parent: ${this.parentNode?.id || 'none'}, parent display: ${this.parentNode ? window.getComputedStyle(this.parentNode).display : 'N/A'}`);
        };

        tryNext();
    } else {
        // Image already exists, just ensure it's visible
        console.log(`[UIE] Using existing sprite element for ${charName}, ensuring visibility`);
        img.style.display = "block";
        img.style.visibility = "visible";
        img.style.opacity = "1";

        // Force parent layer visibility
        if (spriteLayer) {
            spriteLayer.style.display = "block";
            spriteLayer.style.visibility = "visible";
            spriteLayer.style.opacity = "1";
        }

        // If image is already loaded, ensure it's showing
        if (img.complete && img.naturalHeight > 0) {
            img.style.display = "block";
            img.style.visibility = "visible";
            img.style.opacity = "1";
            console.log(`[UIE] ✅ Existing sprite element made visible for ${charName} (${img.naturalWidth}x${img.naturalHeight})`);
        } else {
            console.log(`[UIE] Existing sprite element for ${charName} - image not loaded yet (complete: ${img.complete})`);
        }
    }

    // 5. Position [Pos: Left|Center|Right]
    // In group chat with multiple sprites visible, DO NOT override the side-by-side layout.
    let groupLayoutActive = false;
    try {
        if (spriteLayer) {
            const allSprites = Array.from(spriteLayer.querySelectorAll(".re-sprite, [id^='re-sprite-']"));
            const visibleSprites = allSprites.filter(s => {
                const st = window.getComputedStyle(s);
                return st.display !== "none" && st.visibility !== "hidden" && st.opacity !== "0";
            });
            const ctx = (typeof window.getContext === "function") ? window.getContext() : null;
            const isGroupChat = !!(ctx && ctx.groupId !== null && ctx.groupId !== undefined);
            groupLayoutActive = isGroupChat && visibleSprites.length > 1;
        }
    } catch (_) {}

    if (!groupLayoutActive) {
        const pos = extractTagValue(text, "Pos").toLowerCase();
        if (pos === "left") {
            img.style.left = "20%";
        } else if (pos === "right") {
            img.style.left = "80%";
        } else if (pos === "center") {
            img.style.left = "50%";
        }
    }
    // Default is usually center or whatever CSS set

    // 6. Distance/Zoom [Dist: Far|Normal|Close]
    const dist = extractTagValue(text, "Dist").toLowerCase();
    if (dist === "far") {
        img.style.height = "50vh"; // 50dvh
        img.style.filter = "brightness(0.9)";
    } else if (dist === "close") {
        img.style.height = "95vh"; // 95dvh
    } else if (dist === "normal") {
        img.style.height = "75vh"; // 70dvh
        img.style.filter = "none";
    } else {
        // Default height if not set
        if (!img.style.height) img.style.height = "75vh";
    }

    // 7. Mood/Emotion Animations [Mood: Angry]
    // Reset animations
    img.style.animation = "none";
    void img.offsetWidth; // Trigger reflow

    const keywords = text.toLowerCase();
    if (mood === "angry" || keywords.includes("shouts") || keywords.includes("anger")) {
        img.style.animation = "re-shake 0.3s";
    } else if (mood === "happy" || keywords.includes("laughs") || keywords.includes("giggles")) {
        img.style.animation = "re-bounce 0.4s";
    }
}

export function hideSprite(charName) {
    if (!charName) return;
    const slug = (s) => String(s || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    const id = `re-sprite-${slug(charName)}`;
    const img = document.getElementById(id);
    if (img) {
        img.style.display = "none";
        // Optional: Remove from DOM to keep it clean?
        // img.remove();
    }
}

// Clears the current "scene" sprites (used on location changes).
// This is intentionally conservative: we hide/remove all sprites so no one "follows" unless the chat explicitly brings them in.
export function clearAllSprites({ remove = false } = {}) {
    try {
        const layer = document.getElementById("re-sprites-layer");
        if (!layer) return;
        const sprites = Array.from(layer.querySelectorAll(".re-sprite, [id^='re-sprite-']"));
        sprites.forEach((el) => {
            try {
                el.style.display = "none";
                el.style.opacity = "0";
                el.style.visibility = "hidden";
                if (remove) el.remove();
            } catch (_) {}
        });
    } catch (_) {}
}

export function initSprites() {
    if (bound) return;
    bound = true;

    // Set up automatic sprite updates on message events
    try {
        if (typeof window.eventSource !== "undefined" && window.eventSource) {
            // Listen for character messages to update sprites automatically
            window.eventSource.on(window.event_types?.CHARACTER_MESSAGE_RENDERED || "character_message_rendered", (messageId, type) => {
                if (type === 'impersonate') return;

                // Get the message from chat array
                if (typeof window.chat !== "undefined" && Array.isArray(window.chat)) {
                    const message = window.chat.find(m => m.mesId === messageId);
                    if (message && !message.is_user && message.name) {
                        const charName = message.name;
                        const messageText = message.mes || message.text || "";
                        console.log(`[UIE] Auto-updating sprite for ${charName} from CHARACTER_MESSAGE_RENDERED event`);
                        updateSpriteStage(messageText, charName, true).catch(err => {
                            console.error(`[UIE] Auto-sprite update failed for ${charName}:`, err);
                        });
                    }
                }
            });

            // Also listen for MESSAGE_RECEIVED as backup
            window.eventSource.on(window.event_types?.MESSAGE_RECEIVED || "message_received", (messageId, type) => {
                if (type === 'impersonate') return;

                // Get the message from chat array
                if (typeof window.chat !== "undefined" && Array.isArray(window.chat)) {
                    const message = window.chat.find(m => m.mesId === messageId);
                    if (message && !message.is_user && message.name) {
                        const charName = message.name;
                        const messageText = message.mes || message.text || "";
                        console.log(`[UIE] Auto-updating sprite for ${charName} from MESSAGE_RECEIVED event`);
                        updateSpriteStage(messageText, charName, true).catch(err => {
                            console.error(`[UIE] Auto-sprite update failed for ${charName}:`, err);
                        });
                    }
                }
            });

            // Mirror Character Expressions extension sprites in real-time (NON-INTRUSIVE)
            // Only watch for changes, don't interfere with Character Expressions' own functionality
            const setupExpressionMirror = () => {
                const expressionHolder = document.querySelector("#expression-holder, #expression-wrapper");
                if (expressionHolder) {
                    const exprObserver = new MutationObserver((mutations) => {
                        // Debounce to avoid too many updates
                        clearTimeout(window.uieExpressionMirrorTimeout);
                        window.uieExpressionMirrorTimeout = setTimeout(() => {
                            for (const mutation of mutations) {
                                // Watch for src changes on images (Character Expressions updates these)
                                if (mutation.type === 'attributes' && mutation.attributeName === 'src') {
                                    const img = mutation.target;
                                    if (img && img.src && !img.src.includes("data:image/svg") && !img.src.includes("default-expressions")) {
                                        // Find which character this sprite belongs to
                                        const context = typeof window.getContext === "function" ? window.getContext() : null;
                                        if (context) {
                                            const charName = context.name2 || context.name;
                                            if (charName) {
                                                console.log(`[UIE] Character Expression sprite changed for ${charName}, mirroring to projection`);
                                                // Get the last message to determine expression
                                                if (typeof window.chat !== "undefined" && Array.isArray(window.chat) && window.chat.length > 0) {
                                                    const lastMsg = window.chat[window.chat.length - 1];
                                                    if (lastMsg && !lastMsg.is_user && lastMsg.name === charName) {
                                                        // Use the actual sprite URL from Character Expressions
                                                        updateSpriteStage(lastMsg.mes || lastMsg.text || "", charName, true).catch(err => {
                                                            console.error(`[UIE] Failed to mirror sprite for ${charName}:`, err);
                                                        });
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                                // Watch for new images being added
                                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                                    for (const node of mutation.addedNodes) {
                                        if (node.nodeType === 1) { // Element node
                                            const img = node.tagName === 'IMG' ? node : node.querySelector('img');
                                            if (img && img.src && !img.src.includes("data:image/svg") && !img.src.includes("default-expressions")) {
                                                const context = typeof window.getContext === "function" ? window.getContext() : null;
                                                if (context) {
                                                    const charName = context.name2 || context.name;
                                                    if (charName) {
                                                        console.log(`[UIE] New Character Expression sprite detected for ${charName}, mirroring`);
                                                        if (typeof window.chat !== "undefined" && Array.isArray(window.chat) && window.chat.length > 0) {
                                                            const lastMsg = window.chat[window.chat.length - 1];
                                                            if (lastMsg && !lastMsg.is_user && lastMsg.name === charName) {
                                                                updateSpriteStage(lastMsg.mes || lastMsg.text || "", charName, true).catch(err => {
                                                                    console.error(`[UIE] Failed to mirror new sprite for ${charName}:`, err);
                                                                });
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }, 300); // Debounce 300ms
                    });

                    exprObserver.observe(expressionHolder, {
                        attributes: true,
                        attributeFilter: ['src'],
                        subtree: true,
                        childList: true
                    });

                    console.log("[UIE] ✅ Character Expressions mirror observer initialized (non-intrusive)");
                    return exprObserver;
                }
                return null;
            };

            // Try to set up observer immediately
            let exprObserver = setupExpressionMirror();

            // If expression-holder doesn't exist yet, wait for it (Character Expressions loads after page load)
            if (!exprObserver) {
                const checkInterval = setInterval(() => {
                    exprObserver = setupExpressionMirror();
                    if (exprObserver) {
                        clearInterval(checkInterval);
                    }
                }, 500);

                // Stop checking after 10 seconds
                setTimeout(() => clearInterval(checkInterval), 10000);
            }

            console.log("[UIE] Sprite auto-update listeners initialized");
        }
    } catch (e) {
        console.error("[UIE] Failed to set up sprite auto-update listeners:", e);
    }

    // --- UI EVENT BINDING ---
    // Replaced $(document).on with specific window binding to avoid conflict with the Nuclear Blocker.
    // Listeners are now attached to #uie-sprites-window (via openSprites -> bindWindow logic)
    // AND we bind to document only for elements that are OUTSIDE the window (unlikely for this module).

    // We remove the document-level bindings that conflict with the blocker.
    $(document).off(".uieSprites");

    // We still keep the creation logic bound to the window via bindWindow.
    // BUT openSprites() is what triggers it.

    // Legacy support: If the window is already open, we might need to re-bind.
    const $w = $("#uie-sprites-window");
    if ($w.length) bindWindow($w[0]);

    console.log("[UIE] Living Sprite System Initialized");

    // Also set up a periodic check to ensure sprites are visible (in case they get hidden)
    setInterval(() => {
        try {
            const layer = document.getElementById("re-sprites-layer");
            const stage = document.getElementById("reality-stage");
            if (layer && stage) {
                const layerStyle = window.getComputedStyle(layer);
                const stageStyle = window.getComputedStyle(stage);

                // If layer is hidden but stage is visible, force layer visible
                if (stageStyle.display !== "none" && (layerStyle.display === "none" || layerStyle.visibility === "hidden")) {
                    console.log("[UIE] Sprite layer was hidden, forcing visibility");
                    layer.style.display = "block";
                    layer.style.visibility = "visible";
                    layer.style.opacity = "1";
                }

                // Ensure all sprites in layer are visible
                const sprites = layer.querySelectorAll(".re-sprite, [id^='re-sprite-']");
                sprites.forEach(sprite => {
                    if (sprite.complete && sprite.naturalHeight > 0) {
                        const spriteStyle = window.getComputedStyle(sprite);
                        if (spriteStyle.display === "none" || spriteStyle.visibility === "hidden") {
                            sprite.style.display = "block";
                            sprite.style.visibility = "visible";
                            sprite.style.opacity = "1";
                        }
                    }
                });
            }
        } catch (e) {
            // Silent fail for periodic check
        }
    }, 2000); // Check every 2 seconds
}

function bindWindow(win) {
    if (!win) return;
    const $w = $(win);

    // Prevent multiple bindings
    if (win.dataset.uieBound === "1") return;
    win.dataset.uieBound = "1";

    // Stop propagation for the window itself to prevent ST interactions
    $w.on("mousedown pointerdown touchstart click", function(e) {
        // Allow inputs to work but stop bubble
        e.stopPropagation();
    });

    $w.on("click.uieSprites", "#uie-sprites-close", (e) => {
        e.preventDefault(); e.stopPropagation();
        $w.hide();
    });

    $w.on("change.uieSprites", "#uie-sprites-set", function (e) {
        e.stopPropagation();
        activeSet = String($(this).val() || "");
        renderList();
    });

    $w.on("change.uieSprites", "#uie-sprites-cat", function (e) {
        e.stopPropagation();
        category = String($(this).val() || "default");
        renderList();
    });

    $w.on("click.uieSprites", "#uie-sprites-create", function (e) {
        e.preventDefault(); e.stopPropagation();
        const name = String($("#uie-sprites-new").val() || "").trim().slice(0, 80);
        if (!name) return;
        const s = getSettings();
        ensureSpriteStore(s);
        if (!s.realityEngine.sprites.sets[name]) s.realityEngine.sprites.sets[name] = { expressions: {} };
        saveSettings();
        activeSet = name;
        $("#uie-sprites-new").val("");
        renderSetSelect();
        renderList();
    });

    $w.on("click.uieSprites", "#uie-sprites-add", function (e) {
        e.preventDefault(); e.stopPropagation();
        const key = String($("#uie-sprites-add-key").val() || "").trim();
        const nk = normalizeKey(key);
        if (!nk || !activeSet) return;
        const s = getSettings();
        ensureSpriteStore(s);
        const sets = s.realityEngine.sprites.sets;
        if (!sets[activeSet] || typeof sets[activeSet] !== "object") sets[activeSet] = { expressions: {} };
        if (!sets[activeSet].expressions || typeof sets[activeSet].expressions !== "object") sets[activeSet].expressions = {};
        if (!sets[activeSet].expressions[nk]) sets[activeSet].expressions[nk] = { dataUrl: "", fileName: "" };
        saveSettings();
        $("#uie-sprites-add-key").val("");
        renderList();
    });

    $w.on("click.uieSprites", ".uie-spr-pick", function (e) {
        e.preventDefault(); e.stopPropagation();
        const row = $(this).closest(".uie-spr-row");
        const inp = row.find(".uie-spr-file");
        // Ensure input is reset so change event fires even if same file selected
        inp.val("");
        // Trigger click on the underlying input
        inp.trigger("click");
    });

    $w.on("change.uieSprites", ".uie-spr-file", async function (e) {
        e.stopPropagation(); // Stop here
        const row = $(this).closest(".uie-spr-row");
        const key = String(row.attr("data-key") || "");
        const f = e.target && e.target.files ? e.target.files[0] : null;
        const dataUrl = await readFileAsDataUrl(f);
        if (!activeSet || !key) return;
        if (!dataUrl) return;
        saveSetExpression(activeSet, key, dataUrl, String(f?.name || ""));
        renderList();
    });

    $w.on("click.uieSprites", ".uie-spr-clear", function (e) {
        e.preventDefault(); e.stopPropagation();
        const row = $(this).closest(".uie-spr-row");
        const key = String(row.attr("data-key") || "");
        if (!activeSet || !key) return;
        saveSetExpression(activeSet, key, "", "");
        renderList();
    });

    // Load and display custom sprite folder path
    const folderInput = document.getElementById("uie-sprites-custom-folder");
    if (folderInput) {
        const s = getSettings();
        ensureSpriteStore(s);
        folderInput.value = s.realityEngine.sprites.customSpriteFolder || "";
    }

    // Save custom sprite folder path
    $w.on("click.uieSprites", "#uie-sprites-save-folder", function (e) {
        e.preventDefault();
        e.stopPropagation();
        const folderInput = document.getElementById("uie-sprites-custom-folder");
        if (!folderInput) return;
        const path = String(folderInput.value || "").trim();
        const s = getSettings();
        ensureSpriteStore(s);
        s.realityEngine.sprites.customSpriteFolder = path;
        saveSettings();
        try { notify("success", path ? `Custom sprite folder set: ${path}` : "Using SillyTavern default folder", "Sprites"); } catch (_) {}
    });
}

export function openSprites() {
    renderSetSelect();
    try { $("#uie-sprites-cat").val(category || "default"); } catch (_) {}
    renderList();
    const win = document.getElementById("uie-sprites-window");
    if (win) {
        win.style.display = "flex";
        bindWindow(win);
        // Load custom folder path when opening
        const folderInput = document.getElementById("uie-sprites-custom-folder");
        if (folderInput) {
            const s = getSettings();
            ensureSpriteStore(s);
            folderInput.value = s.realityEngine.sprites.customSpriteFolder || "";
        }
    }
}
