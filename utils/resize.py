import os
import sys
import argparse
from PIL import Image, ImageOps

def downscale_images(output_dir, image_paths, scale_percent):
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)

    for image_path in image_paths:
        try:
            with Image.open(image_path) as img:
                img = ImageOps.exif_transpose(img)  # <- Correct orientation
                original_size = img.size
                new_size = (
                    int(original_size[0] * scale_percent / 100),
                    int(original_size[1] * scale_percent / 100)
                )
                resized_img = img.resize(new_size, Image.ANTIALIAS)

                output_path = os.path.join(output_dir, os.path.basename(image_path))
                resized_img.save(output_path)
                print(f"Saved downscaled image to: {output_path}")
        except Exception as e:
            print(f"Error processing {image_path}: {e}")

def main():
    parser = argparse.ArgumentParser(
        description="Downscale a list of images by a percentage and save to a directory."
    )
    parser.add_argument(
        "output_dir", 
        help="Directory to save the downscaled images"
    )
    parser.add_argument(
        "image_paths", 
        nargs="+", 
        help="Paths to the image files to be downscaled"
    )
    parser.add_argument(
        "--scale", 
        type=int, 
        default=30,
        help="Percentage to scale the images (default: 30)"
    )

    args = parser.parse_args()
    downscale_images(args.output_dir, args.image_paths, args.scale)

if __name__ == "__main__":
    main()
