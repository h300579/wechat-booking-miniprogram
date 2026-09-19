# Merchant Console Demo Development Specification

## 1. Purpose

This document defines the development scope, business rules, correctness requirements, and implementation constraints for the current Merchant Console Demo.

The goal of this iteration is to complete a demonstrable end-to-end booking workflow:

**Customer creates a booking → Merchant views and manages the booking**

This iteration should prioritize a complete and polished demo experience over expanding the product into a fully featured commercial booking platform.

The current business scenario is intentionally simple:

- One merchant
- One physical store
- One owner/operator
- No employees
- One booking resource controlled by the owner

Development should remain aligned with this business model.

---

# 2. Current Iteration: Merchant Console Demo

## 2.1 Primary Goal

Add a merchant-facing management interface to the existing WeChat Mini Program.

The Merchant Console must allow the store owner to:

- Be recognized as an authorized merchant/admin
- View today's bookings
- View bookings for another date
- View booking details
- Cancel a future booking
- Inspect the booking availability/status of a day
- Stop accepting new bookings for a day
- Reopen a day that was manually closed by the merchant

The result should be suitable for a live product demonstration.

---

# 3. Merchant Authorization

## 3.1 Merchant Role Is Preconfigured

Merchant status is a privileged role.

Users must **not** be able to grant themselves merchant permissions through the Mini Program.

Merchant/admin identity must be configured through trusted administrative data, using the existing authorization infrastructure such as:

- WeChat trusted identity
- `admin_roles`
- Existing server-side identity resolution
- Existing server-side authorization checks

Conceptually:

```text
WeChat identity
      ↓
Server identity resolution
      ↓
admin_roles
      ↓
Merchant permission
```

Do not implement client-controlled role granting such as:

```text
"I am a merchant"
      ↓
Grant merchant permission
```

---

## 3.2 Merchant Role Lookup

Provide a focused API that returns only the current logged-in user's own merchant authorization status.

For example:

```ts
getMyMerchantRole();
```

Possible result:

```ts
{
  isMerchant: true;
}
```

or:

```ts
{
  isMerchant: false;
}
```

This endpoint is a **qualification lookup**, not a privileged merchant business operation.

Therefore:

- An authenticated normal user must be allowed to call it.
- A normal user should receive `isMerchant: false`.
- It should not return `FORBIDDEN` merely because the caller is not a merchant.
- It must not expose the full `admin_roles` collection.

---

## 3.3 Server-side Authorization Is Mandatory

Frontend route visibility exists only for user experience.

Every actual merchant business API must independently enforce authorization on the server.

Examples include:

- `getMerchantAppointments`
- Merchant booking detail APIs
- Merchant cancellation
- Close day
- Reopen day

A normal customer manually calling one of these merchant business endpoints must receive an authorization failure such as:

```text
FORBIDDEN
```

Frontend hiding must never be treated as a security mechanism.

---

## 3.4 Merchant Entry Point

The current Mini Program does not require a new general-purpose "My" page.

For this Demo, the merchant entry may be placed directly inside the existing "My Bookings" page.

Example:

```text
My Bookings

----------------

Merchant Console >
```

The entry should only be shown when the current user is recognized as an authorized merchant.

---

## 3.5 Merchant Role Provisioning

The project must include concrete operational documentation for provisioning and revoking merchant access.

The documentation should describe:

- The expected `admin_roles` record structure
- Which trusted identity field is used for the association
- How the owner's WeChat identity maps to the role record
- How to grant merchant access
- How to revoke merchant access
- Which status or role values are valid

Merchant role assignment must remain an administrative operation.

It must not be performed by normal Mini Program users.

---

# 4. Merchant Dashboard

Provide a simple merchant dashboard optimized for demonstration.

Suggested information:

- Current store date
- Number of active bookings today
- Number of upcoming bookings today
- Next upcoming booking today
- Today's booking availability state

Suggested quick actions:

- View today's bookings
- View schedule
- Stop accepting bookings today

The dashboard should visually feel like a merchant workspace rather than an internal developer/admin tool.

---

# 5. Time and Date Semantics

All business-day calculations must use the **store timezone**, not the client device timezone.

