# Telemetry Architecture for Carfax Acquisition

> Technical blueprint for building acquisition-worthy vehicle telemetry infrastructure

## Executive Summary

This document outlines the database and API architecture needed to make Piston Labs an attractive acquisition target for Carfax. Our core value proposition: **We provide LIVE data to complement Carfax's HISTORICAL data.**

## The Carfax Gap

| What Carfax Has | What They're Missing |
|-----------------|---------------------|
| DMV records | Real-time location |
| Insurance claims | Live vehicle health |
| Service history | Continuous mileage |
| Auction data | Driver behavior |
| Title history | Predictive maintenance |

**Our telemetry fills every gap.**

---

## Recommended Technology Stack

### Data Flow Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Teltonika  │────▶│    Kafka    │────▶│ TimescaleDB │
│   Devices   │     │   Streams   │     │ Time-Series │
└─────────────┘     └─────────────┘     └──────┬──────┘
                                               │
                    ┌─────────────┐            │
                    │ ClickHouse  │◀───────────┘
                    │  Analytics  │
                    └─────────────┘
                           │
                    ┌──────▼──────┐
                    │    Redis    │
                    │    Cache    │
                    └─────────────┘
                           │
                    ┌──────▼──────┐
                    │  Partner    │
                    │    APIs     │
                    └─────────────┘
```

### Component Selection

| Layer | Technology | Why |
|-------|------------|-----|
| **Ingestion** | Apache Kafka | Handles millions of events/sec, exactly-once delivery |
| **Time-Series** | TimescaleDB | PostgreSQL compatible, 94% compression, hypertables |
| **Analytics** | ClickHouse | 100x faster than traditional OLAP, real-time aggregations |
| **Cache** | Redis | Sub-ms VIN lookups, session state |
| **Search** | Elasticsearch | Full-text vehicle search, geospatial queries |

---

## Database Schema

### TimescaleDB (Telemetry Data)

```sql
-- Hypertable for raw telemetry
CREATE TABLE telemetry (
    time        TIMESTAMPTZ NOT NULL,
    device_id   TEXT NOT NULL,
    vin         TEXT,
    lat         DOUBLE PRECISION,
    lng         DOUBLE PRECISION,
    speed_mph   SMALLINT,
    heading     SMALLINT,
    altitude_ft INTEGER,
    odometer    INTEGER,
    fuel_pct    SMALLINT,
    battery_v   REAL,
    dtc_codes   TEXT[],
    raw_data    JSONB
);

SELECT create_hypertable('telemetry', 'time');

-- Continuous aggregate for hourly summaries
CREATE MATERIALIZED VIEW telemetry_hourly
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 hour', time) AS bucket,
    device_id,
    vin,
    AVG(speed_mph) AS avg_speed,
    MAX(odometer) - MIN(odometer) AS miles_driven,
    COUNT(*) AS data_points
