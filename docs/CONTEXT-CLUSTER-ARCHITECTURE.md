# Context Cluster Architecture Proposal

## Problem Statement

The agent-coord-mcp server returns excessively large token responses due to:

1. **82 registered MCP tools** - Each tool includes name, description, and Zod schema
2. **356KB of tool source code** across 14 modules  
3. **Verbose JSON responses** - Pretty-printed with `JSON.stringify(data, null, 2)`
4. **Monolithic PISTON_CONTEXT** - 343-line embedded context object
5. **No response truncation** - Full payloads returned regardless of size

## Token Impact Analysis

| Source | Estimated Tokens | Notes |
|--------|-----------------|-------|
| Tool schemas (82 tools) | ~15,000-20,000 | Name + description + params per tool |
| Pretty-printed JSON | +30-50% overhead | 2-space indentation, newlines |
| PISTON_CONTEXT blob | ~3,000 | Full nested structure |
| Typical API responses | 500-2,000 each | Varies by endpoint |

**Total cold-start context**: ~25,000+ tokens just for tool discovery

## Proposed Architecture

### 1. Tool Clustering (Tiered Registration)

Split 82 tools into logical clusters with lazy loading:

```
CORE CLUSTER (always loaded - ~10 tools)
├── work              # Combined inbox/tasks/status
├── agent-status      # Status updates, claims
├── group-chat        # Team messaging
├── profile           # Agent capabilities
├── digest            # Activity summary
└── tool-cluster      # NEW: Load additional tool clusters

CONTEXT CLUSTER (on-demand)
├── context-load      # Piston context
├── context-cluster   # GitHub context  
├── repo-context      # Codebase knowledge
├── memory            # Persistent memory
├── research-query    # Philosophy/research search
└── dictation         # Voice notes

COORDINATION CLUSTER (on-demand)
├── task              # Task management
├── handoff           # Work transfer
├── checkpoint        # Session state
├── orchestrate       # Multi-agent coordination
└── soul-transfer     # Agent state migration

INTEGRATION CLUSTER (on-demand)
├── linear            # Linear issues
├── github            # GitHub operations
├── google-drive      # Drive access
├── airtable          # Airtable CRM
├── productboard      # Product features
└── [other integrations...]

SPAWN CLUSTER (on-demand)
├── spawn-agent       # Local/cloud spawning
├── cloud-spawn       # VM management
├── hot-start         # Fast agent startup
└── external-agent    # External agent bridge

TESTING CLUSTER (on-demand)
├── test-suite        # Run tests
├── screenshot        # Visual testing
├── mobile-audit      # Mobile checks
└── feature-test      # Feature validation
```

### 2. New `tool-cluster` Meta-Tool

```typescript
server.tool(
  'tool-cluster',
  'Load additional tool clusters on demand. Core tools always available.',
  {
    action: z.enum(['list', 'load', 'unload']),
    cluster: z.enum(['context', 'coordination', 'integration', 'spawn', 'testing']).optional()
  },
  async (args) => {
    // Returns cluster info or loads tools dynamically
  }
);
```

### 3. Response Optimization

**Before:**
```typescript
return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
```

**After:**
```typescript
const response = JSON.stringify(data); // No pretty-print
const truncated = response.length > 8000 
  ? response.slice(0, 8000) + '\n[TRUNCATED - use specific query for full data]'
  : response;
return { content: [{ type: 'text', text: truncated }] };
```

### 4. Context Externalization

Move PISTON_CONTEXT from embedded code to external loadable files:

```
/context/
├── INDEX.json           # Cluster manifest with summaries only
├── technical/
│   ├── devices.md       # Otto/Teltonika details
│   ├── aws.md           # AWS architecture  
│   ├── lambda.md        # Lambda functions
│   └── databases.md     # Storage systems
├── product/
│   ├── vision.md
│   ├── roadmap.md
│   └── consumer-app.md
├── sales/
│   ├── strategy.md
│   ├── pitch.md
│   └── objections.md
└── team/
    ├── structure.md
    └── onboarding.md
```

**INDEX.json** (always loaded):
```json
{
  "clusters": {
    "technical": {
      "summary": "AWS IoT pipeline, Lambda, databases",
      "topics": ["devices", "aws", "lambda", "databases", "api"]
    },
    "product": {
      "summary": "Otto device, consumer app, shop dashboard", 
      "topics": ["vision", "consumerApp", "shopDashboard", "roadmap"]
    }
  }
}
```

### 5. Implementation Phases

**Phase 1: Quick Wins (1-2 hours)**
- [ ] Remove `null, 2` from all JSON.stringify calls
- [ ] Add 8KB response truncation to verbose tools
- [ ] Add response size logging for monitoring

**Phase 2: Context Extraction (2-3 hours)**  
- [ ] Create /context/ directory structure
- [ ] Move PISTON_CONTEXT to external files
- [ ] Create INDEX.json manifest
- [ ] Update context-load tool to use external files

**Phase 3: Tool Clustering (4-6 hours)**
- [ ] Create tool-cluster meta-tool
- [ ] Refactor tool registration to support lazy loading
- [ ] Split tools into cluster modules
- [ ] Update index.ts to register only core cluster by default

**Phase 4: Validation**
- [ ] Measure token reduction (target: 70%+ reduction)
- [ ] Test all tool clusters load correctly
- [ ] Verify no functionality regression

## Expected Results

| Metric | Before | After | Reduction |
|--------|--------|-------|-----------|
| Tools on cold-start | 82 | ~10 | 88% |
| Tool schema tokens | ~18,000 | ~2,500 | 86% |
| Avg response size | 2-5KB | 0.5-2KB | 60% |
| Context load tokens | ~3,000 | ~500 (index) | 83% |

**Total estimated reduction: 75-85%**

## Migration Path

1. Start with Phase 1 (immediate relief)
2. Monitor token usage with logging
3. Implement Phase 2 for context-heavy workflows
4. Phase 3 only if tool clustering needed for specific use cases

## Files to Modify

### Phase 1
- `src/tools/*.ts` - Remove pretty-printing, add truncation

### Phase 2  
- `api/piston-context.ts` - Load from external files
- Create `/context/` directory structure

### Phase 3
- `src/index.ts` - Conditional tool registration
- `src/tools/index.ts` - Export cluster functions
- New `src/tools/meta.ts` - tool-cluster implementation
