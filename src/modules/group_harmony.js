/**
 * Group Harmony Extension
 * - Character Drawer Integration
 * - Quick Persona Button Cloning
 * - Group Chat Sprite Support
 */

import { getSettings, saveSettings } from "./core.js";
import { notify } from "./notifications.js";
import { updateSpriteStage } from "./sprites.js";

let personaObserver = null;
let clonedPersonaContainer = null;

/**
 * Initialize Character Drawer Button
 * Creates a button that triggers the native SillyTavern Character Drawer
 */
function initCharacterDrawerButton() {
    try {
        // Find the send button sheath (input bar area)
        const sendSheath = document.querySelector("#send_but_sheath");
        if (!sendSheath) {
            console.warn("[UIE Group Harmony] send_but_sheath not found");
            return;
        }
        
        // Check if button already exists
        if (document.querySelector("#uie-char-drawer-btn")) {
            return;
        }
        
        // Create the character drawer button
        const drawerBtn = document.createElement("button");
        drawerBtn.id = "uie-char-drawer-btn";
        drawerBtn.className = "uie-char-drawer-btn";
        drawerBtn.title = "Open Character List";
        drawerBtn.innerHTML = '<i class="fa-solid fa-users"></i>';
        
        // Style the button
        drawerBtn.style.cssText = `
            background: rgba(100, 100, 120, 0.3);
            border: 1px solid rgba(150, 150, 170, 0.5);
            border-radius: 8px;
            color: #fff;
            cursor: pointer;
            padding: 8px 12px;
            margin-left: 8px;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 16px;
        `;
        
        drawerBtn.addEventListener("mouseenter", () => {
            drawerBtn.style.background = "rgba(100, 100, 120, 0.5)";
            drawerBtn.style.borderColor = "rgba(150, 150, 170, 0.8)";
        });
        
        drawerBtn.addEventListener("mouseleave", () => {
            drawerBtn.style.background = "rgba(100, 100, 120, 0.3)";
            drawerBtn.style.borderColor = "rgba(150, 150, 170, 0.5)";
        });
        
        // Click handler - trigger native character drawer
        drawerBtn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            // Find and click the native character drawer button
            const nativeBtn = document.querySelector("#rm_button_characters");
            if (nativeBtn) {
                nativeBtn.click();
            } else {
                // Fallback: try alternative selectors
                const altBtn = document.querySelector(".rm_button_characters, [data-id='characters'], .character-drawer-btn");
                if (altBtn) {
                    altBtn.click();
                } else {
                    console.warn("[UIE Group Harmony] Character drawer button not found");
                    notify("warn", "Character drawer button not found", "Group Harmony");
                }
            }
        });
        
        // Insert after the impersonate button (Sparkle button)
        const impersonateBtn = document.querySelector("#impersonate_button");
        if (impersonateBtn && impersonateBtn.parentElement) {
            impersonateBtn.parentElement.insertBefore(drawerBtn, impersonateBtn.nextSibling);
        } else {
            // Fallback: append to send sheath
            sendSheath.appendChild(drawerBtn);
        }
        
        console.log("[UIE Group Harmony] Character drawer button initialized");
    } catch (e) {
        console.error("[UIE Group Harmony] Failed to init character drawer button:", e);
    }
}

/**
 * Clone Quick Persona buttons
 * Creates a visual copy next to the Sparkle button
 */
