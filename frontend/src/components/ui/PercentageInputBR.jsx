/**
 * PercentageInputBR — campo de porcentagem com máscara automática
 *
 * Internamente trabalha com dígitos brutos (sem vírgula):
 *   "4500" → exibe "45,00%"
 *   "647"  → exibe "6,47%"
 *   "100"  → exibe "1,00%"
 *
 * Props:
 *   value       {string}  dígitos brutos (ex: "4500")
 *   onChange    {fn}      chamada com os novos dígitos brutos (string)
 *   label       {string}
 *   error       {string}
 *   disabled    {bool}
 *   placeholder {string}  padrão: "0,00%"
 *   className   {string}
 *
 * Conversão: ver percentDigitsToDecimal / decimalToPercentDigits em formatters.js
 *
 * Uso:
 *   <PercentageInputBR value={digits} onChange={d => setDigits(d)} label="Alíquota" />
 */
export default function PercentageInputBR({
  value = "",
  onChange,
  label,
  error,
  disabled = false,
  placeholder = "0,00%",
  className = "",
}) {
  const digits = (value || "").replace(/\D/g, "");
  const n = digits ? BigInt(digits) : 0n;
  const cents = n % 100n;
  const whole = n / 100n;
  const display = digits
    ? `${whole.toString()},${cents.toString().padStart(2, "0")}%`
    : "";

  function handleChange(e) {
    const d = (e.target.value || "").replace(/\D/g, "");
    onChange && onChange(d);
  }

  const borderClass = error
    ? "border-red-400 focus:ring-red-300"
    : "border-slate-300 focus:ring-primary/30";

  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      {label && (
        <label className="text-sm font-medium text-slate-700">{label}</label>
      )}
      <input
        type="text"
        inputMode="numeric"
        value={display}
        onChange={handleChange}
        disabled={disabled}
        placeholder={placeholder}
        className={`
          w-full px-3 py-2 rounded border text-sm text-right
          focus:outline-none focus:ring-2 transition
          disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed
          ${borderClass}
        `}
      />
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
