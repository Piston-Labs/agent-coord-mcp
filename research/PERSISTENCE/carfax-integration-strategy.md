# Carfax Integration Strategy: Data Ingestion for Acquisition Positioning

> How Piston Labs can consume Carfax data to create compelling acquisition value

---

## Executive Summary

**Goal:** Position Piston Labs as an attractive acquisition target for Carfax/S&P Global Mobility by demonstrating superior data integration capabilities that enhance their existing vehicle history platform with real-time telemetry.

**Key Insight:** Carfax has 35+ billion historical records but lacks real-time telematics data. We have live GPS/OBD telemetry infrastructure. Combined = complete vehicle intelligence platform.

---

## 1. Carfax Data Architecture Analysis

### Data Sources (151,000+)

| Category | Sources | Data Types |
|----------|---------|------------|
| **DMV/Government** | All 50 state DMVs, NMVTIS | Titles, registrations, odometer |
| **Insurance** | Major insurers | Total loss, accident claims |
| **Auctions** | Manheim, Copart, ADESA | Sale history, condition reports |
| **Service Records** | 139,000+ shops | Maintenance, repairs, mileage |
| **Fleet/Rental** | Enterprise, Hertz, etc. | Usage history, lease returns |
| **Manufacturers** | OEM recalls | Recall campaigns, TSBs |

### Data Formats

| Format | Use Case |
|--------|----------|
| **XML** | Legacy FTP submissions |
| **JSON** | Modern API responses |
| **CSV/XLS** | Batch data feeds |
| **Flat File** | Service history reports |

### API Access Model

```
CARFAX API Access Requirements:
1. Service Data Transfer Facilitation Agreement
2. FTP credentials (username/password)
3. Location ID (CARFAX-assigned)
4. Product Data ID (API key equivalent)
5. Partner Name (optional)
```

**Key Limitation:** Carfax APIs are closed. Partners must sign agreements and integrate via proprietary protocols.

---

## 2. Our Data Infrastructure

### Current Telemetry Pipeline

```
Teltonika FMM00A (OBD-II)
    |
    v
Soracom LTE (cellular)
    |
    v
AWS IoT Core (MQTT)
    |
    v
Lambda (parse-teltonika-data)
    |
    +---> S3 (raw archive)
    +---> Supabase (real-time queries)
    +---> TimescaleDB (time-series analytics)
    +---> Redis (hot cache)
```

### Data We Capture (Real-Time)

| Category | Fields |
|----------|--------|
| **Position** | lat, lng, altitude, heading, satellites |
| **Vehicle** | speed, odometer, fuel level, engine RPM, coolant temp |
| **Power** | battery voltage, external voltage, charging state |
| **Status** | ignition, movement, GPS validity |
| **Connectivity** | signal strength, carrier, last seen |

### Data Formats We Support

- **Ingest:** Teltonika Codec 8/8E (binary), JSON, MQTT
- **Store:** JSON (S3), PostgreSQL (Supabase), TimescaleDB
- **Output:** REST API (JSON), real-time WebSocket

---

## 3. Integration Opportunities

### 3.1 Enrich Carfax Reports with Real-Time Data

**Current Carfax Gap:** Reports show historical snapshots but nothing about current vehicle state.

**Our Addition:**

| Carfax Shows | We Add |
|--------------|--------|
| "Last service 6 months ago" | "Current odometer: 45,234 mi" |
| "2 accidents reported" | "Vehicle currently parked, battery healthy" |
| "Title: Clean" | "Real-time location: [map]" |
| "Mileage at last report: 40,000" | "Actual mileage since: +5,234" |

**Value Proposition:** Transform static history reports into living vehicle profiles.

### 3.2 Fraud Detection Enhancement

**Carfax Problem:** Odometer rollback fraud is $1B+/year problem. They detect it by comparing reported mileage across service records.

**Our Solution:**

```
Continuous Odometer Tracking:
- Device reads OBD odometer every 60 seconds
- Stored with GPS timestamp
- Creates unbroken chain of custody
- Impossible to rollback without triggering alert
```

**Integration Pattern:**

```javascript
// Piston Labs API
POST /api/carfax-odometer-verify
{
  "vin": "1HGCM82633A123456",
  "reported_mileage": 45000,
  "report_date": "2025-12-06"
}

// Response
{
  "verified": true,
  "actual_mileage": 45234,
  "confidence": 0.99,
  "last_reading": "2025-12-06T06:00:00Z",
  "history_available_from": "2025-01-15",
  "anomalies_detected": 0
}
```

