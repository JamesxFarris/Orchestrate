import { useId, useState, type ReactNode } from 'react';

const storageKey = (id: string) => `orch.panel.${id}`;

type Reader = Pick<Storage, 'getItem'>;
type Writer = Pick<Storage, 'setItem'>;

/** Remembered fold state. Storage can be missing or throw (private mode, blocked site data), so default to expanded. */
export function readCollapsed(id: string, storage?: Reader): boolean {
  try {
    return (storage ?? globalThis.localStorage).getItem(storageKey(id)) === '1';
  } catch {
    return false;
  }
}

export function writeCollapsed(id: string, collapsed: boolean, storage?: Writer): void {
  try {
    (storage ?? globalThis.localStorage).setItem(storageKey(id), collapsed ? '1' : '0');
  } catch {
    // Not remembering is fine; the panel still toggles.
  }
}

interface Props {
  /** Stable key: persists state as `orch.panel.<id>`. */
  id: string;
  title: ReactNode;
  /** Stays visible in the header while folded. */
  summary?: ReactNode;
  /** Classes for the outer <aside>, e.g. positioning like `panel taskboard`. */
  className?: string;
  children: ReactNode;
}

/** HUD panel whose header button folds it down to a single title bar. */
export function CollapsiblePanel({ id, title, summary, className, children }: Props) {
  const [collapsed, setCollapsed] = useState(() => readCollapsed(id));
  const bodyId = useId();
  const titleId = `${bodyId}-title`;

  const toggle = () => {
    setCollapsed(!collapsed);
    writeCollapsed(id, !collapsed);
  };

  return (
    <aside className={`collapsible${collapsed ? ' collapsible--collapsed' : ''}${className ? ` ${className}` : ''}`} aria-labelledby={titleId}>
      <button type="button" className="collapsible__head" aria-expanded={!collapsed} aria-controls={bodyId} onClick={toggle}>
        <span className="collapsible__chevron" aria-hidden>
          {collapsed ? '▸' : '▾'}
        </span>
        <span className="collapsible__title" id={titleId}>
          {title}
        </span>
        {summary != null && <span className="collapsible__summary">{summary}</span>}
      </button>
      <div className="collapsible__body" id={bodyId}>
        <div className="collapsible__fold">
          <div className="collapsible__inner">{children}</div>
        </div>
      </div>
    </aside>
  );
}
