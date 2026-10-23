// Google sign-in for the admin. The page gets an ID token (a JWT) from Google Identity Services and sends it
// here; it is checked against Google's public keys (JWKS), so no client secret is needed anywhere.
// Node's own crypto checks the RS256 signature.
const crypto = require("crypto");

const CERTS = "https://www.googleapis.com/oauth2/v3/certs";
const ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);
const SKEW = 60; // seconds of clock difference between Google and us
const REFETCH_GAP = 60e3; // an unknown key id refetches the keys at most once a minute (junk tokens cannot flood Google)
const PART = /^[A-Za-z0-9_-]+$/;

function decodePart(p) {
  return JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
}

function createGoogleVerifier({ clientId, fetch, now }) {
  let keys = new Map(); // kid → KeyObject
  let freshUntil = 0;
  let fetchedAt = -Infinity;
  let inflight = null;

  // Google rotates its keys and says how long a copy stays good in Cache-Control: max-age.
  function load() {
    if (!inflight) {
      inflight = (async () => {
        const r = await fetch(CERTS, { signal: AbortSignal.timeout(10000) });
        if (!r.ok) throw new Error("google certs " + r.status);
        const j = await r.json();
        const next = new Map();
        for (const k of j && Array.isArray(j.keys) ? j.keys : []) {
          if (!k || k.kty !== "RSA" || typeof k.kid !== "string") continue;
          try {
            next.set(k.kid, crypto.createPublicKey({ key: k, format: "jwk" }));
          } catch {
            // a key Node cannot read is skipped; tokens signed by it fail as unknown
          }
        }
        const m = /max-age=(\d+)/i.exec((r.headers && r.headers.get("cache-control")) || "");
        const age = m ? Math.min(Math.max(Number(m[1]), 60), 86400) : 3600;
        keys = next;
        fetchedAt = now();
        freshUntil = fetchedAt + age * 1000;
      })().finally(() => {
        inflight = null;
      });
    }
    return inflight;
  }

  async function keyFor(kid) {
    if (now() >= freshUntil) await load();
    else if (!keys.has(kid) && now() - fetchedAt > REFETCH_GAP) await load();
    return keys.get(kid) || null;
  }

  // The token → { email (lowercase), name } or null when it is not a valid Google token for our client.
  // Throws only when Google's keys cannot be fetched.
  async function verify(token) {
    if (typeof token !== "string" || token.length > 4096) return null;
    const parts = token.split(".");
    if (parts.length !== 3 || !parts.every((p) => PART.test(p))) return null;
    let header, claims;
    try {
      header = decodePart(parts[0]);
      claims = decodePart(parts[1]);
    } catch {
      return null;
    }
    if (!header || header.alg !== "RS256" || typeof header.kid !== "string" || !claims || typeof claims !== "object") return null;
    // the cheap checks first: a token for another site or an old one never costs a request to Google
    const t = now() / 1000;
    if (!ISSUERS.has(claims.iss) || claims.aud !== clientId) return null;
    if (typeof claims.exp !== "number" || claims.exp + SKEW <= t) return null;
    if (typeof claims.iat === "number" && claims.iat - SKEW > t) return null;
    if (claims.email_verified !== true || typeof claims.email !== "string" || !claims.email.includes("@")) return null;
    const key = await keyFor(header.kid);
    if (!key) return null;
    const ok = crypto.verify("RSA-SHA256", Buffer.from(parts[0] + "." + parts[1]), key, Buffer.from(parts[2], "base64url"));
    if (!ok) return null;
    return { email: claims.email.toLowerCase(), name: typeof claims.name === "string" ? claims.name.slice(0, 80) : "" };
  }

  return { verify };
}

module.exports = { createGoogleVerifier, GOOGLE_CERTS: CERTS };
