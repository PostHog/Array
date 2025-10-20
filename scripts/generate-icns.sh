#!/bin/bash

# Generate ICNS file from a source PNG
# Usage: bash scripts/generate-icns.sh [source.png] [output.icns]
# Defaults: source=build/icon@3x.png, output=build/app-icon.icns

set -e

SOURCE_PNG="${1:-build/icon@3x.png}"
OUTPUT_ICNS="${2:-build/app-icon.icns}"
ICONSET_DIR=$(mktemp -d)/icon.iconset

if [ ! -f "$SOURCE_PNG" ]; then
  echo "Error: Source PNG not found: $SOURCE_PNG"
  exit 1
fi

echo "Creating iconset from $SOURCE_PNG..."

mkdir -p "$ICONSET_DIR"

# Scale factor for macOS icon guidelines: 832/1024 = 13/16 = 0.8125
# This gives proper padding matching native macOS icons
SCALE=0.8125

# Generate all required icon sizes with padding
sips -z 16 16     "$SOURCE_PNG" --out "$ICONSET_DIR/icon_16x16.png" > /dev/null
sips -Z $(echo "16 * $SCALE" | bc | cut -d. -f1) "$ICONSET_DIR/icon_16x16.png" --padToHeightWidth 16 16 > /dev/null

sips -z 32 32     "$SOURCE_PNG" --out "$ICONSET_DIR/icon_16x16@2x.png" > /dev/null
sips -Z $(echo "32 * $SCALE" | bc | cut -d. -f1) "$ICONSET_DIR/icon_16x16@2x.png" --padToHeightWidth 32 32 > /dev/null

sips -z 32 32     "$SOURCE_PNG" --out "$ICONSET_DIR/icon_32x32.png" > /dev/null
sips -Z $(echo "32 * $SCALE" | bc | cut -d. -f1) "$ICONSET_DIR/icon_32x32.png" --padToHeightWidth 32 32 > /dev/null

sips -z 64 64     "$SOURCE_PNG" --out "$ICONSET_DIR/icon_32x32@2x.png" > /dev/null
sips -Z $(echo "64 * $SCALE" | bc | cut -d. -f1) "$ICONSET_DIR/icon_32x32@2x.png" --padToHeightWidth 64 64 > /dev/null

sips -z 128 128   "$SOURCE_PNG" --out "$ICONSET_DIR/icon_128x128.png" > /dev/null
sips -Z $(echo "128 * $SCALE" | bc | cut -d. -f1) "$ICONSET_DIR/icon_128x128.png" --padToHeightWidth 128 128 > /dev/null

sips -z 256 256   "$SOURCE_PNG" --out "$ICONSET_DIR/icon_128x128@2x.png" > /dev/null
sips -Z $(echo "256 * $SCALE" | bc | cut -d. -f1) "$ICONSET_DIR/icon_128x128@2x.png" --padToHeightWidth 256 256 > /dev/null

sips -z 256 256   "$SOURCE_PNG" --out "$ICONSET_DIR/icon_256x256.png" > /dev/null
sips -Z $(echo "256 * $SCALE" | bc | cut -d. -f1) "$ICONSET_DIR/icon_256x256.png" --padToHeightWidth 256 256 > /dev/null

sips -z 512 512   "$SOURCE_PNG" --out "$ICONSET_DIR/icon_256x256@2x.png" > /dev/null
sips -Z $(echo "512 * $SCALE" | bc | cut -d. -f1) "$ICONSET_DIR/icon_256x256@2x.png" --padToHeightWidth 512 512 > /dev/null

sips -z 512 512   "$SOURCE_PNG" --out "$ICONSET_DIR/icon_512x512.png" > /dev/null
sips -Z $(echo "512 * $SCALE" | bc | cut -d. -f1) "$ICONSET_DIR/icon_512x512.png" --padToHeightWidth 512 512 > /dev/null

sips -z 1024 1024 "$SOURCE_PNG" --out "$ICONSET_DIR/icon_512x512@2x.png" > /dev/null
sips -Z $(echo "1024 * $SCALE" | bc | cut -d. -f1) "$ICONSET_DIR/icon_512x512@2x.png" --padToHeightWidth 1024 1024 > /dev/null

echo "Converting iconset to ICNS..."

# Convert iconset to icns
iconutil -c icns "$ICONSET_DIR" -o "$OUTPUT_ICNS"

# Clean up
rm -rf "$(dirname "$ICONSET_DIR")"

echo "✓ Created $OUTPUT_ICNS"
