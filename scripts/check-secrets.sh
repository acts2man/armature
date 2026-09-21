#!/usr/bin/env bash
# Fails if anything that belongs only on the server shows up in the built frontend.
# Run after `npm run build`.
set -u
DIST="${1:-dist}"
if [ ! -d "$DIST" ]; then
  echo "check-secrets: $DIST does not exist. Run npm run build first." >&2
  exit 1
fi
NEEDLES=(
  "GITHUB_APP_PRIVATE_KEY"
  "GITHUB_APP_ID"
  "GITHUB_APP_SLUG"
  "BEGIN RSA"
  "BEGIN PRIVATE KEY"
  "api.github.com"
  "SUPABASE_SERVICE_ROLE_KEY"
  "service_role"
  "sb_secret_"
)
status=0
for needle in "${NEEDLES[@]}"; do
  if grep -R -q -F -- "$needle" "$DIST"; then
    echo "FAIL: found \"$needle\" in $DIST" >&2
    grep -R -l -F -- "$needle" "$DIST" >&2
    status=1
  else
    echo "ok: \"$needle\" absent"
  fi
done
if [ "$status" -eq 0 ]; then
  echo "check-secrets: all ${#NEEDLES[@]} strings absent from $DIST"
fi
exit "$status"
