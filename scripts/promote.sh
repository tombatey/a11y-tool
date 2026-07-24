#!/usr/bin/env bash
# scripts/promote.sh
# Merges develop → main and tags the release.
# Run this locally before deploying to production.
#
# Usage:
#   ./scripts/promote.sh          — prompts for version
#   ./scripts/promote.sh 1.2.0   — uses given version
set -euo pipefail

# Must be on develop
CURRENT=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT" != "develop" ]; then
  echo "⚠  Switch to develop first: git checkout develop"
  exit 1
fi

# Check working tree is clean
if ! git diff-index --quiet HEAD --; then
  echo "⚠  You have uncommitted changes. Commit or stash them first."
  exit 1
fi

# Get version
if [ -n "${1:-}" ]; then
  VERSION="$1"
else
  CURRENT_VERSION=$(node -p "require('./package.json').version" 2>/dev/null || echo "0.0.0")
  echo "Current version: $CURRENT_VERSION"
  read -rp "New version (e.g. 1.2.0): " VERSION
fi

if [ -z "$VERSION" ]; then echo "Version is required."; exit 1; fi

echo ""
echo "→ Pulling latest develop..."
git pull origin develop

echo "→ Switching to main..."
git checkout main
git pull origin main

echo "→ Merging develop into main..."
git merge --no-ff develop -m "chore: release v$VERSION"

echo "→ Tagging v$VERSION..."
git tag -a "v$VERSION" -m "Release v$VERSION"

echo "→ Pushing main and tag to GitHub..."
git push origin main
git push origin "v$VERSION"

# Update package.json version
npm version "$VERSION" --no-git-tag-version > /dev/null 2>&1 || true
git add package.json package-lock.json 2>/dev/null || true
git diff-index --quiet HEAD -- || git commit -m "chore: bump version to $VERSION"
git push origin main

echo ""
echo "✓ v$VERSION is now on main and tagged."
echo "  Deploy to production: ./scripts/deploy.sh production"
echo ""

# Switch back to develop
git checkout develop
git merge main -m "chore: sync develop with main after v$VERSION"
git push origin develop
