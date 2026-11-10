from __future__ import annotations

import os
from pathlib import Path
import subprocess
import sys


def test_platform_modules_only_import_stdlib_and_aurora_platform() -> None:
    root = Path(__file__).resolve().parents[2]
    code = """
import sys
before = set(sys.modules)
import aurora_platform.host.facts
import aurora_platform.host.gpu_adapters
import aurora_platform.host.runtime
import aurora_platform.host.products
import aurora_platform.host.summary
import aurora_platform.declaration
import aurora_platform.resolver
import aurora_platform.resolver.app
import aurora_platform.resolver.availability
import aurora_platform.resolver.known_dirs
new_top_levels = {name.partition('.')[0] for name in set(sys.modules) - before}
unexpected = sorted(
    name
    for name in new_top_levels
    if name not in sys.stdlib_module_names and not name.startswith('aurora_platform')
)
assert not unexpected, unexpected
"""
    env = os.environ.copy()
    env["PYTHONPATH"] = "."

    subprocess.run(
        [sys.executable, "-c", code],
        cwd=root,
        env=env,
        check=True,
    )
