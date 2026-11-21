#!/bin/bash
# Use an existing stable local identity; never create certificates here.
set -euo pipefail
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
NUCODE_SIGNING_IDENTITY=$(bash "$SCRIPT_DIR/signing-identity.sh")
export NUCODE_SIGNING_IDENTITY
# macOS ties Accessibility, Screen Recording and Keychain grants to the signer; an installed copy
# that changes signer loses them.
if [[ "$NUCODE_SIGNING_IDENTITY" == 'nucode Dev' ]]; then
  echo "warning: no .signing-identity.local found; signing with nucode Dev, so macOS will ask again for permissions granted to a copy signed with your own identity." >&2
fi
exec bash "$SCRIPT_DIR/sign-macos.sh" "${1:-$SCRIPT_DIR/../src-tauri/target/debug/bundle/macos/nucode.app}"
