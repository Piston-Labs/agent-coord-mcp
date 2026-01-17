# Automotive Repair Taxonomy
## Piston Labs Service Record Parsing System

**Version:** 1.0
**Created:** 2026-01-04
**Author:** researcher (Agent Coordination Hub)
**Purpose:** LLM-based parsing of automotive service records into structured data

---

## Overview

This taxonomy provides **1000+ atomic repair types** organized by service category. Each repair type represents the smallest meaningful unit of work that could appear on a service record.

### Design Principles

1. **Atomic Units**: Split compound repairs into individual components (e.g., "timing belt & water pump" → two separate entries)
2. **Position-Specific**: Include location variants where applicable (front/rear, left/right, driver/passenger)
3. **Alias Support**: Include common alternative names, abbreviations, and invoice terminology
4. **Hierarchical Structure**: Category → Subcategory → Repair Type

### Industry Standards Referenced

- **ASE A1-A9**: Automotive Service Excellence certification categories
- **VMRS**: Vehicle Maintenance Reporting Standards (34,000+ codes for fleet/trucking)
- **Atelio Data**: 7 main categories (Maintenance, Engine, Transmission, Steering, Brakes, Axles, Electronics)

---

## Schema Definition

```typescript
interface RepairType {
  id: string;              // Unique identifier (e.g., "BRK-PAD-FL")
  category: string;        // Top-level category
  subcategory: string;     // Service grouping
  name: string;            // Human-readable name
  aliases: string[];       // Alternative names/abbreviations
  position?: string;       // Location if applicable (front_left, rear_right, etc.)
  component: string;       // Primary component affected
  relatedParts?: string[]; // Commonly replaced together
  intervalMiles?: number;  // Typical service interval
  intervalMonths?: number; // Time-based interval
}
```

---

## Category 1: Brakes (Position-Specific)

### 1.1 Brake Pads

| ID | Name | Position | Aliases |
|----|------|----------|---------|
| BRK-PAD-FL | Replace front left brake pad | front_left | LF brake pad, driver front pad, front left disc pad |
| BRK-PAD-FR | Replace front right brake pad | front_right | RF brake pad, passenger front pad, front right disc pad |
| BRK-PAD-RL | Replace rear left brake pad | rear_left | LR brake pad, driver rear pad, rear left disc pad |
| BRK-PAD-RR | Replace rear right brake pad | rear_right | RR brake pad, passenger rear pad, rear right disc pad |
| BRK-PAD-F | Replace front brake pads (pair) | front | front pads, front disc pads, front axle pads |
| BRK-PAD-R | Replace rear brake pads (pair) | rear | rear pads, rear disc pads, rear axle pads |
| BRK-PAD-ALL | Replace all brake pads | all | complete brake pad set, 4-wheel pads |

### 1.2 Brake Rotors/Discs

| ID | Name | Position | Aliases |
|----|------|----------|---------|
| BRK-ROT-FL | Replace front left brake rotor | front_left | LF rotor, driver front disc, front left disc |
| BRK-ROT-FR | Replace front right brake rotor | front_right | RF rotor, passenger front disc, front right disc |
| BRK-ROT-RL | Replace rear left brake rotor | rear_left | LR rotor, driver rear disc, rear left disc |
| BRK-ROT-RR | Replace rear right brake rotor | rear_right | RR rotor, passenger rear disc, rear right disc |
| BRK-ROT-F | Replace front brake rotors (pair) | front | front rotors, front discs, front axle rotors |
| BRK-ROT-R | Replace rear brake rotors (pair) | rear | rear rotors, rear discs, rear axle rotors |
| BRK-ROT-ALL | Replace all brake rotors | all | complete rotor set, 4-wheel rotors |
| BRK-ROT-MACH-FL | Machine/resurface front left rotor | front_left | turn LF rotor, resurface front left disc |
| BRK-ROT-MACH-FR | Machine/resurface front right rotor | front_right | turn RF rotor, resurface front right disc |
| BRK-ROT-MACH-RL | Machine/resurface rear left rotor | rear_left | turn LR rotor, resurface rear left disc |
| BRK-ROT-MACH-RR | Machine/resurface rear right rotor | rear_right | turn RR rotor, resurface rear right disc |
| BRK-ROT-MACH-F | Machine front rotors (pair) | front | turn front rotors, resurface front discs |
| BRK-ROT-MACH-R | Machine rear rotors (pair) | rear | turn rear rotors, resurface rear discs |

### 1.3 Brake Calipers

| ID | Name | Position | Aliases |
|----|------|----------|---------|
| BRK-CAL-FL | Replace front left brake caliper | front_left | LF caliper, driver front caliper |
| BRK-CAL-FR | Replace front right brake caliper | front_right | RF caliper, passenger front caliper |
| BRK-CAL-RL | Replace rear left brake caliper | rear_left | LR caliper, driver rear caliper |
| BRK-CAL-RR | Replace rear right brake caliper | rear_right | RR caliper, passenger rear caliper |
| BRK-CAL-REB-FL | Rebuild front left brake caliper | front_left | LF caliper rebuild, reseal front left caliper |
| BRK-CAL-REB-FR | Rebuild front right brake caliper | front_right | RF caliper rebuild, reseal front right caliper |
| BRK-CAL-REB-RL | Rebuild rear left brake caliper | rear_left | LR caliper rebuild, reseal rear left caliper |
| BRK-CAL-REB-RR | Rebuild rear right brake caliper | rear_right | RR caliper rebuild, reseal rear right caliper |
| BRK-CAL-SLIDE-FL | Lubricate/service front left caliper slides | front_left | LF caliper slide pins, front left slide service |
| BRK-CAL-SLIDE-FR | Lubricate/service front right caliper slides | front_right | RF caliper slide pins |
| BRK-CAL-SLIDE-RL | Lubricate/service rear left caliper slides | rear_left | LR caliper slide pins |
| BRK-CAL-SLIDE-RR | Lubricate/service rear right caliper slides | rear_right | RR caliper slide pins |

### 1.4 Brake Lines & Hoses

| ID | Name | Position | Aliases |
|----|------|----------|---------|
| BRK-HOSE-FL | Replace front left brake hose | front_left | LF brake line, driver front flex hose |
| BRK-HOSE-FR | Replace front right brake hose | front_right | RF brake line, passenger front flex hose |
| BRK-HOSE-RL | Replace rear left brake hose | rear_left | LR brake line, driver rear flex hose |
| BRK-HOSE-RR | Replace rear right brake hose | rear_right | RR brake line, passenger rear flex hose |
| BRK-LINE-FRONT | Replace front brake line (hard line) | front | front steel line, front brake pipe |
| BRK-LINE-REAR | Replace rear brake line (hard line) | rear | rear steel line, rear brake pipe |
| BRK-LINE-MAIN | Replace main brake line | center | primary brake line, master cylinder line |

### 1.5 Brake Drums & Shoes (Drum Brakes)

| ID | Name | Position | Aliases |
|----|------|----------|---------|
| BRK-SHOE-RL | Replace rear left brake shoes | rear_left | LR brake shoes, driver rear drum shoes |
| BRK-SHOE-RR | Replace rear right brake shoes | rear_right | RR brake shoes, passenger rear drum shoes |
| BRK-SHOE-R | Replace rear brake shoes (pair) | rear | rear shoes, rear drum brakes |
| BRK-DRUM-RL | Replace rear left brake drum | rear_left | LR drum, driver rear drum |
| BRK-DRUM-RR | Replace rear right brake drum | rear_right | RR drum, passenger rear drum |
| BRK-DRUM-R | Replace rear brake drums (pair) | rear | rear drums |
| BRK-DRUM-MACH-RL | Machine rear left drum | rear_left | turn LR drum, resurface rear left drum |
| BRK-DRUM-MACH-RR | Machine rear right drum | rear_right | turn RR drum, resurface rear right drum |
| BRK-HW-RL | Replace rear left brake hardware | rear_left | LR brake springs, rear left return springs |
| BRK-HW-RR | Replace rear right brake hardware | rear_right | RR brake springs, rear right return springs |
| BRK-WHC-RL | Replace rear left wheel cylinder | rear_left | LR wheel cylinder, driver rear cylinder |
| BRK-WHC-RR | Replace rear right wheel cylinder | rear_right | RR wheel cylinder, passenger rear cylinder |

### 1.6 Brake Fluid & Hydraulics

| ID | Name | Aliases |
|----|------|---------|
| BRK-FLUID-FLUSH | Brake fluid flush | brake flush, brake fluid exchange, brake system flush |
| BRK-FLUID-ADD | Add brake fluid | top off brake fluid, brake fluid fill |
| BRK-BLEED-ALL | Bleed all brakes | 4-wheel brake bleed, complete brake bleed |
| BRK-BLEED-FL | Bleed front left brake | LF brake bleed |
| BRK-BLEED-FR | Bleed front right brake | RF brake bleed |
| BRK-BLEED-RL | Bleed rear left brake | LR brake bleed |
| BRK-BLEED-RR | Bleed rear right brake | RR brake bleed |
| BRK-MAST-CYL | Replace brake master cylinder | master cylinder, brake master |
| BRK-MAST-CYL-REB | Rebuild brake master cylinder | master cylinder rebuild, reseal master |
| BRK-BOOST | Replace brake booster | power brake booster, vacuum booster |
| BRK-BOOST-CHECK | Replace brake booster check valve | booster check valve |
| BRK-PROP-VALVE | Replace brake proportioning valve | prop valve, brake bias valve |

