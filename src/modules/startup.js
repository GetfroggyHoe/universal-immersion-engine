import { getSettings, updateLayout } from "./core.js";
import { fetchTemplateHtml } from "./templateFetch.js";
import { initTurboUi } from "./apiClient.js";
import { initImageUi } from "./imageGen.js";

const baseUrl = (() => {
    try {
        const u = String(window.UIE_BASEURL || "");
        if (u) return u.endsWith("/") ? u : `${u}/`;
    } catch (_) {}
    return "/scripts/extensions/third-party/universal-immersion-engine/";
})();

export async function loadTemplates() {
    // Manually inject launcher to ensure it exists (bypassing fetch failure risks)
    if ($("#uie-launcher").length === 0) {
        try {
            setTimeout(() => {
                try {
                    const hasMainCss = Array.from(document.styleSheets || []).some(s => String(s?.href || "").includes("/universal-immersion-engine/") && String(s?.href || "").includes("style.css"));
                    if (hasMainCss) return;
                    if (document.getElementById("uie-launcher-fallback-style")) return;
                    const st = document.createElement("style");
                    st.id = "uie-launcher-fallback-style";
                    st.textContent = `
#uie-launcher{position:fixed;bottom:20px;left:20px;width:54px;height:54px;z-index:2147483645;cursor:pointer;background:transparent;}
#uie-launcher .uie-launcher-fallback{display:block; filter: drop-shadow(0 0 4px rgba(0,0,0,0.8));}
`;
                    document.head.appendChild(st);
                } catch (_) {}
            }, 550);
        } catch (_) {}
        // Launcher Button Logic
        const s = getSettings();
        // Default to Adventure Pack if no icon is set
        const defaultIcon = "https://user.uploads.dev/file/b3fc92e1b70f0c8f0c200b544f7a4cce.png";
        const customIcon = s?.launcher?.src || s?.launcherIcon || defaultIcon;
        const launcherHidden = s?.launcher?.hidden === true;

        // Always use image logic now since default is an image
        const innerContent = `<div class="uie-launcher-img" style="width:100%; height:100%; background:url('${customIcon}') center/cover no-repeat; border-radius:12px; box-shadow:0 4px 6px rgba(0,0,0,0.5);"></div>`;

        const launcherHtml = `
            <div id="uie-launcher" title="Open Menu" style="display:${launcherHidden ? 'none' : 'flex'}; align-items:center; justify-content:center;">
                ${innerContent}
            </div>`;
        $("body").append(launcherHtml);
        try { updateLayout(); } catch(_) {}

        // Show SVG if background image fails to load (handled via CSS or error event usually,
        // but here we just leave it hidden unless we need it.
        // Actually, let's just rely on the CSS background image, but ensure the DIV is there.)
    }

    const required = ["menu", "inventory", "world"];
    const ts = (() => {
        try {
            const v = Number(window.UIE_BUILD);
            if (Number.isFinite(v) && v > 0) return v;
        } catch (_) {}
        return Date.now();
    })();
    for (const f of required) {
        if ($(`#uie-${f === "menu" ? "main-menu" : `${f}-window`}`).length) continue;
        const urls = [
            `${baseUrl}src/templates/${f}.html?v=${ts}`,
            `${baseUrl}templates/${f}.html?v=${ts}`,
            `/scripts/extensions/third-party/universal-immersion-engine/src/templates/${f}.html?v=${ts}`
        ];
        let html = "";
        for (const url of urls) {
            try {
                html = await fetchTemplateHtml(url);
                if (html) break;
            } catch (_) {}
        }
        if (!html) {
            try { console.error(`[UIE] Required template failed to load: ${f}`, { baseUrl, urls }); } catch (_) {}
            try { window.toastr?.error?.(`UIE failed to load required UI: ${f}. Check UIE_BASEURL / install.`); } catch (_) {}
            return;
        }
        $("body").append(html);
        try { (await import("./i18n.js")).applyI18n?.(document); } catch (_) {}
    }

    const optional = ['phone', 'calendar', 'debug', 'journal', 'social', 'diary', 'shop', 'map', 'party', 'databank', 'battle', 'chatbox', 'launcher_options', 'sprites', 'activities', 'stats', 'settings_window'];
    Promise.allSettled(
        optional.map(async (f) => {
            const url = `${baseUrl}src/templates/${f}.html?v=${ts}`;
            const html = await fetchTemplateHtml(url);

            // SPECIAL HANDLING: Chatbox needs to go into #reality-stage if possible, others to body
            if (f === "chatbox") {
                 const stage = document.getElementById("reality-stage");
                 if (stage) $(stage).append(html);
                 else $("body").append(html);
            } else {
                 $("body").append(html);
            }
            try { (await import("./i18n.js")).applyI18n?.(document); } catch (_) {}
            return { f, url };
        })
    ).then((results) => {
        const failed = results
            .map((r, i) => ({ r, f: optional[i] }))
            .filter((x) => x.r.status === "rejected")
            .map((x) => ({ file: x.f, error: x.r.reason }));
        if (failed.length) console.error("[UIE] Template load failures:", failed, { baseUrl });
    });
}

