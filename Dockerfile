FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy built files
COPY dist/ ./dist/

# Set environment
ENV NODE_ENV=production

# Run the agent bot
CMD ["node", "dist/agent-bot.js"]
