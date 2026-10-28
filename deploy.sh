#!/usr/bin/env bash
# Build and deploy the Tartlet playground to S3 + CloudFront.
#
# Usage:
#   ./deploy.sh              # install, check, build, deploy
#   ./deploy.sh --infra      # also run terraform before deploying
#   SKIP_CHECK=1 ./deploy.sh # skip lint/typecheck/tests (not recommended)
#
# Overridable via environment:
#   BUCKET           (default: tartlet.cognotik.com)
#   DISTRIBUTION_ID  (default: E3DAOYLO65QUBQ)
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

BUCKET="${BUCKET:-tartlet.cognotik.com}"
DISTRIBUTION_ID="${DISTRIBUTION_ID:-E3DAOYLO65QUBQ}"
DIST_DIR="./apps/playground/dist"
RUN_INFRA=0

for arg in "$@"; do
  case "$arg" in
    --infra) RUN_INFRA=1 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "Unknown argument: $arg" >&2; exit 2 ;;
  esac
done

log() { printf '\n==> %s\n' "$*"; }
die() { echo "ERROR: $*" >&2; exit 1; }

require() {
  command -v "$1" >/dev/null 2>&1 || die "Required command not found: $1"
}

preflight() {
  require node
  require aws
  if ! command -v pnpm >/dev/null 2>&1; then
    require corepack
    log "Enabling pnpm via corepack"
    corepack enable || die "corepack enable failed"
  fi
  aws sts get-caller-identity >/dev/null 2>&1 || die "AWS credentials are not configured"
}

install_deps() {
  log "Installing dependencies"
  pnpm install --frozen-lockfile || die "pnpm install failed"
}

check() {
  if [[ "${SKIP_CHECK:-0}" == "1" ]]; then
    log "Skipping checks (SKIP_CHECK=1)"
    return
  fi
  log "Running checks"
  pnpm run check || die "Checks failed"
}

build() {
  log "Building apps"
  pnpm run build || die "Build failed"
  [[ -f "$DIST_DIR/index.html" ]] || die "Build output missing: $DIST_DIR/index.html"
}

infra() {
  require terraform
  log "Applying terraform"
  pushd terraform >/dev/null || die "Failed to enter terraform/"
  terraform init -input=false || die "terraform init failed"
  terraform apply -input=false -auto-approve || die "terraform apply failed"
  popd >/dev/null
}

deploy() {
  log "Uploading to s3://$BUCKET"

  # 1. Content-hashed assets first, so new HTML never references missing files.
  #    No --delete: clients holding old HTML can still fetch old assets.
  if [[ -d "$DIST_DIR/assets" ]]; then
    aws s3 sync "$DIST_DIR/assets/" "s3://$BUCKET/assets/" \
      --cache-control "public,max-age=31536000,immutable" \
      || die "Asset upload failed"
  fi

  # 2. Everything else (index.html, manifest, favicon, ...) must revalidate.
  aws s3 sync "$DIST_DIR/" "s3://$BUCKET/" \
    --delete \
    --exclude "assets/*" \
    --cache-control "no-cache" \
    || die "Upload failed"

  log "Invalidating CloudFront distribution $DISTRIBUTION_ID"
  aws cloudfront create-invalidation \
    --distribution-id "$DISTRIBUTION_ID" \
    --paths "/*" \
    --query 'Invalidation.Id' --output text \
    || die "CloudFront invalidation failed"
}

main() {
  preflight
  install_deps
  check
  build
  if [[ "$RUN_INFRA" == "1" ]]; then
    infra
  fi
  deploy
  log "Deployed to https://$BUCKET"
}

main