export function patchToastr() {
    try {
        if (!window.toastr) return;
        const t = window.toastr;
        if (t._uiePatched) return;
        const orig = {
            info: t.info?.bind(t),
            success: t.success?.bind(t),
            warning: t.warning?.bind(t),
            error: t.error?.bind(t),
        };
        t._uieOrig = orig;
        t._uiePatched = true;
        const wrap = (fn) => (msg, title, opts) => {
            const s = getSettings();
            if (s?.ui?.showPopups === false) return;
            return fn ? fn(msg, title, opts) : undefined;
        };
        if (orig.info) t.info = wrap(orig.info);
        if (orig.success) t.success = wrap(orig.success);
        if (orig.warning) t.warning = wrap(orig.warning);
        if (orig.error) t.error = wrap(orig.error);
        try {
            t.options = { ...(t.options || {}), progressBar: true, newestOnTop: true, closeButton: false, positionClass: t.options?.positionClass || "toast-bottom-right", timeOut: 3400, extendedTimeOut: 1200 };
        } catch (_) {}
    } catch (_) {}
}

export function injectSettingsUI() {
    let tries = 0;

    const dedupeSettingsBlocks = () => {
        try {
            const target = $([
                "#extensions_settings",
                "#extensions_settings_panel",
                "#extensions-settings-container",
                "#extensions_settings2",
                "#extensions-settings",
                "#extensionsSettings",
                "#extensions_settings_content",
                ".extensions_settings",
                "#extensions-settings-content"
            ].join(", "));

            const blocks = $(".uie-settings-block");
            if (!blocks.length) return;

            let keep = null;
            try {
                const inside = target && target.length ? blocks.filter((_, el) => target.has(el).length > 0) : $();
                keep = inside.length ? inside.first() : null;
            } catch (_) {
                keep = null;
            }

            if (!keep || !keep.length) {
                try {
                    const byId = blocks.filter("#uie-settings-block");
                    keep = byId.length ? byId.first() : blocks.first();
                } catch (_) {
                    keep = blocks.first();
                }
            }

            try {
                if (target && target.length && target.has(keep).length === 0) target.append(keep);
            } catch (_) {}

            try { keep.attr("id", "uie-settings-block"); } catch (_) {}
            try { keep.attr("data-uie-settings-drawer", "1"); } catch (_) {}

            try { blocks.not(keep).remove(); } catch (_) {}
        } catch (_) {}
    };
    const inject = async () => {
        tries++;

        let target = $([
            "#extensions_settings",
            "#extensions_settings_panel",
            "#extensions-settings-container",
            "#extensions_settings2",
            "#extensions-settings",
            "#extensionsSettings",
            "#extensions_settings_content",
            ".extensions_settings",
            "#extensions-settings-content"
        ].join(", "));

        if (!target.length) {
            try {
                const nodes = Array.from(document.querySelectorAll(
                    "[id*='extensions'][id*='settings'], [class*='extensions'][class*='settings'], [id*='extension'][id*='settings'], [class*='extension'][class*='settings']"
                ));
                const scored = nodes
                    .map((el) => {
                        try {
                            const r = el.getBoundingClientRect();
                            const area = Math.max(0, r.width) * Math.max(0, r.height);
                            const visible = r.width > 40 && r.height > 40 && r.bottom > 0 && r.right > 0 && r.top < window.innerHeight && r.left < window.innerWidth;
                            return { el, area, visible };
                        } catch (_) {
                            return { el, area: 0, visible: false };
                        }
                    })
                    .filter((x) => x.visible)
                    .sort((a, b) => b.area - a.area);
                if (scored.length) target = $(scored[0].el);
            } catch (_) {}
        }

        // If ST already injected our settings block (or something duplicated it), reuse it and dedupe.
        // Prefer the block that's already inside the extensions settings container.
        try {
            const blocks = $(".uie-settings-block");
            if (blocks.length) {
                let keep = null;
                try {
                    const inside = target && target.length ? blocks.filter((_, el) => target.has(el).length > 0) : $();
                    keep = inside.length ? inside.first() : blocks.first();
                } catch (_) {
                    keep = blocks.first();
                }

                if (target && target.length) {
                    try {
                        if (target.has(keep).length === 0) target.append(keep);
                    } catch (_) {}
                }

                if (!keep.attr("id")) keep.attr("id", "uie-settings-block");
                keep.attr("data-uie-settings-drawer", "1");
                blocks.not(keep).remove();
                try { initTurboUi(); } catch (_) {}
                try { initImageUi(); } catch (_) {}
                try { (await import("./i18n.js")).applyI18n?.(document); } catch (_) {}
                return;
            }
        } catch (_) {}

        const alreadyInjected = $(".uie-settings-block").length > 0;
        if (!target.length) {
            if (tries === 1 || tries === 5 || tries === 15 || tries === 40) {
                try { console.warn("[UIE] Settings drawer target not found yet; will retry", { tries }); } catch (_) {}
            }
            setTimeout(inject, 750);
            return;
        }

        if (target.length && !alreadyInjected) {
            try {
                const ts = (() => {
                    try {
                        const v = Number(window.UIE_BUILD);
                        if (Number.isFinite(v) && v > 0) return v;
                    } catch (_) {}
                    return Date.now();
                })();
                const urls = [
                    `${baseUrl}src/templates/settings.html?v=${ts}`,
                    `${baseUrl}templates/settings.html?v=${ts}`,
                    `/scripts/extensions/third-party/universal-immersion-engine/src/templates/settings.html?v=${ts}`
                ];

                let html = "";
                for (const url of urls) {
                    try {
                        html = await fetchTemplateHtml(url);
                        if (html) break;
                    } catch (_) {}
                }
                if (!html) {
                    try { console.error("[UIE] Failed to load settings drawer template (settings.html)", { baseUrl, urls }); } catch (_) {}
                    setTimeout(inject, 750);
                    return;
                }
                const $html = $(html);
                let $block = $html.filter(".uie-settings-block").first();
                if (!$block.length) $block = $html.find(".uie-settings-block").first();
                if (!$block.length) {
                    try { console.error("[UIE] settings.html loaded but .uie-settings-block not found; cannot inject", { baseUrl, urls }); } catch (_) {}
                    setTimeout(inject, 750);
                    return;
                }
                $block.attr("id", "uie-settings-block");
                $block.attr("data-uie-settings-drawer", "1");
                target.append($block);
                initTurboUi();
                initImageUi();
                try { (await import("./i18n.js")).applyI18n?.(document); } catch (_) {}
            } catch (e) {
                try { console.error("[UIE] Failed to inject settings drawer", e); } catch (_) {}
            }
        } else {
            setTimeout(inject, 750);
        }
    };
    inject();

    try { dedupeSettingsBlocks(); } catch (_) {}

    try {
        if (!window.UIE_settingsDrawerObserver) {
            let reinjectT = 0;
            const scheduleReinject = () => {
                if (reinjectT) return;
                reinjectT = setTimeout(() => {
                    reinjectT = 0;
                    try {
                        if ($("#uie-settings-block").length === 0) inject();
                    } catch (_) {}
                }, 350);
            };

            const obs = new MutationObserver(() => {
                try {
                    dedupeSettingsBlocks();
                    if ($("#uie-settings-block").length === 0) scheduleReinject();
                } catch (_) {}
            });
            obs.observe(document.body, { childList: true, subtree: true });
            window.UIE_settingsDrawerObserver = obs;
        }
    } catch (_) {}

    // Add Drawer Listener - Use specific class to avoid double-binding if ST already handles general drawers
    // Bind to BODY to catch events that might bubble up, but use stopImmediatePropagation to claim them
    $("body").off("click.uieDrawer").on("click.uieDrawer", ".uie-settings-block .inline-drawer-toggle", function(e) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        const root = $(this).closest(".inline-drawer");
        const content = root.find(".inline-drawer-content");
        const icon = root.find(".inline-drawer-icon");

        // Force toggle logic regardless of animation state to fix "stuck" drawers
        // if (content.is(":animated")) return;

        if (content.is(":visible") && content.height() > 10) {
            content.slideUp(200);
            icon.css("transform", "rotate(-90deg)");
        } else {
            content.slideDown(200);
            icon.css("transform", "rotate(0deg)");
        }
    });

    // Reset Chat Data Listener
    $("body").off("click.uieResetChat").on("click.uieResetChat", "#uie-reset-chat-data", async function(e) {
        e.preventDefault();
        e.stopPropagation();
        if (!confirm("Are you sure? This will wipe ALL inventory, stats, and UIE data for this chat only.")) return;
        
        const s2 = getSettings();
        // Reset logic
        s2.inventory = { items: [], equipped: [], skills: [], assets: [], vitals: {} };
        s2.character = { 
            name: "User", className: "Adventurer", level: 1, 
            stats: { str:10, dex:10, con:10, int:10, wis:10, cha:10, per:10, luk:10, agi:10, vit:10, end:10, spi:10 },
            statusEffects: []
        };
        s2.currency = 0;
        s2.xp = 0;
        s2.hp = 100; s2.maxHp = 100;
        s2.mp = 50; s2.maxMp = 50;
        s2.ap = 10; s2.maxAp = 10;
        // Clear other modules
        s2.calendar = {};
        s2.map = {};
        s2.social = {};
        s2.diary = {};
        s2.databank = {};
        s2.activities = {};
        
        // Save
        const { saveSettings, updateLayout } = await import("./core.js");
        saveSettings();
        updateLayout();
        
        // Notify
        try { window.toastr?.success?.("Current chat data reset complete.", "UIE"); } catch (_) {}
        
        // Reload views if open
        try { (await import("./inventory.js")).updateVitals?.(); } catch (_) {}
        try { (await import("./inventory.js")).applyInventoryUi?.(); } catch (_) {}
        try { (await import("./features/items.js")).render?.(); } catch (_) {}
        try { (await import("./features/skills.js")).init?.(); } catch (_) {}
        try { (await import("./features/assets.js")).init?.(); } catch (_) {}
        try { (await import("./features/equipment.js")).init?.(); } catch (_) {}
    });
}

try {
    window.uie = window.uie || {};
    window.uie.phone = window.uie.phone || {};
    if (typeof window.uie.phone.openBooksGuide !== "function") {
        window.uie.phone.openBooksGuide = async (sectionId) => {
            try {
                const mod = await import("./phone.js");
                if (typeof mod?.initPhone === "function") mod.initPhone();
                if (typeof mod?.openBooksGuide === "function") mod.openBooksGuide(sectionId);
            } catch (_) {}
        };
    }
} catch (_) {}
