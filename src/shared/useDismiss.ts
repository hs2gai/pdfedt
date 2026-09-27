import { useEffect, type RefObject } from 'react';

/**
 * Closes an open menu / panel on an outside tap / click and on Esc.
 * onMouseLeave alone gives touch devices no way to close (the mouse never "leaves"),
 * so this is added on top of the toggle and the onClick of each option.
 * Attach ref to the element that includes the toggle button (e.g. .menu) so a toggle press does not close → open twice.
 */
export function useDismiss(ref: RefObject<HTMLElement | null>, open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [ref, open, onClose]);
}
