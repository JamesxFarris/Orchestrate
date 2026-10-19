# Eval bench

The eval bench answers one question: **does Orchestrate make agents do better work than they would on their own?** It runs small sample projects through the harness, checks the result with hidden tests, and can run the same projects through one plain Claude Code session (the *Claude alone* baseline) to compare the two.

Code: `packages/eval`. Results: `.orchestrate/evals/` (git-ignored).

## How a scenario is scored

Each scenario is a folder under `packages/eval/scenarios/<id>/`:

| Part | What it is |
|---|---|
| `scenario.json` | the request, a reference plan, and which hidden test plays each planned test file |
| `repo/` | the project as it starts (committed on `main` before a run) |
| `hidden/` | **judge tests** neither side ever sees: the ground truth |
| `solution/` | the reference answer, used by the scripted (free) runs |
| `flawed/` | optional: a tempting wrong fix that passes the repo's visible tests; a test checks the judge rejects it |

### The scenarios

| Scenario | What it tests | Where a lone agent tends to slip |
|---|---|---|
| `slugify` | a small feature | (easy; a sanity check) |
| `median-bug` | a bug fix from a user report | (easy) |
| `tax-endpoint` | a feature across two squads, in order | (fairly easy) |
| `duration-rules` | a bug report that lists many rules | fixing the reported example and missing the rest: the flawed fix scores 6/12 |
| `preview-ellipsis` | a change that must not affect anything else | editing the shared `truncate()`, which silently changes untested `headline()`: 6/8 |
| `discount-checkout` | a multi-file feature with exact rules | an exclusive expiry date or rounding down: 13/16 |
| `horde-survivor` | a CorpseGrinder-shaped game: eight systems (waves, chase, weapon, bullets, deaths, contact, levelling, upgrade choices) plus summary and save/load, built against a written spec across Engine and Gameplay squads | losing track over a long build; later systems breaking earlier ones; save/load that re-seeds the generator (the flawed fix: whole games still run, but a loaded game drifts) |

`horde-survivor` is the first **large** scenario: the kind of work Anthropic's harness article says a single session struggles with (see [the large-project direction](roadmap.md#direction-large-projects)). Its starting repo has the game loop already calling every system in a fixed order, each system an empty stub in its own module, and the full rules in `docs/spec.md`; that keeps parallel tasks off each other's files and lets QA's tests fail first. The judge has a file per system plus `game.test.js`, which plays whole scripted games: waves arrive and close in, the weapon kills and levels the player, a run left alone ends, and saving and loading mid-run changes nothing (the whole game must match an uninterrupted one exactly). Thresholds in `game.test.js` were set from the reference solution with a wide margin (checked at tick 1200, where it has 16 kills and level 3), because tiny floating-point differences between correct implementations can drift over a long run.

A scenario can bring its own team in `scenario.json` (`team.squads`, `team.maxRunUsd`); `horde-survivor` mirrors CorpseGrinder's Engine and Gameplay squads and raises the budget team's $2 cap to $8.

Every rule a judge test checks is stated in the request, so neither side is marked down for something it wasn't told. Each of the last three has a `flawed/` fix that passes the repo's own tests but not the judge, so the scenario can tell careful work from a plausible shortcut.

After a run, the judge tests are copied into a checkout of the code it produced and run with `node --test`. **Correct** means every judge test passed.

## What counts as "better"

Correctness alone would miss most of what Orchestrate claims. Its idea is about context: each agent starts fresh with a small, focused brief, instead of one long session that keeps growing. So every run is measured on:

