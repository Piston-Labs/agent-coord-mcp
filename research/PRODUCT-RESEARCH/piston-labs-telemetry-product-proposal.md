---
cluster: [strategic, technical]
complexity: L3
ai_summary: Comprehensive product proposal for Piston Labs telemetry offerings - synthesizes all market research into actionable strategy
last_updated: 2025-12-07
tags: [proposal, strategy, telemetry, fleet, obd, insurance, roadmap, executive-summary]
dependencies:
  - fleet-saas-competitive-analysis.md
  - consumer-obd-diagnostic-analysis.md
  - insurance-telematics-b2b2c-analysis.md
  - small-fleet-solutions-analysis.md
  - revenue-timeline-launch-sequence.md
---

# Piston Labs Telemetry Product Proposal

## Document Purpose

This proposal synthesizes market research across four telemetry product opportunities into a unified go-to-market strategy for Piston Labs. It is designed to:

1. Inform strategic decision-making
2. Guide technical implementation priorities
3. Serve as a handoff document for Claude agents building technical specs

---

## Executive Summary

### The Opportunity

Piston Labs sits at a unique intersection: **existing telematics infrastructure** (Teltonika devices) combined with a **trusted shop network** of 1000+ independent repair shops. This creates differentiation that pure-play fleet or consumer telematics companies cannot match.

### Market Sizing

| Market | 2025 Size | Growth | Piston Labs TAM |
|--------|-----------|--------|-----------------|
| Fleet Management SaaS | $25B+ | 15% CAGR | $500M (small fleet segment) |
| Consumer OBD Scanners | $2.5B | 7-8% CAGR | $250M (connected devices) |
| Insurance Telematics | $4.68B | 16.9% CAGR | $100M (data partnerships) |
| Small Fleet (<50 vehicles) | Underserved | Growing | $200M (service businesses) |

### Recommended Strategy

**Launch four products in sequence over 18 months:**

1. **Q1 2025: Small Fleet Tracking** - Fastest path to revenue
2. **Q2 2025: Consumer OBD Device** - Highest margin, shop network leverage
3. **Q3 2025: Enterprise Fleet SaaS** - Scale play
4. **Q4 2025: Insurance B2B2C** - Partnership revenue

### Financial Targets

| Year | Revenue | Key Milestone |
|------|---------|---------------|
| Year 1 | $765K | Product-market fit across 2+ products |
| Year 2 | $2.6M | 3,000+ fleet vehicles, 15K consumer devices |
| Year 3 | $5.9M | Insurance partnerships, potential Series A |

---

## Product Portfolio

### Product 1: Small Fleet Tracking

**Target Market:** Service businesses with 5-50 vehicles (landscaping, plumbing, HVAC, electrical, pest control, cleaning services)

**Value Proposition:** "Fleet tracking built for service businesses. No contracts. No complexity. Just results."

**Competitive Position:**

| Factor | Competitors | Piston Labs |
|--------|-------------|-------------|
| Price | $23-50/vehicle/mo | $12-18/vehicle/mo |
| Contract | 3 years required | Month-to-month |
| Hardware | Proprietary, $80-150 | Teltonika ($49) or BYOD |
| Unique Value | Generic fleet features | Shop network for maintenance |

**Pricing Tiers:**

| Tier | Price | Features |
|------|-------|----------|
| Basic | $12/vehicle/mo | GPS, geofencing, mileage, alerts |
| Pro | $18/vehicle/mo | + Maintenance, driver scores, dispatching |
| Business | $25/vehicle/mo | + API, custom reports, priority support |

**Year 1 Targets:**
- 100 customers
- 1,200 vehicles tracked
- $275K revenue (subscription + hardware)

---

### Product 2: Consumer OBD Device

**Target Market:** DIY car owners (25-45 years old) who want to understand their vehicle and avoid dealer upsells

**Value Proposition:** "Know what's wrong. Know what it costs. Know who to trust."

**Competitive Position:**

| Factor | BlueDriver | Torque Pro | Piston |
|--------|------------|------------|--------|
| Price | $99-120 | $5 (app only) | $49-79 |
| Subscription | None | None | None |
| Shop Integration | None | None | **Yes - instant quotes** |
| Target | Pro DIY | Enthusiasts | Mainstream DIY |

