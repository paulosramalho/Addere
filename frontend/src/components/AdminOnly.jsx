import React from "react";
import Can from "./Can";

/**
 * AdminOnly
 * - renderiza children somente se user.role === "ADMIN"
 * - UI only (não substitui segurança do backend)
 */
export default function AdminOnly({ user, children, fallback = null }) {
  const isAdmin = String(user?.role || "").toUpperCase() === "ADMIN";
  return <Can when={isAdmin} fallback={fallback}>{children}</Can>;
}
