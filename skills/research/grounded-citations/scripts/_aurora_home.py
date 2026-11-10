"""Resolve AURORA_HOME for standalone skill scripts.

Skill scripts may run outside the Aurora process (system Python, nix env,
CI) where ``aurora_constants`` is not importable.  This module provides the
same ``get_aurora_home()`` contract without requiring it on ``sys.path``.

When ``aurora_constants`` IS available it is used directly so profile
resolution and any future enhancements are picked up automatically.
"""

from __future__ import annotations

import os
from pathlib import Path

try:
    from aurora_constants import get_aurora_home
except (ModuleNotFoundError, ImportError):

    def get_aurora_home() -> Path:
        """Return the Aurora home directory (default: ``~/.aurora``)."""
        val = os.environ.get("AURORA_HOME", "").strip()
        return Path(val) if val else Path.home() / ".aurora"
