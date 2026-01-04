# Labor Operations Taxonomy
## Piston Labs Service Record Parsing System

**Version:** 1.0
**Created:** 2026-01-04
**Author:** researcher (Agent Coordination Hub)
**Purpose:** LLM-based parsing of concatenated labor narratives into discrete operations

---

## Overview

This taxonomy provides **labor operation verbs** for parsing shop software narratives where multiple operations are concatenated into single lines. Unlike the parts taxonomy (nouns - WHAT was replaced), this covers **actions** (verbs - WHAT WORK was done).

### Sample Input (Single $319.00 Labor Line)
```
CHECK AND ADVISE. TOP OFF COOLANT AND PRESSURE TEST SYSTEM. NO LEAKS FOUND.
RAN ENGINE TO CHECK FOR HYDROCARBONS IN COOLANT. CAR GOT HOT QUICKLY, BUT
THERMOSTAT DID NOT OPEN. DIAGNOSE AND REPLACE BAD THERMOSTAT. RENEW COOLANT.
BLEED SYSTEM. TEST DRIVE AND RE-CHECK. NO OVERHEATING. RUNS FINE.
```

### Expected Output (8 Discrete Operations)
```
1. CHECK AND ADVISE                    → DIAGNOSTIC
2. TOP OFF COOLANT                     → SERVICE
3. PRESSURE TEST SYSTEM                → DIAGNOSTIC
4. CHECK FOR HYDROCARBONS IN COOLANT   → DIAGNOSTIC
5. DIAGNOSE [issue]                    → DIAGNOSTIC
6. REPLACE BAD THERMOSTAT              → REPAIR
7. RENEW COOLANT                       → SERVICE
8. BLEED SYSTEM                        → SERVICE
9. TEST DRIVE                          → VERIFICATION
10. RE-CHECK                           → VERIFICATION
```

Plus 2 non-billable observations:
- "NO LEAKS FOUND" → FINDING
- "NO OVERHEATING. RUNS FINE" → OUTCOME

---

## Schema Definition

```typescript
interface LaborOperation {
  id: string;              // Unique identifier (e.g., "DIAG-CHECK")
  category: LaborCategory; // Operation type
  verb: string;            // Primary action verb
  aliases: string[];       // Alternative phrasings
  pattern: RegExp;         // Regex for extraction
  billable: boolean;       // Whether this is billable labor
  requiresObject: boolean; // Whether it needs a target component
  examples: string[];      // Real-world examples
}

type LaborCategory =
  | 'DIAGNOSTIC'    // Inspection, testing, scanning
  | 'REPAIR'        // Fixing, replacing, rebuilding
  | 'SERVICE'       // Maintenance procedures
  | 'VERIFICATION'  // Post-work confirmation
  | 'FINDING'       // Observations (not billable)
  | 'OUTCOME'       // Result statements (not billable)
```

---

## Category 1: DIAGNOSTIC (Inspection/Testing Work)

Operations that involve checking, testing, or diagnosing issues. Typically the first step in any repair process.

### 1.1 Visual/Physical Inspection

| ID | Verb | Pattern | Aliases | Billable |
|----|------|---------|---------|----------|
| DIAG-CHECK | check | `/\b(CHECK|CHECKED|CHECKING)\b/i` | inspect, look at, examine | Yes |
| DIAG-INSPECT | inspect | `/\b(INSPECT|INSPECTED|INSPECTION)\b/i` | check, examine, look over | Yes |
| DIAG-ADVISE | advise | `/\bADVISE\b/i` | recommend, suggest | Yes |
| DIAG-CHECKADVISE | check and advise | `/\bCHECK\s+AND\s+ADVISE\b/i` | C&A, inspect and advise | Yes |

### 1.2 Diagnostic Testing

| ID | Verb | Pattern | Aliases | Billable |
|----|------|---------|---------|----------|
| DIAG-TEST | test | `/\b(TEST|TESTED|TESTING)\b/i` | check, verify | Yes |
| DIAG-PRESSURE | pressure test | `/\bPRESSURE\s+TEST\b/i` | pressure check, leak test | Yes |
| DIAG-SCAN | scan | `/\b(SCAN|SCANNED|SCANNING)\b/i` | code scan, OBD scan, diagnostic scan | Yes |
| DIAG-CODES | pull codes | `/\b(PULL|READ|CHECK)\s+CODES?\b/i` | read DTCs, check codes | Yes |
| DIAG-DIAG | diagnose | `/\b(DIAGNOSE|DIAGNOSED|DIAGNOSIS)\b/i` | troubleshoot, determine cause | Yes |

