// The admin's own data next to the sessions: <data>/admin.json =
//   { leads: { [sessionId]: { projectId?, closedAt? } }, projects: [ ... ] }
// Written atomically like the sessions (temp file + rename, mode 0600). Every change runs under one lock,
// so two team members saving at once never lose each other's edits.
const path = require("path");
const { readJson, writeJson } = require("./store");

function createAdminStore(dataDir, lock) {
  const file = path.join(dataDir, "admin.json");

  async function read() {
    const d = (await readJson(file)) || {};
    return {
      leads: d.leads && typeof d.leads === "object" && !Array.isArray(d.leads) ? d.leads : {},
      projects: Array.isArray(d.projects) ? d.projects.filter((p) => p && typeof p === "object") : [],
    };
  }

  // fn(data) changes data in place and returns the answer; the file is written only when fn succeeds
  function change(fn) {
    return lock("admin", async () => {
      const d = await read();
      const out = await fn(d);
      await writeJson(file, d);
      return out;
    });
  }

  return { read, change };
}

module.exports = { createAdminStore };
