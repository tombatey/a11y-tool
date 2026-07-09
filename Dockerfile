# Playwright's official Node image includes all browser system dependencies
FROM mcr.microsoft.com/playwright/node:22-jammy

WORKDIR /app

# Install dependencies first (separate layer — cached unless package.json changes)
COPY package*.json ./
RUN npm ci

# Install Chromium browser binary
RUN npx playwright install chromium

# Copy source
COPY . .

# Run migrations then start
CMD ["sh", "-c", "node db/migrate.js && node src/server.js"]

EXPOSE 3000
