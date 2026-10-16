import crypto from "node:crypto";
import {
  privateDirectory,
  readPrivateText,
  replacePrivateText
} from "./private-files.mjs";

const ID_RE = /^[a-f0-9-]{8,100}$/i;
const fail = (message, statusCode = 400) => Object.assign(new Error(message), {
  statusCode
});

function cleanName(value) {
  if (typeof value !== "string") throw fail("Folder name is required");
  const name = value.trim();
  if (!name || name.length > 80 || /[\u0000-\u001f\u007f]/.test(name))
    throw fail("Folder name must be 1-80 printable characters");
  return name;
}

// Organization metadata only. Goals and canonical messages are never stored here.
export class FolderStore {
  constructor(root) {
    this.root = root;
    this.folders = this.load();
  }
  load() {
    const directory = privateDirectory(this.root, "state", {
      create: true
    });
    try {
      let rows;
      try {
        rows = JSON.parse(readPrivateText(directory, "folders.json"));
      } catch (error) {
        if (error.code === "ENOENT") return [];
        throw error;
      }
      if (!Array.isArray(rows)) throw Error("Invalid persisted folder state");
      const ids = new Set(),
        names = new Set();
      for (const row of rows) {
        if (!row || !ID_RE.test(row.id) || cleanName(row.name) !== row.name || ids.has(row.id) || names.has(row.name.toLowerCase()))
          throw Error("Invalid persisted folder state");
        ids.add(row.id);
        names.add(row.name.toLowerCase());
      }
      for (const row of rows) {
        const seen = new Set([row.id]);
        let parent = row.parentId;
        while (parent) {
          if (seen.has(parent) || !ids.has(parent)) throw Error("Invalid persisted folder hierarchy");
          seen.add(parent);
          parent = rows.find(x => x.id === parent).parentId;
        }
      }
      return rows;
    } finally {
      directory.close();
    }
  }
  save(next) {
    const directory = privateDirectory(this.root, "state");
    try {
      replacePrivateText(directory, "folders.json", JSON.stringify(next, null, 2) + "\n");
    } finally {
      directory.close();
    }
    this.folders = next;
  }
  list() {
    return this.folders.map(row => ({
      ...row
    }));
  }
  get(id) {
    return this.folders.find(row => row.id === id) || null;
  }
  assertParent(parentId, selfId) {
    if (parentId == null || parentId === "") return null;
    if (typeof parentId !== "string" || !ID_RE.test(parentId) || !this.get(parentId)) throw fail("Parent folder not found");
    let cursor = this.get(parentId);
    while (cursor) {
      if (cursor.id === selfId) throw fail("Folder move would create a cycle", 409);
      cursor = cursor.parentId ? this.get(cursor.parentId) : null;
    }
    return parentId;
  }
  assertUnique(name, selfId) {
    if (this.folders.some(row => row.id !== selfId && row.name.toLowerCase() === name.toLowerCase())) throw fail("Folder name already exists", 409);
  }
  create({
    name,
    parentId = null
  } = {}) {
    const clean = cleanName(name);
    this.assertUnique(clean);
    const parent = this.assertParent(parentId),
      now = new Date().toISOString();
    const row = {
      id: crypto.randomUUID(),
      name: clean,
      parentId: parent,
      createdAt: now,
      updatedAt: now
    };
    this.save([...this.folders, row]);
    return {
      ...row
    };
  }
  update(id, patch = {}) {
    const old = this.get(id);
    if (!old) throw fail("Folder not found", 404);
    const name = patch.name === undefined ? old.name : cleanName(patch.name);
    this.assertUnique(name, id);
    const parentId = patch.parentId === undefined ? old.parentId : this.assertParent(patch.parentId, id);
    const row = {
      ...old,
      name,
      parentId,
      updatedAt: new Date().toISOString()
    };
    this.save(this.folders.map(item => item.id === id ? row : item));
    return {
      ...row
    };
  }
  remove(id, {
    sessionFolderIds = new Set()
  } = {}) {
    if (!this.get(id)) throw fail("Folder not found", 404);
    if (this.folders.some(row => row.parentId === id) || sessionFolderIds.has(id)) throw fail("Folder is not empty", 409);
    this.save(this.folders.filter(row => row.id !== id));
    return {
      ok: true,
      id
    };
  }
}