**Unique Differentiator:** The ONLY consumer OBD device that connects diagnostic codes to instant repair estimates from trusted local shops.

**Product Flow:**
```
1. Diagnose → OBD2 codes with plain-English explanations
2. Estimate → Real-time repair costs from local shops
3. Connect → Book appointment with verified independent shop
4. Track → Maintenance history synced with shop records
```

**Pricing:**

| SKU | Price | Includes |
|-----|-------|----------|
| Device Only | $49 | Hardware + basic app |
| Device + Pro | $79 | Hardware + all features (lifetime) |
| App Only | Free | Basic diagnostics (BYOD adapter) |

**Revenue Model:**
- Hardware sales: $50 margin/unit
- Shop referral fees: 5% of booked repairs (~$25 average)
- Year 1 target: $375K (5,000 devices + referral fees)

---

### Product 3: Enterprise Fleet SaaS

**Target Market:** Mid-size fleets (50-500 vehicles) looking for enterprise features without enterprise lock-in

**Value Proposition:** "Enterprise-grade fleet tracking at small business prices. No 3-year contracts."

**Competitive Position:**

| Factor | Samsara | Geotab | Piston |
|--------|---------|--------|--------|
| Price | $27-50/vehicle | $30-40/vehicle | $25-35/vehicle |
| Contract | 3 years | 3 years | 12 months |
| Differentiator | AI cameras | Open API | Shop network + flexibility |

**Feature Set:**
- Real-time GPS (30-second refresh)
- Driver behavior scoring with coaching
- Route optimization
- Maintenance scheduling (integrated with shop network)
- ELD compliance (for trucking customers)
- API access for integrations

**Year 1 Targets:**
- 10 enterprise customers
- 500 vehicles
- $90K revenue

---

### Product 4: Insurance Telematics B2B2C

**Target Market:** Regional insurers and MGAs (Managing General Agents) seeking telematics data for usage-based insurance

**Value Proposition:** Unique combination of driving behavior data + maintenance/repair history from shop network

**Partnership Models:**

| Model | Description | Revenue Potential |
|-------|-------------|-------------------|
| Data Licensing | Sell anonymized telematics to insurers | $2-5/vehicle/mo |
| Embedded Insurance | Partner with insurer for "Piston-powered" coverage | 5-15% premium share |
| Risk API | White-label driving score API | Per-query or subscription |

**Unique Data Assets:**
- Driving behavior (speed, braking, acceleration)
- Vehicle health from OBD diagnostics
- Maintenance history from shop network
- Verified repair records

**Year 1 Approach:**
- Phase 1: Enhance data collection for insurance metrics
- Phase 2: Pilot with 2-3 regional insurers
- Target: $25K pilot revenue, foundation for Year 2 scale

---

## Technical Architecture Overview

### Current Infrastructure

```
┌─────────────────────────────────────────────────────────────┐
│                    EXISTING ASSETS                          │
├─────────────────────────────────────────────────────────────┤
│  Teltonika Devices     AWS IoT Core     Shop Network        │
│  (GPS Tracking)        (Data Ingestion)  (1000+ shops)      │
└─────────────────────────────────────────────────────────────┘
```

