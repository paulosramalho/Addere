import { useEffect, useRef, useState } from "react";

/**
 * DateInputBR — campo de data DD/MM/AAAA com picker integrado
 *
 * Props:
 *   value       {string}  data em DD/MM/AAAA ou ISO (AAAA-MM-DD)
 *   onChange    {fn}      chamada com a nova data em DD/MM/AAAA
 *   label       {string}  rótulo exibido acima
 *   error       {string}  mensagem de erro
 *   disabled    {bool}
 *   placeholder {string}  padrão: "DD/MM/AAAA"
 *   className   {string}  classes adicionais no container
 *
 * Uso:
 *   <DateInputBR value={data} onChange={v => setData(v)} label="Vencimento" />
 */
export default function DateInputBR({
  value = "",
  onChange,
  label,
  error,
  disabled = false,
  placeholder = "DD/MM/AAAA",
  className = "",
}) {
  function isoToBR(iso) {
    if (!iso) return "";
    const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
  }

  function brToISO(br) {
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(br)) return "";
    const [dd, mm, yyyy] = br.split("/");
    return `${yyyy}-${mm}-${dd}`;
  }

  function mask(inp) {
    const d = inp.replace(/\D/g, "").slice(0, 8);
    if (d.length <= 2) return d;
    if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
    return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4, 8)}`;
  }

  function normalize(v) {
    if (!v) return "";
    if (/^\d{4}-\d{2}-\d{2}/.test(v)) return isoToBR(v);
    return v;
  }

  const [display, setDisplay] = useState(() => normalize(value));
  const hiddenRef = useRef(null);

  useEffect(() => {
    setDisplay(normalize(value));
  }, [value]);

  function handleChange(e) {
    const m = mask(e.target.value);
    setDisplay(m);
    onChange && onChange(m);
  }

  function openPicker() {
    hiddenRef.current?.showPicker?.();
    hiddenRef.current?.focus();
  }

  function onPickerChange(e) {
    const br = isoToBR(e.target.value);
    setDisplay(br);
    onChange && onChange(br);
  }

  const complete = /^\d{2}\/\d{2}\/\d{4}$/.test(display);
  const hasError = !!(error || (display && !complete));

  const borderClass = hasError
    ? "border-red-400 focus:ring-red-300"
    : "border-slate-300 focus:ring-primary/30";

  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      {label && (
        <label className="text-sm font-medium text-slate-700">{label}</label>
      )}

      <div className="flex items-center gap-1">
        <input
          type="text"
          inputMode="numeric"
          value={display}
          onChange={handleChange}
          disabled={disabled}
          placeholder={placeholder}
          className={`
            w-full px-3 py-2 rounded border text-sm
            focus:outline-none focus:ring-2 transition
            disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed
            ${borderClass}
          `}
        />
        <button
          type="button"
          onClick={openPicker}
          disabled={disabled}
          title="Selecionar data no calendário"
          className="px-2 py-2 rounded border border-slate-300 bg-white hover:bg-slate-50
                     text-slate-500 transition text-base leading-none
                     disabled:opacity-40 disabled:cursor-not-allowed"
        >
          📅
        </button>
        <input
          ref={hiddenRef}
          type="date"
          value={brToISO(display)}
          onChange={onPickerChange}
          tabIndex={-1}
          className="sr-only"
        />
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
