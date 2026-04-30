// src/components/Layout.jsx
import { NavLink, Outlet } from "react-router-dom";
import { useMemo, useState } from "react";

/**
 * Layout
 * - Sidebar com menu por role
 * - Admin: mostra "Configurações" com subitens (Advogados, Clientes, Pagamentos)
 * - User: NÃO mostra "Configurações" e mantém "Meu Perfil Profissional" onde está (rota /advogados)
 *
 * Como usar (exemplo):
 * <Layout user={user} onLogout={logoutFn}>
 *   <Outlet />
 * </Layout>
 *
 * Se você não passar children, ele renderiza <Outlet /> automaticamente.
 */
export default function Layout({ user, onLogout, children }) {
  const role = String(user?.role || "").toUpperCase();
  const isAdmin = role === "ADMIN";

  // Mantém Configurações aberto para Admin por padrão (UX)
  const [openSettings, setOpenSettings] = useState(true);

  const menu = useMemo(() => {
    if (isAdmin) {
      return [
        { to: "/dashboard", label: "Dashboard" },

        {
          type: "group",
          label: "Configurações",
          key: "settings",
          children: [
            { to: "/advogados", label: "Advogados" },
            { to: "/clientes", label: "Clientes" },
            { to: "/pagamentos", label: "Pagamentos" },
          ],
        },

        // Já deixo listados (você disse “quando tratarmos”)
        { to: "/repasses", label: "Repasses" },
        { to: "/historico", label: "Histórico" },
        { to: "/relatorios", label: "Relatórios" },
      ];
    }

    // USER
    return [
      { to: "/advogados", label: "Meu Perfil Profissional" },
      // Futuro (quando tratarmos):
      // { to: "/dashboard", label: "Dashboard" },
      // { to: "/repasses", label: "Repasses" },
      // { to: "/historico", label: "Histórico" },
      // { to: "/relatorios", label: "Relatórios" },
    ];
  }, [isAdmin]);

  return (
    <div className="min-h-screen bg-surface-bg flex">
      {/* Sidebar */}
      <aside className="w-64 h-screen bg-surface-card border-r border-surface-border flex flex-col">
        <div className="px-5 py-4 border-b border-slate-200">
          <div className="text-base font-semibold text-text-primary">Addere Control</div>
          <div className="mt-1 text-xs text-text-secondary truncate">
            {user?.nome ? user.nome : user?.email ? user.email : "—"} • {role || "—"}
          </div>
        </div>

        <nav className="p-3 flex-1 overflow-auto">
          <div className="space-y-2">
            {menu.map((item) => {
              if (item.type === "group") {
                const opened = openSettings;
                return (
                  <div key={item.key} className="rounded-xl border border-slate-200 bg-slate-50">
                    <button
                      type="button"
                      onClick={() => setOpenSettings((v) => !v)}
                      className="w-full flex items-center justify-between px-3 py-2.5 text-sm font-semibold text-slate-800"
                    >
                      <span>{item.label}</span>
                      <span className="text-slate-500">{opened ? "–" : "+"}</span>
                    </button>

                    {opened ? (
                      <div className="px-2 pb-2 space-y-1">
                        {item.children.map((child) => (
                          <MenuLink key={child.to} to={child.to} label={child.label} inset />
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              }

              return <MenuLink key={item.to} to={item.to} label={item.label} />;
            })}
          </div>
        </nav>

        <div className="p-3 border-t border-slate-200">
          <button
            type="button"
            onClick={onLogout}
            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-100 transition disabled:opacity-70"
            disabled={!onLogout}
            title={!onLogout ? "Passe a função onLogout para habilitar" : "Sair"}
          >
            Sair
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 min-w-0">
        {children ? children : <Outlet />}
      </main>
    </div>
  );
}

function MenuLink({ to, label, inset = false }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        [
          "block rounded-xl px-3 py-2 text-sm font-semibold transition",
          inset ? "ml-1" : "",
          isActive
            ? "bg-primary text-white"
            : "text-text-primary hover:bg-surface-bg border border-transparent",
        ].join(" ")
      }
    >
      {label}
    </NavLink>
  );
}
