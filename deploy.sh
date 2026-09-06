#!/bin/bash
# Deploy ~/foldervideoplayer-site to Cloudflare Pages (direct upload).
# Usage: ./deploy.sh   (run from this directory)
set -e
cd "$(dirname "$0")"
echo "→ Deploying to Cloudflare Pages (foldervideoplayer-site)..."
wrangler pages deploy . --project-name=foldervideoplayer-site --commit-dirty=true
echo "→ Live: https://foldervideoplayer-site.pages.dev/"
