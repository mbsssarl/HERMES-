import React from 'react';

type ToastType = 'default' | 'error' | 'success' | 'info';

interface ToastOptions {
  /** Bouton d'action dans la notification (ex. « Ouvrir »). */
  action?: { label: string; onClick: () => void };
  /** Durée d'affichage en ms (défaut 3200). */
  duration?: number;
}

type ShowToast = (msg: string, type?: ToastType, options?: ToastOptions) => void;

const ToastContext = React.createContext<ShowToast>(() => {});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = React.useState<{ msg: string; type: ToastType; action?: ToastOptions['action'] } | null>(null);
  const timer = React.useRef<number | undefined>(undefined);

  const show = React.useCallback<ShowToast>((msg, type = 'default', options) => {
    setToast({ msg, type, action: options?.action });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(null), options?.duration ?? (options?.action ? 9000 : 3200));
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast && (
        <div className={`toast ${toast.type}`} role="status">
          <span>{toast.msg}</span>
          {toast.action && (
            <button
              className="toast-action"
              onClick={() => { toast.action?.onClick(); setToast(null); }}
            >
              {toast.action.label}
            </button>
          )}
          <button className="toast-close" onClick={() => setToast(null)} aria-label="Fermer">✕</button>
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  return React.useContext(ToastContext);
}
