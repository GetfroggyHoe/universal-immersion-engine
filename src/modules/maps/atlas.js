
import { getSettings, saveSettings } from "../core.js";

export class Atlas {
    constructor() {
        this.data = {
            world_seed: null,
            revealed_fog_tiles: [],
            custom_nodes: [] // Use an array for full node data, not just positions
        };
        this.load(); // Load on init
    }

    load() {
        const s = getSettings();
        if (s.mapData) {
            this.data = { ...this.data, ...s.mapData };
        }
    }

    save() {
        const s = getSettings();
        s.mapData = this.data;
        saveSettings();
    }

    // Node Management
    addNode(node) {
        if (!this.data.custom_nodes) this.data.custom_nodes = [];
        this.data.custom_nodes.push(node);
        this.save();
    }

    deleteNode(id) {
        if (!this.data.custom_nodes) return;
        this.data.custom_nodes = this.data.custom_nodes.filter(n => n.id !== id);
        this.save();
    }

    updateNode(id, changes) {
        if (!this.data.custom_nodes) return;
        const idx = this.data.custom_nodes.findIndex(n => n.id === id);
        if (idx !== -1) {
            this.data.custom_nodes[idx] = { ...this.data.custom_nodes[idx], ...changes };
            this.save();
        }
    }

    updateNodePosition(id, x, y) {
        this.updateNode(id, { x, y });
    }

    getNode(id) {
        return (this.data.custom_nodes || []).find(n => n.id === id);
    }

    // Data Merging (Procedural + Custom)
    mergeNodes(proceduralNodes) {
        const custom = this.data.custom_nodes || [];
        // Custom nodes override procedural ones if IDs match, or are added if new
        // For simplicity, we just concatenate, but you could dedupe by ID
        return [...proceduralNodes, ...custom];
    }
}