FROM telemetry
GROUP BY bucket, device_id, vin;
```

### ClickHouse (Analytics)

```sql
-- Analytical table with MergeTree engine
CREATE TABLE vehicle_analytics (
    date Date,
    vin String,
    total_miles UInt32,
    avg_speed Float32,
    hard_brakes UInt16,
    hard_accels UInt16,
    dtc_count UInt16,
    trip_count UInt16
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(date)
ORDER BY (vin, date);
```

---

## Data Partitioning Strategy

| Tier | Retention | Storage | Compression |
|------|-----------|---------|-------------|
| **Hot** | 7 days | NVMe SSD | None |
| **Warm** | 90 days | SSD | LZ4 |
| **Cold** | 2 years | HDD | ZSTD |
| **Archive** | 10+ years | S3 Glacier | Parquet |

**Estimated Storage (100K devices):**
- Daily ingestion: ~50 GB
- Monthly: ~1.5 TB
- Yearly: ~18 TB (with compression: ~2 TB)

---

## Partner Integration API

### REST Endpoints

```
# Single vehicle telemetry
GET /api/v1/vehicles/{vin}/telemetry?from=2025-12-01&to=2025-12-06

# Bulk vehicle query
POST /api/v1/vehicles/bulk/telemetry
Body: { "vins": ["VIN1", "VIN2", ...], "fields": ["location", "odometer"] }

# Real-time ingestion
POST /api/v1/vehicles/{vin}/telemetry
Body: { "timestamp": "...", "location": {...}, "speed_mph": 45, ... }

# Streaming (WebSocket)
WS /api/v1/stream?partner=carfax&filter=dtc_alerts
```

### Authentication

| Method | Use Case |
|--------|----------|
| OAuth 2.0 | Partner integrations |
| API Keys | Device authentication |
| mTLS | High-security enterprise |
| JWT | Dashboard sessions |

### Rate Limits

| Tier | Requests/sec | Latency SLA | Uptime |
|------|--------------|-------------|--------|
| Standard | 100 | 500ms | 99.5% |
| Premium | 1,000 | 100ms | 99.9% |
| Enterprise | 10,000 | 50ms | 99.99% |

---

## Carfax Integration Points

### 1. VIN Enrichment

```
Carfax Request:
GET /api/v1/vehicles/{vin}/live-status

Response:
{
  "vin": "1HGCM82633A123456",
  "last_seen": "2025-12-06T06:55:00Z",
  "current_odometer": 45632,
  "location": { "lat": 37.7749, "lng": -122.4194, "accuracy_m": 5 },
  "vehicle_health": {
    "battery_voltage": 12.4,
    "active_dtc_codes": ["P0300"],
    "health_score": 82
  },
  "driving_behavior": {
    "avg_speed_7d": 32,
    "hard_brakes_7d": 3,
    "score": 88
  }
}
```

### 2. Mileage Verification

```
Carfax Request:
GET /api/v1/vehicles/{vin}/odometer-history?from=2025-01-01

Response:
{
  "vin": "1HGCM82633A123456",
  "readings": [
    { "date": "2025-01-01", "odometer": 40000, "source": "gps_continuous" },
    { "date": "2025-06-01", "odometer": 43500, "source": "gps_continuous" },
    { "date": "2025-12-06", "odometer": 45632, "source": "gps_continuous" }
  ],
  "anomalies": [],
  "confidence": 0.99
}
```

### 3. Predictive Maintenance

```
Carfax Request:
GET /api/v1/vehicles/{vin}/maintenance-prediction

Response:
{
  "vin": "1HGCM82633A123456",
  "predictions": [
    {
      "component": "battery",
      "risk_level": "medium",
      "estimated_failure": "2026-03-15",
      "confidence": 0.78,
      "evidence": ["low voltage trend", "age 4.2 years"]
    },
    {
      "component": "brakes",
      "risk_level": "low",
      "estimated_failure": "2026-08-01",
      "confidence": 0.65
    }
  ]
}
```

---

## Cost Estimates

### Infrastructure (100K devices)

| Component | Monthly Cost |
|-----------|-------------|
| TimescaleDB Cloud | $1,500 |
| ClickHouse Cloud | $800 |
| Kafka (Confluent) | $500 |
| Redis (Upstash) | $200 |
| AWS (compute, network) | $1,000 |
| **Total** | **$4,000/mo** |

### Scaling Projections

| Devices | Monthly Cost | Cost per Device |
|---------|-------------|-----------------|
| 10K | $1,500 | $0.15 |
| 100K | $4,000 | $0.04 |
| 1M | $25,000 | $0.025 |
| 10M | $150,000 | $0.015 |

---

## Acquisition Value Proposition

### What We Bring to Carfax

1. **Data Completeness** - Real-time layer for their historical database
2. **New Revenue Streams** - Insurance telematics, fleet management, predictive services
3. **Competitive Defense** - Against Tesla, connected car OEMs who have live data
4. **Modern Infrastructure** - Event-driven, cloud-native, API-first architecture

### Integration Timeline

| Phase | Timeline | Deliverable |
|-------|----------|-------------|
| Day 1 | API access | Live telemetry for VIN lookups |
| Week 1 | Data sync | Historical data backfill |
| Month 1 | Dashboard | Dealer-facing predictions |
| Quarter 1 | Product | Insurance telematics offering |
| Year 1 | Full integration | Unified vehicle intelligence platform |

### Valuation Framework

- Data companies: 5-10x revenue
- IoT platforms: 8-15x revenue
- Strategic acquisition premium: +50%

**Target:** $10M ARR → $75-150M acquisition value

---

## Next Steps

1. **Phase 1 (Now):** Build TimescaleDB + Kafka pipeline for current devices
2. **Phase 2 (Month 1):** Add ClickHouse for analytics, partner API
3. **Phase 3 (Month 3):** Predictive maintenance ML models
4. **Phase 4 (Month 6):** Enterprise features, SOC2, Carfax integration demo

---

*Created: December 6, 2025*
*Author: bob (Agent Coordination Hub)*
*For: Carfax Acquisition Strategy*
