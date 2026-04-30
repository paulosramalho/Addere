/**
 * MoneyInput — campo de entrada de valor monetário em R$
 *
 * Props:
 *   value       {number}   valor em CENTAVOS (Int)
 *   onChange    {fn}       chamada com o novo valor em CENTAVOS (Int)
 *   label       {string}   rótulo exibido acima do campo
 *   error       {string}   mensagem de erro (exibe borda vermelha + texto)
 *   disabled    {bool}
 *   placeholder {string}   padrão: "0,00"
 *   className   {string}   classes adicionais no container
 *   inputRef    {ref}      ref opcional para o <input>
 *
 * Comportamento:
 *   - Exibe o valor formatado como "1.234,56" enquanto o usuário digita
 *   - Aceita apenas dígitos; pontuação é calculada automaticamente (último
 *     separador sempre são 2 casas decimais)
 *   - Internamente armazena e emite centavos (Int), compatível com o padrão
 *     do backend e com brlFromCentavos / centsToBRL de formatters.js
 */

import { useState, useEffect, useRef } from "react";

function centsToDisplay(cents) {
  if (!cents && cents !== 0) return "";
  const val = Math.abs(Math.round(Number(cents)));
  return (val / 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function displayToCents(display) {
  // Remove tudo que não é dígito
  const digits = display.replace(/\D/g, "");
  if (!digits) return 0;
  return parseInt(digits, 10); // os 2 últimos dígitos são centavos
}

export default function MoneyInput({
  value,
  onChange,
  label,
  error,
  disabled = false,
  placeholder = "0,00",
  className = "",
  inputRef: externalRef,
}) {
  const internalRef = useRef(null);
  const ref = externalRef || internalRef;

  const [display, setDisplay] = useState(() => centsToDisplay(value));

  // Sincroniza display quando value muda externamente (ex: reset de form)
  useEffect(() => {
    setDisplay(centsToDisplay(value));
  }, [value]);

  function handleChange(e) {
    const raw = e.target.value;
    const digits = raw.replace(/\D/g, "");

    if (digits === "") {
      setDisplay("");
      onChange(0);
      return;
    }

    const cents = parseInt(digits, 10);
    const formatted = (cents / 100).toLocaleString("pt-BR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

    setDisplay(formatted);
    onChange(cents);
  }

  function handleFocus(e) {
    // Seleciona tudo ao focar para facilitar substituição
    e.target.select();
  }

  function handleBlur() {
    // Garante formatação correta ao sair do campo
    setDisplay(centsToDisplay(value));
  }

  const borderClass = error
    ? "border-red-400 focus:ring-red-300"
    : "border-slate-300 focus:ring-primary/30";

  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      {label && (
        <label className="text-sm font-medium text-slate-700">{label}</label>
      )}

      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm select-none">
          R$
        </span>
        <input
          ref={ref}
          type="text"
          inputMode="numeric"
          value={display}
          onChange={handleChange}
          onFocus={handleFocus}
          onBlur={handleBlur}
          disabled={disabled}
          placeholder={placeholder}
          className={`
            w-full pl-9 pr-3 py-2 rounded border text-sm text-right
            focus:outline-none focus:ring-2 transition
            disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed
            ${borderClass}
          `}
        />
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