### 1.3 Performance Testing

| ID | Verb | Pattern | Aliases | Billable |
|----|------|---------|---------|----------|
| DIAG-RUN | run engine | `/\bRAN?\s+ENGINE\b/i` | start engine, run motor | Yes |
| DIAG-LISTEN | listen | `/\b(LISTEN|LISTENED)\b/i` | hear, auditory check | Yes |
| DIAG-MEASURE | measure | `/\b(MEASURE|MEASURED)\b/i` | check tolerance, gauge | Yes |

---

## Category 2: REPAIR (Fixing/Replacing Components)

Operations that involve fixing, replacing, or rebuilding components. The core billable work.

### 2.1 Replacement

| ID | Verb | Pattern | Aliases | Billable |
|----|------|---------|---------|----------|
| REP-REPLACE | replace | `/\b(REPLACE|REPLACED|REPLACING)\b/i` | install new, swap out, change | Yes |
| REP-INSTALL | install | `/\b(INSTALL|INSTALLED|INSTALLING)\b/i` | put in, mount | Yes |
| REP-REMOVE | remove | `/\b(REMOVE|REMOVED|REMOVING)\b/i` | take out, pull, extract | Yes |
| REP-RENEW | renew | `/\b(RENEW|RENEWED)\b/i` | replace, change out | Yes |

### 2.2 Rebuilding/Repair

| ID | Verb | Pattern | Aliases | Billable |
|----|------|---------|---------|----------|
| REP-REBUILD | rebuild | `/\b(REBUILD|REBUILT|REBUILDING)\b/i` | overhaul, recondition | Yes |
| REP-REPAIR | repair | `/\b(REPAIR|REPAIRED|REPAIRING)\b/i` | fix, mend | Yes |
| REP-RESEAL | reseal | `/\b(RESEAL|RESEALED)\b/i` | replace seals | Yes |
| REP-WELD | weld | `/\b(WELD|WELDED|WELDING)\b/i` | braze, fuse | Yes |
| REP-PATCH | patch | `/\b(PATCH|PATCHED)\b/i` | repair, plug | Yes |

### 2.3 Adjustment

| ID | Verb | Pattern | Aliases | Billable |
|----|------|---------|---------|----------|
| REP-ADJUST | adjust | `/\b(ADJUST|ADJUSTED|ADJUSTING)\b/i` | set, calibrate | Yes |
| REP-ALIGN | align | `/\b(ALIGN|ALIGNED|ALIGNMENT)\b/i` | straighten, true | Yes |
| REP-TIGHTEN | tighten | `/\b(TIGHTEN|TIGHTENED)\b/i` | torque, secure | Yes |

---

## Category 3: SERVICE (Maintenance Procedures)

Routine maintenance operations that don't involve repair or replacement of major components.

### 3.1 Fluid Services

| ID | Verb | Pattern | Aliases | Billable |
|----|------|---------|---------|----------|
| SVC-FLUSH | flush | `/\b(FLUSH|FLUSHED|FLUSHING)\b/i` | drain and fill, power flush | Yes |
| SVC-FILL | fill | `/\b(FILL|FILLED|FILLING)\b/i` | add, refill | Yes |
| SVC-TOPOFF | top off | `/\bTOP\s*(OFF|UP)\b/i` | add fluid, bring to level | Yes |
| SVC-DRAIN | drain | `/\b(DRAIN|DRAINED|DRAINING)\b/i` | empty, evacuate | Yes |
| SVC-BLEED | bleed | `/\b(BLEED|BLED|BLEEDING)\b/i` | purge air, remove air | Yes |

### 3.2 Cleaning/Lubrication

| ID | Verb | Pattern | Aliases | Billable |
|----|------|---------|---------|----------|
| SVC-CLEAN | clean | `/\b(CLEAN|CLEANED|CLEANING)\b/i` | wash, degrease | Yes |
| SVC-LUBE | lubricate | `/\b(LUBRICATE|LUBED|LUBE)\b/i` | grease, oil | Yes |
| SVC-SERVICE | service | `/\b(SERVICE|SERVICED)\b/i` | maintain, perform maintenance | Yes |

### 3.3 Tire Services

| ID | Verb | Pattern | Aliases | Billable |
|----|------|---------|---------|----------|
| SVC-ROTATE | rotate | `/\b(ROTATE|ROTATED)\s*(TIRES?)?\b/i` | tire rotation | Yes |
| SVC-BALANCE | balance | `/\b(BALANCE|BALANCED)\s*(TIRES?|WHEELS?)?\b/i` | wheel balance | Yes |
| SVC-MOUNT | mount | `/\b(MOUNT|MOUNTED)\s*(TIRES?)?\b/i` | install tire | Yes |

