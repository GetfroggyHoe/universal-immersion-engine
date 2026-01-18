import { getRealityEngineV3 } from "./engine.js";

function stSendText(text) {
    const ta =
        document.querySelector("textarea#send_textarea") ||
        document.querySelector("textarea#send_text") ||
        document.querySelector("textarea") ||
        null;
    if (!ta) return false;
    ta.value = String(text || "");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    ta.dispatchEvent(new Event("change", { bubbles: true }));
    const send = document.querySelector("#send_but") || document.querySelector("[data-testid='send']");
    if (send) send.click();
    return true;
}

function renderButtons(mode) {
    const grid = document.getElementById("re-action-grid");
    if (!grid) return;
    const m = String(mode || "life");
    const life = [
        { id: "re-act-work", label: "Work", text: "I go to work." },
        { id: "re-act-flirt", label: "Flirt", text: "I flirt." },
        { id: "re-act-chat", label: "Chat", text: "I chat." },
        { id: "re-act-shop", label: "Shop", text: "I go shopping." }
    ];
    const rpg = [
        { id: "re-act-attack", label: "Attack", text: "I attack." },
        { id: "re-act-defend", label: "Defend", text: "I defend." },
        { id: "re-act-skill", label: "Skill", text: "I use a skill." },
        { id: "re-act-inventory", label: "Inventory", text: "I check my inventory." }
    ];
    const items = m === "rpg" ? rpg : life;
    grid.innerHTML = items.map(b => `<button class="re-actbtn" id="${b.id}">${b.label}</button>`).join("");
    for (const b of items) {
        const el = document.getElementById(b.id);
        if (!el) continue;
        el.onclick = (e) => { e.preventDefault(); e.stopPropagation(); stSendText(b.text); };
    }
}

export function initGameplayV3() {
    if (window.UIE_realityGameplayV3Bound) return;
    window.UIE_realityGameplayV3Bound = true;
    const eng = getRealityEngineV3();
    const sync = () => { try { renderButtons(eng.getState()?.ui?.mode || "life"); } catch (_) {} };
    eng.on("mode:changed", sync);
    sync();
}

export function setGameplayMode(mode) {
    getRealityEngineV3().setMode(mode);
}

