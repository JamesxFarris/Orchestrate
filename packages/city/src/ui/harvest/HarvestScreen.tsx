import { GROWTH } from '@orchestrate/shared';
import { useRef } from 'react';
import { useCity } from '../../store.ts';
import { useDialog } from '../useDialog.ts';
import { harvestOf } from './harvest.ts';

/** The payoff after a project ships: what each task earned, which districts grew, and streaks. */
export function HarvestScreen() {
  const harvest = useCity((s) => s.harvest);
  const progress = useCity((s) => s.progress);
  const team = useCity((s) => s.team);
  const run = useCity((s) => (s.harvest ? s.runs[s.harvest.runId] : undefined));
  const closeBtn = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const close = () => useCity.getState().openHarvest(undefined);
  const tally = harvest && progress ? harvestOf(progress, harvest.runId) : undefined;
  useDialog(dialog, !!(harvest && tally && team), close, closeBtn);

  if (!harvest || !tally || !team) return null;

  const squad = (id: string) => team.squads.find((s) => s.id === id);
  const title = (taskId: string) => run?.tasks.find((t) => t.contract.id === taskId)?.contract.title ?? taskId;
  const bonus = (earned: boolean, points: number) => (earned ? <td className="harvest__plus">+{points}</td> : <td className="harvest__none">—</td>);

  return (
    <div className="harvest-scrim" onClick={close}>
      <div ref={dialog} className="harvest" role="dialog" aria-modal="true" aria-labelledby="harvest-title" onClick={(e) => e.stopPropagation()}>
        <span className="harvest__eyebrow">Harvest is in</span>
        <h2 id="harvest-title" className="harvest__title">
          {run?.prompt ?? 'Project shipped'}
        </h2>
        <p className="harvest__sub">
          Merged into your main branch · {tally.tasks.length} {tally.tasks.length === 1 ? 'task' : 'tasks'}
        </p>

        <div className="harvest__table-wrap">
          <table className="harvest__table">
            <thead>
              <tr>
                <th scope="col">Task</th>
                <th scope="col">base</th>
                <th scope="col">first try</th>
                <th scope="col">no fuss</th>
                <th scope="col">thrifty</th>
                <th scope="col">growth</th>
              </tr>
            </thead>
            <tbody>
              {tally.tasks.map((t) => (
                <tr key={t.taskId} style={{ ['--squad' as string]: squad(t.squad)?.color }}>
                  <th scope="row">
                    <span className="harvest__swatch" />
                    {title(t.taskId)}
                  </th>
                  <td>{GROWTH.base}</td>
                  {bonus(t.firstTry, GROWTH.firstTry)}
                  {bonus(t.noFuss, GROWTH.noFuss)}
                  {bonus(t.thrifty, GROWTH.thrifty)}
                  <td className="harvest__growth">{t.growth}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="harvest__total">
          <span>Harvested</span>
          <b>{tally.total} growth</b>
        </div>

        {harvest.levelUps.length > 0 && (
          <div className="harvest__levels">
            {harvest.levelUps.map((l) => (
              <div key={l.squad} className="harvest__level" style={{ ['--squad' as string]: squad(l.squad)?.color }}>
                <span className="harvest__level-squad">{squad(l.squad)?.name ?? l.squad}</span>
                <b>Grew into a {l.to.name}</b>
                <span className="harvest__level-was">It was a {l.from.name}.</span>
              </div>
            ))}
          </div>
        )}

        <p className="harvest__streaks">
          Good harvests in a row:{' '}
          {tally.streaks.map((s, i) => (
            <span key={s.squad}>
              {i > 0 && ' · '}
              {squad(s.squad)?.name ?? s.squad} {s.streak > 0 ? <b>{s.streak}</b> : 'starts fresh'}
            </span>
          ))}
        </p>

        <button ref={closeBtn} type="button" className="btn-ship harvest__close" onClick={close}>
          Back to the city
        </button>
      </div>
    </div>
  );
}
