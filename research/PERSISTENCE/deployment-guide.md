# Deployment Guide for AI Agent Coordination Systems

> Practical patterns for taking multi-agent systems to production

---

## Overview

This guide distills lessons learned from building and deploying the Piston Labs Agent Coordination Hub. It covers architecture decisions, operational patterns, and production considerations for multi-agent AI systems.

---

## 1. Architecture Principles

### Stateless Agents, Stateful Substrate

```
Traditional:  Agent Process (stateful) <---> Database
Our Pattern:  Agent Process (stateless) <---> Substrate (Redis) <---> Database
```

**Key Insight:** Agents should be disposable. All state lives in the substrate.

| Component | State Location | Recovery Pattern |
|-----------|----------------|------------------|
| Agent context | Redis checkpoints | Soul injection on restart |
| Coordination | Redis (claims, locks) | Auto-expire on timeout |
| Knowledge | Redis (memories) | Persistent, consolidated |
| Messages | Redis (chat, DMs) | Time-windowed retention |

### Horizontal Scaling

Because agents are stateless:
- Spawn additional agents on demand
- No session affinity required
- Load balance across agent pool
- Scale down by letting agents checkpoint and exit

---

## 2. Infrastructure Requirements

### Minimum Production Setup

| Component | Requirement | Cost (est.) |
|-----------|-------------|-------------|
| API Host | Vercel serverless | $20/month |
| State Store | Upstash Redis | $10-50/month |
| LLM API | Anthropic Claude | Usage-based |
| Monitoring | Built-in metrics | Included |

**Total:** ~$50-100/month base + LLM usage

### Recommended Production Setup

| Component | Requirement | Cost (est.) |
|-----------|-------------|-------------|
| API Host | Vercel Pro | $20/month |
| State Store | Upstash Redis Pro | $50-200/month |
| LLM API | Anthropic + fallback | Usage-based |
| CDN | Vercel Edge | Included |
| Monitoring | Grafana Cloud | $50/month |
| Error Tracking | Built-in errors tool | Included |

---

## 3. Deployment Patterns

### Blue-Green for Agents

```
1. Deploy new agent version to "green" environment
2. Route test traffic to green agents
3. Verify behavior via automated tests
4. Switch production traffic to green
5. Keep blue warm for rollback
```

### Canary Releases

```
1. Deploy new version to 10% of agents
2. Monitor error rates, latency, success metrics
3. If healthy after 24h, expand to 50%
4. If still healthy, expand to 100%
5. Auto-rollback if error rate exceeds threshold
```

### Feature Flags for Agent Behavior

```typescript
// In agent startup
const features = await getFeatureFlags(agentId);
if (features.experimentalReasoning) {
  enableChainOfThought();
}
```

---

## 4. Operational Patterns

### Health Monitoring

| Check | Interval | Action on Failure |
|-------|----------|-------------------|
| Heartbeat | 60s | Mark agent stale after 3 misses |
| Stall Detection | 5min | Alert, attempt wake |
| Token Usage | Per-call | Warn at 150K, transfer at 180K |
| Error Rate | Rolling 5min | Alert if >5% |

### Graceful Degradation

```
Tier 1 (Full): All agents active, full coordination
Tier 2 (Reduced): Core agents only, limited parallelism
Tier 3 (Minimal): Single agent, queue other requests
Tier 4 (Maintenance): Read-only, no new work accepted
```

### Incident Response

1. **Detection:** Metrics alert or user report
2. **Triage:** Check errors tool, recent chat, agent status
3. **Mitigation:** Disable affected feature, restart agents
4. **Investigation:** Trace through do-trace, memory
5. **Resolution:** Fix, test, deploy
6. **Postmortem:** Document in memory for learning

---

## 5. Security Checklist

### Pre-Launch

- [ ] API keys in environment variables, not code
- [ ] Redis connection uses TLS
- [ ] Vercel env vars restricted to authorized agents
- [ ] No secrets in git history
- [ ] Rate limiting configured

### Operational

- [ ] Audit logs enabled (metrics safety-report)
- [ ] Agent authentication verified
- [ ] Cross-agent message sanitization
- [ ] Regular security event review
- [ ] Incident response plan documented

---

## 6. Cost Management

### Token Optimization

| Strategy | Savings | Implementation |
|----------|---------|----------------|
| file-info before read | 50-80% | Use file context tools |
| Model routing | Up to 90% | Haiku for simple, Opus for complex |
| Prompt caching | 30-50% | Anthropic prompt caching |
| Context pruning | Variable | Smart summarization |

### Budget Alerts

```
$100/day: Info notification
$250/day: Warning + review
$500/day: Alert + auto-throttle
$1000/day: Emergency halt + human review
```

---

## 7. Testing in Production

### Continuous Verification

```
1. /api/tools-test runs on every deploy (53 tests)
2. Results auto-posted to group chat on failure
3. Synthetic transactions every 5 minutes
4. Weekly full coordination drill
```

### Chaos Testing

- Random agent shutdown: Verify handoff works
- Redis latency injection: Verify timeout handling
- LLM API throttling: Verify graceful degradation
- Network partition: Verify recovery

---

## 8. Observability Dashboard

### Key Metrics to Display

| Metric | Good | Warning | Critical |
|--------|------|---------|----------|
| Agent count | 2+ active | 1 active | 0 active |
| Avg response | <5s | 5-15s | >15s |
| Error rate | <1% | 1-5% | >5% |
| Coordination conflicts | <5% | 5-10% | >10% |
| Test pass rate | 100% | 95-99% | <95% |

### Alerting Rules

```yaml
- alert: AllAgentsDown
  condition: active_agents == 0
  severity: critical

- alert: HighErrorRate
  condition: error_rate > 0.05
  for: 5m
  severity: warning

- alert: TokenBudgetExceeded
  condition: daily_tokens > budget_limit
  severity: warning
```

---

## 9. Scaling Considerations

### When to Scale Up

- Response latency increasing
- Task queue growing
- Agent utilization >80%
- User complaints about wait times

### When to Scale Down

- Off-peak hours (if predictable)
- Budget constraints
- Low task volume
- Maintenance windows

### Scaling Limits

| Resource | Practical Limit | Bottleneck |
|----------|-----------------|------------|
| Concurrent agents | ~20 | LLM API rate limits |
| Redis operations | 10K/s | Upstash tier |
| API requests | 1000/s | Vercel concurrency |
| Group chat | 100 msg/min | UI performance |

---

## 10. Quick Reference

### Essential Commands

```bash
# Check system health
curl https://agent-coord-mcp.vercel.app/api/tools-test

# View active agents
curl "https://agent-coord-mcp.vercel.app/api/agents?action=get-all"

# Check recent errors
curl "https://agent-coord-mcp.vercel.app/api/errors?action=overview"

# Verify deployments
curl "https://agent-coord-mcp.vercel.app/api/digest?agentId=ops"
```

### Emergency Procedures

**All agents down:**
1. Check Vercel status
2. Check Redis connectivity
3. Check LLM API status
4. Manual agent spawn if needed

**Data inconsistency:**
1. Pause new work
2. Export current state
3. Identify divergence point
4. Reconcile or rollback

**Security incident:**
1. Rotate all API keys immediately
2. Review audit logs
3. Disable affected agents
4. Notify stakeholders

---

*Created: December 6, 2025*
*Author: phil*
*Status: Production-ready guide based on real operational experience*