### 3.3 Service Record Verification

**Carfax Problem:** Shops self-report service records. No verification of actual work.

**Our Solution:**

```
Pre-Service Snapshot:
- Capture all OBD parameters before service
- DTC codes, battery state, sensor readings

Post-Service Comparison:
- Verify DTCs cleared
- Confirm new parameters (oil life reset, etc.)
- Validate work was actually performed
```

### 3.4 Real-Time Alert Integration

**New Capabilities for Carfax Users:**

| Alert Type | Trigger | Action |
|------------|---------|--------|
| Odometer Anomaly | Mileage decreases or jumps | Flag report |
| Location Change | Vehicle moves unexpectedly | Theft alert |
| Battery Critical | Voltage < 11V | Service notification |
| Overheating | Coolant > 105°C | Safety warning |

---

## 4. Technical Integration Design

### 4.1 Data Flow Architecture

```
                    ┌─────────────────┐
                    │   Carfax API    │
                    │  (35B records)  │
                    └────────┬────────┘
                             │
                             v
┌─────────────────────────────────────────────────────┐
│               Piston Labs Substrate                 │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────┐ │
│  │ Telemetry    │  │ VIN Decoder  │  │ Memory    │ │
│  │ Pipeline     │  │ + Enrichment │  │ System    │ │
│  └──────────────┘  └──────────────┘  └───────────┘ │
│                         │                          │
│  ┌──────────────────────┴──────────────────────┐   │
│  │         Unified Vehicle Intelligence         │   │
│  │  - Historical (Carfax)                       │   │
│  │  - Real-time (Piston Telemetry)              │   │
│  │  - Predictive (AI Analysis)                  │   │
│  └──────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
                             │
                             v
                    ┌─────────────────┐
                    │  Enhanced API   │
                    │  (Combined)     │
                    └─────────────────┘
```

### 4.2 VIN-Based Data Linking

```typescript
interface UnifiedVehicleProfile {
  // Core Identifier
  vin: string;

  // From Carfax
  carfax: {
    accidents: number;
    owners: number;
    serviceRecords: number;
    lastReportDate: string;
    titleStatus: string;
    recallStatus: string;
  };

  // From Piston Telemetry
  telemetry: {
    currentOdometer: number;
    currentLocation: { lat: number; lng: number };
    batteryHealth: number;
    lastSeen: string;
    healthScore: number;
    activeAlerts: Alert[];
  };

  // AI-Generated Insights
  insights: {
    predictedMaintenanceNeeds: string[];
    fraudRiskScore: number;
    valueEstimate: number;
    conditionGrade: 'A' | 'B' | 'C' | 'D' | 'F';
  };
}
```

### 4.3 FTP Integration (for Carfax Submission)

```typescript
// Wrapper for CARFAX Service History Reporting
interface CarfaxServiceReport {
  locationId: string;        // CARFAX-assigned
  productDataId: string;     // API key
  repairOrders: RepairOrder[];
}

interface RepairOrder {
  vin: string;
  mileage: number;
  serviceDate: string;
  laborLines: LaborLine[];
  partsLines: PartLine[];
  techNotes?: string;
}

// Our enhancement: attach telemetry snapshot
interface EnhancedRepairOrder extends RepairOrder {
  telemetrySnapshot: {
    preServiceOdometer: number;
    preServiceDTCs: string[];
    postServiceOdometer: number;
    postServiceDTCs: string[];
    verificationStatus: 'verified' | 'anomaly' | 'pending';
  };
}
```

---

## 5. Acquisition Value Proposition

### 5.1 What We Bring to Carfax

| Capability | Current Carfax | With Piston Labs |
|------------|----------------|------------------|
| Data Currency | Days/weeks old | Real-time |
| Odometer Verification | Trust service reports | Continuous tracking |
| Location Intelligence | None | Live GPS |
| Vehicle Health | None | OBD diagnostics |
| Fraud Detection | Pattern matching | Continuous monitoring |
| Alert System | None | Real-time notifications |

### 5.2 Market Size Expansion

**Current Carfax TAM:** Vehicle history reports (~$2B/year)

**Expanded TAM with Telemetry:**
- Connected car services: $50B+ by 2030
- Fleet management: $35B by 2028
- Insurance telematics: $10B by 2027
- Predictive maintenance: $15B by 2028

