"""Resolve AURORA_HOME for standalone skill scripts.

Skill scripts may run outside the Aurora process (e.g. system Python,
nix env, CI) where ``aurora_constants`` is not importable.  This module
provides the same ``get_aurora_home()`` and ``display_aurora_home()``
contracts as ``aurora_constants`` without requiring it on ``sys.path``.

When ``aurora_constants`` IS available it is used directly so that any
future enhancements (profile resolution, Docker detection, etc.) are
picked up automatically.  The fallback path replicates the core logic
from ``aurora_constants.py`` using only the stdlib.

All scripts under ``google-workspace/scripts/`` should import from here
instead of duplicating the ``AURORA_HOME = Path(os.getenv(...))`` pattern.
"""

from __future__ import annotations

import os
from pathlib import Path

try:
    from aurora_constants import display_aurora_home
    from aurora_constants import get_aurora_home
except (ModuleNotFoundError, ImportError):

    def get_aurora_home() -> Path:
        """Return the Aurora home directory (default: ~/.aurora).

        Mirrors ``aurora_constants.get_aurora_home()``."""
        val = os.environ.get("AURORA_HOME", "").strip()
        return Path(val) if val else Path.home() / ".aurora"

    def display_aurora_home() -> str:
        """Return a user-friendly ``~/``-shortened display string.

        Mirrors ``aurora_constants.display_aurora_home()``."""
        home = get_aurora_home()
        try:
            return "~/" + home.relative_to(Path.home()).as_posix()
        except ValueError:
            return str(home)
