// Entry point of the assistant's server: listens on PORT (8080) behind the site's nginx.
const http = require("http");
const { loadConfig } = require("./config");
const { createApp } = require("./app");

const cfg = loadConfig();
const log = (line) => console.log(new Date().toISOString() + " " + line);
const app = createApp({ config: cfg, log });

const server = http.createServer((req, res) => app.handle(req, res));
server.headersTimeout = 15000;
server.requestTimeout = 90000;
server.keepAliveTimeout = 65000;

server.listen(cfg.port, () => {
  const i = app.info;
  log(
    "smart-api on :" + cfg.port +
      " · brain: " + (i.ai ? "GigaChat " + i.model : "scripted (no GIGACHAT_AUTH_KEY)") +
      " · extra CA: " + (process.env.NODE_EXTRA_CA_CERTS ? "yes" : "no") +
      " · Telegram login: " + (i.telegramLogin ? "on" : "off") +
      " · hand-off to Telegram: " + (i.telegramNotify ? "on" : "off") +
      " · services: " + i.services +
      " · hand-off after " + cfg.handoffMin + " messages"
  );
  app.startTimers();
});

// docker stop: finish the answers in flight, then exit
function stop() {
  server.close(() => app.idle().then(() => process.exit(0)));
  server.closeIdleConnections();
  setTimeout(() => process.exit(0), 8000);
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
