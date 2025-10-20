#!/bin/bash

# Build native modules for DMG maker on Node.js 22
# This script compiles macos-alias and fs-xattr native modules

set -e

echo "Building native modules for DMG maker..."

# Compile macos-alias
if [ -d "node_modules/macos-alias" ]; then
  echo "Compiling macos-alias..."
  cd node_modules/macos-alias
  npm install
  cd ../..
  echo "✓ macos-alias compiled"
else
  echo "⚠ macos-alias not found, skipping"
fi

# Compile fs-xattr
if [ -d "node_modules/fs-xattr" ]; then
  echo "Compiling fs-xattr..."
  cd node_modules/fs-xattr
  npm install
  cd ../..
  echo "✓ fs-xattr compiled"
else
  echo "⚠ fs-xattr not found, skipping"
fi

echo "✓ Native modules built successfully"
