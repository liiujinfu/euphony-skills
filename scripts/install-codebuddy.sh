#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
exec node bin/euphony-skills.mjs install codebuddy "$@"
