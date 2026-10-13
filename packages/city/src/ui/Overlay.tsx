import { useMemo, useState } from 'react';
import type { OrchestrateEvent, RunState } from '@orchestrate/shared';
import { api } from '../api.ts';
import { ACTIVITY_COLOR, ACTIVITY_LABEL, TASK_COLOR, TASK_LABEL, useCity } from '../store.ts';
import { RoleIcon } from './roleIcons.tsx';

const useCurrentRun = (): RunState | undefined => useCity((s) => (s.currentRunId ? s.runs[s.currentRunId] : undefined));

const STATUS_LABEL: Record<RunState['status'], string> = {
  planning: 'Planning',
  reviewing: 'Tech Circle review',
  awaiting_approval: 'Awaiting your approval',
  executing: 'Executing',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export function TopBar({ onOpenPlan }: { onOpenPlan: () => void }) {
  const team = useCity((s) => s.team);
  const connected = useCity((s) => s.connected);
  const run = useCurrentRun();
  const live = run && !['completed', 'failed', 'cancelled'].includes(run.status);

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand__mark" aria-hidden>
          <i />
          <i />
          <i />
        </span>
        <div>
          <div className="brand__name">Agent City</div>
          <div className="brand__sub">
            {team?.project.name ?? '…'} · {team?.roles.length ?? 0} agents
          </div>
        </div>
        {team && <span className={`badge badge--${team.mode}`}>{team.mode === 'demo' ? 'DEMO' : 'LIVE'}</span>}
        <span className={`conn ${connected ? 'conn--on' : ''}`} title={connected ? 'Connected to daemon' : 'Reconnecting…'} />
      </div>

      {run && (
        <div className={`runpill runpill--${run.status}`}>
          <span className="runpill__dot" />
          <span className="runpill__status">{STATUS_LABEL[run.status]}</span>
          <span className="runpill__prompt" title={run.prompt}>
            {run.prompt}
          </span>
          <span className="runpill__cost">${run.costUsd.toFixed(2)}</span>
          {run.plan && (
            <button className="btn btn--ghost" onClick={onOpenPlan}>
              Plan
            </button>
          )}
          {run.status === 'awaiting_approval' && (
            <button className="btn btn--go" onClick={() => void api.approve(run.id)}>
              Approve
            </button>
          )}
          {live && (
            <button className="btn btn--ghost btn--danger" onClick={() => void api.cancel(run.id)}>
              Cancel
            </button>
          )}
        </div>
      )}
    </header>
  );
}

export function TaskBoard() {
  const run = useCurrentRun();
  const highlight = useCity((s) => s.highlight);
  const team = useCity((s) => s.team);
  if (!run || run.tasks.length === 0) return null;
  const squadColor = (id: string) => team?.squads.find((s) => s.id === id)?.color ?? '#94a3b8';
  const merged = run.tasks.filter((t) => t.status === 'merged').length;

  return (
    <aside className="panel taskboard">
      <div className="panel__title">
        Task board <span className="muted">{merged}/{run.tasks.length} merged</span>
      </div>
      <ol className="tasks">
        {run.tasks.map((t) => (
          <li key={t.contract.id} className="task" onMouseEnter={() => highlight(t.contract.id)} onMouseLeave={() => highlight(undefined)} onClick={() => useCity.getState().selectTask(t.contract.id)} style={{ cursor: 'pointer' }}>
            <span className="task__squad" style={{ background: squadColor(t.contract.squad) }} />
            <div className="task__body">
              <div className="task__title">{t.contract.title}</div>
              <div className="task__meta">
                {t.contract.squad} · {t.contract.kind}
                {t.attempts > 1 ? ` · attempt ${t.attempts}` : ''}
              </div>
              {t.detail && ['escalated', 'failed'].includes(t.status) && <div className="task__detail">{t.detail}</div>}
            </div>
            <span className="status" style={{ ['--c' as string]: TASK_COLOR[t.status] }}>
              {TASK_LABEL[t.status]}
            </span>
          </li>
        ))}
      </ol>
      {run.summary && <div className="summary">{run.summary}</div>}
    </aside>
  );
}

