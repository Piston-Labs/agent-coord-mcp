/**
 * BigBrain Context Manager
 *
 * Bulletproof context management for the master orchestrator agent.
 * Implements the Context Engine architecture patterns:
 * - Checkpoint/restore for persistence across restarts
 * - Smart context summarization for token efficiency
 * - Master context file for system state
 * - Priority-based context loading
 */
import Anthropic from '@anthropic-ai/sdk';
const API_BASE = process.env.API_BASE || 'https://agent-coord-mcp.vercel.app';
// Context priorities (higher = more important to keep)
export var ContextPriority;
(function (ContextPriority) {
    ContextPriority[ContextPriority["CRITICAL"] = 100] = "CRITICAL";
    ContextPriority[ContextPriority["HIGH"] = 75] = "HIGH";
    ContextPriority[ContextPriority["MEDIUM"] = 50] = "MEDIUM";
    ContextPriority[ContextPriority["LOW"] = 25] = "LOW";
    ContextPriority[ContextPriority["EPHEMERAL"] = 0] = "EPHEMERAL"; // Can be dropped (status updates)
})(ContextPriority || (ContextPriority = {}));
export class ContextManager {
    agentId;
    masterContext;
    anthropic;
    maxContextTokens;
    checkpointKey;
    constructor(agentId, maxContextTokens = 50000) {
        this.agentId = agentId;
        this.anthropic = new Anthropic();
        this.maxContextTokens = maxContextTokens;
        this.checkpointKey = `bigbrain-context:${agentId}`;
        this.masterContext = this.createEmptyContext();
    }
    createEmptyContext() {
        return {
            version: 1,
            lastUpdated: new Date().toISOString(),
            agentId: this.agentId,
            currentFocus: 'Initializing...',
            activeTask: null,
            pendingWork: [],
            knownAgents: [],
            activeClaims: [],
            recentDecisions: [],
            currentBlockers: [],
            conversationSummary: '',
            contextItems: []
        };
    }
    /**
     * Save checkpoint to Redis via API
     */
    async saveCheckpoint() {
        try {
            const res = await fetch(`${API_BASE}/api/agent-status`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'save-checkpoint',
                    agentId: this.agentId,
                    conversationSummary: this.masterContext.conversationSummary,
                    currentTask: this.masterContext.activeTask,
                    pendingWork: this.masterContext.pendingWork,
                    recentContext: JSON.stringify({
                        version: this.masterContext.version,
                        currentFocus: this.masterContext.currentFocus,
                        recentDecisions: this.masterContext.recentDecisions.slice(-5),
                        currentBlockers: this.masterContext.currentBlockers,
                        knownAgents: this.masterContext.knownAgents,
                        activeClaims: this.masterContext.activeClaims,
                        // Only keep high-priority items in checkpoint
                        contextItems: this.masterContext.contextItems
                            .filter(i => i.priority >= ContextPriority.HIGH)
                            .slice(-20)
                    })
                })
            });
            if (!res.ok) {
                console.error('[ContextManager] Checkpoint save failed:', res.status);
                return false;
            }
            console.log('[ContextManager] Checkpoint saved successfully');
            return true;
        }
        catch (err) {
            console.error('[ContextManager] Checkpoint save error:', err);
            return false;
        }
    }
    /**
     * Restore from checkpoint (hot start)
     */
    async restoreFromCheckpoint() {
        try {
            const res = await fetch(`${API_BASE}/api/agent-status`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'get-checkpoint',
                    agentId: this.agentId
                })
            });
            if (!res.ok) {
                console.log('[ContextManager] No checkpoint found, starting fresh');
                return false;
            }
            const data = await res.json();
            if (!data.checkpoint) {
                console.log('[ContextManager] Empty checkpoint, starting fresh');
                return false;
            }
            // Restore master context
            const checkpoint = data.checkpoint;
            this.masterContext.conversationSummary = checkpoint.conversationSummary || '';
            this.masterContext.activeTask = checkpoint.currentTask || null;
            this.masterContext.pendingWork = checkpoint.pendingWork || [];
            if (checkpoint.recentContext) {
                try {
                    const recent = typeof checkpoint.recentContext === 'string'
                        ? JSON.parse(checkpoint.recentContext)
                        : checkpoint.recentContext;
                    this.masterContext.version = (recent.version || 0) + 1;
                    this.masterContext.currentFocus = recent.currentFocus || 'Restored from checkpoint';
                    this.masterContext.recentDecisions = recent.recentDecisions || [];
                    this.masterContext.currentBlockers = recent.currentBlockers || [];
                    this.masterContext.knownAgents = recent.knownAgents || [];
                    this.masterContext.activeClaims = recent.activeClaims || [];
                    this.masterContext.contextItems = recent.contextItems || [];
                }
                catch (e) {
                    console.error('[ContextManager] Failed to parse recent context:', e);
                }
            }
            console.log(`[ContextManager] Restored from checkpoint v${this.masterContext.version}`);
            return true;
        }
        catch (err) {
            console.error('[ContextManager] Checkpoint restore error:', err);
            return false;
        }
    }
    /**
     * Sync current system state (claims, agents, tasks)
     */
    async syncSystemState() {
        try {
            // Fetch current agents
            const agentsRes = await fetch(`${API_BASE}/api/agents`);
            if (agentsRes.ok) {
                const data = await agentsRes.json();
                this.masterContext.knownAgents = (data.agents || []).map((a) => ({
                    id: a.id,
                    name: a.name || a.id,
                    lastSeen: a.lastSeen || new Date().toISOString(),
                    status: a.status || 'unknown',
                    workingOn: a.currentTask
                }));
            }
            // Fetch active claims
            const claimsRes = await fetch(`${API_BASE}/api/claims`);
            if (claimsRes.ok) {
                const data = await claimsRes.json();
                this.masterContext.activeClaims = (data.claims || []).map((c) => ({
                    what: c.what,
                    by: c.by,
                    since: c.timestamp
                }));
            }
            // Fetch tasks
            const tasksRes = await fetch(`${API_BASE}/api/tasks?status=in-progress`);
            if (tasksRes.ok) {
                const data = await tasksRes.json();
                const myTasks = (data.tasks || []).filter((t) => t.assignee === this.agentId);
                if (myTasks.length > 0) {
                    this.masterContext.activeTask = myTasks[0].title;
                    this.masterContext.pendingWork = myTasks.slice(1).map((t) => t.title);
                }
            }
            this.masterContext.lastUpdated = new Date().toISOString();
        }
        catch (err) {
            console.error('[ContextManager] State sync error:', err);
        }
    }
    /**
     * Add a context item with priority
     */
    addContextItem(item) {
        const fullItem = {
            ...item,
            id: `ctx-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
            timestamp: new Date().toISOString()
        };
        this.masterContext.contextItems.push(fullItem);
        // Track decisions and blockers specially
        if (item.type === 'decision') {
            this.masterContext.recentDecisions.push(item.content);
            if (this.masterContext.recentDecisions.length > 10) {
                this.masterContext.recentDecisions.shift();
            }
        }
        if (item.type === 'blocker') {
            if (!this.masterContext.currentBlockers.includes(item.content)) {
                this.masterContext.currentBlockers.push(item.content);
            }
        }
    }
    /**
     * Update current focus
     */
    setFocus(focus) {
        this.masterContext.currentFocus = focus;
        this.addContextItem({
            type: 'message',
            content: `Focus changed to: ${focus}`,
            priority: ContextPriority.MEDIUM
        });
    }
    /**
     * Clear a blocker
     */
    resolveBlocker(blocker) {
        this.masterContext.currentBlockers = this.masterContext.currentBlockers
            .filter(b => !b.toLowerCase().includes(blocker.toLowerCase()));
    }
    /**
     * Summarize older context to save tokens
     */
    async summarizeContext() {
        const lowPriorityItems = this.masterContext.contextItems
            .filter(i => i.priority <= ContextPriority.LOW);
        if (lowPriorityItems.length < 10) {
            return; // Not enough to summarize
        }
        try {
            const contentToSummarize = lowPriorityItems
                .map(i => `[${i.type}] ${i.content}`)
                .join('\n');
            const response = await this.anthropic.messages.create({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 500,
                messages: [{
                        role: 'user',
                        content: `Summarize this conversation context into 3-5 key points. Be very concise:\n\n${contentToSummarize}`
                    }]
            });
            const summary = response.content[0].type === 'text'
                ? response.content[0].text
                : '';
            // Update conversation summary
            this.masterContext.conversationSummary = summary;
            // Remove summarized items
            const summarizedIds = new Set(lowPriorityItems.map(i => i.id));
            this.masterContext.contextItems = this.masterContext.contextItems
                .filter(i => !summarizedIds.has(i.id));
            // Add summary as a new item
            this.addContextItem({
                type: 'summary',
                content: summary,
                priority: ContextPriority.MEDIUM
            });
            console.log('[ContextManager] Context summarized, saved tokens');
        }
        catch (err) {
            console.error('[ContextManager] Summarization error:', err);
        }
    }
    /**
     * Get optimized context for Claude prompt
     */
    getContextForPrompt() {
        const sections = [];
        // Master state summary
        sections.push(`## Current State (v${this.masterContext.version})`);
        sections.push(`- Focus: ${this.masterContext.currentFocus}`);
        if (this.masterContext.activeTask) {
            sections.push(`- Active Task: ${this.masterContext.activeTask}`);
        }
        if (this.masterContext.pendingWork.length > 0) {
            sections.push(`- Pending: ${this.masterContext.pendingWork.join(', ')}`);
        }
        // Team awareness
        if (this.masterContext.knownAgents.length > 0) {
            sections.push('\n## Team Status');
            for (const agent of this.masterContext.knownAgents) {
                const status = agent.workingOn
                    ? `${agent.status} - ${agent.workingOn}`
                    : agent.status;
                sections.push(`- ${agent.name}: ${status}`);
            }
        }
        // Active claims (important for coordination)
        if (this.masterContext.activeClaims.length > 0) {
            sections.push('\n## Active Claims (DO NOT EDIT THESE FILES)');
            for (const claim of this.masterContext.activeClaims) {
                sections.push(`- ${claim.what} (claimed by ${claim.by})`);
            }
        }
        // Blockers
        if (this.masterContext.currentBlockers.length > 0) {
            sections.push('\n## Current Blockers');
            for (const blocker of this.masterContext.currentBlockers) {
                sections.push(`- ${blocker}`);
            }
        }
        // Recent decisions
        if (this.masterContext.recentDecisions.length > 0) {
            sections.push('\n## Recent Decisions');
            for (const decision of this.masterContext.recentDecisions.slice(-5)) {
                sections.push(`- ${decision}`);
            }
        }
        // Conversation summary
        if (this.masterContext.conversationSummary) {
            sections.push('\n## Conversation Summary');
            sections.push(this.masterContext.conversationSummary);
        }
        return sections.join('\n');
    }
    /**
     * Get conversation history in Anthropic format
     */
    getConversationHistory() {
        // Convert high-priority items to message format
        const messages = [];
        const relevantItems = this.masterContext.contextItems
            .filter(i => i.priority >= ContextPriority.MEDIUM)
            .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
            .slice(-15); // Keep last 15 relevant items
        for (const item of relevantItems) {
            if (item.type === 'message') {
                messages.push({ role: 'user', content: item.content });
            }
        }
        return messages;
    }
    /**
     * Process new messages and add to context
     */
    processMessages(messages) {
        for (const msg of messages) {
            const priority = msg.authorType === 'human'
                ? ContextPriority.HIGH
                : ContextPriority.MEDIUM;
            this.addContextItem({
                type: 'message',
                content: `${msg.author}: ${msg.message}`,
                priority,
                metadata: { author: msg.author, authorType: msg.authorType }
            });
        }
    }
    /**
     * Auto-checkpoint every N minutes
     */
    startAutoCheckpoint(intervalMinutes = 5) {
        return setInterval(async () => {
            await this.saveCheckpoint();
            // Also summarize if needed
            if (this.masterContext.contextItems.length > 30) {
                await this.summarizeContext();
            }
        }, intervalMinutes * 60 * 1000);
    }
    /**
     * Get full master context (for debugging)
     */
    getMasterContext() {
        return { ...this.masterContext };
    }
    /**
     * Generate a hot-start context sync message for other agents
     */
    generateContextSync() {
        const lines = [
            '**CONTEXT SYNC from BIGBRAIN**',
            '',
            `**Current Focus:** ${this.masterContext.currentFocus}`,
        ];
        if (this.masterContext.activeTask) {
            lines.push(`**Active Task:** ${this.masterContext.activeTask}`);
        }
        if (this.masterContext.pendingWork.length > 0) {
            lines.push(`**Pending Work:** ${this.masterContext.pendingWork.join(', ')}`);
        }
        if (this.masterContext.currentBlockers.length > 0) {
            lines.push('', '**Blockers:**');
            for (const b of this.masterContext.currentBlockers) {
                lines.push(`- ${b}`);
            }
        }
        if (this.masterContext.activeClaims.length > 0) {
            lines.push('', '**Active Claims:**');
            for (const c of this.masterContext.activeClaims) {
                lines.push(`- ${c.what} (${c.by})`);
            }
        }
        if (this.masterContext.recentDecisions.length > 0) {
            lines.push('', '**Recent Decisions:**');
            for (const d of this.masterContext.recentDecisions.slice(-3)) {
                lines.push(`- ${d}`);
            }
        }
        const onlineAgents = this.masterContext.knownAgents.filter(a => a.status === 'active');
        if (onlineAgents.length > 0) {
            lines.push('', '**Online Agents:**');
            for (const a of onlineAgents) {
                lines.push(`- ${a.name}: ${a.workingOn || 'idle'}`);
            }
        }
        return lines.join('\n');
    }
}
export default ContextManager;
