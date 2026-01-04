# Code Efficiency Report - Lakeside Retreat Staging

## Overview
This report documents several inefficiencies identified in the codebase that could be improved for better performance, maintainability, and code quality.

---

## 1. Repeated Property Mapping Objects (DRY Violation)

**Location:** `server.js` - Lines 384-388, 478-482, 618-622

**Issue:** The `propertyMapping` object that maps accommodation names to Uplisting property IDs is defined three separate times in different functions:

- `checkUplistingAvailability()` (lines 384-388)
- `syncBookingToUplisting()` (lines 478-482)  
- `getAccommodationFromPropertyId()` (lines 618-622)

**Current Code:**
```javascript
// Repeated in checkUplistingAvailability
const propertyMapping = {
    'dome-pinot': process.env.UPLISTING_PROPERTY_PINOT_ID,
    'dome-rose': process.env.UPLISTING_PROPERTY_ROSE_ID,
    'lakeside-cottage': process.env.UPLISTING_PROPERTY_COTTAGE_ID
};

// Repeated in syncBookingToUplisting
const propertyMapping = {
    'dome-pinot': process.env.UPLISTING_PROPERTY_PINOT_ID,
    'dome-rose': process.env.UPLISTING_PROPERTY_ROSE_ID,
    'lakeside-cottage': process.env.UPLISTING_PROPERTY_COTTAGE_ID
};

// Repeated in getAccommodationFromPropertyId (reverse mapping)
const propertyMapping = {
    [process.env.UPLISTING_PROPERTY_PINOT_ID]: 'dome-pinot',
    [process.env.UPLISTING_PROPERTY_ROSE_ID]: 'dome-rose',
    [process.env.UPLISTING_PROPERTY_COTTAGE_ID]: 'lakeside-cottage'
};
```

**Impact:** 
- Code duplication increases maintenance burden
- Changes to property mappings require updates in multiple places
- Risk of inconsistencies if one mapping is updated but others are not

**Recommended Fix:** Define the mapping once at module level and create helper functions for both forward and reverse lookups.

---

## 2. Sequential Database Queries in Admin Stats Endpoint

**Location:** `server.js` - Lines 1166-1199

**Issue:** The `/api/admin/stats` endpoint executes 5 separate database queries sequentially using a forEach loop with callbacks, rather than combining them into a single efficient query.

**Current Code:**
```javascript
const queries = [
    'SELECT COUNT(*) as total_bookings FROM bookings',
    'SELECT COUNT(*) as pending_bookings FROM bookings WHERE status = "pending"',
    'SELECT COUNT(*) as confirmed_bookings FROM bookings WHERE status = "confirmed"',
    'SELECT SUM(total_price) as total_revenue FROM bookings WHERE payment_status = "completed"',
    'SELECT COUNT(*) as today_bookings FROM bookings WHERE DATE(created_at) = DATE("now")'
];

queries.forEach((query, index) => {
    db.get(query, (err, row) => {
        // ... handling
    });
});
```

**Impact:**
- 5 separate database round-trips instead of 1
- Increased latency for the API response
- Higher database load

**Recommended Fix:** Combine into a single SQL query:
```javascript
const sql = `
    SELECT 
        COUNT(*) as total_bookings,
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_bookings,
        COUNT(CASE WHEN status = 'confirmed' THEN 1 END) as confirmed_bookings,
        SUM(CASE WHEN payment_status = 'completed' THEN total_price ELSE 0 END) as total_revenue,
        COUNT(CASE WHEN DATE(created_at) = DATE('now') THEN 1 END) as today_bookings
    FROM bookings
`;
```

---

## 3. Unused Function Definition

**Location:** `server.js` - Lines 342-345

**Issue:** The `validateEmailFormat` function is defined but never used anywhere in the codebase. The code uses express-validator's `isEmail()` method instead.

**Current Code:**
```javascript
function validateEmailFormat(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}
```

**Impact:**
- Dead code increases bundle size
- Confuses developers reading the codebase
- Maintenance overhead for unused code

**Recommended Fix:** Remove the unused function.

---

## 4. Redundant API Endpoint

**Location:** `server.js` - Lines 858-862

**Issue:** The `/api/create-booking` endpoint exists solely to redirect to `/api/process-booking` using an unusual internal router handling method.

**Current Code:**
```javascript
app.post('/api/create-booking', bookingLimiter, validateBooking, async (req, res) => {
    return app._router.handle({ ...req, url: '/api/process-booking', method: 'POST' }, res);
});
```

**Impact:**
- Confusing code pattern
- Uses internal Express API (`_router`) which could break with updates
- Adds unnecessary middleware execution overhead

**Recommended Fix:** Either remove the endpoint and update clients to use `/api/process-booking`, or have both endpoints call a shared handler function.

---

## 5. Hardcoded Accommodations Data

**Location:** `server.js` - Lines 192-228

**Issue:** Accommodation data (names, prices, amenities) is hardcoded directly in the `/api/accommodations` endpoint rather than being stored in a configuration file or database.

**Impact:**
- Requires code deployment to update accommodation details
- Cannot be managed by non-technical staff
- Duplicates data that may exist elsewhere (e.g., in Uplisting)

**Recommended Fix:** Move accommodation data to a configuration file or database table that can be updated without code changes.

---

## Summary

| Issue | Severity | Effort to Fix |
|-------|----------|---------------|
| Repeated Property Mapping | Medium | Low |
| Sequential DB Queries | Medium | Low |
| Unused Function | Low | Very Low |
| Redundant Endpoint | Low | Low |
| Hardcoded Data | Low | Medium |

---

## Selected Fix

For this PR, we will fix **Issue #1: Repeated Property Mapping Objects** as it represents a clear DRY violation that is straightforward to fix and improves code maintainability.
