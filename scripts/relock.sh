#!/usr/bin/env bash
# Refresh uv.lock from pyproject.toml, then re-sync this checkout's environment.
#
# `scripts/run-in-aurora-env python -m pm.cli lock` cannot do this: a changed
# pyproject.toml makes the environment stale, so the wrapper syncs first, and
# the sync refuses the stale uv.lock before `pm lock` runs. The bootstrap
# Python runs pm without any dependency installed, so the lock comes first.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(dirname "$here")"
# shellcheck source=scripts/_activation.sh
. "$here/_activation.sh"
python="$(aurora_bootstrap_python "$repo")" || {
    echo "no bootstrap Python found; run setup-aurora.sh" >&2
    exit 1
}
(cd "$repo" && PYTHONHOME= PYTHONPATH="$repo" "$python" -m pm.cli lock)
exec "$here/run-in-aurora-env" true