Current Demo configuration:

```text
STORE_TIMEZONE = Asia/Shanghai
```

The store timezone should have a single source of truth in configuration.

Do not scatter hard-coded UTC+8 calculations throughout the frontend and backend.

The store timezone must be used when calculating:

- Today
- Selected booking date
- Upcoming bookings
- Next booking
- Day boundaries
- Whether a booking has already started
- Whether today's business hours have ended
- Dashboard counts
- Historical vs future date boundaries

Authoritative business time comparisons must use **server-side current time**.

Do not trust client device time for:

- Whether cancellation is still permitted
- Whether a booking has started
- Whether a day is historical
- Whether schedule mutation is permitted

---

# 6. Booking List

The merchant must be able to view bookings in chronological order.

At minimum, support:

- Today's bookings
- Bookings for a selected date
- Historical date viewing

Each booking item should display useful summary information such as:

- Start time
- End time
- Service name
- Customer display label
- Booking state / time-derived display state

The daily list should include both:

- Active / confirmed bookings
- Cancelled bookings

Cancelled records are part of booking history and must not silently disappear.

The UI may visually de-emphasize cancelled records.

---

## 6.1 Customer Display Label

The current system may not contain a reliable real customer name or phone number.

The implementation must not assume that these fields already exist.

If the customer name is generic, such as:

```text
微信用户
```

different bookings should still be visually distinguishable.

A suitable Demo display format is:

```text
微信用户 · #3A71
```

where the suffix is derived from a safe, short portion of the booking identifier.

Do not introduce phone-number collection solely for this Demo.

---

## 6.2 Booking Status Semantics

The current booking state model may remain:

```text
CONFIRMED
CANCELLED
```

Do not create new persistent states solely for Merchant Console presentation.

In particular, do not introduce:

```text
COMPLETED
ARRIVED
NO_SHOW
LATE_CANCELLED
```

during this iteration.

A `CONFIRMED` booking whose start time has already passed must **not** be described as completed.

The UI may derive a non-persistent display label from time.

For example:

```text
Database state:
CONFIRMED

startTime < serverNow

UI label:
预约时间已过
```

This is only a display interpretation.

It must not be treated as proof that the service was completed.

---

# 7. Dashboard Metrics

The Merchant Console must use consistent definitions.

All dashboard booking metrics in this Demo are scoped to **the current store day only**.

The dashboard must not silently query all future dates.

---

## 7.1 Today

"Today" means the current calendar day in:

```text
STORE_TIMEZONE
```

For the current Demo:

```text
Asia/Shanghai
```

---

## 7.2 Today's Active Bookings

Count bookings for the current store day that are not cancelled.

Conceptually:

```text
date = today
AND
status != CANCELLED
```

---

## 7.3 Today's Upcoming Bookings

Bookings that:

- Belong to the current store day
- Are not cancelled
- Have not started yet

Conceptually:

```text
date = today
AND
status != CANCELLED
AND
startTime > serverNow
```

This metric should be presented as:

```text
今日待开始
```

It does not include tomorrow or later dates.

---

## 7.4 Today's Next Booking

The earliest booking among **today's upcoming bookings**.

If there are no remaining bookings today:

```text
今日暂无后续预约
```

The Merchant Console does not need to automatically show tomorrow's first booking in this milestone.

A future "nearest future booking" feature may be added separately if needed.

---

## 7.5 Past Booking Time

A booking may remain `CONFIRMED` after its scheduled time has passed.

This may be displayed as:

```text
预约时间已过
```

but must not contribute to an "already completed" metric.

---

# 8. Booking Query Contract

Merchant booking queries must be explicitly scoped to one store business day.

Example:

```ts
getMerchantAppointments({
  date,
});
```

Recommended response shape:

```ts
{
  items: [
    {
      appointmentId,
      startTime,
      endTime,
      serviceName,
      customerLabel,
      status
    }
  ],
  total: 12,
  complete: true
}
```

The response must include both confirmed and cancelled booking records unless the API explicitly supports a separate filter.

For the current Demo, a complete single-day result is preferred over introducing complex pagination.

---

## 8.1 Daily Query Safety Limit

