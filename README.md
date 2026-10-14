# Orchestrate

You send one prompt to a **Master** (the VP of Engineering). It plans the work into small, scoped task contracts. The **Tech Circle** reviews the plan, you approve it, and squads of Claude agents build it test-first. The orchestrator **enforces** each agent's scope and doesn't rely on the agents to stay inside it.

You watch the team in **Agent City**, a 3D night skyline. Each agent is a tower, and a tower's windows light up with a live summary card while that agent works.

## Quick start

```bash
npm install
npm run build -w @orchestrate/city                    # build the city UI once

# Demo mode: simulated runs, no API spend, no repo needed
npm run daemon -- --demo                              # http://127.0.0.1:4317

# Live mode: real agents on your own TypeScript web app (generic team)
npm run daemon -- --team presets/default.team.yaml --repo ../your-app

# Live mode with the CorpseGrinder game team
npm run daemon -- --team presets/corpsegrinder.team.yaml --repo ../CorpseGrinder
```

Before a live run on your own repo, open [presets/default.team.yaml](presets/default.team.yaml) and edit each squad's `owns` and `testDirs` to match your layout. They are the boundaries the orchestrator enforces. The file assumes `src/client`, `src/server`, `src/shared`, per-squad `tests/client`, `tests/server`, `tests/platform`, and `docs/` for design docs and ADRs. Also check that its `gates` commands (`npx tsc --noEmit`, `npx vitest run`) pass in your repo as-is.

The target repo comes from `--repo` if you pass it, otherwise from `project.repoPath` in the team file. They resolve differently:

- `--repo` resolves against the Orchestrate checkout, because npm runs scripts from there.
- `project.repoPath` resolves against the team file's own directory, so in `presets/` it reads `../../your-app`.

With neither set, the daemon exits with an error. Demo mode ignores both. Without `--team`, the daemon loads `presets/corpsegrinder.team.yaml`. You can also set `ORCH_TEAM` and `ORCH_REPO` instead of passing the flags.

Open http://127.0.0.1:4317 and type a request into the prompt bar. While working on the UI, `npm run city` serves it with hot reload on :5173 and proxies to the daemon.

Live mode uses the Claude Agent SDK. It authenticates through `ANTHROPIC_API_KEY` or your Claude Code login.

### From Claude Code (MCP)

```bash
claude mcp add orchestrate -- node --import tsx C:/James/Orchestrate/packages/mcp/src/main.ts
```

| Tool | What it does |
|---|---|
| `orchestrate_submit` | Hands a request to the Master. |
| `orchestrate_wait` | Blocks until the plan needs approval or the run finishes. |
| `orchestrate_plan` | Shows the full task contracts (scopes, tests, acceptance criteria). |
| `orchestrate_approve` / `orchestrate_cancel` | The CTO gate. |
| `orchestrate_status`, `orchestrate_team` | Run board and org chart. |

The MCP server talks to the daemon at `ORCH_URL` (default `http://127.0.0.1:4317`), so the daemon must be running.

## The org (squad/chapter model)

Buildings carry standard industry job titles. Titles repeat across squads (every squad has a Tech Lead), so the city always shows the squad alongside the title.

| Title | Here |
|---|---|
| CTO | **You.** Approve plans and merge the final branch. |
| VP of Engineering | **Master.** Plans, never writes code, writes the run report. |
| Principal Architect, QA Manager, Tech Leads | The **Tech Circle**, which reviews every plan before work starts. |
| Tech Lead (one per squad) | **Lead.** Reviews diffs and rules on escalations. |
| Software Engineer | **Dev.** Implements exactly one contract. |
| Systems Analyst (Architecture squad) | **Analyst.** Designs before anyone codes. When work spans 2+ squads, adds a module or subsystem, or needs a design decision, the Master plans a spec task first. The analyst writes a design doc (`docs/design/<slug>.md`: goals, non-goals, module boundaries, cross-squad contracts, data flow, edge cases, testing notes) and an ADR (`docs/adr/NNNN-<slug>.md`: context, decision, rejected alternatives, consequences). The code tasks depend on it. Small single-squad changes skip it. |
| QA Engineer | **QA.** Writes failing acceptance tests *before* any implementation exists. |
| Delivery Manager / Scrum | **Scheduler.** Plain code, not an LLM. |

Squads, roles, models, effort, budgets, test commands and policy all live in a team file. Two presets ship:

- [presets/default.team.yaml](presets/default.team.yaml): a generic web-app team with Frontend, Backend, Platform and Architecture squads.
- [presets/corpsegrinder.team.yaml](presets/corpsegrinder.team.yaml): a game team with Gameplay, Core Engine, Render & UI and Architecture squads.

