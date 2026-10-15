// Modal built on the native <dialog> element. showModal() gives a
// focus trap, Escape-to-close and an inert background with no library.
//
// Focus handling is explicit rather than left to the browser:
//  - on open: focus the element marked `data-autofocus` (React's autoFocus
//    runs before the dialog is shown, so it would be lost);
//  - on close: return focus to whatever was focused when the modal opened —
//    normally the button that opened it. If that element no longer exists
//    (e.g. the task was deleted, or moved to another day), focus
//    `returnFocusFallback` instead so keyboard users aren't dropped at the
//    top of the page.
import { useEffect, useRef } from 'react';

export default function Modal({
  open,
  onClose,
  labelledBy,
  describedBy,
  size = 'md',
  returnFocusFallback,
  children,
}) {
  const ref = useRef(null);
  const returnTo = useRef(null);
  const pressStartedOnBackdrop = useRef(false);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      returnTo.current = document.activeElement;
      dialog.showModal();
      dialog.querySelector('[data-autofocus]')?.focus();
    }

    if (!open && dialog.open) {
      dialog.close();
      const target = returnTo.current;
      returnTo.current = null;
      const canReturn = target && target.isConnected && !target.disabled && typeof target.focus === 'function';
      if (canReturn) target.focus();
      else returnFocusFallback?.current?.focus();
    }
  }, [open, returnFocusFallback]);

  // Close on a click on the backdrop — but only if the press also started
  // there, so selecting text in a field and releasing outside doesn't close it.
  const onMouseDown = (e) => {
    pressStartedOnBackdrop.current = e.target === ref.current;
  };
  const onClick = (e) => {
    if (pressStartedOnBackdrop.current && e.target === ref.current) onClose();
    pressStartedOnBackdrop.current = false;
  };

  return (
    <dialog
      ref={ref}
      className={`modal modal-${size}`}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      onCancel={(e) => {
        e.preventDefault(); // Escape: let React state drive closing
        onClose();
      }}
      onMouseDown={onMouseDown}
      onClick={onClick}
    >
      {/* Children mount only while open, so forms start fresh every time. */}
      {open && <div className="modal-panel">{children}</div>}
    </dialog>
  );
}
