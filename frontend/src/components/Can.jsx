import React from "react";

/**
 * Can
 * - renderiza children somente quando `when` for true
 * - Sem lógica de negócio, apenas controle de exibição (UI)
 */
export default function Can({ when, children, fallback = null }) {
  return when ? <>{children}</> : fallback;
}
