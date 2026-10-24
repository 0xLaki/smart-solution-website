// The admin's logins: Telegram, Google, wallet; the cookie; CSRF and Origin; admin_off. Real crypto, no network.
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { secp256k1 } = require("@noble/curves/secp256k1");
const { keccak_256 } = require("@noble/hashes/sha3");
const { start } = require("./helpers");
const { ORIGIN, SECRET, TG_ID, NOW, adminEnv, cookieOf, H, tgAuth, loginTelegram } = require("./admin-helpers");
const { recoverAddress, checksumAddress } = require("../auth-wallet");

const A = "/api/smart/admin/";
const at = (sec) => () => sec * 1000;

// ---------- Google: an RSA key pair stands in for Google's, a fetch stand-in serves its JWKS ----------
const CLIENT = "1234567890-test.apps.googleusercontent.com";

function googleKey(kid) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  return { kid, privateKey, jwk: Object.assign(publicKey.export({ format: "jwk" }), { kid, alg: "RS256", use: "sig" }) };
}

function jwt(key, claims, kid = key.kid) {
  const part = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const h = part({ alg: "RS256", kid, typ: "JWT" });
  const p = part(claims);
  return h + "." + p + "." + crypto.sign("RSA-SHA256", Buffer.from(h + "." + p), key.privateKey).toString("base64url");
}

const claims = (now, extra) =>
  Object.assign(
    { iss: "https://accounts.google.com", aud: CLIENT, sub: "1001", email: "Yana@Example.com", email_verified: true, name: "Яна Арсеньева", iat: now - 10, exp: now + 3600 },
    extra
  );

function jwksFetch(keys) {
  const fn = async (url) => {
    fn.calls.push(String(url));
    if (String(url) !== "https://www.googleapis.com/oauth2/v3/certs") throw new Error("unexpected fetch " + url);
    if (fn.down) return new Response("{}", { status: 500 });
    return new Response(JSON.stringify({ keys: keys.map((k) => k.jwk) }), {
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=21600, must-revalidate, no-transform" },
    });
  };
  fn.calls = [];
  return fn;
}

// ---------- wallet: a secp256k1 key, its address, and personal_sign done the way wallets do it ----------
function newWallet() {
  const sk = secp256k1.utils.randomPrivateKey();
  const pub = secp256k1.getPublicKey(sk, false);
  return { sk, address: "0x" + Buffer.from(keccak_256(pub.subarray(1))).subarray(-20).toString("hex") };
}

function personalSign(w, message) {
  const m = Buffer.from(message, "utf8");
  const hash = keccak_256(Buffer.concat([Buffer.from("\x19Ethereum Signed Message:\n" + m.length, "utf8"), m]));
  const sig = secp256k1.sign(hash, w.sk);
  return "0x" + sig.toCompactHex() + (27 + sig.recovery).toString(16);
}

// ---------- off ----------
test("without SMART_ADMIN_SECRET (or with a short one) every admin path answers 503 admin_off", async () => {
  for (const env of [{}, { SMART_ADMIN_SECRET: "too-short" }]) {
    const t = await start(Object.assign(adminEnv(), { SMART_ADMIN_SECRET: "" }, env));
    try {
      for (const r of [
        await t.get(A + "config"),
        await t.get(A + "me"),
        await t.get(A + "leads"),
        await t.post(A + "login/telegram", { auth: tgAuth() }),
        await t.get(A + "nothing/here"),
      ]) {
        assert.equal(r.status, 503);
        assert.deepEqual(r.body, { ok: false, error: "admin_off" });
        assert.equal(r.headers.get("cache-control"), "no-store");
        assert.equal(r.headers.get("x-robots-tag"), "noindex");
      }
      // the visitor's API is not touched
      assert.equal((await t.get("/api/smart/config")).status, 200);
    } finally {
      await t.close();
    }
  }
});

test("config shows only the login ways that have both their setting and their list", async () => {
  const t = await start({ SMART_ADMIN_SECRET: SECRET, SMART_SITE_ORIGIN: ORIGIN + "/", TELEGRAM_BOT_TOKEN: "1:x", TELEGRAM_BOT_USERNAME: "smart_bot", SMART_GOOGLE_CLIENT_ID: CLIENT });
  try {
    const r = await t.get(A + "config");
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { ok: true, telegramBot: null, googleClientId: null, wallet: false, siteOrigin: ORIGIN });
  } finally {
    await t.close();
  }
  const w = newWallet();
  const t2 = await start(adminEnv({ SMART_GOOGLE_CLIENT_ID: CLIENT, SMART_ADMIN_EMAILS: "yana@example.com", SMART_ADMIN_WALLETS: w.address }));
  try {
    const r = await t2.get(A + "config");
    assert.deepEqual(r.body, { ok: true, telegramBot: "smart_test_bot", googleClientId: CLIENT, wallet: true, siteOrigin: ORIGIN });
    assert.deepEqual(t2.app.info.admin, { on: true, shortSecret: false, methods: ["telegram", "google", "wallet"] });
  } finally {
    await t2.close();
  }
});

