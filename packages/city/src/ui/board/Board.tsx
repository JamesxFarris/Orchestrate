import type { RunState } from '@orchestrate/shared';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api.ts';
import { useCity, useCurrentRun } from '../../store.ts';
import { CollapsiblePanel } from '../CollapsiblePanel.tsx';
import { RoleIcon } from '../roleIcons.tsx';
import { buildBoard, type BoardTile, type ShipStatus, type Stage } from './buildBoard.ts';

const STAGE_WORD: Record<Stage, string> = {
  queued: 'queued',
  seed: 'seed',
  sprout: 'sprout',
  bud: 'bud',
  bloom: 'bloom',
  wilt: 'wilting',
  skipped: 'skipped',
};

const GATE_WORD: Record<string, string> = { red: 'tests fail first', typecheck: 'typecheck', lint: 'lint', test: 'tests', audit: 'scope audit', full: 'full suite', setup: 'setup' };

/** Seed → sprout → bud → bloom: how far a task has grown. Stroke icons on a 16px grid. */
function StageIcon({ stage, size = 14 }: { stage: Stage; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;
  switch (stage) {
    case 'seed':
    case 'queued':
      return (
        <svg {...common}>
          <path d="M8 3c2.5 2 3.5 4.5 3.5 6.5a3.5 3.5 0 0 1-7 0C4.5 7.5 5.5 5 8 3z" />
        </svg>
      );
    case 'sprout':
      return (
        <svg {...common}>
          <path d="M8 14V7M8 9C8 6 6 4.5 3 4.5c0 3 2 4.5 5 4.5zM8 7.5c0-2.5 1.8-4 4.5-4 0 2.6-1.8 4-4.5 4z" />
        </svg>
      );
    case 'bud':
      return (
        <svg {...common}>
          <path d="M8 14V8.5M8 2.5c2.2 1.6 3 3.4 3 4.6a3 3 0 0 1-6 0c0-1.2.8-3 3-4.6z" />
        </svg>
      );
    case 'bloom':
      return (
        <svg {...common} strokeWidth={1.4}>
          <circle cx="8" cy="3.8" r="1.7" />
          <circle cx="10.9" cy="5.9" r="1.7" />
          <circle cx="9.8" cy="9.1" r="1.7" />
          <circle cx="6.2" cy="9.1" r="1.7" />
          <circle cx="5.1" cy="5.9" r="1.7" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <path d="M8 14V8c0-1.5-.8-3-3-4M8 8c.5-2 2-3 4.5-3-.3 2.4-1.8 3.6-4.5 3.6" />
        </svg>
      );
  }
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

const fmtElapsed = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function Tile({ tile, now }: { tile: BoardTile; now: number }) {
  const highlight = useCity((s) => s.highlight);
  const selectTask = useCity((s) => s.selectTask);
  const open = () => selectTask(tile.taskId);
  const events = { onMouseEnter: () => highlight(tile.taskId), onMouseLeave: () => highlight(undefined), onFocus: () => highlight(tile.taskId), onBlur: () => highlight(undefined) };
  const style = { ['--squad' as string]: tile.squad.color };

  if (tile.tone === 'done') {
    return (
      <li className={`tile tile--done phase--${tile.phase}`} style={style}>
        <button type="button" className="tile__hit" onClick={open} {...events}>
          <span className="tile__stage-dot">
            <StageIcon stage={tile.stage} />
          </span>
          <span className="tile__done-text">
            <span className="tile__done-title">{tile.title}</span>
            <span className="tile__done-meta">
              {tile.squad.name} · {tile.status === 'merged' ? (tile.attempts <= 1 ? 'merged first try' : `merged on try ${tile.attempts}`) : tile.statusLabel}
            </span>
          </span>
          {tile.growth !== undefined && <span className="tile__growth">+{tile.growth} growth</span>}
        </button>
      </li>
    );
  }

  const extraScope = tile.scope.length - 1;
  return (
    <li className={`tile tile--${tile.tone} phase--${tile.phase}`} style={style}>
      <button type="button" className="tile__hit" onClick={open} {...events}>
        <span className="tile__row">
          <span className="tile__squad">{tile.squad.name}</span>
          {tile.district && (
            <>
              <span className="tile__town">{tile.district.name}</span>
              <span className="tile__growbar" title={`${Math.round(tile.district.fraction * 100)}% of the way to the next size`}>
                <span style={{ width: `${Math.round(tile.district.fraction * 100)}%` }} />
              </span>
            </>
          )}
          <span className="tile__status">{tile.statusLabel}</span>
        </span>
        <span className="tile__row">
          <span className="tile__title">{tile.title}</span>
          <span className="tile__stage">
            <StageIcon stage={tile.stage} size={13} />
            {STAGE_WORD[tile.stage]}
            {tile.attempts > 1 ? ` · try ${tile.attempts}` : ''}
          </span>
        </span>

        {tile.agent && (
          <span className="tile__agent">
            <span className="tile__avatar">
              <RoleIcon kind={tile.agent.kind} size={14} />
            </span>
            <span className="tile__agent-body">
              <span className="tile__who">
                <b>{tile.agent.title}</b> · {fmtElapsed(now - tile.agent.since)}
                {tile.agent.costUsd > 0 ? ` · $${tile.agent.costUsd.toFixed(2)}` : ''}
              </span>
              {tile.progress && !tile.blocker && <span className="tile__progress">“{tile.progress}”</span>}
              {tile.lastAction && <span className="tile__action">{tile.lastAction}</span>}
            </span>
          </span>
        )}

        {tile.blocker && <span className="tile__callout">{tile.blocker}</span>}
        {tile.detail && <span className="tile__callout">{tile.detail}</span>}

        {(tile.gates.length > 0 || tile.scope.length > 0) && (
          <span className="tile__chips">
            {tile.gates.map((g) => (
              <span key={g.gate} className={`chip ${g.ok ? 'chip--ok' : 'chip--bad'}`}>
                {GATE_WORD[g.gate] ?? g.gate} {g.ok ? 'passed' : 'failed'}
              </span>
            ))}
            {tile.scope[0] && (
              <span className="chip chip--code" title={tile.scope.join('\n')}>
                {tile.scope[0]}
                {extraScope > 0 ? ` +${extraScope}` : ''}
              </span>
            )}
          </span>
        )}
      </button>
    </li>
  );
}

/**
 * The bottom of the board: growth so far while running, Ship it once complete, harvested after.
 * Shipping asks once before merging; a refusal shows git's reason and output, and nothing changes.
 */
function ShipBar({ run, ship }: { run: RunState; ship: ShipStatus }) {
  const [step, setStep] = useState<'idle' | 'confirm' | 'mark' | 'busy'>('idle');
  const [error, setError] = useState<{ message: string; output?: string }>();

  if (ship.state === 'none') return null;
  if (ship.state === 'shipped') {
    return (
      <div className="shipbar shipbar--done">
        <span className="tile__stage-dot">
          <StageIcon stage="bloom" />
        </span>
        <span>
          Harvested <b>{ship.growth} growth</b>. This project is in your main branch.
        </span>
      </div>
    );
  }
  if (ship.state === 'growing') {
    return (
      <div className="shipbar">
        <StageIcon stage="sprout" size={16} />
        <span>
          <b>{ship.growth} growth</b> so far, harvested when you ship.
        </span>
      </div>
    );
  }

  // A run is "completed" when at least one task merged; the rest may have failed or been skipped.
  const unfinished = run.tasks.filter((t) => t.status !== 'merged');
  const partial = unfinished.length > 0;

  const act = async (what: 'ship' | 'mark') => {
    setStep('busy');
    setError(undefined);
    try {
      const res = what === 'ship' ? await api.ship(run.id, partial) : await api.markShipped(run.id).then(() => ({ ok: true as const }));
      // On success the run.shipped event refreshes progress, which flips this bar to "harvested".
      if (!res.ok) {
        setError(res);
        setStep('idle');
      }
    } catch (e) {
      setError({ message: (e as Error).message });
      setStep('idle');
    }
  };

  return (
    <div className="shipbar shipbar--ready">
      <span>
        Ready to ship: <b>{ship.growth} growth</b> waiting to be harvested.
        {partial && ` ${run.tasks.length - unfinished.length} of ${run.tasks.length} tasks finished.`}
      </span>
      {step === 'confirm' && (
        <span className="shipbar__explain">
          This merges <code>{run.integrationBranch}</code> into your main branch as a merge commit, with your name on it. If main changed since the project started, the full test suite runs first. If anything is wrong, nothing changes.
          {partial && (
            <>
              {' '}
              <b>Only the finished work ships.</b> Left out: {unfinished.map((t) => t.contract.title).join('; ')}.
            </>
          )}
        </span>
      )}
      {step === 'mark' && <span className="shipbar__explain">Only if this work is already in your main branch, for example from a squash merge. This records it as shipped without merging anything.</span>}
      {step === 'busy' ? (
        <span className="shipbar__busy" role="status">
          Shipping: merging and checking…
        </span>
      ) : (
        <span className="shipbar__actions">
          {step === 'idle' && (
            <>
              <button type="button" className="btn-ship" onClick={() => setStep('confirm')}>
                Ship it…
              </button>
              <button type="button" className="btn-quiet" onClick={() => setStep('mark')}>
                Merged it another way?
              </button>
            </>
          )}
          {step === 'confirm' && (
            <>
              <button type="button" className="btn-ship" onClick={() => void act('ship')}>
                {partial ? 'Ship the finished tasks' : 'Ship it'}
              </button>
              <button type="button" className="btn-quiet" onClick={() => setStep('idle')}>
                Not yet
              </button>
            </>
          )}
          {step === 'mark' && (
            <>
              <button type="button" className="btn-ship" onClick={() => void act('mark')}>
                Mark as shipped
              </button>
              <button type="button" className="btn-quiet" onClick={() => setStep('idle')}>
                Cancel
              </button>
            </>
          )}
        </span>
      )}
      {error && (
        <span className="shipbar__error" role="alert">
          {error.message}
          {error.output && (
            <details>
              <summary>Details from git</summary>
              <pre>{error.output}</pre>
            </details>
          )}
        </span>
      )}
    </div>
  );
}

/** The run as one tile per task: who is on it, what they are doing, and what is stuck. */
export function TaskBoard() {
  const run = useCurrentRun();
  const team = useCity((s) => s.team);
  const agents = useCity((s) => s.agents);
  const events = useCity((s) => s.events);
  const progress = useCity((s) => s.progress);
  const model = useMemo(() => (run && team ? buildBoard(run, agents, events, team, progress) : undefined), [run, agents, events, team, progress]);
  const now = useNow(!!model?.tiles.some((t) => t.agent));
  if (!run || !model || model.tiles.length === 0) return null;
  const { counts } = model;

  return (
    <CollapsiblePanel
      id="taskboard"
      title="Project"
      summary={
        <span className="board__counts">
          {counts.working > 0 && <span>{counts.working} working</span>}
          {counts.waiting > 0 && <span className="board__counts-waiting">{counts.waiting} stuck</span>}
          <span>
            {counts.done}/{counts.total} done
          </span>
        </span>
      }
      className="panel taskboard board"
    >
      <div className="board__head">
        <span className="board__title">{run.prompt}</span>
        <span className="board__meta">${run.costUsd.toFixed(2)} spent</span>
      </div>
      <ol className="board__tiles">
        {model.tiles.map((t) => (
          <Tile key={`${run.id}:${t.taskId}`} tile={t} now={now} />
        ))}
      </ol>
      <ShipBar key={run.id} run={run} ship={model.ship} />
      {run.summary && <div className="board__summary">{run.summary}</div>}
    </CollapsiblePanel>
  );
}
