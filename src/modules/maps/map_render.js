
export class MapRenderer {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        // Clean container
        if (this.container) {
            this.container.innerHTML = '';
            this.root = document.createElement('div');
            this.root.id = 'uie-map-root';
            this.root.style.position = 'absolute';
            this.root.style.left = '0';
            this.root.style.top = '0';
            this.root.style.transformOrigin = '0 0';
            this.container.appendChild(this.root);
            this.canvas = document.createElement('canvas');
            this.canvas.style.display = 'block';
            this.root.appendChild(this.canvas);
            this.ctx = this.canvas.getContext('2d');

            // Icon layer (HTML for easier interaction/styling)
            this.iconLayer = document.createElement('div');
            this.iconLayer.style.position = 'absolute';
            this.iconLayer.style.inset = '0';
            this.iconLayer.style.pointerEvents = 'none'; // Allow clicking through to canvas if needed, but icons need events
            this.root.appendChild(this.iconLayer);
        }

        this.colors = {
            water: "#1a1110",
            land: "#b0a090",
            mountain: "#2f2f2f",
            forest: "#5c6b50", // Added forest color for variety
            fog: "rgba(0,0,0,1)"
        };
        this.tileSize = 10;
        this.assets = {};
        this.loadAssets();
    }

    loadAssets() {
        // Preload icons if possible, or just use FontAwesome via HTML overlays
        // Using FA for now as it's built-in to SillyTavern
    }

    resize(width, height) {
        if (!this.canvas) return;
        this.canvas.width = width * this.tileSize;
        this.canvas.height = height * this.tileSize;

        // Keep root sized to content for transform-based pan/zoom
        if (this.root) {
            this.root.style.width = `${this.canvas.width}px`;
            this.root.style.height = `${this.canvas.height}px`;
        }
        // Keep icon layer synced
        this.iconLayer.style.width = `${this.canvas.width}px`;
        this.iconLayer.style.height = `${this.canvas.height}px`;
    }

    render(mapData, playerPos, revealedTiles) {
        if (!mapData || !this.ctx) return;
        const { width, height, tiles, nodes } = mapData;
        this.resize(width, height);

        // 1. Draw Terrain
        for(let y=0; y<height; y++) {
            for(let x=0; x<width; x++) {
                const tile = tiles[y]?.[x];
                if (!tile) continue;

                let color = this.colors.water;
                if (tile.height > 0.4) {
                    color = this.colors.land;
                    if (tile.type === 'forest') color = this.colors.forest;
                }
                if (tile.height > 0.75) color = this.colors.mountain;

                this.ctx.fillStyle = color;
                this.ctx.fillRect(x*this.tileSize, y*this.tileSize, this.tileSize, this.tileSize);
            }
        }

        // 2. Draw Fog of War
        this.ctx.save();
        this.ctx.fillStyle = this.colors.fog;

        // Strategy: Fill entire screen with fog, then cut out revealed areas
        // Or: Draw fog everywhere except revealed.
        // Better for "Fog": Layer a black rectangle, then use 'destination-out' to erase revealed parts.

        this.ctx.globalCompositeOperation = 'source-over';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        this.ctx.globalCompositeOperation = 'destination-out';

        // Reveal Player Radius
        if (playerPos) {
            const px = (playerPos.x / 100) * this.canvas.width;
            const py = (playerPos.y / 100) * this.canvas.height;
            const radius = 150; // Pixels

            this.ctx.beginPath();
            this.ctx.arc(px, py, radius, 0, Math.PI * 2);
            this.ctx.fill();

            // Soft edge for fog?
            // Canvas radial gradient for opacity 1 -> 0
            const grad = this.ctx.createRadialGradient(px, py, radius * 0.8, px, py, radius);
            grad.addColorStop(0, 'rgba(0,0,0,1)'); // Erase fully
            grad.addColorStop(1, 'rgba(0,0,0,0)'); // Don't erase
            this.ctx.fillStyle = grad;
            this.ctx.beginPath();
            this.ctx.arc(px, py, radius, 0, Math.PI * 2);
            this.ctx.fill();
        }

        // Reveal Known Locations
        if (nodes) {
             for (const node of nodes) {
                // Always reveal towns/cities? Or only visited?
                // Let's reveal them slightly so user knows where to go
                const nx = (node.x / 100) * this.canvas.width;
                const ny = (node.y / 100) * this.canvas.height;
                const r = 60;
                this.ctx.beginPath();
                this.ctx.arc(nx, ny, r, 0, Math.PI * 2);
                this.ctx.fill();
             }
        }

        this.ctx.restore();

        // 3. Render Icons (HTML Overlay)
        this.renderIcons(nodes, playerPos);
    }

    renderIcons(nodes, playerPos) {
        this.iconLayer.innerHTML = '';

        // Helper to place icon
        const addIcon = (xPct, yPct, iconClass, color, title, isPlayer = false) => {
            const div = document.createElement('div');
            div.className = isPlayer ? 'uie-map-player-token' : 'uie-map-node-icon';
            div.style.position = 'absolute';
            div.style.left = `${xPct}%`;
            div.style.top = `${yPct}%`;
            div.style.transform = 'translate(-50%, -50%)';
            div.style.pointerEvents = 'auto'; // Make interactive
            div.title = title;
            div.dataset.x = xPct;
            div.dataset.y = yPct;

            if (isPlayer) {
                // Player Token Style
                div.innerHTML = `<i class="fa-solid fa-user-circle" style="font-size: 24px; color: #fff; text-shadow: 0 0 5px #000;"></i>`;
            } else {
                // Node Style
                div.innerHTML = `
                    <div style="text-align:center;">
                        <i class="fa-solid ${iconClass}" style="font-size: 20px; color: ${color}; text-shadow: 0 0 3px #000;"></i>
                        <div style="font-size: 10px; color: white; text-shadow: 0 0 2px black; margin-top: 2px; white-space: nowrap;">${title}</div>
                    </div>
                `;
            }
            this.iconLayer.appendChild(div);
            return div;
        };

        if (nodes) {
            for (const node of nodes) {
                let icon = "fa-location-dot";
                let color = "#ffffff";

                if (node.type === 'city') { icon = "fa-city"; color = "#f1c40f"; }
                else if (node.type === 'village') { icon = "fa-home"; color = "#e67e22"; }
                else if (node.type === 'forest') { icon = "fa-tree"; color = "#2ecc71"; }
                else if (node.type === 'mountain') { icon = "fa-mountain"; color = "#95a5a6"; }
                else if (node.type === 'dungeon') { icon = "fa-dungeon"; color = "#e74c3c"; }

                const el = addIcon(node.x, node.y, icon, color, node.name);
                el.dataset.id = node.id; // For editing
            }
        }

        if (playerPos) {
            addIcon(playerPos.x, playerPos.y, "", "", "Player", true);
        }
    }
}
