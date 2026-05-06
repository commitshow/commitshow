#!/bin/bash
# Tool-repo Discussions outreach loop · status report.
#
# Polls each of the 5 target Discussions (claude-code · cursor · aider ·
# continue · MCP servers) authored by the `commitshow` account and prints
# a one-block summary per target: posted yet, URL, reactions, comment
# count, top 3 comment excerpts. Drives the iteration described in
# memory/project_outreach_loop.md.
#
# Run from anywhere:
#   bash /Users/hans1/vibe/scripts/outreach-status.sh
#
# Requires: gh CLI authenticated (any account works for read · the
# search uses public-only fields). jq.

set -euo pipefail

GH=/opt/homebrew/bin/gh
[ -x "$GH" ] || GH=gh

# 5 outreach targets. Most don't actually use GitHub Discussions —
# the |alt-channel notation tells the script (and the reader) where
# the community really lives so we don't keep printing "Discussions
# disabled" without context.
declare -a TARGETS=(
  "anthropics/claude-code|Anthropic Discord (https://anthropic.com/discord)"
  "getcursor/cursor|Cursor Forum (https://forum.cursor.com)"
  "Aider-AI/aider|Aider Discord (invite in repo README)"
  "continuedev/continue|"
  "modelcontextprotocol/servers|MCP Discord (invite in spec repo)"
)

# Author handle whose discussions we look for. Switch if outreach
# moves to a different account.
AUTHOR="commitshow"

# Detect colors only when stdout is a TTY · keeps `tee` / pipes clean.
if [ -t 1 ]; then
  BOLD=$'\033[1m'; GOLD=$'\033[33m'; DIM=$'\033[2m'
  GREEN=$'\033[32m'; RED=$'\033[31m'; RESET=$'\033[0m'
else
  BOLD=''; GOLD=''; DIM=''; GREEN=''; RED=''; RESET=''
fi

printf '%scommit.show outreach status%s\n' "$BOLD" "$RESET"
printf '%spolling 5 Tool-repo Discussions for posts by @%s%s\n\n' "$DIM" "$AUTHOR" "$RESET"

for ENTRY in "${TARGETS[@]}"; do
  REPO=${ENTRY%%|*}
  ALT=${ENTRY#*|}
  OWNER=${REPO%%/*}
  NAME=${REPO##*/}

  printf '%s── %s%s%s\n' "$DIM" "$GOLD" "$REPO" "$RESET"

  # 1) Repo has Discussions enabled?
  HAS_DISC=$("$GH" api "repos/$REPO" --jq '.has_discussions' 2>/dev/null || echo "404")
  if [ "$HAS_DISC" = "404" ]; then
    printf '   %s✗ repo not reachable%s\n\n' "$RED" "$RESET"
    continue
  fi
  if [ "$HAS_DISC" != "true" ]; then
    if [ -n "$ALT" ]; then
      printf '   %salt channel · %s%s\n' "$DIM" "$ALT" "$RESET"
      printf '   %s(GitHub Discussions disabled — outreach happens off-platform · script can not poll automatically)%s\n\n' "$DIM" "$RESET"
    else
      printf '   %sDiscussions disabled · no alt channel mapped%s\n\n' "$DIM" "$RESET"
    fi
    continue
  fi

  # 2) Find the most recent discussion authored by $AUTHOR. GraphQL
  #    search by author isn't direct on Discussions; fetch the most
  #    recent N and filter client-side.
  RAW=$("$GH" api graphql -f query='
    query($owner:String!, $name:String!) {
      repository(owner:$owner, name:$name) {
        discussions(first:30, orderBy:{field:CREATED_AT, direction:DESC}) {
          nodes {
            url
            title
            createdAt
            author { login }
            reactions(first:1) { totalCount }
            comments(first:5) {
              totalCount
              nodes {
                bodyText
                author { login }
              }
            }
          }
        }
      }
    }' -f owner="$OWNER" -f name="$NAME" 2>/dev/null || echo '{}')

  MATCH=$(echo "$RAW" | jq -r --arg author "$AUTHOR" '
    .data.repository.discussions.nodes[]?
    | select(.author.login == $author)
    | @json' | head -n 1)

  if [ -z "$MATCH" ]; then
    printf '   %s○ not yet posted · draft ready in /tmp/commitshow-discussion-drafts/%s\n\n' "$DIM" "$RESET"
    continue
  fi

  TITLE=$(echo "$MATCH" | jq -r '.title')
  URL=$(echo   "$MATCH" | jq -r '.url')
  AT=$(echo    "$MATCH" | jq -r '.createdAt')
  RX=$(echo    "$MATCH" | jq -r '.reactions.totalCount')
  CN=$(echo    "$MATCH" | jq -r '.comments.totalCount')

  printf '   %s● posted%s  %s\n' "$GREEN" "$RESET" "$URL"
  printf '   %s%s · created %s · %s reactions · %s comments%s\n' \
    "$DIM" "$TITLE" "$AT" "$RX" "$CN" "$RESET"

  if [ "$CN" != "0" ]; then
    echo "$MATCH" | jq -r '.comments.nodes[]? | "   ↳ @\(.author.login // "?"): \(.bodyText // "" | gsub("\n"; " ") | .[0:100])"'
  fi

  # 3) Iteration heuristic from memory/project_outreach_loop.md
  if [ "$RX" -ge 5 ] && [ "$CN" -ge 1 ]; then
    printf '   %sheuristic: positive · proceed with next target (mild tone tweak)%s\n' "$GREEN" "$RESET"
  elif [ "$RX" -le 4 ] && [ "$CN" -eq 0 ]; then
    printf '   %sheuristic: weak signal · rewrite next draft more usage-driven before posting%s\n' "$DIM" "$RESET"
  fi
  echo
done

printf '%snext steps%s · check the heuristic line on the most-recently-posted target.\n' "$BOLD" "$RESET"
printf '%sdrafts dir%s  /tmp/commitshow-discussion-drafts/\n' "$DIM" "$RESET"
printf '%srunbook%s    ~/.claude/projects/-Users-hans1-vibe/memory/project_outreach_loop.md\n' "$DIM" "$RESET"
