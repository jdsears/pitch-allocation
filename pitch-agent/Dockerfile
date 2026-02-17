# --- Build stage: compile React client ---
FROM node:20-slim AS builder

WORKDIR /app

# Install server dependencies (skip Puppeteer's Chromium download for build stage)
COPY package.json package-lock.json* ./
RUN PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true npm install

# Install client dependencies and build
COPY client/package.json client/package-lock.json* ./client/
RUN cd client && npm install
COPY client/ ./client/
RUN cd client && npm run build

# --- Production stage: Node + Chromium ---
FROM node:20-slim

# Install Chromium and dependencies (Debian has real Chromium, not a snap stub)
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    libnss3 \
    libatk-bridge2.0-0 \
    libdrm2 \
    libxkbcommon0 \
    libgbm1 \
    libasound2 \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Tell Puppeteer to use the system Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# Install production dependencies only
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# Copy server code
COPY server/ ./server/

# Copy built React client from builder stage
COPY --from=builder /app/client/build ./client/build

EXPOSE 3001

CMD ["node", "server/index.js"]