### 1.7 ABS System

| ID | Name | Aliases |
|----|------|---------|
| BRK-ABS-MOD | Replace ABS module | ABS control module, anti-lock module |
| BRK-ABS-PUMP | Replace ABS pump | ABS hydraulic unit, ABS pump motor |
| BRK-ABS-SENS-FL | Replace front left ABS sensor | LF wheel speed sensor, front left speed sensor |
| BRK-ABS-SENS-FR | Replace front right ABS sensor | RF wheel speed sensor, front right speed sensor |
| BRK-ABS-SENS-RL | Replace rear left ABS sensor | LR wheel speed sensor, rear left speed sensor |
| BRK-ABS-SENS-RR | Replace rear right ABS sensor | RR wheel speed sensor, rear right speed sensor |
| BRK-ABS-RING-FL | Replace front left ABS tone ring | LF reluctor ring, front left sensor ring |
| BRK-ABS-RING-FR | Replace front right ABS tone ring | RF reluctor ring |
| BRK-ABS-RING-RL | Replace rear left ABS tone ring | LR reluctor ring |
| BRK-ABS-RING-RR | Replace rear right ABS tone ring | RR reluctor ring |
| BRK-ABS-DIAG | ABS system diagnostic | ABS code scan, anti-lock brake diagnosis |

### 1.8 Parking Brake

| ID | Name | Position | Aliases |
|----|------|----------|---------|
| BRK-PARK-CABLE | Replace parking brake cable | center | emergency brake cable, e-brake cable, handbrake cable |
| BRK-PARK-CABLE-L | Replace left parking brake cable | left | driver side e-brake cable |
| BRK-PARK-CABLE-R | Replace right parking brake cable | right | passenger side e-brake cable |
| BRK-PARK-SHOE-L | Replace left parking brake shoe | left | left e-brake shoe |
| BRK-PARK-SHOE-R | Replace right parking brake shoe | right | right e-brake shoe |
| BRK-PARK-ADJ | Adjust parking brake | e-brake adjustment, handbrake adjustment |
| BRK-PARK-LEVER | Replace parking brake lever | handbrake lever, e-brake handle |
| BRK-PARK-PEDAL | Replace parking brake pedal | e-brake pedal assembly |
| BRK-PARK-MOTOR | Replace electric parking brake motor | EPB motor, electronic parking brake actuator |

---

## Category 2: Engine & Oil Service

### 2.1 Oil Change Services

| ID | Name | Aliases | Interval |
|----|------|---------|----------|
| OIL-CONV | Conventional oil change | standard oil change, regular oil change | 3,000 mi |
| OIL-SYNTH-BLEND | Synthetic blend oil change | semi-synthetic oil change | 5,000 mi |
| OIL-FULL-SYNTH | Full synthetic oil change | synthetic oil change | 7,500-10,000 mi |
| OIL-HIGH-MILE | High mileage oil change | high mileage synthetic oil change | 5,000 mi |
| OIL-DIESEL | Diesel oil change | diesel engine oil service | varies |
| OIL-FILTER | Replace oil filter | oil filter change, engine oil filter | with oil change |
| OIL-DRAIN-PLUG | Replace oil drain plug | drain plug replacement | as needed |
| OIL-DRAIN-GASKET | Replace oil drain plug gasket | crush washer, drain plug washer | with oil change |
| OIL-PAN-GASKET | Replace oil pan gasket | oil pan seal | as needed |
| OIL-PAN | Replace oil pan | engine oil pan | as needed |
| OIL-PICKUP-TUBE | Replace oil pickup tube | oil pump pickup, oil strainer | as needed |
| OIL-PUMP | Replace oil pump | engine oil pump | as needed |
| OIL-PRESS-SENS | Replace oil pressure sensor | oil pressure sending unit, oil pressure switch | as needed |
| OIL-PRESS-SWITCH | Replace oil pressure switch | low oil pressure switch | as needed |
| OIL-LEVEL-SENS | Replace oil level sensor | oil level sending unit | as needed |
| OIL-FILLER-CAP | Replace oil filler cap | oil cap | as needed |

### 2.2 Air Filters

| ID | Name | Aliases | Interval |
|----|------|---------|----------|
| AIR-FILTER-ENG | Replace engine air filter | air filter, air cleaner element | 15,000-30,000 mi |
| AIR-FILTER-CAB | Replace cabin air filter | pollen filter, HVAC filter, A/C filter | 15,000-25,000 mi |
| AIR-BOX | Replace air filter box/housing | air cleaner housing, air box | as needed |
| AIR-INTAKE-TUBE | Replace air intake tube | air duct, intake hose | as needed |
| AIR-INTAKE-BOOT | Replace air intake boot | throttle body boot, intake boot | as needed |
| MASS-AIR-FLOW | Replace mass air flow sensor | MAF sensor, air flow meter | as needed |

### 2.3 Fuel Filters

| ID | Name | Aliases | Interval |
|----|------|---------|----------|
| FUEL-FILTER | Replace fuel filter | gas filter, inline fuel filter | 30,000-60,000 mi |
| FUEL-FILTER-DIESEL | Replace diesel fuel filter | diesel filter, fuel/water separator | 15,000-30,000 mi |
| FUEL-FILTER-PRIM | Replace primary fuel filter | pre-filter | diesel |
| FUEL-FILTER-SEC | Replace secondary fuel filter | main fuel filter | diesel |

### 2.4 Belts - Serpentine/Accessory

| ID | Name | Aliases | Interval |
|----|------|---------|----------|
| BELT-SERP | Replace serpentine belt | drive belt, accessory belt, multi-rib belt | 60,000-100,000 mi |
| BELT-TENS | Replace belt tensioner | automatic tensioner, serpentine tensioner | with belt |
| BELT-TENS-PULLEY | Replace tensioner pulley | tensioner idler | with belt |
| BELT-IDLER | Replace idler pulley | accessory idler pulley | with belt |
| BELT-AC | Replace A/C belt | air conditioning belt | if separate |
| BELT-PS | Replace power steering belt | PS belt | if separate |
| BELT-ALT | Replace alternator belt | charging system belt | if separate |

### 2.5 Belts - Timing

| ID | Name | Aliases | Interval |
|----|------|---------|----------|
| BELT-TIMING | Replace timing belt | T-belt, cam belt | 60,000-100,000 mi |
| BELT-TIMING-KIT | Timing belt kit (belt + tensioner + idler) | timing kit | 60,000-100,000 mi |
| BELT-TIMING-FULL | Timing belt + water pump kit | complete timing service | 60,000-100,000 mi |
| BELT-TIMING-TENS | Replace timing belt tensioner | timing tensioner | with belt |
| BELT-TIMING-IDLER | Replace timing belt idler | timing idler pulley | with belt |
| CHAIN-TIMING | Replace timing chain | timing chain kit | 100,000-150,000 mi |
| CHAIN-TIMING-TENS | Replace timing chain tensioner | chain tensioner | with chain |
| CHAIN-TIMING-GUIDE | Replace timing chain guide | chain guide rail | with chain |
| CHAIN-TIMING-GEAR | Replace timing chain sprocket/gear | cam gear, crank gear | with chain |

### 2.6 Spark Plugs & Ignition

| ID | Name | Aliases | Interval |
|----|------|---------|----------|
| SPARK-PLUG-ALL | Replace all spark plugs | plugs, tune-up plugs | 30,000-100,000 mi |
| SPARK-PLUG-1 | Replace spark plug cylinder 1 | #1 plug, cyl 1 spark plug | as needed |
| SPARK-PLUG-2 | Replace spark plug cylinder 2 | #2 plug, cyl 2 spark plug | as needed |
| SPARK-PLUG-3 | Replace spark plug cylinder 3 | #3 plug, cyl 3 spark plug | as needed |
| SPARK-PLUG-4 | Replace spark plug cylinder 4 | #4 plug, cyl 4 spark plug | as needed |
| SPARK-PLUG-5 | Replace spark plug cylinder 5 | #5 plug, cyl 5 spark plug | as needed |
| SPARK-PLUG-6 | Replace spark plug cylinder 6 | #6 plug, cyl 6 spark plug | as needed |
| SPARK-PLUG-7 | Replace spark plug cylinder 7 | #7 plug, cyl 7 spark plug | as needed |
| SPARK-PLUG-8 | Replace spark plug cylinder 8 | #8 plug, cyl 8 spark plug | as needed |
| SPARK-WIRE-SET | Replace spark plug wire set | ignition wires, plug wires | 60,000-100,000 mi |
| SPARK-WIRE-1 | Replace spark plug wire cylinder 1 | #1 wire | as needed |
| SPARK-WIRE-2 | Replace spark plug wire cylinder 2 | #2 wire | as needed |
| SPARK-WIRE-3 | Replace spark plug wire cylinder 3 | #3 wire | as needed |
| SPARK-WIRE-4 | Replace spark plug wire cylinder 4 | #4 wire | as needed |
| SPARK-WIRE-5 | Replace spark plug wire cylinder 5 | #5 wire | as needed |
| SPARK-WIRE-6 | Replace spark plug wire cylinder 6 | #6 wire | as needed |
| SPARK-WIRE-7 | Replace spark plug wire cylinder 7 | #7 wire | as needed |
| SPARK-WIRE-8 | Replace spark plug wire cylinder 8 | #8 wire | as needed |

