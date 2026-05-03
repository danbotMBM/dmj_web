#!/usr/bin/env python3

import sys
from pathlib import Path
from PIL import Image, ImageOps

def _collect_jpgs(input_dir: Path):
    return (
        list(input_dir.rglob("*.jpg"))
        + list(input_dir.rglob("*.jpeg"))
        + list(input_dir.rglob("*.JPG"))
        + list(input_dir.rglob("*.JPEG"))
    )

def strip_files(files, output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    _strip(((src, output_dir / (src.stem + ".jpg")) for src in files))

def strip_metadata(input_dir: Path, output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)

    jpg_files = _collect_jpgs(input_dir)

    if not jpg_files:
        print("No JPG files found.")
        return

    pairs = []
    for src in jpg_files:
        rel_path = src.relative_to(input_dir)
        dst = output_dir / rel_path
        dst.parent.mkdir(parents=True, exist_ok=True)
        pairs.append((src, dst))
    _strip(pairs)

def _strip(pairs) -> None:
    for src, dst in pairs:
        dst.parent.mkdir(parents=True, exist_ok=True)

        try:
            with Image.open(src) as img:
                img = ImageOps.exif_transpose(img)  # bake in EXIF orientation before stripping
                # Create a new image without EXIF by copying pixel data
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
    if len(sys.argv) < 3:
        print("Usage: private_photos.py <output_dir> <input_dir | file1 [file2 ...]>")
        print("   or: private_photos.py <input_dir> <output_dir>  (legacy)")
        sys.exit(1)

    args = [Path(a).expanduser().resolve() for a in sys.argv[1:]]

    # Legacy form: exactly 2 args, first is an existing directory
    if len(args) == 2 and args[0].is_dir() and (not args[1].exists() or args[1].is_dir()):
        strip_metadata(args[0], args[1])
        return

    # New form: first arg is output dir, rest are files or a single input dir
    output_dir = args[0]
    rest = args[1:]
    if len(rest) == 1 and rest[0].is_dir():
        strip_metadata(rest[0], output_dir)
        return

    files = [p for p in rest if p.is_file()]
    missing = [p for p in rest if not p.is_file()]
    for p in missing:
        print(f"Skipping (not a file): {p}")
    if not files:
        print("No input files found.")
        sys.exit(1)
    strip_files(files, output_dir)

if __name__ == "__main__":
    main()
