import { describe, expect, it } from 'vitest';
import { readCollapsed, writeCollapsed } from '../src/ui/CollapsiblePanel.tsx';

const memory = () => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
};

const broken = {
  getItem: (): string | null => {
    throw new Error('SecurityError');
  },
  setItem: (): void => {
    throw new Error('QuotaExceededError');
  },
};

describe('CollapsiblePanel persistence', () => {
  it('defaults to expanded when nothing is stored', () => {
    expect(readCollapsed('taskboard', memory())).toBe(false);
  });

  it('round-trips per panel under orch.panel.<id>', () => {
    const s = memory();
    writeCollapsed('taskboard', true, s);
    expect(s.data.get('orch.panel.taskboard')).toBe('1');
    expect(readCollapsed('taskboard', s)).toBe(true);
    expect(readCollapsed('legend', s)).toBe(false);
    writeCollapsed('taskboard', false, s);
    expect(readCollapsed('taskboard', s)).toBe(false);
  });

  it('falls back to expanded and never throws when storage is unavailable', () => {
    expect(readCollapsed('taskboard', broken)).toBe(false);
    expect(() => writeCollapsed('taskboard', true, broken)).not.toThrow();
  });
});
