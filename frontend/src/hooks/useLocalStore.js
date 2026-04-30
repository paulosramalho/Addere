import { useEffect, useState } from "react";

/**
 * useLocalStore — sincroniza estado React com localStorage automaticamente.
 *
 * Útil para persistir filtros, preferências de UI e estado de forms
 * entre navegações sem precisar de contexto global.
 *
 * @param {string} key      chave no localStorage (ex: "amr:filtros:lancamentos")
 * @param {any}    initial  valor inicial se não houver nada salvo
 * @returns {[any, fn]}     [state, setState] — mesma API do useState
 *
 * Uso:
 *   const [filtros, setFiltros] = useLocalStore("amr:filtros:clientes", { ativo: true });
 *   setFiltros(f => ({ ...f, busca: "João" }));
 */
export default function useLocalStore(key, initial) {
  const [state, setState] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw !== null ? JSON.parse(raw) : initial;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(state));
    } catch {
      // localStorage indisponível ou cheio — silencia
    }
  }, [key, state]);

  return [state, setState];
}
