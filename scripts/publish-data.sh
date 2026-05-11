#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SKILLS="$REPO_ROOT/index/skills.json"
TRENDING="$REPO_ROOT/index/trending.json"
TRENDING_LEADERBOARD="$REPO_ROOT/index/trending-leaderboard.json"
LEADERBOARD_VIEW_DATA="$REPO_ROOT/index/leaderboard-view-data.json"
X_TRENDING="$REPO_ROOT/index/x-trending.json"
SKILL_SIGNALS="$REPO_ROOT/index/skill-signals.json"
AUTHOR_SIGNALS="$REPO_ROOT/index/author-signals.json"
AUTHOR_LEADERBOARDS="$REPO_ROOT/index/author-leaderboards.json"
DATA_DIR="$REPO_ROOT/site/data"

require_file() {
    local file="$1"
    local hint="$2"
    if [ ! -f "$file" ]; then
        echo "✗ Missing $file" >&2
        echo "  $hint" >&2
        exit 1
    fi
}

hash_file() {
    shasum -a 256 "$1" | awk '{print $1}'
}

byte_count() {
    wc -c < "$1" | tr -d ' '
}

file_modified_iso() {
    node -e "console.log(new Date(require('fs').statSync(process.argv[1]).mtimeMs).toISOString())" "$1"
}

require_file "$SKILLS" "Run: cd index && npm run scrape"
require_file "$TRENDING" "Run: cd index && npm run scrape:trending"

mkdir -p "$DATA_DIR"

skills_hash="$(hash_file "$SKILLS")"
trending_hash="$(hash_file "$TRENDING")"
trending_leaderboard_hash=""
leaderboard_view_data_hash=""
x_trending_hash=""
skill_signals_hash=""
author_signals_hash=""
author_leaderboards_hash=""
skills_file="skills-${skills_hash:0:12}.json"
trending_file="trending-${trending_hash:0:12}.json"
trending_leaderboard_file=""
leaderboard_view_data_file=""
x_trending_file=""
skill_signals_file=""
author_signals_file=""
author_leaderboards_file=""
if [ -f "$X_TRENDING" ]; then
    x_trending_hash="$(hash_file "$X_TRENDING")"
    x_trending_file="x-trending-${x_trending_hash:0:12}.json"
fi
if [ -f "$TRENDING_LEADERBOARD" ]; then
    trending_leaderboard_hash="$(hash_file "$TRENDING_LEADERBOARD")"
    trending_leaderboard_file="trending-leaderboard-${trending_leaderboard_hash:0:12}.json"
fi
if [ -f "$LEADERBOARD_VIEW_DATA" ]; then
    leaderboard_view_data_hash="$(hash_file "$LEADERBOARD_VIEW_DATA")"
    leaderboard_view_data_file="leaderboard-view-data-${leaderboard_view_data_hash:0:12}.json"
fi
if [ -f "$SKILL_SIGNALS" ]; then
    skill_signals_hash="$(hash_file "$SKILL_SIGNALS")"
    skill_signals_file="skill-signals-${skill_signals_hash:0:12}.json"
fi
if [ -f "$AUTHOR_SIGNALS" ]; then
    author_signals_hash="$(hash_file "$AUTHOR_SIGNALS")"
    author_signals_file="author-signals-${author_signals_hash:0:12}.json"
fi
if [ -f "$AUTHOR_LEADERBOARDS" ]; then
    author_leaderboards_hash="$(hash_file "$AUTHOR_LEADERBOARDS")"
    author_leaderboards_file="author-leaderboards-${author_leaderboards_hash:0:12}.json"
fi

cp "$SKILLS" "$DATA_DIR/$skills_file"
cp "$TRENDING" "$DATA_DIR/$trending_file"
if [ -n "$trending_leaderboard_file" ]; then
    cp "$TRENDING_LEADERBOARD" "$DATA_DIR/$trending_leaderboard_file"
fi
if [ -n "$leaderboard_view_data_file" ]; then
    cp "$LEADERBOARD_VIEW_DATA" "$DATA_DIR/$leaderboard_view_data_file"
fi
if [ -n "$x_trending_file" ]; then
    cp "$X_TRENDING" "$DATA_DIR/$x_trending_file"
fi
if [ -n "$skill_signals_file" ]; then
    cp "$SKILL_SIGNALS" "$DATA_DIR/$skill_signals_file"
