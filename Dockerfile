# Build from repository root:
#   docker build -f services/game-server/Dockerfile -t golazo-game-server .
FROM node:22-alpine
WORKDIR /app

COPY packages/game-sim ./packages/game-sim
COPY services/game-server/package.json ./services/game-server/package.json
WORKDIR /app/services/game-server
RUN npm install --omit=dev

COPY services/game-server/src ./src

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" || exit 1

CMD ["node", "--experimental-strip-types", "src/index.js"]
