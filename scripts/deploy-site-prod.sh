#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

DEPLOY_INPUTS=(
  .gitignore
  .github/workflows
  menubar/Info.plist
  netlify
  netlify.toml
  package.json
  package-lock.json
  portal
  scripts
  site
)

if [ -f .netlify/netlify.toml ]; then
  echo "Refusing production deploy: .netlify/netlify.toml is a stale generated config cache." >&2
  echo "Move it aside for the deploy so the root netlify.toml is authoritative." >&2
  exit 1
fi

DEPLOY_STATUS=$(git status --short -- "${DEPLOY_INPUTS[@]}")
if [ -n "$DEPLOY_STATUS" ]; then
  echo "Refusing production deploy: deploy inputs have uncommitted changes." >&2
  echo "" >&2
  echo "Commit and push these changes first, then rerun:" >&2
  echo "  ./scripts/deploy-site-prod.sh" >&2
  echo "" >&2
  printf '%s\n' "$DEPLOY_STATUS" >&2
  exit 1
fi

if [ -z "${VITE_CLERK_PUBLISHABLE_KEY:-}" ]; then
  VITE_CLERK_PUBLISHABLE_KEY=$(npx netlify-cli env:get VITE_CLERK_PUBLISHABLE_KEY --context production)
  export VITE_CLERK_PUBLISHABLE_KEY
fi

if [[ "$VITE_CLERK_PUBLISHABLE_KEY" != pk_* ]]; then
  echo "Refusing production deploy: VITE_CLERK_PUBLISHABLE_KEY is missing or invalid." >&2
  exit 1
fi

PRODUCTION_ORIGIN="https://omgskills.com" node ./scripts/prepare-netlify-site-deploy.mjs
npm ci
npm run build:netlify
npx netlify-cli deploy --prod --dir=dist/netlify-site --no-build
PRODUCTION_ORIGIN="https://omgskills.com" node ./scripts/verify-production-deploy.mjs
PRODUCTION_ORIGIN="https://omgskills.com" node ./scripts/verify-web-library-pages.mjs --live

VERSION=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' menubar/Info.plist 2>/dev/null || true)
if [ -n "$VERSION" ] && [ -z "$(git tag --list "v$VERSION")" ]; then
  git tag "v$VERSION"
  git push origin "v$VERSION"
  echo "→ Tagged and pushed v$VERSION"
fi
