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

After a run, the judge tests are copied into a checkout of the code it produced and run with `node --test`. **Correct** means every judge test passed.

## The two arms

| Arm | What runs | Where the result comes from |
|---|---|---|
| `orchestrate` | the full harness with the fixed eval team (`team.ts`): plan, Tech Circle, QA first, implement, gates, review | the run's integration branch |
| `solo` | one Claude Code session (`solo.ts`) | whatever it left in the repo, committed as it stands |

Kept the same on both sides, so the gap is the harness and nothing else:

- the same model, the same request, the same starting repo;
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
| add `--only slugify` | less | one scenario |

**Live runs spend Claude usage. Ask James first, with a rough cost** (see CLAUDE.md). The `main.ts` header estimates a few dollars per scenario for the team; the solo arm adds up to $3 per scenario.

## Reading the results

Each run writes a `.json` (raw), a `.md` scorecard, and, when the solo arm ran, an `.html` page:

- headline tiles (judge tests passed, runs fully correct, total cost, total time, per side);
- one bar chart per measure (judge tests passed, cost per run, time per run), Orchestrate and Claude alone side by side per scenario, with a hover tooltip and a table view;
- a one-sentence verdict, e.g. "Orchestrate passed 18 points more of the judge tests than Claude alone at 4.3x the cost."

Agents vary from run to run. With fewer than 3 runs per scenario per side the verdict says so, and a gap of a run or two should be treated as chance.

The scorecard's "since last run" line compares only Orchestrate runs, so adding the baseline doesn't skew it. Reports saved before the baseline existed have no `arm` field and are read as Orchestrate runs.

## Known limits

- **The current scenarios are small** (a slug function, a median bug, a two-squad tax endpoint). Solo Claude will likely solve them, so they may show cost differences but not accuracy differences. Scenarios where the harness should matter (a multi-file feature, a scope trap, a bug where tests-first pays) are the next step.
- **The live solo path has not been run yet.** It is typechecked and shares its scoring with the tested scripted path, but its first live run is its real test.
- **Windows file locks.** Under parallel test load, git sometimes fails with "Permission denied" writing into `.git/objects` in the temp folder (antivirus or the indexer holding a new file). Seen in 2 of 6 full test runs once the baseline tests were added, never on `main` before them. The real-git eval suites retry once. Orchestrate's own git calls during a real run could hit the same race; a retry on that error in `packages/core/src/git/git.ts` would be the product-level fix (not done).
- Cost per run is what the SDK reports (`total_cost_usd`). On a subscription login that's an estimate of usage, not a bill.

## Change log

- 2026-10-17: the bench, three scenarios, the scorecard (harness/evals).
- 2026-10-18: the Claude alone baseline (`--arms`), the comparison section and verdict in the scorecard, and the HTML comparison page. Branch eval/solo-baseline.
