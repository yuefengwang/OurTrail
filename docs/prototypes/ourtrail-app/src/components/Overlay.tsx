import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useOverlayHistory } from '../app/navigation';
import { Icon } from './Icon';

export interface OverlayProps {
  kind: 'sheet' | 'dialog';
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}

export function Overlay({ kind, open, title, onClose, children }: OverlayProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !open) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, [open]);

  useOverlayHistory(open, onClose);
  return (
    <dialog ref={dialogRef} className={`overlay overlay--${kind}`} aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); onClose(); }}>
      {kind === 'sheet' && <div className="overlay__handle" aria-hidden="true" />}
      <header className="overlay__header">
        <h2 id={titleId}>{title}</h2>
        <button type="button" className="icon-button" aria-label={`关闭${title}`} onClick={onClose}><Icon name="close" /></button>
      </header>
      <div className="overlay__body stack">{children}</div>
    </dialog>
  );
}
