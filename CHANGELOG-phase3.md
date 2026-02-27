# Phase 3 Changelog — Frontend Modernization

**Date:** 2026-02-27

---

## 1. Image Optimization

### Served Images (public/images/)
Compressed all JPEG/PNG images and generated WebP variants:

| File | Before | After | WebP | Savings |
|------|--------|-------|------|---------|
| dome-pinot-hero.jpeg | 320 KB | 187 KB | 154 KB | 41% |
| PinotLakeView.jpeg | 306 KB | 228 KB | 200 KB | 25% |
| lakeside-cottage-exterior.jpeg | 270 KB | 161 KB | 168 KB | 40% |
| domesmountainview.jpeg | 263 KB | 164 KB | 150 KB | 38% |
| dome-rose-spa1.jpeg | 261 KB | 160 KB | 140 KB | 39% |
| pinotinternal.jpeg | 199 KB | 121 KB | 87 KB | 39% |
| vineyard.jpeg | 192 KB | 115 KB | 98 KB | 40% |
| lakeview.jpeg | 189 KB | 145 KB | 108 KB | 23% |
| **Total** | **2.1 MB** | **1.3 MB** | **1.1 MB** | **35%** |

10 WebP variants created for browsers that support them.

**Tool:** `scripts/optimize-images.py` — reusable for future image additions.

### Root images/ Directory (57 MB — NOT served)
The root `images/` directory is dead weight: only `public/images/` is served via express.static. The audit script (`scripts/audit-images.py`) identified:
- 11 files with copies already in public/images/ (safe to delete)
- 16 files not referenced anywhere (safe to archive)
- 19 files referenced in HTML but missing from public/ (broken refs, need review)

**Recommendation:** Run `python3 scripts/audit-images.py --clean` to archive unused files, then add `images/` to `.gitignore` or delete after verification.

---

## 2. index.html — Inline CSS/JS Extraction

**465 KB → 261 KB (44% reduction)**

### Extracted Files

| File | Size | Contents |
|------|------|----------|
| `public/styles.css` | 59 KB | 2 inline `<style>` blocks (all site CSS) |
| `public/app.js` | 143 KB | 14 inline `<script>` blocks (all site JS) |

### What was removed
- **Cache-buster meta tag** (`<meta name="cache-buster-v2-new" ...>`) — served no purpose
- **Aggressive cache-busting script** (307 bytes) — was forcing full page reloads and breaking browser caching

### What stayed inline
Two small scripts remained inline for performance:
1. Microsoft Clarity analytics snippet (333 bytes)
2. Core Web Vitals observer (491 bytes)

Both are boot-time scripts that benefit from being inline (no extra HTTP request).

### Benefits
- Browser can cache `styles.css` and `app.js` separately from HTML
- CSS loads with `<link>` (render-blocking by default — same behavior as inline)
- JS loads with `defer` — doesn't block HTML parsing
- Each subsequent page load skips 200+ KB of re-downloading inline code

---

## 3. Admin Panel CSS Consolidation

### New: `public/admin-shared.css` (3 KB)
Extracted 20 CSS selectors duplicated across 4+ admin pages into a shared stylesheet. Selectors include `.container`, `body`, `*`, `.btn`, `.header`, `.btn-secondary`, `.nav-buttons`, `.empty-state`, `.form-group`, etc.

All 12 admin pages now load this shared stylesheet:
```html
<link rel="stylesheet" href="/admin-shared.css">
<link rel="stylesheet" href="/admin-shell.css?v=2">
```

The inline styles in each admin page still contain page-specific rules (~3-8 KB each). A future pass could extract those into per-page CSS files.

### Bug Fix: Gallery Path
Fixed `routes/admin-settings.js` gallery endpoint which was using `path.join(__dirname, 'public', 'images')` — incorrect since the file moved to `routes/`. Changed to `path.join(__dirname, '..', 'public', 'images')`.

---

## New Files

```
public/
├── app.js                 143 KB  — extracted inline JavaScript
├── styles.css              59 KB  — extracted inline CSS
├── admin-shared.css         3 KB  — shared admin panel styles
└── images/
    └── *.webp             10 files — WebP variants of all served images

scripts/
├── optimize-images.py       6 KB  — reusable image compression + WebP generator
└── audit-images.py          4 KB  — audit/cleanup tool for unused images
```
