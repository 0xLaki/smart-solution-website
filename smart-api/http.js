// Small HTTP pieces shared by the visitor API (app.js) and the admin API (admin.js).
const MAX_BODY = 16 * 1024; // every JSON body, except where a route asks for more (voice recordings)

class HttpError extends Error {
  // headers: extra response headers, e.g. Set-Cookie that clears a dead admin cookie
  constructor(status, body, headers) {
    super(body.error || String(status));
    this.status = status;
    this.body = body;
    this.headers = headers || null;
  }
}
const tooFast = (sec) => new HttpError(429, { ok: false, error: "rate", retryIn: sec });

// Sliding one-minute windows in memory.
function createLimiter(now) {
  const hits = new Map();
  function hit(key, limit, windowMs = 60000) {
    const t = now();
    const arr = (hits.get(key) || []).filter((x) => t - x < windowMs);
    if (arr.length >= limit) {
      hits.set(key, arr);
      return Math.max(1, Math.ceil((windowMs - (t - arr[0])) / 1000));
    }
    arr.push(t);
    hits.set(key, arr);
    return 0;
  }
  function prune() {
    const t = now();
    for (const [k, arr] of hits) if (!arr.length || t - arr[arr.length - 1] > 60000) hits.delete(k);
  }
  return { hit, prune };
}

function cleanText(v) {
  if (typeof v !== "string") return "";
  return v
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function readBody(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let over = false;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) over = true;
      else chunks.push(c);
    });
    req.on("end", () => {
      if (over) return reject(new HttpError(413, { ok: false, error: "too_big" }));
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw.trim()) return resolve({});
      try {
        const j = JSON.parse(raw);
        resolve(j && typeof j === "object" && !Array.isArray(j) ? j : {});
      } catch {
        reject(new HttpError(400, { ok: false, error: "bad_json" }));
      }
    });
    req.on("error", reject);
  });
}

function send(res, status, obj, headers) {
  const body = JSON.stringify(obj);
  res.writeHead(
    status,
    Object.assign(
      {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": Buffer.byteLength(body),
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex",
      },
      headers || {}
    )
  );
  res.end(body);
}

module.exports = { HttpError, tooFast, createLimiter, cleanText, readBody, send };
