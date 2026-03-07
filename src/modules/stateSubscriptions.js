let mounted = false;
let partyWasVisible = false;

function getActiveInventoryTab() {
    try {
        const root = document.getElementById("uie-inventory-window");
        if (!root) return "";
        const fromAttr = String(root.getAttribute("data-active-tab") || "").trim().toLowerCase();
        if (fromAttr) return fromAttr;
        const active = root.querySelector("#tabs [data-tab].active");
        return String(active?.getAttribute("data-tab") || "").trim().toLowerCase();
    } catch (_) {
        return "";
    }
}

export function initStateSubscriptions() {
    if (mounted) return;
    mounted = true;
    try {
        let t = null;
        let inFlight = false;
        let queued = false;

        const flush = async () => {
            if (inFlight) {
                queued = true;
                return;
            }
            inFlight = true;
            try {
                const inventoryVisible = $("#uie-inventory-window:visible").length > 0;
                const activeInvTab = inventoryVisible ? getActiveInventoryTab() : "";

                if (inventoryVisible) {
                    try { (await import("./inventory.js")).updateVitals?.(); } catch (_) {}
                    if (activeInvTab === "items" && $("#uie-items-root").length) {
                        try { (await import("./features/items.js")).render?.(); } catch (_) {}
                    }
                    if (activeInvTab === "skills" && $("#uie-skills-root").length) {
                        try { (await import("./features/skills.js")).init?.(); } catch (_) {}
                    }
                    if (activeInvTab === "assets" && $("#uie-assets-root").length) {
                        try { (await import("./features/assets.js")).init?.(); } catch (_) {}
                    }
                    if (activeInvTab === "life" && $("#life-list").length) {
                        try { (await import("./features/life.js")).init?.(); } catch (_) {}
                    }
                }

                if ($("#uie-battle-window:visible").length) {
                    try { (await import("./battle.js")).renderBattle?.(); } catch (_) {}
                }
                if ($("#uie-shop-window:visible").length) {
                    try { (await import("./shop.js")).renderShopView?.(); } catch (_) {}
                }
                if ($("#uie-social-window:visible").length) {
                    try { (await import("./social.js")).renderSocial?.(); } catch (_) {}
                }
                if ($("#uie-activities-window:visible").length) {
                    try { (await import("./features/activities.js")).render?.(); } catch (_) {}
                }
                if ($("#uie-journal-window:visible").length) {
                    try { (await import("./journal.js")).renderJournal?.(); } catch (_) {}
                }

                const partyVisible = $("#uie-party-window:visible").length > 0;
                if (partyVisible) {
                    if (!partyWasVisible) {
                        try { (await import("./party.js")).initParty?.(); } catch (_) {}
                    } else {
                        try { (await import("./party.js")).refreshParty?.(); } catch (_) {}
                    }
                    partyWasVisible = true;
                } else {
                    partyWasVisible = false;
                }

                if ($("#uie-map-window:visible").length) {
                    try { (await import("./map.js")).initMap?.(); } catch (_) {}
                }
                if ($("#uie-phone-window:visible").length) {
                    try { (await import("./phone.js")).initPhone?.(); } catch (_) {}
                }
                if ($("#uie-databank-window:visible").length) {
                    try { (await import("./databank.js")).initDatabank?.(); } catch (_) {}
                }
            } catch (_) {
            } finally {
                inFlight = false;
                if (queued) {
                    queued = false;
                    if (t) clearTimeout(t);
                    t = setTimeout(() => { void flush(); }, 120);
                }
            }
        };

        const handle = () => {
            if (t) clearTimeout(t);
            t = setTimeout(() => { void flush(); }, 120);
        };

        $(document).off("uie:stateUpdated.uieRefresh uie:state_updated.uieRefresh")
            .on("uie:stateUpdated.uieRefresh uie:state_updated.uieRefresh", handle);
        try { window.addEventListener("uie:state_updated", handle, { passive: true }); } catch (_) {}
    } catch (_) {}
}
