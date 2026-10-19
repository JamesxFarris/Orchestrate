# Orchestrate knowledge base

This folder records how Orchestrate works and why it is built the way it is. Use it before changing a subsystem, and add to it with every change, so the next person (or agent) doesn't have to dig the reasoning out of git history.

Orchestrate is a tool for getting a team of Claude agents to work well together. Agent City, the 3D view, exists to make that teamwork easy to see: who is working, who is blocked, what shipped. Decoration is there to make it pleasant to watch, and must never get in the way of that.

## Layout

| Path | What goes there |
|---|---|
| [decisions/](decisions/) | Decision records: one numbered file per decision that would be expensive to reverse or easy to forget. Never rewritten; a later record supersedes an earlier one. |
| [city/](city/) | How Agent City is built, one living document per subsystem. |
| [security/](security/) | The threat model and the guarantees the code keeps. |
| [roadmap.md](roadmap.md) | What's done and what's next. |

## Rules for notes

- **Every change that alters behaviour updates a note.** New subsystem: new file. Changed subsystem: edit its document and add a line to its *Change log*. A decision with alternatives worth remembering: a new record in `decisions/`.
- **Write what the code can't say:** why it is this way, what was tried and rejected, the numbers behind a tuning choice, and how to check it still works.
- **Keep the change log short:** date, one line, the branch or commit.
- **Measurements carry their setup:** the machine, the URL flags, and the script, so they can be repeated.

## Decision record template

```markdown
# NNNN. Title

Date: YYYY-MM-DD · Status: accepted | superseded by NNNN

## Context
What forced a decision.

## Decision
What we chose.

## Alternatives rejected
What else we considered and why not.

## Consequences
What this makes easy, what it makes hard, and what to watch.
```

## Index

- [Handoff](handoff.md): where things stand and where to pick up
- [Roadmap](roadmap.md)
- [Eval bench](eval.md): scoring the harness, and comparing it with Claude alone
- Decisions
  - [0001. Orchestrate runs locally, as a plugin, never hosted](decisions/0001-local-only.md)
- City
  - [Performance](city/performance.md): the frame budget, what costs what, and how to measure it
- Security
  - [Threat model](security/threat-model.md)
