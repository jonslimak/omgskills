#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if ! git diff --quiet -- site .github/workflows scripts netlify.toml; then
  echo "Refusing production deploy: tracked deploy files have uncommitted changes." >&2
  echo "" >&2
  echo "Commit and push these changes first, then rerun:" >&2
  echo "  ./scripts/deploy-site-prod.sh" >&2
  echo "" >&2
  git status --short -- site .github/workflows scripts netlify.toml >&2
  exit 1
fi

node ./scripts/prepare-netlify-site-deploy.mjs
npx netlify-cli deploy --prod --dir=site
