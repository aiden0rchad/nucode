#!/bin/bash
# Use an existing stable local identity; never create certificates here.
set -euo pipefail
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
if [[ -z "${NUCODE_SIGNING_IDENTITY:-}" && -f "$SCRIPT_DIR/../.signing-identity.local" ]]; then
  NUCODE_SIGNING_IDENTITY=$(<"$SCRIPT_DIR/../.signing-identity.local")
  [[ -n "$NUCODE_SIGNING_IDENTITY" ]] || { echo "The local signing identity is empty." >&2; exit 1; }
  export NUCODE_SIGNING_IDENTITY
fi
exec bash "$SCRIPT_DIR/sign-macos.sh" "${1:-$SCRIPT_DIR/../src-tauri/target/debug/bundle/macos/nucode.app}"
