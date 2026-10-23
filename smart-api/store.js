// Sessions on disk: one JSON file per session in <data>/sessions/, written atomically (temp file + rename),
// and <data>/telegram.json mapping a Telegram user id to their latest session.
// Work on one session is serialised in memory (one process serves the API).
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

const ID = /^[A-Za-z0-9_-]{22}$/; // 128 random bits, base64url

function createStore(dataDir) {
  const dir = path.join(dataDir, "sessions");
  const indexFile = path.join(dataDir, "telegram.json");
  fs.mkdirSync(dir, { recursive: true });
  const chains = new Map();

  const validId = (id) => typeof id === "string" && ID.test(id);
  const newId = () => crypto.randomBytes(16).toString("base64url");
  const file = (id) => path.join(dir, id + ".json");

  async function writeJson(target, obj) {
    const tmp = target + "." + crypto.randomBytes(6).toString("hex") + ".tmp";
    await fsp.writeFile(tmp, JSON.stringify(obj, null, 1), { mode: 0o600 });
    await fsp.rename(tmp, target);
  }

  async function readJson(target) {
    try {
      return JSON.parse(await fsp.readFile(target, "utf8"));
    } catch (e) {
      if (e.code === "ENOENT") return null;
      throw e;
    }
  }

  // Runs fn alone for this key: calls for the same key wait for each other.
  function lock(key, fn) {
    const prev = chains.get(key) || Promise.resolve();
    const run = prev.then(fn, fn);
    const tail = run.catch(() => {});
    chains.set(key, tail);
    tail.then(() => {
      if (chains.get(key) === tail) chains.delete(key);
    });
    return run;
  }

  // A merged session points to the one it was merged into (Telegram login on another device).
  async function resolveId(id) {
    for (let hops = 0; hops < 4 && validId(id); hops++) {
      const s = await readJson(file(id));
      if (!s) return null;
      if (!s.mergedInto) return id;
      id = s.mergedInto;
    }
    return null;
  }

  async function load(id) {
    if (!validId(id)) return null;
    const s = await readJson(file(id));
    return s && !s.mergedInto ? s : null;
  }

  async function save(s) {
    s.updatedAt = new Date().toISOString();
    await writeJson(file(s.id), s);
  }

  // Loads the session (following a merge), runs fn(session or null) under its lock.
  async function withSession(id, fn, hops = 0) {
    const real = validId(id) ? await resolveId(id) : null;
    if (!real) return fn(null);
    const r = await lock("s:" + real, async () => {
      const s = await readJson(file(real));
      // merged while we waited for the lock: go on to the session it was merged into
      if (s && s.mergedInto && hops < 3) return { again: s.mergedInto };
      return { value: await fn(s && !s.mergedInto ? s : null) };
    });
    return r.again ? withSession(r.again, fn, hops + 1) : r.value;
  }

  // A read without the lock, for background work.
  async function peek(id) {
    const real = validId(id) ? await resolveId(id) : null;
    return real ? load(real) : null;
  }

  async function telegramGet(userId) {
    const idx = (await readJson(indexFile)) || {};
    return idx[String(userId)] || null;
  }

  async function telegramSet(userId, sessionId) {
    return lock("telegram-index", async () => {
      const idx = (await readJson(indexFile)) || {};
      idx[String(userId)] = sessionId;
      await writeJson(indexFile, idx);
    });
  }

  // Empty sessions (no visitor message, no contact) older than maxAgeMs are removed.
  async function sweep(maxAgeMs, nowMs = Date.now()) {
    let removed = 0;
    for (const name of await fsp.readdir(dir)) {
      const full = path.join(dir, name);
      if (name.endsWith(".tmp")) {
        const st = await fsp.stat(full).catch(() => null);
        if (st && nowMs - st.mtimeMs > 3600e3) await fsp.rm(full, { force: true });
        continue;
      }
      if (!name.endsWith(".json")) continue;
      const id = name.slice(0, -5);
      await lock("s:" + id, async () => {
        const s = await readJson(full).catch(() => null);
        if (!s || nowMs - Date.parse(s.updatedAt || s.createdAt || 0) < maxAgeMs) return;
        // merged sessions stay: they lead the other device to the session they were merged into
        const empty = !s.mergedInto && !s.contact && !s.telegramUser && !s.messages.some((m) => m.role === "user");
        if (empty) {
          await fsp.rm(full, { force: true });
          removed++;
        }
      });
    }
    return removed;
  }

  return { validId, newId, withSession, peek, save, lock, telegramGet, telegramSet, sweep };
}

module.exports = { createStore };
