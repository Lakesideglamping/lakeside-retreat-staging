#!/usr/bin/env python3
"""
Image Optimization Script for Lakeside Retreat

Compresses JPEG/PNG images and generates WebP variants for all images
in public/images/. Run this after adding new images.

Usage:
    python3 scripts/optimize-images.py                    # Optimize all
    python3 scripts/optimize-images.py --dry-run          # Preview changes
    python3 scripts/optimize-images.py --quality 80       # Custom quality
    python3 scripts/optimize-images.py public/images/foo.jpg  # Single file

Requires: pip install Pillow
"""

import os
import sys
import argparse
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    print("❌ Pillow not installed. Run: pip install Pillow")
    sys.exit(1)

# Defaults
DEFAULT_JPEG_QUALITY = 82
DEFAULT_WEBP_QUALITY = 80
DEFAULT_PNG_OPTIMIZE = True
MAX_DIMENSION = 2400  # Don't upscale, but cap oversized images
SKIP_IF_SMALLER_THAN = 5 * 1024  # Don't bother with < 5 KB files

IMAGE_DIR = Path(__file__).parent.parent / "public" / "images"


def get_file_size(path):
    return os.path.getsize(path)


def format_size(bytes_val):
    if bytes_val < 1024:
        return f"{bytes_val} B"
    elif bytes_val < 1024 * 1024:
        return f"{bytes_val / 1024:.1f} KB"
    else:
        return f"{bytes_val / (1024 * 1024):.1f} MB"


def optimize_image(filepath, jpeg_quality=DEFAULT_JPEG_QUALITY,
                   webp_quality=DEFAULT_WEBP_QUALITY, dry_run=False):
    """Optimize a single image file. Returns dict with stats."""
    filepath = Path(filepath)
    original_size = get_file_size(filepath)
    ext = filepath.suffix.lower()
    stats = {
        "file": str(filepath.name),
        "original_size": original_size,
        "new_size": original_size,
        "webp_size": 0,
        "skipped": False,
        "error": None,
    }

    if original_size < SKIP_IF_SMALLER_THAN:
        stats["skipped"] = True
        return stats

    try:
        img = Image.open(filepath)

        # Cap oversized images
        w, h = img.size
        if max(w, h) > MAX_DIMENSION:
            ratio = MAX_DIMENSION / max(w, h)
            new_w, new_h = int(w * ratio), int(h * ratio)
            img = img.resize((new_w, new_h), Image.LANCZOS)

        # Optimize JPEG
        if ext in (".jpg", ".jpeg"):
            if not dry_run:
                # Convert CMYK to RGB if needed
                if img.mode in ("CMYK", "P", "RGBA"):
                    img = img.convert("RGB")
                img.save(filepath, "JPEG", quality=jpeg_quality, optimize=True,
                         progressive=True)
            stats["new_size"] = get_file_size(filepath) if not dry_run else int(original_size * 0.65)

        # Optimize PNG
        elif ext == ".png":
            if not dry_run:
                img.save(filepath, "PNG", optimize=True)
            stats["new_size"] = get_file_size(filepath) if not dry_run else int(original_size * 0.85)

        # Generate WebP variant
        webp_path = filepath.with_suffix(".webp")
        if not webp_path.exists() or not dry_run:
            if img.mode in ("CMYK", "P"):
                img = img.convert("RGB")
            elif img.mode == "RGBA" and ext in (".jpg", ".jpeg"):
                img = img.convert("RGB")

            if not dry_run:
                img.save(webp_path, "WEBP", quality=webp_quality, method=4)
            stats["webp_size"] = get_file_size(webp_path) if not dry_run else int(original_size * 0.5)

        img.close()

    except Exception as e:
        stats["error"] = str(e)

    return stats


def main():
    parser = argparse.ArgumentParser(description="Optimize images for Lakeside Retreat")
    parser.add_argument("files", nargs="*", help="Specific files to optimize (default: all in public/images/)")
    parser.add_argument("--dry-run", action="store_true", help="Preview without modifying")
    parser.add_argument("--quality", type=int, default=DEFAULT_JPEG_QUALITY, help=f"JPEG quality (default: {DEFAULT_JPEG_QUALITY})")
    parser.add_argument("--webp-quality", type=int, default=DEFAULT_WEBP_QUALITY, help=f"WebP quality (default: {DEFAULT_WEBP_QUALITY})")
    args = parser.parse_args()

    if args.files:
        files = [Path(f) for f in args.files]
    else:
        files = sorted(IMAGE_DIR.glob("*"))
        files = [f for f in files if f.suffix.lower() in (".jpg", ".jpeg", ".png")]

    if not files:
        print("No images found to optimize")
        return

    print(f"{'[DRY RUN] ' if args.dry_run else ''}Optimizing {len(files)} images...")
    print(f"  JPEG quality: {args.quality}, WebP quality: {args.webp_quality}")
    print()

    total_original = 0
    total_new = 0
    total_webp = 0
    results = []

    for f in files:
        stats = optimize_image(f, jpeg_quality=args.quality,
                               webp_quality=args.webp_quality, dry_run=args.dry_run)
        results.append(stats)
        total_original += stats["original_size"]
        total_new += stats["new_size"]
        total_webp += stats["webp_size"]

        if stats["error"]:
            print(f"  ❌ {stats['file']}: {stats['error']}")
        elif stats["skipped"]:
            print(f"  ⏭️  {stats['file']}: skipped (< {SKIP_IF_SMALLER_THAN // 1024} KB)")
        else:
            saved = stats["original_size"] - stats["new_size"]
            pct = (saved / stats["original_size"] * 100) if stats["original_size"] > 0 else 0
            webp_info = f", WebP: {format_size(stats['webp_size'])}" if stats["webp_size"] else ""
            print(f"  ✅ {stats['file']}: {format_size(stats['original_size'])} → {format_size(stats['new_size'])} (-{pct:.0f}%){webp_info}")

    print()
    saved = total_original - total_new
    print(f"Total: {format_size(total_original)} → {format_size(total_new)} (saved {format_size(saved)})")
    if total_webp:
        print(f"WebP variants: {format_size(total_webp)} total")
    print(f"{'[DRY RUN] No files modified' if args.dry_run else 'Done!'}")


if __name__ == "__main__":
    main()
