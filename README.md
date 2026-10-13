# Orchestrate

You send one prompt to a **Master** (Head of Engineering). It plans the work into small, scoped task contracts. The **Tech Circle** reviews the plan, you approve it, and squads of Claude agents build it test-first. The orchestrator **enforces** each agent's scope and doesn't rely on the agents to stay inside it.

You watch the team in **Agent City**, a 3D night skyline. Each agent is a tower, and a tower's windows light up with a live summary card while that agent works.

## Quick start

```bash
npm install
npm run build -w @orchestrate/city                    # build the city UI once

# Demo mode: simulated runs, no API spend, no repo needed
npm run daemon -- --demo                              # http://127.0.0.1:4317

# Live mode: real agents on a real repo
npm run daemon -- --team presets/corpsegrinder.team.yaml --repo ../CorpseGrinder
```

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

| Chart role | Here |
|---|---|
| CTO | **You.** Approve plans and merge the final branch. |
| Head of Engineering | **Master.** Plans, never writes code, writes the run report. |
| Engineering Architect, Head of QA, Squad Leads | The **Tech Circle**, which reviews every plan before work starts. |
| Squad Manager + Lead Dev | **Lead.** Reviews diffs and rules on escalations. |
| Developers | **Dev / Analyst.** Implements exactly one contract. |
| QA Engineers | **QA.** Writes failing acceptance tests *before* any implementation exists. |
| Delivery Manager / Scrum | **Scheduler.** Plain code, not an LLM. |

Squads, roles, models, effort, budgets, test commands and policy all live in a team file. See [presets/corpsegrinder.team.yaml](presets/corpsegrinder.team.yaml). Set `enabled: true` on Product or Design to add them to the city.

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
npm test             # ~80 tests: scope guard, plan validation, scheduler, full pipeline on a real git fixture, API
npm run typecheck
ORCH_LIVE=1 npx vitest run packages/core/test/live.test.ts   # opt-in: one real agent, costs a few cents
```

The pipeline tests drive the whole flow with a scripted `FakeRunner` against a real git repo and real test commands. They cover a well-behaved team, an agent that writes out of scope, one that slips a change past the guard, one that tries to weaken its tests, failing gates, tests that are not red, lead grants and replans, Tech Circle revisions, and the approval gate.
