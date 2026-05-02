// backend/src/routes/c6.js
// Endpoints da integração C6 Bank.
// Status: SCAFFOLD — modo mock funcional; modo real exige credencial corporativa.

import { Router } from "express";
import { authenticate, requireAdmin } from "../lib/auth.js";
import { emitirBoleto, consultarBoleto, cancelarBoleto, C6_MODE } from "../lib/c6Bank.js";

const router = Router();

// Health-check da configuração C6
router.get("/api/c6/status", authenticate, requireAdmin, (_req, res) => {
  res.json({
    mode: C6_MODE,
    configurado: !!(process.env.C6_CLIENT_ID && process.env.C6_CLIENT_SECRET),
    sandboxUrl: process.env.C6_SANDBOX_URL || null,
    productionUrl: process.env.C6_PRODUCTION_URL || null,
  });
});

// Emitir boleto C6
router.post("/api/c6/boletos", authenticate, requireAdmin, async (req, res) => {
  try {
    const { seuNumero, valorCentavos, dataVencimento, pagador } = req.body || {};
    if (!seuNumero || !Number.isFinite(Number(valorCentavos)) || !dataVencimento) {
      return res.status(400).json({ error: "seuNumero, valorCentavos e dataVencimento são obrigatórios." });
    }
    const result = await emitirBoleto({
      seuNumero: String(seuNumero),
      valorCentavos: Number(valorCentavos),
      dataVencimento,
      pagador,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Consultar boleto
router.get("/api/c6/boletos/:codigoSolicitacao", authenticate, requireAdmin, async (req, res) => {
  try {
    const result = await consultarBoleto(req.params.codigoSolicitacao);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Cancelar boleto
router.post("/api/c6/boletos/:codigoSolicitacao/cancelar", authenticate, requireAdmin, async (req, res) => {
  try {
    const { motivo } = req.body || {};
    const result = await cancelarBoleto(req.params.codigoSolicitacao, motivo);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
