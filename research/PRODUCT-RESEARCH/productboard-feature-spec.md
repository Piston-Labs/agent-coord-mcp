# Piston Labs ProductBoard Feature Specification

## Document Purpose
Comprehensive feature breakdown with actionable granularity for engineering implementation. Organized for direct ProductBoard import.

---

## Product Hierarchy

```
Piston Labs
├── Consumer App (B2C Mobile)
├── OBD2 Device (Hardware)
├── Shop Dashboard (B2B Web)
└── Unified Database (Backend)
```

---

# Product 1: Consumer App

## Component: Onboarding & Device Pairing

### Feature: Account Creation
**Description:** User creates account with email/phone
**Acceptance Criteria:**
- [ ] Email/password registration
- [ ] Phone number verification (SMS OTP)
- [ ] Social login (Google, Apple)
- [ ] Terms of service acceptance
- [ ] Privacy policy consent with data usage explanation

### Feature: Device Pairing Flow
**Description:** Connect OBD2 device to user account
**Acceptance Criteria:**
- [ ] Bluetooth scan for nearby devices
- [ ] Device selection from list (show device ID)
- [ ] Pairing confirmation with LED feedback on device
- [ ] VIN auto-detection from OBD port
- [ ] Manual VIN entry fallback
- [ ] Vehicle year/make/model lookup from VIN
- [ ] Success confirmation with vehicle details

### Feature: Vehicle Profile Setup
**Description:** Complete vehicle information after pairing
**Acceptance Criteria:**
- [ ] Display decoded VIN info (year, make, model, engine)
- [ ] Add vehicle nickname (e.g., "Dad's Truck")
- [ ] Upload vehicle photo (optional)
- [ ] Set odometer baseline (if OBD read fails)
- [ ] Select primary use (commute, business, personal)

---

## Component: Vehicle Health Dashboard

### Feature: Real-Time Status Card
**Description:** At-a-glance vehicle health summary
**Acceptance Criteria:**
- [ ] Overall health score (0-100)
- [ ] Last connection timestamp
- [ ] Current location (if moving or recently parked)
- [ ] Battery voltage indicator
- [ ] Any active DTC codes (check engine light)
- [ ] Tap to expand for details

### Feature: Live Telemetry View
**Description:** Real-time sensor data from OBD
**Acceptance Criteria:**
- [ ] Current odometer reading
- [ ] Speed (when driving)
- [ ] Engine RPM
- [ ] Coolant temperature
- [ ] Fuel level (if supported)
- [ ] Battery voltage (main + backup)
- [ ] Refresh rate indicator (last update X seconds ago)

### Feature: DTC Code Display
**Description:** Show diagnostic trouble codes with explanations
**Acceptance Criteria:**
- [ ] List all active codes (P0XXX, B0XXX, C0XXX, U0XXX)
- [ ] Plain-English explanation for each code
- [ ] Severity indicator (critical/warning/info)
- [ ] "What this means" section
- [ ] "What to do" recommendation
- [ ] Link to schedule service for critical codes

### Feature: Trip History
**Description:** View past trips with route and stats
**Acceptance Criteria:**
- [ ] List of trips (date, start/end location, distance)
- [ ] Map view of route taken
- [ ] Trip duration and average speed
- [ ] Fuel efficiency (if calculable)
- [ ] Hard braking/acceleration events
- [ ] Filter by date range

---

## Component: Service History

### Feature: Unified Service Timeline
**Description:** All service records in one place
**Acceptance Criteria:**
- [ ] Chronological list of all services
- [ ] Service type, date, mileage at service
- [ ] Shop name and location
- [ ] Cost breakdown (parts, labor, total)
- [ ] Technician notes (if available)
- [ ] Filter by service type
- [ ] Search by keyword