Use a reasonable backend safety limit for daily booking records.

Current Demo recommendation:

```text
DAILY_APPOINTMENT_QUERY_LIMIT = 200
```

This limit is a safety mechanism, not a business assumption that a day can never contain more records.

Cancelled records may accumulate even when active booking capacity is small.

---

## 8.2 Query Completeness

The backend must never silently truncate a daily booking result and present it as complete.

If the full daily result is returned:

```ts
{
  items: [...],
  total: 12,
  complete: true
}
```

If a safety limit prevents returning the complete result, the API must explicitly indicate this.

For example:

```ts
{
  items: [...],
  total: 235,
  complete: false
}
```

The UI must not claim that such a partial result represents all records for the day.

Alternatively, the backend may reject an oversized daily query with a clear error.

Silent truncation is not acceptable.

---

## 8.3 Dashboard Counts Are Independent

Dashboard totals must come from authoritative backend logic.

Do not calculate:

```text
Today's total = items.length
```

unless the API explicitly guarantees that the daily result is complete.

Dashboard metrics must remain accurate even if a booking-list query is partial.

---

# 9. Booking Details

Selecting a booking should open a merchant booking detail view.

Display relevant information already available in the current system, such as:

- Booking ID
- Customer display label
- Service
- Date
- Start time
- End time
- Current booking status

Display contact information only if it already exists in the current data model and is appropriate to expose.

Do not create a new customer-profile system for this Demo.

---

# 10. Merchant Cancellation

## 10.1 Cancellation Evaluation Order

Merchant cancellation must follow a deterministic order.

The intended semantic order is:

```text
1. Authenticate / authorize merchant
2. Load appointment
3. If appointment is already CANCELLED:
      return the existing cancelled result
4. Otherwise check whether the appointment has started
5. If startTime <= serverNow:
      reject cancellation
6. Otherwise perform cancellation
```

This ordering ensures that idempotent retries remain successful even after the original appointment start time has passed.

Example:

```text
13:00 appointment

12:00 merchant cancellation succeeds

14:00 network retry sends cancel again

Result:
return existing cancelled result
```

Do not return a new `CANCELLATION_CLOSED` error for an appointment that was already successfully cancelled.

---

## 10.2 Cancellation Time Boundary

For an appointment that is still active, the merchant may cancel only if it has **not yet started**.

If:

```text
appointment.status != CANCELLED
AND
appointment.startTime <= serverNow
```

merchant cancellation must be rejected.

Past active bookings remain read-only in this iteration.

Do not use cancellation as a substitute for:

- Completed
- No-show
- Attendance tracking

Those concepts belong to future development.

---

## 10.3 Cancellation Must Be Idempotent

Repeated cancellation requests for the same already-cancelled booking must not:

- Release capacity twice
- Restore booking quota twice
- Duplicate side effects
- Create inconsistent resource state

The operation should return the already-existing cancellation result or otherwise behave idempotently.

---

## 10.4 Cancellation Side Effects

After a successful merchant cancellation:

- The booking must appear cancelled in the customer's booking list.
- The merchant view must show the updated state.
- The released booking interval must become available again when appropriate.
- Any existing future-booking quota/accounting must be updated correctly.
- The action must remain auditable using the existing audit infrastructure.

---

## 10.5 Cancellation Confirmation

Merchant cancellation is a destructive operation and must require a confirmation step in the UI.

Example:

```text
确定取消这笔预约？

9月13日 14:30
深度护理

取消后，该预约将失效，
对应时间段将重新开放预约。

[暂不取消] [确认取消]
```

---

## 10.6 Customer Notification

Push notification or WeChat message notification is not required in the current Demo.

If no notification system exists:

- The customer must see the updated cancellation state after refreshing/reloading booking data.
- The UI must not imply that a separate notification was sent.

Messaging/notification functionality may be considered in future development.

---

# 11. Schedule / Day Management

The Merchant Console must allow the owner to manage whether a store day accepts **new bookings**.

This concept is separate from existing bookings.

Schedule state and actual remaining capacity must also be treated as separate concepts.

For example:

```text
manualCloseState = OPEN
capacityState = FULLY_BOOKED
```