**Combined:** 10x TAM expansion

### 5.3 Competitive Moat

```
Without Piston Labs:
  Carfax = Historical records (commodity)

With Piston Labs:
  Carfax = Living vehicle intelligence platform (moat)
         = Historical + Real-time + Predictive
         = Only player with complete picture
```

---

## 6. Implementation Roadmap

### Phase 1: Proof of Concept (4 weeks)

1. **Build Carfax API wrapper** using documented patterns
2. **Link our devices to VINs** (already have vehicle info)
3. **Create unified query endpoint** `/api/vehicle-intelligence?vin=XXX`
4. **Demo:** Show Toyota Camry with Carfax history + live telemetry

### Phase 2: Service Record Integration (8 weeks)

1. **Apply for Carfax Service Data Transfer Agreement**
2. **Build FTP submission module** for our service visits
3. **Add pre/post service telemetry snapshots**
4. **Deploy:** Shops using Piston devices submit verified service records

### Phase 3: Enterprise Integration (12 weeks)

1. **Build real-time sync pipeline** to Carfax systems
2. **Implement fraud detection algorithms**
3. **Create dealer dashboard** with combined data
4. **Scale:** 1000+ devices feeding Carfax ecosystem

---

## 7. Key Contacts & Next Steps

### Carfax/S&P Global Mobility

- **Business Development:** Contact via carfaxbig.com
- **Service Shops:** carfaxserviceshops.com
- **Technical Integration:** Requires facilitation agreement

### Immediate Actions

1. **[Tyler]** Contact Carfax BD about partnership/data sharing
2. **[Tech]** Build VIN linking for all fleet devices
3. **[Phil]** Research S&P Global Mobility acquisition history
4. **[Team]** Prepare demo of combined vehicle intelligence

---

## 8. Appendix: Data Format Examples

### Carfax Service Report Format (FTP)

```
HEADER|LOCATION_ID|PRODUCT_DATA_ID|FILE_DATE
RO|VIN|MILEAGE|SERVICE_DATE|TECH_ID
LABOR|LINE_NUM|OP_CODE|DESCRIPTION|HOURS
PART|LINE_NUM|PART_NUM|DESCRIPTION|QTY
```

### Our Telemetry JSON

```json
{
  "imei": "862464068511489",
  "vin": "1HGCM82633A123456",
  "timestamp": "2025-12-06T06:55:00Z",
  "metrics": {
    "batteryVoltage": 12.4,
    "speed": 0,
    "odometer": 45234,
    "fuelLevel": 65,
    "engineRPM": 0,
    "coolantTemp": 21
  },
  "position": {
    "lat": 33.4484,
    "lng": -112.0740,
    "heading": 180
  },
  "status": {
    "ignition": false,
    "movement": false,
    "gpsValid": true
  }
}
```

### Unified API Response

```json
{
  "vin": "1HGCM82633A123456",
  "carfax": {
    "accidents": 0,
    "owners": 2,
    "serviceRecords": 12,
    "lastReportMileage": 44800,
    "lastReportDate": "2025-10-15",
    "titleStatus": "Clean"
  },
  "telemetry": {
    "currentOdometer": 45234,
    "odometerDelta": 434,
    "daysSinceLastReport": 52,
    "avgMilesPerDay": 8.3,
    "currentLocation": {"lat": 33.4484, "lng": -112.0740},
    "batteryHealth": 98,
    "healthScore": 95,
    "lastSeen": "2025-12-06T06:55:00Z"
  },
  "insights": {
    "odometerVerified": true,
    "fraudRisk": 0.02,
    "predictedNextService": "2026-01-15",
    "conditionGrade": "A"
  }
}
```

---

## Sources

- [CARFAX Vehicle History Data Sources](https://www.carfax.com/company/vhr-data-sources)
- [CARFAX API Integration Guide](https://www.vinaudit.com/carfax-api)
- [CARFAX-Wrapper GitHub](https://github.com/amattu2/CARFAX-Wrapper)
- [S&P Global Mobility](https://www.spglobal.com/mobility/en/index.html)
- [CARFAX Canada API Reference](https://apireference.carfax.ca/)
- [Customized Data Feeds](https://www.carfaxbig.com/product/customized-data-feeds/Bank)

---

*Created: December 6, 2025*
*Author: phil*
*Status: Strategic acquisition positioning document*
