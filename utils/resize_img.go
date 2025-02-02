package main

import (
	"fmt"
	"image"
	"image/jpeg"
	"image/png"
	"os"

	"github.com/nfnt/resize"
	"strings"
)

func getExt(path string) (ext string){
	lower := strings.ToLower(path)
	parts := strings.Split(lower, ".")
	return parts[len(parts)-1]
}

// DownscaleImage takes an image path, a target width and height, and outputs the downscaled image to a new file.
func DownscaleImage(inputPath string, outputPath string, width uint, height uint) error {
	// Open the input image file
	file, err := os.Open(inputPath)
	if err != nil {
		return fmt.Errorf("failed to open image: %v", err)
	}
	defer file.Close()

	// Decode the image
	img, _, err := image.Decode(file)
	if err != nil {
		return fmt.Errorf("failed to decode image: %v", err)
	}

	// Resize the image to the target resolution
	resizedImg := resize.Resize(width, height, img, resize.Lanczos3)

	// Create the output file
	outFile, err := os.Create(outputPath)
	if err != nil {
		return fmt.Errorf("failed to create output file: %v", err)
	}
	defer outFile.Close()

	// Get the file extension to determine the format (JPEG or PNG)
	ext := getExt(outputPath)

	// Encode and save the image in the specified format
	switch ext {
	case "jpg", "jpeg":
		err = jpeg.Encode(outFile, resizedImg, nil)
	case "png":
		err = png.Encode(outFile, resizedImg)
	default:
		return fmt.Errorf("unsupported file format: %s", ext)
	}

	if err != nil {
		return fmt.Errorf("failed to encode image: %v", err)
	}

	fmt.Printf("Image successfully downscaled and saved to %s\n", outputPath)
	return nil
}

func DownscaleImageFrac(inputPath string, outputPath string, fraction uint) error {
	file, err := os.Open(inputPath)
	if err != nil {
		return fmt.Errorf("failed to open image: %v", err)
	}
	defer file.Close()

	// Decode the image
	img, _, err := image.Decode(file)
	if err != nil {
		return fmt.Errorf("failed to decode image: %v", err)
	}

	width := uint(img.Bounds().Dx())
	height := uint(img.Bounds().Dy())
	newWidth := uint(width / fraction)
	newHeight := uint(height / fraction)
	// TODO check aspect ratio preserved?
	DownscaleImage(inputPath, outputPath, newWidth, newHeight)
	return nil
}

func main() {
	dirPath := "../photos/pics/"
	files, err := os.ReadDir(dirPath)
	if err != nil {
		fmt.Println("Error reading directory:", err)
		return
	}

	for _, file := range files {
		if !file.IsDir() {
			inputPath := dirPath + file.Name()
			outputPath := dirPath + "low/" + file.Name()
			err := DownscaleImageFrac(inputPath, outputPath, uint(50))
			if err != nil {
				fmt.Println("Error:", err)
			}
		}
	}

	for _, file := range files {
		if !file.IsDir() {
			inputPath := dirPath + file.Name()
			outputPath := dirPath + "med/" + file.Name()
			err := DownscaleImageFrac(inputPath, outputPath, uint(10))
			if err != nil {
				fmt.Println("Error:", err)
			}
		}
	}

}