is valid.

Reopening a manually closed day does not guarantee that the day becomes bookable if all valid slots are already occupied.

---

# 12. Closing a Day

## 12.1 Business Meaning

Closing a day means:

> Stop accepting new bookings for that day.

It does **not** mean:

> Cancel all existing bookings for that day.

Existing bookings must remain valid.

Example:

```text
10:00 Existing booking
13:00 Existing booking

Merchant closes the day at 11:00

Result:

10:00 booking → unchanged
13:00 booking → unchanged
New 15:00 booking → rejected
```

This behavior is mandatory.

---

## 12.2 Existing Bookings Must Not Block Closing

The presence of existing appointments must not prevent the merchant from stopping further bookings for that day.

Existing backend behavior that returns:

```text
EXISTING_APPOINTMENTS
```

solely because the day already contains appointments is incompatible with this specification and should be adjusted.

---

## 12.3 Closing Does Not Cancel Appointments

Closing a day must never automatically:

- Cancel appointments
- Delete appointment records
- Release existing booked intervals

If an existing appointment must be cancelled, the merchant must cancel it individually through the normal merchant cancellation flow.

---

## 12.4 Close Operation Is Explicit and Idempotent

Schedule mutation must use explicit target operations.

Use semantics equivalent to:

```ts
closeDay();
reopenDay();
```

Do not implement a generic state toggle such as:

```ts
toggleDay();
```

Network retries must not invert the intended state.

Repeated:

```text
closeDay()
```

on an already manually closed day should leave the day closed and return the current successful state.

Repeated:

```text
reopenDay()
```

on an already-open eligible day should leave the day open and return the current state where appropriate.

---

# 13. Close / Booking Concurrency

Closing a day and submitting a new customer booking may happen concurrently.

The system must prevent this race condition:

```text
Merchant:
Close day → SUCCESS

Customer:
Booking request that was concurrent → also SUCCESS afterwards
```

The booking creation path and merchant day-closing path must coordinate using authoritative shared state.

The transaction or equivalent consistency mechanism must guarantee that the final state is internally consistent.

Acceptable outcomes include:

### Outcome A

```text
Customer booking commits first
↓
Merchant closes day
↓
Existing booking remains
↓
No further bookings allowed
```

### Outcome B

```text
Merchant close commits first
↓
Customer booking sees closed state
↓
Booking is rejected
```

Unacceptable outcome:

```text
Merchant receives successful close result
↓
A later-committed booking bypasses the closed state
```

---

# 14. Reopening a Day

Reopening a manually closed day is **required for the current Demo**.

It is not optional.

Reopening means:

> Remove the merchant's manual close state and restore the day's original scheduling policy.

Reopening must not:

- Change existing bookings
- Create duplicate availability
- Change historical appointments
- Convert a normal rest day into a working day
- Implicitly generate a missing schedule
- Guarantee that bookable capacity exists

Example:

```text
Normal business day
↓
Merchant manually closes day
↓
Day has MANUALLY_CLOSED state
↓
Merchant reopens
↓
Manual close is removed
↓
Existing bookings still consume their original intervals
```

If the remaining schedule is already fully occupied after reopening, the day should display:

```text
已约满
```

rather than:

```text
可预约
```

---

# 15. Day Availability States

The Merchant Console must distinguish between different reasons why a day is not currently bookable.

Schedule state and derived capacity/display state may be calculated separately.

At minimum, distinguish conceptually between:

---

## 15.1 OPEN

A normal business day that is not manually closed.

Being `OPEN` does not necessarily mean that a valid slot currently exists.

An open day may also be:

```text
FULLY_BOOKED
```

or:

```text
BUSINESS_ENDED
```

depending on time and capacity.

---

## 15.2 MANUALLY_CLOSED

A normally available business day manually closed by the merchant.

This state can be reopened.

Manual closure takes precedence over capacity display.

A manually closed day should be displayed as:

```text
已关闭
```

even if it would otherwise have remaining availability.

---

## 15.3 REST_DAY

A day that is not part of the original business schedule.

This state must not be reopened through the simple merchant reopen operation.

Display:

