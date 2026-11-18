import { useEffect } from 'react';

import type { Notice } from '../types';

interface ToastProps {
  notice: Notice | null;
  onDismiss: () => void;
}

export function Toast({ notice, onDismiss }: ToastProps) {
  useEffect(() => {
    if (notice === null) {
      return;
    }

    const timer = window.setTimeout(onDismiss, 6_000);

    return () => {
      window.clearTimeout(timer);
    };
  }, [notice, onDismiss]);

  if (notice === null) {
    return null;
  }

  return (
    <div className="toast" role="status" aria-live="polite" data-tone={notice.tone}>
      <span className="toast__mark" aria-hidden="true" />
      <p>{notice.message}</p>
      <button
        type="button"
        className="toast__close"
        onClick={onDismiss}
        aria-label="Dismiss notification"
      >
        ×
      </button>
    </div>
  );
}
