#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

OMGSKILLS_RELEASE_RC=1 ./release-mac.sh "$@"
