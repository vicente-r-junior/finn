#!/usr/bin/env bash
# deploy.sh — build and push finn plugin to VPS
#
# Usage: VPS_IP=1.2.3.4 ./deploy.sh
#   Or set VPS_IP in your shell profile so you never have to type it.
set -e

VPS_IP="${VPS_IP:?VPS_IP env var is required. Usage: VPS_IP=1.2.3.4 ./deploy.sh}"

cd "$(dirname "$0")/plugin"

echo "Building..."
npm run build

echo "Syncing to VPS..."
rsync -avz --delete dist/ root@"${VPS_IP}":/root/.openclaw/extensions/finance-agent/dist/

echo "Fixing ownership and restarting..."
ssh root@"${VPS_IP}" 'chown -R root:root /root/.openclaw/extensions/finance-agent/ && pm2 restart finn && echo "✓ finn online"'