---

## Category 4: VERIFICATION (Post-Work Confirmation)

Operations that confirm repairs were successful. Critical for quality assurance.

### 4.1 Road Testing

| ID | Verb | Pattern | Aliases | Billable |
|----|------|---------|---------|----------|
| VER-TESTDRIVE | test drive | `/\bTEST\s*DRIVE\b/i` | road test, drive test | Yes |
| VER-ROADTEST | road test | `/\bROAD\s*TEST\b/i` | test drive | Yes |

### 4.2 Re-inspection

| ID | Verb | Pattern | Aliases | Billable |
|----|------|---------|---------|----------|
| VER-RECHECK | re-check | `/\bRE[\-\s]?CHECK\b/i` | check again, verify | Yes |
| VER-VERIFY | verify | `/\b(VERIFY|VERIFIED)\b/i` | confirm, validate | Yes |
| VER-CONFIRM | confirm | `/\b(CONFIRM|CONFIRMED)\b/i` | verify, validate | Yes |
| VER-REINSPECT | re-inspect | `/\bRE[\-\s]?INSPECT\b/i` | inspect again | Yes |

---

## Category 5: FINDING (Observations - NOT Billable)

Statements about what was found during inspection. Not labor operations themselves.

| ID | Pattern | Examples | Billable |
|----|---------|----------|----------|
| FIND-NOLEAK | `/\bNO\s+LEAKS?\s+(FOUND|DETECTED)\b/i` | "NO LEAKS FOUND" | No |
| FIND-GOOD | `/\b(LOOKS?\s+GOOD|IN\s+GOOD\s+(CONDITION|SHAPE))\b/i` | "LOOKS GOOD" | No |
| FIND-WORN | `/\b(WORN|DAMAGED|CRACKED|LEAKING)\b/i` | "BELT WORN" | No |
| FIND-BAD | `/\b(BAD|FAILED|FAULTY|DEFECTIVE)\b/i` | "THERMOSTAT BAD" | No |

---

## Category 6: OUTCOME (Result Statements - NOT Billable)

Final status statements indicating the result of repairs.

| ID | Pattern | Examples | Billable |
|----|---------|----------|----------|
| OUT-FIXED | `/\b(FIXED|REPAIRED|RESOLVED)\b/i` | "ISSUE FIXED" | No |
| OUT-WORKING | `/\b(WORKS?\s+(FINE|GOOD|PROPERLY)|OPERATING\s+NORMALLY)\b/i` | "RUNS FINE" | No |
| OUT-NOISSUE | `/\bNO\s+(ISSUE|PROBLEM|OVERHEATING|NOISE)\b/i` | "NO OVERHEATING" | No |

---

## Sentence Splitting Rules

For `splitLaborNarrative()` function:

### Primary Delimiters
1. **Period + Space**: `. ` (most common)
2. **Period + Uppercase**: `.\s*[A-Z]`
3. **Compound Connectors**: `AND`, `THEN`, `ALSO`

### Pattern Recognition
```javascript
// Split on periods followed by capital letters or end of string
const sentences = narrative.split(/\.\s+(?=[A-Z])|\.$/);

// Further split compound sentences with AND
const operations = sentences.flatMap(s =>
  s.split(/\s+AND\s+(?=[A-Z])/i)
);
```

### Special Cases
- "CHECK AND ADVISE" = single operation (don't split)
- "DRAIN AND FILL" = single operation
- "TEST DRIVE AND RE-CHECK" = two operations

---

## Integration with Parts Taxonomy

When parsing a labor line:
1. **Extract operation verb** → This taxonomy
2. **Extract target component** → automotive-repair-taxonomy.md
3. **Combine** → Structured record

Example:
```
Input:  "REPLACE BAD THERMOSTAT"
Output: {
  operation: { id: "REP-REPLACE", category: "REPAIR" },
  component: { id: "COOL-THERM", category: "Cooling" }
}
```

---

## Usage Notes

### For LLM Prompts
Include this taxonomy in system prompts for service record parsing. The categories help the model understand what type of work each verb represents.

### For Regex-Based Preprocessing
Use the patterns in `splitLaborNarrative()` to do initial sentence splitting before LLM processing.

### For Cost Allocation
- DIAGNOSTIC + REPAIR + SERVICE + VERIFICATION = Billable labor
- FINDING + OUTCOME = Observations only (no labor charge)

---

## Version History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-01-04 | researcher | Initial taxonomy with 6 categories |
