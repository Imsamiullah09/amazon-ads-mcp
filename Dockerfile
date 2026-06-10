# ── build stage ──────────────────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# ── runtime stage ─────────────────────────────────────────────────────────────
FROM node:22-alpine
RUN addgroup -S mcp && adduser -S mcp -G mcp
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
USER mcp

# Default to HTTP transport in containers; override MCP_TRANSPORT=stdio and
# run with `docker run -i` to use stdio from an MCP client.
ENV MCP_TRANSPORT=http
ENV MCP_HTTP_PORT=3000
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1

ENTRYPOINT ["node", "dist/index.js"]
