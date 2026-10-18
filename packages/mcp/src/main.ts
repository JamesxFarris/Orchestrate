import { request } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SAFE_REF, type ProgressSnapshot, type RunState } from '@orchestrate/shared';
import { z } from 'zod';

/** Thin MCP front door: Claude Code talks to the Master through the local Orchestrate daemon. */
const BASE = (process.env.ORCH_URL ?? 'http://127.0.0.1:4317').replace(/\/$/, '');
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

/**
 * One request to the daemon. node:http rather than fetch: fetch gives up after 5 minutes without
 * response headers, and a ship that re-runs the full suite can take longer (it would be reported
 * as failed while it carried on).
 */
async function api<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  let status: number;
  let text: string;
  try {
    ({ status, text } = await new Promise<{ status: number; text: string }>((resolve, reject) => {
      const req = request(`${BASE}${path}`, { method, headers: payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {} }, (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c: string) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, text: data }));
        res.on('error', reject);
      });
      req.on('error', reject);
      req.end(payload);
    }));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ECONNREFUSED') throw new Error(`Orchestrate daemon is not reachable at ${BASE}. Start it with "npm run daemon" (or "npm run daemon -- --demo").`);
    throw new Error(`Request to the Orchestrate daemon failed (${method} ${path}): ${(err as Error).message}`);
  }
  let data: T & { error?: string; output?: string };
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`${method} ${path} -> HTTP ${status}: ${text.slice(0, 300)}`);
  }
  if (status < 200 || status >= 300) {
    // a refused ship carries git's or the test suite's output: keep its end, where the reason is
    const output = data.output ? `\n${data.output.slice(-2000)}` : '';
    throw new Error(`${data.error ?? `${method} ${path} -> HTTP ${status}`}${output}`);
  }
  return data;
}

const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });

function describeRun(r: RunState, verbose = false): string {
  const lines = [
    `Run ${r.id} — ${r.status}${r.detail ? ` (${r.detail})` : ''}`,
    `Request: ${r.prompt.slice(0, 300)}`,
    `Cost so far: $${r.costUsd.toFixed(2)}`,
  ];
  if (r.integrationBranch) lines.push(`Integration branch: ${r.integrationBranch}`);
  if (r.plan) lines.push('', `Plan: ${r.plan.summary}`);
  for (const t of r.tasks) {
    lines.push(`- [${t.status}] ${t.contract.id} (${t.contract.squad}/${t.contract.kind}): ${t.contract.title}${t.detail ? ` — ${t.detail}` : ''}`);
    if (verbose) {
      lines.push(`    objective: ${t.contract.objective}`);
      lines.push(`    write scope: ${t.contract.writeScope.join(', ')}`);
      if (t.contract.testFiles.length) lines.push(`    tests: ${t.contract.testFiles.join(', ')}`);
      lines.push(`    acceptance: ${t.contract.acceptanceCriteria.join(' | ')}`);
      if (t.contract.dependsOn.length) lines.push(`    depends on: ${t.contract.dependsOn.join(', ')}`);
    }
  }
  if (verbose && r.plan?.risks.length) lines.push('', `Risks: ${r.plan.risks.join(' | ')}`);
  if (r.summary) lines.push('', `Report: ${r.summary}`);
  if (r.status === 'awaiting_approval') lines.push('', 'Waiting for CTO approval: call orchestrate_approve to start execution, or orchestrate_cancel.');
  return lines.join('\n');
}

const server = new McpServer({ name: 'orchestrate', version: '0.1.0' });

server.registerTool(
  'orchestrate_submit',
  {
    title: 'Send a request to the Master',
    description:
      'Hand a feature request or bug to the engineering team. The VP of Engineering (the Master) plans it into scoped tasks, the Tech Circle reviews, and (after approval) squads implement with tests first. Watch progress in the City at the daemon URL.',
    inputSchema: {
      prompt: z.string().min(3).max(20_000).describe('What you want built or fixed, with any constraints.'),
      autoApprove: z.boolean().optional().describe('Skip the human plan-approval gate when the Tech Circle approves the plan. Default false.'),
      baseRef: z.string().regex(SAFE_REF, 'baseRef must be a branch, tag or commit').optional().describe('Branch/commit to build on. Defaults to the project default branch.'),
    },
  },
  async (args) => {
    const run = await api<RunState>('POST', '/api/runs', args);
    return text(`Submitted run ${run.id}. City: ${BASE}\nUse orchestrate_wait to follow it, then orchestrate_plan to review the plan.`);
  },
);

server.registerTool(
  'orchestrate_status',
  {
    title: 'Run status',
    description: 'Status of one run (with its task board), or the most recent runs when no id is given.',
    inputSchema: { runId: z.string().optional() },
  },
  async ({ runId }) => {
    if (runId) return text(describeRun(await api<RunState>('GET', `/api/runs/${encodeURIComponent(runId)}`)));
    const runs = await api<RunState[]>('GET', '/api/runs');
    return text(runs.length ? runs.slice(0, 10).map((r) => `${r.id}  ${r.status.padEnd(17)} ${r.prompt.slice(0, 80)}`).join('\n') : 'No runs yet.');
  },
);