### Feature: Service Detail View
**Description:** Detailed view of individual service record
**Acceptance Criteria:**
- [ ] Full repair order details
- [ ] Parts used with part numbers
- [ ] Labor hours breakdown
- [ ] Recommendations made by shop
- [ ] Declined services (if any)
- [ ] Receipt/invoice attachment (PDF)
- [ ] Shop contact info

### Feature: Add Manual Service Record
**Description:** User can add service done elsewhere
**Acceptance Criteria:**
- [ ] Service type selection (oil change, tires, brakes, etc.)
- [ ] Date and mileage input
- [ ] Shop name (or "DIY")
- [ ] Cost (optional)
- [ ] Notes field
- [ ] Photo attachment (receipt)

---

## Component: Service Reminders

### Feature: Mileage-Based Reminder Engine
**Description:** Smart reminders based on actual miles driven
**Acceptance Criteria:**
- [ ] Track miles since last service (per service type)
- [ ] Compare against manufacturer intervals
- [ ] Calculate "miles until due" in real-time
- [ ] Account for driving patterns (predict due date)
- [ ] Different intervals for different service types

### Feature: Reminder Notifications
**Description:** Push notifications for upcoming service
**Acceptance Criteria:**
- [ ] Configurable threshold (e.g., notify at 500 miles before due)
- [ ] Push notification with service type and miles remaining
- [ ] In-app reminder card on dashboard
- [ ] Email digest option (weekly summary)
- [ ] Snooze option (remind again in X miles)

### Feature: Service Due List
**Description:** View all upcoming services
**Acceptance Criteria:**
- [ ] List sorted by urgency (miles until due)
- [ ] Color coding (red = overdue, yellow = soon, green = OK)
- [ ] Estimated date based on driving patterns
- [ ] Tap to schedule with preferred shop
- [ ] Manufacturer interval source citation

### Feature: Manufacturer Interval Database
**Description:** Service intervals per vehicle make/model/year
**Acceptance Criteria:**
- [ ] Oil change intervals (conventional, synthetic, blend)
- [ ] Tire rotation intervals
- [ ] Brake inspection intervals
- [ ] Transmission fluid intervals
- [ ] Coolant flush intervals
- [ ] Spark plug intervals
- [ ] Timing belt intervals (if applicable)
- [ ] Air filter intervals (engine, cabin)

---

## Component: Shop Preference Management

### Feature: Shop Search & Discovery
**Description:** Find shops in our network
**Acceptance Criteria:**
- [ ] Search by location (current, address, zip)
- [ ] Filter by services offered
- [ ] Filter by distance
- [ ] Show shop ratings (future: from our users)
- [ ] Show shop hours
- [ ] Show "accepts Piston customers" badge

### Feature: Set Preferred Shop
**Description:** Designate primary shop for service reminders
**Acceptance Criteria:**
- [ ] Select shop from search results
- [ ] Confirm shop preference
- [ ] All future reminders route to this shop
- [ ] Shop can now see this customer's vehicle data
- [ ] Easy to change preference anytime

### Feature: Shop Connection Management
**Description:** Control which shops can see your data
**Acceptance Criteria:**
- [ ] List all connected shops (preferred + service history)
- [ ] Show what data each shop can see
- [ ] Revoke shop access (remove from connected list)
- [ ] Clear explanation of data sharing
- [ ] Confirm before sharing with new shop

### Feature: Data Privacy Controls
**Description:** Granular control over what's shared
**Acceptance Criteria:**
- [ ] Toggle: Share real-time location with shop
- [ ] Toggle: Share service history with shop
- [ ] Toggle: Allow shop to send promotions
- [ ] Toggle: Share driving behavior data
- [ ] Master toggle: Pause all data sharing

---

## Component: Appointment Scheduling

### Feature: Schedule Service Request
**Description:** Request appointment with preferred shop
**Acceptance Criteria:**
- [ ] Select service(s) needed
- [ ] Choose preferred date/time slots
- [ ] Add notes for shop
- [ ] Submit request to shop
- [ ] Confirmation that request was sent

