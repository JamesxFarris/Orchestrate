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

Every rule a judge test checks is stated in the request, so neither side is marked down for something it wasn't told. Each of the last three has a `flawed/` fix that passes the repo's own tests but not the judge, so the scenario can tell careful work from a plausible shortcut.

After a run, the judge tests are copied into a checkout of the code it produced and run with `node --test`. **Correct** means every judge test passed.

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

The first smoke test found a harness bug rather than a result: Orchestrate scored 0/10 because the scope guard refused the `StructuredOutput` tool, so the planner could never hand in its plan. No earlier live test covered a job that answers with structured output. After the fix, both sides solve the easy scenario; Orchestrate took about 2.4x the usage and 7x the time. Orchestrate also hit 4 guard refusals; which tools they were isn't saved in the report yet.

## Known limits

- **The first three scenarios are small**, so they'll mostly show cost differences. The last three are where an accuracy gap, if there is one, should appear. Six scenarios is still a small sample.
- **Windows file locks.** Under parallel test load, git sometimes fails with "Permission denied" writing into `.git/objects` in the temp folder (antivirus or the indexer holding a new file). Seen in 2 of 6 full test runs once the baseline tests were added, never on `main` before them. The real-git eval suites retry once. Orchestrate's own git calls during a real run could hit the same race; a retry on that error in `packages/core/src/git/git.ts` would be the product-level fix (not done).
- Cost per run is what the SDK reports (`total_cost_usd`). On a subscription login that's an estimate of usage, not a bill.

## Change log

- 2026-10-17: the bench, three scenarios, the scorecard (harness/evals).
- 2026-10-18: first live smoke test (tax-endpoint); it found and led to the StructuredOutput guard fix.
- 2026-10-18: three harder scenarios (duration-rules, preview-ellipsis, discount-checkout), each with a `flawed/` fix the judge must reject. Branch eval/harder-scenarios.
- 2026-10-18: with `--budget`, Claude alone now uses the team's implement model, so the comparison is like for like (branch eval/solo-budget-model).
- 2026-10-18: the Claude alone baseline (`--arms`), the comparison section and verdict in the scorecard, and the HTML comparison page. Branch eval/solo-baseline.
