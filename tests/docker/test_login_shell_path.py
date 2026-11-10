"""Login shells in the image keep Aurora's own dirs on PATH.

Debian's ``/etc/profile`` resets PATH for every login shell, so without
``/etc/profile.d/aurora.sh`` a ``bash -l`` (``docker exec <c> bash -l``, ssh, the
terminal tool's background ``bash -lic``) lost ``/opt/aurora/bin`` and bare
``aurora`` exited 127 (#56634).
"""
from __future__ import annotations

import subprocess


def test_login_shell_resolves_aurora_to_the_image_shim(built_image: str) -> None:
    r = subprocess.run(
        ["docker", "run", "--rm", "-u", "aurora", "--entrypoint", "bash", built_image,
         "-lc", 'echo "aurora=$(command -v aurora)"; echo "path=$PATH"'],
        capture_output=True, text=True, timeout=60, check=False,
    )
    assert r.returncode == 0, r.stderr
    lines = dict(line.split("=", 1) for line in r.stdout.splitlines() if "=" in line)
    assert lines["aurora"] == "/opt/aurora/bin/aurora"
    entries = lines["path"].split(":")
    assert entries.index("/opt/aurora/bin") < entries.index("/opt/aurora/.venv/bin")
    assert entries.count("/opt/aurora/bin") == 1
