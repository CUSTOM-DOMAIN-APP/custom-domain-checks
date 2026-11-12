#!/usr/bin/env bash
# Entire for Claude Code cloud sessions (any Claude account, any CUSTOM-DOMAIN-APP repo).
#
#   start    install pinned, checksum-verified entire + gitleaks, turn on Entire's git hooks,
#            keep automatic pushing off (checkpoints are pushed only by this script).
#   push     scan every outgoing checkpoint with gitleaks and push only the clean ones
#            to the private repo CUSTOM-DOMAIN-APP/entire-checkpoints.
#   push-bg  same as push, detached, so the end of a turn is not slowed down.
#
# Runs only when CLAUDE_CODE_REMOTE=true (Claude Code on the web) or ENTIRE_BOOTSTRAP_FORCE=1.
# On a Mac with Entire installed it exits at once; the Mac uses its own safe-push gate.
# Pushing needs one secret in the cloud environment: ENTIRE_CHECKPOINT_TOKEN, a fine-grained
# GitHub token with Contents read/write on CUSTOM-DOMAIN-APP/entire-checkpoints only.
# Without it, checkpoints stay in the session and nothing is pushed.
set -u
mode="${1:-start}"
[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || [ "${ENTIRE_BOOTSTRAP_FORCE:-}" = "1" ] || exit 0
root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}"
[ -n "$root" ] && cd "$root" 2>/dev/null || exit 0

ENTIRE_VERSION=0.13.2
GITLEAKS_VERSION=8.30.1
BIN="$HOME/.local/bin"
export PATH="$BIN:$PATH"
LOG="$HOME/.entire-cloud.log"
log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >> "$LOG" 2>/dev/null; }

fetch() { # url sha256 out
  curl -fsSL --retry 2 --max-time 120 -o "$3" "$1" || return 1
  [ "$(sha256sum "$3" | cut -d' ' -f1)" = "$2" ] || { log "checksum mismatch for $1"; return 1; }
}

install_tools() {
  case "$(uname -s)-$(uname -m)" in
    Linux-x86_64|Linux-amd64)
      ea=amd64; ga=x64
      es=fbcdb026cfdcdb0e6ea8405b9a2e6f3abf8047a26c31d71e16206a7dd9e85f4d
      gs=551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb ;;
    Linux-aarch64|Linux-arm64)
      ea=arm64; ga=arm64
      es=bae5062def376ff57e8ad1568c5f8e218a7a8b3930908aceb021a8b1fe8f4719
      gs=e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080 ;;
    *) return 0 ;;  # macOS and others install Entire themselves (brew)
  esac
  mkdir -p "$BIN"
  t="$(mktemp -d)"
  if ! command -v entire >/dev/null 2>&1; then
    if fetch "https://github.com/entireio/cli/releases/download/v${ENTIRE_VERSION}/entire_linux_${ea}.tar.gz" "$es" "$t/e.tgz" \
       && tar -xzf "$t/e.tgz" -C "$t" entire git-remote-entire; then
      install -m 755 "$t/entire" "$t/git-remote-entire" "$BIN/" && log "installed entire $ENTIRE_VERSION"
    else
      log "entire install failed (is github.com reachable from this environment?)"
    fi
  fi
  if ! command -v gitleaks >/dev/null 2>&1; then
    if fetch "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_${ga}.tar.gz" "$gs" "$t/g.tgz" \
       && tar -xzf "$t/g.tgz" -C "$t" gitleaks; then
      install -m 755 "$t/gitleaks" "$BIN/" && log "installed gitleaks $GITLEAKS_VERSION"
    else
      log "gitleaks install failed"
    fi
  fi
  rm -rf "$t"
  # Make the tools visible to Claude's Bash tool for the rest of the session.
  if [ -n "${CLAUDE_ENV_FILE:-}" ] && ! grep -qs "$BIN" "$CLAUDE_ENV_FILE"; then
    printf 'export PATH="%s:$PATH"\n' "$BIN" >> "$CLAUDE_ENV_FILE"
  fi
}

start() {
  install_tools
  command -v entire >/dev/null 2>&1 || exit 0
  [ "$(git config --local --get entire.cloudBootstrap 2>/dev/null)" = "$ENTIRE_VERSION" ] && exit 0
  # Git hooks only; the Claude hooks are already committed in .claude/settings.json.
  entire enable --local --agent claude-code --checkpoint-backend refs --telemetry=false \
    </dev/null >/dev/null 2>&1 || log "entire enable failed"
  entire configure --checkpoint-push-policy manual --local </dev/null >/dev/null 2>&1 || true
  # The committed settings say push_sessions false (so git push never uploads); allow uploads
  # for this clone only, which with the manual policy means only through 'push' below.
  python3 - <<'PY' || log "could not write .entire/settings.local.json"
import json, os
p = ".entire/settings.local.json"
d = json.load(open(p)) if os.path.exists(p) else {}
d.setdefault("strategy_options", {})["push_sessions"] = True
json.dump(d, open(p, "w"), indent=2)
PY
  # enable may rewrite tracked files; keep the committed versions.
  git checkout -- .claude/settings.json .entire/settings.json .entire/.gitignore 2>/dev/null || true
  git config --local entire.cloudBootstrap "$ENTIRE_VERSION"
  log "enabled in $root"
}

push() {
  command -v entire >/dev/null 2>&1 && command -v gitleaks >/dev/null 2>&1 || exit 0
  [ -n "${ENTIRE_CHECKPOINT_TOKEN:-}" ] || { log "ENTIRE_CHECKPOINT_TOKEN not set; checkpoints kept local"; exit 0; }
  lock="$(git rev-parse --git-common-dir)/entire-cloud.lock"
  exec 9>"$lock"
  command -v flock >/dev/null 2>&1 && { flock -w 120 9 || exit 0; }
  entire checkpoint list --outgoing --json 2>/dev/null | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)
target = (d.get("checkpoint_sync_remote") or "")
if "CUSTOM-DOMAIN-APP/entire-checkpoints" not in str(target):
    sys.stderr.write("unexpected checkpoint remote, not pushing\n"); sys.exit(0)
for c in d.get("checkpoints") or []:
    if c.get("checkpoint_id") and c.get("ref"):
        print(c["checkpoint_id"], c["ref"])
' 2>>"$LOG" | while read -r id ref; do
    commit="$(git rev-parse --verify -q "$ref^{commit}")" || continue
    t="$(mktemp -d)"
    if git archive "$commit" | tar -x -C "$t" 2>/dev/null \
       && gitleaks dir "$t" --no-banner --log-level error --redact --exit-code 7 >/dev/null 2>&1; then
      if entire checkpoint push "$id@$commit" --json >/dev/null 2>&1; then log "pushed $id"; else log "push failed $id"; fi
    else
      log "held back $id: gitleaks found a possible secret (Entire redaction missed it); not pushed"
    fi
    rm -rf "$t"
  done
}

case "$mode" in
  start) start ;;
  push) push ;;
  push-bg) nohup bash "$0" push </dev/null >/dev/null 2>&1 & ;;
  *) exit 0 ;;
esac
exit 0