function describe(e: OrchestrateEvent, title: (id: string) => string): string | undefined {
  switch (e.type) {
    case 'run.created':
      return `New request: ${e.prompt}`;
    case 'run.status':
      return `Run ${STATUS_LABEL[e.status].toLowerCase()}${e.detail ? ` — ${e.detail}` : ''}`;
    case 'plan.proposed':
      return e.problems.length ? `Plan rejected by validation (${e.problems.length} problems)` : `Plan proposed: ${e.plan.tasks.length} tasks`;
    case 'circle.convened':
      return 'Tech Circle convened';
    case 'circle.review':
      return `${title(e.roleId)}: ${e.review.verdict}`;
    case 'circle.adjourned':
      return e.approved ? 'Tech Circle approved the plan' : 'Tech Circle requested changes';
    case 'handoff':
      return `${title(e.from)} → ${title(e.to)}: ${e.reason}`;
    case 'escalation':
      return `Escalation ${title(e.from)} → ${title(e.to)}`;
    case 'gate.result':
      return e.ok ? undefined : `Gate ${e.gate} failed on ${e.taskId}`;
    case 'task.status':
      return e.status === 'merged' ? `✓ ${e.taskId} merged` : e.status === 'escalated' ? `${e.taskId} escalated` : undefined;
    case 'run.summary':
      return `Report ready · ${e.branch}`;
    default:
      return undefined;
  }
}

export function Ticker() {
  const events = useCity((s) => s.events);
  const team = useCity((s) => s.team);
  const title = (id: string) => team?.roles.find((r) => r.id === id)?.title ?? id;
  const lines = useMemo(() => {
    const out: { key: number; text: string }[] = [];
    for (let i = events.length - 1; i >= 0 && out.length < 6; i--) {
      const t = describe(events[i]!, title);
      if (t) out.push({ key: events[i]!.ts + i, text: t });
    }
    return out.reverse();
  }, [events, team]);
  return (
    <div className="ticker" aria-live="polite">
      {lines.map((l, i) => (
        <div key={l.key} className="ticker__line" style={{ opacity: 0.6 + (0.4 * (i + 1)) / lines.length }}>
          {l.text}
        </div>
      ))}
    </div>
  );
}

export function PromptBar() {
  const [text, setText] = useState('');
  const [autoApprove, setAutoApprove] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const run = useCurrentRun();
  const running = run && !['completed', 'failed', 'cancelled'].includes(run.status);

  const send = async () => {
    if (text.trim().length < 3) return;
    setBusy(true);
    setError(undefined);
    try {
      await api.submit(text.trim(), autoApprove);
      setText('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="prompt"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void send();
          }
        }}
        placeholder={running ? 'A run is in progress. You can queue another request…' : 'Tell the Head of Engineering what to build…'}
        rows={1}
      />
      <label className="prompt__toggle" title="Skip the plan approval gate">
        <input type="checkbox" checked={autoApprove} onChange={(e) => setAutoApprove(e.target.checked)} />
        auto-approve
      </label>
      <button className="btn btn--go" disabled={busy || text.trim().length < 3}>
        Send to Master
      </button>
      {error && <div className="prompt__error">{error}</div>}
    </form>
  );
}

