# PARA Organization System

This directory uses the **PARA Method** (Tiago Forte) to organize research and documentation by actionability:

## Structure

### Projects (`/projects/`)
**Active work with deadlines or outcomes**
- Sprint-related documentation
- In-progress feature specs
- Time-bound deliverables
- Current implementation plans

**Criteria:** Has a deadline, specific outcome, or is actively being worked on.

### Areas (`/areas/`)
**Ongoing responsibilities without end dates**
- Architecture documentation (maintained over time)
- Philosophy frameworks (evolving principles)
- Team processes (continuously updated)
- Quality standards (permanent reference)

**Criteria:** Ongoing responsibility to maintain, no specific deadline.

### Resources (`/resources/`)
**Reference material for future use**
- Market research and analysis
- Competitive intelligence
- Technical tutorials and patterns
- External research summaries

**Criteria:** Useful for reference but not actively worked on.

### Archives (`/archives/`)
**Completed or superseded content**
- Completed project documentation
- Superseded plans
- Historical analysis (no longer current)
- Deprecated approaches

**Criteria:** No longer actively relevant but preserved for history.

## PARA in Memory API

The Agent Coordination Hub's memory system supports PARA classification:

```typescript
// Create a project memory (actionable, has deadline)
POST /api/memory
{
  "category": "decision",
  "content": "Sprint 3 goal: implement dashboard telemetry view",
  "para": "project",
  "deadline": "2025-01-15",
  "projectStatus": "active"
}

// Create an area memory (ongoing responsibility)
POST /api/memory
{
  "category": "pattern",
  "content": "All APIs must include rate limiting middleware",
  "para": "area",
  "areaId": "api-standards"
}

// Create a resource memory (reference material)
POST /api/memory
{
  "category": "learning",
  "content": "Bouncie competitor analysis: $8/month, basic features",
  "para": "resource"
}

// Archive a completed project
PATCH /api/memory
{
  "id": "mem-xxx",
  "para": "archive",
  "archiveReason": "Sprint completed, goals achieved"
}
```

## Hot-Start Prioritization

When agents call `hot-start`, memories are prioritized by PARA type:

1. **Projects** (highest priority) - Active work needs immediate context
2. **Areas** (high priority) - Ongoing responsibilities inform decisions
3. **Resources** (base priority) - Reference material as needed
4. **Archives** (excluded) - Not loaded unless explicitly requested

Deadline urgency adds additional boost:
- Due within 7 days: +0.5 priority
- Overdue: +1.0 priority

## Migration Guide

### From Existing Structure

1. **PERSISTENCE/** → Mostly Areas (architecture, philosophy, processes)
2. **PRODUCT-RESEARCH/** → Mostly Resources (market analysis)
3. **SKILLS-CLUSTERS/** → Resources (reference patterns)
4. **Active sprint work** → Projects

### File Naming Convention

Use YAML frontmatter for PARA metadata:

```yaml
---
para: project|area|resource|archive
deadline: 2025-01-15  # For projects
projectStatus: active|completed|abandoned  # For projects
areaId: architecture  # For areas (groups related areas)
archivedAt: 2025-01-01  # For archives
archiveReason: Superseded by v2  # For archives
---
```

## References

- [PARA Method - Forte Labs](https://fortelabs.com/blog/para/)
- [Building a Second Brain](https://www.buildingasecondbrain.com/)
