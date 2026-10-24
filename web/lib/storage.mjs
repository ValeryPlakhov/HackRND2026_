import { clone } from "./core.mjs";
import { WORKSPACE_SCHEMA } from "./workspace.mjs";

export const STORAGE_KEY = "blueprints-studio-workspace-v2";

export class MemoryStorage {
  constructor() {
    this.values = new Map();
  }
  getItem(key) {
    return this.values.get(key) ?? null;
  }
  setItem(key, value) {
    this.values.set(key, String(value));
  }
  removeItem(key) {
    this.values.delete(key);
  }
}

export class WorkspaceStorage {
  constructor(storage = globalThis.localStorage) {
    this.storage = storage;
    this.lastError = null;
  }

  load() {
    try {
      const raw = this.storage?.getItem(STORAGE_KEY);
      if (!raw) return this.migrateLegacy();
      const value = JSON.parse(raw);
      if (value.schema !== WORKSPACE_SCHEMA || !value.files || !value.baseline)
        return null;
      const files = Object.entries(value.files);
      if (
        !files.length ||
        files.length > 30 ||
        files.some(([, source]) => typeof source !== "string")
      )
        return null;
      return clone(value);
    } catch (error) {
      this.lastError = error;
      return null;
    }
  }

  save(workspace) {
    try {
      const value = workspace.serialize();
      let serialized = JSON.stringify(value);
      if (serialized.length > 2500000) {
        value.snapshots = value.snapshots.slice(-3);
        serialized = JSON.stringify(value);
      }
      this.storage?.setItem(STORAGE_KEY, serialized);
      this.lastError = null;
      return value.savedAt;
    } catch (error) {
      this.lastError = error;
      return null;
    }
  }

  migrateLegacy() {
    const raw = this.storage?.getItem("blueprints-workspace-v1");
    if (!raw) return null;
    try {
      const value = JSON.parse(raw);
      if (!value.files || !value.original) return null;
      return {
        schema: WORKSPACE_SCHEMA,
        name: (value.file ?? "Imported").replace(/\.java$/, ""),
        files: value.files,
        baseline: value.original,
        activeFile: value.file,
        snapshots: [],
      };
    } catch {
      return null;
    }
  }

  clear() {
    this.storage?.removeItem(STORAGE_KEY);
  }

  preferences() {
    try {
      return JSON.parse(
        this.storage?.getItem("blueprints-studio-preferences") ?? "{}",
      );
    } catch {
      return {};
    }
  }

  savePreferences(preferences) {
    try {
      this.storage?.setItem(
        "blueprints-studio-preferences",
        JSON.stringify(preferences),
      );
      return true;
    } catch {
      return false;
    }
  }
}
