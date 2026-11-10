# shellcheck shell=sh
# Installed as /etc/profile.d/aurora.sh. Debian's /etc/profile resets PATH for
# every login shell (`bash -l`, `docker exec <c> bash -l`, ssh, the terminal
# tool's background `bash -lic`), dropping the image's ENV PATH dirs, so bare
# `aurora` exits 127 there. Put them back in the ENV PATH order; dirs a login
# PATH already lists keep their position.
for __aurora_p in /opt/data/.local/bin /opt/aurora/.venv/bin /opt/aurora/bin; do
    case ":$PATH:" in
        *":$__aurora_p:"*) ;;
        *) PATH="$__aurora_p:$PATH" ;;
    esac
done
unset __aurora_p
export PATH