### 2.7 Ignition Coils

| ID | Name | Aliases |
|----|------|---------|
| COIL-PACK | Replace ignition coil pack | DIS coil, distributor-less coil |
| COIL-COP-1 | Replace coil-on-plug cylinder 1 | COP 1, #1 ignition coil |
| COIL-COP-2 | Replace coil-on-plug cylinder 2 | COP 2, #2 ignition coil |
| COIL-COP-3 | Replace coil-on-plug cylinder 3 | COP 3, #3 ignition coil |
| COIL-COP-4 | Replace coil-on-plug cylinder 4 | COP 4, #4 ignition coil |
| COIL-COP-5 | Replace coil-on-plug cylinder 5 | COP 5, #5 ignition coil |
| COIL-COP-6 | Replace coil-on-plug cylinder 6 | COP 6, #6 ignition coil |
| COIL-COP-7 | Replace coil-on-plug cylinder 7 | COP 7, #7 ignition coil |
| COIL-COP-8 | Replace coil-on-plug cylinder 8 | COP 8, #8 ignition coil |
| COIL-ALL | Replace all ignition coils | complete coil set |
| COIL-BOOT-1 | Replace ignition coil boot cylinder 1 | COP boot 1 |
| COIL-BOOT-2 | Replace ignition coil boot cylinder 2 | COP boot 2 |
| COIL-BOOT-3 | Replace ignition coil boot cylinder 3 | COP boot 3 |
| COIL-BOOT-4 | Replace ignition coil boot cylinder 4 | COP boot 4 |
| COIL-BOOT-5 | Replace ignition coil boot cylinder 5 | COP boot 5 |
| COIL-BOOT-6 | Replace ignition coil boot cylinder 6 | COP boot 6 |
| COIL-BOOT-7 | Replace ignition coil boot cylinder 7 | COP boot 7 |
| COIL-BOOT-8 | Replace ignition coil boot cylinder 8 | COP boot 8 |
| COIL-BOOT-ALL | Replace all ignition coil boots | complete boot set |

### 2.8 Distributor (Older Vehicles)

| ID | Name | Aliases |
|----|------|---------|
| DIST-CAP | Replace distributor cap | dizzy cap |
| DIST-ROTOR | Replace distributor rotor | ignition rotor |
| DIST-ASSY | Replace distributor assembly | complete distributor |
| DIST-PICKUP | Replace distributor pickup coil | reluctor pickup, stator |
| DIST-MODULE | Replace ignition control module | ICM, ignition module |
| DIST-GEAR | Replace distributor drive gear | distributor gear |

### 2.9 Valve Cover & Gaskets

| ID | Name | Aliases |
|----|------|---------|
| VLV-COVER-GASKET | Replace valve cover gasket | rocker cover gasket, cam cover gasket |
| VLV-COVER-GASKET-L | Replace left/driver valve cover gasket | left bank valve cover gasket |
| VLV-COVER-GASKET-R | Replace right/passenger valve cover gasket | right bank valve cover gasket |
| VLV-COVER | Replace valve cover | rocker cover, cam cover |
| VLV-COVER-L | Replace left valve cover | left bank cam cover |
| VLV-COVER-R | Replace right valve cover | right bank cam cover |
| VLV-COVER-GROMMETS | Replace valve cover grommets | spark plug tube seals, plug well gaskets |
| VLV-COVER-BOLT-GROM | Replace valve cover bolt grommets | bolt seals |
| PCV-VALVE | Replace PCV valve | positive crankcase ventilation valve |
| PCV-HOSE | Replace PCV hose | crankcase vent hose |

### 2.10 Engine Gaskets & Seals

| ID | Name | Aliases |
|----|------|---------|
| HEAD-GASKET | Replace head gasket | cylinder head gasket |
| HEAD-GASKET-L | Replace left head gasket | left bank head gasket |
| HEAD-GASKET-R | Replace right head gasket | right bank head gasket |
| INTAKE-GASKET | Replace intake manifold gasket | intake gasket set |
| EXHAUST-GASKET | Replace exhaust manifold gasket | exhaust gasket |
| FRONT-MAIN-SEAL | Replace front main seal | front crankshaft seal, timing cover seal |
| REAR-MAIN-SEAL | Replace rear main seal | rear crankshaft seal |
| CAM-SEAL | Replace camshaft seal | cam oil seal |
| CAM-SEAL-L | Replace left camshaft seal | left bank cam seal |
| CAM-SEAL-R | Replace right camshaft seal | right bank cam seal |
| OIL-COOLER-GASKET | Replace oil cooler gasket | oil cooler O-ring |

### 2.11 Engine Internal

| ID | Name | Aliases |
|----|------|---------|
| ENG-REBUILD | Engine rebuild | engine overhaul |
| ENG-REPLACE | Engine replacement | engine swap, new engine |
| ENG-REPLACE-REMAN | Remanufactured engine installation | reman engine |
| ENG-REPLACE-USED | Used engine installation | junkyard engine, salvage engine |
| PISTON-RINGS | Replace piston rings | ring job |
| ROD-BEARINGS | Replace rod bearings | connecting rod bearings |
| MAIN-BEARINGS | Replace main bearings | crankshaft bearings |
| CAM-BEARINGS | Replace cam bearings | camshaft bearings |
| LIFTERS | Replace lifters | hydraulic lifters, valve lifters, cam followers |
| PUSHRODS | Replace pushrods | valve pushrods |
| ROCKER-ARMS | Replace rocker arms | rockers |
| VALVE-SPRINGS | Replace valve springs | springs |
| VALVES | Replace valves | engine valves |
| VALVE-SEALS | Replace valve stem seals | valve guide seals |
| VALVE-JOB | Valve job | valve grind, head work |
| HEAD-RESURFACE | Resurface cylinder head | mill head, machine head |
| BLOCK-BORE | Bore cylinders | overbore, cylinder hone |
| CRANK-GRIND | Grind crankshaft | crank polish |

### 2.12 Engine Mounts

| ID | Name | Position | Aliases |
|----|------|----------|---------|
| ENG-MOUNT-FRONT | Replace front engine mount | front | front motor mount |
| ENG-MOUNT-REAR | Replace rear engine mount | rear | rear motor mount |
| ENG-MOUNT-LEFT | Replace left engine mount | left | driver side motor mount |
| ENG-MOUNT-RIGHT | Replace right engine mount | right | passenger side motor mount |
| ENG-MOUNT-TOP | Replace top engine mount | top | upper motor mount, torque strut |
| TRANS-MOUNT | Replace transmission mount | - | trans mount, gearbox mount |

---

## Category 3: Cooling System

### 3.1 Radiator

| ID | Name | Aliases |
|----|------|---------|
| RAD-REPLACE | Replace radiator | radiator replacement |
| RAD-FLUSH | Radiator flush | cooling system flush, coolant flush |
| RAD-CAP | Replace radiator cap | pressure cap |
| RAD-FAN-ELEC | Replace electric radiator fan | cooling fan, engine fan |
| RAD-FAN-MOTOR | Replace radiator fan motor | fan motor |
| RAD-FAN-CLUTCH | Replace radiator fan clutch | fan clutch, thermal clutch |
| RAD-FAN-SHROUD | Replace radiator fan shroud | fan shroud |
| RAD-SUPPORT | Replace radiator support | radiator core support |
| RAD-PETCOCK | Replace radiator drain petcock | drain valve |

### 3.2 Hoses

| ID | Name | Aliases |
|----|------|---------|
| HOSE-RAD-UPPER | Replace upper radiator hose | upper hose, top radiator hose |
| HOSE-RAD-LOWER | Replace lower radiator hose | lower hose, bottom radiator hose |
| HOSE-HEATER-IN | Replace heater core inlet hose | heater hose in |
| HOSE-HEATER-OUT | Replace heater core outlet hose | heater hose out |
| HOSE-BYPASS | Replace bypass hose | coolant bypass hose |
| HOSE-OVERFLOW | Replace overflow hose | expansion tank hose |
| HOSE-THERM | Replace thermostat housing hose | thermostat hose |
| HOSE-CLAMP | Replace hose clamp | radiator hose clamp |

### 3.3 Thermostat

