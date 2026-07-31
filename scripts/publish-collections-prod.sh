#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

usage() {
  cat <<'EOF'
Usage: ./scripts/publish-collections-prod.sh [--impact-override "review reason"]

Dispatches the guarded collection publisher for the reviewed origin/main commit.
Collection source files and images must already be committed and pushed to main.
EOF
}

impact_override=false
impact_reason=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --impact-override)
      if [ "$#" -lt 2 ] || [ -z "${2//[[:space:]]/}" ]; then
        echo "--impact-override requires a non-empty review reason" >&2
        exit 2
      fi
      impact_override=true
      impact_reason="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      exit 2
      ;;
  esac
done

for command in git gh jq npm; do
  command -v "$command" >/dev/null 2>&1 || { echo "missing required command: $command" >&2; exit 1; }
done

if [ -n "$(git status --porcelain)" ]; then
  echo "refusing collection publication: the checkout has uncommitted changes" >&2
  git status --short >&2
  exit 1
fi

git fetch origin main
expected_sha="$(git rev-parse HEAD)"
origin_sha="$(git rev-parse origin/main)"
if [ "$expected_sha" != "$origin_sha" ]; then
  echo "refusing collection publication: HEAD must exactly match origin/main" >&2
  echo "HEAD:        $expected_sha" >&2
  echo "origin/main: $origin_sha" >&2
  exit 1
fi

source_sha="$(git log -1 --format=%H -- index/curations/collections.json index/seeds/creators.json site/images/collections)"
publish_sha="$(git log -1 --format=%H -- site/data/v2/manifest.json site/data/crawl4/manifest.json)"
if [ -n "$source_sha" ] && [ -n "$publish_sha" ] && git merge-base --is-ancestor "$source_sha" "$publish_sha"; then
  echo "refusing collection publication: no collection source or image changes exist after the latest published manifests" >&2
  exit 1
fi

echo "Running local collection preflight..."
npm --prefix index ci
npm --prefix index run policy:validate -- --profile strict
npm --prefix index run collections:verify-images

repository="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
gh auth status >/dev/null
dispatched_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

gh workflow run publish-collections.yml \
  --repo "$repository" \
  --ref main \
  -f "expected_sha=$expected_sha" \
  -f "publication_impact_override=$impact_override" \
  -f "publication_impact_override_reason=$impact_reason"

echo "Waiting for the collection publication workflow..."
run_id=""
run_url=""
for _ in $(seq 1 30); do
  run_json="$(gh run list \
    --repo "$repository" \
    --workflow publish-collections.yml \
    --event workflow_dispatch \
    --branch main \
    --limit 20 \
    --json databaseId,headSha,createdAt,url \
    | jq -c --arg sha "$expected_sha" --arg started "$dispatched_at" \
      '[.[] | select(.headSha == $sha and .createdAt >= $started)] | sort_by(.createdAt) | last // empty')"
  if [ -n "$run_json" ] && [ "$run_json" != "null" ]; then
    run_id="$(jq -r '.databaseId' <<<"$run_json")"
    run_url="$(jq -r '.url' <<<"$run_json")"
    break
  fi
  sleep 2
done

if [ -z "$run_id" ]; then
  echo "workflow was dispatched but its run could not be identified" >&2
  exit 1
fi

echo "$run_url"
gh run watch "$run_id" --repo "$repository" --exit-status

echo "Collection publication completed: $run_url"
image_urls="$(jq -r '.collections[] | .imageUrl // empty' index/curations/collections.json | sort -u)"
if [ -n "$image_urls" ]; then
  echo "Published collection images:"
  printf '%s\n' "$image_urls"
fi
echo "origin/main now includes a generated publication commit; sync before further edits."
