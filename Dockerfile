FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install ALL dependencies (including dev for build)
RUN npm ci

# Copy source files
COPY src/ ./src/
COPY api/ ./api/

# Build TypeScript
RUN npm run build

# Set environment
ENV NODE_ENV=production

# Run the autonomous agent
CMD ["node", "dist/autonomous-agent.js"]