| ID | Name | Aliases |
|----|------|---------|
| THERM-REPLACE | Replace thermostat | engine thermostat |
| THERM-HOUSING | Replace thermostat housing | thermostat cover |
| THERM-GASKET | Replace thermostat gasket | thermostat housing gasket |
| THERM-O-RING | Replace thermostat O-ring | thermostat seal |
| THERM-SENSOR | Replace coolant temperature sensor | CTS, engine temp sensor, ECT |

### 3.4 Water Pump

| ID | Name | Aliases |
|----|------|---------|
| WATER-PUMP | Replace water pump | coolant pump |
| WATER-PUMP-GASKET | Replace water pump gasket | water pump seal |
| WATER-PUMP-PULLEY | Replace water pump pulley | WP pulley |
| WATER-PUMP-ELEC | Replace electric water pump | auxiliary water pump |

### 3.5 Coolant/Antifreeze

| ID | Name | Aliases | Interval |
|----|------|---------|----------|
| COOL-FLUSH | Coolant flush/exchange | antifreeze flush, cooling system service | 30,000-50,000 mi |
| COOL-ADD | Add coolant/antifreeze | top off coolant | as needed |
| COOL-DRAIN-REFILL | Drain and refill coolant | coolant change | 30,000-50,000 mi |
| COOL-PRESSURE-TEST | Cooling system pressure test | leak test | diagnostic |
| COOL-RESERVOIR | Replace coolant reservoir | overflow tank, expansion tank |

### 3.6 Heater Core

| ID | Name | Aliases |
|----|------|---------|
| HEATER-CORE | Replace heater core | heater matrix |
| HEATER-VALVE | Replace heater control valve | heater valve |
| HEATER-FLUSH | Heater core flush | heater flush |

### 3.7 Oil Cooler (Engine)

| ID | Name | Aliases |
|----|------|---------|
| OIL-COOLER-ENG | Replace engine oil cooler | oil cooler |
| OIL-COOLER-LINE | Replace oil cooler line | oil cooler hose |
| OIL-COOLER-ADAPTER | Replace oil cooler adapter | oil filter adapter |

---

## Category 4: Electrical System

### 4.1 Battery

| ID | Name | Aliases |
|----|------|---------|
| BATT-REPLACE | Replace battery | new battery, battery replacement |
| BATT-TERMINAL-POS | Replace positive battery terminal | positive cable end |
| BATT-TERMINAL-NEG | Replace negative battery terminal | negative cable end, ground terminal |
| BATT-CABLE-POS | Replace positive battery cable | positive cable |
| BATT-CABLE-NEG | Replace negative battery cable | ground cable, negative cable |
| BATT-TRAY | Replace battery tray | battery box, battery holder |
| BATT-HOLDDOWN | Replace battery hold-down | battery clamp |
| BATT-CLEAN | Clean battery terminals | terminal service |
| BATT-TEST | Battery test | load test, battery health check |

### 4.2 Alternator/Charging

| ID | Name | Aliases |
|----|------|---------|
| ALT-REPLACE | Replace alternator | generator replacement |
| ALT-REBUILD | Rebuild alternator | alternator refurbishment |
| ALT-BELT | Replace alternator belt | charging belt |
| ALT-PULLEY | Replace alternator pulley | alternator clutch pulley, OAD pulley |
| ALT-CONNECTOR | Replace alternator connector | alternator plug |
| CHARGE-WIRE | Replace charging wire | alternator output wire |

### 4.3 Starter

| ID | Name | Aliases |
|----|------|---------|
| START-REPLACE | Replace starter motor | starter replacement |
| START-REBUILD | Rebuild starter motor | starter refurbishment |
| START-SOLENOID | Replace starter solenoid | starter relay |
| START-BENDIX | Replace starter bendix | starter drive gear |
| START-CABLE | Replace starter cable | starter wire |

### 4.4 Fuses & Relays

| ID | Name | Aliases |
|----|------|---------|
| FUSE-REPLACE | Replace fuse | blown fuse |
| FUSE-BOX | Replace fuse box | fuse panel, fuse block |
| RELAY-FUEL-PUMP | Replace fuel pump relay | FP relay |
| RELAY-STARTER | Replace starter relay | crank relay |
| RELAY-AC | Replace A/C compressor relay | A/C relay |
| RELAY-FAN | Replace cooling fan relay | radiator fan relay |
| RELAY-HORN | Replace horn relay | |
| RELAY-HEADLIGHT | Replace headlight relay | |
| RELAY-MAIN | Replace main relay | power relay |

### 4.5 Sensors (Engine)

| ID | Name | Aliases |
|----|------|---------|
| SENS-O2-B1S1 | Replace oxygen sensor bank 1 sensor 1 | upstream O2 bank 1, front O2 sensor B1 |
| SENS-O2-B1S2 | Replace oxygen sensor bank 1 sensor 2 | downstream O2 bank 1, rear O2 sensor B1 |
| SENS-O2-B2S1 | Replace oxygen sensor bank 2 sensor 1 | upstream O2 bank 2, front O2 sensor B2 |
| SENS-O2-B2S2 | Replace oxygen sensor bank 2 sensor 2 | downstream O2 bank 2, rear O2 sensor B2 |
| SENS-CKP | Replace crankshaft position sensor | crank sensor, CKP |
| SENS-CMP | Replace camshaft position sensor | cam sensor, CMP |
| SENS-TPS | Replace throttle position sensor | TPS |
| SENS-MAP | Replace manifold absolute pressure sensor | MAP sensor |
| SENS-IAT | Replace intake air temperature sensor | IAT sensor |
| SENS-ECT | Replace engine coolant temperature sensor | coolant sensor, ECT |
| SENS-KNOCK | Replace knock sensor | detonation sensor |
| SENS-VSS | Replace vehicle speed sensor | VSS, speed sensor |
| SENS-APP | Replace accelerator pedal position sensor | gas pedal sensor, APP |

### 4.6 Computers & Modules

| ID | Name | Aliases |
|----|------|---------|
| ECU-REPLACE | Replace engine control unit | ECM, PCM, engine computer |
| ECU-PROGRAM | Reprogram/flash ECU | ECU update, PCM flash |
| TCM-REPLACE | Replace transmission control module | TCM, trans computer |
| BCM-REPLACE | Replace body control module | BCM |
| ABS-MODULE | Replace ABS control module | ABS computer |
| AIRBAG-MODULE | Replace airbag control module | SRS module |

### 4.7 Wiring

| ID | Name | Aliases |
|----|------|---------|
| WIRE-REPAIR | Wiring repair | electrical repair, wire splice |
| WIRE-HARNESS | Replace wiring harness | loom replacement |
| WIRE-HARNESS-ENG | Replace engine wiring harness | engine loom |
| GROUND-STRAP | Replace ground strap | ground wire, engine ground |
| CONNECTOR-REPAIR | Repair electrical connector | plug repair |

---

## Category 5: HVAC (Heating, Ventilation, Air Conditioning)

### 5.1 A/C Compressor & Components

| ID | Name | Aliases |
|----|------|---------|
| AC-COMPRESSOR | Replace A/C compressor | AC compressor, air conditioning compressor |
| AC-COMPRESSOR-CLUTCH | Replace A/C compressor clutch | clutch only |
| AC-CONDENSER | Replace A/C condenser | AC condenser |
| AC-EVAPORATOR | Replace A/C evaporator | evaporator core |
| AC-EXPANSION-VALVE | Replace expansion valve | TXV, thermal expansion valve |
| AC-ORIFICE-TUBE | Replace orifice tube | fixed orifice |
| AC-DRYER | Replace A/C receiver dryer | accumulator, dryer |
| AC-ACCUMULATOR | Replace A/C accumulator | receiver/dryer |
| AC-HOSE-HIGH | Replace A/C high pressure hose | discharge hose |
| AC-HOSE-LOW | Replace A/C low pressure hose | suction hose |
| AC-HOSE-LIQUID | Replace A/C liquid line | liquid hose |
| AC-O-RING-KIT | Replace A/C O-ring kit | AC seal kit |

### 5.2 A/C Service

| ID | Name | Aliases |
|----|------|---------|
| AC-RECHARGE | A/C recharge | AC top off, refrigerant recharge |
| AC-EVACUATE-RECHARGE | A/C evacuate and recharge | full AC service |
| AC-LEAK-TEST | A/C leak test | AC dye test, UV leak detection |
| AC-FLUSH | A/C system flush | AC flush |
| AC-PERFORMANCE-TEST | A/C performance test | AC vent temp test |

### 5.3 Heating

| ID | Name | Aliases |
|----|------|---------|
| HEATER-CORE | Replace heater core | (duplicate - see Cooling) |
| HEATER-VALVE | Replace heater control valve | |
| BLEND-DOOR-ACT | Replace blend door actuator | temperature door actuator |
| MODE-DOOR-ACT | Replace mode door actuator | vent door actuator |
| RECIRC-DOOR-ACT | Replace recirculation door actuator | fresh air door actuator |

### 5.4 Blower Motor & Controls