// ---------- Telegram ----------
test("Telegram: a team member gets the cookie; a wrong hash, an old login and someone else are refused", async () => {
  const t = await start(adminEnv(), undefined, { now: at(NOW) });
  try {
    const ok = await t.post(A + "login/telegram", { auth: tgAuth() }, { Origin: ORIGIN });
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.body, { ok: true, user: { name: "Яна Арсеньева", via: "telegram" } });
    const raw = ok.headers.get("set-cookie");
    assert.match(raw, /^smart_admin=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}; /);
    for (const flag of ["HttpOnly", "Secure", "SameSite=Strict", "Path=/api/smart/admin", "Max-Age=43200"]) assert.ok(raw.split("; ").includes(flag), flag);

    const me = await t.get(A + "me", { Cookie: cookieOf(ok) });
    assert.equal(me.status, 200);
    assert.deepEqual(me.body, { ok: true, user: { name: "Яна Арсеньева", via: "telegram" } });

    const forged = Object.assign(tgAuth(), { first_name: "Не Яна" });
    assert.deepEqual((await t.post(A + "login/telegram", { auth: forged })).body, { ok: false, error: "bad_auth" });
    assert.equal((await t.post(A + "login/telegram", { auth: tgAuth({ auth_date: NOW - 3601 }) })).status, 401);
    assert.equal((await t.post(A + "login/telegram", { auth: tgAuth({}, "999:other-bot") })).status, 401);
    assert.equal((await t.post(A + "login/telegram", {})).status, 401);
    const stranger = await t.post(A + "login/telegram", { auth: tgAuth({ id: 42 }) });
    assert.equal(stranger.status, 403);
    assert.deepEqual(stranger.body, { ok: false, error: "not_team" });
    assert.equal(stranger.headers.get("set-cookie"), null);
  } finally {
    await t.close();
  }
});

test("Telegram login is off without the id list, even with the bot", async () => {
  const t = await start(adminEnv({ SMART_ADMIN_TELEGRAM_IDS: "" }), undefined, { now: at(NOW) });
  try {
    const r = await t.post(A + "login/telegram", { auth: tgAuth() });
    assert.equal(r.status, 503);
    assert.equal(r.body.error, "method_off");
  } finally {
    await t.close();
  }
});

// ---------- Google ----------
test("Google: a signed ID token of a listed, verified e-mail logs in; every bad token is refused", async () => {
  const key = googleKey("kid-1");
  const fetch = jwksFetch([key]);
  let clock = NOW * 1000;
  const t = await start(adminEnv({ SMART_GOOGLE_CLIENT_ID: CLIENT, SMART_ADMIN_EMAILS: "yana@example.com, misha@example.com" }), fetch, { now: () => clock });
  try {
    const login = (token) => t.post(A + "login/google", { credential: token }, { Origin: ORIGIN });
    const ok = await login(jwt(key, claims(NOW)));
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.body, { ok: true, user: { name: "Яна Арсеньева", via: "google" } });
    const me = await t.get(A + "me", { Cookie: cookieOf(ok) });
    assert.equal(me.body.user.via, "google");
    assert.equal(fetch.calls.length, 1);

    // the keys are kept for max-age: the next logins do not fetch them again
    assert.equal((await login(jwt(key, claims(NOW, { name: undefined })))).body.user.name, "yana@example.com");
    assert.equal(fetch.calls.length, 1);

    const bad = async (token, status = 401, error = "bad_auth") => {
      const r = await login(token);
      assert.equal(r.status, status, JSON.stringify(r.body));
      assert.equal(r.body.error, error);
      assert.equal(r.headers.get("set-cookie"), null);
    };
    await bad(jwt(key, claims(NOW, { aud: "someone-else.apps.googleusercontent.com" })));
    await bad(jwt(key, claims(NOW, { iss: "https://evil.example" })));
    await bad(jwt(key, claims(NOW, { exp: NOW - 120 })));
    await bad(jwt(key, claims(NOW, { email_verified: false })));
    await bad(jwt(key, claims(NOW, { email_verified: "true" })));
    await bad(jwt(key, claims(NOW, { email: "stranger@example.com" })), 403, "not_team");
    await bad(jwt(googleKey("kid-1"), claims(NOW))); // right kid, another key: the signature fails
    await bad("not.a.token");
    await bad(undefined);
    const parts = jwt(key, claims(NOW)).split(".");
    await bad(parts[0] + "." + Buffer.from(JSON.stringify(claims(NOW, { email: "misha@example.com" }))).toString("base64url") + "." + parts[2]);
    assert.equal(fetch.calls.length, 1);

    // an unknown key id: the keys are fetched once more (at most once a minute), then the token is refused
    clock += 61e3;
    await bad(jwt(key, claims(NOW), "kid-unknown"));
    assert.equal(fetch.calls.length, 2);
    await bad(jwt(key, claims(NOW), "kid-unknown"));
    assert.equal(fetch.calls.length, 2);
  } finally {
    await t.close();
  }
});

