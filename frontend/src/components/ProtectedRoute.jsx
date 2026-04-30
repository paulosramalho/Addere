import { Navigate, useNavigate } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";

/**
 * ProtectedRoute
 * - se ainda está carregando o /me: mostra nada (App pode ter loading global)
 * - se não logado: manda pro /login
 * - se exige role e não bate: mostra "Acesso não autorizado", faz countdown e redireciona pro Dashboard
 */
export default function ProtectedRoute({
  isLoading,
  isAuthenticated,
  userRole,
  allowRoles, // ex: ["ADMIN"] ou ["ADMIN","USER"]
  children,
}) {
  if (isLoading) return null;

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  const needsRoleCheck = Array.isArray(allowRoles) && allowRoles.length > 0;
  const isAuthorized = useMemo(() => {
    if (!needsRoleCheck) return true;
    return allowRoles.includes(userRole);
  }, [needsRoleCheck, allowRoles, userRole]);

  // --- Unauthorized UX: countdown + redirect ---
  const navigate = useNavigate();
  const [secondsLeft, setSecondsLeft] = useState(5);

  useEffect(() => {
    if (isAuthorized) return;

    setSecondsLeft(5);

    const interval = setInterval(() => {
      setSecondsLeft((s) => Math.max(0, s - 1));
    }, 1000);

    const timeout = setTimeout(() => {
      navigate("/dashboard", { replace: true });
    }, 5000);

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [isAuthorized, navigate]);

  if (!isAuthorized) {
    return (
      <div className="p-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-6">
          <div className="text-sm text-slate-500">Acesso não autorizado</div>

          <div className="mt-1 text-lg font-semibold text-slate-900">
            Você não tem permissão para acessar esta área.
          </div>

          <div className="mt-3 text-sm text-slate-600">
            Você será redirecionado(a) para o Dashboard em{" "}
            <span className="font-semibold text-slate-900">
              {secondsLeft}s
            </span>
            .
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => navigate("/dashboard", { replace: true })}
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              Ir agora
            </button>

            <button
              type="button"
              onClick={() => navigate(-1)}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Voltar
            </button>
          </div>
        </div>
      </div>
    );
  }

  return children;
}
