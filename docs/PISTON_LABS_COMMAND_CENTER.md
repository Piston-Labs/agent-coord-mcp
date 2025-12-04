# Piston Labs Command Center

## Vision

Transform the Agent Coordination Hub from an *agent-to-agent* tool into a **Piston Labs workflow accelerator** that helps the team deliver on the telemetry platform mission.

## The Team & Their Needs

### Tyler (CEO)
**Current pain points:**
- Context switching between Claude instances
- Manually loading context for each session
- Coordinating work across multiple projects

**Agent hub should provide:**
- One-command context loading for any topic
- Cross-project status visibility
- Delegation to specialized agents

### Ryan (Technical Co-Founder)  
**Current pain points:**
- Dashboard development coordination
- Database schema decisions
- Integration with Tyler's infrastructure work

**Agent hub should provide:**
- Technical context on demand
- Code review assistance
- Architecture documentation generation

### Tom (Hardware & IoT)
**Current pain points:**
- Device provisioning is manual
- Tracking device fleet status
- Troubleshooting connectivity issues

**Agent hub should provide:**
- Device provisioning automation
- Fleet status dashboard integration
- Diagnostic runbooks on demand

### Eli (Sales Engineering)
**Current pain points:**
- Creating pitch materials from scratch
- Learning the product deeply enough to sell
- Tracking shop conversations

**Agent hub should provide:**
- One-click pitch document generation
- Interactive product Q&A
- Shop prospect tracking

### Marisa (Content)
**Current pain points:**
- Maintaining consistent messaging
- Editing across many documents
- Creating investor-ready materials

**Agent hub should provide:**
- Style guide enforcement
- Bulk document updates
- Presentation generation

---

## MCP Tools to Build

### 1. `context` - Load Piston Labs Context
```
context({
  cluster: 'technical' | 'sales' | 'product' | 'investor',
  topic?: 'devices' | 'aws' | 'lambda' | 'dashboard' | 'pricing' | etc,
  depth: 'summary' | 'full'
})
```
Returns relevant context from teltonika-context-system.

### 2. `device` - Device Fleet Management
```
device({
  action: 'list' | 'status' | 'provision' | 'diagnose',
  imei?: string,
  verbose?: boolean
})
```
Wraps AWS IoT and device provisioning scripts.

### 3. `generate-doc` - Sales Document Generation
```
generate-doc({
  type: 'pitch' | 'proposal' | 'executive-summary' | 'technical-brief',
  target: 'shop-owner' | 'investor' | 'partner',
  customization?: { shopName, ownerName, specificNeeds }
})
```
Uses templates + context to generate tailored documents.

### 4. `aws-status` - Infrastructure Monitoring
```
aws-status({
  service: 'lambda' | 'iot' | 's3' | 'timescale' | 'all',
  timeRange?: '1h' | '24h' | '7d'
})
```
Returns health metrics and recent activity.

### 5. `dashboard` - Gran-Autismo Status
```
dashboard({
  action: 'status' | 'deploy' | 'logs',
  environment: 'dev' | 'staging' | 'prod'
})
```
Coordinates with Ryan's dashboard work.

### 6. `onboard` - Training & Onboarding
```
onboard({
  role: 'sales-engineer' | 'developer' | 'investor',
  phase?: number,
  action: 'start' | 'continue' | 'quiz' | 'certify'
})
```
Interactive onboarding powered by Context Engine.

### 7. `shop` - Shop/Customer Management
```
shop({
  action: 'list' | 'add' | 'status' | 'notes',
  shopName?: string,
  notes?: string
})
```
Track beta shops and prospects.

---

## UI Redesign Concepts

### Current: Agent-Centric
- Team panel shows agents
- Chat is agent-to-agent coordination
- Tasks are generic

### Proposed: Mission-Centric

**Header:** "Piston Labs Command Center"

**Left Panel - Quick Actions:**
```
📊 System Status
  └─ 3 devices online
  └─ Lambda: 0 errors
  └─ Dashboard: dev

🚗 Devices
  └─ Test Device (active)
  └─ Toyota (active)  
  └─ Lexus (active)
  └─ [+ Provision New]

📄 Generate
  └─ Shop Pitch
  └─ Investor Brief
  └─ Technical Doc

👥 Shops
  └─ Beta prospects
  └─ Active pilots
```

**Center - Command Chat:**
Team members and agents communicate here. Commands like:
- "@device provision 862464068512345"
- "@generate pitch for Bob's Auto Shop"
- "@context load technical/aws deep"
- "@status all systems"

**Right Panel - Active Context:**
Shows what context is currently loaded, who's working on what.

---

## Implementation Plan

### Phase 1: Context Integration (This Week)
1. Add `context` MCP tool that reads from teltonika-context-system
2. Create context API endpoint
3. Wire up hierarchical loading

### Phase 2: Device Management (Next Week)
1. Add `device` MCP tool
2. Integrate with AWS IoT APIs
3. Connect provisioning scripts

### Phase 3: Document Generation (Week 3)
1. Add `generate-doc` MCP tool
2. Connect to Google Drive integration
3. Template system

### Phase 4: UI Overhaul (Week 4)
1. Redesign web/index.html for Piston Labs
2. Quick action buttons
3. System status dashboard

---

## Success Metrics

**For Tyler:**
- Time to load context: <5 seconds (vs 2+ minutes manually)
- Cross-project visibility: Single dashboard

**For Eli:**
- Time to generate pitch doc: <30 seconds
- Onboarding completion: Tracked and measured

**For Tom:**
- Device provisioning: One command
- Fleet visibility: Real-time

**For Ryan:**
- Dashboard status: Always visible
- Integration docs: Auto-generated

**For Marisa:**
- Document consistency: Style-checked
- Update propagation: Bulk operations

---

## The Big Picture

The Agent Hub becomes the **operational layer** for Piston Labs:

```
┌─────────────────────────────────────────────────────────┐
│              PISTON LABS COMMAND CENTER                 │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Tyler ──────┐                                          │
│  Ryan ───────┼──→ [Command Chat] ──→ [Agents] ──→      │
│  Eli ────────┤         │               │               │
│  Tom ────────┤         ↓               ↓               │
│  Marisa ─────┘    [Context]      [Execution]           │
│                       │               │                │
│                       ↓               ↓                │
│              ┌────────────────────────────┐            │
│              │   teltonika-context-system │            │
│              │   AWS Infrastructure       │            │
│              │   Gran-Autismo Dashboard   │            │
│              │   Google Drive             │            │
│              └────────────────────────────┘            │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

Every team member can:
1. Ask for what they need in natural language
2. Get context-aware responses
3. Trigger automated workflows
4. See results in real-time

**This is how the agent hub serves the telemetry company mission.**
