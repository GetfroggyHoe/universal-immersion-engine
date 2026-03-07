
import { getContext } from "/scripts/extensions.js";

// Minimal 2D Perlin Noise implementation
const perm = new Uint8Array(512);
const p = new Uint8Array(256);
for(let i=0; i<256; i++) p[i] = i;
// Shuffle
for(let i=255; i>0; i--) {
    const r = Math.floor(Math.random() * (i+1));
    [p[i], p[r]] = [p[r], p[i]];
}
for(let i=0; i<512; i++) perm[i] = p[i & 255];

function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
function lerp(t, a, b) { return a + t * (b - a); }
function grad(hash, x, y) {
    const h = hash & 15;
    const u = h < 8 ? x : y;
    const v = h < 4 ? y : (h === 12 || h === 14 ? x : 0);
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}

function perlin(x, y) {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    x -= Math.floor(x);
    y -= Math.floor(y);
    const u = fade(x);
    const v = fade(y);
    const A = perm[X] + Y, AA = perm[A], AB = perm[A+1];
    const B = perm[X+1] + Y, BA = perm[B], BB = perm[B+1];

    return lerp(v, lerp(u, grad(perm[AA], x, y), grad(perm[BA], x-1, y)),
                   lerp(u, grad(perm[AB], x, y-1), grad(perm[BB], x-1, y-1)));
}

export class WorldBuilder {
    constructor() {
        this.seed = Math.random();
    }

    // Fractal Brownian Motion for more natural terrain
    fbm(x, y, octaves = 4) {
        let val = 0;
        let amp = 0.5;
        let freq = 1;
        for(let i=0; i<octaves; i++) {
            val += perlin(x * freq + this.seed * 10, y * freq + this.seed * 10) * amp;
            freq *= 2;
            amp *= 0.5;
        }
        // Normalize to 0..1 roughly (Perlin is -1..1, fbm adds up)
        return (val + 1) * 0.5;
    }

    scanLore() {
        const ctx = getContext?.() || {};
        const lore = ctx.world_info || ctx.lorebook || [];
        const entries = Array.isArray(lore) ? lore : (lore.entries || (typeof lore === 'object' ? Object.values(lore) : []));

        const nodes = [];

        for (const entry of entries) {
            if (!entry) continue;
            const keys = String(entry.key || entry.keys || entry.name || "").toLowerCase();
            const content = String(entry.content || entry.description || "").toLowerCase();
            const name = String(entry.name || entry.comment || "Unknown Place");

            // Keyword detection
            let type = "unknown";
            if (keys.includes("city") || content.includes("city") || content.includes("capital")) type = "city";
            else if (keys.includes("village") || content.includes("village") || content.includes("town")) type = "village";
            else if (keys.includes("forest") || content.includes("forest") || content.includes("woods")) type = "forest";
            else if (keys.includes("mountain") || content.includes("mountain") || content.includes("peak")) type = "mountain";
            else if (keys.includes("ocean") || content.includes("ocean") || content.includes("sea")) type = "ocean";
            else if (keys.includes("dungeon") || content.includes("dungeon") || content.includes("cave")) type = "dungeon";

            if (type !== "unknown") {
                // Directional parsing
                let x = 50, y = 50; // Default center

                // Y-axis
                if (content.includes("north")) y = 15;
                if (content.includes("south")) y = 85;

                // X-axis
                if (content.includes("west")) x = 15;
                if (content.includes("east")) x = 85;

                // Center overrides
                if (content.includes("center") || content.includes("central")) { x = 50; y = 50; }

                // Add some jitter so they don't stack perfectly
                x += (Math.random() - 0.5) * 10;
                y += (Math.random() - 0.5) * 10;

                nodes.push({
                    id: entry.uid || Math.random().toString(36).substr(2, 9),
                    name,
                    type,
                    x: Math.max(5, Math.min(95, x)), // Clamp to 5-95%
                    y: Math.max(5, Math.min(95, y))
                });
            }
        }
        return nodes;
    }

    generate(width, height) {
        const tiles = [];
        const loreNodes = this.scanLore();

        // Generate base terrain
        for (let y = 0; y < height; y++) {
            const row = [];
            for (let x = 0; x < width; x++) {
                // Base terrain noise
                const nx = x / width;
                const ny = y / height;

                // Large features
                let h = this.fbm(nx * 3, ny * 3, 4);

                // Influence from lore nodes
                let biomeOverride = null;
                for (const node of loreNodes) {
                    const nodeX = (node.x / 100) * width;
                    const nodeY = (node.y / 100) * height;
                    const dx = x - nodeX;
                    const dy = y - nodeY;
                    const dist = Math.sqrt(dx*dx + dy*dy);

                    // Radius of influence (approx 15% of map width)
                    const radius = width * 0.15;

                    if (dist < radius) {
                        const influence = 1 - (dist / radius);

                        if (node.type === 'mountain') {
                            h += influence * 0.4; // Raise terrain
                        } else if (node.type === 'ocean') {
                            h -= influence * 0.4; // Lower terrain
                        } else if (node.type === 'forest') {
                            // Forests don't change height much but we might tag them
                            if (dist < radius * 0.8) biomeOverride = 'forest';
                        }
                    }
                }

                row.push({
                    height: Math.max(0, Math.min(1, h)),
                    type: biomeOverride || 'wild'
                });
            }
            tiles.push(row);
        }

        return { width, height, tiles, nodes: loreNodes };
    }
}
