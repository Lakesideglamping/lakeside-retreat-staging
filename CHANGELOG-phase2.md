# Phase 2 Changelog — Architecture & Data Layer

**Date:** 2026-02-27  
**server.js:** 3,331 → 1,330 lines (60% further reduction, 69% total from original 4,278)

---

## 1. Database Migration System

**New files:** `migrations/runner.js`, `migrations/001_baseline_schema.js`, `migrations/002_add_indexes.js`

### Problem
Schema was managed by duplicated `CREATE TABLE IF NOT EXISTS` blocks in `database.js` — one for PostgreSQL, one for SQLite (12 definitions total). No way to evolve the schema incrementally, track what's been applied, or roll back.

### Solution
A lightweight migration runner that:
- Tracks applied migrations in a `schema_migrations` table
- Auto-discovers numbered `.js` files in the `migrations/` directory
- Runs pending migrations in order at startup
- Supports rollback via `down()` functions
- Works with both SQLite and PostgreSQL

### Migrations
| File | Description |
|------|-------------|
| `001_baseline_schema.js` | Captures existing 6-table schema (idempotent — safe for existing DBs) |
| `002_add_indexes.js` | Adds 8 performance indexes (previously only in `db.js`, not `database.js`) |

### Usage
```javascript
// Runs automatically at startup in server.js
const { runMigrations } = require('./migrations/runner');
await runMigrations(db, database);

// To add a new migration:
// 1. Create migrations/003_your_description.js
// 2. Export: { up(db, isPostgres), down(db, isPostgres) }
// 3. Restart — runner picks it up automatically
```

---

## 2. Uplisting Service Module

**New file:** `services/uplisting.js` (424 lines)  
**Replaces:** 5 scattered functions in server.js + `uplisting-dashboard-api.js` + `uplisting-pricing-integration.js`

### Problem
Uplisting PMS integration was spread across 4 files with duplicated auth headers, inconsistent error handling, and no shared configuration.

### Solution
A single `UplistingService` class with:

| Method | Replaces |
|--------|----------|
| `checkAvailability()` | `checkUplistingAvailability()` in server.js |
| `syncBooking()` | `syncBookingToUplisting()` in server.js |
| `cancelBooking()` | `cancelUplistingBooking()` in server.js |
| `handleWebhook()` | `handleUplistingWebhook()` in server.js |
| `getDashboardData()` | `getUplistingDashboardData()` in uplisting-dashboard-api.js |
| `getPricingData()` | `getUplistingRealPricing()` in uplisting-pricing-integration.js |

The service is instantiated once at startup with the API key and DB getter, eliminating the pattern of checking `process.env.UPLISTING_API_KEY` at the top of every function.

### Backward Compatibility
Old function names in server.js now delegate to the service:
```javascript
async function syncBookingToUplisting(bookingData) {
    return uplisting ? uplisting.syncBooking(bookingData) : null;
}
```
Route modules receive these wrapper functions via dependency injection, so no changes needed to route files.

---

## 3. Environment Config Validation (Wired In)

**Updated file:** `config/env.js` (created in Phase 1, now imported in server.js)

### Problem
Environment variable checks were scattered across the top of server.js with inconsistent handling — some called `process.exit(1)`, some set defaults, some just warned.

### Solution
`config/env.js` is now imported at server startup, replacing ~20 lines of ad-hoc checks. It:
- Fails fast in production if critical vars are missing (`JWT_SECRET`, `STRIPE_SECRET_KEY`)
- Logs warnings for optional vars (`UPLISTING_API_KEY`, `EMAIL_*`)
- Sets development defaults for non-critical vars
- Provides a typed config object for clean access

---

## Project Structure After Phase 2

```
lakeside-retreat-staging/
├── config/
│   ├── accommodations.js     80 lines  — accommodation data
│   ├── env.js               120 lines  — environment validation ✅ wired in
│   └── properties.js         52 lines  — Uplisting property mapping
├── middleware/
│   └── auth.js              194 lines  — verifyAdmin, error helpers
├── migrations/
│   ├── runner.js            155 lines  — migration runner ✨ NEW
│   ├── 001_baseline_schema.js 217 lines  — baseline tables ✨ NEW
│   └── 002_add_indexes.js    46 lines  — performance indexes ✨ NEW
├── routes/
│   ├── admin-auth.js        238 lines  — login, 2FA, password
│   ├── admin-bookings.js    917 lines  — booking CRUD, deposits, Uplisting
│   ├── admin-operations.js  576 lines  — monitoring, analytics, marketing
│   ├── admin-settings.js    603 lines  — rates, gallery, reviews, backups
│   ├── bookings.js          453 lines  — availability, bookings, payments
│   └── public.js            396 lines  — accommodations, contact, chatbot, SEO
├── services/
│   └── uplisting.js         424 lines  — Uplisting PMS integration ✨ NEW
├── database.js              604 lines  — DB abstraction (SQLite/PostgreSQL)
└── server.js               1330 lines  — middleware, webhooks, startup
```

## What Remains

- `database.js` still has duplicate `createTablesPostgres()` / `createTablesSqlite()` — these can now be removed once migrations are confirmed working in production, since `001_baseline_schema.js` handles table creation
- `db.js` (111 lines) is a legacy PostgreSQL-only file that can be removed (superseded by `database.js`)
- `uplisting-dashboard-api.js` and `uplisting-pricing-integration.js` can be deleted (superseded by `services/uplisting.js`)