```text
休息
```

---

## 15.4 NOT_GENERATED

Required booking/schedule data for the day has not yet been generated.

The UI must not incorrectly display this as:

- Manually closed
- Rest day
- Fully booked

Display:

```text
尚未生成
```

The merchant reopen operation must not implicitly generate this schedule.

---

## 15.5 FULLY_BOOKED

`FULLY_BOOKED` is a **derived capacity state**.

A date should be treated as fully booked only when:

- It is a valid business day
- It is not manually closed
- It is not a rest day
- It is not under maintenance / booking suspension
- Relevant business time has not simply ended
- There is no valid appointment start time remaining for **any currently active/bookable service**

The system must consider different service durations.

Example:

```text
Remaining valid capacity: 30 minutes

Active services:
30 min
60 min
90 min
```

The day is **not** fully booked because the 30-minute service is still bookable.

A date is fully booked only when no currently bookable service can fit into any remaining valid slot.

---

## 15.6 BUSINESS_ENDED

For the current store day, if all valid business booking time has already passed according to `STORE_TIMEZONE` and server time, do not display:

```text
已约满
```

Display a distinct state such as:

```text
今日营业已结束
```

This is time-based, not capacity-based.

---

## 15.7 MAINTENANCE / BOOKING SUSPENSION

If the existing system has a maintenance or booking-suspension state, it must remain distinct from:

```text
FULLY_BOOKED
```

The UI should display an appropriate maintenance or suspension message.

Do not interpret maintenance as lack of capacity.

---

# 16. Availability Display Precedence

When multiple conditions could apply, the UI should use a deterministic display priority.

A reasonable conceptual precedence is:

```text
REST_DAY
NOT_GENERATED
MAINTENANCE
MANUALLY_CLOSED
BUSINESS_ENDED
FULLY_BOOKED
OPEN / AVAILABLE
```

The exact internal implementation may differ, but the user-visible meaning must remain unambiguous.

In particular:

```text
MANUALLY_CLOSED
```

and:

```text
FULLY_BOOKED
```

must not be treated as the same state.

---

# 17. Reopen Semantics

Only a day that was manually closed may be restored through the merchant reopen action.

Example:

```text
Normal Tuesday
↓
Merchant closes Tuesday
↓
MANUALLY_CLOSED
↓
Merchant reopens Tuesday
↓
Manual close removed
```

The resulting display may be:

```text
可预约
```

or:

```text
已约满
```

depending on actual remaining capacity.

A normal rest day:

```text
REST_DAY
```

must remain a rest day.

A missing schedule:

```text
NOT_GENERATED
```

must remain ungenerated until the normal schedule-generation process runs.

`reopenDay()` must not double as:

```text
generateDay()
```

---

# 18. Merchant Day UI

The merchant day view should clearly distinguish states such as:

```text
Sep 13   可预约
Sep 14   已约满
Sep 15   已关闭
Sep 16   休息
Sep 17   尚未生成
```

For the current day, it may also display:

```text
今日营业已结束
```

when appropriate.

Do not collapse all non-bookable conditions into a generic:

```text
不可预约
```

when the system knows the reason.

---

# 19. Date Viewing and Mutation Range

Viewing booking history and mutating future scheduling are different permissions.

---

## 19.1 Historical Dates

Historical dates may be queried and viewed.

The merchant may inspect:

- Confirmed historical bookings
- Cancelled historical bookings
- Their booking details

Historical dates must be read-only for schedule management.

The merchant must not be allowed to:

- Close a historical date
- Reopen a historical date

---

## 19.2 Current and Future Schedule Mutation

Schedule mutation is only allowed within the currently supported booking/schedule window.

For example, if the application generates schedules for a finite future booking window, merchant `closeDay` / `reopenDay` operations must respect that same supported window.

Do not allow arbitrary far-future schedule mutation that bypasses the existing schedule-generation model.

---

## 19.3 Missing Schedule Within Window

If a date lies within the expected schedule/booking window but required schedule data is missing:

```text
NOT_GENERATED
```

must be shown.

The merchant must not be allowed to use:

```text
reopenDay()
```

to implicitly create the missing day.

