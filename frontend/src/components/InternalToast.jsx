// InternalToast.jsx - VERSÃO CORRIGIDA COM ANIMAÇÕES
import React, { useEffect, useState } from "react";

export function InternalToast({ message, type, onClose }) {
  const [isVisible, setIsVisible] = useState(false);
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    if (!message) return;

    // Força animação de entrada
    requestAnimationFrame(() => {
      setIsVisible(true);
    });

    // Timer para iniciar saída
    const exitTimer = setTimeout(() => {
      setIsExiting(true);
    }, 3700); // 4000ms - 300ms de animação

    // Timer para remover componente
    const removeTimer = setTimeout(() => {
      if (onClose) onClose();
    }, 4000);

    return () => {
      clearTimeout(exitTimer);
      clearTimeout(removeTimer);
    };
  }, [message, type, onClose]);

  if (!message) return null;

  const bgColor = type === "success" ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200";
  const textColor = type === "success" ? "text-green-800" : "text-red-800";
  const icon = type === "success" ? "✓" : "✕";

  const handleManualClose = () => {
    setIsExiting(true);
    setTimeout(() => {
      if (onClose) onClose();
    }, 300);
  };

  return (
    <>
      <style>{`
        @keyframes slideInFromTop {
          from {
            opacity: 0;
            transform: translateY(-30px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes slideOutToTop {
          from {
            opacity: 1;
            transform: translateY(0);
          }
          to {
            opacity: 0;
            transform: translateY(-30px);
          }
        }

        .toast-container {
          animation: slideInFromTop 300ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }

        .toast-container.exiting {
          animation: slideOutToTop 300ms cubic-bezier(0.7, 0, 0.84, 0) forwards;
        }
      `}</style>
      
      <div 
        className={`fixed top-4 right-4 z-[9999] toast-container ${isExiting ? 'exiting' : ''}`}
        style={{ 
          pointerEvents: 'auto',
          opacity: isVisible && !isExiting ? 1 : 0
        }}
      >
        <div className={`rounded-xl border ${bgColor} ${textColor} px-4 py-3 shadow-lg flex items-center gap-3 min-w-[320px] max-w-md`}>
          <span className="text-xl flex-shrink-0">{icon}</span>
          <div className="flex-1 text-sm font-medium break-words">{message}</div>
          <button 
            onClick={handleManualClose}
            className="text-lg flex-shrink-0 opacity-60 hover:opacity-100 transition-opacity ml-2"
            type="button"
            aria-label="Fechar"
          >
            ✕
          </button>
        </div>
      </div>
    </>
  );
}

// Hook para usar o toast com animações
export function useInternalToast() {
  const [toast, setToast] = useState(null);

  const showToast = (message, type = "info") => {
    // Limpa toast anterior
    setToast(null);
    // Pequeno delay para garantir nova animação
    requestAnimationFrame(() => {
      setToast({ message, type, key: Date.now() });
    });
  };

  const ToastComponent = toast ? (
    <InternalToast 
      key={toast.key}
      message={toast.message} 
      type={toast.type} 
      onClose={() => setToast(null)} 
    />
  ) : null;

  return { showToast, ToastComponent };
}