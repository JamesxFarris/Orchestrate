# 0001. Orchestrate runs locally, as a plugin, never hosted

Date: 2026-10-16 · Status: accepted

## Context

Orchestrate runs Claude agents that write code and then executes that code (the test gates) on the machine it runs on. A hosted, multi-user version would run strangers' agent-written code on our servers and would need accounts, per-run sandboxes and spending limits.

## Decision

Orchestrate is a local tool: the daemon, the city and the agents all run on the user's own machine, driven from Claude Code through the MCP server. The intended distribution is a Claude Code plugin (manifest + MCP server + daemon auto-start + slash commands). Nothing is hosted.

## Alternatives rejected

- **Hosted web app:** needs isolation per run (containers or VMs), user accounts and billing limits. A large project that gives the user nothing a local tool doesn't, and puts other people's code on our servers.

## Consequences

- The security model is local: the daemon binds to 127.0.0.1, refuses foreign Host headers and browser origins, and the scope guard confines each agent. See [security/threat-model.md](../security/threat-model.md).
- Agent-written test code runs unsandboxed with the user's permissions. Accepted for a local tool; the README should say so plainly, and users should use a VM or container for repos they don't trust.
- Features that assume a server (accounts, shared dashboards, remote storage) are out of scope.
