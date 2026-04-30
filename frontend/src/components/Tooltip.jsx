// ============================================
// src/components/Tooltip.jsx
// ============================================
import React, { useState } from 'react';

export function Tooltip({ children, content, position = 'top' }) {
  const [show, setShow] = useState(false);

  const positions = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
    left: 'right-full top-1/2 -translate-y-1/2 mr-2',
    right: 'left-full top-1/2 -translate-y-1/2 ml-2',
  };

  const arrows = {
    top: 'top-full left-1/2 -translate-x-1/2 -mt-1 border-t-slate-800',
    bottom: 'bottom-full left-1/2 -translate-x-1/2 -mb-1 border-b-slate-800',
    left: 'left-full top-1/2 -translate-y-1/2 -ml-1 border-l-slate-800',
    right: 'right-full top-1/2 -translate-y-1/2 -mr-1 border-r-slate-800',
  };

  return (
    <div 
      className="relative inline-block"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      {children}
      
      {show && content && (
        <div className={`absolute ${positions[position]} z-50 animate-[fadeIn_0.2s_ease-out]`}>
          <div className="bg-slate-800 text-white text-xs font-medium px-3 py-2 rounded-lg shadow-lg whitespace-nowrap">
            {content}
          </div>
          <div className={`absolute ${arrows[position]} w-0 h-0 border-4 border-transparent`}></div>
        </div>
      )}

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `}</style>
    </div>
  );
}