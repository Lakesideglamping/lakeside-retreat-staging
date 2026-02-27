# Phase 4 Changelog — Security & Reliability

**Date:** 2026-02-27  
**server.js:** 1,330 → 1,230 lines (also cleaned 61 stale [MOVED] comments)

---

## 1. Content Security Policy Hardening

**File:** `server.js` (helmet configuration)

### Changes
- **Added** `frameAncestors: ["'self'"]` — clickjacking protection via CSP (more reliable than X-Frame-Options)
- **Added** `workerSrc: ["'self'"]` — restricts service worker sources
- **Added** `manifestSrc: ["'self'"]` — restricts web manifest sources
- **Added** `https://cdnjs.cloudflare.com` to `styleSrc` and `fontSrc` — for Font Awesome CDN
- **Added** `https://connect.uplisting.io` to `connectSrc` — for Uplisting API calls
- **Documented** why `unsafe-inline` must remain: 2 inline analytics scripts + 232 inline event handlers in index.html

### What blocks full `unsafe-inline` removal
The index.html has 232 `onclick`/`onchange`/etc inline event handlers that would need to be refactored to `addEventListener()` calls in `app.js`. This is a Phase 5 candidate — it's a safe, mechanical refactor but touches every interactive element in the SPA.

---

## 2. Comprehensive Error Handling & Graceful Shutdown

**New file:** `middleware/error-handler.js` (169 lines)

### Express Error Middleware
Catches all unhandled errors in route handlers:
- Structured JSON error logging with request context (method, URL, IP, user-agent)
- Specific handlers for: JSON parse errors, CSRF failures, Stripe errors, SQLite BUSY
- Production mode hides stack traces; dev mode includes them
- Proper HTTP status codes for each error type

### Process-Level Error Handlers
Prevents silent crashes:
- `uncaughtException` — logs, flushes, exits with code 1
- `unhandledRejection` — logs but continues (non-fatal)
- `warning` — logs Node.js deprecation/resource warnings

### Graceful Shutdown
On SIGTERM (Render deploy) or SIGINT (Ctrl+C):
1. Stops accepting new connections
2. Waits up to 10 seconds for in-flight requests to complete
3. Closes database connection cleanly
4. Exits with code 0

Previously, the server had no shutdown handler — Render would SIGTERM it and the process would die immediately, potentially corrupting in-flight database writes.

---

## 3. Automated Backup Verification

**New file:** `services/backup-verify.js` (254 lines)

### Verification Checks
1. **File existence & size** — catches empty/missing backups
2. **SHA-256 checksum** — detects corruption
3. **Table integrity** — opens the backup SQLite file and queries all 6 tables
4. **Live comparison** — compares row counts against the running database
5. **Verification manifest** — writes a `.verify.json` alongside each backup

### API
```javascript
const { verifyBackup, verifyLatestBackup, verifyAllBackups } = require('./services/backup-verify');

// Verify a specific backup against the live DB
const result = await verifyBackup('./backups/lakeside-backup-2026-02-27.db', liveDb);
// result.passed → true/false
// result.checks → { fileSize, checksum, backupTables, liveTables, discrepancies }
// result.errors → ['...']

// Verify the most recent backup
const latest = await verifyLatestBackup(liveDb);

// Verify all backups
const report = await verifyAllBackups(liveDb);
// report → { total: 30, passed: 29, failed: 1, results: [...] }
```

### Integration Point
The admin backups route (`POST /api/admin/backups`) should call `verifyBackup()` after creating each backup. This can be wired in the next deployment.

---

## 4. Per-User Admin Rate Limiting

**New file:** `middleware/rate-limit.js` (179 lines)

### Problem
The existing rate limiters (`generalLimiter`, `bookingLimiter`, `adminLimiter`) all use IP-based limiting. For admin endpoints, this means:
- A compromised JWT could make unlimited requests if the attacker uses multiple IPs
- Legitimate admins behind a shared IP (office NAT) could block each other

### Solution
A `SlidingWindowLimiter` class that tracks requests per identity key (JWT user ID, not IP):

| Limiter | Window | Max Requests | Purpose |
|---------|--------|-------------|---------|
| `adminActionLimiter` | 5 min | 30 | Write operations (create/update) |
| `adminBurstLimiter` | 1 min | 200 | Read operations (prevents DDoS via stolen JWT) |
| `adminDestructiveLimiter` | 10 min | 5 | Deletes, refunds |

### Features
- Sliding window (not fixed window) — no burst-at-boundary exploit
- Standard `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `Retry-After` headers
- Automatic cleanup of stale entries every 60 seconds
- Generic `rateLimitByKey()` factory for custom limiters
- Passed to admin route modules via dependency injection

### Usage
```javascript
// In route modules:
router.delete('/api/admin/booking/:id', verifyAdmin, adminDestructiveLimiter, handler);
router.post('/api/admin/bookings', verifyAdmin, adminActionLimiter, handler);
```

---

## Summary: server.js Through All Phases

| Phase | Lines | Reduction |
|-------|-------|-----------|
| Original | 4,278 | — |
| Phase 1 (DRY, config extraction) | 4,278 → 3,331 | -22% |
| Phase 1b (Route extraction) | 3,331 → 1,501 | -55% |
| Phase 2 (Migrations, Uplisting service, env validation) | 1,501 → 1,330 | -11% |
| Phase 4 (Error handling, security, cleanup) | 1,330 → 1,230 | -8% |
| **Total** | **4,278 → 1,230** | **-71%** |
