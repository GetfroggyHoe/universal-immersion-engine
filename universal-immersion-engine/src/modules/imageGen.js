import { getSettings } from "./core.js";
import { generateContent } from "./apiClient.js";

/**
 * Checks if an image should be generated based on context, then generates it.
 * @param {string} context - The text content (chat, item desc, etc.)
 * @param {string} feature - The feature key (map, doll, social, phoneBg, msg, party, items)
 * @returns {Promise<string|null>} - The image URL or null
 */
export async function checkAndGenerateImage(context, feature) {
    const s = getSettings();
    if (!s.image || !s.image.enabled) return null;
    if (s.image.features && s.image.features[feature] === false) return null;

    // 1. Ask AI if we need a photo
    // User requested: "short 0-10 token question. Need a photo? Yes or no."
    const checkPrompt = `
Context: ${context.slice(0, 1000)}
Question: Does this context explicitly describe a visual scene, item, or character that needs a photo?
Answer (Yes/No):`;

    // We use a low max_tokens to keep it fast/cheap as requested
    // But generateContent doesn't expose max_tokens directly in all versions, 
    // usually it relies on the backend default. 
    // We'll assume the prompt is strict enough.
    const checkRes = await generateContent(checkPrompt, "System Image Check");
    
    if (!checkRes) return null;
    const answer = String(checkRes).trim().toLowerCase();
    
    // Strict check for "yes"
    if (!answer.startsWith("yes")) return null;

    // 2. Generate the Image Prompt
    // User requested: "follows a strict prompt of context within it's parameters"
    const promptGenPrompt = `
Context: ${context.slice(0, 2000)}
Task: Create a highly detailed, strict image generation prompt for DALL-E 3 based on the context.
Include style details (fantasy, realistic, etc) appropriate for the setting.
Return ONLY the prompt text.`;

    const imagePrompt = await generateContent(promptGenPrompt, "System Image Prompt");
    if (!imagePrompt) return null;

    // 3. Call Image API
    return await generateImageAPI(imagePrompt);
}

/**
 * Direct call to Image API
 */
export async function generateImageAPI(prompt) {
    const s = getSettings();
    if (!s.image) return null;
    const rawPrompt = String(prompt || "");
    const lockedPrompt = /^\[UIE_LOCKED\]/i.test(rawPrompt.trim());
    let finalPrompt = rawPrompt.replace(/^\s*\[UIE_LOCKED\]\s*/i, "").trim();
    try {
        if (lockedPrompt) throw new Error("locked");
        const p = s?.generation?.promptPrefixes || {};
        const by = (p?.byType && typeof p.byType === "object") ? p.byType : {};
        const global = String(p?.global || "").trim();
        const def = String(by?.default || "").trim();
        const img = String(by?.["Image Gen"] || "").trim();
        const combined = [global, def, img].filter(Boolean).join("\n\n").trim();
        if (combined) finalPrompt = `${combined}\n\n${finalPrompt}`;
    } catch (_) {}
    const endpoint = String(s.image.url || "https://api.openai.com/v1/images/generations").trim();
    const model = String(s.image.model || "dall-e-3").trim();
    const apiKey = String(s.image.key || "").trim();
    const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?(\/|$)/i.test(endpoint);
    const isSdWebUi = /\/sdapi\/v1\/txt2img\s*$/i.test(endpoint);
    const isComfy = (() => {
        if (isSdWebUi) return false;
        if (/\/v1\/images\/generations\s*$/i.test(endpoint)) return false;
        if (/\/images\/generations\s*$/i.test(endpoint)) return false;
        if (/\/prompt\s*$/i.test(endpoint)) return true;
        if (/:(8188|8189)(\/|$)/i.test(endpoint)) return true;
        const wf = String(s.image?.comfy?.workflow || "").trim();
        return !!wf && isLocal;
    })();

    if (!apiKey && !isLocal && !isSdWebUi && !isComfy) {
        console.warn("Image Gen: No API Key");
        return null;
    }

    if (window.toastr) toastr.info("Generating Image...", "AI Fabricator");

    try {
        if (isComfy) {
            const wfRaw = String(s.image?.comfy?.workflow || "").trim();
            if (!wfRaw) {
                console.warn("Image Gen: ComfyUI workflow missing");
                if (window.toastr) toastr.error("ComfyUI workflow is missing (paste it in settings).");
                return null;
            }
            const posId = String(s.image?.comfy?.positiveNodeId || "").trim();
            const negId = String(s.image?.comfy?.negativeNodeId || "").trim();
            const outId = String(s.image?.comfy?.outputNodeId || "").trim();
            return await generateComfyUI({ endpoint, workflowRaw: wfRaw, promptText: finalPrompt, positiveNodeId: posId, negativeNodeId: negId, outputNodeId: outId });
        }

        if (isSdWebUi) {
            const res = await fetch(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    prompt: String(finalPrompt || "").slice(0, 4000),
                    steps: 24,
                    cfg_scale: 7,
                    width: 768,
                    height: 768,
                    sampler_name: "DPM++ 2M Karras"
                })
            });
            if (!res.ok) {
                const err = await res.text();
                console.error("Image Gen Error:", err);
                if (window.toastr) toastr.error("Image Generation Failed");
                return null;
            }
            const data = await res.json();
            const img = Array.isArray(data?.images) ? String(data.images[0] || "") : "";
            if (!img) return null;
            return img.startsWith("data:image") ? img : `data:image/png;base64,${img}`;
        }

        const headers = { "Content-Type": "application/json" };
        if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
        const res = await fetch(endpoint, {
            method: "POST",
            headers,
            body: JSON.stringify({
                model: model,
                prompt: finalPrompt,
                n: 1,
                size: "1024x1024",
                response_format: "url" // or b64_json
            })
        });

        if (!res.ok) {
            const err = await res.text();
            console.error("Image Gen Error:", err);
            if (window.toastr) toastr.error("Image Generation Failed");
            return null;
        }

        const data = await res.json();
        // OpenAI format: data: [{ url: "..." }]
        if (data.data && data.data.length > 0) {
            return data.data[0].url;
        }
        
        return null;

    } catch (e) {
        console.error("Image Gen Exception:", e);
        if (window.toastr) toastr.error("Image Gen Error: " + e.message);
        return null;
    }
}