test("Google: a key published after our copy is fetched on its first token; Google down = 502", async () => {
  const key1 = googleKey("kid-1");
  const key2 = googleKey("kid-2");
  const keys = [key1];
  const fetch = jwksFetch(keys);
  let clock = NOW * 1000;
  const t = await start(adminEnv({ SMART_GOOGLE_CLIENT_ID: CLIENT, SMART_ADMIN_EMAILS: "yana@example.com" }), fetch, { now: () => clock });
  try {
    const login = (token) => t.post(A + "login/google", { credential: token });
    assert.equal((await login(jwt(key1, claims(NOW)))).status, 200);
    keys.push(key2);
    clock += 120e3;
    assert.equal((await login(jwt(key2, claims(NOW)))).status, 200);
    assert.equal(fetch.calls.length, 2);

    // after max-age the keys are fetched again; if Google does not answer, the login says so
    clock += 21600e3;
    fetch.down = true;
    const r = await login(jwt(key1, claims(NOW + 120 + 21600)));
    assert.equal(r.status, 502);
    assert.equal(r.body.error, "google_failed");
  } finally {
    await t.close();
  }
});

// ---------- wallet ----------
test("wallet: the server's SIWE message signed by a listed key logs in; reuse, edits, other keys and old nonces do not", async () => {
  const yana = newWallet();
  const other = newWallet();
  const outsider = newWallet();
  let clock = Date.parse("2026-10-23T09:00:00.000Z");
  const t = await start(adminEnv({ SMART_ADMIN_WALLETS: yana.address.toUpperCase().replace("0X", "0x") + "," + other.address }), undefined, { now: () => clock });
  try {
    const nonce = async (w) => {
      const r = await t.get(A + "login/wallet/nonce?address=" + checksumAddress(w.address));
      assert.equal(r.status, 200, JSON.stringify(r.body));
      return r.body;
    };
    const login = (message, signature) => t.post(A + "login/wallet", { message, signature }, { Origin: ORIGIN });

    const n = await nonce(yana);
    assert.match(n.nonce, /^[0-9a-f]{32}$/);
    assert.equal(
      n.message,
      [
        "smart-soultion.com wants you to sign in with your Ethereum account:",
        checksumAddress(yana.address),
        "",
        "Sign in to the Smart Soultion admin",
        "",
        "URI: https://smart-soultion.com/admin/",
        "Version: 1",
        "Chain ID: 1",
        "Nonce: " + n.nonce,
        "Issued At: 2026-10-23T09:00:00.000Z",
        "Expiration Time: 2026-10-23T09:05:00.000Z",
      ].join("\n")
    );
    const sig = personalSign(yana, n.message);
    const ok = await login(n.message, sig);
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    const c = checksumAddress(yana.address);
    assert.deepEqual(ok.body, { ok: true, user: { name: c.slice(0, 6) + "…" + c.slice(-4), via: "wallet" } });
    assert.equal((await t.get(A + "me", { Cookie: cookieOf(ok) })).body.user.via, "wallet");

    // the same message and signature again: the nonce is spent
    assert.deepEqual((await login(n.message, sig)).body, { ok: false, error: "bad_auth" });

    // an edited message (and the nonce is spent by the attempt, so the original fails after it too)
    const n2 = await nonce(yana);
    const edited = n2.message.replace("Chain ID: 1", "Chain ID: 5");
    assert.equal((await login(edited, personalSign(yana, edited))).status, 401);
    assert.equal((await login(n2.message, personalSign(yana, n2.message))).status, 401);

    // a message issued for Yana signed by another listed key
    const n3 = await nonce(yana);
    assert.equal((await login(n3.message, personalSign(other, n3.message))).status, 401);

    // a message the server never issued
    const n4 = await nonce(yana);
    const fake = n4.message.replace(n4.nonce, "f".repeat(32));
    assert.equal((await login(fake, personalSign(yana, fake))).status, 401);

    // a key that is not on the list signs its own message correctly
    const n5 = await nonce(outsider);
    const r5 = await login(n5.message, personalSign(outsider, n5.message));
    assert.equal(r5.status, 403);
    assert.equal(r5.body.error, "not_team");

    // a broken signature
    const n6 = await nonce(yana);
    assert.equal((await login(n6.message, "0x1234")).status, 401);

    // five minutes later the nonce is no good
    const n7 = await nonce(yana);
    clock += 5 * 60e3 + 1000;
    assert.equal((await login(n7.message, personalSign(yana, n7.message))).status, 401);

    // the other listed key still gets in with a fresh nonce
    const n8 = await nonce(other);
    assert.equal((await login(n8.message, personalSign(other, n8.message))).status, 200);

    assert.equal((await t.get(A + "login/wallet/nonce?address=0x123")).status, 400);
    assert.equal((await t.get(A + "login/wallet/nonce")).body.error, "bad_address");
  } finally {
    await t.close();
  }
});

