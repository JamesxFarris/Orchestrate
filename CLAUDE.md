# CLAUDE.md

Guidelines for AI coding agents working in this repo: Claude Code sessions, and Orchestrate's own
agents when Orchestrate runs on itself (it reads this file as the project guide).

## How to work

Based on [andrej-karpathy-skills](https://github.com/multica-ai/andrej-karpathy-skills) (MIT).
These favour care over speed; for trivial changes, use judgment.

1. **Think before coding.** State your assumptions. If a request can be read more than one way,
   say so and ask; don't pick silently. If a simpler approach exists, say that too.
2. **Simplicity first.** Write the least code that solves the problem: no features, abstractions,
   options or error handling nobody asked for. If 200 lines could be 50, rewrite it.
3. **Surgical changes.** Touch only what the task needs. Match the surrounding style. Don't tidy
   neighbouring code; mention unrelated dead code instead of deleting it. Do remove anything your
   own change made unused. Every changed line should trace back to the request.
4. **Goal-driven.** Turn the task into a check ("write a test that reproduces the bug, then make
   it pass") and loop until it's verified. For multi-step work, give a short plan with a check
   per step.

## This project

- **Owner:** James, who builds this to learn. Explain what a change does and why, and ask
  clarifying questions before big changes.
- **Never spend usage without asking.** He's on the Claude Pro plan. Don't run live evals
  (`npm run eval -- --live`), real Orchestrate runs or `ORCH_LIVE=1` tests without his OK and a
  rough cost. Verify for free: FakeRunner tests, the scripted eval (`npm run eval`), demo mode
  (`npm run daemon -- --demo`), and screenshots (`node tools/shot.mjs`).
- **Checks before committing:** `npm run typecheck`, `npm test`, and for city changes
  `npm run build -w @orchestrate/city` plus a screenshot.
- **Git:** a branch per step, a descriptive commit, then `git merge --no-ff` into `main` and push
  (he often works from GitHub at his job). Never commit the `.claude/` folder.
- **Map:** `docs/roadmap.md` (done and next), `packages/core` (orchestrator, pipeline, gates,
  scope guard), `packages/server` (daemon), `packages/city` (3D UI), `packages/eval` (eval bench),
  `presets/` (teams, including `budget.team.yaml`), `tools/` (model build scripts, screenshots).
- **City style:** cozy and nature-toned, organic rather than symmetric; colour means status.