| ID | Name | Aliases |
|----|------|---------|
| BLOWER-MOTOR | Replace blower motor | HVAC fan motor, heater fan |
| BLOWER-RESISTOR | Replace blower motor resistor | fan speed resistor |
| BLOWER-REGULATOR | Replace blower motor regulator | blower module |
| BLOWER-WHEEL | Replace blower wheel | fan wheel, squirrel cage |
| HVAC-CONTROL-MOD | Replace HVAC control module | climate control module |
| HVAC-CONTROL-HEAD | Replace HVAC control panel | climate control panel |

### 5.5 Ventilation

| ID | Name | Aliases |
|----|------|---------|
| CABIN-FILTER | Replace cabin air filter | (duplicate - see Filters) |
| DUCT-REPAIR | Repair HVAC duct | duct work |
| VENT-REPLACE | Replace dashboard vent | AC vent, air vent |

---

## Category 6: Exhaust & Emissions

### 6.1 Catalytic Converter

| ID | Name | Aliases |
|----|------|---------|
| CAT-CONV | Replace catalytic converter | cat, catalyst |
| CAT-CONV-FRONT | Replace front catalytic converter | front cat, pre-cat |
| CAT-CONV-REAR | Replace rear catalytic converter | rear cat, underbody cat |
| CAT-CONV-B1 | Replace catalytic converter bank 1 | bank 1 cat |
| CAT-CONV-B2 | Replace catalytic converter bank 2 | bank 2 cat |
| CAT-SHIELD | Replace catalytic converter heat shield | cat shield |

### 6.2 Exhaust Pipes

| ID | Name | Aliases |
|----|------|---------|
| EXH-MANIFOLD | Replace exhaust manifold | exhaust header |
| EXH-MANIFOLD-L | Replace left exhaust manifold | left header, driver side manifold |
| EXH-MANIFOLD-R | Replace right exhaust manifold | right header, passenger side manifold |
| EXH-MANIFOLD-GASKET | Replace exhaust manifold gasket | header gasket |
| EXH-MANIFOLD-GASKET-L | Replace left exhaust manifold gasket | left header gasket |
| EXH-MANIFOLD-GASKET-R | Replace right exhaust manifold gasket | right header gasket |
| EXH-MANIFOLD-STUD | Replace exhaust manifold stud | header stud |
| EXH-DOWNPIPE | Replace downpipe | front pipe, Y-pipe |
| EXH-FLEX-PIPE | Replace flex pipe | exhaust flex joint, flex section |
| EXH-MID-PIPE | Replace mid-pipe | intermediate pipe |
| EXH-TAIL-PIPE | Replace tail pipe | exhaust tip, rear pipe |
| EXH-CROSSOVER | Replace exhaust crossover pipe | H-pipe, X-pipe |

### 6.3 Muffler & Resonator

| ID | Name | Aliases |
|----|------|---------|
| MUFFLER | Replace muffler | silencer |
| MUFFLER-FRONT | Replace front muffler | resonator (some vehicles) |
| MUFFLER-REAR | Replace rear muffler | main muffler |
| RESONATOR | Replace resonator | pre-muffler |

### 6.4 Exhaust Hardware

| ID | Name | Aliases |
|----|------|---------|
| EXH-GASKET | Replace exhaust gasket | pipe gasket, flange gasket |
| EXH-HANGER | Replace exhaust hanger | exhaust mount, rubber isolator |
| EXH-CLAMP | Replace exhaust clamp | pipe clamp, U-clamp |
| EXH-FLANGE | Replace exhaust flange | pipe flange |
| EXH-WELD | Exhaust welding repair | exhaust weld |

### 6.5 Oxygen Sensors

| ID | Name | Aliases |
|----|------|---------|
| O2-B1S1 | Replace O2 sensor bank 1 sensor 1 | upstream O2 B1 |
| O2-B1S2 | Replace O2 sensor bank 1 sensor 2 | downstream O2 B1 |
| O2-B2S1 | Replace O2 sensor bank 2 sensor 1 | upstream O2 B2 |
| O2-B2S2 | Replace O2 sensor bank 2 sensor 2 | downstream O2 B2 |

### 6.6 Emissions Components

| ID | Name | Aliases |
|----|------|---------|
| EGR-VALVE | Replace EGR valve | exhaust gas recirculation valve |
| EGR-COOLER | Replace EGR cooler | EGR heat exchanger |
| EGR-PIPE | Replace EGR pipe/tube | EGR tube |
| EVAP-CANISTER | Replace EVAP canister | charcoal canister, vapor canister |
| EVAP-PURGE-VALVE | Replace EVAP purge valve | canister purge solenoid |
| EVAP-VENT-VALVE | Replace EVAP vent valve | canister vent solenoid |
| EVAP-HOSE | Replace EVAP hose | vapor hose |
| GAS-CAP | Replace gas cap | fuel cap |
| AIR-INJECT-PUMP | Replace secondary air injection pump | smog pump, AIR pump |
| AIR-INJECT-VALVE | Replace secondary air injection valve | check valve |
| PCV-VALVE | Replace PCV valve | (duplicate - see Engine) |

### 6.7 Diesel Emissions

| ID | Name | Aliases |
|----|------|---------|
| DPF-REPLACE | Replace diesel particulate filter | DPF |
| DPF-REGEN | DPF regeneration service | forced regen |
| DPF-CLEAN | DPF cleaning service | DPF flush |
| DEF-TANK | Replace DEF tank | urea tank |
| DEF-INJECTOR | Replace DEF injector | urea injector |
| DEF-PUMP | Replace DEF pump | urea pump |
| DEF-HEATER | Replace DEF heater | urea tank heater |
| SCR-CATALYST | Replace SCR catalyst | selective catalytic reduction |
| DOC-REPLACE | Replace diesel oxidation catalyst | DOC |

---

## Category 7: Fuel System

### 7.1 Fuel Pump

| ID | Name | Aliases |
|----|------|---------|
| FUEL-PUMP | Replace fuel pump | electric fuel pump |
| FUEL-PUMP-ASM | Replace fuel pump assembly | fuel pump module |
| FUEL-PUMP-MECH | Replace mechanical fuel pump | engine fuel pump |
| FUEL-PUMP-RELAY | Replace fuel pump relay | FP relay |
| FUEL-PUMP-DRIVER | Replace fuel pump driver module | FPDM |
| FUEL-SENDER | Replace fuel level sender | fuel gauge sending unit |

### 7.2 Fuel Injectors

| ID | Name | Aliases |
|----|------|---------|
| INJECTOR-ALL | Replace all fuel injectors | injector set |
| INJECTOR-1 | Replace fuel injector cylinder 1 | #1 injector |
| INJECTOR-2 | Replace fuel injector cylinder 2 | #2 injector |
| INJECTOR-3 | Replace fuel injector cylinder 3 | #3 injector |
| INJECTOR-4 | Replace fuel injector cylinder 4 | #4 injector |
| INJECTOR-5 | Replace fuel injector cylinder 5 | #5 injector |
| INJECTOR-6 | Replace fuel injector cylinder 6 | #6 injector |
| INJECTOR-7 | Replace fuel injector cylinder 7 | #7 injector |
| INJECTOR-8 | Replace fuel injector cylinder 8 | #8 injector |
| INJECTOR-CLEAN | Fuel injector cleaning service | injector flush |
| INJECTOR-O-RING | Replace fuel injector O-rings | injector seals |

### 7.3 Fuel Rail & Lines

| ID | Name | Aliases |
|----|------|---------|
| FUEL-RAIL | Replace fuel rail | injector rail |
| FUEL-RAIL-L | Replace left fuel rail | left bank rail |
| FUEL-RAIL-R | Replace right fuel rail | right bank rail |
| FUEL-PRESSURE-REG | Replace fuel pressure regulator | FPR |
| FUEL-LINE-SUPPLY | Replace fuel supply line | feed line |
| FUEL-LINE-RETURN | Replace fuel return line | return hose |
| FUEL-LINE-FILLER | Replace fuel filler neck | filler hose |

### 7.4 Fuel Tank

| ID | Name | Aliases |
|----|------|---------|
| FUEL-TANK | Replace fuel tank | gas tank |
| FUEL-TANK-STRAP | Replace fuel tank strap | tank strap |
| FUEL-TANK-SHIELD | Replace fuel tank heat shield | tank shield |

### 7.5 Carburetor (Older Vehicles)

| ID | Name | Aliases |
|----|------|---------|
| CARB-REBUILD | Rebuild carburetor | carb rebuild kit |
| CARB-REPLACE | Replace carburetor | new carb |
| CARB-ADJUST | Carburetor adjustment | carb tune |
| CARB-CHOKE | Replace choke | automatic choke |
| CARB-FLOAT | Replace carburetor float | float valve |

### 7.6 Throttle Body

| ID | Name | Aliases |
|----|------|---------|
| THROTTLE-BODY | Replace throttle body | TB |
| THROTTLE-BODY-CLEAN | Clean throttle body | TB service |
| THROTTLE-BODY-GASKET | Replace throttle body gasket | TB gasket |
| IAC-VALVE | Replace idle air control valve | IAC |
| THROTTLE-CABLE | Replace throttle cable | accelerator cable |

---