Schedule generation should continue to use the intended schedule-generation mechanism.

---

## 19.4 Boundary Decisions Use Server Time

Whether a date is:

- Historical
- Today
- Future
- Eligible for cancellation
- Eligible for schedule mutation

must be determined using authoritative backend time and `STORE_TIMEZONE`.

Do not trust client-reported date boundaries.

---

# 20. Existing Infrastructure

Prefer extending existing components over creating parallel systems.

Reuse whenever possible:

- `admin_roles`
- Existing appointment data model
- Existing identity infrastructure
- Existing authorization
- Existing audit logging
- Existing `operations` cloud function
- Existing resource/day availability model
- Existing cancellation logic
- Existing transaction infrastructure
- Existing schedule-generation mechanism
- Existing maintenance / booking-suspension mechanism if present

Backend changes should remain focused on Merchant Console requirements.

---

# 21. Features Deferred to the Next Development Phase

The following features are intended future product capabilities but must **not be implemented during the Merchant Console Demo iteration**.

These belong to a later Booking Trust & Abuse Prevention milestone.

---

## 21.1 Malicious Booking Protection

Future work should address:

- Intentional malicious bookings
- Slot hoarding
- Competitor abuse
- Repeated booking and cancellation
- Coordinated bookings using multiple identities

---

## 21.2 Customer Reputation

Future versions may track:

- Successful appointments
- Cancellation history
- Suspicious behavior
- Booking restrictions

---

## 21.3 No-show

Future development may record when a customer fails to attend a booking.

Possible future state:

```text
NO_SHOW
```

Do not implement it now.

---

## 21.4 Late Cancellation

Future versions may distinguish:

```text
Normal cancellation
Late cancellation
Severe late cancellation
```

Do not introduce these states during this iteration.

---

## 21.5 Phone-based Anti-abuse

Future development may use verified phone numbers for:

- Identity reinforcement
- Booking limits
- Abuse detection

Do not add phone verification solely for the current Demo.

---

## 21.6 Customer Blacklist / Restrictions

Future merchant functionality may include:

- Restrict booking
- Temporary suspension
- Blacklist
- Restore booking privileges

This is deferred.

---

# 22. Features Explicitly Not Required by the Current Business

The current business consists of:

- One merchant
- One store
- One owner providing the service

Therefore the following functionality does not need to be supported.

---

## 22.1 Payments

Do not implement:

- WeChat Pay
- Booking deposits
- Refund workflows
- Payment reconciliation

---

## 22.2 Multi-tenant Architecture

Do not implement:

- Multiple merchants
- Merchant organizations
- Multi-store management
- Store switching
- Tenant isolation systems

Do not prematurely turn the project into a SaaS platform.

---

## 22.3 Employee Management

Do not implement:

- Employees
- Staff accounts
- Staff schedules
- Shift management
- Technician assignment
- Employee-specific availability
- Multi-resource scheduling
- Multi-employee scheduling

The owner is the only service provider.

---

## 22.4 Business Management Platforms

Do not implement dedicated:

- Analytics platform
- Financial system
- Accounting
- CRM
- Marketing automation
- Customer segmentation
- Revenue reporting platform

Simple Merchant Console summary numbers are acceptable.

For example:

```text
Today's active bookings: 3
```

This does not justify creating an analytics subsystem.

---

# 23. Architecture Principles

## 23.1 Reuse Existing Infrastructure

Prefer modifying existing flows rather than introducing parallel implementations.

For example:

```text
Merchant cancellation
```

should reuse existing appointment cancellation logic where possible instead of implementing independent resource-release logic.

---

## 23.2 Avoid Premature Abstraction

Do not design around hypothetical future:

- SaaS requirements
- Multiple stores
- Multiple employees
- Payments
- Complex resource scheduling

Future requirements may be implemented when they become real requirements.

---

## 23.3 Preserve Cheap Future Extensibility

The next phase will likely add booking-abuse controls.

Therefore:

- Keep booking mutations auditable
- Keep merchant operations server-controlled
- Avoid destroying useful booking history
- Avoid architecture that makes later customer-history analysis unnecessarily difficult