| Measure | How | What it shows |
|---|---|---|
| Correctness | hidden judge tests | did it do what was asked |
| Regressions | the starting repo's own tests, restored as they were and re-run on the result | did it break what already worked |
| Scope | code files changed that no task needed (the reference plan's write scopes are the yardstick), and lines changed | did it stay on task, or wander and over-edit |
| Tests left behind | new `test(` / `it(` lines under `test/` | is the next change safer |
| Context | the largest prompt any single model request carried (`peak`), and every token over all sessions | does splitting the work keep each agent's context small, and what does the whole job cost in tokens |
| Refused tool calls, by tool | the scope guard's refusals (for Claude alone, attempts outside the project folder); the first 50 calls themselves are kept, and the scorecard lists the most common | is the guard wasting turns, and on what |
| Usage and time | the SDK's reported cost, wall-clock time | what it costs |

All of it is read from the run itself (the SDK's usage numbers and the result's git diff), so measuring costs no extra usage. The scorecard's "Beyond correctness" table and the HTML page show them side by side.

## The two arms

| Arm | What runs | Where the result comes from |
|---|---|---|
| `orchestrate` | the full harness with the fixed eval team (`team.ts`): plan, Tech Circle, QA first, implement, gates, review | the run's integration branch |
| `solo` | one Claude Code session (`solo.ts`) | whatever it left in the repo, committed as it stands |

Kept the same on both sides, so the gap is the harness and nothing else:

- the same model (the one the team writes code with: with `--budget` that's the budget implement model, Sonnet, not the default Opus), the same request, the same starting repo;
- the same project description (it says tests use `node --test`); the solo prompt is the request plus that description, nothing more, and no hint to write tests first;
- no user or project settings, plugins, or CLAUDE.md (`settingSources: []`);
- web tools off;
- credentials scrubbed from the commands agents run.

The solo session runs with `acceptEdits`; file tools are confined to the scenario repo. Its Bash is allowed, like a user approving commands in Claude Code. It may use up to 60 turns and $3, roughly what the team spends on a whole run.

## Running it

| Command | Costs | What it's for |
|---|---|---|
| `npm run eval` | free | the scripted team; must score 100%, checks the bench and the harness |
| `npm run eval -- --arms orchestrate,solo` | free | also the scripted solo; must score 100%, checks the baseline path and the report |
| `npm run eval -- --live --budget --arms orchestrate,solo` | **usage** | the real comparison, cheapest models |
| add `--repeat 3` | 3x usage | needed before trusting a gap |
| add `--only slugify` | less | one scenario; repeat the flag for several (`--only a --only b`) |

**Live runs spend Claude usage. Ask James first, with a rough cost** (see CLAUDE.md). The `main.ts` header estimates a few dollars per scenario for the team; the solo arm adds up to $3 per scenario.

## Reading the results

Each run writes a `.json` (raw), a `.md` scorecard, and, when the solo arm ran, an `.html` page:

- headline tiles (judge tests passed, runs fully correct, total cost, total time, per side);
- one bar chart per measure (judge tests passed, cost per run, time per run), Orchestrate and Claude alone side by side per scenario, with a hover tooltip and a table view;
- a one-sentence verdict, e.g. "Orchestrate passed 18 points more of the judge tests than Claude alone at 4.3x the cost."

Agents vary from run to run. With fewer than 3 runs per scenario per side the verdict says so, and a gap of a run or two should be treated as chance.

The scorecard's "since last run" line compares only Orchestrate runs, so adding the baseline doesn't skew it. Reports saved before the baseline existed have no `arm` field and are read as Orchestrate runs.

## Live results so far

| Date | Scenario | Setup | Orchestrate | Claude alone |
|---|---|---|---|---|
| 2026-10-18 | tax-endpoint | `--budget`, 1 run | 10/10, $0.48, 136s (after the guard fix) | 10/10, $0.20, 20s |
| 2026-10-18 | duration-rules, preview-ellipsis, discount-checkout | `--budget` (Sonnet writes code), 3 runs each | 8/9 correct, 104/108 judge tests, $3.34, 1200s | 9/9 correct, 108/108, $0.84, 174s |

**The first real comparison (commit 7c1c93d):** Claude alone was as accurate (more, by one discount-checkout run where Orchestrate scored 12/16) at a quarter of the usage and a seventh of the time.

| Beyond correctness, per run | Orchestrate | Claude alone |
|---|---|---|
| Existing tests still passing | 24/24 | 24/24 |
| Code files changed outside the reference plan | 3 (src/core/text.js) | 1 (src/core/text.js) |
| Code lines changed | 16 | 20 |
| Tests left behind | 14 | 2 |
| Agent sessions | 8 | 1 |
| Largest context in one session | 37k tokens | 41k tokens |
| Tokens over all sessions | 880k | 188k |
| Refused tool calls (total) | 43 (Bash 37, Grep 3, Read 3) | 0 |

What it means:
- **These scenarios don't need a team.** Every rule is in the request and each fits in one session; Sonnet alone solved all nine in about 20 seconds each. The traps (rules beyond the example, a shared helper, exact edge cases) didn't catch it.
- **The context advantage didn't show up.** Each Orchestrate session carries Claude Code's own system prompt and tools, so its largest context (37k) is barely below one solo session's (41k), while total tokens are 4.7x. Small, fresh contexts can only pay off on work big enough to fill one session's context, which none of these is.
- **Orchestrate leaves far more tests behind** (14 vs 2 per run): the one clear gain.
- **The guard refused 43 calls, 37 of them Bash:** about 4 wasted turns per run. Which commands isn't recorded yet.
- **The off-task measure overcounts.** It compares against the reference plan's files; both arms sometimes added a helper to src/core/text.js, and the neighbour tests (in the judge) passed every time, so no headline broke. Adding to a shared file isn't the same as breaking it.

The first smoke test found a harness bug rather than a result: Orchestrate scored 0/10 because the scope guard refused the `StructuredOutput` tool, so the planner could never hand in its plan. No earlier live test covered a job that answers with structured output. After the fix, both sides solve the easy scenario; Orchestrate took about 2.4x the usage and 7x the time. Orchestrate also hit 4 guard refusals; which tools they were isn't saved in the report yet.

## Known limits

- **The first three scenarios are small**, so they'll mostly show cost differences. The last three are where an accuracy gap, if there is one, should appear. Six scenarios is still a small sample.
- **Windows file locks.** Under parallel test load, git sometimes fails with "Permission denied" writing into `.git/objects` in the temp folder (antivirus or the indexer holding a new file). Seen in 2 of 6 full test runs once the baseline tests were added, never on `main` before them. The real-git eval suites retry once. Orchestrate's own git calls during a real run could hit the same race; a retry on that error in `packages/core/src/git/git.ts` would be the product-level fix (not done).
- Cost per run is what the SDK reports (`total_cost_usd`). On a subscription login that's an estimate of usage, not a bill.

## Change log

- 2026-10-17: the bench, three scenarios, the scorecard (harness/evals).
- 2026-10-18: the large horde-survivor scenario, and per-scenario teams. Branch eval/game-scenario.
- 2026-10-18: refused calls are recorded ("Bash npm test"), and the scorecard lists the most common. Branch eval/refused-calls.
- 2026-10-18: first real comparison on the three harder scenarios, 3 runs each (results above). Branch docs/first-comparison.
- 2026-10-18: measures beyond correctness (regressions, scope, lines changed, tests left behind, peak context, tokens, refusals by tool). The core runner now records each session's tokens and peak context. Branch eval/richer-measures.
- 2026-10-18: first live smoke test (tax-endpoint); it found and led to the StructuredOutput guard fix.
- 2026-10-18: three harder scenarios (duration-rules, preview-ellipsis, discount-checkout), each with a `flawed/` fix the judge must reject. Branch eval/harder-scenarios.
- 2026-10-18: with `--budget`, Claude alone now uses the team's implement model, so the comparison is like for like (branch eval/solo-budget-model).
- 2026-10-18: the Claude alone baseline (`--arms`), the comparison section and verdict in the scorecard, and the HTML comparison page. Branch eval/solo-baseline.
