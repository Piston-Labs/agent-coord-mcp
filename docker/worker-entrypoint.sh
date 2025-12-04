#!/bin/bash
# Claude CLI Worker Entrypoint
# This script initializes the worker environment and starts Claude CLI
set -e

echo "=== Claude CLI Worker Starting ==="
echo "Agent ID: ${AGENT_ID:-unnamed}"
echo "Soul ID: ${SOUL_ID:-default}"
echo "Target Repo: ${TARGET_REPO:-none}"

# Validate required environment variables
if [ -z "$ANTHROPIC_API_KEY" ]; then
    echo "ERROR: ANTHROPIC_API_KEY is required"
    exit 1
fi

# Configure git if token provided
if [ -n "$GITHUB_TOKEN" ]; then
    echo "Configuring GitHub authentication..."
    git config --global credential.helper store
    echo "https://x-access-token:${GITHUB_TOKEN}@github.com" > ~/.git-credentials
    git config --global user.email "agent@piston-labs.com"
    git config --global user.name "${AGENT_ID:-claude-worker}"
fi

# Clone target repo if specified
if [ -n "$TARGET_REPO" ]; then
    echo "Cloning repository: ${TARGET_REPO}..."
    REPO_DIR="/workspace/repo"

    if [[ "$TARGET_REPO" == http* ]]; then
        git clone "$TARGET_REPO" "$REPO_DIR"
    else
        git clone "https://github.com/${TARGET_REPO}.git" "$REPO_DIR"
    fi

    cd "$REPO_DIR"
    echo "Repository cloned to $REPO_DIR"
fi

# Load soul from coordination hub if SOUL_ID is set
SOUL_PROMPT=""
if [ -n "$SOUL_ID" ] && [ -n "$COORD_API" ]; then
    echo "Loading soul: ${SOUL_ID}..."
    SOUL_DATA=$(curl -s "${COORD_API}/api/souls/${SOUL_ID}" 2>/dev/null || echo "{}")
    SOUL_PROMPT=$(echo "$SOUL_DATA" | jq -r '.systemPrompt // empty')

    if [ -n "$SOUL_PROMPT" ]; then
        echo "Soul loaded successfully"
    else
        echo "No soul found, using default personality"
    fi
fi

# Announce presence to coordination hub
if [ -n "$COORD_API" ]; then
    echo "Announcing to coordination hub..."
    curl -s -X POST "${COORD_API}/api/chat" \
        -H "Content-Type: application/json" \
        -d "{\"author\":\"${AGENT_ID:-claude-worker}\",\"authorType\":\"agent\",\"message\":\"**Worker Online**\\n- Soul: ${SOUL_ID:-default}\\n- Repo: ${TARGET_REPO:-none}\\n- Task: ${TASK:-awaiting instructions}\"}" \
        > /dev/null 2>&1 || true
fi

# Build the initial prompt
INITIAL_PROMPT=""
if [ -n "$TASK" ]; then
    INITIAL_PROMPT="$TASK"
fi

# Create Claude CLI config with soul
CLAUDE_CONFIG_DIR="$HOME/.claude"
mkdir -p "$CLAUDE_CONFIG_DIR"

if [ -n "$SOUL_PROMPT" ]; then
    echo "Injecting soul into Claude CLI config..."
    cat > "$CLAUDE_CONFIG_DIR/CLAUDE.md" << SOULEOF
$SOUL_PROMPT

## Worker Context
- Agent ID: ${AGENT_ID:-claude-worker}
- Working Directory: $(pwd)
- Coordination Hub: ${COORD_API:-not configured}

## Guidelines
- Report progress to group chat periodically
- Claim tasks before starting work to avoid conflicts
- Push to feature branches, not main
- Save important decisions and learnings
SOULEOF
fi

echo "=== Starting Claude CLI ==="
echo "Working directory: $(pwd)"

# Start Claude CLI
# If we have an initial task, pass it as the first prompt
if [ -n "$INITIAL_PROMPT" ]; then
    echo "Initial task: $INITIAL_PROMPT"
    exec claude --dangerously-skip-permissions "$INITIAL_PROMPT"
else
    exec claude --dangerously-skip-permissions
fi
