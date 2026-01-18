import { getSettings, saveSettings } from "../core.js";
import { generateContent } from "../apiClient.js";
import * as Items from "./items.js";

export function init() {
    const doc = $(document);

    // Open Modal
    doc.off("click", "#uie-btn-generate").on("click", "#uie-btn-generate", () => {
        $("#uie-modal-generate").fadeIn();
    });

    // Execute Generation
    doc.off("click", "#btn-do-generate").on("click", "#btn-do-generate", async function() {
        const type = $("#gen-type").val();
        const desc = $("#gen-desc").val();
        if(!desc) return;

        const btn = $(this);
        const originalText = btn.text();
        btn.text("Forging...").prop("disabled", true);

        let prompt = `Generate ${type}: "${desc}". JSON only.`;
        if (type === "item") prompt = `Generate Item "${desc}". JSON: { "name": "String", "type": "weapon/armor", "description": "String", "effect": "String", "rarity": "common/rare/legendary" }`;
        if (type === "skill") prompt = `Generate Skill "${desc}". JSON: { "name": "String", "type": "active/passive", "description": "String", "cost": "String" }`;

        try {
            const res = await generateContent(prompt, "System Check");
            // Clean markdown if present
            if (!res) throw new Error("Empty response");
            const cleanRes = String(res).replace(/```json|```/g, "").trim();
            const data = JSON.parse(cleanRes);
            const s = getSettings();

            if (type === "item") {
                s.inventory.items.push(data);
                // Refresh Items Tab if active
                if ($(".pop-tab[data-tab='items']").hasClass("active")) Items.render();
            }
            // Add other types (skills, assets) handling here if needed

            saveSettings();
            $("#uie-modal-generate").fadeOut();
            if(window.toastr) toastr.success(`${type} Generated`);
        } catch(e) {
            console.error("Generation Failed", e);
            if(window.toastr) toastr.error("Generation Failed");
        }

        btn.text(originalText).prop("disabled", false);
    });
}
