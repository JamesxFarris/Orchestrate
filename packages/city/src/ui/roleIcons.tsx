import type { AgentActivity } from '@orchestrate/shared';

/** Simple stroke icons (24px grid) so each role reads at a glance. */
const PATHS: Record<string, string> = {
  master: 'M3 19h18M4 8l4 4 4-7 4 7 4-4-2 11H6z', // crown
  architect: 'M12 3v3M12 6l-6 15M12 6l6 15M8.5 15h7', // compass
  qa_head: 'M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6zM9 12l2 2 4-4', // shield + check
  lead: 'M5 21V4M5 4h11l-2 4 2 4H5', // flag
  dev: 'M8 8l-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14', // </>
  qa: 'M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3M7.5 14h9', // flask
  analyst: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 19V5', // book
  product: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z', // target
  design: 'M4 20l4-1 11-11-3-3L5 16zM14 6l3 3', // pen
};

export function RoleIcon({ kind, size = 14 }: { kind: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={PATHS[kind] ?? 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z'} />
    </svg>
  );
}

/** What this person is doing, in plain words, from their role and activity. */
export function activityVerb(kind: string, activity: AgentActivity): string {
  if (activity === 'idle') return 'Idle';
  if (activity === 'blocked') return 'Blocked — escalating';
  switch (kind) {
    case 'master':
      return activity === 'reviewing' ? 'Reviewing' : 'Planning';
    case 'architect':
    case 'qa_head':
      return 'Reviewing plan';
    case 'lead':
      return activity === 'reviewing' ? 'Code review' : 'Leading';
    case 'qa':
      return 'Writing tests';
    case 'analyst':
      return activity === 'testing' ? 'Checking design' : 'Designing';
    case 'dev':
      return activity === 'testing' ? 'Running gates' : 'Coding';
    default:
      return activity === 'reviewing' ? 'Reviewing' : activity === 'testing' ? 'Testing' : 'Working';
  }
}
