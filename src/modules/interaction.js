import { getSettings, saveSettings, updateLayout, isMobileUI, ensureChatStateLoaded } from "./core.js";
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
    const pending = (window.UIE_pendingUnifiedScan = window.UIE_pendingUnifiedScan || { pending: false, sig: "", at: 0, reason: "" });

    const hash = (str) => {
        let h = 0;
        const s = String(str || "");
        for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
        return String(h);
    };

    const lastChatText = () => {
        try {
            const $txt = $(".chat-msg-txt");
            if ($txt.length) return String($txt.last().text() || "");
            const chatEl = document.getElementById("chat");
            if (!chatEl) return "";
            const last = chatEl.querySelector(".mes:last-child") || chatEl.lastElementChild;
            if (!last) return "";
            return String(
                last.querySelector?.(".mes_text")?.textContent ||
                last.querySelector?.(".mes-text")?.textContent ||
                last.textContent ||
                ""
            );
        } catch (_) {
            return "";
        }
    };

    const markRequested = (reason) => {
        try {
            pending.pending = true;
            pending.at = Date.now();
            pending.reason = String(reason || "");
            pending.sig = hash(lastChatText().slice(-1200));
        } catch (_) {}
    };

    $(document)
        .off("click.uieScanRequest")
        .on("click.uieScanRequest", "#continue_but, #send_but, #regenerate_but, #impersonate_but, #continue, #regenerate, [data-testid='continue'], [data-testid='regenerate']", function () {
            markRequested(this?.id || "generate");
        });
    
    chatObserver = new MutationObserver(() => {
        // Debounce scan
        if (timeout) clearTimeout(timeout);
        timeout = setTimeout(() => {
            const s = getSettings();
            if (s?.generation?.scanOnlyOnGenerateButtons === true && !pending.pending) return;
            if (s?.generation?.scanOnlyOnGenerateButtons === true) {
                const sigNow = hash(lastChatText().slice(-1200));
                if (sigNow === String(pending.sig || "")) return;
                pending.pending = false;
                pending.sig = sigNow;
            }
            scanEverything();
        }, 3000); // Scan 3 seconds after chat stops updating
    });
    
    chatObserver.observe(chat, { childList: true, subtree: true });
}

let ST = null;

export async function getST() {
    if (ST) return ST;
    try {
        const ext = await import("/scripts/extensions.js");
        ST = {
            ext,
            getContext: ext.getContext ? ext.getContext : null,
            extension_settings: ext.extension_settings ?? null,
            saveSettingsDebounced: ext.saveSettingsDebounced ?? null,
            eventSource: ext.eventSource ?? null,
        };
    } catch (e) {
        console.warn("UIE: /scripts/extensions.js import failed", e);
        ST = {};
    }
    return ST;
}

export async function execSlash(cmd) {
    const st = await getST();
    const ctx = st.getContext ? st.getContext() : (window.SillyTavern?.getContext?.() ?? null);
    if (!ctx) return null;

    const fn = ctx.executeSlashCommandsWithOptions || ctx.executeSlashCommands || ctx.executeSlashCommandsAsync;
    if (!fn) return null;

    try {
        return await fn(cmd, { silent: true, noOutput: true });
    } catch (e) {
        try { return await fn(cmd); } catch (_) { return null; }
    }
}

export async function getConnectionProfilesLive() {
    // 1. Try Slash Command (Server-side source of truth)
    const raw = await execSlash("/profile-list");
    if (raw) {
        const text = typeof raw === "string" ? raw : (raw?.text ?? raw?.result ?? raw?.output ?? String(raw));
        const jsonStart = text.indexOf("[");
        const jsonEnd = text.lastIndexOf("]");
        if (jsonStart >= 0 && jsonEnd > jsonStart) {
            try {
                const names = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
                if (Array.isArray(names)) {
                    return names.map(n => ({ id: n, name: n }));
                }
            } catch (_) {}
        }
    }

    // 2. Fallback: Context inspection (Client-side cache)
    const { getContext } = await getST();
    const ctx = getContext?.();
    const root =
        ctx?.settings ??
        ctx?.SillyTavern?.settings ??
        window.settings ??
        window.power_user ??
        window.SillyTavern ??
        {};

    const candidates = [
        root.connectionProfiles,
        root.connection_profiles,
        root.apiProfiles,
        root.api_profiles,
        root.connections?.profiles,
        root.api?.profiles,
    ];

    for (const c of candidates) {
        if (!c) continue;
        if (Array.isArray(c)) {
            return c.map((p, i) => ({
                id: p.id ?? p.key ?? String(i),
                name: p.name ?? p.title ?? p.profile_name ?? `Profile ${i + 1}`,
            }));
        }
        if (typeof c === "object") {
            return Object.entries(c).map(([id, p]) => ({
                id,
                name: p?.name ?? p?.title ?? p?.profile_name ?? id,
            }));
        }
    }
    return [];
}

export function initSTPresets() {
    // Robust "SillySim-style" finder
    const findSTSelect = () => {
        const candidates = Array.from(document.querySelectorAll("select"));
        // 1. Try exact known IDs first
        const exact = candidates.find(s => 
            s.id === "api_preset" || 
            s.id === "settings_preset_api" || 
            s.id === "connection_profile" ||
            s.id === "connection_profiles"
        );
        if (exact) return exact;

        // 2. Heuristic search
        return candidates.find(sel => {
            const id = (sel.id || "").toLowerCase();
            const cls = (sel.className || "").toLowerCase();
            const name = (sel.name || "").toLowerCase();
            const label = sel.labels?.[0]?.textContent?.toLowerCase() || "";
            
            // Check attributes
            if (id.includes("preset") && (id.includes("api") || id.includes("conn"))) return true;
            if (name.includes("preset") && (name.includes("api") || name.includes("conn"))) return true;
            
            // Check options content (look for "OpenAI", "Claude", "Kobold", etc or just "Default")
            if (sel.options.length > 1) {
                const optText = Array.from(sel.options).map(o => o.text.toLowerCase()).join(" ");
                if (optText.includes("default") && (id.includes("profile") || label.includes("profile"))) return true;
            }
            return false;
        });
    };

    const syncPresets = async () => {
        const $uie = $("#uie-st-preset-select");
        let stSel = findSTSelect();
        
        // Retry loop (up to 15s)
        let tries = 0;
        while ((!stSel || stSel.options.length < 1) && tries < 60) {
            await new Promise(r => setTimeout(r, 250));
            stSel = findSTSelect();
            tries++;
        }

        if (!stSel) {
            // Last ditch: Slash Command
            const raw = await execSlash("/profile-list");
            if (raw) {
                try {
                    const text = typeof raw === "string" ? raw : (raw?.text ?? String(raw));
                    const jsonStart = text.indexOf("[");
                    const jsonEnd = text.lastIndexOf("]");
                    if (jsonStart >= 0) {
                        const names = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
                        if (Array.isArray(names)) {
                            $uie.empty().append('<option value="">(Select Profile)</option>');
                            names.forEach(n => $uie.append(`<option value="${n}">${n}</option>`));
                            return;
                        }
                    }
                } catch (_) {}
            }
            $uie.html('<option value="">(ST Presets Not Found)</option>');
            return;
        }

        // Mirror options
        const $st = $(stSel);
        const currentVal = $uie.val();
        $uie.empty();
        $st.find("option").each(function() {
            $uie.append($(this).clone());
        });
        
        // Sync selection
        if ($st.val()) $uie.val($st.val());
        else if (currentVal) $uie.val(currentVal);

        // Bind observer
        if (!window.UIE_profileObs) {
            window.UIE_profileObs = new MutationObserver(() => syncPresets());
            window.UIE_profileObs.observe(stSel, { childList: true, subtree: true, attributes: true });
        }
    };

    $(document).on("click", "#uie-st-preset-refresh", function(e) {
        e.preventDefault();
        syncPresets();
        notify("info", "Presets synced with SillyTavern", "UIE");
    });

    $(document).on("change", "#uie-st-preset-select", async function() {
        const val = $(this).val();
        if (!val) return;
        
        const stSel = findSTSelect();
        if (stSel) {
            $(stSel).val(val).trigger("change");
            // Also dispatch native event for React/Vue listeners
            stSel.dispatchEvent(new Event("change", { bubbles: true }));
            notify("success", `Switched Profile: ${val}`, "UIE");
        } else {
            await execSlash(`/profile-load ${val}`);
            notify("success", `Loaded Profile: ${val}`, "UIE");
        }
    });
    
    // Initial sync
    setTimeout(syncPresets, 1000);
    $(document).on("click", ".uie-set-tab[data-tab='profiles']", syncPresets);
}

export function updateStateLists() {
    const s = getSettings();
    const list = s.savedStates || {};
    const opts = Object.keys(list).sort().map(k => `<option value="${k}">${k}</option>`).join("");
    $(".uie-state-select").html(`<option value="">(Select Save...)</option>${opts}`);
}

