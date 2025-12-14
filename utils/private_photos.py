#!/usr/bin/env python3

import sys
from pathlib import Path
from PIL import Image

def strip_metadata(input_dir: Path, output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)

    jpg_files = list(input_dir.rglob("*.jpg")) + list(input_dir.rglob("*.jpeg")) + list(input_dir.rglob("*.JPG")) + list(input_dir.rglob("*.JPEG"))

    if not jpg_files:
        print("No JPG files found.")
        return

    for src in jpg_files:
        rel_path = src.relative_to(input_dir)
        dst = output_dir / rel_path
        dst.parent.mkdir(parents=True, exist_ok=True)

        try:
            with Image.open(src) as img:
                # 🔑 Create a new image without EXIF by copying pixel data
                data = list(img.getdata())
                clean = Image.new(img.mode, img.size)
                clean.putdata(data)

                # Preserve ICC profile if you want color accuracy (optional)
                icc = img.info.get("icc_profile")

                save_kwargs = {
                    "format": "JPEG",
                    "quality": 95,
                    "subsampling": 0,
                    "optimize": True
                }

                if icc:
                    save_kwargs["icc_profile"] = icc

                clean.save(dst, **save_kwargs)

                print(f"✔ Stripped: {src} → {dst}")

        except Exception as e:
            print(f"✖ Failed: {src} ({e})")

def main():
    if len(sys.argv) != 3:
        print("Usage: strip_jpeg_metadata.py <input_dir> <output_dir>")
        sys.exit(1)

    input_dir = Path(sys.argv[1]).expanduser().resolve()
    output_dir = Path(sys.argv[2]).expanduser().resolve()

    if not input_dir.is_dir():
        print(f"Input directory does not exist: {input_dir}")
        sys.exit(1)

    strip_metadata(input_dir, output_dir)

if __name__ == "__main__":
    main()
