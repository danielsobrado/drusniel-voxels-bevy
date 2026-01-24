#!/bin/bash
# Convert PNG to JPG script
# Requires ImageMagick to be installed
# Run: ./convert_png_to_jpg.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Match PNG files case-insensitively and avoid literal globs when no matches exist.
shopt -s nullglob nocaseglob

# Check if ImageMagick is available, otherwise offer to install it.
if ! command -v magick &> /dev/null && ! command -v convert &> /dev/null; then
    echo "ImageMagick not found."
    read -r -p "Install ImageMagick now? (y/N) " reply

    case "$reply" in
        [Yy]*)
            if command -v apt-get &> /dev/null; then
                sudo apt-get update && sudo apt-get install -y imagemagick
            elif command -v dnf &> /dev/null; then
                sudo dnf install -y imagemagick
            elif command -v yum &> /dev/null; then
                sudo yum install -y imagemagick
            elif command -v pacman &> /dev/null; then
                sudo pacman -S --noconfirm imagemagick
            elif command -v zypper &> /dev/null; then
                sudo zypper install -y ImageMagick
            elif command -v apk &> /dev/null; then
                sudo apk add imagemagick
            elif command -v brew &> /dev/null; then
                brew install imagemagick
            else
                echo "No supported package manager found. Please install ImageMagick manually."
                exit 1
            fi
            ;;
        *)
            echo "Install cancelled."
            exit 1
            ;;
    esac

    if ! command -v magick &> /dev/null && ! command -v convert &> /dev/null; then
        echo "ImageMagick still not available after install. Please check your PATH."
        exit 1
    fi
fi

# Use magick if available, otherwise fall back to convert
if command -v magick &> /dev/null; then
    CONVERT_CMD="magick"
else
    CONVERT_CMD="convert"
fi

png_files=(*.png)

if [ ${#png_files[@]} -eq 0 ]; then
    echo "No PNG files found in $SCRIPT_DIR"
    exit 0
fi

echo "Found ${#png_files[@]} PNG file(s) to convert..."

converted=0
failed=0

for png in "${png_files[@]}"; do
    jpg="${png%.png}.jpg"

    echo "Converting: $png -> $jpg"

    if $CONVERT_CMD "$png" -quality 90 "$jpg" 2>/dev/null; then
        # Verify the JPG was created and has content
        if [ -s "$jpg" ]; then
            rm -f "$png"
            echo "  Success! Deleted $png"
            ((converted++))
        else
            echo "  Error: JPG file is empty, keeping PNG"
            rm -f "$jpg"
            ((failed++))
        fi
    else
        echo "  Error: Conversion failed"
        ((failed++))
    fi
done

echo ""
echo "Conversion complete: $converted succeeded, $failed failed"
