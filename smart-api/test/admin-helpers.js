// Helpers for the admin tests: the env with every login way on, the login cookie out of Set-Cookie,
// the headers an admin page sends, and a Telegram login of a team member. All values are test-only.
const { signedLogin } = require("./helpers");

const ORIGIN = "https://smart-soultion.com";
const SECRET = "test-only-admin-secret-0123456789abcdefghijklmnop";
const TG_TOKEN = "123456:TEST-admin-token";
const TG_ID = 5550001;
const NOW = 1_790_000_000; // seconds

function adminEnv(extra) {
  return Object.assign(
    {
      SMART_ADMIN_SECRET: SECRET,
      SMART_SITE_ORIGIN: ORIGIN,
      TELEGRAM_BOT_TOKEN: TG_TOKEN,
      TELEGRAM_BOT_USERNAME: "smart_test_bot",
      SMART_ADMIN_TELEGRAM_IDS: String(TG_ID) + ", 5550002",
      SMART_ADMIN_LOGIN_PER_MIN: "1000",
    },
    extra || {}
  );
}

// "smart_admin=<value>" from a login answer, or null
function cookieOf(res) {
  const raw = res.headers.get("set-cookie");
  const m = raw && /^(smart_admin=[^;]*)/.exec(raw);
  return m ? m[1] : null;
}

// what the admin page sends with every POST
const H = (cookie, extra) => Object.assign({ Cookie: cookie, "X-Smart-Admin": "1", Origin: ORIGIN }, extra || {});

function tgAuth(fields, token = TG_TOKEN) {
  return signedLogin(Object.assign({ id: TG_ID, first_name: "Яна", last_name: "Арсеньева", username: "yana_pm", auth_date: NOW - 30 }, fields), token);
}

async function loginTelegram(t, fields) {
  const r = await t.post("/api/smart/admin/login/telegram", { auth: tgAuth(fields) }, { Origin: ORIGIN });
  if (r.status !== 200) throw new Error("login failed: " + r.status + " " + JSON.stringify(r.body));
  return cookieOf(r);
}

module.exports = { ORIGIN, SECRET, TG_TOKEN, TG_ID, NOW, adminEnv, cookieOf, H, tgAuth, loginTelegram };