However, this does **not** justify building the future risk system now.

---

## 23.4 Prefer Explicit Commands Over Toggles

State-changing APIs should express the requested target state.

Prefer:

```ts
closeDay();
reopenDay();
cancelAppointment();
```

Avoid ambiguous state toggles such as:

```ts
toggleDay();
```

This reduces retry and concurrency ambiguity.

---

# 24. Testing Strategy

Use targeted validation by default.

Do not automatically execute the full release pipeline after every localized UI or Merchant Console modification.

---

## 24.1 Localized Changes

Prefer:

- Type checking affected code
- Relevant unit tests
- Relevant Merchant Console tests
- Relevant API tests
- Targeted build validation
- Manual verification of the changed flow

Example:

```text
Merchant booking list changed
→ relevant typecheck
→ merchant booking tests
→ verify booking-list flow
```

---

## 24.2 Full Regression

Run broader regression when changes affect shared foundational systems, including:

- Appointment transaction logic
- Booking/resource locking
- Authentication
- Authorization
- Shared database abstractions
- Day availability algorithms
- Global configuration
- Build infrastructure
- Deployment infrastructure
- Shared cloud-function infrastructure

In particular, changes to:

```text
close-day transaction behavior
booking creation transaction behavior
merchant authorization
appointment cancellation resource release
availability / slot calculation
```

require broader relevant regression testing.

A final full validation may also be performed before declaring the Merchant Console Demo complete.

---

# 25. Scope-Control Rules for Workflows and Agents

Automated development workflows must not independently expand product scope.

When implementing a Merchant Console task:

1. Modify only components required by the requested feature.
2. Reuse existing infrastructure whenever practical.
3. Do not add unrelated future functionality.
4. Do not redesign working subsystems without a concrete requirement.
5. Do not introduce multi-tenant architecture.
6. Do not introduce multi-employee abstractions.
7. Do not add abuse-prevention features from the next milestone.
8. Do not interpret ambiguity as permission to add new product scope.
9. Run targeted tests first.
10. Run full regression only when justified by change impact.
11. If an unrelated architectural concern is discovered, document it as future work rather than automatically implementing it.

---

# 26. Acceptance Criteria

The iteration is complete only when the normal flow and critical edge cases below work reliably.

---

## 26.1 Customer → Merchant Happy Path

```text
1. Customer opens the Mini Program.
2. Customer selects a service.
3. Customer books an available time.
4. Booking is created successfully.
5. Merchant opens Merchant Console.
6. Merchant sees the new booking.
7. Merchant opens booking details.
```

---

## 26.2 Authorization

- An authorized merchant can access merchant APIs.
- `getMyMerchantRole()` returns `isMerchant: false` for a normal authenticated user.
- A normal customer cannot access privileged merchant business APIs.
- A normal customer manually constructing a privileged merchant request receives `FORBIDDEN`.
- Merchant role cannot be self-granted by the client.
- Merchant provisioning and revocation are documented.

---

## 26.3 Merchant Cancellation

For a future active booking:

```text
Merchant opens booking
↓
Confirms cancellation
↓
Booking becomes cancelled
↓
Customer sees cancelled state
↓
Booked resource is released
↓
Booking quota/accounting is restored correctly
```

Repeated cancellation must not duplicate the release operation.

If the booking was already successfully cancelled, retries must return the existing cancelled result even after the original booking start time passes.

An active booking whose scheduled start time has passed must not be merchant-cancellable in this iteration.

---

## 26.4 Closing a Day With Existing Bookings

Given:

```text
10:00 booking
13:00 booking
```

when the merchant closes the day:

```text
10:00 booking remains valid
13:00 booking remains valid
new bookings are rejected
```

Existing appointments must not prevent the day from being closed.

---

## 26.5 Explicit Close Idempotency

Given an already manually closed date:

```text
closeDay()
```

again must leave the date closed.

No retry may accidentally reopen the date.

---

## 26.6 Reopening

For a normal business day that was manually closed:

```text
OPEN
↓
MANUALLY_CLOSED
↓
manual close removed
```

the original scheduling policy must be restored.

Existing appointments must remain unchanged.