### Target Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     DATA LAYER                              │
├─────────────────────────────────────────────────────────────┤
│  Teltonika GPS    Consumer OBD    Shop Records    Insurance │
│  (Fleet data)     (Vehicle DTC)   (Repair hist)   (Risk)    │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                   PLATFORM LAYER                            │
├─────────────────────────────────────────────────────────────┤
│  AWS IoT Core → Lambda Processing → DynamoDB/TimeSeries     │
│                                                             │
│  Features: Real-time tracking, geofencing, alerts,          │
│            driver scoring, maintenance scheduling           │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                 APPLICATION LAYER                           │
├─────────────────────────────────────────────────────────────┤
│  Fleet Dashboard    Consumer App    Shop Portal    API      │
│  (Web)              (iOS/Android)   (Web)          (B2B)    │
└─────────────────────────────────────────────────────────────┘
```

### Development Priorities

| Priority | Component | Timeline | Dependencies |
|----------|-----------|----------|--------------|
| P0 | Fleet dashboard MVP | Month 1-2 | Existing Teltonika data |
| P0 | Mobile app (fleet managers) | Month 2-3 | Dashboard API |
| P1 | Consumer OBD app | Month 3-5 | Device sourcing |
| P1 | Shop integration API | Month 4-6 | Shop network data |
| P2 | Enterprise features | Month 6-9 | Fleet MVP proven |
| P3 | Insurance data pipeline | Month 9-12 | Consumer device data |

---

## Go-to-Market Strategy

### Phase 1: Small Fleet Launch (Q1 2025)

**Channels:**
1. **Direct Sales** - Identify 10 pilot customers from shop network relationships
2. **Google Ads** - Target "fleet tracking small business", "[industry] GPS tracking"
3. **Industry Associations** - ACCA (HVAC), PHCC (Plumbing), NALP (Landscaping)

**Launch Milestones:**
- Week 2: MVP dashboard live
- Week 4: 10 pilot customers onboarded
- Week 8: Mobile app released
- Week 12: 100 customers, $15K MRR

### Phase 2: Consumer OBD Launch (Q2 2025)

**Channels:**
1. **Amazon** - Primary retail channel (60% of sales)
2. **Shop Network** - Mechanics recommend to customers
3. **YouTube/Social** - DIY auto repair influencers

**Launch Milestones:**
- Month 4: Hardware sourced, app development complete
- Month 5: Shop integration live with 100 participating shops
- Month 6: Amazon listing live, 500 units/month target

### Phase 3: Enterprise + Insurance (Q3-Q4 2025)

**Enterprise:**
- Dedicated sales hire (Month 7)
- Target 50-500 vehicle fleets
- Lead with case studies from small fleet success

**Insurance:**
- Business development hire (Month 10)
- Target regional insurers first (easier partnership terms)
- Start with fleet insurance segment, expand to consumer

---

## Financial Model

### Revenue Build

| Revenue Stream | Q1 | Q2 | Q3 | Q4 | Year 1 |
|----------------|----|----|----|----|--------|
| Small Fleet Tracking | $18K | $45K | $72K | $81K | $216K |
| Fleet Hardware | $15K | $20K | $12K | $12K | $59K |
| Consumer OBD Device | - | $50K | $125K | $150K | $325K |
| Consumer Shop Referrals | - | $8K | $18K | $24K | $50K |
| Enterprise Fleet SaaS | - | - | $30K | $60K | $90K |
| Insurance Pilot | - | - | - | $25K | $25K |
| **Total** | **$33K** | **$123K** | **$257K** | **$352K** | **$765K** |

### Cost Structure (Year 1)

| Category | Amount | Notes |
|----------|--------|-------|
| Team (5-6 FTEs) | $450K | Dev, product, sales, support |
| Cloud Infrastructure | $36K | AWS/GCP |
| Hardware Inventory | $50K | OBD devices |
| Marketing | $145K | Google, Amazon, trade shows |
| Software/Tools | $25K | Integrations, subscriptions |
| Security/Compliance | $20K | SOC2 prep |
| **Total** | **$726K** |

### Unit Economics

| Metric | Small Fleet | Consumer OBD | Enterprise |
|--------|-------------|--------------|------------|
| CAC | $150/customer | $15/device | $500/customer |
| LTV | $2,160 | $80+ | $10,800 |
| LTV:CAC | 14.4x | 5.3x | 21.6x |
| Gross Margin | 75% | 65% | 80% |

---

## Risk Assessment

### High Impact Risks

| Risk | Probability | Mitigation |
|------|-------------|------------|
| Consumer OBD hardware delays | Medium | Multiple supplier contracts, 3-month buffer |
| Enterprise sales cycle > 6 months | High | Focus on small fleet, build case studies |
| Insurance partnership rejection | Medium | Start with regional insurers, pilot approach |

### Medium Impact Risks

| Risk | Probability | Mitigation |
|------|-------------|------------|
| Price war with budget trackers | Medium | Differentiate on shop network, not price alone |
| Competitor copies shop integration | Medium | Move fast, build network effects |
| Key hire failure | Medium | Contract-to-hire model, backup candidates |

---

## Decision Framework

### Go/No-Go Criteria

**End of Q1:**
- ✅ Proceed if: 50+ paying fleet customers, NPS > 30
- ❌ Pivot if: <25 customers or major product issues

**End of Q2:**
- ✅ Proceed if: 100+ fleet customers, 500+ consumer devices sold
- ❌ Pivot if: Consumer CAC > $40, negative Amazon reviews

**End of Q3:**
- ✅ Proceed if: Enterprise pipeline building, fleet churn < 5%
- ❌ Pivot if: No enterprise interest, consumer returns > 10%

---

## Implementation Handoff

### For Claude Agent Technical Implementation

This section provides the structured data needed to generate detailed technical specifications.

#### Product Specifications to Build

```yaml
products:
  - id: small-fleet-tracking
    priority: P0
    launch: Q1-2025
    type: SaaS
    users: fleet-managers
    features:
      mvp:
        - real-time-gps (30s refresh)
        - geofencing (polygon + radius)
        - speed-alerts
        - mileage-tracking
        - simple-dashboard
        - mobile-app (iOS/Android)
      phase2:
        - driver-scorecards
        - maintenance-reminders
        - fuel-tracking
        - route-history
        - job-dispatching
    integrations:
      - teltonika-fmb-series
      - google-maps-api
      - twilio (sms-alerts)
    pricing:
      basic: 12/vehicle/month
      pro: 18/vehicle/month
      business: 25/vehicle/month

  - id: consumer-obd-device
    priority: P1
    launch: Q2-2025
    type: hardware + mobile-app
    users: car-owners
    features:
      mvp:
        - dtc-reading (all-protocols)
        - plain-english-explanations
        - check-engine-light-diagnosis
        - smog-readiness
        - live-sensor-data
      phase2:
        - instant-repair-estimates
        - shop-finder
        - appointment-booking
        - maintenance-tracking
        - predictive-alerts
    hardware:
      protocols: [CAN, ISO-9141, KWP2000, J1850-PWM, J1850-VPW]
      connectivity: bluetooth-5.0-le
      power: smart-sleep-mode
    integrations:
      - shop-network-api
      - fault-code-database
      - push-notifications

  - id: enterprise-fleet-saas
    priority: P2
    launch: Q3-2025
    type: SaaS
    users: fleet-managers, drivers
    features:
      - all-small-fleet-features
      - eld-compliance
      - advanced-reporting
      - api-access
      - custom-integrations
      - sso/saml
    integrations:
      - quickbooks
      - salesforce
      - custom-api

  - id: insurance-telematics
    priority: P3
    launch: Q4-2025
    type: B2B-data-service
    users: insurance-underwriters
    data-points:
      - driving-behavior-score
      - mileage
      - time-of-day-patterns
      - hard-braking-events
      - acceleration-patterns
      - maintenance-history
      - repair-records
    api:
      - risk-score-endpoint
      - batch-data-export
      - real-time-streaming