### Feature: Shop Availability Calendar
**Description:** View shop's available appointment slots
**Acceptance Criteria:**
- [ ] Calendar view of available slots
- [ ] Slot duration based on service type
- [ ] Gray out unavailable times
- [ ] Show estimated service duration
- [ ] Multiple service selection updates duration

### Feature: Appointment Confirmation Flow
**Description:** Two-way confirmation with shop
**Acceptance Criteria:**
- [ ] Push notification when shop responds
- [ ] Show confirmed date/time
- [ ] Show any shop modifications to request
- [ ] Accept/decline shop's proposed time
- [ ] Add to device calendar option

### Feature: Appointment Management
**Description:** View and manage scheduled appointments
**Acceptance Criteria:**
- [ ] List of upcoming appointments
- [ ] Appointment details (date, time, services, shop)
- [ ] Reschedule option
- [ ] Cancel option (with confirmation)
- [ ] Reminder notification (24hr, 1hr before)
- [ ] Get directions to shop

---

## Component: Promotion Engine

### Feature: Contextual Bundle Offers
**Description:** Intelligent service bundle recommendations
**Acceptance Criteria:**
- [ ] Analyze multiple due services
- [ ] Check shop recommendations from last visit
- [ ] Calculate bundle discount within shop's max
- [ ] Present as single actionable offer
- [ ] Show savings vs. individual services
- [ ] One-tap to schedule bundle

### Feature: Promotion Display
**Description:** Show relevant promotions to user
**Acceptance Criteria:**
- [ ] Promotion card on dashboard when relevant
- [ ] Clear explanation of why this promotion
- [ ] Original price vs. discounted price
- [ ] Expiration date (if applicable)
- [ ] "Schedule Now" CTA
- [ ] "Not Interested" dismiss option

### Feature: Promotion History
**Description:** Track past promotions and redemptions
**Acceptance Criteria:**
- [ ] List of promotions received
- [ ] Status (redeemed, expired, dismissed)
- [ ] Savings from redeemed promotions
- [ ] Total lifetime savings counter

---

# Product 2: OBD2 Device

## Component: Hardware Specifications

### Feature: OBD Protocol Support
**Description:** Support all standard OBD-II protocols
**Acceptance Criteria:**
- [ ] CAN (ISO 15765)
- [ ] ISO 9141-2
- [ ] ISO 14230 (KWP2000)
- [ ] SAE J1850 PWM
- [ ] SAE J1850 VPW
- [ ] Auto-detect protocol on connection

### Feature: Telemetry Data Collection
**Description:** Data points collected from vehicle
**Acceptance Criteria:**
- [ ] GPS location (lat, lng, altitude, heading)
- [ ] Speed (OBD + GPS)
- [ ] Odometer reading
- [ ] Engine RPM
- [ ] Coolant temperature
- [ ] Battery voltage
- [ ] Fuel level (if supported)
- [ ] DTC codes (read and clear)
- [ ] VIN auto-read

### Feature: Cellular Connectivity
**Description:** Always-on data connection
**Acceptance Criteria:**
- [ ] LTE Cat-M1/NB-IoT support
- [ ] Automatic carrier selection
- [ ] Connection status LED indicator
- [ ] Offline data buffering (store & forward)
- [ ] Low power consumption in sleep mode

### Feature: Power Management
**Description:** Smart power handling
**Acceptance Criteria:**
- [ ] Draw power from OBD port
- [ ] Sleep mode when ignition off
- [ ] Wake on ignition/movement
- [ ] No battery drain when parked
- [ ] Backup battery for brief outages

---

## Component: Device Provisioning

### Feature: Factory Provisioning
**Description:** Pre-configure device before shipping
**Acceptance Criteria:**
- [ ] Unique device ID assignment
- [ ] AWS IoT certificate installation
- [ ] Firmware version verification
- [ ] Connectivity test before shipping
- [ ] QR code label for pairing

