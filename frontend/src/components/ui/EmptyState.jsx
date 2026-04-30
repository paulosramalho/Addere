/**
 * EmptyState — estado vazio padronizado para tabelas e listagens
 *
 * Props:
 *   icon        {string|ReactNode}  emoji ou elemento JSX (padrão: "📭")
 *   title       {string}            texto principal  (padrão: "Nenhum resultado")
 *   description {string}            subtexto opcional
 *   action      {ReactNode}         botão ou link opcional exibido abaixo
 *   compact     {bool}              versão menor para tabelas (padding reduzido)
 *   className   {string}            classes adicionais no container
 *
 * Uso básico:
 *   <EmptyState title="Nenhum cliente encontrado." />
 *
 * Uso completo:
 *   <EmptyState
 *     icon="👤"
 *     title="Nenhum cliente encontrado."
 *     description="Ajuste os filtros ou cadastre um novo cliente."
 *     action={<button onClick={onNew}>+ Novo Cliente</button>}
 *   />
 *
 * Uso compacto (dentro de <td colSpan={N}>):
 *   <EmptyState compact title="Nenhuma parcela." />
 */

export default function EmptyState({
  icon = "📭",
  title = "Nenhum resultado",
  description,
  action,
  compact = false,
  className = "",
}) {
  const py = compact ? "py-8" : "py-14";

  return (
    <div
      className={`flex flex-col items-center justify-center text-center ${py} gap-3 ${className}`}
    >
      {icon && (
        <span className={compact ? "text-3xl" : "text-5xl"}>{icon}</span>
      )}

      <div className="flex flex-col gap-1">
        <p
          className={`font-medium text-slate-500 ${
            compact ? "text-sm" : "text-base"
          }`}
        >
          {title}
        </p>

        {description && (
          <p className="text-xs text-slate-400 max-w-xs mx-auto">
            {description}
          </p>
        )}
      </div>

      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
