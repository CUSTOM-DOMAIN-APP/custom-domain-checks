# Session visibility rules (every session: local, cloud, subagent-led; owner rule 2026-11-15)

The owner cannot follow long transcripts. Every session must make its state readable at a glance
without scrolling. These rules apply in addition to all other rules and are not optional.

## 1. Task list: use it constantly and granularly
- Keep the app's task list (`mcp__ccd_turn__update_plan` in the desktop app; `TodoWrite` or the
  Task tools elsewhere) for EVERY request that does more than answer one question.
- Break work into small, concrete steps (5 to 12 typical), written in plain words a non-engineer
  understands ("Fix the signup button", not "Patch onSubmit handler").
- Update it the moment a step starts or finishes. Add steps as you discover work. Never leave it stale.

## 2. End of every turn: plain English summary
When a turn ends after doing any work (not a one-line answer), the LAST thing in the reply is a
short section titled **What happened** written for a non-technical reader:
- 3 to 6 bullets, or a small table with columns `Item | Status | What it means`.
- Say what changed, what is done, what is not done, and what (if anything) the owner must do.
- No code, no file paths unless essential, no jargon, no dashes.

## 3. Cloud sessions: live status dashboard
Every cloud session (and any local session doing multi-step work longer than a few minutes) keeps
a status dashboard Artifact:
- Copy the template from `.claude/templates/session-dashboard.html` in the repo (local fallback:
  `~/.claude/templates/session-dashboard.html`) into your scratchpad and publish it with the
  Artifact tool. If the Artifact tool is not available, keep the same content as a markdown table
  at the top of each end of turn summary instead.
- Edit only its JSON block: title, goal, status, now, steps, timeline, needs_you, results.
- Publish it on the first turn and republish (same file path, same URL) whenever a step changes
  and at the end of every turn. Put the dashboard link in the **What happened** section.

## 4. Supabase and SQL
Supabase MCP tools and SQL run without asking. Do not stop to request approval for them. The data
lake rules (writes through `api.*` only, no DDL on prod) still apply.
