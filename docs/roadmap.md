# Roadmap

Where Orchestrate stands and what comes next. Everything here can be built and tested without
spending model usage (scripted team, demo mode, screenshots); live runs are opt-in.

## Done

- **Audit fixes**, critical to low: daemon request checks (DNS rebinding, cross-site posts), shell-safe test paths, read-scope enforcement for Grep and git, verified integration heads, reviews that never approve by default, honest "failing first", restart and shutdown recovery, and many smaller fixes.
- **Harness**:
  - Role tools are always loaded, prompts are sent verbatim, and the CLI's startup message is checked.
  - Agents must finish with `submit_work` (Stop hook).
  - Context: a project guide (AGENTS.md / CLAUDE.md), a brief per task, notes on retries, the ADR list and memory of recent runs for the planner.
- **Evals** (`packages/eval`, `npm run eval`): sample projects with hidden judge tests, and a scorecard comparing runs. The scripted run is free.
- **Claude alone baseline** (`npm run eval -- --arms orchestrate,solo`): the same scenarios done by one plain Claude Code session, judged the same way, with a side-by-side scorecard and an HTML comparison page. See [eval.md](eval.md).
- **Budget**: a model per job (`jobs:`), short prompts for reviewers, a usage cap per run, a plain run report, and `presets/budget.team.yaml`.
- **City**: Kenney houses in an organic old village; a modern town around it, with a ring road, shops, towers and cars; the owner's tree and street lamps; a bigger island.

## Direction: large projects

On small, fully specified tasks Claude alone matched Orchestrate at a quarter of the usage ([eval.md](eval.md)). That fits Anthropic's [harness design article](https://www.anthropic.com/engineering/harness-design-long-running-apps): a harness pays off once the work is beyond what one session reliably does. Orchestrate is meant for large projects (CorpseGrinder first, something bigger later), so it has to prove itself there:

1. A large eval scenario: `horde-survivor`, a CorpseGrinder-shaped game. Done.
2. Record which calls the guard refuses. Done.
3. Run the large comparison. Done: Claude alone still won (3/3 vs 2/3, a tenth of the usage), because a 200-line game isn't large for the model; and the guard refused about 22 shell calls per run (see [eval.md](eval.md)).
4. Change the harness the article's way, one piece at a time, measuring each: an evaluator that runs the app and its end-to-end checks, a higher-level planner spec, and a team that scales to the task (small requests skip the Tech Circle and separate QA).

## Next

1. **Usage meter in the city.** Each run's usage against its cap (`policy.maxRunUsd`), broken down by job (plan, circle, qa, implement, review, ruling, summary), so you see spending as it happens.
2. **Learning from failures.**
   - Classify each failed or escalated task by the layer that broke: context, constraint (scope), verification (gates), or planning.
   - Detect loops: stop an agent repeating the same failure early, instead of spending its retries.
   - Keep a lessons file that agents read.
   - Add a "why tasks fail" view.
3. **Run inspector.** A timeline per run: every agent session, tool call, gate and cost, to see exactly where a run went wrong.
4. **More eval scenarios.** Seven now: three small, three built to show an accuracy gap (Claude alone still matched Orchestrate on them), and the large `horde-survivor` (see [eval.md](eval.md)).
   - A command that turns a failed run into a new scenario, so real failures become regression checks.
5. **City polish.**
   - New town pieces rise out of the ground like houses do.
   - Fill the gap between the village and the ring road (the Suburban and Modular Buildings kits are downloaded but unused).
   - Kenney Nature Kit tree variety, and Mini Characters townsfolk.

The recommended order is 1, then 2; 5 is the fun break.
