// src/components/Breadcrumbs.jsx
import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import GlobalSearch from './GlobalSearch';

export function Breadcrumbs() {
  const location = useLocation();
  
  // Mapeamento de rotas para títulos legíveis
  const routeNames = {
    'dashboard': { name: 'Dashboard', icon: '📊' },
    'pagamentos': { name: 'Recebimentos', icon: '💰' },
    'pagamentos-avulsos': { name: 'Pagamentos Avulsos', icon: '💵' },
    'repasses': { name: 'Repasses', icon: '💸' },
    'arealizar': { name: 'A Realizar', icon: '⏳' },
    'realizados': { name: 'Realizados', icon: '✅' },
    'saldos': { name: 'Saldos', icon: '💰' },
    'livro-caixa': { name: 'Livro Caixa', icon: '📖' },
    'contas': { name: 'Contas Contábeis', icon: '🏦' },
    'lancamentos': { name: 'Lançamentos', icon: '📝' },
    'visualizacao': { name: 'Visualização', icon: '👁️' },
    'emissao': { name: 'Emissão', icon: '📄' },
    'advogados': { name: 'Advogados', icon: '⚖️' },
    'clientes': { name: 'Clientes', icon: '👥' },
    'usuarios': { name: 'Usuários', icon: '👤' },
    'modelo-distribuicao': { name: 'Modelos de Distribuição', icon: '📋' },
    'aliquotas': { name: 'Alíquotas', icon: '💯' },
    'historico': { name: 'Histórico', icon: '🕐' },
    'relatorios': { name: 'Relatórios', icon: '📈' },
    'contratos': { name: 'Contratos', icon: '📄' },
  };

  // Quebrar o path em partes
  const pathnames = location.pathname.split('/').filter(x => x);
  
  return (
    <nav className="flex items-center justify-between text-sm mb-6 px-6 pt-5">
      {/* Breadcrumbs */}
      <div className="flex items-center space-x-2 min-w-0">
        <Link
          to="/"
          className="flex items-center gap-1 text-slate-500 hover:text-blue-600 transition-colors shrink-0"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
          </svg>
          <span className="font-medium">Início</span>
        </Link>

        {pathnames.map((segment, index) => {
          if (/^\d+$/.test(segment)) return null;
          const routeTo = `/${pathnames.slice(0, index + 1).join('/')}`;
          const isLast = index === pathnames.length - 1;
          const route = routeNames[segment] || { name: segment, icon: '📁' };
          return (
            <React.Fragment key={routeTo}>
              <svg className="w-4 h-4 text-slate-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
              </svg>
              {isLast ? (
                <span className="flex items-center gap-1 font-semibold text-slate-900 truncate">
                  <span>{route.icon}</span>
                  <span>{route.name}</span>
                </span>
              ) : (
                <Link to={routeTo} className="flex items-center gap-1 text-slate-500 hover:text-blue-600 transition-colors shrink-0">
                  <span>{route.icon}</span>
                  <span className="font-medium">{route.name}</span>
                </Link>
              )}
            </React.Fragment>
          );
        })}
      </div>

      {/* Busca Global */}
      <div className="w-56 shrink-0 ml-4">
        <GlobalSearch />
      </div>
    </nav>
  );
}
