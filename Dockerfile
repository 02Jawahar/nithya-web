# Nitya Lanka site + admin CMS — Node/Express on Alpine
FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/app/data

WORKDIR /app

# Dependencies first so code edits do not bust the layer cache.
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

# Application: the site pages, their assets, the server and the admin panel.
COPY server/ ./server/
COPY admin/ ./admin/
COPY assets/ ./assets/
COPY *.html ./

# Content, uploads and version snapshots live here. Mount a volume on this
# path in Dokploy, or every redeploy throws away the client's edits.
RUN mkdir -p /app/data && chown -R node:node /app/data
VOLUME ["/app/data"]

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}${BASE_PATH}/" >/dev/null 2>&1 || exit 1

CMD ["node", "server/index.js"]