```

#### Technical Dependencies

```yaml
infrastructure:
  existing:
    - aws-iot-core (device management)
    - lambda (data processing)
    - dynamodb (device state)
    - api-gateway
  needed:
    - timeseries-db (trip data) # Consider InfluxDB or Timestream
    - mobile-app-backend
    - consumer-device-provisioning
    - shop-integration-api

external-apis:
  - google-maps-platform
  - twilio (sms/push)
  - stripe (billing)
  - amazon-mws (fulfillment)
  - obd-fault-code-database

security:
  - soc2-type2 (target Q4 2025)
  - gdpr-compliance
  - ccpa-compliance
  - data-encryption-at-rest
  - consumer-consent-management
```

#### Team Requirements

```yaml
hiring-plan:
  month-1:
    - full-stack-developer (fleet-dashboard)
    - product-manager (0.5 FTE, can be founder)
  month-3:
    - mobile-developer (iOS/Android)
    - hardware-sourcing (contract)
  month-6:
    - customer-success
  month-7:
    - enterprise-sales
  month-10:
    - business-development (insurance)
```

---

## Appendix: Source Documents

1. [Fleet SaaS Competitive Analysis](./fleet-saas-competitive-analysis.md)
2. [Consumer OBD Market Analysis](./consumer-obd-diagnostic-analysis.md)
3. [Insurance Telematics B2B2C Analysis](./insurance-telematics-b2b2c-analysis.md)
4. [Small Fleet Solutions Analysis](./small-fleet-solutions-analysis.md)
5. [Revenue Timeline & Launch Sequence](./revenue-timeline-launch-sequence.md)

---

*Document prepared by OMNI (Claude Code Agent) | December 2024*
*Research executed after Railway agent infrastructure failure*