### Feature: Over-the-Air Updates
**Description:** Remote firmware updates
**Acceptance Criteria:**
- [ ] Check for updates on connection
- [ ] Download update in background
- [ ] Apply update when vehicle parked
- [ ] Rollback on failed update
- [ ] Version reporting to backend

### Feature: Device Diagnostics
**Description:** Monitor device health remotely
**Acceptance Criteria:**
- [ ] Last connection timestamp
- [ ] Signal strength history
- [ ] Firmware version
- [ ] Error/restart counts
- [ ] Battery backup status

---

# Product 3: Shop Dashboard

## Component: Shop Onboarding

### Feature: Shop Account Creation
**Description:** Shop owner creates account
**Acceptance Criteria:**
- [ ] Business name and address
- [ ] Contact information
- [ ] Business hours
- [ ] Services offered (checkbox list)
- [ ] Shop management system used (dropdown)
- [ ] Agree to terms of service

### Feature: Shop Verification
**Description:** Verify legitimate business
**Acceptance Criteria:**
- [ ] Business license upload (optional for beta)
- [ ] Phone verification
- [ ] Address verification (Google Maps)
- [ ] Manual review queue for approval
- [ ] Verification badge on profile

### Feature: Beta Program Enrollment
**Description:** Special beta shop benefits
**Acceptance Criteria:**
- [ ] Beta agreement acceptance
- [ ] Free tier forever confirmation
- [ ] Direct Tyler access explanation
- [ ] Feedback commitment acknowledgment
- [ ] Beta badge assignment

---

## Component: Repair Order Management

### Feature: PDF Upload Interface
**Description:** Drag-and-drop repair order upload
**Acceptance Criteria:**
- [ ] Drag-and-drop zone
- [ ] File picker fallback
- [ ] Support PDF, JPG, PNG
- [ ] Multiple file upload
- [ ] Upload progress indicator
- [ ] Success/failure feedback

### Feature: Repair Order Parsing
**Description:** Extract data from uploaded documents
**Acceptance Criteria:**
- [ ] VIN extraction (required)
- [ ] Service date extraction
- [ ] Mileage extraction
- [ ] Services performed (line items)
- [ ] Parts used (with part numbers if available)
- [ ] Labor hours
- [ ] Total cost
- [ ] Technician recommendations
- [ ] Confidence score display
- [ ] Manual correction interface

### Feature: Parsed Data Review
**Description:** Shop reviews and corrects parsed data
**Acceptance Criteria:**
- [ ] Side-by-side: original PDF + parsed fields
- [ ] Editable fields for corrections
- [ ] Highlight low-confidence extractions
- [ ] Add missing data manually
- [ ] Confirm and save button
- [ ] Link to customer if device exists

### Feature: Repair Order History
**Description:** View all uploaded repair orders
**Acceptance Criteria:**
- [ ] List with date, customer name, VIN, total
- [ ] Search by VIN, customer name, date
- [ ] Filter by date range
- [ ] Filter by linked/unlinked to device
- [ ] Click to view full details
- [ ] Edit previously uploaded orders

---

## Component: Customer Management

### Feature: Connected Customers List
**Description:** View customers with devices who selected this shop
**Acceptance Criteria:**
- [ ] List of customers with name, vehicle, last visit
- [ ] Device connection status indicator
- [ ] Last telemetry timestamp
- [ ] Search by name or VIN
- [ ] Sort by last visit, alphabetical, etc.
- [ ] Click to view customer detail

### Feature: Customer Detail View
**Description:** Deep view into connected customer
**Acceptance Criteria:**
- [ ] Customer contact info
- [ ] Vehicle details (year, make, model, VIN)
- [ ] Current odometer (live from device)
- [ ] Service history at this shop
- [ ] Upcoming service due dates
- [ ] Last recommendations made
- [ ] Notes field for shop

### Feature: Vehicle Health View
**Description:** See connected customer's vehicle telemetry
**Acceptance Criteria:**
- [ ] Current health score
- [ ] Active DTC codes (if any)
- [ ] Battery voltage
- [ ] Mileage since last service
- [ ] Driving patterns summary
- [ ] Alert if critical issue detected

