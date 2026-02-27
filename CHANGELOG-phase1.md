# Refactoring Changelog — Phase 1 Implementation

**Date:** February 2026  
**Scope:** Code health, DRY fixes, dead code removal, file cleanup  
**server.js:** 4333 → 4278 lines (-55 lines from server.js, -10,418 lines total including HTML cleanup)

---

## Changes Made

### 1. ✅ Fixed DRY Violation: Property Mapping (EFFICIENCY_REPORT Issue #1)

**Problem:** The `propertyMapping` object was duplicated in 3 separate functions:
- `checkUplistingAvailability()` (line ~747)
- `syncBookingToUplisting()` (line ~842)  
- `getAccommodationFromPropertyId()` (line ~975)

**Fix:** Created `config/properties.js` with:
- `getPropertyId(accommodation)` — forward lookup (name → Uplisting ID)
- `getAccommodationName(propertyId)` — reverse lookup (Uplisting ID → name)
- `getAllMappings()` — for debugging/admin views

All 3 inline definitions replaced with calls to the shared module.

### 2. ✅ Consolidated Sequential DB Queries (EFFICIENCY_REPORT Issue #2)

**Problem:** `/api/admin/stats` ran 5 separate database queries in a `forEach` loop.

**Fix:** Combined into a single SQL query using `CASE` expressions:
```sql
SELECT 
    COUNT(*) as total_bookings,
    COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_bookings,
    COUNT(CASE WHEN status = 'confirmed' THEN 1 END) as confirmed_bookings,
    COALESCE(SUM(CASE WHEN payment_status = 'completed' THEN total_price ELSE 0 END), 0) as total_revenue,
    COUNT(CASE WHEN DATE(created_at) = DATE('now') THEN 1 END) as today_bookings
FROM bookings
```

**Impact:** 5 DB round-trips → 1. Also added proper error handling (previously swallowed errors silently).

### 3. ✅ Removed Dead Code (EFFICIENCY_REPORT Issue #3)

**Removed:** `validateEmailFormat()` function — defined but never called. The codebase uses `express-validator`'s `isEmail()` instead.

### 4. ✅ Fixed Dangerous Internal API Usage (EFFICIENCY_REPORT Issue #4)

**Problem:** Legacy endpoints `/api/process-booking` and `/api/create-booking` used `app._router.handle()` — an undocumented Express internal that could break on any update.

**Fix:** Replaced with proper HTTP `307 Temporary Redirect` to `/api/bookings`. This:
- Uses standard HTTP semantics
- Preserves the POST method and body (307 vs 301/302)
- Doesn't depend on Express internals
- Clearly communicates the deprecation to API consumers

### 5. ✅ Extracted Hardcoded Accommodations Data (EFFICIENCY_REPORT Issue #5)

**Problem:** Accommodation data (names, prices, amenities) was hardcoded inline in the `/api/accommodations` route handler.

**Fix:** Created `config/accommodations.js` with:
- `getAll()` — returns all accommodations
- `getById(id)` — find single accommodation  
- `getValidIds()` — for input validation

The `/api/accommodations` endpoint now reads from this config module.

### 6. ✅ Removed 15 Duplicate HTML Files

**Problem:** 18 HTML files existed both at the repo root AND in `/public/`. Express serves from `/public/`, making root copies dead weight.

**Fix:** 
- Removed 15 files that were byte-identical to their `/public/` counterparts
- Kept 3 files that differ (`admin-bookings.html`, `admin-calendar.html`, `admin-dashboard.html`) — these need manual review to determine which version is correct

**Space saved:** ~10,418 lines of duplicate HTML removed from tracking.

### 7. ✅ Created Environment Validation Module

**New file:** `config/env.js` — centralized environment variable validation that:
- Validates all required vars at startup
- Fails fast in production for critical missing vars (JWT_SECRET, STRIPE_SECRET_KEY)
- Logs warnings for optional missing vars (EMAIL, UPLISTING)
- Provides typed config object instead of scattered `process.env` reads
- Ready for server.js to adopt incrementally

---

## New Files

| File | Lines | Purpose |
|------|-------|---------|
| `config/properties.js` | 52 | Shared Uplisting property ID mapping |
| `config/accommodations.js` | 80 | Accommodation data (was hardcoded) |
| `config/env.js` | 117 | Environment validation & typed config |

## Files Removed

15 duplicate HTML files removed from root (identical copies existed in `/public/`):
`add-booking.html`, `admin-analytics.html`, `admin-content.html`, `admin-inbox.html`, `admin-marketing.html`, `admin-notifications.html`, `admin-pricing.html`, `admin-promotions.html`, `admin-reviews.html`, `admin-security.html`, `backup-system.html`, `gallery-management.html`, `review-responses.html`, `seasonal-rates.html`, `system-settings.html`

## Files Modified

| File | Change |
|------|--------|
| `server.js` | All 5 efficiency report fixes applied, config imports added |

---

## Verification

- ✅ `node --check server.js` passes (no syntax errors)
- ✅ `config/properties.js` — forward and reverse lookups tested
- ✅ `config/accommodations.js` — getAll, getById, getValidIds tested
- ✅ No remaining `propertyMapping` definitions in server.js
- ✅ No broken references to removed HTML files in server.js

## Still Needs Attention

- [ ] 3 root-level HTML files differ from `/public/` versions — manual review needed
- [ ] `config/env.js` is ready but not yet imported in server.js (can replace scattered checks incrementally)
- [ ] ~58 admin routes remain in server.js — should be extracted to `routes/admin-bookings.js`, `routes/admin-monitoring.js`, `routes/admin-settings.js`

---

## Phase 1b: Route Module Extraction

**server.js:** 4278 → 3331 lines (-947 lines, 22% reduction)

### New Directory Structure

```
lakeside-retreat-staging/
├── config/
│   ├── accommodations.js    (80 lines)  — accommodation data
│   ├── env.js               (117 lines) — environment validation
│   └── properties.js        (52 lines)  — Uplisting property mapping
├── middleware/
│   └── auth.js              (194 lines) — verifyAdmin, error helpers, utilities
├── routes/
│   ├── admin-auth.js        (238 lines) — login, verify, 2FA, password, contacts
│   ├── bookings.js          (453 lines) — availability, bookings, payments
│   └── public.js            (396 lines) — accommodations, contact, pricing, chatbot, SEO
└── server.js                (3331 lines) — middleware, webhooks, remaining admin routes
```

### Route Distribution

| Module | Endpoints | Description |
|--------|-----------|-------------|
| `routes/public.js` | 8 | Accommodations, contact, pricing, chatbot, availability calendar, SEO |
| `routes/bookings.js` | 7 | Blocked dates, availability, booking CRUD, payments |
| `routes/admin-auth.js` | 9 | Login, verify, 2FA (4), password, contacts, email |
| `server.js` (remaining) | 58 | Admin bookings, monitoring, marketing, settings, backups, etc. |

### Architecture Pattern

Route modules use a **factory function** pattern for dependency injection:

```javascript
// In route module:
function createBookingRoutes(deps) {
    const { db, stripe, bookingQueue } = deps;
    router.post('/api/bookings', ...);
    return router;
}

// In server.js:
app.use(createBookingRoutes({ db: () => db, stripe, bookingQueue }));
```

This allows route modules to receive shared dependencies (database, Stripe, email, etc.)
without global state or circular imports. The `db` dependency uses a getter function `() => db`
because the database connection is initialized asynchronously after server startup.
