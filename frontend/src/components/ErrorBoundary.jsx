// src/components/ErrorBoundary.jsx
import React from "react";

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("ErrorBoundary caught:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
          <div className="bg-white rounded-2xl border border-red-200 shadow-lg max-w-md w-full p-8 text-center">
            <div className="text-5xl mb-4">⚠️</div>
            <h1 className="text-xl font-bold text-slate-900 mb-2">Algo deu errado</h1>
            <p className="text-sm text-slate-500 mb-6">
              Ocorreu um erro inesperado nesta página. Os seus dados estão seguros.
            </p>
            <div className="bg-slate-50 rounded-xl px-4 py-3 mb-6 text-left">
              <p className="text-xs font-mono text-red-600 break-all">
                {this.state.error?.message || String(this.state.error)}
              </p>
            </div>
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => this.setState({ error: null })}
                className="px-4 py-2 rounded-xl border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Tentar novamente
              </button>
              <button
                onClick={() => { this.setState({ error: null }); window.location.href = "/noticeboard"; }}
                className="px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700"
              >
                Ir para o início
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
