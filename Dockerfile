# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS frontend-build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime

ENV HOST=0.0.0.0 \
    PORT=18766 \
    NODE_ENV=production \
    T8PC_PACKAGED=1 \
    T8PC_FRONTEND_DIST=/app/dist \
    T8PC_USER_DATA=/app/userdata \
    HOME=/app/userdata

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg python3 ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN npm install -g @openai/codex

COPY backend/package.json backend/package-lock.json ./backend/
RUN cd backend && npm ci --omit=dev

COPY backend/src ./backend/src
COPY shared ./shared
COPY tools/parsehub-bridge ./tools/parsehub-bridge
COPY --from=frontend-build /app/dist ./dist

EXPOSE 18766
VOLUME ["/app/userdata"]

CMD ["node", "backend/src/server.js"]