test("wallet: signature recovery matches a published web3.js example", () => {
  // web3.eth.accounts.sign("Some data", "0x4c0883a6…") from the web3.js documentation
  const sig =
    "0xb91467e570a6466aa9e9876cbcd013baba02900b8979d43fe208a4a4f339f5fd6007e74cd82e037b800186422fc2da167c747ef045e5d18a5f5d4300f8e1a0291c";
  assert.equal(recoverAddress("Some data", sig), "0x2c7536e3605d9c16a7a3d7b1898e529396a65c23");
  assert.equal(recoverAddress("Some other data", sig) === "0x2c7536e3605d9c16a7a3d7b1898e529396a65c23", false);
  assert.equal(checksumAddress("0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed"), "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed");
});

// ---------- the cookie ----------
test("the cookie: a changed payload, a forged or missing signature and an expired login are refused and cleared", async () => {
  let clock = NOW * 1000;
  const t = await start(adminEnv(), undefined, { now: () => clock });
  try {
    const cookie = await loginTelegram(t);
    const value = cookie.slice("smart_admin=".length);
    const [p, s] = value.split(".");
    const payload = JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
    assert.deepEqual(Object.keys(payload).sort(), ["exp", "name", "sub", "via"]);
    assert.equal(payload.sub, "tg:" + TG_ID);
    assert.equal(payload.exp, NOW + 43200);

    const longer = Buffer.from(JSON.stringify(Object.assign({}, payload, { exp: NOW + 10 * 86400 }))).toString("base64url");
    const otherSub = Buffer.from(JSON.stringify(Object.assign({}, payload, { sub: "tg:5550002" }))).toString("base64url");
    const wrongKey = crypto.createHmac("sha256", "another-secret-of-the-same-length-0123456789abc").update(p).digest("base64url");
    for (const bad of [longer + "." + s, otherSub + "." + s, p + "." + wrongKey, p, p + ".", "garbage", p + "." + s + ".x"]) {
      const r = await t.get(A + "me", { Cookie: "smart_admin=" + bad });
      assert.equal(r.status, 401, bad);
      assert.deepEqual(r.body, { ok: false, error: "no_login" });
      assert.match(r.headers.get("set-cookie"), /^smart_admin=; .*Max-Age=0/);
    }
    // no cookie at all: 401 and nothing to clear
    const none = await t.get(A + "me");
    assert.equal(none.status, 401);
    assert.equal(none.headers.get("set-cookie"), null);
    // the right cookie among others
    assert.equal((await t.get(A + "me", { Cookie: "a=1; smart_admin=" + value + "; b=2" })).status, 200);

    clock += 43200e3 - 1000;
    assert.equal((await t.get(A + "me", { Cookie: cookie })).status, 200);
    clock += 2000;
    assert.equal((await t.get(A + "me", { Cookie: cookie })).status, 401);
  } finally {
    await t.close();
  }
});