function cloneQuickPersonaButtons() {
    try {
        // Find the original Quick Persona container
        const originalContainer = document.querySelector("#quick-persona-container, .quick-persona-buttons, .quick-persona-container");
        if (!originalContainer) {
            // Try again after a delay - extension might load later
            setTimeout(cloneQuickPersonaButtons, 1000);
            return;
        }
        
        // Check if already cloned
        if (document.querySelector("#uie-cloned-persona-container")) {
            return;
        }
        
        // Create clone container
        clonedPersonaContainer = document.createElement("div");
        clonedPersonaContainer.id = "uie-cloned-persona-container";
        clonedPersonaContainer.className = "uie-cloned-persona-container";
        clonedPersonaContainer.style.cssText = `
            display: flex;
            gap: 6px;
            align-items: center;
            margin-left: 8px;
        `;
        
        // Clone all persona buttons
        const personaButtons = originalContainer.querySelectorAll("button, .persona-button, [data-persona-id]");
        personaButtons.forEach((originalBtn, index) => {
            const clonedBtn = originalBtn.cloneNode(true);
            clonedBtn.id = `uie-cloned-persona-${index}`;
            clonedBtn.classList.add("uie-cloned-persona-btn");
            
            // Remove any existing event listeners by cloning
            const newBtn = clonedBtn.cloneNode(true);
            
            // Add delegate click handler
            newBtn.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                // Find the original button and click it
                const personaId = originalBtn.getAttribute("data-persona-id") || 
                                 originalBtn.getAttribute("data-id") ||
                                 originalBtn.id;
                
                // Try to find original by various attributes
                let targetBtn = originalBtn;
                if (personaId) {
                    const found = originalContainer.querySelector(`[data-persona-id="${personaId}"], [data-id="${personaId}"], #${personaId}`);
                    if (found) targetBtn = found;
                }
                
                // Click the original button
                if (targetBtn) {
                    targetBtn.click();
                } else {
                    console.warn("[UIE Group Harmony] Could not find original persona button");
                }
            });
            
            clonedPersonaContainer.appendChild(newBtn);
        });
        
        // Insert after impersonate button
        const impersonateBtn = document.querySelector("#impersonate_button");
        if (impersonateBtn && impersonateBtn.parentElement) {
            impersonateBtn.parentElement.insertBefore(clonedPersonaContainer, impersonateBtn.nextSibling);
        } else {
            // Fallback: append to send sheath
            const sendSheath = document.querySelector("#send_but_sheath");
            if (sendSheath) {
                sendSheath.appendChild(clonedPersonaContainer);
            }
        }
        
        console.log("[UIE Group Harmony] Quick Persona buttons cloned");
        
        // Set up MutationObserver to watch for changes
        setupPersonaObserver(originalContainer);
    } catch (e) {
        console.error("[UIE Group Harmony] Failed to clone persona buttons:", e);
    }
}

/**
 * Set up MutationObserver to sync persona button changes
 */
function setupPersonaObserver(originalContainer) {
    try {
        if (personaObserver) {
            personaObserver.disconnect();
        }
        
        personaObserver = new MutationObserver((mutations) => {
            // Check if buttons were added/removed
            let shouldUpdate = false;
            for (const mutation of mutations) {
                if (mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0) {
                    shouldUpdate = true;
                    break;
                }
            }
            
            if (shouldUpdate) {
                // Debounce updates
                clearTimeout(window.uiePersonaUpdateTimeout);
                window.uiePersonaUpdateTimeout = setTimeout(() => {
                    // Remove old clone
                    if (clonedPersonaContainer) {
                        clonedPersonaContainer.remove();
                        clonedPersonaContainer = null;
                    }
                    // Re-clone
                    cloneQuickPersonaButtons();
                }, 300);
            }
        });
        
        personaObserver.observe(originalContainer, {
            childList: true,
            subtree: true,
            attributes: false
        });
        
        console.log("[UIE Group Harmony] Persona observer set up");
    } catch (e) {
        console.error("[UIE Group Harmony] Failed to set up persona observer:", e);
    }
}

/**
 * Update sprites for group chat
 * Shows sprites for all active characters in group chat in projection environment
 */
