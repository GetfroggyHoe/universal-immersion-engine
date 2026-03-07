
import { getSettings, saveSettings } from "./core.js";
import { notify } from "./notifications.js";

// ==========================================
// ADVANCED MEMORY LAYER (Vector-Lite)
// ==========================================

// Stopwords to filter out
const STOPWORDS = new Set(["the","be","to","of","and","a","in","that","have","it","for","not","on","with","he","as","you","do","at","this","but","his","by","from","they","we","say","her","she","or","an","will","my","one","all","would","there","their","what","so","up","out","if","about","who","get","which","go","me","when","make","can","like","time","no","just","him","know","take","people","into","year","your","good","some","could","them","see","other","than","then","now","look","only","come","its","over","think","also","back","after","use","two","how","our","work","first","well","way","even","new","want","because","any","these","give","day","most","us"]);

function tokenize(text) {
    return String(text || "")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, "")
        .split(/\s+/)
        .filter(w => w.length > 2 && !STOPWORDS.has(w));
}

function getVector(text) {
    // Simple Frequency Vector
    const tokens = tokenize(text);
    const vec = {};
    for (const t of tokens) {
        vec[t] = (vec[t] || 0) + 1;
    }
    return vec;
}

function cosineSimilarity(vecA, vecB) {
    const keys = new Set([...Object.keys(vecA), ...Object.keys(vecB)]);
    let dot = 0;
    let magA = 0;
    let magB = 0;
    
    for (const k of keys) {
        const a = vecA[k] || 0;
        const b = vecB[k] || 0;
        dot += a * b;
        magA += a * a;
        magB += b * b;
    }
    
    if (magA === 0 || magB === 0) return 0;
    return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

export class MemorySystem {
    constructor() {
        this.memories = []; // { id, text, vector, timestamp, type: "summary"|"fact" }
        this.initialized = false;
    }

    init() {
        if (this.initialized) return;
        this.initialized = true;
        this.load();
        console.log("[UIE] Memory System Initialized");
    }

    load() {
        const s = getSettings();
        if (s.realityEngine && s.realityEngine.memory) {
            this.memories = s.realityEngine.memory;
        }
    }

    save() {
        const s = getSettings();
        if (!s.realityEngine) s.realityEngine = {};
        s.realityEngine.memory = this.memories;
        saveSettings();
    }

    addMemory(text, type = "fact") {
        const vec = getVector(text);
        this.memories.push({
            id: Date.now().toString(36) + Math.random().toString(36).substr(2),
            text,
            vector: vec,
            timestamp: Date.now(),
            type
        });
        // Limit memory size
        if (this.memories.length > 100) {
            this.memories.shift(); // Remove oldest
        }
        this.save();
    }

    recall(query, limit = 3) {
        const qVec = getVector(query);
        const scored = this.memories.map(m => ({
            ...m,
            score: cosineSimilarity(qVec, m.vector)
        }));
        
        return scored
            .filter(m => m.score > 0.1) // Min threshold
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);
    }

    // Auto-Summarization Hook
    // This would ideally call an LLM API. 
    // Since we don't have direct access to `generate()` here easily without hacking ST internals,
    // we will use a heuristic summarizer or placeholder for now.
    async summarizeChunk(messages) {
        // Placeholder: Just take the first and last sentence of the chunk
        if (!messages || messages.length === 0) return;
        
        const combined = messages.map(m => m.text).join(" ");
        // Heuristic summary
        this.addMemory(`Summary: ${combined.substring(0, 100)}...`, "summary");
        notify("info", "Memory consolidated", "Cortex");
    }
}

export const memory = new MemorySystem();

export function initMemory() {
    memory.init();
    
    // Command Hook for debugging
    window.reMemory = {
        add: (t) => memory.addMemory(t),
        recall: (q) => console.log(memory.recall(q))
    };
}
