
/**
 * Safely parses a JSON string, handling markdown code blocks.
 * @param {string} text 
 * @returns {any|null}
 */
function tryParseJson(text) {
    try {
        return JSON.parse(String(text || "").trim());
    } catch (_) {
        return null;
    }
}

function stripOuterCodeFence(text) {
    let str = String(text || "").trim();
    if (!str) return "";
    if (str.startsWith("```") && str.endsWith("```")) {
        str = str.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    }
    return str;
}

function extractFencedCandidates(text) {
    const out = [];
    const src = String(text || "");
    const re = /```(?:json)?\s*([\s\S]*?)```/gi;
    let m;
    while ((m = re.exec(src)) !== null) {
        const candidate = String(m?.[1] || "").trim();
        if (candidate) out.push(candidate);
    }
    return out;
}

function extractBalancedJson(text) {
    const src = String(text || "");
    const start = src.search(/[\[{]/);
    if (start < 0) return "";

    const stack = [src[start]];
    let inString = false;
    let escaped = false;

    for (let i = start + 1; i < src.length; i++) {
        const ch = src[i];

        if (inString) {
            if (escaped) {
                escaped = false;
                continue;
            }
            if (ch === "\\") {
                escaped = true;
                continue;
            }
            if (ch === '"') inString = false;
            continue;
        }

        if (ch === '"') {
            inString = true;
            continue;
        }

        if (ch === "{" || ch === "[") {
            stack.push(ch);
            continue;
        }

        if (ch === "}" || ch === "]") {
            const top = stack[stack.length - 1];
            const okPair = (top === "{" && ch === "}") || (top === "[" && ch === "]");
            if (!okPair) return "";
            stack.pop();
            if (!stack.length) return src.slice(start, i + 1).trim();
        }
    }

    return "";
}

function parse(text) {
    const raw = String(text || "").trim();
    if (!raw) return null;

    const candidates = [];
    const seen = new Set();
    const push = (candidate) => {
        const c = String(candidate || "").trim();
        if (!c || seen.has(c)) return;
        seen.add(c);
        candidates.push(c);
    };

    push(raw);
    const stripped = stripOuterCodeFence(raw);
    push(stripped);
    for (const c of extractFencedCandidates(raw)) push(c);
    push(extractBalancedJson(raw));
    push(extractBalancedJson(stripped));

    for (const c of candidates) {
        const parsed = tryParseJson(c);
        if (parsed !== null) return parsed;
    }

    return null;
}

/**
 * Parses JSON and ensures it is a non-null object (not array).
 * @param {string} text 
 * @returns {object|null}
 */
export function safeJsonParseObject(text) {
    const res = parse(text);
    return (res && typeof res === "object" && !Array.isArray(res)) ? res : null;
}

/**
 * Parses JSON and ensures it is an array.
 * @param {string} text 
 * @returns {Array|null}
 */
export function safeJsonParseArray(text) {
    const res = parse(text);
    return Array.isArray(res) ? res : null;
}