### Feature: Service Due Alerts
**Description:** Notifications when customer service is due
**Acceptance Criteria:**
- [ ] Dashboard alert for due services
- [ ] Customer name, vehicle, service type
- [ ] Miles until due (or overdue)
- [ ] Quick action: Send reminder to customer
- [ ] Quick action: Create appointment slot

---

## Component: Appointment Management

### Feature: Appointment Requests Inbox
**Description:** Receive and manage appointment requests
**Acceptance Criteria:**
- [ ] List of pending requests
- [ ] Customer name, vehicle, requested services
- [ ] Requested date/time preferences
- [ ] Customer notes
- [ ] Quick actions: Accept, Modify, Decline
- [ ] New request notification (push, email)

### Feature: Calendar Availability Setup
**Description:** Shop sets available appointment slots
**Acceptance Criteria:**
- [ ] Weekly schedule template
- [ ] Set working hours per day
- [ ] Block specific dates (holidays, etc.)
- [ ] Set appointment slot duration
- [ ] Set max appointments per day
- [ ] Bay/lift capacity settings

### Feature: Appointment Confirmation
**Description:** Respond to customer requests
**Acceptance Criteria:**
- [ ] Accept request as-is
- [ ] Propose alternative time
- [ ] Add notes for customer
- [ ] Decline with reason
- [ ] Customer notification on response

### Feature: Appointment Calendar View
**Description:** Visual calendar of scheduled appointments
**Acceptance Criteria:**
- [ ] Day, week, month views
- [ ] Color coding by status (confirmed, pending, completed)
- [ ] Click appointment for details
- [ ] Drag to reschedule (with customer notification)
- [ ] Print daily schedule

---

## Component: Messaging (Paid Feature)

### Feature: Customer Messaging
**Description:** Send messages to connected customers
**Acceptance Criteria:**
- [ ] In-app message to customer
- [ ] SMS option (with character count)
- [ ] Message templates (service reminder, promotion, etc.)
- [ ] Personalization tokens (name, vehicle, service)
- [ ] Message history per customer
- [ ] Delivery/read status

### Feature: Automated Reminders
**Description:** System sends reminders on shop's behalf
**Acceptance Criteria:**
- [ ] Enable/disable auto-reminders
- [ ] Set reminder threshold (X miles before due)
- [ ] Customize reminder message template
- [ ] Include scheduling link in message
- [ ] Track reminder performance (opens, clicks, schedules)

### Feature: Bulk Messaging
**Description:** Message multiple customers at once
**Acceptance Criteria:**
- [ ] Select multiple customers
- [ ] Filter by due service type
- [ ] Compose message with merge fields
- [ ] Preview before sending
- [ ] Send to all selected
- [ ] Delivery report

---

## Component: Promotion Settings

### Feature: Discount Configuration
**Description:** Set maximum discount shop will offer
**Acceptance Criteria:**
- [ ] Max discount percentage slider (0-30%)
- [ ] Explanation of how system uses this
- [ ] Preview example promotion at this discount
- [ ] Save settings

### Feature: Service Pricing
**Description:** Set base prices for promotion calculations
**Acceptance Criteria:**
- [ ] List of common services
- [ ] Set shop's price for each service
- [ ] System uses for bundle calculations
- [ ] Update prices anytime

### Feature: Promotion Performance
**Description:** Track promotion effectiveness
**Acceptance Criteria:**
- [ ] Promotions generated count
- [ ] Redemption rate
- [ ] Revenue from promotions
- [ ] Average discount given
- [ ] Top performing bundle types

---

# Product 4: Unified Database (Backend)

## Component: VIN Linking Engine

