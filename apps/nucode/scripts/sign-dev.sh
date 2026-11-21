#!/bin/bash
# Use an existing stable local identity; never create certificates here.
set -euo pipefail
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
NUCODE_SIGNING_IDENTITY=$(bash "$SCRIPT_DIR/signing-identity.sh")
export NUCODE_SIGNING_IDENTITY
exec bash "$SCRIPT_DIR/sign-macos.sh" "${1:-$SCRIPT_DIR/../src-tauri/target/debug/bundle/macos/nucode.app}"
