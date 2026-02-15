let mounted = false;

export function initStateSubscriptions() {
    if (mounted) return;
    mounted = true;
    try {
        let t = null;
        const handle = () => {
            if (t) clearTimeout(t);
            t = setTimeout(async () => {
                try {
                    if ($("#uie-inventory-window:visible").length) {
                        try { (await import("./inventory.js")).updateVitals?.(); } catch (_) {}
                    }
                    if ($("#uie-items-root").length) {
                        try { (await import("./features/items.js")).render?.(); } catch (_) {}
                    }
                    if ($("#uie-skills-root").length) {
                        try { (await import("./features/skills.js")).init?.(); } catch (_) {}
                    }
                    if ($("#uie-assets-root").length) {
                        try { (await import("./features/assets.js")).init?.(); } catch (_) {}
                    }
                    if ($("#life-list").length) {
                        try { (await import("./features/life.js")).init?.(); } catch (_) {}
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
                } catch (_) {}
            }, 80);
        };

        $(document).off("uie:stateUpdated.uieRefresh").on("uie:stateUpdated.uieRefresh", handle);
        try { window.addEventListener("uie:state_updated", handle, { passive: true }); } catch (_) {}
    } catch (_) {}
}
