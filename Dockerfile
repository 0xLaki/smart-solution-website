# Smart Soultion site: a static site. Stage 1 builds the pages with Node (no npm packages),
# stage 2 serves the files with nginx. HTTPS and www → apex are done by the Caddy in front.
FROM node:22-alpine AS build
# fontTools cuts the wordmark font (only used when white/src/private/travels-800.ttf is present)
RUN apk add --no-cache python3 py3-fonttools
WORKDIR /src
COPY logo/logo-nabroski.html logo/logo-nabroski.html
COPY white/src white/src
ARG SITE_URL=https://smart-soultion.com
ARG SITE_INDEX=1
RUN SITE_URL="$SITE_URL" SITE_INDEX="$SITE_INDEX" OUT=/out PYTHON=python3 node white/src/build.js

FROM nginx:1.27-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /out /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD wget -q --spider http://127.0.0.1/ || exit 1
