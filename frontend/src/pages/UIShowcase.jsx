// src/pages/UIShowcase.jsx — Vitrine dos componentes UI
import { useState } from "react";
import MoneyInput from "../components/ui/MoneyInput";
import EmptyState from "../components/ui/EmptyState";

export default function UIShowcase() {
  const [valor1, setValor1] = useState(0);
  const [valor2, setValor2] = useState(123456); // R$ 1.234,56
  const [valor3, setValor3] = useState(0);

  return (
    <div className="max-w-3xl mx-auto p-8 space-y-12">
      <h1 className="text-2xl font-bold text-slate-800">Componentes UI — Addere</h1>

      {/* ── MoneyInput ─────────────────────────────────── */}
      <section className="space-y-6">
        <h2 className="text-lg font-semibold text-slate-700 border-b pb-2">MoneyInput</h2>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          {/* Vazio */}
          <MoneyInput
            label="Valor (vazio)"
            value={valor1}
            onChange={setValor1}
            placeholder="0,00"
          />

          {/* Pré-preenchido */}
          <MoneyInput
            label="Valor (pré-preenchido)"
            value={valor2}
            onChange={setValor2}
          />

          {/* Com erro */}
          <MoneyInput
            label="Valor (com erro)"
            value={valor3}
            onChange={setValor3}
            error="Informe um valor maior que zero."
          />
        </div>

        <div className="bg-slate-50 rounded-lg p-4 text-sm text-slate-600 space-y-1">
          <p>Valor 1 em centavos: <strong>{valor1}</strong> → R$ {(valor1/100).toFixed(2).replace(".",",")}</p>
          <p>Valor 2 em centavos: <strong>{valor2}</strong> → R$ {(valor2/100).toFixed(2).replace(".",",")}</p>
        </div>
      </section>

      {/* ── EmptyState ─────────────────────────────────── */}
      <section className="space-y-6">
        <h2 className="text-lg font-semibold text-slate-700 border-b pb-2">EmptyState</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          {/* Padrão */}
          <div className="border rounded-lg bg-white">
            <p className="text-xs text-slate-400 px-4 pt-3">Padrão</p>
            <EmptyState
              icon="📭"
              title="Nenhum resultado"
              description="Tente ajustar os filtros."
            />
          </div>

          {/* Com ação */}
          <div className="border rounded-lg bg-white">
            <p className="text-xs text-slate-400 px-4 pt-3">Com botão de ação</p>
            <EmptyState
              icon="👤"
              title="Nenhum cliente encontrado."
              description="Cadastre um novo cliente para começar."
              action={
                <button className="px-4 py-2 bg-primary text-white text-sm rounded hover:bg-primary-hover transition">
                  + Novo Cliente
                </button>
              }
            />
          </div>

          {/* Variantes por contexto */}
          <div className="border rounded-lg bg-white">
            <p className="text-xs text-slate-400 px-4 pt-3">Processos</p>
            <EmptyState
              icon="📋"
              title="Nenhum processo encontrado"
              description='Clique em "Sincronizar Todos" para buscar no DataJud (CNJ).'
            />
          </div>

          {/* Compact — dentro de tabela */}
          <div className="border rounded-lg bg-white overflow-hidden">
            <p className="text-xs text-slate-400 px-4 pt-3">Compact (dentro de tabela)</p>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-left">
                  <th className="px-3 py-2 text-slate-500 font-medium">Cliente</th>
                  <th className="px-3 py-2 text-slate-500 font-medium">Valor</th>
                  <th className="px-3 py-2 text-slate-500 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td colSpan={3}>
                    <EmptyState compact icon="📄" title="Nenhum lançamento." />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
