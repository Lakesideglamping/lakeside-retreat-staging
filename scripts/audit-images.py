#!/usr/bin/env python3
"""
Audit and clean up the root images/ directory.

The site serves images from public/images/ (via express.static).
The root images/ directory (57 MB) is NOT served and contains:
- Original unoptimized photos (some 5-10 MB each)
- Files referenced in index.html via responsive subdirectories 
  (Desktop/, MobileLarge/, MobileSmall/, Tablet/) that don't exist

This script:
1. Reports which root images are referenced in HTML but not served
2. Identifies which root images have equivalents in public/images/
3. Recommends safe deletions

Usage:
    python3 scripts/audit-images.py           # Report only
    python3 scripts/audit-images.py --clean   # Move unused to images/_archive/
"""

import os
import re
import sys
import shutil
from pathlib import Path

ROOT_IMAGES = Path('images')
PUBLIC_IMAGES = Path('public/images')
HTML_FILE = Path('public/index.html')


def main():
    clean = '--clean' in sys.argv

    if not ROOT_IMAGES.exists():
        print('Root images/ directory not found — already cleaned up?')
        return

    # Get all root images
    root_files = list(ROOT_IMAGES.glob('*'))
    root_images = [f for f in root_files if f.suffix.lower() in ('.jpg', '.jpeg', '.png', '.webp', '.gif', '.ico')]
    
    # Get public images
    public_images = set(f.name.lower() for f in PUBLIC_IMAGES.glob('*'))
    
    # Get HTML references
    html = HTML_FILE.read_text()
    html_refs = set(re.findall(r'images/([^\"\'\)\s]+)', html))
    
    print(f'Root images/: {len(root_images)} files, {sum(f.stat().st_size for f in root_images) / 1024 / 1024:.1f} MB')
    print(f'Public images/: {len(public_images)} files')
    print(f'HTML references: {len(html_refs)} unique paths')
    print()

    # Categorize
    has_public_copy = []
    referenced_but_missing = []
    unreferenced = []

    for img in root_images:
        name_lower = img.name.lower()
        # Check if it has a copy in public/images/
        if name_lower in public_images:
            has_public_copy.append(img)
        # Check if referenced in HTML
        elif img.name in html_refs:
            referenced_but_missing.append(img)
        else:
            unreferenced.append(img)

    print('=== Already in public/images/ (safe to delete from root) ===')
    for f in has_public_copy:
        print(f'  {f.name} ({f.stat().st_size / 1024:.0f} KB)')
    
    print(f'\n=== Referenced in HTML but not in public/images/ (broken refs) ===')
    for f in referenced_but_missing:
        print(f'  {f.name} ({f.stat().st_size / 1024:.0f} KB)')
    
    print(f'\n=== Not referenced anywhere (safe to archive/delete) ===')
    for f in unreferenced:
        print(f'  {f.name} ({f.stat().st_size / 1024:.0f} KB)')
    
    total_removable = sum(f.stat().st_size for f in has_public_copy + unreferenced)
    print(f'\nSafe to remove: {len(has_public_copy) + len(unreferenced)} files, {total_removable / 1024 / 1024:.1f} MB')
    print(f'Needs review: {len(referenced_but_missing)} files (referenced in HTML but missing from public/)')
    
    if clean:
        archive_dir = ROOT_IMAGES / '_archive'
        archive_dir.mkdir(exist_ok=True)
        
        moved = 0
        for f in has_public_copy + unreferenced:
            shutil.move(str(f), str(archive_dir / f.name))
            moved += 1
        
        print(f'\nMoved {moved} files to images/_archive/')
        print('Review images/_archive/ then delete when ready:')
        print('  rm -rf images/_archive/')


if __name__ == '__main__':
    main()
