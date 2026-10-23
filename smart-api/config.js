// Settings from the environment (see .env.example in the repo root). Secrets are never logged.

function loadConfig(env = process.env) {
  const str = (v) => String(v == null ? "" : v).trim();
  const int = (v, d) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n > 0 ? n : d;
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
  };
}

module.exports = { loadConfig };
