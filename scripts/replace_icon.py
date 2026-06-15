"""
Replace desktop app icon with new icon from project root.
Steps: crop bottom text → make square → generate all sizes → replace old files.

Usage:
  python scripts/replace_icon.py            # Run replacement
  python scripts/replace_icon.py --dry-run  # Preview only, don't write
"""
import sys, os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INPUT = os.path.join(ROOT, "icon.png")
BUILDER_DIR = os.path.join(ROOT, "desktop", "builder")

# Icon sizes needed for Electron desktop app
SIZES = {
    "app-icon.png":    1024,
    "app-icon-512.png": 512,
    "app-icon-256.png": 256,
    "app-icon-128.png": 128,
    "app-icon-64.png":   64,
    "app-icon-32.png":   32,
}

def main():
    img = Image.open(INPUT).convert("RGBA")
    w, h = img.size
    print(f"原始尺寸: {w}x{h}")

    # ── Step 1: Crop at verified boundary ──
    # The image has: icon content (0-67%) → empty separator (67-69%) → bottom text (71%+)
    # Crop at 67% — cleanly inside the empty separator zone
    crop_y = int(h * 67 / 100)
    print(f"裁剪线: Y={crop_y} (67%) — 空白分隔带")

    # ── Step 2: Crop to icon area ──
    cropped = img.crop((0, 0, w, crop_y))
    cw, ch = cropped.size
    print(f"裁剪后尺寸: {cw}x{ch}")

    # ── Step 3: Make square ──
    side = min(cw, ch)
    left = (cw - side) // 2
    top = (ch - side) // 2
    square = cropped.crop((left, top, left + side, top + side))
    print(f"方形图标: {square.size[0]}x{square.size[1]}")

    if "--dry-run" in sys.argv:
        print("\n[干跑模式] 未写入文件。预览图已生成到 icon-preview.png")
        square.resize((512, 512), Image.LANCZOS).save(os.path.join(ROOT, "icon-preview.png"))
        return

    # ── Step 4: Generate all sizes and replace ──
    os.makedirs(BUILDER_DIR, exist_ok=True)

    # Backup old icons
    backup_dir = os.path.join(BUILDER_DIR, "backup")
    os.makedirs(backup_dir, exist_ok=True)
    for fname in list(SIZES.keys()) + ["app-icon.ico"]:
        src = os.path.join(BUILDER_DIR, fname)
        if os.path.exists(src):
            import shutil
            shutil.copy2(src, os.path.join(backup_dir, fname))

    # Generate PNG sizes
    for fname, size in SIZES.items():
        resized = square.resize((size, size), Image.LANCZOS)
        path = os.path.join(BUILDER_DIR, fname)
        resized.save(path)
        print(f"  [OK] {fname} ({size}x{size})")

    # Generate .ico (Windows — embed multiple sizes)
    ico_sizes = [(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)]
    ico_frames = [square.resize(s, Image.LANCZOS) for s in ico_sizes]
    ico_path = os.path.join(BUILDER_DIR, "app-icon.ico")
    ico_frames[0].save(ico_path, format="ICO", sizes=[s for s in ico_sizes])
    print(f"  [OK] app-icon.ico ({[f'{a}x{b}' for a,b in ico_sizes]})")

    print(f"\n旧图标已备份到: {backup_dir}")
    print("桌面端图标替换完成。重新构建桌面版即可生效。")

if __name__ == "__main__":
    main()
