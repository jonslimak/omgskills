#!/bin/bash
# Stores the R2 credentials as GitHub Actions secrets and in index/.env.
# Prompts for the two keys without echoing them; nothing is printed or logged.
set -euo pipefail

REPO=jonslimak/omgskills
ENV_FILE=/Users/jonslimak/Projects/omgskills/index/.env
ACCOUNT_ID=e65d497e0031986d3cb362e38af45551

read -rp "R2 Access Key ID: " ACCESS_KEY_ID
read -rsp "R2 Secret Access Key (hidden): " SECRET_ACCESS_KEY; echo
[ -n "$ACCESS_KEY_ID" ] && [ -n "$SECRET_ACCESS_KEY" ] || { echo "Both values are required."; exit 1; }

printf '%s' "$ACCOUNT_ID" | gh secret set R2_ACCOUNT_ID --repo "$REPO"
printf '%s' "$ACCESS_KEY_ID" | gh secret set R2_ACCESS_KEY_ID --repo "$REPO"
printf '%s' "$SECRET_ACCESS_KEY" | gh secret set R2_SECRET_ACCESS_KEY --repo "$REPO"

# Replace any earlier R2 lines, then append the current ones.
touch "$ENV_FILE"
grep -v '^R2_\(ACCOUNT_ID\|ACCESS_KEY_ID\|SECRET_ACCESS_KEY\)=' "$ENV_FILE" > "$ENV_FILE.tmp" || true
printf 'R2_ACCOUNT_ID=%s\nR2_ACCESS_KEY_ID=%s\nR2_SECRET_ACCESS_KEY=%s\n' "$ACCOUNT_ID" "$ACCESS_KEY_ID" "$SECRET_ACCESS_KEY" >> "$ENV_FILE.tmp"
mv "$ENV_FILE.tmp" "$ENV_FILE"
chmod 600 "$ENV_FILE"

echo "Saved 3 GitHub secrets on $REPO and updated $ENV_FILE."