## Category 8: Body & Exterior

### 8.1 Bumpers

| ID | Name | Position | Aliases |
|----|------|----------|---------|
| BUMP-COVER-F | Replace front bumper cover | front | front fascia |
| BUMP-COVER-R | Replace rear bumper cover | rear | rear fascia |
| BUMP-REINF-F | Replace front bumper reinforcement | front | front impact bar |
| BUMP-REINF-R | Replace rear bumper reinforcement | rear | rear impact bar |
| BUMP-ABSORB-F | Replace front bumper absorber | front | front energy absorber |
| BUMP-ABSORB-R | Replace rear bumper absorber | rear | rear energy absorber |
| BUMP-BRACKET-FL | Replace front left bumper bracket | front_left | |
| BUMP-BRACKET-FR | Replace front right bumper bracket | front_right | |
| BUMP-BRACKET-RL | Replace rear left bumper bracket | rear_left | |
| BUMP-BRACKET-RR | Replace rear right bumper bracket | rear_right | |

### 8.2 Fenders & Panels

| ID | Name | Position | Aliases |
|----|------|----------|---------|
| FENDER-L | Replace left fender | left | driver fender, LF fender |
| FENDER-R | Replace right fender | right | passenger fender, RF fender |
| FENDER-LINER-FL | Replace front left fender liner | front_left | LF wheel well liner, splash guard |
| FENDER-LINER-FR | Replace front right fender liner | front_right | RF wheel well liner |
| FENDER-LINER-RL | Replace rear left fender liner | rear_left | LR wheel well liner |
| FENDER-LINER-RR | Replace rear right fender liner | rear_right | RR wheel well liner |
| QTR-PANEL-L | Replace left quarter panel | left | driver quarter |
| QTR-PANEL-R | Replace right quarter panel | right | passenger quarter |
| ROCKER-PANEL-L | Replace left rocker panel | left | driver rocker |
| ROCKER-PANEL-R | Replace right rocker panel | right | passenger rocker |

### 8.3 Doors

| ID | Name | Position | Aliases |
|----|------|----------|---------|
| DOOR-FL | Replace front left door | front_left | driver door |
| DOOR-FR | Replace front right door | front_right | passenger door |
| DOOR-RL | Replace rear left door | rear_left | left rear door |
| DOOR-RR | Replace rear right door | rear_right | right rear door |
| DOOR-HANDLE-EXT-FL | Replace front left exterior door handle | front_left | |
| DOOR-HANDLE-EXT-FR | Replace front right exterior door handle | front_right | |
| DOOR-HANDLE-EXT-RL | Replace rear left exterior door handle | rear_left | |
| DOOR-HANDLE-EXT-RR | Replace rear right exterior door handle | rear_right | |
| DOOR-HANDLE-INT-FL | Replace front left interior door handle | front_left | |
| DOOR-HANDLE-INT-FR | Replace front right interior door handle | front_right | |
| DOOR-HANDLE-INT-RL | Replace rear left interior door handle | rear_left | |
| DOOR-HANDLE-INT-RR | Replace rear right interior door handle | rear_right | |
| DOOR-HINGE-FL-UP | Replace front left upper door hinge | front_left | |
| DOOR-HINGE-FL-LO | Replace front left lower door hinge | front_left | |
| DOOR-HINGE-FR-UP | Replace front right upper door hinge | front_right | |
| DOOR-HINGE-FR-LO | Replace front right lower door hinge | front_right | |
| DOOR-LATCH-FL | Replace front left door latch | front_left | |
| DOOR-LATCH-FR | Replace front right door latch | front_right | |
| DOOR-LATCH-RL | Replace rear left door latch | rear_left | |
| DOOR-LATCH-RR | Replace rear right door latch | rear_right | |
| DOOR-CHECK-FL | Replace front left door check | front_left | door stop |
| DOOR-CHECK-FR | Replace front right door check | front_right | |
| DOOR-CHECK-RL | Replace rear left door check | rear_left | |
| DOOR-CHECK-RR | Replace rear right door check | rear_right | |

### 8.4 Hood & Trunk

| ID | Name | Aliases |
|----|------|---------|
| HOOD | Replace hood | bonnet |
| HOOD-HINGE-L | Replace left hood hinge | |
| HOOD-HINGE-R | Replace right hood hinge | |
| HOOD-LATCH | Replace hood latch | hood lock |
| HOOD-RELEASE | Replace hood release cable | hood cable |
| HOOD-STRUT-L | Replace left hood strut | hood support |
| HOOD-STRUT-R | Replace right hood strut | |
| TRUNK-LID | Replace trunk lid | decklid, boot lid |
| TRUNK-HINGE-L | Replace left trunk hinge | |
| TRUNK-HINGE-R | Replace right trunk hinge | |
| TRUNK-LATCH | Replace trunk latch | trunk lock |
| TRUNK-STRUT-L | Replace left trunk strut | |
| TRUNK-STRUT-R | Replace right trunk strut | |
| TRUNK-RELEASE | Replace trunk release | trunk cable |
| TAILGATE | Replace tailgate | liftgate, hatch |
| TAILGATE-STRUT-L | Replace left tailgate strut | hatch strut |
| TAILGATE-STRUT-R | Replace right tailgate strut | |

### 8.5 Glass

| ID | Name | Position | Aliases |
|----|------|----------|---------|
| GLASS-WIND | Replace windshield | - | front glass |
| GLASS-WIND-REPAIR | Repair windshield chip/crack | - | windshield patch |
| GLASS-REAR | Replace rear window | - | back glass, rear windshield |
| GLASS-DOOR-FL | Replace front left door glass | front_left | driver window |
| GLASS-DOOR-FR | Replace front right door glass | front_right | passenger window |
| GLASS-DOOR-RL | Replace rear left door glass | rear_left | |
| GLASS-DOOR-RR | Replace rear right door glass | rear_right | |
| GLASS-QTR-L | Replace left quarter glass | left | |
| GLASS-QTR-R | Replace right quarter glass | right | |
| GLASS-VENT-FL | Replace front left vent glass | front_left | |
| GLASS-VENT-FR | Replace front right vent glass | front_right | |
| GLASS-SUNROOF | Replace sunroof glass | moonroof glass |

### 8.6 Mirrors

| ID | Name | Position | Aliases |
|----|------|----------|---------|
| MIRROR-L | Replace left side mirror | left | driver mirror |
| MIRROR-R | Replace right side mirror | right | passenger mirror |
| MIRROR-GLASS-L | Replace left mirror glass only | left | |
| MIRROR-GLASS-R | Replace right mirror glass only | right | |
| MIRROR-MOTOR-L | Replace left mirror motor | left | power mirror actuator |
| MIRROR-MOTOR-R | Replace right mirror motor | right | |
| MIRROR-COVER-L | Replace left mirror cover | left | mirror cap |
| MIRROR-COVER-R | Replace right mirror cover | right | |
| MIRROR-REAR | Replace rearview mirror | - | interior mirror |

### 8.7 Lights

| ID | Name | Position | Aliases |
|----|------|----------|---------|
| LIGHT-HEAD-L | Replace left headlight assembly | left | driver headlight |
| LIGHT-HEAD-R | Replace right headlight assembly | right | passenger headlight |
| LIGHT-HEAD-BULB-L | Replace left headlight bulb | left | |
| LIGHT-HEAD-BULB-R | Replace right headlight bulb | right | |
| LIGHT-HEAD-LOW-L | Replace left low beam bulb | left | |
| LIGHT-HEAD-LOW-R | Replace right low beam bulb | right | |
| LIGHT-HEAD-HIGH-L | Replace left high beam bulb | left | |
| LIGHT-HEAD-HIGH-R | Replace right high beam bulb | right | |
| LIGHT-TAIL-L | Replace left tail light assembly | left | driver tail light |
| LIGHT-TAIL-R | Replace right tail light assembly | right | passenger tail light |
| LIGHT-TAIL-BULB-L | Replace left tail light bulb | left | |
| LIGHT-TAIL-BULB-R | Replace right tail light bulb | right | |
| LIGHT-BRAKE-L | Replace left brake light bulb | left | |
| LIGHT-BRAKE-R | Replace right brake light bulb | right | |
| LIGHT-BRAKE-3RD | Replace third brake light | center | high mount stop lamp, CHMSL |
| LIGHT-TURN-FL | Replace front left turn signal bulb | front_left | |
| LIGHT-TURN-FR | Replace front right turn signal bulb | front_right | |
| LIGHT-TURN-RL | Replace rear left turn signal bulb | rear_left | |
| LIGHT-TURN-RR | Replace rear right turn signal bulb | rear_right | |
| LIGHT-FOG-L | Replace left fog light | left | |
| LIGHT-FOG-R | Replace right fog light | right | |
| LIGHT-FOG-BULB-L | Replace left fog light bulb | left | |
| LIGHT-FOG-BULB-R | Replace right fog light bulb | right | |
| LIGHT-REVERSE-L | Replace left reverse light bulb | left | backup light |
| LIGHT-REVERSE-R | Replace right reverse light bulb | right | |
| LIGHT-LICENSE | Replace license plate light | rear | |
| LIGHT-MARKER-FL | Replace front left marker light | front_left | side marker |
| LIGHT-MARKER-FR | Replace front right marker light | front_right | |
| LIGHT-MARKER-RL | Replace rear left marker light | rear_left | |
| LIGHT-MARKER-RR | Replace rear right marker light | rear_right | |

