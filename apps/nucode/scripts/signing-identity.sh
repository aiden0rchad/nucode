#!/bin/bash
# Prints the identity every macOS build and install signs with. macOS ties Accessibility,
# Screen Recording and Keychain grants to the signature's designated requirement, so one
# identity for every build keeps those grants across rebuilds and updates; switching
# identities (even between two of your own) makes macOS treat the app as a new one.
# Order: NUCODE_SIGNING_IDENTITY, then .signing-identity.local in this checkout or the
# main checkout of a worktree, then the local "nucode Dev" certificate.
# With --name, prints the certificate's name instead (the identity may be its SHA-1).
set -euo pipefail
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
if [[ "${1:-}" == --name ]]; then
  identity=$(bash "$0")
  if [[ "$identity" =~ ^[0-9A-Fa-f]{40}$ ]]; then
    security find-identity -p codesigning | sed -n "s/.*$identity \"\(.*\)\".*/\1/p" | head -n 1
  else
    echo "$identity"
  fi
  exit 0
fi
if [[ -n "${NUCODE_SIGNING_IDENTITY:-}" ]]; then echo "$NUCODE_SIGNING_IDENTITY"; exit 0; fi
candidates=("$SCRIPT_DIR/../.signing-identity.local")
if common=$(git -C "$SCRIPT_DIR" rev-parse --path-format=absolute --git-common-dir 2>/dev/null); then
  candidates+=("$(dirname "$common")/apps/nucode/.signing-identity.local")
fi
for file in "${candidates[@]}"; do
  if [[ -f "$file" ]]; then
    identity=$(<"$file")
    [[ -n "$identity" ]] || { echo "The local signing identity in $file is empty." >&2; exit 1; }
    echo "$identity"; exit 0
  fi
done
echo 'nucode Dev'
