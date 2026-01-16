import { getSettings, saveSettings, updateLayout, isMobileUI } from "./core.js";
import { notify } from "./notifications.js";
import { scanEverything } from "./stateTracker.js";
import { fetchTemplateHtml } from "./templateFetch.js";
import { scanRecentMemories, scanAllMemoriesFromStart, scanNextMemoriesChunk } from "./memories.js";

// Hook into chat generation (SillyTavern event)
let chatObserver = null;

export function initChatListener() {
    const chat = document.getElementById("chat");
    if (!chat) return;
    
    if (chatObserver) chatObserver.disconnect();
    
    let timeout = null;
    
    chatObserver = new MutationObserver(() => {
        // Debounce scan
        if (timeout) clearTimeout(timeout);
        timeout = setTimeout(() => {
            scanEverything();
            try { scanRecentMemories(); } catch (_) {}
        }, 3000); // Scan 3 seconds after chat stops updating
    });
    
    chatObserver.observe(chat, { childList: true, subtree: true });
}

export function initInteractions() {
    const s = getSettings();
    const disabled = s.enabled === false;
    if (!disabled) initChatListener();
    $(document).off("click.uie"); 

    const baseUrl = (() => {
        try {
            const u = String(window.UIE_BASEURL || "");
            if (u) return u.endsWith("/") ? u : `${u}/`;
        } catch (_) {}
        return "/scripts/extensions/third-party/universal-immersion-engine/";
    })();

    const syncAutomationLabels = (root = document) => {
        const pairs = [
            ["#uie-ai-phone-browser", "Phone Browser Pages"],
            ["#uie-ai-phone-messages", "Phone Messages Replies"],
            ["#uie-ai-phone-calls", "Phone Calls"],
            ["#uie-ai-app-builder", "App Builder"],
            ["#uie-ai-books", "Book Generator"],
            ["#uie-ai-journal-quests", "Journal Quest Generator"],
            ["#uie-ai-databank", "Databank Scan"],
            ["#uie-ai-map", "Map Generator"],
            ["#uie-ai-shop", "Shop Generator"],
            ["#uie-ai-loot", "Auto-Detect Loot & Status"],
        ];
        for (const [sel, label] of pairs) {
            const el = root.querySelector(sel);
            if (!el) continue;
            const wrap = el.closest(".uie-control-group");
            const lab = wrap ? wrap.querySelector("label") : null;
            if (!lab) continue;
            const on = el.checked !== false;
            lab.textContent = on ? label : `${label} (OFF)`;
        }
    };

    const refreshSettingsDrawer = () => {
        const s2 = getSettings();
        const scope = document.querySelector("#uie-settings-block");
        if (!scope) return;

        const kill = scope.querySelector("#uie-setting-enable");
        if (kill) kill.checked = s2.enabled === false;

        const slider = scope.querySelector("#uie-scale-slider");
        const disp = scope.querySelector("#uie-scale-display");
        if (slider) slider.value = String(Number(s2.uiScale || 1).toFixed(1));
        if (disp) disp.textContent = String(Number(s2.uiScale || 1).toFixed(1));

        const pop = scope.querySelector("#uie-show-popups");
        if (pop) pop.checked = s2.ui?.showPopups !== false;

        const cssScope = scope.querySelector("#uie-popup-css-scope");
        const cssBox = scope.querySelector("#uie-popup-css-text");
        try {
            if (!s2.ui) s2.ui = {};
            if (!s2.ui.notifications) s2.ui.notifications = { categories: {} };
            if (!s2.ui.notifications.cssByCategory || typeof s2.ui.notifications.cssByCategory !== "object") {
                s2.ui.notifications.cssByCategory = { global: String(s2.ui.notifications.css || "") };
                saveSettings();
            }
            const curScope = String(s2.ui.notifications.cssScope || "global");
            if (cssScope) cssScope.value = curScope;
            if (cssBox) cssBox.value = String(s2.ui.notifications.cssByCategory?.[curScope] || "");
        } catch (_) {
            if (cssScope) cssScope.value = "global";
            if (cssBox) cssBox.value = String(s2.ui?.notifications?.css || "");
        }

        const cat = s2.ui?.notifications?.categories || {};
        const setPop = (id, key) => {
            const el = scope.querySelector(id);
            if (!el) return;
            el.checked = cat?.[key] !== false;
        };
        setPop("#uie-pop-quests-accepted", "questsAccepted");
        setPop("#uie-pop-quests-abandoned", "questsAbandoned");
        setPop("#uie-pop-quests-failed", "questsFailed");
        setPop("#uie-pop-quests-completed", "questsCompleted");
        setPop("#uie-pop-phone-calls", "phoneCalls");
        setPop("#uie-pop-phone-messages", "phoneMessages");
        setPop("#uie-pop-loot", "loot");
        setPop("#uie-pop-currency", "currency");
        setPop("#uie-pop-xp", "xp");
        setPop("#uie-pop-levelup", "levelUp");
        setPop("#uie-pop-postbattle", "postBattle");
        setPop("#uie-pop-api", "api");
        setPop("#uie-pop-social", "social");
        try {
            const low = scope.querySelector("#uie-pop-lowhp-enabled");
            if (low) low.checked = s2.ui?.notifications?.lowHp?.enabled === true;
            const thr = scope.querySelector("#uie-pop-lowhp-threshold");
            if (thr) thr.value = String(Number(s2.ui?.notifications?.lowHp?.threshold || 0.25));
        } catch (_) {}

        const turbo = scope.querySelector("#uie-turbo-enable");
        if (turbo) turbo.checked = s2.turbo?.enabled === true;
        const turboUrl = scope.querySelector("#uie-turbo-url");
        if (turboUrl) turboUrl.value = String(s2.turbo?.url || "");
        const turboModel = scope.querySelector("#uie-turbo-model");
        if (turboModel) turboModel.value = String(s2.turbo?.model || "");
        const turboKey = scope.querySelector("#uie-turbo-key");
        if (turboKey) turboKey.value = String(s2.turbo?.key || "");

        try {
            const imgEnable = scope.querySelector("#uie-img-enable");
            if (imgEnable) imgEnable.checked = s2.image?.enabled === true;
            const imgUrl = scope.querySelector("#uie-img-url");
            if (imgUrl) imgUrl.value = String(s2.image?.url || "");
            const imgKey = scope.querySelector("#uie-img-key");
            if (imgKey) imgKey.value = String(s2.image?.key || "");
            const imgModel = scope.querySelector("#uie-img-model");
            if (imgModel) imgModel.value = String(s2.image?.model || "");
            const wf = scope.querySelector("#uie-img-comfy-workflow");
            if (wf) wf.value = String(s2.image?.comfy?.workflow || "");
            const pn = scope.querySelector("#uie-img-comfy-posnode");
            if (pn) pn.value = String(s2.image?.comfy?.positiveNodeId || "");
            const nn = scope.querySelector("#uie-img-comfy-negnode");
            if (nn) nn.value = String(s2.image?.comfy?.negativeNodeId || "");
            const on = scope.querySelector("#uie-img-comfy-outnode");
            if (on) on.value = String(s2.image?.comfy?.outputNodeId || "");
            const f = s2.image?.features || {};
            const setImg = (id, key) => { const el = scope.querySelector(id); if (el) el.checked = f?.[key] !== false; };
            setImg("#uie-img-map", "map");
            setImg("#uie-img-doll", "doll");
            setImg("#uie-img-social", "social");
            setImg("#uie-img-phone-bg", "phoneBg");
            setImg("#uie-img-msg", "msg");
            setImg("#uie-img-party", "party");
            setImg("#uie-img-items", "items");
        } catch (_) {}

        const ai = s2.ai || {};
        const setCk = (id, v) => { const el = scope.querySelector(id); if (el) el.checked = v !== false; };
        setCk("#uie-ai-phone-browser", ai.phoneBrowser);
        setCk("#uie-ai-phone-messages", ai.phoneMessages);
        setCk("#uie-ai-phone-calls", ai.phoneCalls);
        setCk("#uie-ai-app-builder", ai.appBuilder);
        setCk("#uie-ai-books", ai.books);
        setCk("#uie-ai-journal-quests", ai.journalQuestGen);
        setCk("#uie-ai-databank", ai.databankScan);
        setCk("#uie-ai-map", ai.map);
        setCk("#uie-ai-shop", ai.shop);
        setCk("#uie-ai-loot", ai.loot);

        const aiConfirm = scope.querySelector("#uie-ai-confirm-toggle");
        if (aiConfirm) aiConfirm.checked = s2.generation?.aiConfirm === true;

        try {
            const gp = scope.querySelector("#uie-gen-prompt-global");
            const dp = scope.querySelector("#uie-gen-prompt-default");
            const wp = scope.querySelector("#uie-gen-prompt-webpage");
            const jp = scope.querySelector("#uie-gen-prompt-systemcheck");
            const cp = scope.querySelector("#uie-gen-prompt-phonecall");
            const ip = scope.querySelector("#uie-gen-prompt-image");
            const p = s2?.generation?.promptPrefixes || {};
            const by = (p?.byType && typeof p.byType === "object") ? p.byType : {};
            if (gp) gp.value = String(p?.global || "");
            if (dp) dp.value = String(by?.default || "");
            if (wp) wp.value = String(by?.Webpage || "");
            if (jp) jp.value = String(by?.["System Check"] || "");
            if (cp) cp.value = String(by?.["Phone Call"] || "");
            if (ip) ip.value = String(by?.["Image Gen"] || "");
        } catch (_) {}

        try {
            const sel = scope.querySelector("#uie-profile-select");
            if (sel) {
                const cur = String(sel.value || "");
                const profs = Array.isArray(s2?.connections?.profiles) ? s2.connections.profiles : [];
                const active = String(s2?.connections?.activeProfileId || "");
                const renderSelect = () => {
                    const st = Array.isArray(window.UIE_ST_CONN_PROFILES) ? window.UIE_ST_CONN_PROFILES : [];
                    sel.innerHTML = "";
                    const opt0 = document.createElement("option");
                    opt0.value = "";
                    opt0.textContent = "—";
                    sel.appendChild(opt0);

                    if (profs.length) {
                        const g = document.createElement("optgroup");
                        g.label = "UIE Profiles";
                        for (const p of profs) {
                            const id = String(p?.id || "");
                            const nm = String(p?.name || "").trim();
                            if (!id || !nm) continue;
                            const o = document.createElement("option");
                            o.value = id;
                            o.textContent = nm;
                            g.appendChild(o);
                        }
                        sel.appendChild(g);
                    }

                    if (st.length) {
                        const g2 = document.createElement("optgroup");
                        g2.label = "SillyTavern Profiles";
                        for (const p of st) {
                            const id = String(p?.id || "");
                            const nm = String(p?.name || "").trim();
                            if (!id || !nm) continue;
                            const o = document.createElement("option");
                            o.value = `st:${id}`;
                            o.textContent = nm;
                            g2.appendChild(o);
                        }
                        sel.appendChild(g2);
                    }

                    const want = active || cur;
                    if (want) sel.value = want;
                };

                if (!window.UIE_ST_CONN_PROFILES_LOADING && !Array.isArray(window.UIE_ST_CONN_PROFILES)) {
                    window.UIE_ST_CONN_PROFILES_LOADING = true;
                    import("../../../../../extensions.js").then((mod) => {
                        const ctx = mod?.getContext?.() || {};
                        const raw =
                            ctx?.connection_profiles ||
                            ctx?.connectionProfiles ||
                            ctx?.connections ||
                            ctx?.profiles ||
                            window?.connection_profiles ||
                            window?.connectionProfiles ||
                            window?.SillyTavern?.connection_profiles ||
                            window?.SillyTavern?.connectionProfiles ||
                            null;
                        const map = {};
                        const out = [];
                        const push = (it) => {
                            if (!it || typeof it !== "object") return;
                            const id = String(it.id || it.profile_id || it.profileId || it.name || it.title || "");
                            const name = String(it.name || it.title || it.profile_name || it.profileName || id || "").trim();
                            if (!id || !name) return;
                            if (map[id]) return;
                            map[id] = it;
                            out.push({ id, name });
                        };
                        if (Array.isArray(raw)) raw.forEach(push);
                        else if (raw && typeof raw === "object") {
                            const maybeArr = raw.profiles || raw.items || raw.list;
                            if (Array.isArray(maybeArr)) maybeArr.forEach(push);
                            else for (const v of Object.values(raw)) push(v);
                        }
                        window.UIE_ST_CONN_PROFILE_MAP = map;
                        window.UIE_ST_CONN_PROFILES = out.sort((a, b) => String(a.name).localeCompare(String(b.name)));
                        window.UIE_ST_CONN_PROFILES_LOADING = false;
                        try { renderSelect(); } catch (_) {}
                    }).catch(() => {
                        window.UIE_ST_CONN_PROFILE_MAP = {};
                        window.UIE_ST_CONN_PROFILES = [];
                        window.UIE_ST_CONN_PROFILES_LOADING = false;
                        try { renderSelect(); } catch (_) {}
                    });
                }

                renderSelect();
            }
        } catch (_) {}

        syncAutomationLabels(scope);
    };

    const buildPopupCss = (s2) => {
        const n = s2?.ui?.notifications || {};
        const by = n?.cssByCategory && typeof n.cssByCategory === "object" ? n.cssByCategory : {};
        const globalCss = String(by.global ?? n.css ?? "");
        const out = [globalCss];
        for (const k of Object.keys(by)) {
            if (k === "global") continue;
            const raw = String(by[k] || "").trim();
            if (!raw) continue;
            if (raw.includes("{")) out.push(raw);
            else out.push(`.toast-uie-cat-${String(k).replace(/[^a-z0-9_-]/gi, "-").toLowerCase()}{${raw}}`);
        }
        return out.filter(Boolean).join("\n");
    };

    const applyPopupCss = () => {
        const s2 = getSettings();
        const css = buildPopupCss(s2);
        let el = document.getElementById("uie-popup-css");
        if (!el) {
            el = document.createElement("style");
            el.id = "uie-popup-css";
            document.head.appendChild(el);
        }
        el.textContent = css;
    };

    const ensureSettingsDefaults = () => {
        const s2 = getSettings();
        if (!s2.ai) s2.ai = {};
        const keys = ["phoneBrowser", "phoneMessages", "phoneCalls", "appBuilder", "books", "journalQuestGen", "databankScan", "map", "shop", "loot"];
        for (const k of keys) if (typeof s2.ai[k] !== "boolean") s2.ai[k] = true;
        if (!s2.generation) s2.generation = {};
        if (typeof s2.generation.aiConfirm !== "boolean") s2.generation.aiConfirm = false;
        if (typeof s2.uiScale !== "number") s2.uiScale = Number(s2.uiScale || 1) || 1;
        saveSettings();
    };

    const readFileAsDataUrl = (file) => new Promise((resolve) => {
        if (!file) return resolve("");
        const r = new FileReader();
        r.onload = () => resolve(String(r.result || ""));
        r.onerror = () => resolve("");
        r.readAsDataURL(file);
    });

    const ensureUiBuckets = (st) => {
        if (!st.ui) st.ui = {};
        if (!st.ui.backgrounds) st.ui.backgrounds = {};
        if (!st.ui.css) st.ui.css = {};
        if (!st.ui.css.targets) st.ui.css.targets = {};
        if (!st.character) st.character = {};
        if (!Array.isArray(st.character.classPresets)) st.character.classPresets = [];
    };

    const populateSettingsWindow = () => {
        const st = getSettings();
        if (!st) return;
        ensureUiBuckets(st);

        $("#uie-hide-inventory").prop("checked", !!st.menuHidden?.inventory);
        $("#uie-hide-shop").prop("checked", !!st.menuHidden?.shop);
        $("#uie-hide-journal").prop("checked", !!st.menuHidden?.journal);
        $("#uie-hide-diary").prop("checked", !!st.menuHidden?.diary);
        $("#uie-hide-social").prop("checked", !!st.menuHidden?.social);
        $("#uie-hide-party").prop("checked", !!st.menuHidden?.party);
        $("#uie-hide-battle").prop("checked", !!st.menuHidden?.battle);
        $("#uie-hide-phone").prop("checked", !!st.menuHidden?.phone);
        $("#uie-hide-map").prop("checked", !!st.menuHidden?.map);
        $("#uie-hide-calendar").prop("checked", !!st.menuHidden?.calendar);
        $("#uie-hide-databank").prop("checked", !!st.menuHidden?.databank);
        $("#uie-hide-world").prop("checked", !!st.menuHidden?.world);
        $("#uie-hide-settings").prop("checked", !!st.menuHidden?.settings);
        $("#uie-hide-debug").prop("checked", !!st.menuHidden?.debug);
        $("#uie-hide-help").prop("checked", !!st.menuHidden?.help);

        $("#uie-rpg-name").val(String(st.character?.name || ""));
        $("#uie-rpg-class").val(String(st.character?.className || st.character?.class || ""));
        $("#uie-rpg-level").val(String(Number(st.character?.level || 1)));
        $("#uie-rpg-sync-persona").prop("checked", st.character?.syncPersona !== false);

        const cssTarget = String($("#uie-css-target").val() || "global");
        const cssText = cssTarget === "global"
            ? String(st.ui?.css?.global || "")
            : String(st.ui?.css?.targets?.[cssTarget] || "");
        $("#uie-style-css").val(cssText);

        const bgTarget = String($("#uie-bg-target").val() || "menu");
        $("#uie-bg-url").val(String(st.ui?.backgrounds?.[bgTarget] || ""));

        const presets = Array.isArray(st.character.classPresets) ? st.character.classPresets : [];
        const $sel = $("#uie-class-saved");
        if ($sel.length) {
            const cur = String($sel.val() || "");
            $sel.empty().append(`<option value="">—</option>`);
            presets.forEach((p, i) => {
                const nm = String(p?.name || "").trim();
                if (!nm) return;
                $sel.append(`<option value="${i}">${nm.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</option>`);
            });
            if (cur) $sel.val(cur);
        }

        saveSettings();
        updateLayout();
        try { applyMenuVisibility(); } catch (_) {}
    };

    ensureSettingsDefaults();
    refreshSettingsDrawer();
    applyPopupCss();
    setTimeout(refreshSettingsDrawer, 1500);

    $(document)
        .off("input.uieSettings", "#uie-scale-slider")
        .on("input.uieSettings", "#uie-scale-slider", function () {
            const s2 = getSettings();
            const v = Number($(this).val() || 1) || 1;
            s2.uiScale = v;
            $("#uie-scale-display").text(v.toFixed(1));
            try {
                if (window.UIE_scaleRaf) cancelAnimationFrame(window.UIE_scaleRaf);
                window.UIE_scaleRaf = requestAnimationFrame(() => {
                    try { updateLayout(); } catch (_) {}
                });
            } catch (_) { updateLayout(); }
        });
    $(document)
        .off("change.uieSettings", "#uie-scale-slider")
        .on("change.uieSettings", "#uie-scale-slider", function () {
            const s2 = getSettings();
            const v = Number($(this).val() || 1) || 1;
            s2.uiScale = v;
            $("#uie-scale-display").text(v.toFixed(1));
            saveSettings();
            updateLayout();
        });

    $(document)
        .off("change.uieTurbo", "#uie-turbo-enable")
        .on("change.uieTurbo", "#uie-turbo-enable", function () {
            const s2 = getSettings();
            if (!s2.turbo || typeof s2.turbo !== "object") s2.turbo = {};
            s2.turbo.enabled = $(this).is(":checked");
            saveSettings();
        });
    $(document)
        .off("change.uieTurboUrl", "#uie-turbo-url")
        .on("change.uieTurboUrl", "#uie-turbo-url", function () {
            const s2 = getSettings();
            if (!s2.turbo || typeof s2.turbo !== "object") s2.turbo = {};
            s2.turbo.url = String($(this).val() || "").trim();
            saveSettings();
        });
    $(document)
        .off("change.uieTurboModel", "#uie-turbo-model")
        .on("change.uieTurboModel", "#uie-turbo-model", function () {
            const s2 = getSettings();
            if (!s2.turbo || typeof s2.turbo !== "object") s2.turbo = {};
            s2.turbo.model = String($(this).val() || "").trim();
            saveSettings();
        });

    $(document)
        .off("click.uieTurboTest", "#uie-turbo-test")
        .on("click.uieTurboTest", "#uie-turbo-test", async function (e) {
            e.preventDefault();
            e.stopPropagation();
            const btn = $(this);
            const prev = String(btn.text() || "");
            btn.text("Testing...");
            btn.prop("disabled", true);
            try {
                const mod = await import("./apiClient.js");
                const r = await mod.testTurboConnection();
                if (r?.ok) {
                    try { window.toastr?.success?.(`Turbo OK (${Number(r.ms || 0)}ms)`); } catch (_) {}
                } else {
                    const msg = String(r?.error || "Turbo failed.");
                    const hint = /failed to fetch|cors|network/i.test(msg) ? " (Browser blocked request — try SillyTavern server proxy or a local gateway.)" : "";
                    try { window.toastr?.error?.(`Turbo FAIL: ${msg}${hint}`); } catch (_) {}
                }
            } catch (err) {
                try { window.toastr?.error?.(`Turbo FAIL: ${String(err?.message || err || "Unknown error")}`); } catch (_) {}
            } finally {
                btn.text(prev || "Test Connection");
                btn.prop("disabled", false);
            }
        });
    $(document)
        .off("change.uieTurboKey", "#uie-turbo-key")
        .on("change.uieTurboKey", "#uie-turbo-key", function () {
            const s2 = getSettings();
            if (!s2.turbo || typeof s2.turbo !== "object") s2.turbo = {};
            s2.turbo.key = String($(this).val() || "").trim();
            saveSettings();
        });

    $(document)
        .off("change.uieImgEnable", "#uie-img-enable")
        .on("change.uieImgEnable", "#uie-img-enable", function () {
            const s2 = getSettings();
            if (!s2.image || typeof s2.image !== "object") s2.image = {};
            s2.image.enabled = $(this).is(":checked");
            saveSettings();
        });
    $(document)
        .off("change.uieImgUrl", "#uie-img-url")
        .on("change.uieImgUrl", "#uie-img-url", function () {
            const s2 = getSettings();
            if (!s2.image || typeof s2.image !== "object") s2.image = {};
            s2.image.url = String($(this).val() || "").trim();
            saveSettings();
        });
    $(document)
        .off("change.uieImgKey", "#uie-img-key")
        .on("change.uieImgKey", "#uie-img-key", function () {
            const s2 = getSettings();
            if (!s2.image || typeof s2.image !== "object") s2.image = {};
            s2.image.key = String($(this).val() || "").trim();
            saveSettings();
        });
    $(document)
        .off("change.uieImgModel", "#uie-img-model")
        .on("change.uieImgModel", "#uie-img-model", function () {
            const s2 = getSettings();
            if (!s2.image || typeof s2.image !== "object") s2.image = {};
            s2.image.model = String($(this).val() || "").trim();
            saveSettings();
        });

    $(document)
        .off("change.uieImgComfy", "#uie-img-comfy-workflow, #uie-img-comfy-posnode, #uie-img-comfy-negnode, #uie-img-comfy-outnode")
        .on("change.uieImgComfy", "#uie-img-comfy-workflow, #uie-img-comfy-posnode, #uie-img-comfy-negnode, #uie-img-comfy-outnode", function () {
            const s2 = getSettings();
            if (!s2.image || typeof s2.image !== "object") s2.image = {};
            if (!s2.image.comfy || typeof s2.image.comfy !== "object") s2.image.comfy = {};
            s2.image.comfy.workflow = String($("#uie-img-comfy-workflow").val() || "");
            s2.image.comfy.positiveNodeId = String($("#uie-img-comfy-posnode").val() || "").trim();
            s2.image.comfy.negativeNodeId = String($("#uie-img-comfy-negnode").val() || "").trim();
            s2.image.comfy.outputNodeId = String($("#uie-img-comfy-outnode").val() || "").trim();
            saveSettings();
        });

    $(document)
        .off("change.uieImgFeat", "#uie-img-map, #uie-img-doll, #uie-img-social, #uie-img-phone-bg, #uie-img-msg, #uie-img-party, #uie-img-items")
        .on("change.uieImgFeat", "#uie-img-map, #uie-img-doll, #uie-img-social, #uie-img-phone-bg, #uie-img-msg, #uie-img-party, #uie-img-items", function () {
            const s2 = getSettings();
            if (!s2.image || typeof s2.image !== "object") s2.image = {};
            if (!s2.image.features || typeof s2.image.features !== "object") s2.image.features = {};
            const id = String(this.id || "");
            const key = id.replace(/^uie-img-/, "").replace(/-([a-z])/g, (_, c) => String(c).toUpperCase());
            s2.image.features[key] = this.checked !== false;
            saveSettings();
        });

    const ensureProfiles = (s2) => {
        if (!s2.connections || typeof s2.connections !== "object") s2.connections = { activeProfileId: "", profiles: [] };
        if (!Array.isArray(s2.connections.profiles)) s2.connections.profiles = [];
        if (typeof s2.connections.activeProfileId !== "string") s2.connections.activeProfileId = "";
    };

    const packProfile = (s2, id, name) => ({
        id: String(id || ""),
        name: String(name || "").trim().slice(0, 60),
        turbo: s2.turbo ? {
            enabled: s2.turbo.enabled === true,
            url: String(s2.turbo.url || ""),
            key: String(s2.turbo.key || ""),
            model: String(s2.turbo.model || ""),
        } : null,
        image: s2.image ? {
            enabled: s2.image.enabled === true,
            url: String(s2.image.url || ""),
            key: String(s2.image.key || ""),
            model: String(s2.image.model || ""),
        } : null,
    });

    $(document)
        .off("change.uieProfiles", "#uie-profile-select")
        .on("change.uieProfiles", "#uie-profile-select", function () {
            const s2 = getSettings();
            ensureProfiles(s2);
            s2.connections.activeProfileId = String($(this).val() || "");
            saveSettings();
        });

    $(document)
        .off("click.uieProfiles", "#uie-profile-apply, #uie-profile-save, #uie-profile-delete")
        .on("click.uieProfiles", "#uie-profile-apply, #uie-profile-save, #uie-profile-delete", function (e) {
            e.preventDefault();
            e.stopPropagation();
            const s2 = getSettings();
            ensureProfiles(s2);
            const sel = String($("#uie-profile-select").val() || "");
            const profs = Array.isArray(s2.connections.profiles) ? s2.connections.profiles : [];
            const find = (id) => profs.find(p => String(p?.id || "") === id);

            if (this.id === "uie-profile-apply") {
                if (sel.startsWith("st:")) {
                    const id = sel.slice(3);
                    const raw = window.UIE_ST_CONN_PROFILE_MAP && typeof window.UIE_ST_CONN_PROFILE_MAP === "object"
                        ? window.UIE_ST_CONN_PROFILE_MAP[id]
                        : null;
                    if (!raw || typeof raw !== "object") return;

                    const pick = (...keys) => {
                        for (const k of keys) {
                            const v = raw?.[k];
                            if (typeof v === "string" && v.trim()) return v.trim();
                        }
                        return "";
                    };
                    const url = pick("url", "endpoint", "api_url", "apiUrl", "base_url", "baseUrl");
                    const model = pick("model", "model_id", "modelId", "api_model", "apiModel");
                    let key = pick("key", "api_key", "apiKey", "token");
                    if (!key) {
                        const auth = pick("authorization", "Authorization");
                        key = auth.replace(/^bearer\s+/i, "").trim();
                    }
                    if (!s2.turbo || typeof s2.turbo !== "object") s2.turbo = {};
                    if (url) s2.turbo.url = url;
                    if (model) s2.turbo.model = model;
                    if (key) s2.turbo.key = key;
                    s2.turbo.enabled = true;
                    s2.connections.activeProfileId = sel;
                    saveSettings();
                    refreshSettingsDrawer();
                    try { window.toastr?.success?.("SillyTavern profile applied to Turbo."); } catch (_) {}
                    return;
                }
                const p = find(sel);
                if (!p) return;
                if (p.turbo) {
                    if (!s2.turbo || typeof s2.turbo !== "object") s2.turbo = {};
                    s2.turbo.enabled = p.turbo.enabled === true;
                    s2.turbo.url = String(p.turbo.url || "");
                    s2.turbo.key = String(p.turbo.key || "");
                    s2.turbo.model = String(p.turbo.model || "");
                }
                if (p.image) {
                    if (!s2.image || typeof s2.image !== "object") s2.image = {};
                    s2.image.enabled = p.image.enabled === true;
                    s2.image.url = String(p.image.url || "");
                    s2.image.key = String(p.image.key || "");
                    s2.image.model = String(p.image.model || "");
                }
                s2.connections.activeProfileId = sel;
                saveSettings();
                refreshSettingsDrawer();
                try { window.toastr?.success?.("Profile applied."); } catch (_) {}
                return;
            }

            if (this.id === "uie-profile-delete") {
                if (!sel) return;
                if (sel.startsWith("st:")) {
                    if (s2.connections.activeProfileId === sel) s2.connections.activeProfileId = "";
                    saveSettings();
                    refreshSettingsDrawer();
                    try { window.toastr?.info?.("SillyTavern profiles can’t be deleted here."); } catch (_) {}
                    return;
                }
                s2.connections.profiles = profs.filter(p => String(p?.id || "") !== sel);
                if (s2.connections.activeProfileId === sel) s2.connections.activeProfileId = "";
                saveSettings();
                refreshSettingsDrawer();
                try { window.toastr?.info?.("Profile deleted."); } catch (_) {}
                return;
            }

            if (this.id === "uie-profile-save") {
                const cur = sel.startsWith("st:") ? null : find(sel);
                const wantName = prompt("Profile name:", cur ? String(cur.name || "") : "");
                if (wantName === null) return;
                const nm = String(wantName || "").trim();
                if (!nm) return;
                const id = (!sel || sel.startsWith("st:")) ? `p_${Date.now().toString(16)}_${Math.floor(Math.random() * 1e9).toString(16)}` : sel;
                const packed = packProfile(s2, id, nm);
                const next = profs.filter(p => String(p?.id || "") !== id);
                next.unshift(packed);
                s2.connections.profiles = next.slice(0, 40);
                s2.connections.activeProfileId = id;
                saveSettings();
                refreshSettingsDrawer();
                try { window.toastr?.success?.("Profile saved."); } catch (_) {}
            }
        });

    $(document)
        .off("change.uieSettingsKill", "#uie-setting-enable")
        .on("change.uieSettingsKill", "#uie-setting-enable", function () {
            const s2 = getSettings();
            const kill = $(this).is(":checked");
            s2.enabled = !kill;
            saveSettings();
            updateLayout();
            if (kill) {
                $("#uie-main-menu, .uie-window, .uie-book-overlay, .uie-phone").hide();
                $("#uie-launcher").hide();
            } else {
                $("#uie-launcher").show();
            }
        });

    $(document)
        .off("change.uieSettingsPop", "#uie-show-popups")
        .on("change.uieSettingsPop", "#uie-show-popups", function () {
            const s2 = getSettings();
            if (!s2.ui) s2.ui = {};
            s2.ui.showPopups = $(this).is(":checked");
            saveSettings();
        });

    $(document)
        .off("click.uiePopupCssApply", "#uie-popup-css-apply")
        .on("click.uiePopupCssApply", "#uie-popup-css-apply", function (e) {
            e.preventDefault();
            e.stopPropagation();
            const s2 = getSettings();
            if (!s2.ui) s2.ui = {};
            if (!s2.ui.notifications) s2.ui.notifications = { categories: {} };
            if (!s2.ui.notifications.cssByCategory || typeof s2.ui.notifications.cssByCategory !== "object") s2.ui.notifications.cssByCategory = { global: String(s2.ui.notifications.css || "") };
            const key = String($("#uie-popup-css-scope").val() || "global");
            s2.ui.notifications.cssScope = key;
            s2.ui.notifications.cssByCategory[key] = String($("#uie-popup-css-text").val() || "");
            saveSettings();
            applyPopupCss();
            try { window.toastr?.success?.("Saved popup CSS."); } catch (_) {}
        });

    const savePromptPrefixes = () => {
        const s2 = getSettings();
        if (!s2.generation || typeof s2.generation !== "object") s2.generation = {};
        if (!s2.generation.promptPrefixes || typeof s2.generation.promptPrefixes !== "object") s2.generation.promptPrefixes = { global: "", byType: {} };
        if (!s2.generation.promptPrefixes.byType || typeof s2.generation.promptPrefixes.byType !== "object") s2.generation.promptPrefixes.byType = {};
        s2.generation.promptPrefixes.global = String($("#uie-gen-prompt-global").val() || "");
        s2.generation.promptPrefixes.byType.default = String($("#uie-gen-prompt-default").val() || "");
        s2.generation.promptPrefixes.byType.Webpage = String($("#uie-gen-prompt-webpage").val() || "");
        s2.generation.promptPrefixes.byType["System Check"] = String($("#uie-gen-prompt-systemcheck").val() || "");
        s2.generation.promptPrefixes.byType["Phone Call"] = String($("#uie-gen-prompt-phonecall").val() || "");
        s2.generation.promptPrefixes.byType["Image Gen"] = String($("#uie-gen-prompt-image").val() || "");
        saveSettings();
    };

    $(document)
        .off("change.uieGenPrompts input.uieGenPrompts", "#uie-gen-prompt-global, #uie-gen-prompt-default, #uie-gen-prompt-webpage, #uie-gen-prompt-systemcheck, #uie-gen-prompt-phonecall, #uie-gen-prompt-image")
        .on("change.uieGenPrompts input.uieGenPrompts", "#uie-gen-prompt-global, #uie-gen-prompt-default, #uie-gen-prompt-webpage, #uie-gen-prompt-systemcheck, #uie-gen-prompt-phonecall, #uie-gen-prompt-image", function () {
            savePromptPrefixes();
        });

    $(document)
        .off("click.uieGenPromptsClear", "#uie-gen-prompts-clear")
        .on("click.uieGenPromptsClear", "#uie-gen-prompts-clear", function (e) {
            e.preventDefault();
            e.stopPropagation();
            $("#uie-gen-prompt-global").val("");
            $("#uie-gen-prompt-default").val("");
            $("#uie-gen-prompt-webpage").val("");
            $("#uie-gen-prompt-systemcheck").val("");
            $("#uie-gen-prompt-phonecall").val("");
            $("#uie-gen-prompt-image").val("");
            savePromptPrefixes();
            try { window.toastr?.success?.("Prompts cleared."); } catch (_) {}
        });

    $(document)
        .off("click.uiePopupCssReset", "#uie-popup-css-reset")
        .on("click.uiePopupCssReset", "#uie-popup-css-reset", function (e) {
            e.preventDefault();
            e.stopPropagation();
            const s2 = getSettings();
            if (!s2.ui) s2.ui = {};
            if (!s2.ui.notifications) s2.ui.notifications = { categories: {} };
            if (!s2.ui.notifications.cssByCategory || typeof s2.ui.notifications.cssByCategory !== "object") s2.ui.notifications.cssByCategory = { global: String(s2.ui.notifications.css || "") };
            const key = String($("#uie-popup-css-scope").val() || "global");
            s2.ui.notifications.cssScope = key;
            s2.ui.notifications.cssByCategory[key] = "";
            saveSettings();
            $("#uie-popup-css-text").val("");
            applyPopupCss();
            try { window.toastr?.info?.("Popup CSS reset."); } catch (_) {}
        });

    $(document)
        .off("change.uiePopupCssScope", "#uie-popup-css-scope")
        .on("change.uiePopupCssScope", "#uie-popup-css-scope", function () {
            const s2 = getSettings();
            if (!s2.ui) s2.ui = {};
            if (!s2.ui.notifications) s2.ui.notifications = { categories: {} };
            if (!s2.ui.notifications.cssByCategory || typeof s2.ui.notifications.cssByCategory !== "object") s2.ui.notifications.cssByCategory = { global: String(s2.ui.notifications.css || "") };
            const key = String($(this).val() || "global");
            s2.ui.notifications.cssScope = key;
            saveSettings();
            $("#uie-popup-css-text").val(String(s2.ui.notifications.cssByCategory?.[key] || ""));
        });

    $(document)
        .off("click.uiePopupTest", "#uie-popup-test")
        .on("click.uiePopupTest", "#uie-popup-test", function (e) {
            e.preventDefault();
            e.stopPropagation();
            try { window.toastr?.success?.("This is a test popup.", "UIE Popups"); } catch (_) {}
        });

    $(document)
        .off("change.uiePopupCats", "#uie-settings-block #uie-set-popups input[type='checkbox']")
        .on("change.uiePopupCats", "#uie-settings-block #uie-set-popups input[type='checkbox']", function () {
            const id = String(this?.id || "");
            const on = $(this).is(":checked");
            const s2 = getSettings();
            if (!s2.ui) s2.ui = {};
            if (!s2.ui.notifications) s2.ui.notifications = { categories: {} };
            if (!s2.ui.notifications.categories) s2.ui.notifications.categories = {};
            const c = s2.ui.notifications.categories;
            const set = (key) => { c[key] = on; };
            if (id === "uie-pop-quests-accepted") set("questsAccepted");
            else if (id === "uie-pop-quests-abandoned") set("questsAbandoned");
            else if (id === "uie-pop-quests-failed") set("questsFailed");
            else if (id === "uie-pop-quests-completed") set("questsCompleted");
            else if (id === "uie-pop-phone-calls") set("phoneCalls");
            else if (id === "uie-pop-phone-messages") set("phoneMessages");
            else if (id === "uie-pop-loot") set("loot");
            else if (id === "uie-pop-currency") set("currency");
            else if (id === "uie-pop-xp") set("xp");
            else if (id === "uie-pop-levelup") set("levelUp");
            else if (id === "uie-pop-postbattle") set("postBattle");
            else if (id === "uie-pop-api") set("api");
            else if (id === "uie-pop-social") set("social");
            else if (id === "uie-pop-lowhp-enabled") {
                if (!s2.ui.notifications.lowHp) s2.ui.notifications.lowHp = { enabled: false, threshold: 0.25, lastWarnAt: 0 };
                s2.ui.notifications.lowHp.enabled = on;
            }
            saveSettings();
        });

    $(document)
        .off("change.uiePopupLowHpThr", "#uie-pop-lowhp-threshold")
        .on("change.uiePopupLowHpThr", "#uie-pop-lowhp-threshold", function () {
            const s2 = getSettings();
            if (!s2.ui) s2.ui = {};
            if (!s2.ui.notifications) s2.ui.notifications = { categories: {} };
            if (!s2.ui.notifications.lowHp) s2.ui.notifications.lowHp = { enabled: false, threshold: 0.25, lastWarnAt: 0 };
            const v = Math.max(0.05, Math.min(0.9, Number($(this).val() || 0.25) || 0.25));
            s2.ui.notifications.lowHp.threshold = v;
            saveSettings();
        });

    const bindAiToggle = (sel, key) => {
        $(document)
            .off(`change.uieAi_${key}`, sel)
            .on(`change.uieAi_${key}`, sel, function () {
                const s2 = getSettings();
                if (!s2.ai) s2.ai = {};
                s2.ai[key] = $(this).is(":checked");
                saveSettings();
                syncAutomationLabels(document.querySelector("#uie-settings-block") || document);
            });
    };
    bindAiToggle("#uie-ai-phone-browser", "phoneBrowser");
    bindAiToggle("#uie-ai-phone-messages", "phoneMessages");
    bindAiToggle("#uie-ai-phone-calls", "phoneCalls");
    bindAiToggle("#uie-ai-app-builder", "appBuilder");
    bindAiToggle("#uie-ai-books", "books");
    bindAiToggle("#uie-ai-journal-quests", "journalQuestGen");
    bindAiToggle("#uie-ai-databank", "databankScan");
    bindAiToggle("#uie-ai-map", "map");
    bindAiToggle("#uie-ai-shop", "shop");
    bindAiToggle("#uie-ai-loot", "loot");

    $(document)
        .off("change.uieAiConfirm", "#uie-ai-confirm-toggle")
        .on("change.uieAiConfirm", "#uie-ai-confirm-toggle", function () {
            const s2 = getSettings();
            if (!s2.generation) s2.generation = {};
            s2.generation.aiConfirm = $(this).is(":checked");
            saveSettings();
        });

    const ensureInvForceStyle = () => {
        if (document.getElementById("uie-force-open-inv")) return;
        const el = document.createElement("style");
        el.id = "uie-force-open-inv";
        el.textContent = `
#uie-inventory-window[data-uie-force-open="1"]{
  display:flex !important;
  opacity:1 !important;
  visibility:visible !important;
  pointer-events:auto !important;
  z-index:2147483600 !important;
}`;
        document.head.appendChild(el);
    };

    let invLoadingPromise = null;
    const ensureInventoryShell = () => {
        ensureInvForceStyle();
        if ($("#uie-inventory-window").length) return Promise.resolve(true);
        if (invLoadingPromise) return invLoadingPromise;
        
        invLoadingPromise = (async () => {
            try {
                const html = await fetchTemplateHtml(`${baseUrl}src/templates/inventory.html`);
                if (!$("#uie-inventory-window").length) $("body").append(html);
                return $("#uie-inventory-window").length > 0;
            } catch (e) {
                console.error("[UIE] Failed to fetch inventory shell", e);
                return false;
            } finally {
                invLoadingPromise = null;
            }
        })();
        return invLoadingPromise;
    };

    const makeActivator = () => {
        let lastAt = 0;
        let lastTarget = "";
        return (selector, fn) => {
            $(document)
                .off("pointerup.uieAct click.uieAct", selector)
                .on("pointerup.uieAct click.uieAct", selector, function (e) {
                    const now = Date.now();
                    const key = `${selector}`;
                    // Mobile: Aggressive de-bounce (800ms)
                    if (now - lastAt < 800 && lastTarget === key) {
                        try {
                            e.preventDefault();
                            e.stopPropagation();
                            e.stopImmediatePropagation();
                        } catch (_) {}
                        return;
                    }
                    lastAt = now;
                    lastTarget = key;
                    return fn.call(this, e);
                });
        };
    };
    const onActivate = makeActivator();

    const UIE_Z = {
        menu: 2147483605,
        window: 2147483630,
        inventory: 2147483620,
        overlay: 2147483646,
        modal: 2147483647,
        backdrop: 2147483645,
    };

    const windowZ = (id) => {
        const key = String(id || "");
        if (key.includes("inventory")) return UIE_Z.inventory;
        if (key === "#uie-settings-window") return UIE_Z.overlay;
        if (/(phone|party|calendar|battle|map|databank|shop|journal|diary|social|debug|world)/i.test(key)) return UIE_Z.overlay;
        return UIE_Z.window;
    };

    const openWindow = (id, modulePath, renderFunc, opts = {}) => {
        const force = opts && opts.force === true;
        // GLOBAL OPENING LOCK
        if (!force && window.UIE_isOpening && (Date.now() - (window.UIE_lastOpenStart || 0) < 650) && window.UIE_openingTarget === id) {
            return;
        }
        window.UIE_isOpening = true;
        window.UIE_lastOpenStart = Date.now();
        window.UIE_openingTarget = id;
        setTimeout(() => { window.UIE_isOpening = false; }, 650);

        // SHIELD: Always create shield on open to prevent bounces/ghosts
        const shieldId = "uie-mobile-shield-" + Date.now();
        const shield = document.createElement("div");
        shield.id = shieldId;
        shield.style.cssText = `position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:${UIE_Z.modal};background:transparent;pointer-events:auto;`;
        // Trap all events
        const trap = (e) => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); };
        shield.addEventListener("click", trap, true);
        shield.addEventListener("touchstart", trap, true);
        shield.addEventListener("touchend", trap, true);
        document.body.appendChild(shield);
        setTimeout(() => {
             const s = document.getElementById(shieldId);
             if (s) s.remove();
        }, 800); // 800ms shield

        $("#uie-main-menu").hide();
        // Hide others but NOT self if already visible
        $(".uie-window, .uie-book-overlay, .uie-phone").not(id).hide();
        $("#uie-item-modal, #uie-gen-modal, #party-equip-modal").hide();
        $("#uie-social-menu").hide();
        $("#cal-modal, #uie-party-member-modal").hide();
        $("#uie-social-overlay").removeAttr("data-open").hide();
        const bd = document.getElementById("uie-modal-backdrop");
        if (bd) bd.style.display = "none";

        const $w = $(id);
        if (!$w.length) {
             console.warn(`[UIE] Window ${id} not found.`);
             return;
        }
        try {
            const el = $w.get(0);
            if (el && el.parentElement !== document.body) document.body.appendChild(el);
            else if (el) document.body.appendChild(el);
        } catch (_) {}
        try {
            const z = windowZ(id);
            $w.css({ position: "fixed", "z-index": String(z), isolation: "isolate" });
        } catch (_) {}

        // Mobile positioning reset
        if (isMobileUI()) {
            $w.css({ top: "", left: "", transform: "" });
        }

        // FORCE DISPLAY & LOCK
        if (String(id).includes("inventory")) {
            $w.attr("data-uie-force-open", "1");
            window.UIE_invLock = true;
            setTimeout(() => { window.UIE_invLock = false; }, 2000);
            
            // LOCK INTERACTION for 600ms to prevent instant-close
            $w.css("pointer-events", "none");
            setTimeout(() => { $w.css("pointer-events", "auto"); }, 600);
            
            $w.css({ display: "flex", visibility: "visible", opacity: "1" });
        }
        
        $w.show();
        $w.css("display", "flex");
        
        if (modulePath && renderFunc) {
            import(modulePath).then(mod => {
                if (mod?.[renderFunc]) mod[renderFunc]();
            }).catch(e => console.error(`[UIE] Failed to load ${modulePath}:`, e));
        }

        updateLayout();

        if (id === "#uie-settings-window") {
            let bd = document.getElementById("uie-modal-backdrop");
            if (!bd) {
                bd = document.createElement("div");
                bd.id = "uie-modal-backdrop";
                bd.style.cssText = `position:fixed;inset:0;z-index:${UIE_Z.backdrop};background:rgba(0,0,0,0.35);pointer-events:auto;`;
                document.body.appendChild(bd);
            }
            bd.style.display = "block";
        }

        if (String(id).includes("inventory")) {
            try {
                window.UIE_lastInventoryOpenAt = Date.now();
            } catch (_) {}
            try {
                // Disable close button for 1.5s
                const closeBtns = document.querySelectorAll("#uie-inventory-window .uie-inv-close, #uie-inventory-window .uie-close-btn");
                closeBtns.forEach(btn => {
                    btn.style.pointerEvents = "none";
                    setTimeout(() => { try { btn.style.pointerEvents = ""; } catch (_) {} }, 1500);
                });
            } catch (_) {}
        }
    };

    window.UIE_forceOpenWindow = (id, modulePath, renderFunc) => {
        try { window.UIE_isOpening = false; window.UIE_lastOpenStart = 0; window.UIE_openingTarget = ""; } catch (_) {}
        openWindow(id, modulePath, renderFunc, { force: true });
    };

    if (window.UIE_triggerPromptInjected !== true) {
        window.UIE_triggerPromptInjected = true;
        import("../../../../../extensions.js").then((mod) => {
            const ctx = mod?.getContext?.();
            if (!ctx) return;
            const prompt = [
                "UIE Trigger Check (silent unless needed):",
                "- Before finalizing your response, decide if any UIE event should trigger.",
                "- If YES, append one or more tags at the VERY END of your message on their own lines:",
                "  [UIE_CALL:Name]",
                "  [UIE_TEXT:Name|Message]",
                "  [UIE_BATTLE:SCAN]",
                "- If NO, append nothing.",
                "- Do not explain the tags; do not add extra formatting."
            ].join("\n");

            if (typeof ctx.setExtensionPrompt === "function") {
                ctx.setExtensionPrompt("UIE_TRIGGERS", prompt);
            } else if (ctx.extensionPrompts && typeof ctx.extensionPrompts === "object") {
                ctx.extensionPrompts.UIE_TRIGGERS = prompt;
            }
        }).catch(() => {});
    }

    if (window.UIE_relationshipPromptInjected !== true) {
        window.UIE_relationshipPromptInjected = true;
        import("../../../../../extensions.js").then((mod) => {
            const getCtx = mod?.getContext;
            if (typeof getCtx !== "function") return;
            const ctx0 = getCtx();
            if (!ctx0) return;

            const build = () => {
                try {
                    const st = getSettings();
                    if (st?.enabled === false) return "";
                    const ctx = getCtx();
                    const user = String(ctx?.name1 || "User");
                    const npc = String(ctx?.name2 || "").trim();
                    if (!npc) return "";
                    const nm = npc.toLowerCase();
                    const all = ["friends", "romance", "family", "rivals"].flatMap(k => (st?.social?.[k] || []));
                    const p = all.find(x => String(x?.name || "").trim().toLowerCase() === nm) || null;
                    const aff = Math.max(0, Math.min(100, Number(p?.affinity ?? 50)));
                    const disp = (() => {
                        if (aff <= 10) return "Hostile";
                        if (aff <= 25) return "Wary";
                        if (aff <= 45) return "Cold";
                        if (aff <= 60) return "Neutral";
                        if (aff <= 75) return "Warm";
                        if (aff <= 90) return "Friendly";
                        return "Devoted";
                    })();
                    const talkCap = (() => {
                        if (aff <= 10) return 25;
                        if (aff <= 25) return 40;
                        if (aff <= 45) return 55;
                        if (aff <= 60) return 70;
                        if (aff <= 75) return 85;
                        if (aff <= 90) return 92;
                        return 100;
                    })();
                    const mems = Array.isArray(p?.memories) ? p.memories.slice() : [];
                    mems.sort((a, b) => Number(b?.t || 0) - Number(a?.t || 0));
                    const memLines = mems.slice(0, 8).map(m => String(m?.text || "").trim()).filter(Boolean).map(t => `- ${t.slice(0, 260)}`);
                    const memBlock = memLines.length ? `\nVital memories (${npc}'s memory of ${user}):\n${memLines.join("\n")}\n` : "\nVital memories: None\n";

                    return [
                        "[UIE_RELATIONSHIP_GOVERNOR_V1]",
                        "This block is authoritative for relationship realism and anti-protagonist-bias.",
                        "",
                        `NPC: ${npc}`,
                        `Disposition: ${disp}`,
                        `Affinity: ${aff}/100`,
                        `Talk-only cap: ${talkCap}/100 (words alone cannot exceed this; action is required beyond)`,
                        "",
                        "Hard rules:",
                        "- NPCs have agency, goals, limits, and can refuse, disengage, threaten, or escalate.",
                        "- Compliment-spam/manipulation can backfire (annoyance → distrust → hostility).",
                        "- If disposition is Hostile, the NPC does NOT stand down from words alone; de-escalation requires leverage/action/consequences.",
                        "- Being 'nice' has diminishing returns; after small improvements, only credible action changes outcomes.",
                        "- Ignore omniscient tool cards/metadata unless it is an in-world event or durable fact.",
                        memBlock
                    ].join("\n").slice(0, 2500);
                } catch (_) {
                    return "";
                }
            };

            const apply = () => {
                const prompt = build();
                const ctx = getCtx();
                if (!ctx) return;
                if (typeof ctx.setExtensionPrompt === "function") ctx.setExtensionPrompt("UIE_RELATIONSHIPS", prompt || "");
                else if (ctx.extensionPrompts && typeof ctx.extensionPrompts === "object") ctx.extensionPrompts.UIE_RELATIONSHIPS = prompt || "";
            };

            apply();
            setInterval(apply, 4500);
        }).catch(() => {});
    }

    const openMainMenu = async () => {
        try {
            const now = Date.now();
            const last = Number(window.UIE_lastMainMenuToggleAt || 0);
            if (now - last < 450) return;
            window.UIE_lastMainMenuToggleAt = now;
        } catch (_) {}
        let $menu = $("#uie-main-menu");
        if (!$menu.length) {
            try {
                const { fetchTemplateHtml } = await import("./templateFetch.js");
                const baseUrl = (() => {
                    try {
                        const u = String(window.UIE_BASEURL || "");
                        if (u) return u.endsWith("/") ? u : `${u}/`;
                    } catch (_) {}
                    return "/scripts/extensions/third-party/universal-immersion-engine/";
                })();
                const html = await fetchTemplateHtml(`${baseUrl}src/templates/menu.html`);
                $("body").append(html);
                $menu = $("#uie-main-menu");
            } catch (err) {
                try { notify("error", "Menu template failed to load (check console).", "UIE", "api"); } catch (_) {}
                console.error("[UIE] Menu open failed: template missing", err);
                return;
            }
        }
        const show = !$menu.is(":visible");
        if (!show) {
            $menu.hide();
            return;
        }
        $menu.css("display", "flex").show();
        $(".uie-menu-tab").removeClass("active").css({ color: "#888", borderBottomColor: "transparent" });
        $(`.uie-menu-tab[data-tab="main"]`).addClass("active").css({ color: "#fff", borderBottomColor: "#f1c40f" });
        $(".uie-menu-page").hide();
        $("#uie-tab-main").show();
        updateLayout();
        try {
            requestAnimationFrame(() => {
                const launcher = document.getElementById("uie-launcher");
                const rect = launcher ? launcher.getBoundingClientRect() : null;
                const el = $menu[0];
                if (!rect || !el) return;

                const vw = window.innerWidth;
                const vh = window.innerHeight;
                const mrect = el.getBoundingClientRect();
                const mw = Number(mrect.width) || 320;
                const mh = Number(mrect.height) || 420;

                let top = rect.bottom + 10;
                let left = rect.left;
                if (left + mw > vw - 6) left = Math.max(6, vw - mw - 6);
                if (top + mh > vh - 6) top = Math.max(6, vh - mh - 6);
                $menu.css({ top, left });
            });
        } catch (_) {}
    };

    let launcherActAt = 0;
    $(document)
        .off("pointerup.uieLauncherAct click.uieLauncherAct", "#uie-launcher")
        .on("pointerup.uieLauncherAct click.uieLauncherAct", "#uie-launcher", async function (e) {
            const now = Date.now();
            if (now - launcherActAt < 500) return;
            launcherActAt = now;
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            await openMainMenu();
        });

    // Main Menu Buttons
    onActivate("#uie-btn-inventory", (e) => {
        e.preventDefault();
        e.stopPropagation();
        ensureInventoryShell().then((ok) => {
            if (!ok) {
                notify("error", "Inventory UI failed to load.", "UIE", "api");
                return;
            }
            openWindow("#uie-inventory-window", "./inventory.js", "initInventory");
        });
    });
    $(document).on("click.uie", "#uie-btn-shop", (e) => { e.stopPropagation(); openWindow("#uie-shop-window", "./shop.js", "initShop"); });
    $(document).on("click.uie", "#uie-btn-journal", (e) => { e.stopPropagation(); openWindow("#uie-journal-window", "./journal.js", "renderJournal"); });
    onActivate("#uie-btn-diary", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if ($("#uie-diary-window").length === 0) {
            let root = "";
            try { root = String(window.UIE_BASEPATH || "scripts/extensions/third-party/universal-immersion-engine"); } catch (_) { root = "scripts/extensions/third-party/universal-immersion-engine"; }
            root = root.replace(/^\/+|\/+$/g, "");
            const urls = [
                `${baseUrl}src/templates/diary.html`,
                `/${root}/src/templates/diary.html`,
                `/scripts/extensions/third-party/universal-immersion-engine/src/templates/diary.html`
            ];
            let html = "";
            for (const url of urls) {
                try {
                    html = await fetchTemplateHtml(url);
                    if (html) break;
                } catch (_) {}
            }
            if (!html) {
                notify("error", "Diary UI failed to load.", "UIE", "api");
                return;
            }
            $("body").append(html);
        }
        openWindow("#uie-diary-window", "./diary.js", "initDiary");
        setTimeout(() => {
            try {
                const el = document.getElementById("uie-diary-window");
                if (!el) return;
                el.style.display = "flex";
                el.style.visibility = "visible";
                el.style.opacity = "1";
                el.style.pointerEvents = "auto";
                el.style.position = "fixed";
                el.style.zIndex = "2147483646";
                if (typeof isMobileUI === "function" && isMobileUI()) {
                    el.style.inset = "0";
                    el.style.top = "0";
                    el.style.left = "0";
                    el.style.transform = "none";
                }
            } catch (_) {}
        }, 50);
    });
    $(document).on("click.uie", "#uie-btn-social", (e) => { e.stopPropagation(); openWindow("#uie-social-window", "./social.js", "renderSocial"); });
    $(document).on("click.uie", "#uie-btn-party", (e) => { e.stopPropagation(); openWindow("#uie-party-window", "./party.js", "initParty"); });
    $(document).on("click.uie", "#uie-btn-battle", (e) => { e.stopPropagation(); openWindow("#uie-battle-window", "./battle.js", "renderBattle"); });
    $(document).on("click.uie", "#uie-btn-open-phone", (e) => { e.stopPropagation(); openWindow("#uie-phone-window", "./phone.js", "initPhone"); });
    $(document).on("click.uie", "#uie-btn-open-calendar", (e) => { e.stopPropagation(); openWindow("#uie-calendar-window", "./calendar.js", "openCalendar"); });
    $(document).on("click.uie", "#uie-btn-open-map", (e) => { e.stopPropagation(); openWindow("#uie-map-window", "./map.js", "initMap"); });
    $(document).on("click.uie", "#uie-btn-open-world", async (e) => {
        e.stopPropagation();
        if ($("#uie-world-window").length === 0) {
            try {
                const html = await fetchTemplateHtml(`${baseUrl}src/templates/world.html`);
                $("body").append(html);
            } catch (err) {
                notify("error", "Reality UI failed to load (check console).", "UIE", "api");
                console.error("[UIE] Failed to load world template", err);
                return;
            }
        }
        openWindow("#uie-world-window", "./world.js", "initWorld");
    });
    $(document).on("click.uie", "#uie-btn-databank", (e) => { e.stopPropagation(); openWindow("#uie-databank-window", "./databank.js", "initDatabank"); });
    $(document).on("click.uie", "#uie-btn-debug", async (e) => {
        e.stopPropagation();
        if ($("#uie-debug-window").length === 0) {
            try {
                const html = await fetchTemplateHtml(`${baseUrl}src/templates/debug.html`);
                $("body").append(html);
            } catch (err) {
                notify("error", "Debug UI failed to load (check console).", "UIE", "api");
                console.error("[UIE] Failed to load debug template", err);
                return;
            }
        }
        openWindow("#uie-debug-window", "./diagnostics.js", "runDiagnostics");
    });
    
    $(document).on("click.uie", "#uie-btn-help", async (e) => {
        e.stopPropagation();
        openWindow("#uie-phone-window", "./phone.js", "initPhone");
        try {
            const mod = await import("./phone.js");
            if (mod?.openBooksGuide) mod.openBooksGuide();
        } catch (_) {}
    });

    // Menu Tabs
    $(document).on("click.uie", ".uie-menu-tab", function(e) {
        e.preventDefault();
        e.stopPropagation();
        const tab = String($(this).data("tab") || "main");
        $(".uie-menu-tab").removeClass("active").css({ color: "#888", borderBottomColor: "transparent" });
        $(this).addClass("active").css({ color: "#fff", borderBottomColor: "#f1c40f" });
        $(".uie-menu-page").hide();
        $(`#uie-tab-${tab}`).show();
    });

    // Settings
    $(document).on("click.uie", "#uie-btn-open-settings", function (e) { 
        e.preventDefault();
        e.stopPropagation();
        $("#uie-settings-window").css({ top: "", left: "", right: "", bottom: "", transform: "" });
        openWindow("#uie-settings-window");
        // Settings population logic...
        const s = getSettings();
        $("#uie-check-permadeath").prop("checked", s.permadeath);
        if (!s.rpg) s.rpg = { mode: "adventurer" };
        $("#uie-rpg-mode").val(String(s.rpg.mode || "adventurer"));
        $("#uie-set-currency-sym").val(s.currencySymbol || "G");
        $("#uie-set-currency-rate").val(s.currencyRate || 0);
        try { $("#uie-mem-auto").prop("checked", s.memories?.auto === true); } catch (_) {}
        
        // LAUNCHER SETTINGS
        if (!s.launcher) s.launcher = {};
        $("#uie-launcher-name").val(s.launcher.name || "");
        const $iconSel = $("#uie-launcher-icon");
        // Keep existing options but select correct one
        $iconSel.val(s.launcher.src || "");
        if (!$iconSel.val() && s.launcher.src) {
             // Custom or missing option
             if (s.launcher.src.startsWith("data:")) {
                 $iconSel.val("custom");
                 $("#uie-launcher-preview").css("backgroundImage", `url("${s.launcher.src}")`).show();
             } else {
                 // Try to add it if it looks like a folder file
                 $iconSel.append(`<option value="${s.launcher.src}">${s.launcher.src.split("/").pop()}</option>`);
                 $iconSel.val(s.launcher.src);
             }
        } else {
             $("#uie-launcher-preview").hide();
        }

        if (!s.menuHidden) s.menuHidden = {};
        $("#uie-hide-inventory").prop("checked", !!s.menuHidden.inventory);
        // ... (rest of settings population)
        populateSettingsWindow();
    });

    $(document)
        .off("change.uieMemAuto")
        .on("change.uieMemAuto", "#uie-mem-auto", function () {
            const st = getSettings();
            if (!st) return;
            if (!st.memories) st.memories = {};
            st.memories.auto = this.checked === true;
            saveSettings();
        });

    $(document)
        .off("click.uieMemScanNext")
        .on("click.uieMemScanNext", "#uie-mem-scan-next", async function (e) {
            e.preventDefault();
            e.stopPropagation();
            const btn = $(this);
            btn.prop("disabled", true);
            try { await scanNextMemoriesChunk(); } finally { btn.prop("disabled", false); }
        });

    $(document)
        .off("click.uieMemScanAll")
        .on("click.uieMemScanAll", "#uie-mem-scan-all", async function (e) {
            e.preventDefault();
            e.stopPropagation();
            const btn = $(this);
            btn.prop("disabled", true);
            try { await scanAllMemoriesFromStart(); } finally { btn.prop("disabled", false); }
        });

    $(document)
        .off("change.uieSwMenuHidden")
        .on("change.uieSwMenuHidden", "#uie-settings-window #uie-sw-menu input[type='checkbox'][id^='uie-hide-']", function () {
            const st = getSettings();
            if (!st) return;
            if (!st.menuHidden) st.menuHidden = {};
            const id = String(this.id || "");
            const on = !!this.checked;
            const key = id.replace(/^uie-hide-/, "");
            st.menuHidden[key] = on;
            saveSettings();
            try { applyMenuVisibility(); } catch (_) {}
        });

    $(document)
        .off("input.uieSwRpg")
        .on("input.uieSwRpg", "#uie-rpg-name, #uie-rpg-class, #uie-rpg-level", function () {
            const st = getSettings();
            if (!st) return;
            if (!st.character) st.character = {};
            st.character.name = String($("#uie-rpg-name").val() || "").slice(0, 60);
            st.character.className = String($("#uie-rpg-class").val() || "").slice(0, 60);
            st.character.level = Math.max(1, Number($("#uie-rpg-level").val() || 1) || 1);
            saveSettings();
            updateLayout();
            try { window.UIE_updateInventoryVitals?.(); } catch (_) {}
        });

    $(document)
        .off("input.uieSwCurrency change.uieSwCurrency")
        .on("input.uieSwCurrency change.uieSwCurrency", "#uie-set-currency-sym, #uie-set-currency-rate", function () {
            const st = getSettings();
            if (!st) return;
            const sym = String($("#uie-set-currency-sym").val() || "").trim();
            if (sym) st.currencySymbol = sym.slice(0, 6);
            const rateRaw = Number($("#uie-set-currency-rate").val());
            if (Number.isFinite(rateRaw)) st.currencyRate = Math.max(0, rateRaw);
            saveSettings();
            updateLayout();
            try { window.UIE_updateInventoryVitals?.(); } catch (_) {}
        });

    $(document)
        .off("change.uieSwRpgSync")
        .on("change.uieSwRpgSync", "#uie-rpg-sync-persona", function () {
            const st = getSettings();
            if (!st) return;
            if (!st.character) st.character = {};
            st.character.syncPersona = !!this.checked;
            saveSettings();
        });

    $(document)
        .off("change.uieCssTarget")
        .on("change.uieCssTarget", "#uie-css-target", function () {
            const st = getSettings();
            if (!st) return;
            ensureUiBuckets(st);
            const key = String($(this).val() || "global");
            const cssText = key === "global"
                ? String(st.ui.css.global || "")
                : String(st.ui.css.targets?.[key] || "");
            $("#uie-style-css").val(cssText);
        });

    let cssSaveTimer = null;
    $(document)
        .off("input.uieCssSave")
        .on("input.uieCssSave", "#uie-style-css", function () {
            const txt = String($(this).val() || "");
            if (cssSaveTimer) clearTimeout(cssSaveTimer);
            cssSaveTimer = setTimeout(() => {
                cssSaveTimer = null;
                const st = getSettings();
                if (!st) return;
                ensureUiBuckets(st);
                const key = String($("#uie-css-target").val() || "global");
                if (key === "global") st.ui.css.global = txt;
                else {
                    if (!st.ui.css.targets) st.ui.css.targets = {};
                    st.ui.css.targets[key] = txt;
                }
                saveSettings();
                updateLayout();
            }, 220);
        });

    $(document)
        .off("change.uieBgTarget")
        .on("change.uieBgTarget", "#uie-bg-target", function () {
            const st = getSettings();
            if (!st) return;
            ensureUiBuckets(st);
            const key = String($(this).val() || "menu");
            $("#uie-bg-url").val(String(st.ui.backgrounds?.[key] || ""));
        });

    $(document)
        .off("click.uieBgApply")
        .on("click.uieBgApply", "#uie-bg-apply", function (e) {
            e.preventDefault();
            e.stopPropagation();
            const st = getSettings();
            if (!st) return;
            ensureUiBuckets(st);
            const key = String($("#uie-bg-target").val() || "menu");
            const url = String($("#uie-bg-url").val() || "").trim();
            st.ui.backgrounds[key] = url;
            saveSettings();
            updateLayout();
        })
        .off("click.uieBgClear")
        .on("click.uieBgClear", "#uie-bg-clear", function (e) {
            e.preventDefault();
            e.stopPropagation();
            const st = getSettings();
            if (!st) return;
            ensureUiBuckets(st);
            const key = String($("#uie-bg-target").val() || "menu");
            st.ui.backgrounds[key] = "";
            $("#uie-bg-url").val("");
            saveSettings();
            updateLayout();
        })
        .off("click.uieBgPick")
        .on("click.uieBgPick", "#uie-bg-pick", function (e) {
            e.preventDefault();
            e.stopPropagation();
            const input = document.getElementById("uie-bg-file");
            if (!input) return;
            input.value = "";
            input.click();
        });

    $(document)
        .off("change.uieBgFile")
        .on("change.uieBgFile", "#uie-bg-file", async function () {
            const file = this.files && this.files[0];
            const dataUrl = await readFileAsDataUrl(file);
            if (!dataUrl) return;
            $("#uie-bg-url").val(dataUrl);
            const st = getSettings();
            if (!st) return;
            ensureUiBuckets(st);
            const key = String($("#uie-bg-target").val() || "menu");
            st.ui.backgrounds[key] = dataUrl;
            saveSettings();
            updateLayout();
            try { this.value = ""; } catch (_) {}
        });

    $(document)
        .off("click.uieClassApply")
        .on("click.uieClassApply", "#uie-class-apply", function (e) {
            e.preventDefault();
            e.stopPropagation();
            const st = getSettings();
            if (!st) return;
            ensureUiBuckets(st);
            const idx = Number($("#uie-class-saved").val() || -1);
            const p = Array.isArray(st.character.classPresets) ? st.character.classPresets[idx] : null;
            if (!p) return;
            if (!st.character) st.character = {};
            if (p.className) st.character.className = String(p.className).slice(0, 60);
            if (Number.isFinite(Number(p.level))) st.character.level = Math.max(1, Number(p.level));
            if (p.stats && typeof p.stats === "object") {
                if (!st.character.stats) st.character.stats = {};
                for (const k of Object.keys(p.stats)) {
                    const v = Number(p.stats[k]);
                    if (Number.isFinite(v)) st.character.stats[k] = v;
                }
            }
            if (Array.isArray(p.statusEffects)) st.character.statusEffects = p.statusEffects.map(x => String(x).trim()).filter(Boolean).slice(0, 25);
            saveSettings();
            updateLayout();
            try { window.UIE_updateInventoryVitals?.(); } catch (_) {}
        });

    $(document)
        .off("click.uieClassSave")
        .on("click.uieClassSave", "#uie-class-save", function (e) {
            e.preventDefault();
            e.stopPropagation();
            const st = getSettings();
            if (!st) return;
            ensureUiBuckets(st);
            const name = String($("#uie-rpg-class").val() || st.character?.className || "Class").trim().slice(0, 60) || "Class";
            const preset = {
                name,
                className: String($("#uie-rpg-class").val() || "").trim().slice(0, 60),
                level: Math.max(1, Number($("#uie-rpg-level").val() || 1) || 1),
                stats: (st.character?.stats && typeof st.character.stats === "object") ? { ...st.character.stats } : {},
                statusEffects: Array.isArray(st.character?.statusEffects) ? st.character.statusEffects.slice(0, 25) : []
            };
            const list = Array.isArray(st.character.classPresets) ? st.character.classPresets : [];
            const existing = list.findIndex(x => String(x?.name || "").trim().toLowerCase() === name.toLowerCase());
            if (existing >= 0) list[existing] = preset;
            else list.push(preset);
            st.character.classPresets = list.slice(0, 80);
            saveSettings();
            populateSettingsWindow();
        });

    $(document)
        .off("click.uieClassDelete")
        .on("click.uieClassDelete", "#uie-class-delete", function (e) {
            e.preventDefault();
            e.stopPropagation();
            const st = getSettings();
            if (!st) return;
            ensureUiBuckets(st);
            const idx = Number($("#uie-class-saved").val() || -1);
            if (!Array.isArray(st.character.classPresets) || idx < 0 || idx >= st.character.classPresets.length) return;
            st.character.classPresets.splice(idx, 1);
            saveSettings();
            $("#uie-class-saved").val("");
            populateSettingsWindow();
        });

    // Launcher Settings Logic
    $(document).on("input", "#uie-launcher-name", function() {
        const s = getSettings();
        if (!s.launcher) s.launcher = {};
        s.launcher.name = $(this).val();
        saveSettings();
        updateLayout();
    });

    $(document).on("change", "#uie-launcher-icon", function() {
        const val = $(this).val();
        if (val === "custom") {
            $("#uie-launcher-file").trigger("click");
            return;
        }
        const s = getSettings();
        if (!s.launcher) s.launcher = {};
        s.launcher.src = val;
        saveSettings();
        updateLayout();
        $("#uie-launcher-preview").hide();
    });

    $(document).on("change", "#uie-launcher-file", function() {
        const file = this.files && this.files[0];
        if (!file) {
             $("#uie-launcher-icon").val(""); 
             return;
        }
        const reader = new FileReader();
        reader.onload = function(ev) {
            const s = getSettings();
            if (!s.launcher) s.launcher = {};
            s.launcher.src = ev.target.result;
            saveSettings();
            updateLayout();
            $("#uie-launcher-preview").css("backgroundImage", `url("${s.launcher.src}")`).show();
        };
        reader.readAsDataURL(file);
        $(this).val("");
    });

    $(document).on("click", "#uie-launcher-refresh", async function(e) {
        e.preventDefault();
        e.stopPropagation();
        const $btn = $(this);
        $btn.addClass("fa-spin");
        
        const folder = "./assets/launcher/"; // Default convention
        try {
            // Attempt to list directory (requires server auto-indexing or valid response)
            const html = await $.get(folder).catch(() => "");
            if (!html) {
                 notify("info", "No 'assets/launcher/' folder found or accessible.", "UIE");
                 $btn.removeClass("fa-spin");
                 return;
            }
            const doc = new DOMParser().parseFromString(html, "text/html");
            const links = Array.from(doc.querySelectorAll("a"));
            const images = links
                .map(a => a.getAttribute("href"))
                .filter(href => href && /\.(png|jpg|jpeg|gif|svg|ico)$/i.test(href) && !href.startsWith("?"));
            
            const $sel = $("#uie-launcher-icon");
            // Remove old folder items (heuristic: if value contains /launcher/)
            $sel.find("option").each(function() {
                if ($(this).val().includes("/launcher/")) $(this).remove();
            });
            
            if (images.length === 0) {
                 notify("info", "No images found in assets/launcher/", "UIE");
            } else {
                 images.forEach(img => {
                     // Clean path
                     const name = decodeURIComponent(img.split("/").pop());
                     const fullPath = folder + name;
                     $sel.append(`<option value="${fullPath}">${name}</option>`);
                 });
                 notify("success", `Found ${images.length} icons.`, "UIE");
            }
        } catch (e) {
            console.error("Launcher Scan Error", e);
        }
        $btn.removeClass("fa-spin");
    });

    $(document)
        .off("click.uieSetTabs", ".uie-set-tab")
        .on("click.uieSetTabs", ".uie-set-tab", function (e) {
            e.preventDefault();
            e.stopPropagation();
            const $tab = $(this);
            const key = String($tab.data("tab") || "");
            if (!key) return;

            const inSettingsWindow = $tab.closest("#uie-settings-window").length > 0;
            const $scope = inSettingsWindow ? $("#uie-settings-window") : $(document);
            const $tabs = inSettingsWindow ? $("#uie-settings-window .uie-set-tab") : $(".uie-settings-drawer .uie-set-tab");

            $tabs.removeClass("active").css({ color: "#888", borderBottomColor: "transparent", fontWeight: "700" });
            $tab.addClass("active").css({ color: "#fff", borderBottomColor: "#cba35c", fontWeight: "700" });

            if (inSettingsWindow) {
                $("#uie-settings-window [id^='uie-sw-']").hide();
                $(`#uie-sw-${key}`).show();
            } else {
                $("[id^='uie-set-']").hide();
                $(`#uie-set-${key}`).show();
            }
        });

    // Close buttons
    $(document).on("click.uie", "#uie-inv-close", function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (window.UIE_invLock === true) return;
        $("#uie-inventory-window").removeAttr("data-uie-force-open").hide();
    });

    $(document).on("click.uie", ".uie-close-btn, #uie-phone-close, #uie-settings-close, #uie-diary-close, #uie-shop-close, #uie-social-close, #uie-debug-close", function(e) {
        try {
            const $rootPeek = $(this).closest(".uie-window, .uie-book-overlay, .uie-phone");
            if (($rootPeek.attr("id") || "") === "uie-inventory-window" && isMobileUI()) {
                if (window.UIE_invLock === true) {
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    return;
                }
                const t = Number(window.UIE_lastInventoryOpenAt || 0);
                if (t && Date.now() - t < 2000) {
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    return;
                }
            }
            if (($rootPeek.attr("id") || "") === "uie-phone-window" && isMobileUI()) {
                const t = Number(window.UIE_lastPhoneOpenAt || 0);
                if (t && Date.now() - t < 1250) {
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    return;
                }
            }
        } catch (_) {}
        e.stopPropagation();
        const $root = $(this).closest(".uie-window, .uie-book-overlay, .uie-phone");
        // HARD LOCK CHECK
        if (($root.attr("id") || "") === "uie-inventory-window" && window.UIE_invLock === true) return;
        
        $root.hide();
        if (($root.attr("id") || "") === "uie-settings-window") {
            const bd = document.getElementById("uie-modal-backdrop");
            if (bd) bd.style.display = "none";
        }
        if (($root.attr("id") || "") === "uie-inventory-window") {
            $root.removeAttr("data-uie-force-open");
        }
    });

    $(document).on("click.uie", "#uie-modal-backdrop", function (e) {
        e.preventDefault();
        e.stopPropagation();
        const sw = document.getElementById("uie-settings-window");
        if (sw && getComputedStyle(sw).display !== "none") {
            $("#uie-settings-window").hide();
        }
        this.style.display = "none";
    });

    // Global click to close menus
    $(document).on("click.uie", function(e) {
        // HARD LOCK CHECK
        if (window.UIE_invLock === true) {
             const inv = document.getElementById("uie-inventory-window");
             if (inv && inv.style.display !== "none" && $(e.target).closest("#uie-inventory-window").length) {
                 // Clicking inside inventory while locked is fine
             } else if (inv && inv.style.display !== "none") {
                 // Clicking outside inventory while locked -> IGNORE
                 return;
             }
        }
        if (!$(e.target).closest("#uie-social-sparkle, #uie-social-menu").length) {
            $("#uie-social-menu").hide();
        }
        if (!$(e.target).closest("#uie-journal-sparkle, #uie-journal-menu").length) {
            $("#uie-journal-menu").hide();
        }
    });

    // Keybindings
    $(document).on("keydown.uie", function(e) {
        if ((e.key === "i" || e.key === "I") && !$(e.target).is("input, textarea, [contenteditable]")) {
            if ($("#uie-inventory-window").is(":visible")) {
                $("#uie-inventory-window").removeAttr("data-uie-force-open").hide();
            } else {
                ensureInventoryShell().then((ok) => {
                    if (!ok) return;
                    openWindow("#uie-inventory-window", "./inventory.js", "initInventory");
                });
            }
        }
    });

    applyMenuVisibility();
}

function applyMenuVisibility() {
    import("./core.js").then(core => {
        const s = core.getSettings();
        if (!s.menuHidden) s.menuHidden = {};

        const set = (id, hidden) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.style.display = hidden ? "none" : "";
        };

        set("uie-btn-inventory", !!s.menuHidden.inventory);
        set("uie-btn-shop", !!s.menuHidden.shop);
        set("uie-btn-journal", !!s.menuHidden.journal);
        set("uie-btn-diary", !!s.menuHidden.diary);
        set("uie-btn-social", !!s.menuHidden.social);
        set("uie-btn-party", !!s.menuHidden.party);
        set("uie-btn-battle", !!s.menuHidden.battle);
        set("uie-btn-open-phone", !!s.menuHidden.phone);
        set("uie-btn-open-map", !!s.menuHidden.map);
        set("uie-btn-open-calendar", !!s.menuHidden.calendar);
        set("uie-btn-databank", !!s.menuHidden.databank);
        set("uie-btn-open-world", !!s.menuHidden.world);
        set("uie-btn-open-settings", !!s.menuHidden.settings);
        set("uie-btn-debug", !!s.menuHidden.debug);
        set("uie-btn-help", !!s.menuHidden.help);
    });
}

// ... Additional handlers for settings inputs ...
