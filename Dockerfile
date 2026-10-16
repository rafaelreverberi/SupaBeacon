# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
FROM dependencies AS build
COPY . .
RUN npm run build && npm prune --omit=dev
FROM node:24-bookworm-slim AS runtime
ARG VERSION=development
ARG REVISION=unknown
LABEL org.opencontainers.image.title="SupaBeacon" \
      org.opencontainers.image.description="Self-hosted Supabase project monitoring and optional activity checks" \
      org.opencontainers.image.source="https://github.com/rafaelreverberi/SupaBeacon" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version=$VERSION \
      org.opencontainers.image.revision=$REVISION
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080 DATABASE_PATH=/app/data/supabeacon.db
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
RUN mkdir -p /app/data && chown node:node /app/data && chmod 700 /app/data
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD ["node","-e","fetch('http://127.0.0.1:8080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node","dist/server/apps/server/src/index.js"]
