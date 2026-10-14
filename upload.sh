#!/usr/bin/env bash
# Upload this project to a server over SSH and deploy it there — no git needed.
#
#   ./upload.sh <user@server> <domain> [acme-email] [remote-path]
#
# Examples:
#   ./upload.sh root@1.2.3.4 deposit.nexqcapital.com admin@nexqcapital.com
#   DEPLOY_ARGS="--behind-proxy --port=8090" ./upload.sh root@1.2.3.4 deposit.nexqcapital.com
#
# Uses tar over SSH (works from Windows Git Bash — no rsync required).
# Skips node_modules/.next/.git/.env/dev.db, so the server's own .env (secrets,
# admin password) and Postgres data are preserved across uploads.
set -euo pipefail
cd "$(dirname "$0")"

SERVER="${1:-}"
DOMAIN="${2:-}"
EMAIL="${3:-}"
REMOTE_PATH="${4:-nexq-deposit}"
DEPLOY_ARGS="${DEPLOY_ARGS:-}"

if [ -z "$SERVER" ] || [ -z "$DOMAIN" ]; then
  echo "Usage: ./upload.sh <user@server> <domain> [acme-email] [remote-path]"
  echo "Example: ./upload.sh root@1.2.3.4 deposit.nexqcapital.com admin@nexqcapital.com"
  exit 1
fi
[ -z "$EMAIL" ] && EMAIL="admin@$DOMAIN"

command -v ssh >/dev/null 2>&1 || { echo "ERROR: ssh not found."; exit 1; }
command -v tar >/dev/null 2>&1 || { echo "ERROR: tar not found."; exit 1; }

TARBALL=".deploy-upload.tgz"
trap 'rm -f "$TARBALL"' EXIT

echo "==> Packing project (excluding node_modules/.next/.git/.env) ..."
tar czf "$TARBALL" \
  --exclude=./.git \
  --exclude=./node_modules \
  --exclude=./.next \
  --exclude=./.env \
  --exclude='./.env.*' \
  --exclude=./dev.db \
  --exclude='./dev.db-*' \
  --exclude='./prisma/dev.db*' \
  --exclude=./__pycache__ \
  --exclude=./gateway/.venv \
  --exclude=./.vscode \
  --exclude="./$TARBALL" \
  -C . .

echo "==> Uploading to $SERVER:$REMOTE_PATH ..."
ssh "$SERVER" "mkdir -p '$REMOTE_PATH'"
scp "$TARBALL" "$SERVER:$REMOTE_PATH/$TARBALL"

echo "==> Extracting and deploying on $SERVER ..."
ssh -t "$SERVER" "cd '$REMOTE_PATH' && tar xzf '$TARBALL' && rm -f '$TARBALL' && chmod +x deploy.sh && ./deploy.sh '$DOMAIN' '$EMAIL' $DEPLOY_ARGS"

echo
echo "Done. App: https://$DOMAIN"
