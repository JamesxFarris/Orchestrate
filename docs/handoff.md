# Handoff: where things stand

Written 2026-10-19 at the end of a long session, so work can pick up on another machine. Update or
replace this file at the end of each session; the detail lives in the linked notes.

## Start here

1. `git pull`, then `npm install` (the eval package gained a dependency).
2. Read this file, then [eval.md](eval.md) and the "Direction: large projects" section of [roadmap.md](roadmap.md).
3. To start a Claude Code session, paste:

   > Read docs/handoff.md, docs/eval.md and the "Direction: large projects" section of docs/roadmap.md. We're picking up at "Next steps", step 1: reducing the scope guard's refused shell calls. Explain the plan before changing anything, and don't run anything that spends usage without asking me first.

## What we did

- **Security fix:** git refs from the API and MCP tool are validated, so `--output=<file>` can't be smuggled into git (`packages/shared/src/refs.ts`). See [security/threat-model.md](security/threat-model.md).
- **Lag fix:** the city capped its pixel ratio, swapped 4x MSAA for SMAA at 1x, and runs bloom at half resolution: 22 → 82–98 fps on a 2x laptop screen. See [city/performance.md](city/performance.md); measure with `node tools/perf.mjs`.
- **Knowledge base:** `docs/` with decision records, subsystem notes and change logs. CLAUDE.md asks every behaviour change to update a note.
- **A real bug found by the first live eval:** the scope guard refused Claude Code's `StructuredOutput` tool, so in a live run no planner, reviewer or Tech Circle could ever answer. Fixed and confirmed live.
- **The eval bench can now compare Orchestrate with Claude alone** (`npm run eval -- --arms orchestrate,solo`): same model, request and starting repo, judged by hidden tests, with a scorecard and an HTML comparison page. Besides correctness it measures regressions, scope, lines changed, tests left behind, peak context, total tokens and refused calls (which calls, not just how many).
- **Seven scenarios:** three small, three with traps (rules beyond the example, a shared helper an untested caller depends on, exact edge cases), and the large `horde-survivor`, a CorpseGrinder-shaped game with 39 judge tests including a save/load determinism check. Each tricky one has a `flawed/` fix that passes the visible tests but not the judge.

## What we learned (live runs, budget models)

| Scenarios | Orchestrate | Claude alone |
|---|---|---|
| tax-endpoint (easy), 1 run | 10/10, $0.48 | 10/10, $0.20 |
| 3 trap scenarios, 3 runs each | 8/9 correct, $3.34 | 9/9 correct, $0.84 |
| horde-survivor, 3 runs | 2/3 correct, $1.98/run, ~9 min | 3/3 correct, $0.19/run, ~33 s |

- **Claude alone has won everything so far.** None of these scenarios is large for the model: even the game is about 200 lines, and Claude alone peaked at 49k tokens of context. Anthropic's harness article says a harness pays off once work goes beyond what one session reliably does; we haven't reached that size yet.
- **Orchestrate's one consistent win: it leaves far more tests behind** (74 vs 1 per game run).
- **Its small-context idea hasn't shown up yet:** every session starts at 20k+ tokens of Claude Code's own prompt plus the spec, so its peak (45k) was barely below solo's.
- **The scope guard is its biggest self-inflicted cost: about 22 refused shell calls per run.** Agents reach for `node --test x.test.js 2>&1 | tail -12`, chained `ls; cat; grep`, `git diff --stat main` (branch names aren't allowed in read-only git), `node --test test/core/` (a folder) and `node -e` experiments. Each refusal is a wasted turn; one failed run had a task escalate and never finish.

## Decisions

- **Orchestrate stays local, as a future Claude Code plugin, never hosted** ([decisions/0001-local-only.md](decisions/0001-local-only.md)). Personal use runs on the Claude Code login; publishing it would need users to bring an API key (Agent SDK rule), unless it's redesigned around Claude Code's own subagents. Plugin packaging is deferred.
- **Keep the team harness, because the goal is larger projects** (CorpseGrinder first, something bigger later). It has to prove itself on large work.
- **The city is a passive view, not the focus**: the decoration work (yards, market, landmarks, nature) was dropped in favour of making the agents measurably better.
- **Live runs spend Pro usage: always estimate and ask first** (CLAUDE.md).

## Next steps

1. **Cut the guard's friction (free to build).** Tell agents the allowed commands in their prompt; accept harmless output filters (`2>&1`, `| tail -N`, `| head -N`, `| grep`) on commands that are already allowed; allow the base branch in read-only git (`git diff --stat main`); allow `node --test` on a test folder inside the agent's own test scope. Keep everything that protects scope: no writes, no reading outside scope, no chaining arbitrary commands. Check with the scripted eval, then (with an OK) one live horde-survivor run to see the refusals drop.
2. **A genuinely large test.** A snapshot of the real CorpseGrinder repo as a scenario, with a feature from its backlog and judge tests written against it. Costs several dollars per side per run; estimate first.
3. **Scale the team to the task.** 31 sessions for 200 lines is too many: small requests should skip the Tech Circle and the separate QA agent.

Later, from the article: an evaluator that runs the app and its end-to-end checks (not just reading diffs), and a higher-level planner spec.