fi
if [ -n "$author_signals_file" ]; then
    cp "$AUTHOR_SIGNALS" "$DATA_DIR/$author_signals_file"
fi
if [ -n "$author_leaderboards_file" ]; then
    cp "$AUTHOR_LEADERBOARDS" "$DATA_DIR/$author_leaderboards_file"
fi

cat > "$DATA_DIR/manifest.json" <<JSON
{
  "version": 1,
  "generatedAt": "$(file_modified_iso "$SKILLS")",
  "skills": {
    "path": "$skills_file",
    "sha256": "$skills_hash",
    "bytes": $(byte_count "$SKILLS")
  },
  "trending": {
    "path": "$trending_file",
    "sha256": "$trending_hash",
    "bytes": $(byte_count "$TRENDING")
  }$(if [ -n "$trending_leaderboard_file" ]; then cat <<EOF
,
  "trendingLeaderboard": {
    "path": "$trending_leaderboard_file",
    "sha256": "$trending_leaderboard_hash",
    "bytes": $(byte_count "$TRENDING_LEADERBOARD")
  }
EOF
fi)$(if [ -n "$leaderboard_view_data_file" ]; then cat <<EOF
,
  "leaderboardViewData": {
    "path": "$leaderboard_view_data_file",
    "sha256": "$leaderboard_view_data_hash",
    "bytes": $(byte_count "$LEADERBOARD_VIEW_DATA")
  }
EOF
fi)
$(if [ -n "$x_trending_file" ]; then cat <<EOF
,
  "xTrending": {
    "path": "$x_trending_file",
    "sha256": "$x_trending_hash",
    "bytes": $(byte_count "$X_TRENDING")
  }
EOF
fi)$(if [ -n "$skill_signals_file" ]; then cat <<EOF
,
  "skillSignals": {
    "path": "$skill_signals_file",
    "sha256": "$skill_signals_hash",
    "bytes": $(byte_count "$SKILL_SIGNALS")
  }
EOF
fi)$(if [ -n "$author_signals_file" ]; then cat <<EOF
,
  "authorSignals": {
    "path": "$author_signals_file",
    "sha256": "$author_signals_hash",
    "bytes": $(byte_count "$AUTHOR_SIGNALS")
  }
EOF
fi)$(if [ -n "$author_leaderboards_file" ]; then cat <<EOF
,
  "authorLeaderboards": {
    "path": "$author_leaderboards_file",
    "sha256": "$author_leaderboards_hash",
    "bytes": $(byte_count "$AUTHOR_LEADERBOARDS")
  }
EOF
fi)
}
JSON

HEALTH_PUBLISHED_AT="${HEALTH_PUBLISHED_AT:-$(date -u +"%Y-%m-%dT%H:%M:%SZ")}" \
HEALTH_CHECKED_AT="${HEALTH_CHECKED_AT:-$(date -u +"%Y-%m-%dT%H:%M:%SZ")}" \
node "$REPO_ROOT/scripts/build-health.mjs"

for prefix in skills trending trending-leaderboard leaderboard-view-data x-trending skill-signals author-signals author-leaderboards; do
    if ls "$DATA_DIR"/"$prefix"-*.json >/dev/null 2>&1; then
        ls -t "$DATA_DIR"/"$prefix"-*.json | awk 'NR>2' | xargs -r rm -f
    fi
done

echo "✓ Published library data"
echo "  $DATA_DIR/manifest.json"
echo "  $DATA_DIR/$skills_file"
echo "  $DATA_DIR/$trending_file"
if [ -n "$trending_leaderboard_file" ]; then
    echo "  $DATA_DIR/$trending_leaderboard_file"
fi
if [ -n "$leaderboard_view_data_file" ]; then
    echo "  $DATA_DIR/$leaderboard_view_data_file"
fi
if [ -n "$x_trending_file" ]; then
    echo "  $DATA_DIR/$x_trending_file"
fi
if [ -n "$skill_signals_file" ]; then
    echo "  $DATA_DIR/$skill_signals_file"
fi
if [ -n "$author_signals_file" ]; then
    echo "  $DATA_DIR/$author_signals_file"
fi
if [ -n "$author_leaderboards_file" ]; then
    echo "  $DATA_DIR/$author_leaderboards_file"
fi
echo "  $DATA_DIR/health.json"
