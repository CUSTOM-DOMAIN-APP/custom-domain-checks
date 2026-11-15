#!/usr/bin/env python3
"""Stop hook: if the turn did real work (used tools) but the final reply lacks a
'What happened' section, ask Claude to add one. Never loops (checks stop_hook_active)."""
import json, os, sys
# The user-level copy defers to a repo copy so the reason is not shown twice.
_here = os.path.realpath(__file__)
_repo = os.path.join(os.environ.get("CLAUDE_PROJECT_DIR", ""), ".claude/hooks/require-plain-summary.py")
if os.path.exists(_repo) and os.path.realpath(_repo) != _here and _here.startswith(os.path.expanduser("~/.claude/")):
    sys.exit(0)
try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(0)
if data.get("stop_hook_active"):
    sys.exit(0)
path = data.get("transcript_path")
if not path:
    sys.exit(0)
try:
    lines = open(path, encoding="utf-8").read().splitlines()[-400:]
except Exception:
    sys.exit(0)
entries = []
for l in lines:
    try:
        entries.append(json.loads(l))
    except Exception:
        pass
# walk back to the last real user prompt
tool_uses, last_text = 0, ""
for e in reversed(entries):
    t = e.get("type")
    msg = e.get("message") or {}
    content = msg.get("content")
    if t == "user":
        if isinstance(content, str) or (isinstance(content, list) and any(
                isinstance(c, dict) and c.get("type") == "text" for c in content)):
            break
        continue
    if t == "assistant" and isinstance(content, list):
        for c in content:
            if not isinstance(c, dict):
                continue
            if c.get("type") == "tool_use":
                tool_uses += 1
            elif c.get("type") == "text" and not last_text:
                last_text = c.get("text", "")
if tool_uses < 3:
    sys.exit(0)
if "what happened" in last_text.lower():
    sys.exit(0)
print(json.dumps({"decision": "block", "reason":
    "Owner rule: end this turn with a short section titled 'What happened': 3 to 6 plain "
    "English bullets (or a small Item | Status | What it means table) for a non-technical "
    "reader covering what changed, what is done, what is not done, and anything the owner "
    "must do. No code, no jargon, no dashes. If this session keeps a status dashboard "
    "artifact, republish it first and include its link."}))