### Feature: VIN-Device Association
**Description:** Link VIN to device when paired
**Acceptance Criteria:**
- [ ] Store VIN-device mapping
- [ ] Handle device transfer to new vehicle
- [ ] Handle vehicle sold (unlink)
- [ ] VIN validation (checksum)
- [ ] VIN decode to get vehicle specs

### Feature: VIN-Customer Association
**Description:** Link VIN to customer account
**Acceptance Criteria:**
- [ ] One customer per VIN (primary owner)
- [ ] Handle vehicle sale (transfer ownership)
- [ ] Multiple vehicles per customer supported
- [ ] Customer can remove vehicle

### Feature: VIN-Shop Association
**Description:** Track shop relationships per VIN
**Acceptance Criteria:**
- [ ] Preferred shop (customer-selected)
- [ ] Service history shops (auto from repair orders)
- [ ] Permission status per shop
- [ ] Timestamp of relationship creation

---

## Component: Repair Order Parser

### Feature: PDF Text Extraction
**Description:** Extract text from uploaded PDFs
**Acceptance Criteria:**
- [ ] Handle scanned PDFs (OCR via AWS Textract)
- [ ] Handle native PDFs (text extraction)
- [ ] Handle images (JPG, PNG → OCR)
- [ ] Multi-page document support
- [ ] Extract tables and line items

### Feature: VIN Detection
**Description:** Find and validate VIN in document
**Acceptance Criteria:**
- [ ] Regex patterns for VIN locations
- [ ] VIN checksum validation
- [ ] Multiple VIN handling (pick correct one)
- [ ] Confidence score for detection
- [ ] Flag for manual review if low confidence

### Feature: Service Line Item Extraction
**Description:** Parse individual services from repair order
**Acceptance Criteria:**
- [ ] Service description text
- [ ] Service category classification
- [ ] Parts list with quantities
- [ ] Labor hours
- [ ] Line item cost
- [ ] Total cost validation (sum of lines)

### Feature: Recommendation Extraction
**Description:** Find technician recommendations
**Acceptance Criteria:**
- [ ] "Recommended" section detection
- [ ] Future service suggestions
- [ ] Declined services
- [ ] Severity/urgency indicators
- [ ] Link recommendations to service types

---

## Component: Service Interval Database

### Feature: Manufacturer Data Import
**Description:** Import OEM service schedules
**Acceptance Criteria:**
- [ ] Data source identification (OEM manuals, databases)
- [ ] Import pipeline for new models
- [ ] Year/make/model/engine mapping
- [ ] Service type standardization
- [ ] Mileage and time intervals

### Feature: Interval Lookup API
**Description:** Query intervals for specific vehicle
**Acceptance Criteria:**
- [ ] Input: VIN or year/make/model
- [ ] Output: All service intervals
- [ ] Handle missing data gracefully
- [ ] Cache for performance
- [ ] Fallback to generic intervals

### Feature: Custom Interval Override
**Description:** Allow user to customize intervals
**Acceptance Criteria:**
- [ ] User sets custom interval per service
- [ ] Override manufacturer recommendation
- [ ] Reset to default option
- [ ] Track custom vs. default

---

## Component: Permission Management

### Feature: Customer Consent Tracking
**Description:** Track what customer has agreed to share
**Acceptance Criteria:**
- [ ] Consent record per customer
- [ ] Timestamp of consent
- [ ] Version of privacy policy agreed to
- [ ] Granular permissions stored
- [ ] Consent withdrawal handling

### Feature: Shop Access Control
**Description:** Enforce what shops can see
**Acceptance Criteria:**
- [ ] Check permission before returning data
- [ ] Filter results based on relationship
- [ ] Log all data access
- [ ] Revocation takes effect immediately
- [ ] No data leakage on permission change

### Feature: Audit Log
**Description:** Track all data access and changes
**Acceptance Criteria:**
- [ ] Who accessed what data
- [ ] When access occurred
- [ ] What action was taken
- [ ] Source (app, dashboard, API)
- [ ] Retention policy (X months)

---

## Component: Telemetry Ingestion