export function AgentPanel() {
  const id = useCity((s) => s.selectedAgent);
  const team = useCity((s) => s.team);
  const agent = useCity((s) => (id ? s.agents[id] : undefined));
  const events = useCity((s) => s.events);
  const run = useCurrentRun();
  const select = useCity((s) => s.select);
  if (!id || !team) return null;

  const role = team.roles.find((r) => r.id === id);
  const squad = team.squads.find((s) => s.id === role?.squad);
  const boss = team.roles.find((r) => r.id === role?.reportsTo);
  const activity = agent?.activity ?? 'idle';
  const task = run?.tasks.find((t) => t.contract.id === agent?.taskId);
  const logs = events.filter((e) => e.type === 'agent.log' && e.agentId === id).slice(-40);
  const gates = task ? events.filter((e) => e.type === 'gate.result' && e.taskId === task.contract.id).slice(-8) : [];

  return (
    <aside className="panel agentpanel">
      <button className="panel__close" onClick={() => select(undefined)} aria-label="Close">
        ×
      </button>
      <div className="agent__head">
        <span className="agent__dot" style={{ background: ACTIVITY_COLOR[activity] }}>
          {role && <RoleIcon kind={role.kind} size={14} />}
        </span>
        <div>
          <div className="agent__title">{role?.title}</div>
          <div className="muted">
            {squad ? `${squad.name} squad` : 'Headquarters'} · {role?.kind}
            {boss ? ` · reports to ${boss.title}` : ''}
          </div>
        </div>
      </div>
      <div className="agent__status">
        <span className="status" style={{ ['--c' as string]: ACTIVITY_COLOR[activity] }}>
          {ACTIVITY_LABEL[activity]}
        </span>
        {agent?.summary && <span className="agent__summary">{agent.summary}</span>}
        {!!agent?.costUsd && <span className="muted">${agent.costUsd.toFixed(2)} spent</span>}
      </div>

      {task && (
        <section>
          <h4>Contract · {task.contract.id}</h4>
          <p className="contract__obj">{task.contract.objective}</p>
          <div className="kv">
            <span>Write scope</span>
            <code>{task.contract.writeScope.join('  ')}</code>
            {task.contract.testFiles.length > 0 && (
              <>
                <span>Tests</span>
                <code>{task.contract.testFiles.join('  ')}</code>
              </>
            )}
          </div>
          <ul className="criteria">
            {task.contract.acceptanceCriteria.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </section>
      )}

      {gates.length > 0 && (
        <section>
          <h4>Gates</h4>
          <div className="gates">
            {gates.map((g, i) =>
              g.type === 'gate.result' ? (
                <span key={i} className={`gate ${g.ok ? 'gate--ok' : 'gate--bad'}`} title={g.output}>
                  {g.gate}
                </span>
              ) : null,
            )}
          </div>
        </section>
      )}

      <section className="logsec">
        <h4>Live log</h4>
        <div className="log">
          {logs.length === 0 && <div className="muted">Nothing yet.</div>}
          {logs.map((e, i) =>
            e.type === 'agent.log' ? (
              <div key={i} className={`log__line log__line--${e.kind}`}>
                {e.text}
              </div>
            ) : null,
          )}
        </div>
      </section>
    </aside>
  );
}

export function PlanDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const run = useCurrentRun();
  const events = useCity((s) => s.events);
  const team = useCity((s) => s.team);
  if (!open || !run?.plan) return null;
  const reviews = events.filter((e) => e.type === 'circle.review' && e.runId === run.id);
  const title = (id: string) => team?.roles.find((r) => r.id === id)?.title ?? id;

  return (
    <div className="scrim" onClick={onClose}>
      <div className="drawer" role="dialog" aria-label="Plan" onClick={(e) => e.stopPropagation()}>
        <button className="panel__close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <h3>Plan</h3>
        <p className="muted">{run.plan.summary}</p>
        {run.detail && run.status === 'awaiting_approval' && <p className="warn">{run.detail}</p>}
        <div className="plan">
          {run.plan.tasks.map((t) => (
            <div key={t.id} className="plan__task">
              <div className="plan__head">
                <span className="plan__squad" style={{ background: team?.squads.find((s) => s.id === t.squad)?.color }} />
                <strong>{t.title}</strong>
                <span className="muted">
                  {t.squad} · {t.kind}
                  {t.dependsOn.length ? ` · after ${t.dependsOn.join(', ')}` : ''}
                </span>
              </div>
              <p>{t.objective}</p>
              <div className="kv">
                <span>Write</span>
                <code>{t.writeScope.join('  ')}</code>
                {t.testFiles.length > 0 && (
                  <>
                    <span>Tests</span>
                    <code>{t.testFiles.join('  ')}</code>
                  </>
                )}
                {t.nonGoals.length > 0 && (
                  <>
                    <span>Not</span>
                    <span>{t.nonGoals.join(' · ')}</span>
                  </>
                )}
              </div>
              <ul className="criteria">
                {t.acceptanceCriteria.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        {reviews.length > 0 && (
          <>
            <h4>Tech Circle</h4>
            <ul className="verdicts">
              {reviews.map((e, i) =>
                e.type === 'circle.review' ? (
                  <li key={i}>
                    <span className={`gate ${e.review.verdict === 'approve' ? 'gate--ok' : 'gate--bad'}`}>{e.review.verdict}</span> {title(e.roleId)}
                    {e.review.concerns.length > 0 && <span className="muted"> — {e.review.concerns.join('; ')}</span>}
                  </li>
                ) : null,
              )}
            </ul>
          </>
        )}
        {run.status === 'awaiting_approval' && (
          <div className="drawer__actions">
            <button className="btn btn--ghost btn--danger" onClick={() => void api.cancel(run.id).then(onClose)}>
              Reject
            </button>
            <button className="btn btn--go" onClick={() => void api.approve(run.id).then(onClose)}>
              Approve & start
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const ACTIVITY_COLOR_MERGED = '#7bc950';
const ROLE_KEY: [string, string][] = [
  ['master', 'Head of Eng'],
  ['architect', 'Architect'],
  ['qa_head', 'Head of QA'],
  ['lead', 'Lead'],
  ['dev', 'Dev'],
  ['qa', 'QA'],
  ['analyst', 'Research'],
];

export function Legend() {
  return (
    <div className="legend">
      {(['working', 'testing', 'reviewing', 'blocked'] as const).map((a) => (
        <span key={a}>
          <i style={{ background: ACTIVITY_COLOR[a] }} />
          {ACTIVITY_LABEL[a]}
        </span>
      ))}
      <span>
        <i style={{ background: ACTIVITY_COLOR_MERGED }} />
        Merged
      </span>
      <div className="legend__roles">
        {ROLE_KEY.map(([kind, label]) => (
          <span key={kind}>
            <RoleIcon kind={kind} size={13} />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Opens when a tree is clicked: the task behind it, who worked on it, and how it went. */
export function TaskPanel() {
  const id = useCity((s) => s.selectedTask);
  const run = useCurrentRun();
  const team = useCity((s) => s.team);
  const events = useCity((s) => s.events);
  const selectTask = useCity((s) => s.selectTask);
  const task = run?.tasks.find((t) => t.contract.id === id);
  if (!id || !task || !team) return null;

  const c = task.contract;
  const squad = team.squads.find((s) => s.id === c.squad);
  const people = team.roles.filter((r) => r.squad === c.squad);
  const gates = events.filter((e) => e.type === 'gate.result' && e.taskId === c.id).slice(-10);
  const review = [...events].reverse().find((e) => e.type === 'code.review' && e.taskId === c.id);

  return (
    <aside className="panel agentpanel taskpanel">
      <button className="panel__close" onClick={() => selectTask(undefined)} aria-label="Close">
        ×
      </button>
      <div className="agent__head">
        <span className="agent__dot" style={{ background: TASK_COLOR[task.status] }}>
          <RoleIcon kind={c.kind === 'research' ? 'analyst' : 'dev'} size={14} />
        </span>
        <div>
          <div className="agent__title">{c.title}</div>
          <div className="muted">
            {squad?.name ?? c.squad} · {c.kind} · {c.id}
          </div>
        </div>
      </div>
      <div className="agent__status">
        <span className="status" style={{ ['--c' as string]: TASK_COLOR[task.status] }}>
          {TASK_LABEL[task.status]}
        </span>
        {task.attempts > 1 && <span className="muted">{task.attempts} attempts</span>}
        {task.detail && <span className="agent__summary">{task.detail}</span>}
      </div>

      <section>
        <h4>Objective</h4>
        <p className="contract__obj">{c.objective}</p>
        <ul className="criteria">
          {c.acceptanceCriteria.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      </section>

      <section>
        <h4>Scope</h4>
        <div className="kv">
          <span>Write</span>
          <code>{c.writeScope.join('  ')}</code>
          {c.testFiles.length > 0 && (
            <>
              <span>Tests</span>
              <code>{c.testFiles.join('  ')}</code>
            </>
          )}
          {c.dependsOn.length > 0 && (
            <>
              <span>After</span>
              <span>{c.dependsOn.join(', ')}</span>
            </>
          )}
        </div>
      </section>

      <section>
        <h4>Team</h4>
        <div className="people">
          {people.map((r) => (
            <span key={r.id}>
              <RoleIcon kind={r.kind} size={12} /> {r.title}
            </span>
          ))}
        </div>
      </section>

      {gates.length > 0 && (
        <section>
          <h4>Gates</h4>
          <div className="gates">
            {gates.map((g, i) =>
              g.type === 'gate.result' ? (
                <span key={i} className={`gate ${g.ok ? 'gate--ok' : 'gate--bad'}`} title={g.output}>
                  {g.gate}
                </span>
              ) : null,
            )}
          </div>
        </section>
      )}
      {review?.type === 'code.review' && (
        <section>
          <h4>Lead review</h4>
          <p className="contract__obj">
            <span className={`gate ${review.review.verdict === 'approve' ? 'gate--ok' : 'gate--bad'}`}>{review.review.verdict}</span> {review.review.notes}
          </p>
        </section>
      )}
    </aside>
  );
}

/** City-builder camera controls: presets plus a reminder of the keys. */
export function CameraBar() {
  const camera = useCity((s) => s.camera);
  return (
    <div className="camerabar" role="toolbar" aria-label="Camera">
      <button className="btn btn--ghost" onClick={() => camera({ kind: 'overview' })} title="Top-down overview">
        Overview
      </button>
      <button className="btn btn--ghost" onClick={() => camera({ kind: 'angled' })} title="Angled city view">
        Angled
      </button>
      <span className="camerabar__keys">
        <kbd>WASD</kbd> pan · <kbd>Q</kbd>/<kbd>E</kbd> rotate · <kbd>R</kbd>/<kbd>F</kbd> zoom · double-click a tower
      </span>
    </div>
  );
}
