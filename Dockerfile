# ─── Stage 1: Build ───────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies for better-sqlite3 (native addon)
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

# ─── Stage 2: Production ─────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

# Install runtime dependencies for better-sqlite3
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Clean up build tools after native addon is compiled
RUN apk del python3 make g++

COPY --from=builder /app/dist ./dist

# Create data directory for volume mount (SQLite persistence)
RUN mkdir -p /app/data

# Create memory directory for markdown memory files
RUN mkdir -p /app/memory

ENV NODE_ENV=production

CMD ["node", "dist/index.js"]