### Feature: Device Data Receiving
**Description:** Ingest data from OBD devices
**Acceptance Criteria:**
- [ ] MQTT endpoint for devices
- [ ] Parse Teltonika Codec 8 Extended
- [ ] Validate device certificate
- [ ] Handle out-of-order messages
- [ ] Deduplicate messages

### Feature: Real-Time Processing
**Description:** Process telemetry for immediate use
**Acceptance Criteria:**
- [ ] Extract GPS coordinates
- [ ] Extract odometer reading
- [ ] Extract DTC codes
- [ ] Calculate trip start/end
- [ ] Trigger alerts on thresholds
- [ ] Latency <2 seconds

### Feature: Historical Storage
**Description:** Store telemetry for analytics
**Acceptance Criteria:**
- [ ] Time-series storage (TimescaleDB)
- [ ] Efficient querying by time range
- [ ] Aggregations (daily, weekly summaries)
- [ ] Data retention policy
- [ ] Archive to cold storage

---

## Component: Notification System

### Feature: Push Notification Delivery
**Description:** Send push notifications to mobile app
**Acceptance Criteria:**
- [ ] Firebase Cloud Messaging integration
- [ ] iOS and Android support
- [ ] Notification payload (title, body, data)
- [ ] Deep link to relevant screen
- [ ] Delivery tracking

### Feature: Email Delivery
**Description:** Send transactional emails
**Acceptance Criteria:**
- [ ] Email service integration (SES, SendGrid)
- [ ] HTML email templates
- [ ] Unsubscribe handling
- [ ] Bounce/complaint handling
- [ ] Delivery tracking

### Feature: SMS Delivery
**Description:** Send SMS messages
**Acceptance Criteria:**
- [ ] SMS provider integration (Twilio)
- [ ] Character limit handling
- [ ] Opt-out compliance
- [ ] Delivery receipts
- [ ] Cost tracking

### Feature: Notification Preferences
**Description:** Respect user notification settings
**Acceptance Criteria:**
- [ ] Check preferences before sending
- [ ] Channel preferences (push, email, SMS)
- [ ] Frequency limits (no spam)
- [ ] Quiet hours respect
- [ ] Per-notification-type toggles

---

## Component: CRM Integrations (Future)

### Feature: ShopGenie Integration
**Description:** Bi-directional sync with ShopGenie
**Acceptance Criteria:**
- [ ] OAuth authentication flow
- [ ] Webhook subscription for new ROs
- [ ] Push appointment requests to ShopGenie
- [ ] Receive appointment confirmations
- [ ] Handle sync conflicts

### Feature: Tekmetric Integration
**Description:** Bi-directional sync with Tekmetric
**Acceptance Criteria:**
- [ ] API authentication
- [ ] Repair order sync
- [ ] Customer data sync
- [ ] Appointment sync
- [ ] Error handling and retry

### Feature: Generic Webhook API
**Description:** Allow any CRM to integrate
**Acceptance Criteria:**
- [ ] Webhook endpoint for repair orders
- [ ] Webhook endpoint for appointments
- [ ] Signature verification
- [ ] Rate limiting
- [ ] Documentation for integrators

---

# Feature Prioritization (Not Timeline)

## Must Have (MVP)
- Device pairing + VIN detection
- Basic vehicle health display
- PDF upload + VIN parsing
- Service history storage
- Shop-customer connection via VIN

## Should Have (Core Value)
- Mileage-based service reminders
- Service due notifications
- Shop preference selection
- Appointment request flow
- Customer vehicle health view for shops

## Nice to Have (Differentiation)
- Contextual promotion engine
- Automated messaging
- Calendar scheduling
- Bundle offers
- Analytics dashboards

## Future (Scale)
- CRM integrations
- Fleet management
- ML predictions
- Payment processing
- Multi-shop customer view

---

*Generated by OMNI | Agent Coordination Hub | December 2025*
*Source: teltonika-context-system repo + agent-coord-mcp research*
