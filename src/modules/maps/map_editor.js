
import { notify } from "../notifications.js";

export class MapEditor {
    constructor(renderer, atlas) {
        this.renderer = renderer;
        this.atlas = atlas;
        this.editMode = false;
        this.draggedNodeId = null;
        this.contextMenu = this.createContextMenu();

        this.setupEvents();
    }

    createContextMenu() {
        const menu = document.createElement('div');
        menu.id = 'uie-map-ctx-menu';
        menu.style.position = 'fixed';
        menu.style.display = 'none';
        menu.style.zIndex = '10000';
        menu.style.background = 'rgba(10, 8, 6, 0.95)';
        menu.style.border = '1px solid #e1c47a';
        menu.style.padding = '4px 0';
        menu.style.borderRadius = '4px';
        menu.style.minWidth = '140px';
        menu.style.boxShadow = '0 4px 12px rgba(0,0,0,0.5)';

        const itemStyle = `padding: 8px 12px; color: #fff; cursor: pointer; font-size: 13px; font-family: sans-serif; display: flex; align-items: center; gap: 8px;`;
        const hover = `this.style.background = 'rgba(255,255,255,0.1)'`;
        const out = `this.style.background = 'transparent'`;

        const mkItem = (icon, text, id) => `
            <div id="${id}" style="${itemStyle}" onmouseenter="${hover}" onmouseleave="${out}">
                <i class="fa-solid ${icon}" style="width: 16px; text-align: center;"></i> ${text}
            </div>
        `;

        menu.innerHTML = `
            ${mkItem('fa-map-pin', 'Create Location', 'uie-ctx-create')}
            ${mkItem('fa-pen', 'Edit Data', 'uie-ctx-edit')}
            ${mkItem('fa-trash', 'Delete Location', 'uie-ctx-delete')}
            <div style="height: 1px; background: rgba(255,255,255,0.1); margin: 4px 0;"></div>
            ${mkItem('fa-book', 'Export to Lore', 'uie-ctx-export')}
        `;

        document.body.appendChild(menu);

        // Menu Logic
        menu.querySelector('#uie-ctx-create').onclick = () => this.handleCreate();
        menu.querySelector('#uie-ctx-edit').onclick = () => this.handleEdit();
        menu.querySelector('#uie-ctx-delete').onclick = () => this.handleDelete();
        menu.querySelector('#uie-ctx-export').onclick = () => this.handleExport();

        return menu;
    }

    setupEvents() {
        if (!this.renderer.iconLayer) return;

        const layer = this.renderer.iconLayer;

        // Drag Start
        layer.addEventListener('mousedown', (e) => {
            if (!this.editMode) return;
            const nodeEl = e.target.closest('.uie-map-node-icon');
            if (nodeEl) {
                e.stopPropagation();
                e.preventDefault();
                this.draggedNodeId = nodeEl.dataset.id;
            } else {
                // Clicking empty space closes menu
                this.closeMenu();
            }
        });

        // Drag Move
        document.addEventListener('mousemove', (e) => {
            if (!this.editMode || !this.draggedNodeId) return;

            // Calculate percentage position relative to canvas
            const rect = this.renderer.canvas.getBoundingClientRect();
            const x = ((e.clientX - rect.left) / rect.width) * 100;
            const y = ((e.clientY - rect.top) / rect.height) * 100;

            // Clamp
            const cx = Math.max(0, Math.min(100, x));
            const cy = Math.max(0, Math.min(100, y));

            // Update Atlas (Live update)
            this.atlas.updateNodePosition(this.draggedNodeId, cx, cy);

            // Re-render to show movement
            // NOTE: Ideally we'd just move the DOM element for performance,
            // but triggering a full render keeps state synced.
            // optimization: move DOM element directly
            const el = layer.querySelector(`[data-id="${this.draggedNodeId}"]`);
            if (el) {
                el.style.left = `${cx}%`;
                el.style.top = `${cy}%`;
            }
        });

        // Drag End
        document.addEventListener('mouseup', () => {
            if (this.draggedNodeId) {
                this.atlas.save(); // Persist final pos
                this.draggedNodeId = null;
            }
        });

        // Context Menu
        layer.addEventListener('contextmenu', (e) => {
            if (!this.editMode) return;
            e.preventDefault();
            this.lastClickX = e.clientX;
            this.lastClickY = e.clientY;

            const nodeEl = e.target.closest('.uie-map-node-icon');
            this.targetNodeId = nodeEl ? nodeEl.dataset.id : null;

            this.contextMenu.style.display = 'block';
            this.contextMenu.style.left = `${e.clientX}px`;
            this.contextMenu.style.top = `${e.clientY}px`;

            // Show/Hide relevant options
            const isNode = !!this.targetNodeId;
            document.getElementById('uie-ctx-create').style.display = isNode ? 'none' : 'flex';
            document.getElementById('uie-ctx-edit').style.display = isNode ? 'flex' : 'none';
            document.getElementById('uie-ctx-delete').style.display = isNode ? 'flex' : 'none';
            document.getElementById('uie-ctx-export').style.display = isNode ? 'flex' : 'none';
        });

        // Close menu on click elsewhere
        document.addEventListener('click', (e) => {
            if (!e.target.closest('#uie-map-ctx-menu')) {
                this.closeMenu();
            }
        });
    }

    closeMenu() {
        this.contextMenu.style.display = 'none';
        this.targetNodeId = null;
    }

    getRelativePos() {
        const rect = this.renderer.canvas.getBoundingClientRect();
        return {
            x: ((this.lastClickX - rect.left) / rect.width) * 100,
            y: ((this.lastClickY - rect.top) / rect.height) * 100
        };
    }

    handleCreate() {
        const name = prompt("Location Name:");
        if (!name) return;
        const type = prompt("Type (city, village, forest, mountain, dungeon):", "village");
        const pos = this.getRelativePos();

        this.atlas.addNode({
            id: Date.now().toString(36),
            name,
            type: type || "unknown",
            x: pos.x,
            y: pos.y,
            desc: "Custom location."
        });
        this.closeMenu();
    }

    handleEdit() {
        if (!this.targetNodeId) return;
        const node = this.atlas.getNode(this.targetNodeId);
        if (!node) return;

        const newName = prompt("Rename:", node.name);
        if (newName) {
            this.atlas.updateNode(this.targetNodeId, { name: newName });
        }
        this.closeMenu();
    }

    handleDelete() {
        if (!this.targetNodeId) return;
        if (confirm("Delete this location?")) {
            this.atlas.deleteNode(this.targetNodeId);
        }
        this.closeMenu();
    }

    handleExport() {
        if (!this.targetNodeId) return;
        const node = this.atlas.getNode(this.targetNodeId);
        if (!node) return;

        // Call ST API to add lorebook entry
        // Since we don't have direct access to ST internals from here easily without import,
        // we'll try to find the window global or just notify
        try {
            // Placeholder for actual ST integration
            notify("success", `Exported "${node.name}" to Lorebook (Simulated)`, "Map Editor");
            // Real implementation would push to SillyTavern.Context.Lorebook or similar
        } catch (e) {
            notify("error", "Failed to export", "Map Editor");
        }
        this.closeMenu();
    }

    toggleEditMode() {
        this.editMode = !this.editMode;
        if (this.editMode) {
            notify("info", "Map Edit Mode: ON. Drag icons to move. Right-click to edit.", "Map");
            this.renderer.iconLayer.style.pointerEvents = 'auto';
        } else {
            notify("info", "Map Edit Mode: OFF", "Map");
            this.renderer.iconLayer.style.pointerEvents = 'none'; // Back to passthrough
        }
    }
}
