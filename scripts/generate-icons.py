"""
从 SVG 生成 PinBoard 各尺寸图标（Inkscape 出主图，LANCZOS 降采样）。
用法: python scripts/generate-icons.py
"""
from __future__ import annotations

import struct
import subprocess
import tempfile
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ICONS = ROOT / "src-tauri" / "icons"
SVG = ICONS / "icon.svg"
INKSCAPE = Path(r"D:\software\Inkscape\bin\inkscape.com")
MASTER_SIZE = 1024


def export_master(dest: Path) -> None:
    cmd = [
        str(INKSCAPE),
        str(SVG),
        f"--export-filename={dest}",
        f"--export-width={MASTER_SIZE}",
        f"--export-height={MASTER_SIZE}",
        "--export-background-opacity=0",
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise SystemExit(proc.stderr or proc.stdout or "Inkscape export failed")


def write_ico(path: Path, images: list[Image.Image]) -> None:
    """多尺寸 PNG 压缩 ICO（现代 Windows）。"""
    png_blobs: list[bytes] = []
    for im in images:
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
            tmp_path = Path(tmp.name)
        try:
            im.save(tmp_path, format="PNG", optimize=True)
            png_blobs.append(tmp_path.read_bytes())
        finally:
            tmp_path.unlink(missing_ok=True)

    offset = 6 + 16 * len(png_blobs)
    entries = []
    for im, blob in zip(images, png_blobs):
        bw = 0 if im.width >= 256 else im.width
        bh = 0 if im.height >= 256 else im.height
        entries.append(struct.pack("<BBBBHHII", bw, bh, 0, 0, 1, 32, len(blob), offset))
        offset += len(blob)

    header = struct.pack("<HHH", 0, 1, len(png_blobs))
    path.write_bytes(header + b"".join(entries) + b"".join(png_blobs))


def main() -> None:
    if not INKSCAPE.exists():
        raise SystemExit(f"找不到 Inkscape: {INKSCAPE}")
    if not SVG.exists():
        raise SystemExit(f"找不到 SVG: {SVG}")

    ICONS.mkdir(parents=True, exist_ok=True)
    master_path = ICONS / "_master_1024.png"
    export_master(master_path)
    master = Image.open(master_path).convert("RGBA")

    targets = {
        "32x32.png": 32,
        "128x128.png": 128,
        "128x128@2x.png": 256,
        "icon.png": 512,
    }
    for name, size in targets.items():
        out = master.resize((size, size), Image.Resampling.LANCZOS)
        out.save(ICONS / name, format="PNG", optimize=True)
        print(f"wrote {name} ({size}x{size})")

    ico_sizes = [16, 24, 32, 48, 64, 128, 256]
    ico_images = [master.resize((s, s), Image.Resampling.LANCZOS) for s in ico_sizes]
    write_ico(ICONS / "icon.ico", ico_images)
    print("wrote icon.ico")

    master_path.unlink(missing_ok=True)
    print("done")


if __name__ == "__main__":
    main()