If existing bookings leave no valid slot for any active service, the day must display:

```text
已约满
```

rather than:

```text
可预约
```

---

## 26.7 Rest Day Safety

A day originally configured as a rest day must not become open merely because the merchant executes the reopen operation.

---

## 26.8 Missing Schedule Safety

A `NOT_GENERATED` day must not be implicitly created by calling `reopenDay()`.

The existing schedule-generation process must remain responsible for creating missing schedule data.

---

## 26.9 Fully Booked Calculation

Given active service durations:

```text
30 min
60 min
90 min
```

if the remaining valid capacity contains a legal 30-minute slot, the date must not be displayed as:

```text
已约满
```

If no active/bookable service has any valid start slot remaining, the date may be displayed as:

```text
已约满
```

---

## 26.10 Business Ended

If today's business hours have already passed, the day must not be displayed as:

```text
已约满
```

solely because no future slots remain.

It should display a time-based status such as:

```text
今日营业已结束
```

---

## 26.11 Dashboard Date Scope

The dashboard must calculate:

- 今日有效预约
- 今日待开始
- 今日下一笔

using the current store day only.

A booking tomorrow must not become today's "next booking."

---

## 26.12 Daily Booking List

The merchant daily list must include:

- Confirmed bookings
- Cancelled bookings

The API must communicate whether the result is complete.

Silent truncation is prohibited.

---

## 26.13 Concurrent Close and Booking

When:

```text
Customer submits booking
```

at the same time as:

```text
Merchant closes the day
```

the final database state must remain consistent.

Either:

```text
booking commits first
→ booking remains
→ day closes afterwards
```

or:

```text
day closes first
→ booking is rejected
```

No booking may bypass an already-committed closed state.

---

## 26.14 Date Mutation Range

Historical dates:

```text
viewable
not mutable
```

Dates outside the supported schedule/booking window must not be silently created or modified by merchant schedule operations.

Dates inside the expected window with missing schedule data must display:

```text
尚未生成
```

rather than being implicitly generated.

---

## 26.15 Customer/Merchant State Synchronization

After merchant cancellation or schedule changes:

- Customer booking state reflects the authoritative backend state.
- Merchant booking state reflects the same authoritative backend state.
- Availability reflects released or closed capacity correctly.

---

## 26.16 Historical Booking Display

A booking that is still:

```text
CONFIRMED
```

but whose time has passed may be displayed as:

```text
预约时间已过
```

It must **not** be displayed as:

```text
已完成
```

because service completion is not tracked in this iteration.

---

# 27. Demo Definition of Done

The Merchant Console Demo is considered ready when the following demonstration can be performed reliably:

```text
Customer
   ↓
Select service
   ↓
Book time
   ↓
Booking created
   ↓
Merchant Console
   ↓
See booking
   ↓
Open booking details
   ↓
Cancel booking
   ↓
Customer sees cancellation
   ↓
Time slot becomes available again
```

and:

```text
Merchant
   ↓
Open schedule
   ↓
Select normal business day
   ↓
Stop new bookings
   ↓
Existing bookings remain
   ↓
Customers cannot create new bookings
   ↓
Merchant reopens day
   ↓
Manual closure is removed
   ↓
Actual availability is recalculated
```

The final status after reopening may be:

```text
可预约
```

or:

```text
已约满
```

depending on remaining valid capacity.

Critical authorization, idempotency, date-range, and concurrency acceptance criteria must also pass.

---

# 28. Product Roadmap

## Current Milestone

```text
Merchant Console Demo
```

Focus:

```text
Customer booking
       ↓
Merchant visibility
       ↓
Merchant management
       ↓
Schedule control
```

---

## Next Milestone

```text
Booking Trust & Abuse Prevention
```

Planned topics:

```text
Malicious booking protection
Customer reputation
No-show
Late cancellation
Phone-based anti-abuse
Blacklist / booking restrictions
```

---

## Not Currently Required

```text
WeChat Pay
Deposits
Multi-merchant
Multi-store
Employees
Employee scheduling
Multi-resource scheduling
Analytics platform
Finance
CRM
```

The project should remain intentionally optimized for the current single-owner, single-store business.
