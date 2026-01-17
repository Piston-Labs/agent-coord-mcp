# Piston Labs Consumer Telemetry: Designer Branding Handoff

**Prepared for:** Designer Branding Work
**Prepared by:** Phil (Agent)
**Date:** January 3, 2026
**Repo audited:** piston-labs/telemetry v0.7.2

---

## Mission Statement

> **Know your car. Trust your shop. Drive with confidence.**

Piston Labs empowers vehicle owners with real-time health insights, connecting them to trusted independent mechanics through intelligent, usage-based service reminders. We eliminate the guesswork from car maintenance—so you never miss critical service or waste money on unnecessary appointments.

---

## Product Summary

### What We Do

Piston Labs sells a plug-and-play OBD-II telemetry device directly to consumers. The device connects to their car's diagnostic port and streams real-time data to our mobile app. When service is needed, we connect drivers with independent auto repair shops—not dealerships.

### The Core Innovation

**Traditional systems:** "It's been 6 months, maybe you need an oil change?"
**Piston Labs:** "You've driven 4,847 miles since your last oil change. Schedule now?"

We track *actual miles driven*, not just calendar time. This means:
- Weekend drivers don't over-service their cars
- Road warriors never miss critical maintenance
- Everyone gets personalized reminders based on *their* driving

---

## Brand Architecture

### Parent Company
**Piston Labs** — The technology company behind everything

### Consumer Product (NEEDS BRANDING)
Currently called **"Otto"** internally — the OBD-II device + companion app

**What "Otto" is:**
- A small OBD-II plug-in device (~$50 hardware, Teltonika FMM00A)
- A mobile app for iOS/Android
- Real-time vehicle health dashboard
- Mileage-based service reminders
- Shop appointment booking

### B2B Product (NEEDS BRANDING)
Currently called **"Shop Dashboard"** or **"Gran Autismo"** internally

**What the B2B product is:**
- Free CRM for auto repair shops
- Drag-and-drop PDF repair order import
- Automatic VIN/service extraction via AI
- Connect with consumers for future service opportunities
- Paid tier: Calendar scheduling for appointment bookings

---

## Target Customers

### Consumer Segment (Primary)

**Profile:** Vehicle owners who want visibility and control over car maintenance

**Demographics:**
- Age 25-55
- Own 1-3 vehicles (not new/luxury fleet buyers)
- DIY-curious but time-constrained
- Value transparency over brand prestige
- Prefer independent shops over dealerships

**Pain points they feel:**
- "Did I really need that service, or are they upselling me?"
- "When was my last oil change?"
- "I don't trust the dealer, but I don't know any good mechanics"
- "My check engine light is on—is it urgent or can I wait?"

**What they want:**
- Know what's going on with their car
- Get proactive reminders before problems happen
- Find a trustworthy mechanic
- Feel in control, not at the mercy of opaque repair bills

### Shop Segment (Secondary)

**Profile:** Independent auto repair shops looking for customer acquisition

**Pain points:**
- Losing customers to dealerships and chains
- No CRM—just paper invoices and memory
- Can't compete with dealer loyalty programs
- Want recurring revenue, not one-time fixes

---

## Competitive Landscape

| Competitor | Their Focus | Our Advantage |
|------------|-------------|---------------|
| **Bouncie** | Fleet tracking ($8/mo) | We add mileage-based reminders + shop connection |
| **FIXD** | DTC translation ($20 device) | We stream real-time data + proactive service |
| **Automatic** (RIP) | Trip logging | We're still here, still building |
| **Dealership apps** | Brand loyalty | We're brand-agnostic, shop-agnostic |
| **Carfax Car Care** | Service reminders | We have *actual* mileage data |

**Our unique position:** Only product that combines:
1. Real-time telemetry (like fleet trackers)
2. Mileage-based service reminders (like Carfax, but accurate)
3. Independent shop marketplace (like Yelp, but integrated)

---

## Brand Personality (Suggested)

### Voice & Tone
- **Confident, not cocky** — We know cars, but we're not gearheads
- **Clear, not clinical** — Plain English, not technician jargon
- **Empowering, not patronizing** — "Here's what you need to know" vs. "Leave it to us"
- **Friendly, not casual** — Professional but approachable

