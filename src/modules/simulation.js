
import { getSettings, saveSettings } from "./core.js";
import { notify } from "./notifications.js";

// ==========================================
// UTILITY AI (Needs & Decision Making)
// ==========================================

export class UtilityAI {
    constructor() {
        this.needs = {
            energy: { cur: 100, max: 100, decay: 0.5 },
            hunger: { cur: 100, max: 100, decay: 1.0 },
            social: { cur: 100, max: 100, decay: 0.8 },
            fun: { cur: 100, max: 100, decay: 0.6 }
        };
        this.actions = [
            { name: "Sleep", impact: { energy: 50, hunger: -10 }, duration: 480 },
            { name: "Eat", impact: { hunger: 40, energy: 5 }, duration: 30 },
            { name: "Chat", impact: { social: 30, fun: 10 }, duration: 15 },
            { name: "Play", impact: { fun: 40, energy: -10 }, duration: 60 },
            { name: "Work", impact: { fun: -20, energy: -20, money: 50 }, duration: 240 }
        ];
    }

    tick(minutes = 1) {
        // Decay needs
        for (const k in this.needs) {
            this.needs[k].cur = Math.max(0, this.needs[k].cur - (this.needs[k].decay * (minutes / 60)));
        }
    }

    decide() {
        // Calculate scores for each action
        let bestAction = null;
        let bestScore = -Infinity;

        for (const act of this.actions) {
            let score = 0;
            for (const k in act.impact) {
                if (this.needs[k]) {
                    // Utility Curve: Diminishing returns
                    // If need is low (0), impact is high value.
                    // If need is high (100), impact is low value.
                    const deficit = this.needs[k].max - this.needs[k].cur;
                    const weight = deficit / this.needs[k].max; // 0 to 1
                    score += act.impact[k] * weight;
                } else if (k === "money") {
                    score += act.impact[k] * 0.5; // Constant value of money
                }
            }
            if (score > bestScore) {
                bestScore = score;
                bestAction = act;
            }
        }
        return bestAction;
    }
}

// ==========================================
// ECONOMY (Market & Pricing)
// ==========================================

export class EconomySystem {
    constructor() {
        this.basePrices = {
            "food": 10,
            "water": 5,
            "fuel": 20,
            "luxury": 100
        };
        this.biomes = {
            "default": { food: 1.0, water: 1.0 },
            "desert": { food: 1.2, water: 3.0 },
            "forest": { food: 0.8, water: 0.8 },
            "city": { food: 1.5, water: 1.1, luxury: 0.8 }
        };
    }

    getPrice(itemType, biome = "default") {
        const base = this.basePrices[itemType] || 10;
        const mod = this.biomes[biome]?.[itemType] || 1.0;
        // Random fluctuation +/- 10%
        const flux = 0.9 + Math.random() * 0.2;
        return Math.floor(base * mod * flux);
    }
}

// ==========================================
// PROCEDURAL MAPS (World Generation)
// ==========================================

export class WorldGen {
    constructor() {
        this.nodes = [];
        this.links = [];
    }

    generate(seed, size = 10) {
        this.nodes = [];
        this.links = [];
        const biomes = ["forest", "desert", "city", "mountain", "swamp"];
        
        for (let i = 0; i < size; i++) {
            this.nodes.push({
                id: `loc_${i}`,
                name: `Location ${i}`,
                biome: biomes[Math.floor(Math.random() * biomes.length)],
                x: Math.random() * 100,
                y: Math.random() * 100
            });
        }

        // Simple MST or nearest neighbor linking
        for (let i = 0; i < size; i++) {
            const node = this.nodes[i];
            // Connect to nearest 2
            const others = this.nodes
                .map((n, idx) => ({ idx, dist: Math.hypot(n.x - node.x, n.y - node.y) }))
                .filter(x => x.idx !== i)
                .sort((a, b) => a.dist - b.dist);
            
            for (let k = 0; k < Math.min(2, others.length); k++) {
                const target = others[k];
                this.links.push({ source: i, target: target.idx, dist: target.dist });
            }
        }
        
        return { nodes: this.nodes, links: this.links };
    }
}

// ==========================================
// SIMULATION MANAGER
// ==========================================

export const utilityAI = new UtilityAI();
export const economy = new EconomySystem();
export const worldGen = new WorldGen();

export function initSimulation() {
    console.log("[UIE] Simulation Layer Initialized");
    // Start tick loop if needed
    setInterval(() => {
        utilityAI.tick(1); // 1 minute per real second? or per tick?
    }, 60000);
}
