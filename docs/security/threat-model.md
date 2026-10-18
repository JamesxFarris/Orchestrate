# Threat model

Orchestrate is local-only ([decision 0001](../decisions/0001-local-only.md)). The threats are other things on the same machine (web pages in the browser, other local programs) and the agents themselves.

## Guarantees the code keeps

| Threat | Defence | Where | Test |
|---|---|---|---|
| A web page starts paid runs or ships | Daemon binds to 127.0.0.1; writes and WebSocket upgrades need an allowed Origin (localhost on the daemon's port and the city dev port 5173 only); `Sec-Fetch-Site` catches Origin-less browser posts | `packages/server/src/app.ts` | `packages/server/test/app.test.ts` |
| DNS rebinding | Host header must be localhost / 127.0.0.1 / [::1] | same | same |
| A dev server running agent-written code drives the daemon | Other localhost ports are not allowed origins, on purpose | same | "refuses other localhost ports" |
| Arguments smuggled into git | Refs must match `SAFE_REF` (no leading `-`, no `:`, no `..`), checked at the API, the MCP tool and the git helpers | `packages/shared/src/refs.ts`, `packages/core/src/git/git.ts`, `context/projectContext.ts` | `app.test.ts`, `context.test.ts` |
| An agent writes outside its task | Scope guard on every tool call (PreToolUse hook and `canUseTool`): write scope, read scope, protected test files | `packages/core/src/scope/scopeGuard.ts` | `scopeGuard.test.ts` |
| An agent runs arbitrary shell | Bash is an allowlist of full-match patterns; pipes, chaining, redirects and substitutions refused; git limited to read-only forms that can't print other files or write | same | same |
| Repo-planted config hijacks an agent | `settingSources: []` (no repo `.claude` settings, hooks or MCP servers), `verbatimPrompts` (no `@path` expansion), web tools disabled | `packages/core/src/runner/sdkRunner.ts` | `sdkOptions.test.ts` |
| Agent-written tests read API keys | Gate commands run with credential-like env vars removed; the CLI scrubs Anthropic credentials from subprocesses | `packages/core/src/gates/gates.ts`, `sdkRunner.ts` | `plan.test.ts` |

## Accepted risks

- **Agent-written code runs unsandboxed.** The gates execute tests agents wrote, with the user's permissions. Env vars are scrubbed, but that code can still read files such as `~/.claude/.credentials.json` or `~/.ssh` and use the network. Accepted for a local tool; use a VM, container or separate OS user for untrusted repos.
- **No authentication for local programs.** Any program on the machine can call the daemon (non-browser clients send no Origin). Ship merges locally and never pushes. A token is a small change if this matters later.

## Change log

- 2026-10-16: audit. Found and fixed baseRef argument injection (`git show --output=<path>`, effective on macOS/Linux; Windows rejects the `:` in the path). Merged to main 2026-10-18 from fix/git-ref-injection. No secrets in the repo or history; `npm audit` clean; UI renders no raw HTML.
