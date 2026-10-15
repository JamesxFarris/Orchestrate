import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Keyboard behaviour for a modal dialog while `open`: focus moves into it (to `initial`, or its
 * first control), Tab and Shift+Tab stay inside it, Escape closes it, and focus goes back to
 * whatever had it before. The element also needs role="dialog" and aria-modal="true".
 */
export function useDialog(ref: RefObject<HTMLElement | null>, open: boolean, onClose: () => void, initial?: RefObject<HTMLElement | null>): void {
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const el = ref.current;
    if (!open || !el) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const controls = () => [...el.querySelectorAll<HTMLElement>(FOCUSABLE)];
    (initial?.current ?? controls()[0] ?? el).focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const all = controls();
      if (all.length === 0) return e.preventDefault();
      const first = all[0]!;
      const last = all[all.length - 1]!;
      const inside = el.contains(document.activeElement);
      if (e.shiftKey && (document.activeElement === first || !inside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !inside)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (previous?.isConnected) previous.focus();
    };
  }, [ref, open, initial]);
}

/** True while a modal dialog is open, so global shortcuts (the camera's WASD) stand down. */
export const dialogOpen = () => !!document.querySelector('[aria-modal="true"]');
