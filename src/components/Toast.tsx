import React from 'react';

const ToastContext = React.createContext<(msg: string, type?: 'default' | 'error' | 'success') => void>(() => {});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = React.useState<{ msg: string; type: 'default' | 'error' | 'success' } | null>(null);
  const timer = React.useRef<number | undefined>(undefined);

  const show = React.useCallback((msg: string, type: 'default' | 'error' | 'success' = 'default') => {
    setToast({ msg, type });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(null), 3200);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast && <div className={`toast ${toast.type}`}>{toast.msg}</div>}
    </ToastContext.Provider>
  );
}

export function useToast() {
  return React.useContext(ToastContext);
}
