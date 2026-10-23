// Sign-In with Ethereum (EIP-4361) for the admin. The server writes the whole message with a one-time
// nonce, the wallet signs it with personal_sign (EIP-191), and the server recovers the signer's address
// from the signature. keccak256 and secp256k1 come from the audited @noble packages: no crypto by hand here.
const crypto = require("crypto");
const { secp256k1 } = require("@noble/curves/secp256k1");
const { keccak_256 } = require("@noble/hashes/sha3");

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const NONCE_TTL = 5 * 60e3;
const MAX_NONCES = 5000; // memory guard: nonces nobody used
const STATEMENT = "Sign in to the Smart Soultion admin"; // EIP-4361 wants ASCII here, or wallets skip their sign-in screen

const hex = (bytes) => Buffer.from(bytes).toString("hex");

// EIP-55: the address with the checksum in the letters' case
function checksumAddress(address) {
  const lower = address.slice(2).toLowerCase();
  const h = hex(keccak_256(Buffer.from(lower, "ascii")));
  let out = "0x";
  for (let i = 0; i < 40; i++) out += parseInt(h[i], 16) >= 8 ? lower[i].toUpperCase() : lower[i];
  return out;
}

// EIP-191 personal_sign: the wallet hashes "\x19Ethereum Signed Message:\n" + byte length + the message
function personalHash(message) {
  const m = Buffer.from(message, "utf8");
  return keccak_256(Buffer.concat([Buffer.from("\x19Ethereum Signed Message:\n" + m.length, "utf8"), m]));
}

// The address (lowercase) that made this 65-byte signature (r, s, v), or null.
function recoverAddress(message, signature) {
  if (typeof signature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(signature)) return null;
  const raw = signature.slice(2);
  let v = parseInt(raw.slice(128), 16);
  if (v >= 27) v -= 27; // wallets send 27/28, some 0/1
  if (v !== 0 && v !== 1) return null;
  try {
    const sig = secp256k1.Signature.fromCompact(raw.slice(0, 128)).addRecoveryBit(v);
    const pub = sig.recoverPublicKey(personalHash(message)).toRawBytes(false); // 0x04 + x + y
    return "0x" + hex(keccak_256(pub.subarray(1)).subarray(-20));
  } catch {
    return null;
  }
}

function createWalletLogin({ origin, now }) {
  const host = new URL(origin).host;
  const nonces = new Map(); // nonce → { message, address, exp }

  function prune() {
    const t = now();
    for (const [k, v] of nonces) if (v.exp <= t) nonces.delete(k);
  }

  // → { message, nonce }, or null when too many unused nonces are waiting
  function issue(address) {
    prune();
    if (nonces.size >= MAX_NONCES) return null;
    const nonce = crypto.randomBytes(16).toString("hex");
    const t = now();
    const iso = (ms) => new Date(ms).toISOString();
    const message = [
      host + " wants you to sign in with your Ethereum account:",
      checksumAddress(address),
      "",
      STATEMENT,
      "",
      "URI: " + origin + "/admin/",
      "Version: 1",
      "Chain ID: 1",
      "Nonce: " + nonce,
      "Issued At: " + iso(t),
      "Expiration Time: " + iso(t + NONCE_TTL),
    ].join("\n");
    nonces.set(nonce, { message, address: address.toLowerCase(), exp: t + NONCE_TTL });
    return { message, nonce };
  }

  // → the signer's address (lowercase) or null. The nonce is spent on any attempt, right or wrong.
  function verify(message, signature) {
    if (typeof message !== "string" || message.length > 2000) return null;
    const m = /\nNonce: ([0-9a-f]{32})\n/.exec(message);
    if (!m) return null;
    const entry = nonces.get(m[1]);
    nonces.delete(m[1]);
    if (!entry || entry.message !== message || entry.exp <= now()) return null;
    const signer = recoverAddress(message, signature);
    return signer && signer === entry.address ? signer : null;
  }

  return { issue, verify, prune, size: () => nonces.size };
}

module.exports = { createWalletLogin, checksumAddress, personalHash, recoverAddress, ADDRESS, STATEMENT };