async function generateComfyUI({ endpoint, workflowRaw, promptText, positiveNodeId, negativeNodeId, outputNodeId }) {
    const normalizeBase = (u) => String(u || "").trim().replace(/\/+$/g, "").replace(/\/prompt$/i, "");
    const base = normalizeBase(endpoint);
    const promptUrl = `${base}/prompt`;
    const viewUrl = `${base}/view`;
    const historyUrl = `${base}/history`;

    const parseWorkflow = () => {
        const obj = JSON.parse(String(workflowRaw || ""));
        if (obj && typeof obj === "object" && obj.prompt && typeof obj.prompt === "object") return obj.prompt;
        return obj;
    };

    const deepReplace = (v) => {
        if (typeof v === "string") {
            return v
                .replace(/\{\{\s*(prompt|positive_prompt|positive)\s*\}\}/gi, String(promptText || ""))
                .replace(/\{\{\s*(negative_prompt|negative)\s*\}\}/gi, "");
        }
        if (Array.isArray(v)) return v.map(deepReplace);
        if (v && typeof v === "object") {
            const out = {};
            for (const [k, val] of Object.entries(v)) out[k] = deepReplace(val);
            return out;
        }
        return v;
    };

    const injectTextNodes = (graph) => {
        if (!graph || typeof graph !== "object") return graph;
        const g = graph;
        const setText = (nodeId, text) => {
            const n = g?.[nodeId];
            if (!n || typeof n !== "object") return false;
            if (!n.inputs || typeof n.inputs !== "object") n.inputs = {};
            if ("text" in n.inputs || n.class_type?.toLowerCase?.().includes("cliptextencode")) {
                n.inputs.text = String(text || "");
                return true;
            }
            return false;
        };

        let did = false;
        if (positiveNodeId) did = setText(positiveNodeId, promptText) || did;
        if (negativeNodeId) did = setText(negativeNodeId, "") || did;
        if (did) return g;

        const clipNodes = Object.entries(g).filter(([_, n]) => {
            const ct = String(n?.class_type || "");
            return /CLIPTextEncode/i.test(ct);
        });
        if (clipNodes.length) {
            const [id1] = clipNodes[0];
            setText(id1, promptText);
            if (clipNodes.length > 1) {
                const [id2] = clipNodes[1];
                setText(id2, "");
            }
        }
        return g;
    };

    let graph = parseWorkflow();
    graph = deepReplace(graph);
    graph = injectTextNodes(graph);

    const client_id = `uie_${Date.now().toString(16)}_${Math.floor(Math.random() * 1e9).toString(16)}`;
    const res = await fetch(promptUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: graph, client_id })
    });
    if (!res.ok) {
        const err = await res.text();
        console.error("ComfyUI Error:", err);
        if (window.toastr) toastr.error("ComfyUI prompt failed");
        return null;
    }
    const data = await res.json();
    const prompt_id = String(data?.prompt_id || "");
    if (!prompt_id) return null;

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const deadline = Date.now() + 120_000;
    let imgRef = null;

    while (Date.now() < deadline) {
        await sleep(1000);
        let h;
        try {
            const hr = await fetch(`${historyUrl}/${encodeURIComponent(prompt_id)}`);
            if (!hr.ok) continue;
            h = await hr.json();
        } catch (_) {
            continue;
        }
        const job = h?.[prompt_id];
        const outputs = job?.outputs && typeof job.outputs === "object" ? job.outputs : null;
        if (!outputs) continue;

        const pickFromNode = (nodeId) => {
            const o = outputs?.[nodeId];
            const imgs = Array.isArray(o?.images) ? o.images : [];
            return imgs.length ? imgs[0] : null;
        };

        if (outputNodeId) {
            imgRef = pickFromNode(outputNodeId);
        }
        if (!imgRef) {
            for (const o of Object.values(outputs)) {
                const imgs = Array.isArray(o?.images) ? o.images : [];
                if (imgs.length) { imgRef = imgs[0]; break; }
            }
        }
        if (imgRef) break;
    }

    if (!imgRef) {
        if (window.toastr) toastr.error("ComfyUI timed out");
        return null;
    }

    const filename = encodeURIComponent(String(imgRef.filename || ""));
    const subfolder = encodeURIComponent(String(imgRef.subfolder || ""));
    const type = encodeURIComponent(String(imgRef.type || "output"));
    const imgRes = await fetch(`${viewUrl}?filename=${filename}&subfolder=${subfolder}&type=${type}`);
    if (!imgRes.ok) return null;
    const blob = await imgRes.blob();

    const dataUrl = await new Promise((resolve) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result || ""));
        r.onerror = () => resolve("");
        r.readAsDataURL(blob);
    });
    return dataUrl || null;
}
