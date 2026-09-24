FROM node:22-bookworm-slim AS build
WORKDIR /app
# better-sqlite3 compiles a native module; sharp pulls prebuilt binaries
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
# npm ci installs exactly what package-lock.json pins, so a rebuild can't pick up
# newer dependency versions on its own. It fails if the lockfile is out of date.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data PORT=8080
RUN mkdir -p /data && chown node:node /data
COPY --from=build /app/node_modules ./node_modules
COPY server.js ./
COPY public ./public
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:8080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