server.registerTool(
  'orchestrate_plan',
  {
    title: 'Show the plan',
    description: 'Full task contracts for a run: objectives, write scopes, test files, acceptance criteria, dependencies.',
    inputSchema: { runId: z.string() },
  },
  async ({ runId }) => text(describeRun(await api<RunState>('GET', `/api/runs/${encodeURIComponent(runId)}`), true)),
);

server.registerTool(
  'orchestrate_wait',
  {
    title: 'Wait for a run',
    description: 'Block until the run needs approval, finishes, or the timeout passes, then return its status.',
    inputSchema: { runId: z.string(), timeoutSeconds: z.number().int().min(5).max(600).optional() },
  },
  async ({ runId, timeoutSeconds = 120 }) => {
    const deadline = Date.now() + timeoutSeconds * 1000;
    let run = await api<RunState>('GET', `/api/runs/${encodeURIComponent(runId)}`);
    while (!TERMINAL.has(run.status) && run.status !== 'awaiting_approval' && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2000));
      run = await api<RunState>('GET', `/api/runs/${encodeURIComponent(runId)}`);
    }
    return text(describeRun(run));
  },
);

server.registerTool(
  'orchestrate_approve',
  {
    title: 'Approve a plan (CTO gate)',
    description: 'Approve a run that is awaiting approval so squads start executing.',
    inputSchema: { runId: z.string() },
  },
  async ({ runId }) => {
    await api('POST', `/api/runs/${encodeURIComponent(runId)}/approve`);
    return text(`Approved ${runId}. Execution started.`);
  },
);

server.registerTool(
  'orchestrate_cancel',
  {
    title: 'Cancel a run',
    description: 'Stop a run. Agents are aborted; merged work stays on the integration branch.',
    inputSchema: { runId: z.string() },
  },
  async ({ runId }) => {
    await api('POST', `/api/runs/${encodeURIComponent(runId)}/cancel`);
    return text(`Cancelled ${runId}.`);
  },
);

server.registerTool(
  'orchestrate_ship',
  {
    title: 'Ship a finished project',
    description:
      "Merge a completed run's branch into the project's default branch as a merge commit. It merges in a scratch copy first, re-runs the full test suite if the default branch moved since the run started, and refuses (changing nothing) on conflicts, failing tests, or uncommitted edits to the same files. Use markOnly when the work was already merged some other way (e.g. a squash merge) to just record it as shipped.",
    inputSchema: {
      runId: z.string(),
      markOnly: z.boolean().optional().describe('Only record the run as shipped; do not merge. For squash or rebase merges done elsewhere.'),
      partial: z
        .boolean()
        .optional()
        .describe('Ship even though some tasks did not finish (only the finished work ships). Ask the user first: it lands part of a feature.'),
    },
  },
  async ({ runId, markOnly, partial }) => {
    const id = encodeURIComponent(runId);
    if (markOnly) {
      await api('POST', `/api/runs/${id}/mark-shipped`);
      return text(`Marked ${runId} as shipped. Its growth is banked.`);
    }
    const res = await api<{ sha: string; alreadyShipped: boolean; tested: boolean }>('POST', `/api/runs/${id}/ship`, partial ? { partial } : undefined);
    if (res.alreadyShipped) return text(`${runId} was already in the default branch; recorded as shipped.`);
    return text(`Shipped ${runId} as merge commit ${res.sha.slice(0, 10)}${res.tested ? ' (the full suite passed on the combined code first)' : ''}. Its growth is banked.`);
  },
);

server.registerTool(
  'orchestrate_progress',
  {
    title: 'District progress',
    description: "Each squad district's size (Hamlet → City), banked and pending growth, and its run of clean ships.",
    inputSchema: {},
  },
  async () => {
    const [progress, team] = await Promise.all([
      api<ProgressSnapshot>('GET', '/api/progress'),
      api<{ squads: { id: string; name: string }[] }>('GET', '/api/team'),
    ]);
    const name = (id: string) => team.squads.find((s) => s.id === id)?.name ?? id;
    const lines = progress.districts.map((d) => {
      const s = d.settlement;
      const pending = d.pending ? `, +${d.pending} pending (→ ${d.settlementAfterPending.name})` : '';
      return `${name(d.squad)}: ${s.name} (${s.into}/${s.needed} to next)${pending} · ${d.streak} clean ships in a row · ${d.ships} shipped`;
    });
    return text(lines.join('\n') || 'No districts.');
  },
);

server.registerTool(
  'orchestrate_team',
  {
    title: 'Org chart',
    description: 'The engineering org: squads, roles, reporting lines and the Tech Circle.',
    inputSchema: {},
  },
  async () => {
    const team = await api<{
      project: { name: string };
      squads: { id: string; name: string; mission: string }[];
      roles: { id: string; title: string; squad?: string; reportsTo?: string }[];
      techCircle: string[];
    }>('GET', '/api/team');
    const hq = team.roles.filter((r) => !r.squad);
    const lines = [`${team.project.name} engineering`, '', 'HQ:', ...hq.map((r) => `  ${r.title} (${r.id})`)];
    for (const s of team.squads) {
      lines.push('', `${s.name} squad — ${s.mission}`);
      for (const r of team.roles.filter((x) => x.squad === s.id)) lines.push(`  ${r.title} (${r.id}) → reports to ${r.reportsTo ?? '—'}`);
    }
    lines.push('', `Tech Circle: ${team.techCircle.join(', ')}`);
    return text(lines.join('\n'));
  },
);

await server.connect(new StdioServerTransport());
