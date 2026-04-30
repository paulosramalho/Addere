// ============================================
// src/components/Toast.jsx
// ============================================
import React, { createContext, useContext, useState, useCallback, useRef } from 'react';

const ToastContext = createContext();

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const resolversRef = useRef({});

  // duração da animação de saída (ms) — deve bater com o slideOut abaixo
  const EXIT_MS = 220;

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(toast => toast.id !== id));
    delete resolversRef.current[id];
  }, []);

  // marca como "saindo" (para animar) e remove do estado só depois
  const closeToast = useCallback((id) => {
    setToasts(prev => prev.map(t => (t.id === id ? { ...t, leaving: true } : t)));
    setTimeout(() => removeToast(id), EXIT_MS);
  }, [removeToast]);

  const addToast = useCallback((message, type = 'info', duration = 3000) => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, message, type, leaving: false }]);

    if (duration > 0) {
      setTimeout(() => {
        closeToast(id);
      }, duration);
    }
  }, [closeToast]);

  const confirmToast = useCallback((message) => {
    return new Promise((resolve) => {
      const id = Date.now() + Math.random();
      resolversRef.current[id] = resolve;
      setToasts(prev => [...prev, { id, message, type: 'confirm', leaving: false }]);
    });
  }, []);

  const handleConfirm = useCallback((id, result) => {
    const resolve = resolversRef.current[id];
    if (resolve) resolve(result);
    closeToast(id);
  }, [closeToast]);

  return (
    <ToastContext.Provider value={{ addToast, removeToast: closeToast, confirmToast }}>
      {children}
      <ToastContainer toasts={toasts} removeToast={closeToast} onConfirm={handleConfirm} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast deve ser usado dentro de ToastProvider');
  }
  return context;
}

function ToastContainer({ toasts, removeToast, onConfirm }) {
  return (
    <div className="fixed top-4 right-4 z-50 space-y-2 pointer-events-none">
      {toasts.map(toast => (
        toast.type === 'confirm' ? (
          <ConfirmToast
            key={toast.id}
            {...toast}
            onConfirm={() => onConfirm(toast.id, true)}
            onCancel={() => onConfirm(toast.id, false)}
          />
        ) : (
          <Toast key={toast.id} {...toast} onClose={() => removeToast(toast.id)} />
        )
      ))}
    </div>
  );
}

function ConfirmToast({ message, leaving, onConfirm, onCancel }) {
  return (
    <div className={`pointer-events-auto flex flex-col gap-3 min-w-[320px] max-w-md px-4 py-4 rounded-xl border shadow-xl backdrop-blur-md bg-amber-500/15 border-amber-400/40 text-amber-900 ${leaving ? 'animate-[slideOut_0.22s_ease-in_forwards]' : 'animate-[slideIn_0.3s_ease-out]'}`}>
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 mt-0.5">
          <svg className="w-5 h-5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <div className="flex-1 text-sm font-medium">{message}</div>
      </div>
      <div className="flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-amber-300 bg-white text-amber-800 hover:bg-amber-100 transition"
        >
          Cancelar
        </button>
        <button
          onClick={onConfirm}
          className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700 transition"
        >
          Confirmar
        </button>
      </div>

      <style>{`
        @keyframes slideIn {
          from { opacity: 0; transform: translateX(100%); }
          to { opacity: 1; transform: translateX(0); }
        }

        @keyframes slideOut {
          from { opacity: 1; transform: translateX(0); }
          to { opacity: 0; transform: translateX(12px); }
        }
      `}</style>
    </div>
  );
}

function Toast({ id, message, type, leaving, onClose }) {
  const icons = {
    success: (
      <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    error: (
      <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    warning: (
      <svg className="w-5 h-5 text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
    ),
    info: (
      <svg className="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  };

  const styles = {
    success: 'bg-green-500/15 border-green-400/40 text-green-900',
    error:   'bg-red-500/15 border-red-400/40 text-red-900',
    warning: 'bg-yellow-500/15 border-yellow-400/40 text-yellow-900',
    info:    'bg-blue-500/15 border-blue-400/40 text-blue-900',
  };

  return (
    <div
      className={`pointer-events-auto flex items-center gap-3 min-w-[320px] max-w-md px-4 py-3 rounded-xl border shadow-xl backdrop-blur-md ${styles[type]} ${leaving ? 'animate-[slideOut_0.22s_ease-in_forwards]' : 'animate-[slideIn_0.3s_ease-out]'}`}
    >
      <div className="flex-shrink-0">
        {icons[type]}
      </div>
      <div className="flex-1 text-sm font-medium">
        {message}
      </div>
      <button
        onClick={onClose}
        className="flex-shrink-0 text-current opacity-50 hover:opacity-100 transition-opacity"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      <style>{`
        @keyframes slideIn {
          from { opacity: 0; transform: translateX(100%); }
          to { opacity: 1; transform: translateX(0); }
        }

        @keyframes slideOut {
          from { opacity: 1; transform: translateX(0); }
          to { opacity: 0; transform: translateX(12px); }
        }
      `}</style>
    </div>
  );
}
