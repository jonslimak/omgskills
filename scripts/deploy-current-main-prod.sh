#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [ "$#" -ne 0 ]; then
  echo "Usage: ./scripts/deploy-current-main-prod.sh" >&2
  exit 2
fi

for command in git gh jq; do
  command -v "$command" >/dev/null 2>&1 || { echo "missing required command: $command" >&2; exit 1; }
done

if [ -n "$(git status --porcelain)" ]; then
  echo "refusing production deploy: the checkout has uncommitted changes" >&2
  git status --short >&2
  exit 1
fi

git fetch origin main
expected_sha="$(git rev-parse HEAD)"
origin_sha="$(git rev-parse origin/main)"
if [ "$expected_sha" != "$origin_sha" ]; then
  echo "refusing production deploy: HEAD must exactly match origin/main" >&2
  echo "HEAD:        $expected_sha" >&2
  echo "origin/main: $origin_sha" >&2
  exit 1
fi

repository="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
gh auth status >/dev/null
dispatched_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

gh workflow run deploy-current-main.yml \
  --repo "$repository" \
  --ref main \
  -f "expected_sha=$expected_sha"

echo "Waiting for the guarded production deploy..."
run_id=""
run_url=""
for _ in $(seq 1 30); do
  run_json="$(gh run list \
    --repo "$repository" \
    --workflow deploy-current-main.yml \
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
echo "Verified production deploy completed: $run_url"
