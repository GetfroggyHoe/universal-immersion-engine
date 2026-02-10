
import { getSettings, saveSettings } from "./core.js";
import { injectRpEvent } from "./features/rp_log.js";
import { notify } from "./notifications.js";

// --- CHAT SYNC MODULE (v4.0) ---

let chatObserver = null;
let reverseSyncInt = null;
let chatSyncInited = false;

export function initChatSync() {
    if (chatSyncInited) return;
    chatSyncInited = true;
    initInputSync();
    initChatObserver();
    initReverseSync();
    initWandProxy();
}

export function stopChatSync() {
    chatSyncInited = false;
    try {
        if (chatObserver) chatObserver.disconnect();
    } catch (_) {}
    chatObserver = null;

    try {
        if (reverseSyncInt) clearInterval(reverseSyncInt);
    } catch (_) {}
    reverseSyncInt = null;
}

// A. Input Box (Mirror Logic)
function initInputSync() {
    const reInput = document.getElementById("re-input-bar");
    if (!reInput) return;

    try {
        if (reInput.__uieChatSyncInputBound) return;
        reInput.__uieChatSyncInputBound = true;
    } catch (_) {}

    reInput.addEventListener("keyup", (e) => {
        const stInput = document.getElementById("send_textarea");
        if (stInput) {
            stInput.value = reInput.value;
            // Trigger input event for frameworks (Vue/React/etc)
            stInput.dispatchEvent(new Event("input", { bubbles: true }));
        }

        // Typing indicator
        if (typeof window.sendUserIsTyping === "function") {
            window.sendUserIsTyping();
        }
    });

    reInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            const stSend = document.getElementById("send_but");
            if (stSend) stSend.click();
            reInput.value = ""; // Clear immediately for UX
        }
    });
}

// B. Chat Log (Observer)
function initChatObserver() {
    const stChat = document.getElementById("chat");
    const reChatLog = document.getElementById("re-chat-log");

    if (!stChat || !reChatLog) return;

    // Initial load of last few messages
    syncLastMessages(stChat, reChatLog);

    try {
        if (chatObserver) chatObserver.disconnect();
    } catch (_) {}

    chatObserver = new MutationObserver((mutations) => {
        const s = getSettings();
        if (s?.realityEngine?.enabled !== true) return;

        mutations.forEach((mutation) => {
            if (mutation.addedNodes.length) {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === 1 && node.classList.contains("mes")) {
                        cloneMessage(node, reChatLog);
                        // Auto-save on every new message
                        saveSettings();
                    }
                });
            }
        });
    });

    chatObserver.observe(stChat, { childList: true });
}

function syncLastMessages(stChat, reChatLog) {
    reChatLog.innerHTML = "";
    const messages = stChat.querySelectorAll(".mes");
    // Grab last 20 to avoid lag
    const slice = Array.from(messages).slice(-20);
    slice.forEach(msg => cloneMessage(msg, reChatLog));
}