### Personality Traits
- **Honest** — No upsells, no hidden fees, no scare tactics
- **Transparent** — You see what we see (real data, not guesses)
- **Protective** — Watching out for your car, and your wallet
- **Independent** — We're not owned by any dealer or repair chain

### What We're NOT
- Not a "bro" car brand (no racing stripes, no flames)
- Not a "tech startup" aesthetic (no gradients, no generic SaaS look)
- Not a luxury brand (no premium pricing for basic features)
- Not clinical/corporate (no cold, medical feel)

---

## Visual Direction (Suggestions)

### Metaphors to explore
- **The trusted mechanic friend** — The neighbor who knows cars and helps you out
- **The dashboard light you understand** — Clear signals, no mystery codes
- **The car's heartbeat monitor** — Health, vitality, awareness

### Color palette considerations
- Trust (blues, greens)
- Energy (oranges, reds for alerts)
- Reliability (grays, metals)
- Avoid: Neon, pastels, pure black

### Typography considerations
- Readable on mobile
- Works in car context (dashboard UI)
- Has personality but not novelty

---

## Key Screens to Design

### Consumer App
1. **Home/Dashboard** — Vehicle health score, recent trips, next service
2. **Service Reminders** — List of upcoming maintenance, "Schedule Now" CTA
3. **Trip History** — Map view, distance, fuel usage
4. **Shop Finder** — Nearby shops, ratings, book appointment
5. **Vehicle Profile** — VIN, year/make/model, service history

### Shop Dashboard
1. **Customer List** — CRM view with last visit, vehicles, contact
2. **PDF Import** — Drag-and-drop repair order upload
3. **Appointment Calendar** — (Paid tier) Booking management
4. **Vehicle Detail** — Full service history for a VIN

---

## Technical Context (For Designer Awareness)

### Device Specs
- **Hardware:** Teltonika FMM00A
- **Size:** Compact, plugs into OBD-II port
- **Connection:** Cellular (LTE via Soracom)
- **Data:** GPS, ignition, voltage, odometer, VIN, fault codes

### Architecture (Privacy-First)
- GPS is streamed live but **never stored**
- Service history persists with the car, not the owner
- VIN links shop records to consumer profiles automatically

### Live Stats
- 8 devices currently deployed (beta)
- Beta launch target: January 5, 2026
- First shop: Tyler's Shop

---

## Open Questions for Branding

1. **Consumer product name:** Keep "Otto" or rebrand?
2. **Shop product name:** "Shop Dashboard" feels generic—name it?
3. **Relationship between brands:** Should consumer + shop share visual identity?
4. **App icon direction:** Device-focused? Car-focused? Health/heartbeat?
5. **Marketing tagline:** Current draft is "Know your car. Trust your shop."

---

## Deliverables Needed

### Phase 1: Brand Foundation
- [ ] Logo (Piston Labs parent + consumer product + shop product)
- [ ] Color palette (primary, secondary, semantic)
- [ ] Typography (headings, body, UI)
- [ ] Icon style (line, filled, duotone?)
- [ ] App icon

### Phase 2: Consumer App Design
- [ ] Core screen designs (5 screens above)
- [ ] Design system / component library
- [ ] Empty states, loading states, error states
- [ ] Push notification styling

### Phase 3: Shop Dashboard Design
- [ ] Web app screens (4 screens above)
- [ ] Responsive considerations (tablet in shop?)
- [ ] PDF upload experience
- [ ] Calendar/booking UI (paid tier)

### Phase 4: Marketing Assets
- [ ] Website homepage design
- [ ] Device product photography direction
- [ ] Social media templates
- [ ] App store screenshots

---

## Contact

For questions about this handoff, contact:
- **Tyler** (CEO) — Technical architecture, product vision
- **Ryan** — Consumer app, Supabase, mobile integration
- **Phil** (Agent) — This document, repo context

---

*This document was generated from an audit of the piston-labs/telemetry repository (v0.7.2) on January 3, 2026.*
