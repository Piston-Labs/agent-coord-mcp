# AI Compliance & Regulatory Requirements

> What you need to know about AI regulations for building and deploying AI systems

## Global Regulatory Landscape (Dec 2025)

| Region | Key Regulation | Status | Impact |
|--------|---------------|--------|--------|
| **EU** | AI Act | Effective (phased) | Most comprehensive |
| **US** | Executive Order 14110 | Active | Voluntary + reporting |
| **UK** | AI Safety Institute | Operational | Guidance-based |
| **China** | Generative AI Regulations | Active | Prior approval required |
| **Canada** | AIDA (proposed) | Pending | Risk-based |

**Key Stat:** 75 countries now have AI laws (9x increase since 2016)

---

## EU AI Act Deep Dive

### Risk Categories

| Risk Level | Examples | Requirements |
|------------|----------|--------------|
| **Unacceptable** | Social scoring, real-time biometric ID | Banned |
| **High-Risk** | Healthcare, employment, credit | Full compliance |
| **Limited Risk** | Chatbots, deepfakes | Transparency |
| **Minimal Risk** | Spam filters, games | None |

### Timeline

| Date | Requirement |
|------|-------------|
| **Feb 2, 2025** | Prohibited practices banned |
| **Aug 2, 2025** | GPAI rules apply |
| **Aug 2, 2026** | Full regulation effective |

### Prohibited Practices (Now Banned)

- Untargeted facial recognition scraping from internet/CCTV
- Emotion recognition in workplaces and schools
- Social scoring systems
- Predictive policing based on profiling
- Manipulation of vulnerable groups
- Subliminal influence techniques

### General Purpose AI (GPAI) Rules

**Code of Practice published July 2025**

| Requirement | Description |
|-------------|-------------|
| Technical documentation | Model cards, training data info |
| Copyright compliance | Respect EU copyright law |
| Training data summary | Detailed content description |
| Systemic risk assessment | For models >10^25 FLOPs |

### Penalties

| Violation | Fine |
|-----------|------|
| Prohibited practices | €35M or 7% global revenue |
| High-risk violations | €15M or 3% global revenue |
| False information | €7.5M or 1% global revenue |

---

## US AI Governance

### Executive Order 14110 (Oct 2023)

Key requirements for dual-use foundation models:

| Requirement | Threshold |
|-------------|-----------|
| Report to Commerce | Training >10^26 FLOPs |
| Red team testing | Safety evaluations |
| Watermarking | AI-generated content |

### NIST AI Risk Management Framework

| Step | Activities |
|------|------------|
| **Map** | Identify AI use contexts, stakeholders |
| **Measure** | Assess risks quantitatively |
| **Manage** | Implement controls, mitigation |
| **Govern** | Policies, oversight, accountability |

### State-Level Regulations

| State | Focus | Status |
|-------|-------|--------|
| California | Deepfakes, disclosure | Active |
| Illinois | Biometric privacy (BIPA) | Active |
| Colorado | Algorithmic discrimination | Active |
| Utah | AI disclosure | Active |

---

## Industry-Specific Requirements

### Healthcare AI

| Regulation | Applies To | Key Requirement |
|------------|-----------|-----------------|
| FDA 510(k) | Medical devices | Pre-market approval |
| HIPAA | Patient data | Privacy protection |
| 21 CFR Part 11 | Electronic records | Audit trails |

**FDA AI Devices:** 1000+ cleared by Dec 2025

### Financial Services

| Regulation | Focus |
|------------|-------|
| Fair Lending (ECOA) | No discriminatory credit decisions |
| SR 11-7 (OCC) | Model risk management |
| GDPR Article 22 | Right to human review of automated decisions |

**Trend:** "Sliding scale" oversight - higher scrutiny for higher-risk AI uses

### Autonomous Vehicles

| Agency | Focus |
|--------|-------|
| NHTSA | Safety standards |
| State DMVs | Operating permits |
| Local authorities | Geographic restrictions |

---

## Data Privacy Compliance

### GDPR Requirements for AI

| Right | AI Implication |
|-------|----------------|
| Right to explanation | Must explain automated decisions |
| Right to human review | Can't be fully automated |
| Data minimization | Collect only necessary data |
| Purpose limitation | Use data only as specified |

### Training Data Considerations

| Issue | Mitigation |
|-------|------------|
| Copyright infringement | License data, use public domain |
| Personal data | Anonymize, get consent |
| Scraping restrictions | Respect robots.txt, ToS |
| Bias in data | Audit, balance datasets |

---

## AI Safety Standards

### ISO/IEC Standards

| Standard | Focus |
|----------|-------|
| ISO/IEC 42001 | AI management systems |
| ISO/IEC 23894 | AI risk management |
| ISO/IEC 24027 | Bias in AI |
| ISO/IEC 22989 | AI concepts/terminology |

### NIST AI 100-2e2025 (Dec 2025)

New adversarial ML framework covering:
- Attack taxonomies
- Defense strategies
- Model robustness testing
- Governance protocols

---

## Compliance Checklist for AI Development

### Pre-Development

- [ ] Identify applicable regulations by jurisdiction
- [ ] Classify AI system risk level (EU AI Act)
- [ ] Assess training data sources and rights
- [ ] Define intended use and limitations

### During Development

- [ ] Maintain technical documentation
- [ ] Implement bias testing
- [ ] Conduct red team evaluations
- [ ] Document training data sources
- [ ] Implement access controls

### Pre-Deployment

- [ ] Complete risk assessment
- [ ] Obtain necessary certifications
- [ ] Create model cards/transparency docs
- [ ] Implement monitoring systems
- [ ] Establish incident response plan

### Post-Deployment

- [ ] Monitor for drift and bias
- [ ] Maintain audit logs
- [ ] Handle data subject requests
- [ ] Report incidents as required
- [ ] Regular re-evaluation

---

## Our Compliance Posture

### Current Status (Agent-Coord)

| Requirement | Status | Notes |
|-------------|--------|-------|
| Transparency | ✅ | Open group chat, visible actions |
| Human oversight | ✅ | Human-in-loop by design |
| Documentation | ✅ | CLAUDE.md constitution |
| Data handling | ⚠️ | Review PII in memories |
| Audit logging | ✅ | All actions logged |
| Risk assessment | 🔄 | Needs formal documentation |

### EU AI Act Classification

Our system would likely be classified as **Limited Risk** (chatbot/assistant), requiring:
- User notification they're interacting with AI
- Transparency about AI-generated content

**NOT High-Risk** because we're not making:
- Employment decisions
- Credit decisions
- Healthcare diagnoses
- Law enforcement predictions

### Recommended Actions

1. **Add AI disclosure** to all agent outputs
2. **Document data sources** for research library
3. **Implement data retention policy** for memories
4. **Create incident response plan** for misuse
5. **Regular bias audits** on agent behavior

---

## Resources

### Official Sources
- [EU AI Act](https://artificialintelligenceact.eu/)
- [NIST AI RMF](https://www.nist.gov/itl/ai-risk-management-framework)
- [FDA AI/ML Guidance](https://www.fda.gov/medical-devices/software-medical-device-samd/artificial-intelligence-and-machine-learning-aiml-enabled-medical-devices)

### Industry Guidance
- [Anthropic Usage Policy](https://www.anthropic.com/policies/usage-policy)
- [OpenAI Usage Policies](https://openai.com/policies/usage-policies)
- [Google AI Principles](https://ai.google/responsibility/principles/)

---

*Last updated: December 6, 2025*
*Review quarterly for regulatory changes*