### 8.8 Wipers

| ID | Name | Position | Aliases |
|----|------|----------|---------|
| WIPER-BLADE-L | Replace left wiper blade | left | driver wiper |
| WIPER-BLADE-R | Replace right wiper blade | right | passenger wiper |
| WIPER-BLADE-REAR | Replace rear wiper blade | rear | |
| WIPER-ARM-L | Replace left wiper arm | left | |
| WIPER-ARM-R | Replace right wiper arm | right | |
| WIPER-ARM-REAR | Replace rear wiper arm | rear | |
| WIPER-MOTOR | Replace windshield wiper motor | front | |
| WIPER-MOTOR-REAR | Replace rear wiper motor | rear | |
| WIPER-LINKAGE | Replace wiper linkage | - | wiper transmission |
| WIPER-SWITCH | Replace wiper switch | - | wiper stalk |
| WASHER-PUMP | Replace washer pump | - | washer motor |
| WASHER-RESERVOIR | Replace washer fluid reservoir | - | washer tank |
| WASHER-NOZZLE | Replace washer nozzle | - | washer jet |

### 8.9 Paint & Dent Repair

| ID | Name | Aliases |
|----|------|---------|
| PAINT-TOUCH-UP | Touch-up paint | spot paint |
| PAINT-PANEL | Paint single panel | panel respray |
| PAINT-BLEND | Paint blend | color blend |
| PAINT-FULL | Full repaint | complete respray |
| PAINT-CLEAR | Clear coat repair | clear coat respray |
| DENT-PDR | Paintless dent repair | PDR |
| DENT-FILL | Dent repair with body filler | bondo repair |
| SCRATCH-BUFF | Scratch buffing | scratch polish |
| SCRATCH-COMPOUND | Scratch compound repair | rubbing compound |

---

## Category 9: Interior

### 9.1 Seats

| ID | Name | Position | Aliases |
|----|------|----------|---------|
| SEAT-FL | Replace front left seat | front_left | driver seat |
| SEAT-FR | Replace front right seat | front_right | passenger seat |
| SEAT-RL | Replace rear left seat | rear_left | |
| SEAT-RR | Replace rear right seat | rear_right | |
| SEAT-REAR | Replace rear seat (bench) | rear | back seat |
| SEAT-COVER-FL | Replace front left seat cover | front_left | |
| SEAT-COVER-FR | Replace front right seat cover | front_right | |
| SEAT-FOAM-FL | Replace front left seat foam | front_left | seat cushion |
| SEAT-FOAM-FR | Replace front right seat foam | front_right | |
| SEAT-FRAME-FL | Repair front left seat frame | front_left | seat weld |
| SEAT-FRAME-FR | Repair front right seat frame | front_right | |
| SEAT-TRACK-FL | Replace front left seat track | front_left | seat rail |
| SEAT-TRACK-FR | Replace front right seat track | front_right | |
| SEAT-MOTOR-FL | Replace front left seat motor | front_left | power seat motor |
| SEAT-MOTOR-FR | Replace front right seat motor | front_right | |
| SEAT-HEATER-FL | Replace front left seat heater | front_left | heated seat element |
| SEAT-HEATER-FR | Replace front right seat heater | front_right | |
| SEAT-BELT-FL | Replace front left seat belt | front_left | driver seat belt |
| SEAT-BELT-FR | Replace front right seat belt | front_right | |
| SEAT-BELT-RL | Replace rear left seat belt | rear_left | |
| SEAT-BELT-RR | Replace rear right seat belt | rear_right | |
| SEAT-BELT-RC | Replace rear center seat belt | rear_center | |
| SEAT-BELT-BUCK-FL | Replace front left seat belt buckle | front_left | |
| SEAT-BELT-BUCK-FR | Replace front right seat belt buckle | front_right | |
| SEAT-BELT-RETRACT-FL | Replace front left seat belt retractor | front_left | |
| SEAT-BELT-RETRACT-FR | Replace front right seat belt retractor | front_right | |

### 9.2 Dashboard

| ID | Name | Aliases |
|----|------|---------|
| DASH-PAD | Replace dashboard pad | dash cover, dash top |
| DASH-ASSY | Replace dashboard assembly | dash |
| DASH-CRACK-REPAIR | Repair dashboard crack | dash repair |
| GAUGE-CLUSTER | Replace instrument cluster | gauge cluster, speedometer |
| SPEEDO-CABLE | Replace speedometer cable | |
| TACH | Replace tachometer | |
| GAUGE-FUEL | Replace fuel gauge | gas gauge |
| GAUGE-TEMP | Replace temperature gauge | |
| GAUGE-OIL | Replace oil pressure gauge | |
| GAUGE-VOLT | Replace voltmeter | voltage gauge |
| GLOVE-BOX-DOOR | Replace glove box door | glove compartment |
| GLOVE-BOX-LATCH | Replace glove box latch | |
| GLOVE-BOX-HINGE | Replace glove box hinge | |
| GLOVE-BOX-LIGHT | Replace glove box light | |

### 9.3 Center Console

| ID | Name | Aliases |
|----|------|---------|
| CONSOLE-LID | Replace center console lid | armrest lid |
| CONSOLE-HINGE | Replace console lid hinge | |
| SHIFTER-KNOB | Replace shifter knob | gear knob |
| SHIFTER-BOOT | Replace shifter boot | shift boot |
| CUPHOLDER | Replace cup holder | |
| ARMREST-CENTER | Replace center armrest | |

### 9.4 Door Panels & Trim

| ID | Name | Position | Aliases |
|----|------|----------|---------|
| DOOR-PANEL-FL | Replace front left door panel | front_left | driver door card |
| DOOR-PANEL-FR | Replace front right door panel | front_right | |
| DOOR-PANEL-RL | Replace rear left door panel | rear_left | |
| DOOR-PANEL-RR | Replace rear right door panel | rear_right | |
| ARMREST-DOOR-FL | Replace front left door armrest | front_left | |
| ARMREST-DOOR-FR | Replace front right door armrest | front_right | |
| ARMREST-DOOR-RL | Replace rear left door armrest | rear_left | |
| ARMREST-DOOR-RR | Replace rear right door armrest | rear_right | |
| TRIM-A-PILLAR-L | Replace left A-pillar trim | left | |
| TRIM-A-PILLAR-R | Replace right A-pillar trim | right | |
| TRIM-B-PILLAR-L | Replace left B-pillar trim | left | |
| TRIM-B-PILLAR-R | Replace right B-pillar trim | right | |
| TRIM-C-PILLAR-L | Replace left C-pillar trim | left | |
| TRIM-C-PILLAR-R | Replace right C-pillar trim | right | |
| TRIM-KICK-PANEL-L | Replace left kick panel | left | |
| TRIM-KICK-PANEL-R | Replace right kick panel | right | |

### 9.5 Headliner & Carpet

| ID | Name | Aliases |
|----|------|---------|
| HEADLINER | Replace headliner | roof liner |
| HEADLINER-SAG | Repair sagging headliner | headliner reglue |
| CARPET-FRONT | Replace front carpet | floor carpet |
| CARPET-REAR | Replace rear carpet | |
| CARPET-TRUNK | Replace trunk carpet | cargo carpet |
| FLOOR-MAT-FL | Replace front left floor mat | driver floor mat |
| FLOOR-MAT-FR | Replace front right floor mat | |
| FLOOR-MAT-RL | Replace rear left floor mat | |
| FLOOR-MAT-RR | Replace rear right floor mat | |
| FLOOR-MAT-SET | Replace floor mat set | |
| CARGO-MAT | Replace cargo mat | trunk mat |

### 9.6 Steering Wheel & Column

| ID | Name | Aliases |
|----|------|---------|
| STEER-WHEEL | Replace steering wheel | |
| STEER-WHEEL-COVER | Replace steering wheel cover | |
| STEER-COLUMN | Replace steering column | |
| STEER-COLUMN-COVER | Replace steering column covers | column shroud |
| STEER-LOCK | Replace steering lock | ignition lock |
| STEER-TILT-MECH | Repair tilt mechanism | tilt column |
| STEER-CLOCK-SPRING | Replace clock spring | spiral cable |

### 9.7 Pedals

| ID | Name | Aliases |
|----|------|---------|
| PEDAL-GAS | Replace gas pedal | accelerator pedal |
| PEDAL-BRAKE | Replace brake pedal | |
| PEDAL-CLUTCH | Replace clutch pedal | |
| PEDAL-PARKING | Replace parking brake pedal | |
| PEDAL-PAD-GAS | Replace gas pedal pad | |
| PEDAL-PAD-BRAKE | Replace brake pedal pad | |
| PEDAL-PAD-CLUTCH | Replace clutch pedal pad | |

