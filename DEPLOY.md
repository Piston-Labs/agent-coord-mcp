# Piston Labs Agent Hub - Deployment Guide

## Quick Local Testing

```bash
# Install and build
npm install
npm run build

# Start with in-memory storage
npm run start:http

# Start with file persistence
PERSIST=true npm run start:http

# Open browser
open http://localhost:3001
```

## Deploy to Vercel

### Option 1: Vercel CLI

```bash
# Install Vercel CLI
npm i -g vercel

# Login
vercel login

# Deploy (will prompt for project setup)
vercel

# Deploy to production
vercel --prod
```

### Option 2: GitHub Integration

1. Push to GitHub:
   ```bash
   git remote add origin https://github.com/YOUR_ORG/agent-hub.git
   git push -u origin main
   ```

2. Connect in Vercel:
   - Go to https://vercel.com/new
   - Import your GitHub repo
   - Vercel auto-detects settings from vercel.json
   - Click Deploy

### Environment Variables

Set these in Vercel dashboard → Settings → Environment Variables:

| Variable | Description | Required |
|----------|-------------|----------|
| `PERSIST` | Enable persistence (use external DB in prod) | No |
| `CONVEX_URL` | Convex database URL (for real persistence) | For prod |

## Production Architecture

For production, replace in-memory/file storage with:

### Option A: Convex (Recommended)
- Real-time database with subscriptions
- Zero-config deployment
- Built-in WebSocket support

```bash
npm install convex
npx convex init
npx convex deploy
```

### Option B: Upstash Redis
- Serverless Redis
- Perfect for Vercel edge functions
- Low latency

```bash
npm install @upstash/redis
# Add UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN
```

### Option C: PlanetScale / Turso
- Serverless MySQL/SQLite
- Good for structured queries

## MCP Client Configuration

Add to your Claude Code / Cursor / Windsurf config:

```json
{
  "mcpServers": {
    "agent-hub": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://YOUR-VERCEL-URL.vercel.app/api/mcp"]
    }
  }
}
```

Or for local:
```json
{
  "mcpServers": {
    "agent-hub": {
      "command": "node",
      "args": ["C:/path/to/agent-coord-mcp/dist/index.js"]
    }
  }
}
```

## Scaling Considerations

### Context Efficiency
- Messages are kept in rolling window (last 1000)
- Claims/locks auto-expire after 2 hours
- Agents marked stale after 30 min inactivity

### Token Optimization
- Use structured claims instead of chat announcements
- Zones prevent file conflicts without coordination overhead
- Checkpoints enable session recovery without context replay

### Multi-Region
For global deployment:
1. Use edge-compatible database (Upstash, Turso)
2. Deploy to Vercel edge functions
3. Use regional endpoints for latency