A test loads every `presets/*.team.yaml` through the real org loader, so a broken preset fails `npm test`. Set `enabled: true` on the Product Manager or Product Designer to add them to the city.

## How drift is prevented

1. **Task contracts.** Each task has an objective, testable acceptance criteria, non-goals, a narrow `writeScope`, exact `testFiles`, dependencies and a line cap. Deterministic validation rejects plans that write outside the squad's ownership, place tests in another squad's directories, use unbounded globs, contain cycles or exceed the size cap.
2. **Fresh session per task.** The agent sees only its contract. Repo `CLAUDE.md` and settings files are not loaded (`settingSources: []`).
3. **Scope guard on every tool call.** A PreToolUse hook and `canUseTool` both check each call:
   - Writes outside scope are denied.
   - QA's test files are protected from the dev.
   - Bash may run only allowlisted gate commands and read-only git, with no chaining, pipes or redirects.
   - Web tools and sub-agents are off.
4. **Escalate, don't improvise.** Agents call `request_scope_change` or `raise_blocker` and stop. The lead then grants extra scope (only inside the squad's ownership), denies with guidance, or sends the task back for a replan.
5. **Post-hoc audit.** The orchestrator diffs what actually changed on disk. Out-of-scope or protected-file changes are reverted and fed back to the agent.
6. **Gates throughout.**
   - **Red:** QA's tests must fail before implementation.
   - **Green:** typecheck, lint and the task's tests must pass.
   - **Review:** the lead checks the diff against the acceptance criteria.
   - **Merge:** after each merge the full suite runs on the integration branch, and a regression is rolled back.
7. **Isolation.** Every task runs in its own git worktree. Work lands on `orch/run-<id>`. **`main` is never touched or pushed.** You merge it yourself.

## City models

Each role kind occupies a skyscraper from `Models/buildings.blend`, converted to a 2.9 MB meshopt-compressed GLB at `packages/city/public/models/buildings.glb`. The conversion script, [tools/export_buildings.py](tools/export_buildings.py), applies the following:

- Uprights each model and normalizes it to unit height.
- Reduces materials to body, glass and trim.

At runtime the city restyles those materials:

- **Body:** limestone or platinum.
- **Trim:** squad accent.
- **Glass:** reflective, lighting up floor by floor in the agent's activity color.

The role-to-model mapping and target heights are set in [archetypes.ts](packages/city/src/scene/archetypes.ts).

### The park

The city sits in a park, and its trees and paths carry information:

- **Task trees:** each task in the current run is a tree on its district's side facing HQ.
  - It grows as the task moves through tests, build and review.
  - It blooms green on merge.
  - It goes bare and red-tinged if the task escalates or fails.
  - A ring on the lawn shows its status, and clicking the tree opens the task.
- **City glow:** when a run completes, a wave of green light rolls out from HQ across the lawn and trees.
- **Path pulses:** every handoff sends light along the footpaths between the two agents' towers.
- **History:** each finished run leaves one landmark tree in each district it touched, lush if the work merged and weathered if it escalated. There are at most 12 per district; after that the grove grows bigger rather than more crowded.

### Troubleshooting the city

Add these query flags to the city's URL to turn individual effects off:

| Flag | Turns off |
|---|---|
| `?fx=0` | post-processing (bloom/vignette) |
| `?sky=0` | sky dome |
| `?env=0` | environment reflections |
| `?links=0` | live data links |
| `?aura=0` | light columns |
| `?pulses=0` | path pulses |

Flags combine, for example `?fx=0&aura=0`. A black canvas with only labels showing almost always means a shader produced NaN pixels, which bloom then spreads across the whole frame. Software renderers hide this, so check on a real GPU (D3D11/ANGLE).

## Layout

```
packages/shared   zod schemas: team config, task contracts, plans, events
packages/core     org loader, planner + Tech Circle, scheduler, scope guard, runners, gates, git worktrees, store
packages/server   Fastify daemon (REST + WebSocket); demo backend
packages/mcp      MCP stdio server for Claude Code
packages/city     Vite + React Three Fiber city
presets/          team files
```

## Tests

```bash
npm test             # ~90 tests: scope guard, plan validation, presets, scheduler, full pipeline on a real git fixture, API
npm run typecheck
ORCH_LIVE=1 npx vitest run packages/core/test/live.test.ts   # opt-in: one real agent, costs a few cents
```

The pipeline tests drive the whole flow with a scripted `FakeRunner` against a real git repo and real test commands. They cover a well-behaved team, an agent that writes out of scope, one that slips a change past the guard, one that tries to weaken its tests, failing gates, tests that are not red, lead grants and replans, Tech Circle revisions, and the approval gate.