export function updateGroupChatSprites() {
    try {
        // Check if it's a group chat (context or fallback detection)
        let context = null;
        try { if (typeof window.getContext === "function") context = window.getContext(); } catch (_) {}
        const ctxGroupId = context?.groupId;
        const selectedGroupId = (typeof window.selected_group !== "undefined") ? window.selected_group : null;
        const groupId = (ctxGroupId !== null && ctxGroupId !== undefined) ? ctxGroupId : selectedGroupId;

        // Fallback: treat as group if multiple distinct non-user speakers in recent chat
        const recentMessages = typeof window.chat !== "undefined" && Array.isArray(window.chat) 
            ? window.chat.slice(-12).reverse()
            : [];
        const recentSpeakers = new Set(recentMessages.filter(m => m && !m.is_user && m.name).map(m => m.name));
        const looksLikeGroup = recentSpeakers.size > 1;

        if (!groupId && !looksLikeGroup) {
            return; // Not a group chat
        }
            
        // Get group members if available
        const groups = context?.groups || window.groups || window.group_data || [];
        const group = (groupId !== null && groupId !== undefined) ? groups?.find?.(g => g.id === groupId) : null;
            
        // Get the last message to determine who should be shown
        if (typeof window.chat !== "undefined" && Array.isArray(window.chat) && window.chat.length > 0) {
            const lastMessage = window.chat[window.chat.length - 1];
            
            // If last message is from a character, show their sprite
            if (!lastMessage.is_user && lastMessage.name) {
                const charName = lastMessage.name;
                const messageText = lastMessage.mes || lastMessage.text || "";
                // Update sprite for this character with their message text
                updateSpriteStage(messageText, charName, true).catch(err => {
                    console.warn("[UIE Group Harmony] Failed to update sprite for", charName, err);
                });
            }
        }
            
        // Also update sprites for all group members based on recent messages
        // This ensures all characters in the group appear in the projection environment
        const shownCharacters = new Set();
        
        // Show sprites for characters who have spoken recently
        for (const msg of recentMessages) {
            if (!msg.is_user && msg.name && !shownCharacters.has(msg.name)) {
                shownCharacters.add(msg.name);
                const messageText = msg.mes || msg.text || "";
                updateSpriteStage(messageText, msg.name, true).catch(err => {
                    console.warn("[UIE Group Harmony] Failed to update sprite for", msg.name, err);
                });
            }
        }
            
        // Also ensure active group members are shown (even if they haven't spoken recently)
        if (group?.members && Array.isArray(group.members) && Array.isArray(context?.characters)) {
            for (const memberAvatar of group.members) {
                const char = context.characters?.find(c => c.avatar === memberAvatar);
                if (char && char.name && !shownCharacters.has(char.name)) {
                    // Show sprite for member (with empty text to just display their sprite)
                    updateSpriteStage("", char.name, true).catch(err => {
                        console.warn("[UIE Group Harmony] Failed to update sprite for", char.name, err);
                    });
                }
            }
        }
            
        // After all sprites are updated, reposition them for group chat layout
        setTimeout(() => {
            try {
                const spriteLayer = document.getElementById("re-sprites-layer");
                if (spriteLayer) {
                    const allSprites = Array.from(spriteLayer.querySelectorAll(".re-sprite, [id^='re-sprite-']"));
                    const visibleSprites = allSprites.filter(s => {
                        const style = window.getComputedStyle(s);
                        return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
                    });
                    
                    if (visibleSprites.length > 1) {
                        // Reposition all sprites side-by-side
                        visibleSprites.forEach((sprite, index) => {
                            const spacing = 100 / (visibleSprites.length + 1);
                            const leftPercent = spacing * (index + 1);
                            sprite.style.left = `${leftPercent}%`;
                            sprite.style.transform = "translateX(-50%)";
                        });
                        console.log(`[UIE Group Harmony] Repositioned ${visibleSprites.length} sprites for group chat`);
                    }
                }
            } catch (err) {
                console.warn("[UIE Group Harmony] Failed to reposition sprites:", err);
            }
        }, 500); // Wait a bit for sprites to load
    } catch (e) {
        console.error("[UIE Group Harmony] Failed to update group chat sprites:", e);
    }
}

/**
 * Initialize Group Harmony extension
 */
export function initGroupHarmony() {
    try {
        // Wait for DOM to be ready
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", () => {
                setTimeout(initGroupHarmony, 500);
            });
            return;
        }
        
        // Initialize character drawer button
        initCharacterDrawerButton();
        
        // Clone Quick Persona buttons (with retry)
        cloneQuickPersonaButtons();
        
        // Set up group chat sprite updates
        if (typeof window.eventSource !== "undefined" && window.eventSource) {
            // Update sprites when messages are received
            window.eventSource.on(window.event_types?.MESSAGE_RECEIVED || "message_received", (messageId, type) => {
                if (type !== 'impersonate') {
                    updateGroupChatSprites();
                }
            });
            
            // Update sprites when character messages are rendered
            window.eventSource.on(window.event_types?.CHARACTER_MESSAGE_RENDERED || "character_message_rendered", (messageId, type) => {
                if (type !== 'impersonate') {
                    updateGroupChatSprites();
                }
            });
            
            // Update sprites when group changes
            window.eventSource.on(window.event_types?.GROUP_UPDATED || "group_updated", () => {
                updateGroupChatSprites();
            });
            
            // Update sprites when group member is drafted (during group generation)
            window.eventSource.on(window.event_types?.GROUP_MEMBER_DRAFTED || "group_member_drafted", (charId) => {
                updateGroupChatSprites();
            });
        }
        
        console.log("[UIE Group Harmony] Initialized");
    } catch (e) {
        console.error("[UIE Group Harmony] Initialization failed:", e);
    }
}
