// Settings from the environment (see .env.example in the repo root). Secrets are never logged.

function loadConfig(env = process.env) {
  const str = (v) => String(v == null ? "" : v).trim();
  const int = (v, d) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n > 0 ? n : d;
  };
  // «a, b c;d» → ["a", "b", "c", "d"]
  const list = (v) => str(v).split(/[\s,;]+/).filter(Boolean);
  // only the origin of the address: scheme + host (+ port), no path or trailing slash
  const origin = (v) => {
    try {
      const u = new URL(str(v));
      return u.protocol === "https:" || u.protocol === "http:" ? u.origin : "";
    } catch {
      return "";
    }
  };
  return {
    port: int(env.PORT, 8080),
    dataDir: str(env.SMART_DATA_DIR) || "/data",
    productsFile: str(env.SMART_PRODUCTS) || null,
    // Misha joins after this many visitor messages (his word: «до меня — минимум 35 сообщений»)
    handoffMin: int(env.SMART_HANDOFF_MIN, 35),
    // messages per minute, per visitor address and per session
    ratePerMin: int(env.SMART_RATE_PER_MIN, 20),
    // a session stops growing here (both sides counted)
    maxMessages: int(env.SMART_MAX_MESSAGES, 600),
    gigachat: {
      authKey: str(env.GIGACHAT_AUTH_KEY).replace(/^Basic\s+/i, ""),
      scope: str(env.GIGACHAT_SCOPE) || "GIGACHAT_API_PERS",
      model: str(env.GIGACHAT_MODEL) || "GigaChat-2-Pro",
      // voice input: the model that writes recordings down; empty = the same model
      voiceModel: str(env.GIGACHAT_VOICE_MODEL),
      apiUrl: (str(env.GIGACHAT_API_URL) || "https://api.giga.chat/v1").replace(/\/+$/, ""),
      oauthUrl: str(env.GIGACHAT_OAUTH_URL) || "https://ngw.devices.sberbank.ru:9443/api/v2/oauth",
      // personal (PERS) keys generate in one stream at a time
      concurrency: int(env.GIGACHAT_CONCURRENCY, 1),
    },
    telegram: {
      token: str(env.TELEGRAM_BOT_TOKEN),
      username: str(env.TELEGRAM_BOT_USERNAME).replace(/^@/, ""),
      notifyChatId: str(env.TELEGRAM_NOTIFY_CHAT_ID),
    },
    // The team's admin panel (admin.js). Without the secret it is off; each login method needs its own list.
    admin: {
      secret: str(env.SMART_ADMIN_SECRET),
      siteOrigin: origin(env.SMART_SITE_ORIGIN),
      telegramIds: list(env.SMART_ADMIN_TELEGRAM_IDS).filter((x) => /^\d{1,20}$/.test(x)),
      googleClientId: str(env.SMART_GOOGLE_CLIENT_ID),
      emails: list(env.SMART_ADMIN_EMAILS).map((x) => x.toLowerCase()).filter((x) => x.includes("@")),
      wallets: list(env.SMART_ADMIN_WALLETS).map((x) => x.toLowerCase()).filter((x) => /^0x[0-9a-f]{40}$/.test(x)),
      // login attempts per minute from one address (tests raise it)
      loginPerMin: int(env.SMART_ADMIN_LOGIN_PER_MIN, 10),
    },
  };
}

module.exports = { loadConfig };
