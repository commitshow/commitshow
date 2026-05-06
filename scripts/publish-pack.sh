#!/bin/bash
# Admin · publish a pack to the Library marketplace.
#
# Tarballs a skill directory (with pack.yaml at the root), uploads to
# the library-bundles Storage bucket, computes sha256, and either
# UPDATEs the existing md_library row (matched by slug) or INSERTs a
# new one. Idempotent · re-running with the same version overwrites.
#
# Usage:
#   bash scripts/publish-pack.sh <skill_dir>
#   e.g.
#   bash scripts/publish-pack.sh ~/.claude/skills/supabase-resend-auth
#
# Reads from .env.local:
#   SUPABASE_PROJECT_REF
#   SUPABASE_SERVICE_ROLE_KEY      · for Storage upload + DB row update
#   SUPABASE_DB_*                  · psql connection
#
# pack.yaml at <skill_dir>/pack.yaml must declare at minimum: slug,
# version, name, description, format, files.

set -euo pipefail

SKILL_DIR="${1:?usage: bash scripts/publish-pack.sh <skill_dir>}"
SKILL_DIR=$(cd "$SKILL_DIR" && pwd)

if [ ! -f "$SKILL_DIR/pack.yaml" ]; then
  echo "✗ $SKILL_DIR/pack.yaml not found · this isn't a marketplace pack." >&2
  exit 1
fi

# Find vibe project (this script lives in vibe/scripts).
VIBE_DIR=$(cd "$(dirname "$0")/.." && pwd)
cd "$VIBE_DIR"
set -a; source .env.local; set +a

: "${SUPABASE_PROJECT_REF:?missing SUPABASE_PROJECT_REF in .env.local}"
: "${SUPABASE_SERVICE_ROLE_KEY:?missing SUPABASE_SERVICE_ROLE_KEY in .env.local}"
: "${SUPABASE_DB_HOST:?missing SUPABASE_DB_HOST in .env.local}"

PSQL=psql
command -v psql >/dev/null 2>&1 || PSQL=/opt/homebrew/opt/libpq/bin/psql
[ -x "$PSQL" ] || { echo "✗ psql not found"; exit 1; }

# ── Read pack.yaml fields with a tiny python helper · avoids yq dep ──
read_pack() {
  python3 - "$1" "$2" <<'PYEOF'
import sys, re, pathlib
path  = pathlib.Path(sys.argv[1]) / 'pack.yaml'
key   = sys.argv[2]
text  = path.read_text()
# Match "<key>: <value>" at column 0 (top-level only)
for line in text.splitlines():
    m = re.match(rf'^{re.escape(key)}\s*:\s*(.*)$', line)
    if m:
        v = m.group(1).strip()
        if (v.startswith('"') and v.endswith('"')) or (v.startswith("'") and v.endswith("'")):
            v = v[1:-1]
        print(v)
        sys.exit(0)
sys.exit(0)
PYEOF
}

SLUG=$(read_pack "$SKILL_DIR" slug)
VERSION=$(read_pack "$SKILL_DIR" version)
NAME=$(read_pack "$SKILL_DIR" name)
FORMAT=$(read_pack "$SKILL_DIR" format)
MANIFEST_VERSION="v0.1"

if [ -z "$SLUG" ] || [ -z "$VERSION" ]; then
  echo "✗ pack.yaml must declare 'slug:' and 'version:'" >&2
  exit 1
fi

echo "→ Pack: $NAME v$VERSION (slug=$SLUG · format=$FORMAT)"

# ── Tar the bundle ─────────────────────────────────────────
TARBALL=$(mktemp -t "${SLUG}.XXXXXX.tar.gz")
PARENT=$(dirname "$SKILL_DIR")
LEAF=$(basename "$SKILL_DIR")

# tar from PARENT so untar produces ./<slug>/ with files inside.
# Excludes: .DS_Store, node_modules, .git, *.log
tar -czf "$TARBALL" \
    --exclude='.DS_Store' \
    --exclude='node_modules' \
    --exclude='.git' \
    --exclude='*.log' \
    -C "$PARENT" "$LEAF"

SIZE=$(stat -f%z "$TARBALL" 2>/dev/null || stat -c%s "$TARBALL")
SHA=$(shasum -a 256 "$TARBALL" | awk '{print $1}')

echo "→ Bundle: $(basename "$TARBALL")  size=$SIZE bytes  sha256=${SHA:0:16}…"

# ── Upload to Storage ──────────────────────────────────────
STORAGE_PATH="${SLUG}/${VERSION}.tar.gz"
STORAGE_URL="https://${SUPABASE_PROJECT_REF}.supabase.co/storage/v1/object/library-bundles/${STORAGE_PATH}"
PUBLIC_URL="https://${SUPABASE_PROJECT_REF}.supabase.co/storage/v1/object/public/library-bundles/${STORAGE_PATH}"

echo "→ Uploading to $STORAGE_PATH"
HTTP=$(curl -sS -o /tmp/upload-resp.json -w "%{http_code}" \
  -X PUT "$STORAGE_URL" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/gzip" \
  -H "x-upsert: true" \
  --data-binary "@$TARBALL")

if [ "$HTTP" != "200" ] && [ "$HTTP" != "201" ]; then
  echo "✗ Storage upload failed · HTTP $HTTP" >&2
  cat /tmp/upload-resp.json >&2
  exit 1
fi
echo "  ✓ uploaded"

# ── Update md_library row ──────────────────────────────────
echo "→ Patching md_library row for slug=$SLUG"
PGPASSWORD="$SUPABASE_DB_PASSWORD" "$PSQL" \
  -h "$SUPABASE_DB_HOST" -p "$SUPABASE_DB_PORT" \
  -U "$SUPABASE_DB_USER" -d "$SUPABASE_DB_NAME" \
  -v ON_ERROR_STOP=1 -c "
UPDATE public.md_library
   SET slug              = '$SLUG',
       bundle_url        = '$PUBLIC_URL',
       bundle_sha256     = '$SHA',
       bundle_size_bytes = $SIZE,
       bundle_version    = '$VERSION',
       manifest_version  = '$MANIFEST_VERSION',
       updated_at        = now()
 WHERE title = '$NAME' OR slug = '$SLUG';
" 2>&1 | tail -3

rm -f "$TARBALL" /tmp/upload-resp.json

cat <<DONE

✓ Published $NAME v$VERSION

   Bundle URL : $PUBLIC_URL
   Slug       : $SLUG
   Install    : npx commitshow@latest install $SLUG

   Verify on Library detail page:
   https://commit.show/library  (filter for slug=$SLUG)
DONE
