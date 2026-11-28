// Layout model for rearrangeable widget tiles
// Manages tile order, width, visibility, and persistence
// Works in both Node (tests) and browser (ESM)

const STORAGE_KEY = "bayboard:layout";

class LayoutModel {
  constructor({ defaultTiles = [], tileRegistry = {} } = {}) {
    this.defaultTiles = defaultTiles;
    this.tileRegistry = this._buildRegistry(defaultTiles, tileRegistry);
    this.tiles = this._loadLayout();
  }

  _buildRegistry(defaultTiles, tileRegistry) {
    const registry = {};
    // Add default tiles to registry
    for (const tile of defaultTiles) {
      registry[tile.id] = {
        title: tile.title,
        defaultWidth: tile.width || "full",
      };
    }
    // Merge additional registry entries (for future cards like Bambu, Eufy, etc.)
    for (const [id, config] of Object.entries(tileRegistry)) {
      registry[id] = { ...registry[id], ...config };
    }
    return registry;
  }

  _safeLocalStorage() {
    try {
      // Check both window (browser) and global (Node test environment)
      if (typeof window !== "undefined" && window.localStorage) {
        return window.localStorage;
      }
      if (typeof globalThis !== "undefined" && globalThis.localStorage) {
        return globalThis.localStorage;
      }
      return null;
    } catch {
      return null;
    }
  }

  _loadLayout() {
    const storage = this._safeLocalStorage();
    if (!storage) return this._getDefaultLayout();

    try {
      const saved = storage.getItem(STORAGE_KEY);
      if (!saved) return this._getDefaultLayout();

      const parsed = JSON.parse(saved);
      if (!Array.isArray(parsed)) return this._getDefaultLayout();

      // Filter to only known tile ids, preserve order from saved
      const knownIds = new Set(Object.keys(this.tileRegistry));
      const layout = parsed
        .filter(t => knownIds.has(t.id))
        .map(t => ({
          id: t.id,
          title: t.title || this.tileRegistry[t.id]?.title || t.id,
          width: t.width === "half" ? "half" : "full",
          hidden: !!t.hidden,
        }));

      // Add any missing known tiles at the end with defaults
      const presentIds = new Set(layout.map(t => t.id));
      for (const [id, config] of Object.entries(this.tileRegistry)) {
        if (!presentIds.has(id)) {
          layout.push({ id, title: config.title, width: config.defaultWidth || "full", hidden: false });
        }
      }

      return layout;
    } catch {
      // Any error (storage unavailable, invalid JSON, etc.) -> default
      return this._getDefaultLayout();
    }
  }

  _getDefaultLayout() {
    return this.defaultTiles.map(t => ({
      id: t.id,
      title: t.title,
      width: t.width || "full",
      hidden: false,
    }));
  }

  _saveLayout() {
    const storage = this._safeLocalStorage();
    if (!storage) return;
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(this.tiles));
    } catch {
      // Ignore storage errors (quota, private mode, etc.)
    }
  }

  getLayout() {
    // Return a copy to prevent external mutation
    return this.tiles.map(t => ({ ...t }));
  }

  getTileRegistry() {
    return { ...this.tileRegistry };
  }

  moveTile(tileId, newIndex) {
    const index = this.tiles.findIndex(t => t.id === tileId);
    if (index === -1) return;

    const [tile] = this.tiles.splice(index, 1);
    // Clamp newIndex
    const clamped = Math.max(0, Math.min(newIndex, this.tiles.length));
    this.tiles.splice(clamped, 0, tile);
    this._saveLayout();
  }

  toggleWidth(tileId) {
    const tile = this.tiles.find(t => t.id === tileId);
    if (!tile) return;
    tile.width = tile.width === "half" ? "full" : "half";
    this._saveLayout();
  }

  setHidden(tileId, hidden) {
    const tile = this.tiles.find(t => t.id === tileId);
    if (!tile) return;
    tile.hidden = !!hidden;
    this._saveLayout();
  }

  reset() {
    this.tiles = this._getDefaultLayout();
    const storage = this._safeLocalStorage();
    if (storage) {
      try {
        storage.removeItem(STORAGE_KEY);
      } catch {
        // Ignore
      }
    }
  }
}

// Export for ES modules (browser and Node with --experimental-vm-modules)
export { LayoutModel };

// Also support CommonJS for older Node test runner
if (typeof module !== "undefined" && module.exports) {
  module.exports = { LayoutModel };
}