function cloneMessage(stMsg, reChatLog) {
    // Clone and strip internal ST classes if needed, or keep them for styling consistency
    // We wrap it to add our controls
    const wrapper = document.createElement("div");
    wrapper.className = "re-msg-wrapper";
    wrapper.style.position = "relative";
    wrapper.style.marginBottom = "10px";

    // Clone the content
    const clone = stMsg.cloneNode(true);
    // Remove ST specific IDs to prevent duplicates
    clone.removeAttribute("id");

    // Append to wrapper
    wrapper.appendChild(clone);

    // Add Controls Hover
    const controls = document.createElement("div");
    controls.className = "re-msg-controls";
    controls.style.display = "none"; // Show on hover via CSS
    controls.style.position = "absolute";
    controls.style.top = "-10px";
    controls.style.right = "10px";
    controls.style.background = "rgba(0,0,0,0.8)";
    controls.style.borderRadius = "8px";
    controls.style.padding = "4px";
    controls.style.gap = "6px";
    controls.style.zIndex = "10";

    // Edit
    const btnEdit = createCtrlBtn("fa-pencil", "Edit", () => {
        // Trigger ST Edit
        // We can't easily "click" the hidden edit button inside the clone,
        // we need to find the original message ID.
        const msgId = stMsg.getAttribute("mesid");
        if (typeof window.editMessage === "function") {
             // SillyTavern global
             // Actually ST uses event delegation mostly.
             // Try clicking the edit button in the REAL message
             const realEdit = stMsg.querySelector(".mes_edit");
             if (realEdit) realEdit.click();
        }
    });

    // Delete
    const btnDel = createCtrlBtn("fa-trash", "Delete", () => {
        const realDel = stMsg.querySelector(".mes_del");
        if (realDel) realDel.click();
    });

    // Swipe
    const btnSwipe = createCtrlBtn("fa-rotate", "Swipe", () => {
        const realSwipe = stMsg.querySelector(".mes_regenerate"); // check selector
        // ST usually puts swipe in a different place or it's part of the last message controls
        // If it's a specific message, we might need to trigger the generation function directly.
        // For now, let's try finding the swipe button in the real message
        const swipe = stMsg.querySelector(".swipe_left") || stMsg.querySelector(".swipe_right");
        if (swipe) swipe.click();
        else {
             // Fallback: Trigger regenerate if it's the last message
             const regen = document.getElementById("regenerate");
             if (regen) regen.click();
        }
    });

    // Native TTS
    const btnSpeak = createCtrlBtn("fa-volume-high", "Speak", () => {
        const msgId = stMsg.getAttribute("mesid"); // ST uses 'mesid' attribute often
        // Try calling global if available
        if (window.SillyTavern && window.SillyTavern.playMessageAudio) {
             window.SillyTavern.playMessageAudio(msgId);
        } else if (typeof window.playMessageAudio === "function") {
             window.playMessageAudio(msgId);
        } else {
             // Try clicking the speak button in the real message
             const realSpeak = stMsg.querySelector(".mes_narrator"); // example selector
             if (realSpeak) realSpeak.click();
        }
    });

    controls.appendChild(btnEdit);
    controls.appendChild(btnDel);
    controls.appendChild(btnSwipe);
    controls.appendChild(btnSpeak);

    wrapper.appendChild(controls);

    // CSS for hover
    wrapper.onmouseenter = () => controls.style.display = "flex";
    wrapper.onmouseleave = () => controls.style.display = "none";

    reChatLog.appendChild(wrapper);
    reChatLog.scrollTop = reChatLog.scrollHeight;
}

function createCtrlBtn(iconClass, title, onClick) {
    const btn = document.createElement("div");
    btn.innerHTML = `<i class="fa-solid ${iconClass}"></i>`;
    btn.title = title;
    btn.style.cursor = "pointer";
    btn.style.color = "#fff";
    btn.style.padding = "4px 8px";
    btn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
    };
    return btn;
}

// C. Reverse Input Sync (Injection Fix)
function initReverseSync() {
    const stInput = document.getElementById("send_textarea");
    const reInput = document.getElementById("re-input-bar");

    if (!stInput || !reInput) return;

    try {
        if (stInput.__uieChatSyncReverseBound) return;
        stInput.__uieChatSyncReverseBound = true;
    } catch (_) {}

    // Listen for events
    stInput.addEventListener("input", () => {
        if (document.activeElement !== reInput) {
            reInput.value = stInput.value;
        }
    });

    // Polling for programmatic changes (Wand injection)
    let lastVal = stInput.value;
    if (reverseSyncInt) return;
    reverseSyncInt = setInterval(() => {
        const s = getSettings();
        if (s?.realityEngine?.enabled !== true) return;
        if (stInput.value !== lastVal) {
            lastVal = stInput.value;
            if (document.activeElement !== reInput) {
                reInput.value = stInput.value;
            }
        }
    }, 400);
}

// D. The Wand Proxy
function initWandProxy() {
    const reWand = document.getElementById("re-wand-btn");
    if (!reWand) return;

    try {
        if (reWand.__uieChatSyncWandBound) return;
        reWand.__uieChatSyncWandBound = true;
    } catch (_) {}

    reWand.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();

        const realWand = document.getElementById("wand_btn"); // ST ID? Check ST source or inspect
        // Common ST IDs: #wand_btn, #open_wand
        // Let's try to find it
        const target = document.getElementById("wand_btn") || document.querySelector("[title='Wand']");

        if (target) {
            target.click();

            // Fix Position
            setTimeout(() => {
                const popup = document.getElementById("wand_popup");
                if (popup) {
                    const rect = reWand.getBoundingClientRect();
                    popup.style.position = "fixed";
                    popup.style.top = (rect.top - popup.offsetHeight - 10) + "px";
                    popup.style.left = rect.left + "px";
                    popup.style.zIndex = "2147483647";
                }
            }, 50);
        }
    });
}