### 9.8 Window Regulators & Motors

| ID | Name | Position | Aliases |
|----|------|----------|---------|
| WIN-REG-FL | Replace front left window regulator | front_left | driver window regulator |
| WIN-REG-FR | Replace front right window regulator | front_right | |
| WIN-REG-RL | Replace rear left window regulator | rear_left | |
| WIN-REG-RR | Replace rear right window regulator | rear_right | |
| WIN-MOTOR-FL | Replace front left window motor | front_left | driver window motor |
| WIN-MOTOR-FR | Replace front right window motor | front_right | |
| WIN-MOTOR-RL | Replace rear left window motor | rear_left | |
| WIN-MOTOR-RR | Replace rear right window motor | rear_right | |
| WIN-SWITCH-FL | Replace front left window switch | front_left | driver master switch |
| WIN-SWITCH-FR | Replace front right window switch | front_right | |
| WIN-SWITCH-RL | Replace rear left window switch | rear_left | |
| WIN-SWITCH-RR | Replace rear right window switch | rear_right | |

### 9.9 Door Locks

| ID | Name | Position | Aliases |
|----|------|----------|---------|
| LOCK-ACT-FL | Replace front left door lock actuator | front_left | driver lock motor |
| LOCK-ACT-FR | Replace front right door lock actuator | front_right | |
| LOCK-ACT-RL | Replace rear left door lock actuator | rear_left | |
| LOCK-ACT-RR | Replace rear right door lock actuator | rear_right | |
| LOCK-CYL-FL | Replace front left door lock cylinder | front_left | driver key lock |
| LOCK-CYL-FR | Replace front right door lock cylinder | front_right | |
| LOCK-CYL-TRUNK | Replace trunk lock cylinder | rear | |
| LOCK-IGNITION | Replace ignition lock cylinder | - | key cylinder |

---

## Category 10: Fluids & Maintenance

### 10.1 Fluid Services

| ID | Name | Aliases | Interval |
|----|------|---------|----------|
| FLUID-OIL | Oil change | (see Category 2) | 3,000-10,000 mi |
| FLUID-TRANS | Transmission fluid change | ATF change, trans service | 30,000-60,000 mi |
| FLUID-TRANS-FLUSH | Transmission flush | ATF flush | 60,000-100,000 mi |
| FLUID-BRAKE | Brake fluid flush | (see Category 1) | 30,000 mi / 2 yr |
| FLUID-COOLANT | Coolant flush | (see Category 3) | 30,000-50,000 mi |
| FLUID-PS | Power steering fluid flush | PS flush | 50,000-100,000 mi |
| FLUID-PS-ADD | Add power steering fluid | PS top off | as needed |
| FLUID-DIFF-FRONT | Replace front differential fluid | front diff service | 30,000-60,000 mi |
| FLUID-DIFF-REAR | Replace rear differential fluid | rear diff service | 30,000-60,000 mi |
| FLUID-TRANSFER | Replace transfer case fluid | T-case fluid | 30,000-60,000 mi |
| FLUID-WASHER | Refill washer fluid | washer fluid top off | as needed |
| FLUID-WASHER-ADD | Add washer fluid additive | washer de-icer | seasonal |

### 10.2 Inspections

| ID | Name | Aliases |
|----|------|---------|
| INSP-MULTI | Multi-point inspection | vehicle inspection |
| INSP-PRE-PURCHASE | Pre-purchase inspection | PPI, used car inspection |
| INSP-SAFETY | Safety inspection | state inspection |
| INSP-EMISSIONS | Emissions inspection | smog check |
| INSP-BRAKE | Brake inspection | |
| INSP-TIRE | Tire inspection | |
| INSP-COOLING | Cooling system inspection | |
| INSP-BELT | Belt inspection | |
| INSP-FLUID | Fluid level check | |
| INSP-LIGHT | Light inspection | bulb check |
| INSP-BATTERY | Battery inspection | battery test |

### 10.3 Tune-Up Services

| ID | Name | Aliases |
|----|------|---------|
| TUNE-MINOR | Minor tune-up | basic tune-up |
| TUNE-MAJOR | Major tune-up | complete tune-up |
| TUNE-30K | 30,000 mile service | 30K service |
| TUNE-60K | 60,000 mile service | 60K service |
| TUNE-90K | 90,000 mile service | 90K service |
| TUNE-100K | 100,000 mile service | 100K service |

### 10.4 Diagnostic Services

| ID | Name | Aliases |
|----|------|---------|
| DIAG-ENG | Engine diagnostic | check engine light diagnosis |
| DIAG-TRANS | Transmission diagnostic | |
| DIAG-ELEC | Electrical diagnostic | |
| DIAG-AC | A/C diagnostic | |
| DIAG-BRAKE | Brake diagnostic | |
| DIAG-NOISE | Noise diagnostic | NVH diagnosis |
| DIAG-DRIVABILITY | Drivability diagnostic | |
| DIAG-CODE-READ | Code scan/read | OBD2 scan |
| DIAG-CODE-CLEAR | Clear diagnostic codes | reset codes |

---

## Category 11: Tires & Wheels (Phil's Section - Placeholder)

*Delegated to agent Phil - to be merged*

Expected subcategories:
- Tire replacement (position-specific)
- Tire rotation patterns
- Tire balancing
- Wheel alignment
- TPMS sensors
- Wheel repair/replacement
- Lug nuts/studs

---

## Category 12: Suspension & Steering (Phil's Section - Placeholder)

*Delegated to agent Phil - to be merged*

Expected subcategories:
- Shocks/Struts (position-specific)
- Control arms (position-specific)
- Ball joints
- Tie rods
- Sway bar components
- Wheel bearings/hubs
- Steering rack/gear
- Power steering components

---

## Category 13: Transmission & Drivetrain (Phil's Section - Placeholder)

*Delegated to agent Phil - to be merged*

Expected subcategories:
- Automatic transmission
- Manual transmission
- Clutch components
- Torque converter
- Differential (front/rear)
- Driveshaft/CV axles
- Transfer case
- U-joints

---

## Summary Statistics

| Category | Repair Types |
|----------|--------------|
| Brakes | ~115 |
| Engine & Oil | ~140 |
| Cooling System | ~45 |
| Electrical | ~75 |
| HVAC | ~35 |
| Exhaust & Emissions | ~65 |
| Fuel System | ~50 |
| Body & Exterior | ~140 |
| Interior | ~120 |
| Fluids & Maintenance | ~40 |
| Tires & Wheels (pending) | ~80 est |
| Suspension & Steering (pending) | ~100 est |
| Transmission & Drivetrain (pending) | ~80 est |
| **Total** | **~1,085** |

---

## Implementation Notes for LLM Parsing

### Parsing Strategy

1. **Tokenize invoice line items** into normalized phrases
2. **Match against aliases** using fuzzy matching (Levenshtein distance < 3)
3. **Extract position indicators** from context:
   - "LF", "RF", "LR", "RR" → front_left, front_right, rear_left, rear_right
   - "driver", "passenger" → left (US), right (US)
   - "front", "rear", "left", "right"
4. **Split compound repairs**: "front brakes" → [BRK-PAD-F, BRK-ROT-F]
5. **Handle abbreviations**: "w/p" → water pump, "a/c" → air conditioning

### Common Invoice Patterns

```
"Oil change w/filter" → [OIL-FULL-SYNTH, OIL-FILTER]
"Front brake job" → [BRK-PAD-F, BRK-ROT-MACH-F or BRK-ROT-F]
"Timing belt service" → [BELT-TIMING-FULL]
"60K service" → [TUNE-60K] + individual items
"Replace LF strut" → [SUSP-STRUT-FL]
```

### Position Mapping

| Abbreviation | Position Code | Notes |
|--------------|---------------|-------|
| LF, FL, D/S Front | front_left | US driver side |
| RF, FR, P/S Front | front_right | US passenger side |
| LR, RL, D/S Rear | rear_left | |
| RR, P/S Rear | rear_right | |
| Front | front | Both front positions |
| Rear | rear | Both rear positions |
| Left | left | Both left positions |
| Right | right | Both right positions |
| Bank 1 | bank_1 | Usually driver side V6/V8 |
| Bank 2 | bank_2 | Usually passenger side V6/V8 |

---

## Sources

- [ASE Certification Categories](https://www.ase.com/test-series)
- [VMRS Overview - Technology & Maintenance Council](https://tmc.trucking.org/VMRS-Overview)
- [Atelio Data Categories](https://www.infopro-digital-automotive.com/atelio-data/)
- [Firestone Auto Care Services](https://www.firestonecompleteautocare.com/)
- [Midas Auto Repair Services](https://www.midas.com/)
- [Wagner Brake Technical Tips](https://www.wagnerbrake.com/technical/)
- [CarID Ignition Parts Guide](https://www.carid.com/ignition-parts.html)
- [AutoZone Repair Guides](https://www.autozone.com/repairinfo/)

---

*Document generated by researcher agent for Piston Labs service record parsing system.*
*Last updated: 2026-01-04*