export function initInteractions() {
    updateStateLists();
    initSTPresets();
    const s = getSettings();
    const disabled = s.enabled === false;
    if (!disabled) initChatListener();
    $(document).off("click.uie"); 

    const injectScanAll = () => {
        if (document.getElementById("uie-scanall-btn")) return true;
        const host =
            document.querySelector("#extensionsMenu") ||
            document.querySelector("#extensions_menu") ||
            document.querySelector("#options") ||
            document.querySelector("#chat_controls") ||
            document.querySelector("#send_form") ||
            document.querySelector("#form_sheld") ||
            null;
        if (!host) return false;
        const btn = document.createElement("button");
        btn.id = "uie-scanall-btn";
        btn.type = "button";
        btn.textContent = "UIE Scan All";
        btn.style.cssText = "margin:4px; padding:6px 10px; border-radius:10px; border:1px solid rgba(255,255,255,0.18); background:rgba(203,163,92,0.16); color:#cba35c; font-weight:900; cursor:pointer;";
        btn.addEventListener("click", async (e) => {
            e.preventDefault(); e.stopPropagation();
            try { await scanEverything(); } catch (_) {}
        });
        try {
            const anchor = document.querySelector("#continue_but") || document.querySelector("#regenerate_but");
            if (anchor && anchor.parentElement) anchor.parentElement.insertBefore(btn, anchor.nextSibling);
            else host.appendChild(btn);
        } catch (_) {
            try { host.appendChild(btn); } catch (_) {}
        }
        return true;
    };
    try {
        if (!injectScanAll()) {
            let tries = 0;
            const t = setInterval(() => {
                tries++;
                if (injectScanAll() || tries > 20) clearInterval(t);
            }, 750);
        }
    } catch (_) {}

    const baseUrl = (() => {
        try {
            const u = String(window.UIE_BASEURL || "");
            if (u) return u.endsWith("/") ? u : `${u}/`;
        } catch (_) {}
        return "/scripts/extensions/third-party/universal-immersion-engine/";
    })();

    const ensureLauncherStore = (s2) => {
        if (!s2.launcher) s2.launcher = {};
        if (!Array.isArray(s2.launcher.savedIcons)) s2.launcher.savedIcons = [];
    };

    const syncLauncherIconSelect = (s2) => {
        try {
            ensureLauncherStore(s2);
            const sel = document.getElementById("uie-launcher-icon");
            if (!sel) return;

            Array.from(sel.querySelectorAll("optgroup[data-uie-saved='1']")).forEach(x => x.remove());
            Array.from(sel.querySelectorAll("option[data-uie-temp='1']")).forEach(x => x.remove());

            const list = s2.launcher.savedIcons
                .map(x => ({ id: String(x?.id || ""), name: String(x?.name || "").trim(), dataUrl: String(x?.dataUrl || x?.data || "") }))
                .filter(x => x.id && x.name && x.dataUrl && x.dataUrl.startsWith("data:"))
                .slice(0, 40);

            if (!list.length) return;

            const g = document.createElement("optgroup");
            g.label = "Saved Icons";
            g.setAttribute("data-uie-saved", "1");
            for (const it of list) {
                const o = document.createElement("option");
                o.value = it.dataUrl;
                o.textContent = it.name.slice(0, 60);
                o.setAttribute("data-uie-saved", "1");
                o.setAttribute("data-uie-saved-id", it.id);
                g.appendChild(o);
            }

            const customOpt = sel.querySelector("option[value='custom']");
            if (customOpt && customOpt.parentNode === sel) sel.insertBefore(g, customOpt.nextSibling);
            else sel.insertBefore(g, sel.firstChild);
        } catch (_) {}
    };

    const setLauncherPreview = (src) => {
        const v = String(src || "");
        if (v && v.startsWith("data:")) $("#uie-launcher-preview").css("backgroundImage", `url("${v}")`).show();
        else $("#uie-launcher-preview").hide();
    };

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

    const renderTurboModels = (models, selected = "") => {
        try {
            const sel = document.getElementById("uie-turbo-model-select");
            if (!sel) return;
            const cur = String(selected || "");
            const urlNow = String(getSettings()?.turbo?.url || "").trim().toLowerCase();
            const isNvidia = urlNow.includes("nvidia.com");
            const isNanoGpt = urlNow.includes("nano-gpt.com") || urlNow.includes("nanogpt");
            sel.innerHTML = "";
            const opt0 = document.createElement("option");
            opt0.value = "";
            opt0.textContent = models && models.length ? "(Select a model)" : "(Refresh to load models)";
            sel.appendChild(opt0);
            const optC = document.createElement("option");
            optC.value = "__custom__";
            optC.textContent = "Custom…";
            sel.appendChild(optC);

            const suggested = [
                { id: "openai/gpt-4.1-nano", label: "OpenAI: gpt-4.1-nano" },
                { id: "nvidia/llama-3.1-nemotron-70b-instruct", label: "NVIDIA: llama-3.1-nemotron-70b-instruct" }
            ];
            const seen = new Set();
            const addOpt = (group, id, label) => {
                const v = String(id || "").trim();
                if (!v || seen.has(v)) return;
                seen.add(v);
                const o = document.createElement("option");
                o.value = v;
                o.textContent = String(label || v).trim().slice(0, 140);
                group.appendChild(o);
            };
            const gS = document.createElement("optgroup");
            gS.label = "Suggested Models";
            for (const it of suggested) addOpt(gS, it.id, it.label);
            sel.appendChild(gS);

            if (!Array.isArray(models) || !models.length) {
                if (isNvidia) {
                    const gN = document.createElement("optgroup");
                    gN.label = "NVIDIA Models (Fallback)";
                    const list = [
                        { id: "meta/llama-3.1-8b-instruct", label: "Meta: Llama 3.1 8B Instruct" },
                        { id: "meta/llama-3.1-70b-instruct", label: "Meta: Llama 3.1 70B Instruct" },
                        { id: "meta/llama-3.2-1b-instruct", label: "Meta: Llama 3.2 1B Instruct" },
                        { id: "meta/llama-3.2-3b-instruct", label: "Meta: Llama 3.2 3B Instruct" },
                        { id: "meta/llama-3.2-11b-vision-instruct", label: "Meta: Llama 3.2 11B Vision Instruct" },
                        { id: "meta/llama-3.2-90b-vision-instruct", label: "Meta: Llama 3.2 90B Vision Instruct" },
                        { id: "meta/llama-4-scout-17b-16e-instruct", label: "Meta: Llama 4 Scout 17B 16E Instruct" },
                        { id: "nvidia/nemotron-nano-12b-v2-vl", label: "NVIDIA: Nemotron Nano 12B v2 VL" }
                    ];
                    for (const it of list) addOpt(gN, it.id, it.label);
                    sel.appendChild(gN);
                } else if (isNanoGpt) {
                    const gN = document.createElement("optgroup");
                    gN.label = "NanoGPT (Tip)";
                    addOpt(gN, "deepseek/deepseek-chat-v3-0324", "DeepSeek: deepseek-chat-v3-0324");
                    addOpt(gN, "chatgpt-4o-latest", "OpenAI: chatgpt-4o-latest");
                    sel.appendChild(gN);
                }
            }

            if (Array.isArray(models) && models.length) {
                const g = document.createElement("optgroup");
                g.label = "Available Models";
                for (const m of models.slice(0, 800)) {
                    const id = String(m?.id || "").trim();
                    if (!id) continue;
                    const label = String(m?.label || id).trim();
                    const o = document.createElement("option");
                    o.value = id;
                    o.textContent = label.slice(0, 140);
                    g.appendChild(o);
                }
                sel.appendChild(g);
            }

            if (cur) {
                const has = Array.from(sel.options).some(o => String(o.value) === cur);
                sel.value = has ? cur : "__custom__";
            }
        } catch (_) {}
    };

    const detectImageProvider = (s2) => {
        const url = String(s2?.image?.url || "").trim();
        const wf = String(s2?.image?.comfy?.workflow || "").trim();
        if (/\/sdapi\/v1\/txt2img\s*$/i.test(url)) return "sdwebui";
        if (/\/v1\/images\/generations\s*$/i.test(url) || /\/images\/generations\s*$/i.test(url) || !url) return "openai";
        if (/\/prompt\s*$/i.test(url) || /:(8188|8189)(\/|$)/i.test(url) || wf) return "comfy";
        return "custom";
    };

    const showImageBlocks = (provider) => {
        const p = String(provider || "openai");
        $("#uie-img-openai-block").toggle(p === "openai" || p === "custom");
        $("#uie-img-comfy-block").toggle(p === "comfy");
        $("#uie-img-sdwebui-block").toggle(p === "sdwebui");
        $("#uie-img-advanced").toggle(p === "custom");
    };

    const renderComfyCkpts = (list, selected = "") => {
        try {
            const sel = document.getElementById("uie-img-comfy-ckpt");
            if (!sel) return;
            const cur = String(selected || "");
            sel.innerHTML = "";
            const opt0 = document.createElement("option");
            opt0.value = "";
            opt0.textContent = list && list.length ? "(Select a checkpoint)" : "(Click refresh to detect)";
            sel.appendChild(opt0);
            const g = document.createElement("optgroup");
            g.label = "Checkpoints";
            if (Array.isArray(list)) {
                for (const x of list.slice(0, 500)) {
                    const v =
                        typeof x === "string" ? String(x).trim() :
                        (x && typeof x === "object") ? String(x.name || x.title || x.label || x.id || x.ckpt_name || x.checkpoint || "").trim() :
                        "";
                    if (!v) continue;
                    const o = document.createElement("option");
                    o.value = v;
                    o.textContent = v.slice(0, 120);
                    g.appendChild(o);
                }
            }
            sel.appendChild(g);
            if (cur) {
                const has = Array.from(sel.options).some(o => String(o.value) === cur);
                if (has) sel.value = cur;
                else {
                    const o = document.createElement("option");
                    o.value = cur;
                    o.textContent = cur.slice(0, 120);
                    o.setAttribute("data-uie-missing", "1");
                    sel.insertBefore(o, sel.firstChild?.nextSibling || null);
                    sel.value = cur;
                }
            }
        } catch (_) {}
    };

    const refreshProfileSelect = (scope, s2) => {
        try {
            const sel = scope?.querySelector?.("#uie-profile-select");
            if (!sel) return;
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

            const shouldTryLoad =
                !window.UIE_ST_CONN_PROFILES_LOADING &&
                (!Array.isArray(window.UIE_ST_CONN_PROFILES) || (Array.isArray(window.UIE_ST_CONN_PROFILES) && window.UIE_ST_CONN_PROFILES.length === 0 && window.UIE_ST_CONN_PROFILES_TRIED !== true));

            if (shouldTryLoad) {
                window.UIE_ST_CONN_PROFILES_LOADING = true;
                window.UIE_ST_CONN_PROFILES_TRIED = true;
                const fromLocalStorage = () => {
                    try {
                        const keys = ["connection_profiles", "connectionProfiles", "st_connection_profiles", "stConnectionProfiles"];
                        for (const k of keys) {
                            const raw = localStorage.getItem(k);
                            if (!raw) continue;
                            const j = JSON.parse(raw);
                            if (j) return j;
                        }
                    } catch (_) {}
                    return null;
                };
                import("../../../../../extensions.js").then((mod) => {
                    const ctx = mod?.getContext?.() || {};
                    const raw =
                        ctx?.connection_profiles ||
                        ctx?.connectionProfiles ||
                        ctx?.connections ||
                        ctx?.profiles ||
                        ctx?.api_settings?.connection_profiles ||
                        ctx?.api_settings?.connectionProfiles ||
                        window?.connection_profiles ||
                        window?.connectionProfiles ||
                        window?.SillyTavern?.connection_profiles ||
                        window?.SillyTavern?.connectionProfiles ||
                        fromLocalStorage() ||
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
        } catch (_) {}
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
            const sel = scope.querySelector("#uie-turbo-model-select");
            if (sel) {
                const models = Array.isArray(window.UIE_TURBO_MODELS) ? window.UIE_TURBO_MODELS : [];
                renderTurboModels(models, String(s2.turbo?.model || ""));
                const urlNow = String(s2.turbo?.url || "").trim();
                const shouldTry =
                    urlNow &&
                    window.UIE_TURBO_MODELS_TRIED !== true &&
                    (!models.length);
                if (shouldTry) {
                    window.UIE_TURBO_MODELS_TRIED = true;
                    setTimeout(async () => {
                        try {
                            const mod = await import("./apiClient.js");
                            const r = await mod.listTurboModels();
                            if (r?.ok && Array.isArray(r.models)) {
                                window.UIE_TURBO_MODELS = r.models;
                                renderTurboModels(r.models, String(getSettings()?.turbo?.model || ""));
                            }
                        } catch (_) {}
                    }, 0);
                }
            }
        } catch (_) {}

        try {
            const imgEnable = scope.querySelector("#uie-img-enable");
            if (imgEnable) imgEnable.checked = s2.image?.enabled === true;
            const provider = detectImageProvider(s2);
            const provSel = scope.querySelector("#uie-img-provider");
            if (provSel) provSel.value = provider;

            const url = String(s2.image?.url || "");
            const key = String(s2.image?.key || "");
            const model = String(s2.image?.model || "");

            const imgUrl = scope.querySelector("#uie-img-url");
            if (imgUrl) imgUrl.value = url;
            const imgKey = scope.querySelector("#uie-img-key");
            if (imgKey) imgKey.value = key;
            const imgModel = scope.querySelector("#uie-img-model");
            if (imgModel) imgModel.value = model;

            const imgModelSel = scope.querySelector("#uie-img-model-select");
            if (imgModelSel) {
                const has = Array.from(imgModelSel.options).some(o => String(o.value) === model);
                imgModelSel.value = has ? model : "__custom__";
            }

            const comfyBase = scope.querySelector("#uie-img-comfy-base");
            if (comfyBase) comfyBase.value = url ? String(url).replace(/\/prompt\s*$/i, "").replace(/\/+$/g, "") : "http://127.0.0.1:8188";
            const neg = scope.querySelector("#uie-img-negative");
            if (neg) neg.value = String(s2.image?.negativePrompt || "");
            const q = scope.querySelector("#uie-img-comfy-quality");
            if (q) q.value = String(s2.image?.comfy?.quality || "balanced");
            try {
                if (!s2.image.comfy) s2.image.comfy = {};
                if (!s2.image.comfy.easy || typeof s2.image.comfy.easy !== "object") {
                    s2.image.comfy.easy = { sampler: "euler_ancestral", scheduler: "normal", steps: 24, cfg: 7, width: 768, height: 768, denoise: 1, seed: -1, common: "", commonNeg: "" };
                }
                const ez = s2.image.comfy.easy;
                const setV = (id, v) => { const el = scope.querySelector(id); if (el) el.value = String(v ?? ""); };
                setV("#uie-img-comfy-sampler", ez.sampler ?? "euler_ancestral");
                setV("#uie-img-comfy-scheduler", ez.scheduler ?? "normal");
                setV("#uie-img-comfy-steps", ez.steps ?? 24);
                setV("#uie-img-comfy-cfg", ez.cfg ?? 7);
                setV("#uie-img-comfy-width", ez.width ?? 768);
                setV("#uie-img-comfy-height", ez.height ?? 768);
                setV("#uie-img-comfy-denoise", ez.denoise ?? 1);
                setV("#uie-img-comfy-seed", ez.seed ?? -1);
                setV("#uie-img-comfy-common", ez.common ?? "");
                setV("#uie-img-comfy-common-neg", ez.commonNeg ?? "");
            } catch (_) {}
            const sd = scope.querySelector("#uie-img-sdwebui-url");
            if (sd) sd.value = url || "http://127.0.0.1:7860/sdapi/v1/txt2img";

            const advUrl = scope.querySelector("#uie-img-url-adv");
            if (advUrl) advUrl.value = url;
            const advKey = scope.querySelector("#uie-img-key-adv");
            if (advKey) advKey.value = key;
            const advModel = scope.querySelector("#uie-img-model-adv");
            if (advModel) advModel.value = model;

            const ckpt = String(s2.image?.comfy?.checkpoint || "");
            const ckpts = Array.isArray(window.UIE_COMFY_CKPTS) ? window.UIE_COMFY_CKPTS : [];
            renderComfyCkpts(ckpts, ckpt);

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
            showImageBlocks(provider);
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
            const onlyBtn = scope.querySelector("#uie-gen-scan-only-buttons");
            if (onlyBtn) onlyBtn.checked = s2.generation?.scanOnlyOnGenerateButtons !== false;
        } catch (_) {}
        try {
            const sysMin = scope.querySelector("#uie-gen-syscheck-min");
            const autoMin = scope.querySelector("#uie-gen-autoscan-min");
            if (sysMin) sysMin.value = String(Math.max(0, Math.round(Number(s2?.generation?.systemCheckMinIntervalMs || 0) / 1000)));
            if (autoMin) autoMin.value = String(Math.max(0, Math.round(Number(s2?.generation?.autoScanMinIntervalMs || 0) / 1000)));
        } catch (_) {}

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

        refreshProfileSelect(scope, s2);

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
        try { refreshProfileSelect(document.getElementById("uie-settings-window"), st); } catch (_) {}

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
        .off("click.uieTurboPresetApply", "#uie-turbo-preset-apply")
        .on("click.uieTurboPresetApply", "#uie-turbo-preset-apply", function (e) {
            e.preventDefault();
            e.stopPropagation();
            const s2 = getSettings();
            if (!s2.turbo || typeof s2.turbo !== "object") s2.turbo = {};
            const preset = String($("#uie-turbo-preset").val() || "openrouter");
            const setAll = (url, keyPlaceholder, model) => {
                s2.turbo.url = String(url || "");
                if (model) s2.turbo.model = String(model);
                saveSettings();
                $("#uie-turbo-url").val(s2.turbo.url);
                $("#uie-turbo-key").attr("placeholder", keyPlaceholder || "sk-...");
                if (model) $("#uie-turbo-model").val(String(model));
                try { window.UIE_TURBO_MODELS = []; window.UIE_TURBO_MODELS_TRIED = false; } catch (_) {}
            };
            if (preset === "nanogpt") {
                setAll("https://nano-gpt.com/api/v1/chat/completions", "ngpt_...", String(s2.turbo?.model || ""));
                return;
            }
            if (preset === "nvidia_nim") {
                setAll("https://integrate.api.nvidia.com/v1/chat/completions", "nvapi-...", String(s2.turbo?.model || ""));
                return;
            }
            if (preset === "openrouter") {
                setAll("https://openrouter.ai/api/v1/chat/completions", "sk-or-...", String(s2.turbo?.model || ""));
                return;
            }
        });
    $(document)
        .off("change.uieTurboUrl", "#uie-turbo-url")
        .on("change.uieTurboUrl", "#uie-turbo-url", function () {
            const s2 = getSettings();
            if (!s2.turbo || typeof s2.turbo !== "object") s2.turbo = {};
            s2.turbo.url = String($(this).val() || "").trim();
            try { window.UIE_TURBO_MODELS = []; window.UIE_TURBO_MODELS_TRIED = false; } catch (_) {}
            saveSettings();
        });
    $(document)
        .off("input.uieTurboUrl", "#uie-turbo-url")
        .on("input.uieTurboUrl", "#uie-turbo-url", function () {
            const v = String($(this).val() || "").trim();
            const s2 = getSettings();
            if (!s2.turbo || typeof s2.turbo !== "object") s2.turbo = {};
            s2.turbo.url = v;
            try {
                clearTimeout(window.UIE_turboSaveTimer);
                window.UIE_turboSaveTimer = setTimeout(() => { try { saveSettings(); } catch (_) {} }, 250);
            } catch (_) {
                saveSettings();
            }
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
        .off("input.uieTurboModel", "#uie-turbo-model")
        .on("input.uieTurboModel", "#uie-turbo-model", function () {
            const v = String($(this).val() || "").trim();
            const s2 = getSettings();
            if (!s2.turbo || typeof s2.turbo !== "object") s2.turbo = {};
            s2.turbo.model = v;
            try {
                const sel = document.getElementById("uie-turbo-model-select");
                if (sel) {
                    const has = Array.from(sel.options).some(o => String(o.value) === v);
                    sel.value = has ? v : "__custom__";
                }
            } catch (_) {}
            try {
                clearTimeout(window.UIE_turboSaveTimer);
                window.UIE_turboSaveTimer = setTimeout(() => { try { saveSettings(); } catch (_) {} }, 250);
            } catch (_) {
                saveSettings();
            }
        });

    $(document)
        .off("change.uieTurboModelSelect", "#uie-turbo-model-select")
        .on("change.uieTurboModelSelect", "#uie-turbo-model-select", function () {
            const val = String($(this).val() || "");
            if (!val) return;
            if (val === "__custom__") {
                try { $("#uie-turbo-model").trigger("focus"); } catch (_) {}
                return;
            }
            $("#uie-turbo-model").val(val);
            const s2 = getSettings();
            if (!s2.turbo || typeof s2.turbo !== "object") s2.turbo = {};
            s2.turbo.model = val;
            saveSettings();
        });

    $(document)
        .off("click.uieTurboModelsRefresh", "#uie-turbo-model-refresh")
        .on("click.uieTurboModelsRefresh", "#uie-turbo-model-refresh", async function (e) {
            e.preventDefault();
            e.stopPropagation();
            const btn = $(this);
            btn.prop("disabled", true);
            try {
                const mod = await import("./apiClient.js");
                const r = await mod.listTurboModels();
                if (r?.ok && Array.isArray(r.models)) {
                    window.UIE_TURBO_MODELS = r.models;
                    renderTurboModels(r.models, String(getSettings()?.turbo?.model || ""));
                    try { window.toastr?.success?.(`Loaded ${r.models.length} models.`); } catch (_) {}
                } else {
                    const msg = String(r?.error || "Model list failed.");
                    try { window.toastr?.error?.(msg); } catch (_) {}
                }
            } catch (err) {
                try { window.toastr?.error?.(String(err?.message || err || "Model list failed.")); } catch (_) {}
            } finally {
                btn.prop("disabled", false);
            }
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
                    const lt = window.UIE_lastTurbo || {};
                    const extra = lt?.requestUrl ? ` | tried: ${String(lt.requestUrl).slice(0, 140)} | via: ${String(lt.via || "direct")} | status: ${String(lt.status || 0)}` : "";
                    try { window.toastr?.error?.(`Turbo FAIL: ${msg}${hint}${extra}`); } catch (_) {}
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
        .off("input.uieTurboKey", "#uie-turbo-key")
        .on("input.uieTurboKey", "#uie-turbo-key", function () {
            const v = String($(this).val() || "").trim();
            const s2 = getSettings();
            if (!s2.turbo || typeof s2.turbo !== "object") s2.turbo = {};
            s2.turbo.key = v;
            try {
                clearTimeout(window.UIE_turboSaveTimer);
                window.UIE_turboSaveTimer = setTimeout(() => { try { saveSettings(); } catch (_) {} }, 250);
            } catch (_) {
                saveSettings();
            }
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
        .off("change.uieImgProvider", "#uie-img-provider")
        .on("change.uieImgProvider", "#uie-img-provider", function () {
            const p = String($(this).val() || "openai");
            const s2 = getSettings();
            if (!s2.image || typeof s2.image !== "object") s2.image = {};
            if (!s2.image.comfy || typeof s2.image.comfy !== "object") s2.image.comfy = {};
            if (p === "openai") {
                s2.image.url = "https://api.openai.com/v1/images/generations";
                if (!s2.image.model) s2.image.model = "dall-e-3";
            } else if (p === "comfy") {
                s2.image.url = "http://127.0.0.1:8188";
                if (!s2.image.comfy.quality) s2.image.comfy.quality = "balanced";
            } else if (p === "sdwebui") {
                s2.image.url = "http://127.0.0.1:7860/sdapi/v1/txt2img";
            }
            saveSettings();
            try { refreshSettingsDrawer(); } catch (_) {}
        });

    $(document)
        .off("change.uieImgUrl", "#uie-img-url, #uie-img-url-adv")
        .on("change.uieImgUrl", "#uie-img-url, #uie-img-url-adv", function () {
            const s2 = getSettings();
            if (!s2.image || typeof s2.image !== "object") s2.image = {};
            s2.image.url = String($(this).val() || "").trim();
            $("#uie-img-url").val(s2.image.url);
            $("#uie-img-url-adv").val(s2.image.url);
            saveSettings();
            try { $("#uie-img-provider").val(detectImageProvider(s2)); showImageBlocks(detectImageProvider(s2)); } catch (_) {}
        });
    $(document)
        .off("change.uieImgKey", "#uie-img-key, #uie-img-key-adv")
        .on("change.uieImgKey", "#uie-img-key, #uie-img-key-adv", function () {
            const s2 = getSettings();
            if (!s2.image || typeof s2.image !== "object") s2.image = {};
            s2.image.key = String($(this).val() || "").trim();
            $("#uie-img-key").val(s2.image.key);
            $("#uie-img-key-adv").val(s2.image.key);
            saveSettings();
        });
    $(document)
        .off("change.uieImgModel", "#uie-img-model, #uie-img-model-adv")
        .on("change.uieImgModel", "#uie-img-model, #uie-img-model-adv", function () {
            const s2 = getSettings();
            if (!s2.image || typeof s2.image !== "object") s2.image = {};
            s2.image.model = String($(this).val() || "").trim();
            $("#uie-img-model").val(s2.image.model);
            $("#uie-img-model-adv").val(s2.image.model);
            try {
                const sel = document.getElementById("uie-img-model-select");
                if (sel) {
                    const has = Array.from(sel.options).some(o => String(o.value) === s2.image.model);
                    sel.value = has ? s2.image.model : "__custom__";
                }
            } catch (_) {}
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
        .off("change.uieImgModelSelect", "#uie-img-model-select")
        .on("change.uieImgModelSelect", "#uie-img-model-select", function () {
            const v = String($(this).val() || "");
            if (!v || v === "__custom__") return;
            $("#uie-img-model").val(v);
            $("#uie-img-model-adv").val(v);
            const s2 = getSettings();
            if (!s2.image || typeof s2.image !== "object") s2.image = {};
            s2.image.model = v;
            saveSettings();
        });

    $(document)
        .off("input.uieImgComfyBase", "#uie-img-comfy-base")
        .on("input.uieImgComfyBase", "#uie-img-comfy-base", function () {
            const base = String($(this).val() || "").trim().replace(/\/prompt\s*$/i, "").replace(/\/+$/g, "");
            const s2 = getSettings();
            if (!s2.image || typeof s2.image !== "object") s2.image = {};
            s2.image.url = base;
            $("#uie-img-url").val(base);
            $("#uie-img-url-adv").val(base);
            saveSettings();
        });

    $(document)
        .off("change.uieImgSdWebUiUrl", "#uie-img-sdwebui-url")
        .on("change.uieImgSdWebUiUrl", "#uie-img-sdwebui-url", function () {
            const v = String($(this).val() || "").trim();
            const s2 = getSettings();
            if (!s2.image || typeof s2.image !== "object") s2.image = {};
            s2.image.url = v;
            $("#uie-img-url").val(v);
            $("#uie-img-url-adv").val(v);
            saveSettings();
        });

    $(document)
        .off("input.uieImgNegative", "#uie-img-negative")
        .on("input.uieImgNegative", "#uie-img-negative", function () {
            const v = String($(this).val() || "").trim().slice(0, 500);
            const s2 = getSettings();
            if (!s2.image || typeof s2.image !== "object") s2.image = {};
            s2.image.negativePrompt = v;
            saveSettings();
        });

    $(document)
        .off("change.uieImgComfyQuality", "#uie-img-comfy-quality")
        .on("change.uieImgComfyQuality", "#uie-img-comfy-quality", function () {
            const v = String($(this).val() || "balanced");
            const s2 = getSettings();
            if (!s2.image || typeof s2.image !== "object") s2.image = {};
            if (!s2.image.comfy || typeof s2.image.comfy !== "object") s2.image.comfy = {};
            s2.image.comfy.quality = v;
            saveSettings();
        });

    $(document)
        .off("input.uieImgComfyEasy", "#uie-img-comfy-steps, #uie-img-comfy-cfg, #uie-img-comfy-width, #uie-img-comfy-height, #uie-img-comfy-denoise, #uie-img-comfy-seed, #uie-img-comfy-common, #uie-img-comfy-common-neg")
        .on("input.uieImgComfyEasy", "#uie-img-comfy-steps, #uie-img-comfy-cfg, #uie-img-comfy-width, #uie-img-comfy-height, #uie-img-comfy-denoise, #uie-img-comfy-seed, #uie-img-comfy-common, #uie-img-comfy-common-neg", function () {
            const s2 = getSettings();
            if (!s2.image || typeof s2.image !== "object") s2.image = {};
            if (!s2.image.comfy || typeof s2.image.comfy !== "object") s2.image.comfy = {};
            if (!s2.image.comfy.easy || typeof s2.image.comfy.easy !== "object") s2.image.comfy.easy = {};
            const ez = s2.image.comfy.easy;
            ez.steps = Math.max(1, Math.round(Number($("#uie-img-comfy-steps").val() || ez.steps || 24)));
            ez.cfg = Math.max(0, Number($("#uie-img-comfy-cfg").val() || ez.cfg || 7));
            ez.width = Math.max(64, Math.round(Number($("#uie-img-comfy-width").val() || ez.width || 768)));
            ez.height = Math.max(64, Math.round(Number($("#uie-img-comfy-height").val() || ez.height || 768)));
            ez.denoise = Math.max(0, Math.min(1, Number($("#uie-img-comfy-denoise").val() || ez.denoise || 1)));
            ez.seed = Math.round(Number($("#uie-img-comfy-seed").val() ?? ez.seed ?? -1));
            ez.common = String($("#uie-img-comfy-common").val() || ez.common || "");
            ez.commonNeg = String($("#uie-img-comfy-common-neg").val() || ez.commonNeg || "");
            saveSettings();
        });
    $(document)
        .off("change.uieImgComfyEasySel", "#uie-img-comfy-sampler, #uie-img-comfy-scheduler")
        .on("change.uieImgComfyEasySel", "#uie-img-comfy-sampler, #uie-img-comfy-scheduler", function () {
            const s2 = getSettings();
            if (!s2.image || typeof s2.image !== "object") s2.image = {};
            if (!s2.image.comfy || typeof s2.image.comfy !== "object") s2.image.comfy = {};
            if (!s2.image.comfy.easy || typeof s2.image.comfy.easy !== "object") s2.image.comfy.easy = {};
            const ez = s2.image.comfy.easy;
            ez.sampler = String($("#uie-img-comfy-sampler").val() || ez.sampler || "euler_ancestral").trim();
            ez.scheduler = String($("#uie-img-comfy-scheduler").val() || ez.scheduler || "normal").trim();
            saveSettings();
        });

    $(document)
        .off("change.uieImgComfyCkpt", "#uie-img-comfy-ckpt")
        .on("change.uieImgComfyCkpt", "#uie-img-comfy-ckpt", function () {
            const v = String($(this).val() || "").trim();
            const s2 = getSettings();
            if (!s2.image || typeof s2.image !== "object") s2.image = {};
            if (!s2.image.comfy || typeof s2.image.comfy !== "object") s2.image.comfy = {};
            s2.image.comfy.checkpoint = v;
            saveSettings();
        });

    $(document)
        .off("click.uieImgComfyCkptRefresh", "#uie-img-comfy-ckpt-refresh")
        .on("click.uieImgComfyCkptRefresh", "#uie-img-comfy-ckpt-refresh", async function (e) {
            e.preventDefault();
            e.stopPropagation();
            const btn = $(this);
            btn.prop("disabled", true);
            try {
                const s2 = getSettings();
                const base = String($("#uie-img-comfy-base").val() || s2?.image?.url || "http://127.0.0.1:8188").trim().replace(/\/prompt\s*$/i, "").replace(/\/+$/g, "");
                const url = `${base}/object_info`;
                const r = await fetch(url, { method: "GET" });
                if (!r.ok) throw new Error(`HTTP ${r.status}`);
                const j = await r.json().catch(() => null);
                const renderSelectList = (id, list, current) => {
                    try {
                        const sel = document.getElementById(id);
                        if (!sel) return;
                        const cur = String(current || sel.value || "");
                        const next = Array.from(new Set((Array.isArray(list) ? list : []).map(x => String(x || "").trim()).filter(Boolean)));
                        if (!next.length) return;
                        sel.innerHTML = "";
                        for (const v of next.slice(0, 300)) {
                            const o = document.createElement("option");
                            o.value = v;
                            o.textContent = v;
                            sel.appendChild(o);
                        }
                        const has = next.includes(cur);
                        sel.value = has ? cur : next[0];
                    } catch (_) {}
                };
                const list = (() => {
                    const norm = (x) => {
                        if (!x) return "";
                        if (typeof x === "string") return x.trim();
                        const name = x?.name || x?.title || x?.label || x?.id || x?.ckpt_name || x?.checkpoint || "";
                        return String(name || "").trim();
                    };
                    const tryPick = (obj) => {
                        const node = obj?.CheckpointLoaderSimple || obj?.checkpointloadersimple || null;
                        const req = node?.input?.required || node?.input?.Required || null;
                        const ck = req?.ckpt_name || req?.checkpoint || null;
                        const arr = Array.isArray(ck) ? ck : (Array.isArray(ck?.[0]) ? ck[0] : (Array.isArray(ck?.values) ? ck.values : null));
                        if (Array.isArray(arr)) return arr.map(norm).filter(Boolean);
                        return null;
                    };
                    const a = tryPick(j);
                    if (a && a.length) return a;
                    if (j && typeof j === "object") {
                        for (const v of Object.values(j)) {
                            const a2 = tryPick({ CheckpointLoaderSimple: v });
                            if (a2 && a2.length) return a2;
                        }
                    }
                    return [];
                })();

                const ks = (() => {
                    const norm = (x) => (typeof x === "string" ? x.trim() : String(x?.name || x?.label || x || "").trim());
                    const pick = (node) => {
                        const req = node?.input?.required || node?.input?.Required || null;
                        const sampler = req?.sampler_name || null;
                        const scheduler = req?.scheduler || null;
                        const toList = (v) => {
                            const arr = Array.isArray(v) ? v : (Array.isArray(v?.[0]) ? v[0] : (Array.isArray(v?.values) ? v.values : null));
                            if (!Array.isArray(arr)) return [];
                            return arr.map(norm).filter(Boolean);
                        };
                        return { samplers: toList(sampler), schedulers: toList(scheduler) };
                    };
                    const n = j?.KSampler || j?.ksampler || null;
                    if (n) return pick(n);
                    if (j && typeof j === "object") {
                        for (const v of Object.values(j)) {
                            const cls = String(v?.name || v?.class_type || "").toLowerCase();
                            if (cls.includes("ksampler") || cls === "ksampler") return pick(v);
                        }
                    }
                    return { samplers: [], schedulers: [] };
                })();

                window.UIE_COMFY_CKPTS = Array.from(new Set(list)).sort((a, b) => String(a).localeCompare(String(b)));
                const cur = String(getSettings()?.image?.comfy?.checkpoint || "");
                renderComfyCkpts(window.UIE_COMFY_CKPTS, cur);
                try {
                    const s3 = getSettings();
                    const ez = s3?.image?.comfy?.easy || {};
                    if (ks.samplers.length) renderSelectList("uie-img-comfy-sampler", ks.samplers, ez.sampler);
                    if (ks.schedulers.length) renderSelectList("uie-img-comfy-scheduler", ks.schedulers, ez.scheduler);
                } catch (_) {}
                try { notify("success", `Detected ${window.UIE_COMFY_CKPTS.length} checkpoints.`, "UIE", "api"); } catch (_) {}
            } catch (err) {
                try { notify("error", `ComfyUI detect failed: ${String(err?.message || err || "Error")}`, "UIE", "api"); } catch (_) {}
            } finally {
                btn.prop("disabled", false);
            }
        });

    $(document)
        .off("click.uieImgComfyApply", "#uie-img-comfy-apply")
        .on("click.uieImgComfyApply", "#uie-img-comfy-apply", function (e) {
            e.preventDefault();
            e.stopPropagation();
            const s2 = getSettings();
            if (!s2.image || typeof s2.image !== "object") s2.image = {};
            if (!s2.image.comfy || typeof s2.image.comfy !== "object") s2.image.comfy = {};
            const base = String($("#uie-img-comfy-base").val() || "http://127.0.0.1:8188").trim().replace(/\/prompt\s*$/i, "").replace(/\/+$/g, "");
            const ckpt = String($("#uie-img-comfy-ckpt").val() || s2.image.comfy.checkpoint || "").trim();
            if (!ckpt) {
                try { notify("error", "Pick a checkpoint (refresh first).", "UIE", "api"); } catch (_) {}
                return;
            }
            const q = String($("#uie-img-comfy-quality").val() || "balanced");
            if (!s2.image.comfy.easy || typeof s2.image.comfy.easy !== "object") s2.image.comfy.easy = {};
            const ez = s2.image.comfy.easy;
            const sizes = q === "fast" ? { w: 512, h: 512, steps: 16 } : q === "hq" ? { w: 1024, h: 1024, steps: 32 } : { w: 768, h: 768, steps: 24 };
            const w = Number($("#uie-img-comfy-width").val() || ez.width || sizes.w);
            const h = Number($("#uie-img-comfy-height").val() || ez.height || sizes.h);
            const steps = Number($("#uie-img-comfy-steps").val() || ez.steps || sizes.steps);
            const cfg = Number($("#uie-img-comfy-cfg").val() || ez.cfg || 7);
            const sampler = String($("#uie-img-comfy-sampler").val() || ez.sampler || "euler").trim() || "euler";
            const scheduler = String($("#uie-img-comfy-scheduler").val() || ez.scheduler || "normal").trim() || "normal";
            const denoise = Number($("#uie-img-comfy-denoise").val() || ez.denoise || 1);
            const seed = Number($("#uie-img-comfy-seed").val() ?? ez.seed ?? -1);
            const wf = {
                "3": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "{{checkpoint}}" } },
                "4": { class_type: "CLIPTextEncode", inputs: { text: "{{prompt}}", clip: ["3", 1] } },
                "5": { class_type: "CLIPTextEncode", inputs: { text: "{{negative_prompt}}", clip: ["3", 1] } },
                "6": { class_type: "EmptyLatentImage", inputs: { width: Math.max(64, Math.round(w)), height: Math.max(64, Math.round(h)), batch_size: 1 } },
                "7": { class_type: "KSampler", inputs: { seed: Number.isFinite(seed) ? Math.round(seed) : -1, steps: Math.max(1, Math.round(steps)), cfg: Math.max(0, Number(cfg) || 7), sampler_name: sampler, scheduler: scheduler, denoise: Math.max(0, Math.min(1, Number(denoise) || 1)), model: ["3", 0], positive: ["4", 0], negative: ["5", 0], latent_image: ["6", 0] } },
                "8": { class_type: "VAEDecode", inputs: { samples: ["7", 0], vae: ["3", 2] } },
                "9": { class_type: "SaveImage", inputs: { filename_prefix: "uie", images: ["8", 0] } }
            };
            s2.image.url = base;
            s2.image.comfy.checkpoint = ckpt;
            s2.image.comfy.quality = q;
            s2.image.comfy.workflow = JSON.stringify(wf);
            s2.image.comfy.positiveNodeId = "";
            s2.image.comfy.negativeNodeId = "";
            s2.image.comfy.outputNodeId = "9";
            saveSettings();
            $("#uie-img-url").val(base);
            $("#uie-img-url-adv").val(base);
            $("#uie-img-comfy-workflow").val(s2.image.comfy.workflow);
            $("#uie-img-comfy-posnode").val("");
            $("#uie-img-comfy-negnode").val("");
            $("#uie-img-comfy-outnode").val("9");
            try { window.toastr?.success?.("ComfyUI Easy Setup applied."); } catch (_) {}
        });

    $(document)
        .off("click.uieImgTest", "#uie-img-test")
        .on("click.uieImgTest", "#uie-img-test", async function (e) {
            e.preventDefault();
            e.stopPropagation();
            const btn = $(this);
            const prev = String(btn.text() || "");
            btn.text("Testing...");
            btn.prop("disabled", true);
            try {
                const mod = await import("./imageGen.js");
                const img = await mod.generateImageAPI("[UIE_LOCKED] A clear photo of a red apple on a wooden table.");
                if (img) {
                    const li = window.UIE_lastImage || {};
                    const extra = li?.endpoint ? ` (${String(li.mode || "api")} ${Number(li.ms || 0)}ms)` : "";
                    try { window.toastr?.success?.(`Image OK${extra}`); } catch (_) {}
                } else {
                    const li = window.UIE_lastImage || {};
                    const extra = li?.endpoint ? ` | ${String(li.mode || "api")} | ${String(li.endpoint).slice(0, 120)} | ${String(li.status || 0)} | ${String(li.error || "").slice(0, 160)}` : "";
                    try { window.toastr?.error?.(`Image FAIL (check settings)${extra}`); } catch (_) {}
                }
            } catch (err) {
                try { window.toastr?.error?.(`Image FAIL: ${String(err?.message || err || "Error")}`); } catch (_) {}
            } finally {
                btn.text(prev || "Test Image");
                btn.prop("disabled", false);
            }
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
            negativePrompt: String(s2.image.negativePrompt || ""),
            comfy: s2.image.comfy && typeof s2.image.comfy === "object" ? {
                workflow: String(s2.image.comfy.workflow || ""),
                checkpoint: String(s2.image.comfy.checkpoint || ""),
                quality: String(s2.image.comfy.quality || "balanced"),
            } : null,
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
            const refreshAll = () => {
                try { refreshSettingsDrawer(); } catch (_) {}
                try { refreshProfileSelect(document.getElementById("uie-settings-window"), getSettings()); } catch (_) {}
                try { refreshProfileSelect(document.getElementById("uie-settings-block"), getSettings()); } catch (_) {}
            };

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
                    refreshAll();
                    try { window.toastr?.success?.("SillyTavern profile settings imported to Turbo."); } catch (_) {}
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
                    s2.image.negativePrompt = String(p.image.negativePrompt || "");
                    if (p.image.comfy && typeof p.image.comfy === "object") {
                        if (!s2.image.comfy || typeof s2.image.comfy !== "object") s2.image.comfy = {};
                        s2.image.comfy.workflow = String(p.image.comfy.workflow || "");
                        s2.image.comfy.checkpoint = String(p.image.comfy.checkpoint || "");
                        s2.image.comfy.quality = String(p.image.comfy.quality || "balanced");
                    }
                }
                s2.connections.activeProfileId = sel;
                saveSettings();
                refreshAll();
                try { window.toastr?.success?.("Profile applied."); } catch (_) {}
                return;
            }

            if (this.id === "uie-profile-delete") {
                if (!sel) return;
                if (sel.startsWith("st:")) {
                    if (s2.connections.activeProfileId === sel) s2.connections.activeProfileId = "";
                    saveSettings();
                    refreshSettingsDrawer();
                    try { refreshProfileSelect(document.getElementById("uie-settings-window"), s2); } catch (_) {}
                    try { window.toastr?.info?.("SillyTavern profiles can’t be deleted here."); } catch (_) {}
                    return;
                }
                s2.connections.profiles = profs.filter(p => String(p?.id || "") !== sel);
                if (s2.connections.activeProfileId === sel) s2.connections.activeProfileId = "";
                saveSettings();
                refreshAll();
                try { window.toastr?.info?.("Profile deleted."); } catch (_) {}
                return;
            }

            if (this.id === "uie-profile-save") {
                const cur = sel.startsWith("st:") ? null : find(sel);
                const autoName = (() => {
                    try {
                        const url = String(s2?.turbo?.url || "").trim();
                        const model = String(s2?.turbo?.model || "").trim();
                        const host = url ? (new URL(url).hostname || "").replace(/^www\./, "") : "";
                        const h = host ? host : "profile";
                        const m = model ? ` ${model}` : "";
                        return `${h}${m}`.slice(0, 60);
                    } catch (_) {
                        return `profile_${new Date().toLocaleString()}`.slice(0, 60);
                    }
                })();
                const wantName = prompt("Profile name:", cur ? String(cur.name || "") : autoName);
                const nm = String((wantName === null ? autoName : wantName) || "").trim();
                if (!nm) {
                    try { window.toastr?.info?.("Profile name was empty; using an auto name."); } catch (_) {}
                }
                const finalName = (nm || autoName).trim().slice(0, 60);
                const id = (!sel || sel.startsWith("st:")) ? `p_${Date.now().toString(16)}_${Math.floor(Math.random() * 1e9).toString(16)}` : sel;
                const packed = packProfile(s2, id, finalName);
                const next = profs.filter(p => String(p?.id || "") !== id);
                next.unshift(packed);
                s2.connections.profiles = next.slice(0, 40);
                s2.connections.activeProfileId = id;
                saveSettings();
                refreshAll();
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

    $(document)
        .off("change.uieScanOnlyButtons", "#uie-gen-scan-only-buttons")
        .on("change.uieScanOnlyButtons", "#uie-gen-scan-only-buttons", function () {
            const s2 = getSettings();
            if (!s2.generation) s2.generation = {};
            s2.generation.scanOnlyOnGenerateButtons = $(this).is(":checked");
            saveSettings();
        });

    $(document)
        .off("change.uieSysCheckMin", "#uie-gen-syscheck-min")
        .on("change.uieSysCheckMin", "#uie-gen-syscheck-min", function () {
            const sec = Math.max(0, Number($(this).val() || 0));
            const s2 = getSettings();
            if (!s2.generation) s2.generation = {};
            s2.generation.systemCheckMinIntervalMs = Math.round(sec * 1000);
            saveSettings();
        });

    $(document)
        .off("change.uieAutoScanMin", "#uie-gen-autoscan-min")
        .on("change.uieAutoScanMin", "#uie-gen-autoscan-min", function () {
            const sec = Math.max(0, Number($(this).val() || 0));
            const s2 = getSettings();
            if (!s2.generation) s2.generation = {};
            s2.generation.autoScanMinIntervalMs = Math.round(sec * 1000);
            saveSettings();
        });

    const ensureKitchenCanvasTestOverlay = () => {
        if (document.getElementById("uie-kitchen-canvas-test-overlay")) return;
        $("body").append(`
            <div id="uie-kitchen-canvas-test-overlay" style="display:none; position:fixed; inset:0; z-index:2147483647; background:rgba(0,0,0,0.94); isolation:isolate; pointer-events:auto; flex-direction:column;">
                <div style="height:52px; flex:0 0 auto; display:flex; align-items:center; gap:10px; padding:10px 12px; border-bottom:1px solid rgba(255,255,255,0.10); background:rgba(0,0,0,0.65);">
                    <button id="uie-kitchen-canvas-test-exit" style="height:34px; padding:0 12px; border-radius:12px; border:1px solid rgba(255,255,255,0.14); background:rgba(0,0,0,0.25); color:#fff; font-weight:900; cursor:pointer;">Exit</button>
                    <div style="font-weight:900; color:#cba35c; letter-spacing:0.6px;">KITCHEN (CANVAS TEST)</div>
                </div>
                <div id="uie-kitchen-canvas-test-body" style="flex:1 1 auto; min-height:0; overflow:hidden; position:relative;"></div>
            </div>
        `);
    };

    const closeKitchenCanvasTestOverlay = async () => {
        try {
            const mod = await import("./features/kitchen_canvas/kitchen.js");
            if (mod?.close) mod.close();
        } catch (_) {}
        $("#uie-kitchen-canvas-test-overlay").hide();
        $("#uie-kitchen-canvas-test-body").empty();
    };

    $(document)
        .off("click.uieKitchenCanvasTestExit", "#uie-kitchen-canvas-test-exit")
        .on("click.uieKitchenCanvasTestExit", "#uie-kitchen-canvas-test-exit", function (e) {
            e.preventDefault(); e.stopPropagation();
            closeKitchenCanvasTestOverlay();
        });

    $(document)
        .off("click.uieOpenKitchenCanvas", "#uie-open-kitchen-canvas")
        .on("click.uieOpenKitchenCanvas", "#uie-open-kitchen-canvas", async function (e) {
            e.preventDefault(); e.stopPropagation();
            ensureKitchenCanvasTestOverlay();
            $("#uie-kitchen-canvas-test-overlay").css("display", "flex");
            const $host = $("#uie-kitchen-canvas-test-body");
            $host.css({ overflow: "hidden", background: "transparent", height: "100%", minHeight: 0 }).html(`<div style="padding:16px;color:rgba(255,255,255,.7);font-weight:900;">Loading...</div>`);
            try {
                const templateCandidates = [
                    "/uie/kitchen_canvas/kitchen_canvas.html",
                    "/scripts/extensions/uie/kitchen_canvas/kitchen_canvas.html",
                    "/scripts/extensions/UIE/uie/kitchen_canvas/kitchen_canvas.html"
                ];
                let html = "";
                for (const u of templateCandidates) {
                    try {
                        const res = await fetch(u, { cache: "no-cache", credentials: "same-origin" });
                        if (!res.ok) continue;
                        const t = await res.text();
                        if (String(t || "").trim()) { html = t; break; }
                    } catch (_) {}
                }
                if (!html) throw new Error("Kitchen canvas template not found.");
                $host.html(html);

                const moduleCandidates = [
                    "/uie/kitchen_canvas/kitchen.js",
                    "/scripts/extensions/uie/kitchen_canvas/kitchen.js",
                    "/scripts/extensions/UIE/uie/kitchen_canvas/kitchen.js"
                ];
                let mod = null;
                let lastErr = null;
                for (const u of moduleCandidates) {
                    try { mod = await import(u); if (mod) break; } catch (err) { lastErr = err; }
                }
                if (!mod) throw lastErr || new Error("Kitchen canvas module not found.");
                if (mod?.init) mod.init();
                if (mod?.open) mod.open({ mode: "inline", hostEl: $host.get(0), zIndex: 2147483647, onExit: closeKitchenCanvasTestOverlay });
            } catch (err) {
                try { console.error("[UIE] Kitchen canvas test open failed:", err); } catch (_) {}
                $host.html(`<div style="padding:16px;color:#f38ba8;font-weight:900;">Error loading Kitchen Canvas Test.</div>`);
            }
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
        try { ensureChatStateLoaded(); } catch (_) {}
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

    const ensureLauncherOptionsShell = async () => {
        if ($("#uie-launcher-options-window").length) return true;
        let root = "";
        try { root = String(window.UIE_BASEPATH || "scripts/extensions/third-party/universal-immersion-engine"); } catch (_) { root = "scripts/extensions/third-party/universal-immersion-engine"; }
        root = root.replace(/^\/+|\/+$/g, "");
        const urls = [
            `${baseUrl}src/templates/launcher_options.html`,
            `/${root}/src/templates/launcher_options.html`,
            `/scripts/extensions/third-party/universal-immersion-engine/src/templates/launcher_options.html`
        ];
        let html = "";
        for (const url of urls) {
            try { html = await fetchTemplateHtml(url); if (html) break; } catch (_) {}
        }
        if (!html) return false;
        $("body").append(html);
        return true;
    };

    const openLauncherOptions = async () => {
        const ok = await ensureLauncherOptionsShell();
        if (!ok) return;
        const s = getSettings();
        ensureLauncherStore(s);
        $("#uie-launcher-opt-hide").prop("checked", s.launcher?.hidden === true);
        $("#uie-launcher-opt-name").val(String(s.launcher?.name || ""));
        const curSrc = String(s.launcher?.src || s.launcherIcon || "");
        $("#uie-launcher-opt-icon").val(curSrc || "custom");
        if ($("#uie-launcher-opt-icon").val() !== (curSrc || "custom") && curSrc) {
            $("#uie-launcher-opt-icon").append(`<option value="${curSrc}">${curSrc.split("/").pop()}</option>`).val(curSrc);
        }
        if (curSrc && curSrc.startsWith("data:")) $("#uie-launcher-opt-preview").css("backgroundImage", `url("${curSrc}")`).show();
        else $("#uie-launcher-opt-preview").hide();
        openWindow("#uie-launcher-options-window");
        try {
            requestAnimationFrame(() => {
                const launcher = document.getElementById("uie-launcher");
                const win = document.getElementById("uie-launcher-options-window");
                const rect = launcher ? launcher.getBoundingClientRect() : null;
                if (!rect || !win) return;
                const vw = window.innerWidth;
                const vh = window.innerHeight;
                const w = win.getBoundingClientRect().width || 420;
                const h = win.getBoundingClientRect().height || 360;
                let left = rect.right + 10;
                let top = rect.top;
                if (left + w > vw - 6) left = Math.max(6, rect.left - w - 10);
                if (top + h > vh - 6) top = Math.max(6, vh - h - 6);
                $("#uie-launcher-options-window").css({ left, top, transform: "none" });
            });
        } catch (_) {}
    };

    $(document)
        .off("contextmenu.uieLauncherOptions", "#uie-launcher")
        .on("contextmenu.uieLauncherOptions", "#uie-launcher", async function (e) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            await openLauncherOptions();
        });

    $(document)
        .off("pointerup.uieLauncherOptions", "#uie-launcher-opt-close")
        .on("pointerup.uieLauncherOptions", "#uie-launcher-opt-close", function (e) {
            e.preventDefault(); e.stopPropagation();
            $("#uie-launcher-options-window").hide();
        })
        .off("change.uieLauncherOptHide", "#uie-launcher-opt-hide")
        .on("change.uieLauncherOptHide", "#uie-launcher-opt-hide", function () {
            const s2 = getSettings();
            ensureLauncherStore(s2);
            s2.launcher.hidden = $(this).is(":checked");
            saveSettings();
            updateLayout();
        })
        .off("input.uieLauncherOptName", "#uie-launcher-opt-name")
        .on("input.uieLauncherOptName", "#uie-launcher-opt-name", function () {
            const s2 = getSettings();
            ensureLauncherStore(s2);
            s2.launcher.name = String($(this).val() || "").slice(0, 60);
            saveSettings();
            updateLayout();
        })
        .off("change.uieLauncherOptIcon", "#uie-launcher-opt-icon")
        .on("change.uieLauncherOptIcon", "#uie-launcher-opt-icon", function () {
            const v = String($(this).val() || "");
            if (v === "custom") {
                $("#uie-launcher-opt-file").trigger("click");
                return;
            }
            const s2 = getSettings();
            ensureLauncherStore(s2);
            s2.launcher.src = v;
            saveSettings();
            updateLayout();
            $("#uie-launcher-opt-preview").hide();
        })
        .off("change.uieLauncherOptFile", "#uie-launcher-opt-file")
        .on("change.uieLauncherOptFile", "#uie-launcher-opt-file", function (e) {
            const f = e.target && e.target.files ? e.target.files[0] : null;
            if (!f) return;
            const r = new FileReader();
            r.onload = () => {
                const dataUrl = String(r.result || "");
                if (!dataUrl.startsWith("data:")) return;
                const s2 = getSettings();
                ensureLauncherStore(s2);
                s2.launcher.src = dataUrl;
                s2.launcher.lastUploadName = String(f.name || "").slice(0, 80);
                saveSettings();
                updateLayout();
                $("#uie-launcher-opt-preview").css("backgroundImage", `url("${dataUrl}")`).show();
            };
            r.readAsDataURL(f);
        })
        .off("pointerup.uieLauncherOptSave", "#uie-launcher-opt-save")
        .on("pointerup.uieLauncherOptSave", "#uie-launcher-opt-save", function (e) {
            e.preventDefault(); e.stopPropagation();
            const s2 = getSettings();
            ensureLauncherStore(s2);
            const src = String(s2.launcher?.src || "");
            if (!src.startsWith("data:")) return;
            const name = String(s2.launcher.lastUploadName || `Icon ${new Date().toLocaleString()}`).slice(0, 60);
            const id = `ico_${Date.now().toString(16)}_${Math.floor(Math.random() * 1e9).toString(16)}`;
            const next = [{ id, name, dataUrl: src }, ...s2.launcher.savedIcons.filter(x => x && x.dataUrl !== src)].slice(0, 40);
            s2.launcher.savedIcons = next;
            saveSettings();
        })
        .off("pointerup.uieLauncherOptDelete", "#uie-launcher-opt-delete")
        .on("pointerup.uieLauncherOptDelete", "#uie-launcher-opt-delete", function (e) {
            e.preventDefault(); e.stopPropagation();
            const s2 = getSettings();
            ensureLauncherStore(s2);
            const src = String(s2.launcher?.src || "");
            if (!src.startsWith("data:")) return;
            s2.launcher.savedIcons = (s2.launcher.savedIcons || []).filter(x => String(x?.dataUrl || "") !== src);
            saveSettings();
        })
        .off("pointerup.uieLauncherOptResetPos", "#uie-launcher-opt-resetpos")
        .on("pointerup.uieLauncherOptResetPos", "#uie-launcher-opt-resetpos", function (e) {
            e.preventDefault(); e.stopPropagation();
            const s2 = getSettings();
            s2.launcherX = 20;
            s2.launcherY = 120;
            saveSettings();
            updateLayout();
        })
        .off("pointerup.uieLauncherOptOpenSettings", "#uie-launcher-opt-open-settings")
        .on("pointerup.uieLauncherOptOpenSettings", "#uie-launcher-opt-open-settings", function (e) {
            e.preventDefault(); e.stopPropagation();
            $("#uie-launcher-options-window").hide();
            $("#uie-btn-open-settings").trigger("click");
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
    $(document).on("click.uie", "#uie-btn-battle", (e) => { e.stopPropagation(); openWindow("#uie-battle-window", "./battle.js", "initBattle"); });
    $(document).on("click.uie", "#uie-btn-open-phone", (e) => { e.stopPropagation(); openWindow("#uie-phone-window", "./phone.js", "initPhone"); });
    $(document).on("click.uie", "#uie-btn-open-calendar", async (e) => {
        e.stopPropagation();
        if ($("#uie-calendar-window").length === 0) {
            let root = "";
            try { root = String(window.UIE_BASEPATH || "scripts/extensions/third-party/universal-immersion-engine"); } catch (_) { root = "scripts/extensions/third-party/universal-immersion-engine"; }
            root = root.replace(/^\/+|\/+$/g, "");
            const urls = [
                `${baseUrl}src/templates/calendar.html`,
                `/${root}/src/templates/calendar.html`,
                `/scripts/extensions/third-party/universal-immersion-engine/src/templates/calendar.html`
            ];
            let html = "";
            for (const url of urls) {
                try {
                    html = await fetchTemplateHtml(url);
                    if (html) break;
                } catch (_) {}
            }
            if (!html) {
                notify("error", "Calendar UI failed to load.", "UIE", "api");
                return;
            }
            $("body").append(html);
        }
        openWindow("#uie-calendar-window", "./calendar.js", "openCalendar");
    });
    $(document).on("click.uie", "#uie-btn-open-map", (e) => { e.stopPropagation(); openWindow("#uie-map-window", "./map.js", "initMap"); });
    $(document).on("click.uie", "#uie-btn-open-world", async (e) => {
        e.stopPropagation();
        if ($("#uie-world-window").length === 0) {
            let root = "";
            try { root = String(window.UIE_BASEPATH || "scripts/extensions/third-party/universal-immersion-engine"); } catch (_) { root = "scripts/extensions/third-party/universal-immersion-engine"; }
            root = root.replace(/^\/+|\/+$/g, "");
            const urls = [
                `${baseUrl}src/templates/world.html`,
                `/${root}/src/templates/world.html`,
                `/scripts/extensions/third-party/universal-immersion-engine/src/templates/world.html`
            ];
            let html = "";
            for (const url of urls) {
                try {
                    html = await fetchTemplateHtml(url);
                    if (html) break;
                } catch (_) {}
            }
            if (!html) {
                notify("error", "Reality UI failed to load. Check UIE_BASEURL / install.", "UIE", "api");
                try { console.error("[UIE] Failed to load world template", { baseUrl, urls }); } catch (_) {}
                return;
            }
            $("body").append(html);
        }
        openWindow("#uie-world-window", "./world.js", "initWorld");
    });

    $(document).on("click.uie", "#uie-btn-chatbox", async (e) => {
        e.stopPropagation();
        if ($("#uie-chatbox-window").length === 0) {
            let root = "";
            try { root = String(window.UIE_BASEPATH || "scripts/extensions/third-party/universal-immersion-engine"); } catch (_) { root = "scripts/extensions/third-party/universal-immersion-engine"; }
            root = root.replace(/^\/+|\/+$/g, "");
            const urls = [
                `${baseUrl}src/templates/chatbox.html`,
                `/${root}/src/templates/chatbox.html`,
                `/scripts/extensions/third-party/universal-immersion-engine/src/templates/chatbox.html`
            ];
            let html = "";
            for (const url of urls) {
                try {
                    html = await fetchTemplateHtml(url);
                    if (html) break;
                } catch (_) {}
            }
            if (!html) {
                notify("error", "Chatbox UI failed to load. Check UIE_BASEURL / install.", "UIE", "api");
                return;
            }
            $("body").append(html);
        }
        openWindow("#uie-chatbox-window", "./chatbox.js", "openChatbox");
    });
    $(document).on("click.uie", "#uie-btn-databank", async (e) => {
        e.stopPropagation();
        if ($("#uie-databank-window").length === 0) {
            let root = "";
            try { root = String(window.UIE_BASEPATH || "scripts/extensions/third-party/universal-immersion-engine"); } catch (_) { root = "scripts/extensions/third-party/universal-immersion-engine"; }
            root = root.replace(/^\/+|\/+$/g, "");
            const urls = [
                `${baseUrl}src/templates/databank.html`,
                `/${root}/src/templates/databank.html`,
                `/scripts/extensions/third-party/universal-immersion-engine/src/templates/databank.html`
            ];
            let html = "";
            for (const url of urls) {
                try {
                    html = await fetchTemplateHtml(url);
                    if (html) break;
                } catch (_) {}
            }
            if (!html) {
                notify("error", "Databank UI failed to load.", "UIE", "api");
                return;
            }
            $("body").append(html);
        }
        openWindow("#uie-databank-window", "./databank.js", "initDatabank");
    });
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
        ensureLauncherStore(s);
        $("#uie-launcher-name").val(s.launcher.name || "");
        const $iconSel = $("#uie-launcher-icon");
        syncLauncherIconSelect(s);
        const curSrc = String(s.launcher.src || "");
        $iconSel.val(curSrc);
        if (!$iconSel.val() && curSrc) {
            if (curSrc.startsWith("data:")) {
                const label = String(s.launcher.lastUploadName || "Unsaved Upload").trim().slice(0, 60) || "Unsaved Upload";
                $iconSel.find("option[data-uie-temp='1']").remove();
                const opt = document.createElement("option");
                opt.value = curSrc;
                opt.textContent = label;
                opt.setAttribute("data-uie-temp", "1");
                const selEl = $iconSel.get(0);
                const customOpt = selEl ? selEl.querySelector("option[value='custom']") : null;
                if (selEl) selEl.insertBefore(opt, customOpt ? customOpt.nextSibling : selEl.firstChild);
                $iconSel.val(curSrc);
            } else {
                $iconSel.append(`<option value="${curSrc}">${curSrc.split("/").pop()}</option>`);
                $iconSel.val(curSrc);
            }
        }
        setLauncherPreview(curSrc);

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
        .off("click.uieImgPresetApply", "#uie-img-preset-apply")
        .on("click.uieImgPresetApply", "#uie-img-preset-apply", function (e) {
            e.preventDefault();
            e.stopPropagation();
            const s2 = getSettings();
            const preset = String($("#uie-img-preset").val() || "openai");
            if (!s2.image) s2.image = { enabled: false, url: "", key: "", model: "dall-e-3", negativePrompt: "", features: {}, comfy: {} };
            const setAll = (url, model, keyPlaceholder) => {
                s2.image.url = String(url || "");
                if (model) s2.image.model = String(model);
                saveSettings();
                $("#uie-img-url").val(s2.image.url);
                $("#uie-img-url-adv").val(s2.image.url);
                $("#uie-img-model").val(s2.image.model);
                $("#uie-img-model-adv").val(s2.image.model);
                const sel = document.getElementById("uie-img-model-select");
                if (sel) {
                    const has = Array.from(sel.options).some(o => String(o.value) === String(s2.image.model || ""));
                    sel.value = has ? String(s2.image.model || "") : "__custom__";
                }
                if (keyPlaceholder) {
                    $("#uie-img-key").attr("placeholder", keyPlaceholder);
                    $("#uie-img-key-adv").attr("placeholder", keyPlaceholder);
                }
            };
            if (preset === "nanogpt") {
                setAll("https://nano-gpt.com/v1/images/generations", "hidream", "ngpt_...");
                return;
            }
            if (preset === "nvidia_nim") {
                setAll("https://integrate.api.nvidia.com/v1/images/generations", "gpt-image-1", "nvapi-...");
                return;
            }
            if (preset === "openai") {
                setAll("https://api.openai.com/v1/images/generations", "gpt-image-1", "sk-...");
                return;
            }
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
    $(document).off("input.uieLauncherName").on("input.uieLauncherName", "#uie-launcher-name", function() {
        const s = getSettings();
        if (!s.launcher) s.launcher = {};
        s.launcher.name = $(this).val();
        saveSettings();
        updateLayout();
    });

    $(document).off("change.uieLauncherIcon").on("change.uieLauncherIcon", "#uie-launcher-icon", function() {
        const val = $(this).val();
        if (val === "custom") {
            $("#uie-launcher-file").trigger("click");
            return;
        }
        const s = getSettings();
        ensureLauncherStore(s);
        s.launcher.src = val;
        saveSettings();
        updateLayout();
        setLauncherPreview(val);
    });

    $(document).off("change.uieLauncherFile").on("change.uieLauncherFile", "#uie-launcher-file", function() {
        const file = this.files && this.files[0];
        if (!file) {
             $("#uie-launcher-icon").val(""); 
             return;
        }
        const reader = new FileReader();
        reader.onload = function(ev) {
            const s = getSettings();
            ensureLauncherStore(s);
            const dataUrl = String(ev?.target?.result || "");
            if (!dataUrl.startsWith("data:")) return;
            s.launcher.src = dataUrl;
            s.launcher.lastUploadName = String(file?.name || "Custom Icon").trim().slice(0, 80);
            saveSettings();
            updateLayout();
            syncLauncherIconSelect(s);
            const $sel = $("#uie-launcher-icon");
            $sel.find("option[data-uie-temp='1']").remove();
            const label = String(s.launcher.lastUploadName || "Unsaved Upload").replace(/\.[a-z0-9]+$/i, "").slice(0, 60) || "Unsaved Upload";
            const opt = document.createElement("option");
            opt.value = dataUrl;
            opt.textContent = label;
            opt.setAttribute("data-uie-temp", "1");
            const selEl = $sel.get(0);
            const customOpt = selEl ? selEl.querySelector("option[value='custom']") : null;
            if (selEl) selEl.insertBefore(opt, customOpt ? customOpt.nextSibling : selEl.firstChild);
            $sel.val(dataUrl);
            setLauncherPreview(dataUrl);
        };
        reader.readAsDataURL(file);
        $(this).val("");
    });

    $(document).off("click.uieLauncherSave").on("click.uieLauncherSave", "#uie-launcher-save", async function(e) {
        e.preventDefault();
        e.stopPropagation();
        const s = getSettings();
        ensureLauncherStore(s);
        const src = String(s.launcher?.src || "");
        if (!src.startsWith("data:")) {
            notify("info", "Upload/select a custom icon first.", "UIE");
            return;
        }
        const suggested = String(s.launcher.lastUploadName || "Custom Icon").replace(/\.[a-z0-9]+$/i, "").slice(0, 60) || "Custom Icon";
        const name = String(prompt("Save icon as:", suggested) || "").trim().slice(0, 60);
        if (!name) return;

        const list = Array.isArray(s.launcher.savedIcons) ? s.launcher.savedIcons : [];
        const hit = list.findIndex(x => String(x?.dataUrl || x?.data || "") === src);
        if (hit >= 0) list[hit] = { ...list[hit], name, dataUrl: src, ts: Date.now() };
        else list.push({ id: `lic_${Date.now()}_${Math.random().toString(16).slice(2)}`, name, dataUrl: src, ts: Date.now() });
        s.launcher.savedIcons = list.slice(0, 40);
        saveSettings();
        syncLauncherIconSelect(s);
        $("#uie-launcher-icon").val(src);
        setLauncherPreview(src);
        notify("success", "Saved launcher icon.", "UIE");
    });

    $(document).off("click.uieLauncherDelete").on("click.uieLauncherDelete", "#uie-launcher-delete", async function(e) {
        e.preventDefault();
        e.stopPropagation();
        const s = getSettings();
        ensureLauncherStore(s);
        const val = String($("#uie-launcher-icon").val() || "");
        if (!val.startsWith("data:")) {
            notify("info", "Select a saved custom icon to delete.", "UIE");
            return;
        }
        const list = Array.isArray(s.launcher.savedIcons) ? s.launcher.savedIcons : [];
        const idx = list.findIndex(x => String(x?.dataUrl || x?.data || "") === val);
        if (idx < 0) {
            notify("info", "That icon is not saved yet.", "UIE");
            return;
        }
        if (!confirm("Delete this saved launcher icon?")) return;
        list.splice(idx, 1);
        s.launcher.savedIcons = list.slice(0, 40);
        if (String(s.launcher.src || "") === val) s.launcher.src = "";
        saveSettings();
        syncLauncherIconSelect(s);
        $("#uie-launcher-icon").val(String(s.launcher.src || ""));
        setLauncherPreview(String(s.launcher.src || ""));
        updateLayout();
        notify("success", "Deleted saved launcher icon.", "UIE");
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

    // --- Internal State Management (No File Picker) ---
    $(document)
        .off("click.uieStateSave", ".uie-state-save-btn")
        .on("click.uieStateSave", ".uie-state-save-btn", function(e) {
            e.preventDefault(); e.stopPropagation();
            const nameInput = $(this).siblings(".uie-state-name");
            const name = nameInput.val().trim();
            if (!name) return notify("error", "Enter a save name!", "UIE");
            
            const s = getSettings();
            if (!s) return;
            if (!s.savedStates) s.savedStates = {};
            
            // Snapshot current settings, excluding the savedStates library itself
            const snapshot = JSON.parse(JSON.stringify(s));
            delete snapshot.savedStates;
            
            s.savedStates[name] = snapshot;
            saveSettings();
            updateStateLists(); // Refresh dropdowns
            notify("success", `State "${name}" saved!`, "UIE");
            nameInput.val("");
        });

    $(document)
        .off("click.uieStateLoad", ".uie-state-load-btn")
        .on("click.uieStateLoad", ".uie-state-load-btn", function(e) {
            e.preventDefault(); e.stopPropagation();
            const row = $(this).closest("div");
            const sel = row.find(".uie-state-select");
            const name = sel.val();
            if (!name) return notify("error", "Select a save to load!", "UIE");
            
            const s = getSettings();
            if (!s || !s.savedStates || !s.savedStates[name]) return notify("error", "Save not found!", "UIE");
            
            const loaded = s.savedStates[name];
            // Restore loaded state but keep the library
            const library = s.savedStates;
            Object.assign(s, loaded);
            s.savedStates = library;
            
            saveSettings();
            notify("success", "State loaded. Reloading...", "UIE");
            setTimeout(() => location.reload(), 1000);
        });

    $(document)
        .off("click.uieStateDel", ".uie-state-del-btn")
        .on("click.uieStateDel", ".uie-state-del-btn", function(e) {
            e.preventDefault(); e.stopPropagation();
            const row = $(this).closest("div");
            const sel = row.find(".uie-state-select");
            const name = sel.val();
            if (!name) return notify("error", "Select a save to delete!", "UIE");
            
            const s = getSettings();
            if (s.savedStates && s.savedStates[name]) {
                delete s.savedStates[name];
                saveSettings();
                updateStateLists();
                notify("success", `Deleted "${name}"`, "UIE");
            }
        });

    $(document)
        .off("change.uieRpg", "#uie-rpg-enable, #uie-rpg-xpbar, #uie-rpg-equipment, #uie-rpg-skills, #uie-rpg-party")
        .on("change.uieRpg", "#uie-rpg-enable, #uie-rpg-xpbar, #uie-rpg-equipment, #uie-rpg-skills, #uie-rpg-party", function() {
            const s = getSettings();
            if (!s.rpg) s.rpg = {};
            const id = this.id;
            const val = $(this).is(":checked");
            if (id === "uie-rpg-enable") s.rpg.enabled = val;
            if (id === "uie-rpg-xpbar") s.rpg.showXpBar = val;
            if (id === "uie-rpg-equipment") s.rpg.equipment = val;
            if (id === "uie-rpg-skills") s.rpg.skills = val;
            if (id === "uie-rpg-party") s.rpg.party = val;
            saveSettings();
            updateLayout(); // Might need to hide/show UI elements
        });

    $(document)
        .off("click.uieCustomCssApply", "#uie-custom-css-apply")
        .on("click.uieCustomCssApply", "#uie-custom-css-apply", function(e) {
            e.preventDefault(); e.stopPropagation();
            const s = getSettings();
            s.customCSS = String($("#uie-custom-css").val() || "");
            saveSettings();
            notify("success", "Custom CSS saved. Reload to fully apply.", "UIE");
            // Basic apply
            let el = document.getElementById("uie-global-custom-css");
            if (!el) { el = document.createElement("style"); el.id = "uie-global-custom-css"; document.head.appendChild(el); }
            el.textContent = s.customCSS;
        });
    
    $(document)
        .off("change.uieCodexAuto", "#uie-feature-codex-auto")
        .on("change.uieCodexAuto", "#uie-feature-codex-auto", function() {
             const s = getSettings();
             if (!s.features) s.features = {};
             s.features.codexAutoExtract = $(this).is(":checked");
             saveSettings();
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
