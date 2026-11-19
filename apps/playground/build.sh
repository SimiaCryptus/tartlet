#!/bin/sh
set -e

cd "$(dirname "$0")"
pnpm install
pnpm run build