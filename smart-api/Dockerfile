# Server of the assistant «Смарт»: a small Node service with no npm packages.
# Built from the repo root (see compose.yaml): the site's own products.js goes in, so the assistant
# names exactly the services the site shows.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080 SMART_DATA_DIR=/data
COPY smart-api/package.json smart-api/*.js ./
COPY white/src/products.js ./products.js
# /data is the sessions volume; the node user owns it
RUN mkdir -p /data/sessions && chown -R node:node /data
USER node
EXPOSE 8080
# GigaChat's TLS chain ends in the Russian Trusted Root CA. PEM files mounted into /certs are given
# to Node through NODE_EXTRA_CA_CERTS; TLS checks stay on. Without them the server runs on its scripted answers.
CMD ["sh", "-c", "cat /certs/*.pem /certs/*.crt > /tmp/extra-ca.pem 2>/dev/null; if [ -s /tmp/extra-ca.pem ]; then export NODE_EXTRA_CA_CERTS=/tmp/extra-ca.pem; fi; exec node server.js"]