test("taking someone off the list logs them out; the cookie survives a restart with the same secret", async () => {
  const opts = { now: at(NOW) };
  const t = await start(adminEnv(), undefined, opts);
  let cookie;
  try {
    cookie = await loginTelegram(t);
  } finally {
    await t.close();
  }
  const same = await start(adminEnv(), undefined, opts);
  try {
    assert.equal((await same.get(A + "me", { Cookie: cookie })).status, 200);
  } finally {
    await same.close();
  }
  const removed = await start(adminEnv({ SMART_ADMIN_TELEGRAM_IDS: "5550002" }), undefined, opts);
  try {
    const r = await removed.get(A + "me", { Cookie: cookie });
    assert.equal(r.status, 401);
    assert.equal(r.body.error, "no_login");
    assert.equal((await removed.get(A + "leads", { Cookie: cookie })).status, 401);
  } finally {
    await removed.close();
  }
  const otherSecret = await start(adminEnv({ SMART_ADMIN_SECRET: SECRET.replace("test", "TEST") }), undefined, opts);
  try {
    assert.equal((await otherSecret.get(A + "me", { Cookie: cookie })).status, 401);
  } finally {
    await otherSecret.close();
  }
});

// ---------- CSRF, Origin, limits, routing ----------
test("POSTs need X-Smart-Admin: 1 (logins excepted) and an Origin, when sent, must be the site's", async () => {
  const t = await start(adminEnv(), undefined, { now: at(NOW) });
  try {
    const cookie = await loginTelegram(t);
    const noHeader = await t.post(A + "projects", { name: "Сайт" }, { Cookie: cookie, Origin: ORIGIN });
    assert.equal(noHeader.status, 403);
    assert.deepEqual(noHeader.body, { ok: false, error: "csrf" });
    assert.equal((await t.post(A + "projects", { name: "Сайт" }, { Cookie: cookie, "X-Smart-Admin": "yes" })).status, 403);
    assert.equal((await t.post(A + "logout", {}, { Cookie: cookie })).status, 403);

    const evil = await t.post(A + "projects", { name: "Сайт" }, H(cookie, { Origin: "https://evil.example" }));
    assert.equal(evil.status, 403);
    assert.deepEqual(evil.body, { ok: false, error: "bad_origin" });
    assert.equal((await t.post(A + "login/telegram", { auth: tgAuth() }, { Origin: "https://evil.example" })).body.error, "bad_origin");
    assert.equal((await t.post(A + "login/telegram", { auth: tgAuth() }, { Origin: "null" })).status, 403);
    assert.equal((await t.post(A + "login/telegram", { auth: tgAuth() }, { Origin: ORIGIN + ":8443" })).status, 403);

    // the header and the cookie, with or without Origin
    assert.equal((await t.post(A + "projects", { name: "Сайт" }, H(cookie))).status, 200);
    assert.equal((await t.post(A + "projects", { name: "Сайт" }, { Cookie: cookie, "X-Smart-Admin": "1" })).status, 200);
    // the header without the cookie
    assert.equal((await t.post(A + "projects", { name: "Сайт" }, { "X-Smart-Admin": "1" })).status, 401);

    const out = await t.post(A + "logout", {}, H(cookie));
    assert.equal(out.status, 200);
    assert.match(out.headers.get("set-cookie"), /^smart_admin=; HttpOnly; Secure; SameSite=Strict; Path=\/api\/smart\/admin; Max-Age=0$/);
  } finally {
    await t.close();
  }
});

test("logins are limited per address; unknown admin paths are 404, wrong methods 405", async () => {
  const t = await start(adminEnv({ SMART_ADMIN_LOGIN_PER_MIN: "" }), undefined, { now: at(NOW) });
  try {
    for (let i = 0; i < 10; i++) assert.equal((await t.post(A + "login/telegram", { auth: tgAuth({ id: 42 }) })).status, 403);
    const r = await t.post(A + "login/telegram", { auth: tgAuth() });
    assert.equal(r.status, 429);
    assert.equal(r.body.error, "rate");
    // another address is not affected
    assert.equal((await t.post(A + "login/telegram", { auth: tgAuth() }, { "X-Real-IP": "10.0.0.9" })).status, 200);

    assert.equal((await t.get(A + "nothing")).status, 404);
    assert.equal((await t.get(A + "leads/abc/def/ghi")).status, 404);
    const m = await t.get(A + "login/telegram");
    assert.equal(m.status, 405);
    assert.equal(m.body.error, "method");
  } finally {
    await t.close();
  }
});
