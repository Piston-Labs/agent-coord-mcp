#!/bin/bash
# Railway Claude CLI Agent Entrypoint
# Clones repo, loads soul, starts Claude with initial task

set -e

echo "=== Railway Claude Agent Starting ==="
echo "Agent ID: ${AGENT_ID:-unnamed}"
echo "Target Repo: ${TARGET_REPO:-none}"
echo "MCP Hub: ${MCP_HUB_URL}"

# Validate required env vars
if [ -z "$ANTHROPIC_API_KEY" ]; then
    echo "ERROR: ANTHROPIC_API_KEY not set"
    exit 1
fi

if [ -z "$AGENT_ID" ]; then
    echo "ERROR: AGENT_ID not set"
    exit 1
fi

# Clone target repo if specified
if [ -n "$TARGET_REPO" ]; then
    echo "Cloning $TARGET_REPO..."
    cd $WORKSPACE

    if [ -n "$GITHUB_TOKEN" ]; then
        git clone "https://${GITHUB_TOKEN}@github.com/${TARGET_REPO}.git" repo
    else
        git clone "https://github.com/${TARGET_REPO}.git" repo
    fi

    cd repo
    echo "Cloned to $(pwd)"
fi

# Register with MCP coordination hub
echo "Registering with MCP hub..."
SOUL_NAME=${AGENT_SOUL:-$AGENT_ID}

curl -s -X POST "${MCP_HUB_URL}/api/agents" \
    -H "Content-Type: application/json" \
    -d "{
        \"agentId\": \"${AGENT_ID}\",
        \"status\": \"active\",
        \"workingOn\": \"Starting up via Railway\",
        \"soul\": \"${SOUL_NAME}\",
        \"platform\": \"railway\"
    }" || echo "Warning: Could not register with hub"

# Load soul/checkpoint if available
echo "Loading soul: ${SOUL_NAME}..."
CHECKPOINT=$(curl -s "${MCP_HUB_URL}/api/checkpoint?agentId=${AGENT_ID}" 2>/dev/null || echo "{}")

if [ "$CHECKPOINT" != "{}" ] && [ "$CHECKPOINT" != "null" ]; then
    echo "Found existing checkpoint, will resume context"
    RESUME_CONTEXT=$(echo $CHECKPOINT | jq -r '.state.context // empty')
fi

# Build initial prompt with soul context
INITIAL_PROMPT="You are ${AGENT_ID}, a cloud-deployed Claude Code agent.

Your soul: ${SOUL_NAME}
Hub URL: ${MCP_HUB_URL}
Workspace: $(pwd)

${RESUME_CONTEXT:+Previous context: $RESUME_CONTEXT}

FIRST ACTIONS:
1. Call hot-start to get team context: mcp__agent-coord__hot-start with agentId='${AGENT_ID}'
2. Announce yourself in group chat
3. Check for assigned tasks or pick up work from the task queue

You have full autonomy. Work efficiently with the team!"

# Start Claude CLI
echo "Starting Claude CLI..."
echo "Initial prompt: ${INITIAL_PROMPT:0:200}..."

# Run Claude with the initial prompt
# --dangerously-skip-permissions allows file operations without prompts
exec claude --dangerously-skip-permissions --print "$INITIAL_PROMPT"
