// ============================================================
// routes/processos.js — Acompanhamento de processos judiciais
// ============================================================
import { Router } from "express";
import multer from "multer";
import * as XLSX from "xlsx";
import prisma from "../lib/prisma.js";
import { authenticate, requireAdmin } from "../lib/auth.js";
import { consultarProcessosPorOAB, consultarProcessoPorNumero, DATAJUD_TRIBUNAIS_DEFAULT, TRIBUNAIS_SEM_PARTES, _extrairClienteDePartes, verificarChaveDatajud, getDatajudKey, _datajudFetchPublic } from "../lib/datajud.js";
import { sendEmail } from "../lib/email.js";
import { scraperTJSP, shouldSyncPortal, markSynced, resetCooldown } from "../lib/scraperTJSP.js";
import { shouldSyncPortalTJPA, markSyncedTJPA } from "../lib/scraperTJPA.js";
import { capturarSegredoPJe, TRIBUNAIS_PJE } from "../lib/scraperPJe.js";
import { decryptSeed } from "../lib/cryptoSeed.js";

const router = Router();

// ── GET /api/processos — lista processos ──────────────────────────────────────
router.get("/api/processos", authenticate, async (req, res) => {
  try {
    const {
      advogadoId, tribunal, status,
      numero, clienteNome,
      ajuizamentoInicio, ajuizamentoFim,
      ultimaAndInicio,   ultimaAndFim,
      comNovos,
      page = 1, limit = 50,
    } = req.query;

    const where = {};
    if (advogadoId) where.advogadoId = parseInt(advogadoId);
    if (tribunal)   where.tribunal   = tribunal;
    if (status)     where.status     = status;
    if (numero)     where.numeroProcesso = { contains: numero, mode: "insensitive" };
    if (clienteNome) where.clienteNome  = { contains: clienteNome, mode: "insensitive" };
    if (ajuizamentoInicio || ajuizamentoFim) {
      where.dataAjuizamento = {};
      if (ajuizamentoInicio) where.dataAjuizamento.gte = new Date(ajuizamentoInicio);
      if (ajuizamentoFim)    where.dataAjuizamento.lte = new Date(ajuizamentoFim + "T23:59:59");
    }
    if (ultimaAndInicio || ultimaAndFim) {
      where.ultimaDataAnd = {};
      if (ultimaAndInicio) where.ultimaDataAnd.gte = new Date(ultimaAndInicio);
      if (ultimaAndFim)    where.ultimaDataAnd.lte = new Date(ultimaAndFim + "T23:59:59");
    }
    if (comNovos === "1") where.andamentos = { some: { notificado: false } };

    const [processos, total] = await Promise.all([
      prisma.processoJudicial.findMany({
        where,
        include: {
          advogado: { select: { id: true, nome: true, oab: true } },
          _count: { select: { andamentos: { where: { notificado: false } } } },
        },
        orderBy: [{ status: "desc" }, { ultimaDataAnd: "desc" }, { createdAt: "desc" }],
        take: parseInt(limit),
        skip: (parseInt(page) - 1) * parseInt(limit),
      }),
      prisma.processoJudicial.count({ where }),
    ]);

    res.json({
      processos,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit)),
    });
  } catch (e) {
    console.error("GET /api/processos:", e.message);
    res.status(500).json({ message: "Erro ao listar processos." });
  }
});

// ── POST /api/processos/refresh-key — força renovação da chave DataJud (admin) ─
router.post("/api/processos/refresh-key", authenticate, requireAdmin, async (req, res) => {
  try {
    const resultado = await verificarChaveDatajud();
    if (resultado.changed) {
      res.json({ ok: true, message: `Chave atualizada: ${resultado.newKey.slice(0, 8)}...`, renderOk: resultado.renderOk });
    } else {
      res.json({ ok: true, message: `Chave atual válida (${getDatajudKey().slice(0, 8)}...) — nenhuma atualização necessária.` });
    }
  } catch (e) {
    res.status(500).json({ ok: false, message: e.message });
  }
});

// ── GET /api/processos/diag — diagnóstico DataJud por número CNJ (admin) ──────
// ?numero=0827227-03.2021.8.14.0301&tribunal=tjpa
router.get("/api/processos/diag", authenticate, requireAdmin, async (req, res) => {
  const { numero, tribunal = "tjpa" } = req.query;
  if (!numero) return res.status(400).json({ message: "Parâmetro ?numero= obrigatório." });

  try {
    // Busca pelo número exato (com e sem formatação)
    const numeroLimpo = numero.replace(/[.\-]/g, "");
    const data = await _datajudFetchPublic(tribunal, {
      query: {
        bool: {
          should: [
            { match: { numeroProcesso: numero } },
            { match: { numeroProcesso: numeroLimpo } },
          ],
          minimum_should_match: 1,
        },
      },
      size: 5,
    });

    const hits = data?.hits?.hits || [];
    const total = data?.hits?.total?.value ?? data?.hits?.total ?? 0;
    res.json({
      tribunal,
      numero,
      numeroLimpo,
      chave: getDatajudKey().slice(0, 8) + "...",
      total,
      hits: hits.map(h => ({
        id: h._id,
        sourceKeys: Object.keys(h._source || {}),
        partes: h._source?.partes || [],
        rawSource: h._source,
      })),
      raw_shards: data?._shards,
    });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// ── GET /api/processos/novos-andamentos — badge ──────────────────────────────
router.get("/api/processos/novos-andamentos", authenticate, async (req, res) => {
  try {
    const total = await prisma.processoAndamento.count({ where: { notificado: false } });
    res.json({ total });
  } catch (_) {
    res.json({ total: 0 });
  }
});

// ── POST /api/processos/capturar — nova captura individual por número CNJ ─────
// Body: { numeroProcesso, tribunal, advogadoId }
// Busca no DataJud, cria/atualiza o processo e importa andamentos.
router.post("/api/processos/capturar", authenticate, async (req, res) => {
  try {
    const { numeroProcesso, tribunal, advogadoId } = req.body;
    if (!numeroProcesso?.trim() || !tribunal?.trim() || !advogadoId)
      return res.status(400).json({ message: "numeroProcesso, tribunal e advogadoId são obrigatórios." });

    const adv = await prisma.advogado.findUnique({
      where: { id: parseInt(advogadoId) },
      select: { id: true, nome: true, oab: true },
    });
    if (!adv) return res.status(404).json({ message: "Advogado não encontrado." });

    const numero = numeroProcesso.trim();
    const trib   = tribunal.trim().toLowerCase();

    const jaExistia = await prisma.processoJudicial.findUnique({
      where: { numeroProcesso_tribunal: { numeroProcesso: numero, tribunal: trib } },
    });

    // Busca DataJud (exceto extrajudicial)
    let p = null;
    if (trib !== "extrajudicial") {
      p = await consultarProcessoPorNumero(numero, trib);
    }

    // Upsert processo
    const processo = await prisma.processoJudicial.upsert({
      where: { numeroProcesso_tribunal: { numeroProcesso: numero, tribunal: trib } },
      update: {
        ...(p?.classe          != null ? { classe:          p.classe }          : {}),
        ...(p?.assunto         != null ? { assunto:         p.assunto }         : {}),
        ...(p?.ultimoAndamento != null ? { ultimoAndamento: p.ultimoAndamento } : {}),
        ...(p?.ultimaDataAnd   != null ? { ultimaDataAnd:   p.ultimaDataAnd }   : {}),
        ...(p?.dataAjuizamento instanceof Date && !isNaN(p.dataAjuizamento)
          ? { dataAjuizamento: p.dataAjuizamento } : {}),
        updatedAt: new Date(),
      },
      create: {
        advogadoId:      adv.id,
        numeroProcesso:  numero,
        tribunal:        trib,
        classe:          p?.classe         ?? null,
        assunto:         p?.assunto        ?? null,
        dataAjuizamento: p?.dataAjuizamento instanceof Date && !isNaN(p.dataAjuizamento)
          ? p.dataAjuizamento : undefined,
        ultimoAndamento: p?.ultimoAndamento ?? null,
        ultimaDataAnd:   p?.ultimaDataAnd   ?? null,
      },
      include: { advogado: { select: { id: true, nome: true, oab: true } } },
    });

    // Importa andamentos novos
    let novosAndamentos = 0;
    if (p?.movimentos?.length) {
      const existentes = await prisma.processoAndamento.findMany({
        where: { processoId: processo.id },
        select: { dataAndamento: true, descricao: true },
      });
      const chaves = new Set(existentes.map(a =>
        `${new Date(a.dataAndamento).toISOString().slice(0, 16)}|${a.descricao.slice(0, 100)}`
      ));
      const novos = p.movimentos.filter(m => {
        if (!m.dataHora || !m.descricao) return false;
        return !chaves.has(`${new Date(m.dataHora).toISOString().slice(0, 16)}|${m.descricao.slice(0, 100)}`);
      });
      if (novos.length) {
        await prisma.processoAndamento.createMany({
          data: novos.map(m => ({
            processoId:    processo.id,
            dataAndamento: m.dataHora,
            descricao:     m.descricao,
            notificado:    false,
          })),
        });
        novosAndamentos = novos.length;
      }
    }

    // Auto-cliente via partes
    if (process.env.DATAJUD_AUTO_CLIENTES === "true"
        && p?.partes?.length && !TRIBUNAIS_SEM_PARTES.has(trib)
        && !processo.clienteId) {
      const clienteInfo = _extrairClienteDePartes(p.partes, adv.oab);
      if (clienteInfo?.nome) {
        try {
          const cli = await _findOrCreateClienteDatajud(clienteInfo, numero);
          await prisma.processoJudicial.update({
            where: { id: processo.id },
            data: { clienteId: cli.id, clienteNome: clienteInfo.nome },
          });
        } catch (e) {
          console.warn(`⚠️ Auto-cliente captura ${numero}:`, e.message);
        }
      }
    }

    console.log(`⚖️  Captura manual: ${numero}/${trib} · adv=${adv.nome} · andamentos=${novosAndamentos} · novo=${!jaExistia}`);
    res.status(jaExistia ? 200 : 201).json({
      processo,
      novosAndamentos,
      encontradoNoDataJud: !!p,
      jaExistia: !!jaExistia,
    });
  } catch (e) {
    console.error("POST /api/processos/capturar:", e.message);
    res.status(500).json({ message: e.message });
  }
});

// ── POST /api/processos/sync — sincronização manual (background) ──────────────
// Responde imediatamente; processa todos os advogados/tribunais em background.
// Query params opcionais: advogadoId (filtra um advogado), tribunal (filtra tribunal)
router.post("/api/processos/sync", authenticate, async (req, res) => {
  try {
    const tribunais = req.query.tribunal
      ? [req.query.tribunal]
      : DATAJUD_TRIBUNAIS_DEFAULT;

    const where = { ativo: true };
    if (req.query.advogadoId) where.id = parseInt(req.query.advogadoId);

    const advogados = await prisma.advogado.findMany({
      where,
      select: { id: true, nome: true, oab: true, email: true },
    });

    if (!advogados.length) {
      return res.json({ message: "Nenhum advogado ativo encontrado.", totalProcessos: 0, totalAndamentos: 0 });
    }

    // Responde imediatamente
    res.json({
      message: `Sincronização iniciada para ${advogados.length} advogado(s) · ${tribunais.length} tribunal(is). Acompanhe nos logs.`,
      total: advogados.length,
    });

    // ── Background ──────────────────────────────────────────
    (async () => {
      console.log(`⚖️  Sync manual (BG): ${advogados.length} advogado(s) · tribunais=[${tribunais.join(",")}]`);
      const resultados = [];
      for (const adv of advogados) {
        try {
          const r = await _syncAdvogado(adv, tribunais);
          resultados.push(r);
        } catch (e) {
          console.warn(`⚠️ Sync processos ${adv.nome}:`, e.message);
          resultados.push({ advogadoId: adv.id, nome: adv.nome, processos: 0, novosAndamentos: 0, erro: e.message });
        }
      }
      const totalProcessos  = resultados.reduce((s, r) => s + (r.processos || 0), 0);
      const totalAndamentos = resultados.reduce((s, r) => s + (r.novosAndamentos || 0), 0);
      const detalhes = resultados.map(r => `${r.nome}: ${r.processos} proc / ${r.novosAndamentos} and`).join(" | ");
      console.log(`✅ Sync manual concluído: ${totalProcessos} processo(s), ${totalAndamentos} andamento(s) — ${detalhes}`);
    })().catch(e => console.error("Sync manual BG erro:", e.message));
  } catch (e) {
    console.error("POST /api/processos/sync:", e.message);
    res.status(500).json({ message: "Erro ao iniciar sincronização." });
  }
});

// ── POST /api/processos/sync/:advogadoId — sync de um advogado ───────────────
// Query param opcional: tribunal (filtra tribunal)
router.post("/api/processos/sync/:advogadoId", authenticate, async (req, res) => {
  try {
    const adv = await prisma.advogado.findUnique({
      where: { id: parseInt(req.params.advogadoId) },
      select: { id: true, nome: true, oab: true, email: true },
    });
    if (!adv)     return res.status(404).json({ message: "Advogado não encontrado." });
    if (!adv.oab) return res.status(400).json({ message: "Advogado não tem OAB cadastrado." });

    const tribunais = req.query.tribunal
      ? [req.query.tribunal]
      : DATAJUD_TRIBUNAIS_DEFAULT;

    const resultado = await _syncAdvogado(adv, tribunais);
    res.json(resultado);
  } catch (e) {
    console.error("POST /api/processos/sync/:id:", e.message);
    res.status(500).json({ message: "Erro ao sincronizar advogado." });
  }
});

// ── GET /api/processos/tribunais-pje — lista tribunais PJe suportados ────────
// DEVE ficar antes de /:processoId para não ser capturado como parâmetro
router.get("/api/processos/tribunais-pje", authenticate, (req, res) => {
  res.json(TRIBUNAIS_PJE);
});

// ── GET /api/processos/:processoId — detalhe + andamentos ────────────────────
router.get("/api/processos/:processoId", authenticate, async (req, res) => {
  try {
    const id = parseInt(req.params.processoId);
    const processo = await prisma.processoJudicial.findUnique({
      where: { id },
      include: {
        advogado: { select: { id: true, nome: true, oab: true, email: true, pjeSeed: true } },
        andamentos: { orderBy: { dataAndamento: "desc" }, take: 300 },
      },
    });
    if (!processo) return res.status(404).json({ message: "Processo não encontrado." });

    // Marca andamentos deste processo como notificados ao abrir
    await prisma.processoAndamento.updateMany({
      where: { processoId: id, notificado: false },
      data: { notificado: true },
    });

    // Não expõe o seed criptografado — apenas indica se está configurado
    const { pjeSeed: _seed, ...advSafe } = processo.advogado || {};
    res.json({ ...processo, advogado: processo.advogado ? { ...advSafe, hasPjeSeed: !!_seed } : null });
  } catch (e) {
    console.error("GET /api/processos/:id:", e.message);
    res.status(500).json({ message: "Erro ao buscar processo." });
  }
});

// ── Helpers para importação xlsx ─────────────────────────────────────────────
const _uploadXlsx = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const _TRIBUNAIS_CONHECIDOS = new Set(["tjpa","trt8","trf1","stj","stf","tst","tjsp","tjrr","tjam","tjms","tjmg","tjrj","tjrs","tjpr","tjsc","tjpe","tjba","tjce","tjgo","tjal","tjap","tjma","tjmt","tjpi","tjro","tjse","tjto","tjac","tjpb","tjes","tjrn","tse","tre","trf2","trf3","trf4","trf5"]);

function _normName(s) {
  return String(s || "").toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, "").trim();
}

function _fuzzyMatchAdvogado(xlsxName, advogados) {
  const xlsxWords = _normName(xlsxName).split(/\s+/).filter(w => w.length > 2);
  if (!xlsxWords.length) return null;
  let best = null, bestScore = 0;
  for (const adv of advogados) {
    const dbWords = new Set(_normName(adv.nome).split(/\s+/));
    const matchCount = xlsxWords.filter(w => dbWords.has(w)).length;
    const score = matchCount / xlsxWords.length;
    if (score > bestScore) { bestScore = score; best = adv; }
  }
  return bestScore >= 0.5 ? best : null;
}

function _extractTribunal(orgao) {
  const first = String(orgao || "").trim().split(/[\s\-]/)[0].toLowerCase();
  return _TRIBUNAIS_CONHECIDOS.has(first) ? first : "extrajudicial";
}

// ── POST /api/processos/importar — importa xlsx do Astrea (admin) ────────────
// multipart/form-data, campo: file (.xlsx)
router.post("/api/processos/importar", authenticate, requireAdmin, _uploadXlsx.single("file"), async (req, res) => {
    if (!req.file) return res.status(400).json({ message: "Nenhum arquivo enviado." });

    try {
      const workbook  = XLSX.read(req.file.buffer, { type: "buffer" });
      const ws        = workbook.Sheets[workbook.SheetNames[0]];
      const rows      = XLSX.utils.sheet_to_json(ws, { defval: "" });

      if (!rows.length) return res.status(400).json({ message: "Planilha vazia." });

      // Carrega advogados ativos
      const advogados = await prisma.advogado.findMany({
        where: { ativo: true },
        select: { id: true, nome: true },
      });

      let processosImportados = 0;
      let clientesCriados     = 0;
      let clientesEncontrados = 0;
      const erros             = [];
      const clienteIds        = new Set();

      for (const row of rows) {
        const identificador = String(row["Identificador"] || "").trim();
        const nomeRaw       = String(row["Nome do Cliente"] || "").trim();
        const orgao         = String(row["Órgão"] || "").trim();
        const responsaveis  = String(row["Responsáveis"] || "").trim();
        const assunto       = String(row["Assunto"] || "").trim() || null;
        const posicao       = String(row["Envolvimento do Cliente"] || "").trim() || null;
        const nomeEnvolv    = String(row["Nome do Envolvido"] || "").trim() || null;
        const tipoEnvolv    = String(row["Tipo do Envolvimento"] || "").trim() || null;

        const numeroRaw  = String(row["Nº do Processo"] || "").replace(/\s*\(CNJ\)\s*$/i, "").trim();
        const numero     = numeroRaw || identificador; // fallback: usa identificador
        const tribunal   = _extractTribunal(orgao);

        // Match advogado
        const partes  = responsaveis.split("|").map(s => s.trim()).filter(Boolean);
        let advogado  = null;
        for (const parte of partes) {
          advogado = _fuzzyMatchAdvogado(parte, advogados);
          if (advogado) break;
        }
        if (!advogado) {
          erros.push({ identificador, numero, motivo: `Advogado não encontrado em: "${responsaveis}"` });
          continue;
        }

        // Find or create cliente
        let cliente = null;
        if (nomeRaw) {
          cliente = await prisma.cliente.findFirst({
            where: { nomeRazaoSocial: { equals: nomeRaw, mode: "insensitive" } },
            select: { id: true, nomeRazaoSocial: true },
          });
          if (cliente) {
            clientesEncontrados++;
          } else {
            const placeholder = `PROC_IMP_${identificador.replace(/[^A-Z0-9]/gi, "")}`;
            cliente = await prisma.cliente.create({
              data: { nomeRazaoSocial: nomeRaw, cpfCnpj: placeholder },
              select: { id: true, nomeRazaoSocial: true },
            });
            clientesCriados++;
          }
          if (cliente?.id) clienteIds.add(cliente.id);
        }

        // Upsert ProcessoJudicial
        try {
          await prisma.processoJudicial.upsert({
            where: { numeroProcesso_tribunal: { numeroProcesso: numero, tribunal } },
            update: {
              assunto,
              clienteId:        cliente?.id ?? null,
              clienteNome:      nomeRaw     || null,
              posicaoCliente:   posicao,
              nomeEnvolvido:    nomeEnvolv,
              tipoEnvolvimento: tipoEnvolv,
              updatedAt:        new Date(),
            },
            create: {
              advogadoId:       advogado.id,
              numeroProcesso:   numero,
              tribunal,
              assunto,
              clienteId:        cliente?.id ?? null,
              clienteNome:      nomeRaw     || null,
              posicaoCliente:   posicao,
              nomeEnvolvido:    nomeEnvolv,
              tipoEnvolvimento: tipoEnvolv,
            },
          });
          processosImportados++;
        } catch (e) {
          erros.push({ identificador, numero, motivo: e.message });
        }
      }

      // Relatório de clientes com dados faltantes (do lote importado)
      const todosClientes = clienteIds.size
        ? await prisma.cliente.findMany({
            where: { id: { in: [...clienteIds] } },
            select: { id: true, nomeRazaoSocial: true, cpfCnpj: true, email: true, telefone: true },
          })
        : [];

      const relatorioFaltantes = todosClientes
        .filter(c => {
          const faltaCpf   = !c.cpfCnpj || c.cpfCnpj.startsWith("PROC_IMP_");
          const faltaEmail = !c.email;
          const faltaTel   = !c.telefone;
          return faltaCpf || faltaEmail || faltaTel;
        })
        .map(c => ({
          id:           c.id,
          nome:         c.nomeRazaoSocial,
          faltaCpf:     !c.cpfCnpj || c.cpfCnpj.startsWith("PROC_IMP_"),
          faltaEmail:   !c.email,
          faltaTelefone:!c.telefone,
        }))
        .sort((a, b) => a.nome.localeCompare(b.nome));

      console.log(`📥 Importação xlsx: ${processosImportados} processos · ${clientesCriados} clientes criados · ${clientesEncontrados} encontrados · ${erros.length} erros`);

      res.json({
        processosImportados,
        clientesCriados,
        clientesEncontrados,
        erros,
        relatorioFaltantes,
      });
    } catch (e) {
      console.error("POST /api/processos/importar:", e.message);
      res.status(500).json({ message: `Erro na importação: ${e.message}` });
    }
});

// ── POST /api/processos/:id/sync-numero — sync por número CNJ ────────────────
// Busca andamentos diretamente pelo número do processo no DataJud.
// Funciona para TJPA e qualquer tribunal onde a busca por OAB não retorna resultados.
router.post("/api/processos/:id/sync-numero", authenticate, async (req, res) => {
  try {
    const processo = await prisma.processoJudicial.findUnique({
      where: { id: parseInt(req.params.id) },
      select: { id: true, numeroProcesso: true, tribunal: true, status: true, clienteId: true, advogadoId: true },
    });
    if (!processo) return res.status(404).json({ message: "Processo não encontrado." });

    if (processo.tribunal === "extrajudicial") {
      return res.status(400).json({ message: "Processo extrajudicial — sem consulta DataJud." });
    }

    console.log(`⚖️  Sync por número: ${processo.numeroProcesso} / ${processo.tribunal}`);
    const p = await consultarProcessoPorNumero(processo.numeroProcesso, processo.tribunal);

    if (!p) {
      return res.json({ novosAndamentos: 0, message: "Processo não encontrado no DataJud para este tribunal." });
    }

    // Deduplicação de andamentos
    const existentes = await prisma.processoAndamento.findMany({
      where: { processoId: processo.id },
      select: { dataAndamento: true, descricao: true },
    });
    const chaves = new Set(
      existentes.map(a =>
        `${new Date(a.dataAndamento).toISOString().slice(0, 16)}|${a.descricao.slice(0, 100)}`
      )
    );

    const novos = (p.movimentos || []).filter(m => {
      if (!m.dataHora || !m.descricao) return false;
      const k = `${new Date(m.dataHora).toISOString().slice(0, 16)}|${m.descricao.slice(0, 100)}`;
      return !chaves.has(k);
    });

    if (novos.length > 0) {
      await prisma.processoAndamento.createMany({
        data: novos.map(m => ({
          processoId:    processo.id,
          dataAndamento: m.dataHora,
          descricao:     m.descricao,
          notificado:    false,
        })),
      });
    }

    // Detecta arquivamento nos andamentos
    const todosAndamentos = [...(p.movimentos || [])];
    const isArquivado = todosAndamentos.some(m =>
      /arquiv/i.test(m.descricao || "")
    );
    const novoStatus = isArquivado ? "ARQUIVADO" : processo.status;

    // Atualiza metadados do processo
    await prisma.processoJudicial.update({
      where: { id: processo.id },
      data: {
        classe:          p.classe          ?? undefined,
        assunto:         p.assunto         ?? undefined,
        dataAjuizamento: p.dataAjuizamento instanceof Date && !isNaN(p.dataAjuizamento) ? p.dataAjuizamento : undefined,
        ultimoAndamento: p.ultimoAndamento ?? undefined,
        ultimaDataAnd:   p.ultimaDataAnd   ?? undefined,
        status:          novoStatus,
        updatedAt:       new Date(),
      },
    });

    // Auto-cliente via DataJud partes
    if (process.env.DATAJUD_AUTO_CLIENTES === "true"
        && p.partes?.length && !TRIBUNAIS_SEM_PARTES.has(processo.tribunal)
        && !processo.clienteId) {
      const adv = await prisma.advogado.findUnique({
        where: { id: processo.advogadoId },
        select: { oab: true },
      });
      if (adv?.oab) {
        const clienteInfo = _extrairClienteDePartes(p.partes, adv.oab);
        if (clienteInfo?.nome) {
          try {
            const cli = await _findOrCreateClienteDatajud(clienteInfo, processo.numeroProcesso);
            await prisma.processoJudicial.update({
              where: { id: processo.id },
              data: { clienteId: cli.id, clienteNome: clienteInfo.nome },
            });
          } catch (e) {
            console.warn(`⚠️ Auto-cliente sync-numero ${processo.numeroProcesso}:`, e.message);
          }
        }
      }
    }

    console.log(`✅ Sync por número ${processo.numeroProcesso}: ${novos.length} novo(s) andamento(s) · status=${novoStatus}`);
    res.json({
      novosAndamentos: novos.length,
      totalAndamentos: existentes.length + novos.length,
      status: novoStatus,
      statusMudou: novoStatus !== processo.status,
    });
  } catch (e) {
    console.error("POST /api/processos/:id/sync-numero:", e.message);
    res.status(500).json({ message: e.message });
  }
});

// ── PATCH /api/processos/:id/marcar-lidos — marca todos andamentos como lidos ─
router.patch("/api/processos/:id/marcar-lidos", authenticate, async (req, res) => {
  try {
    const { count } = await prisma.processoAndamento.updateMany({
      where: { processoId: parseInt(req.params.id), notificado: false },
      data:  { notificado: true },
    });
    res.json({ ok: true, count });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// ── PATCH /api/processos/andamentos/:id/nota — salva nota interna num andamento
router.patch("/api/processos/andamentos/:id/nota", authenticate, async (req, res) => {
  try {
    const { nota } = req.body;
    const updated = await prisma.processoAndamento.update({
      where: { id: parseInt(req.params.id) },
      data:  { nota: nota?.trim() || null },
    });
    res.json(updated);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// ── PATCH /api/processos/:id — atualiza status/campos editáveis ───────────────
router.patch("/api/processos/:id", authenticate, async (req, res) => {
  try {
    const allowed = ["status", "assunto", "classe", "monitorado"];
    const data = {};
    for (const k of allowed) {
      if (k in req.body) data[k] = req.body[k];
    }
    if (!Object.keys(data).length) return res.status(400).json({ message: "Nenhum campo para atualizar." });
    const updated = await prisma.processoJudicial.update({
      where: { id: parseInt(req.params.id) },
      data: { ...data, updatedAt: new Date() },
    });
    res.json(updated);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// ── POST /api/processos/:id/sync-portal — sincronização de movimentos do portal ──
// TJSP: Playwright (ESAJ). TJPA: DataJud (sem Playwright — evita OOM no Render).
// Retorna { ok, novos, total, skipped } — skipped=true se ainda no cooldown.
router.post("/api/processos/:id/sync-portal", authenticate, async (req, res) => {
  try {
    const processoId = parseInt(req.params.id);
    const processo = await prisma.processoJudicial.findUnique({
      where: { id: processoId },
      select: { id: true, numeroProcesso: true, tribunal: true },
    });
    if (!processo) return res.status(404).json({ message: "Processo não encontrado." });

    // Tribunais suportados via scraping de portal
    const tribunaisPortal = ["tjsp", "tjpa"];
    if (!tribunaisPortal.includes(processo.tribunal)) {
      return res.json({ ok: true, novos: 0, total: 0, skipped: true, motivo: "tribunal não suportado" });
    }

    // Cooldown — evita scrape repetido (ignorado se ?forcar=1)
    const forcar = req.query.forcar === "1";
    const isTJPA = processo.tribunal === "tjpa";
    const _shouldSync = isTJPA ? shouldSyncPortalTJPA : shouldSyncPortal;
    const _markSynced = isTJPA ? markSyncedTJPA : markSynced;

    if (!forcar && !_shouldSync(processoId)) {
      return res.json({ ok: true, novos: 0, total: 0, skipped: true, motivo: "cooldown" });
    }

    _markSynced(processoId);

    let movimentos;
    if (isTJPA) {
      // TJPA: DataJud indexa movimentos — sem Playwright (evita OOM no Render)
      const dadosDJ = await consultarProcessoPorNumero(processo.numeroProcesso, "tjpa");
      movimentos = (dadosDJ?.movimentos || [])
        .filter(m => m.dataHora && m.descricao)
        .map(m => ({ dataAndamento: m.dataHora, descricao: m.descricao, conteudo: null }));
    } else {
      movimentos = await scraperTJSP(processo.numeroProcesso);
    }
    if (!movimentos.length) {
      return res.json({ ok: true, novos: 0, total: 0, skipped: false });
    }

    // Buscar existentes para deduplicar
    const existentes = await prisma.processoAndamento.findMany({
      where: { processoId },
      select: { dataAndamento: true, descricao: true },
    });
    const existSet = new Set(
      existentes.map(e => `${e.dataAndamento?.toISOString().slice(0, 10)}|${e.descricao}`)
    );

    let novos = 0;
    for (const mov of movimentos) {
      const key = `${mov.dataAndamento.toISOString().slice(0, 10)}|${mov.descricao}`;
      if (!existSet.has(key)) {
        await prisma.processoAndamento.create({
          data: { processoId, dataAndamento: mov.dataAndamento, descricao: mov.descricao, notificado: false, nota: mov.conteudo || null },
        });
        novos++;
      }
    }

    // Atualizar ultimoAndamento e ultimaDataAnd se houver novos
    if (novos > 0) {
      const ultimo = movimentos[0]; // já vem do mais recente para o mais antigo
      await prisma.processoJudicial.update({
        where: { id: processoId },
        data: { ultimoAndamento: ultimo.descricao, ultimaDataAnd: ultimo.dataAndamento },
      });
    }

    console.log(`[sync-portal] processo ${processoId} (${processo.tribunal}): ${novos} novos de ${movimentos.length}`);
    res.json({ ok: true, novos, total: movimentos.length, skipped: false });
  } catch (e) {
    console.error(`POST /api/processos/:id/sync-portal:`, e.message);
    res.status(500).json({ message: e.message });
  }
});

// ── POST /api/processos/sync-portal-all — sincroniza TODOS os processos TJSP ─────
// Admin only. Roda sequencialmente com delay de 3s entre cada processo.
// Responde imediatamente com 202; o resultado é logado no servidor.
// Query param: ?forcar=1 ignora cooldown.
router.post("/api/processos/sync-portal-all", authenticate, requireAdmin, async (req, res) => {
  const forcar = req.query.forcar === "1";

  // Busca todos os processos TJSP ativos
  const processos = await prisma.processoJudicial.findMany({
    where: { tribunal: "tjsp" },
    select: { id: true, numeroProcesso: true },
    orderBy: { id: "asc" },
  });

  if (!processos.length) {
    return res.json({ ok: true, message: "Nenhum processo TJSP cadastrado.", total: 0 });
  }

  // Responde imediatamente e processa em background
  res.json({ ok: true, message: `Sincronização iniciada para ${processos.length} processo(s) TJSP.`, total: processos.length });

  // ── Background ──────────────────────────────────────────
  (async () => {
    let novosTotal = 0;
    let erros = 0;
    const detalhes = [];

    for (const proc of processos) {
      try {
        if (!forcar && !shouldSyncPortal(proc.id)) {
          detalhes.push({ id: proc.id, numero: proc.numeroProcesso, status: "cooldown", novos: 0 });
          continue;
        }

        markSynced(proc.id);
        const movimentos = await scraperTJSP(proc.numeroProcesso);

        if (!movimentos.length) {
          detalhes.push({ id: proc.id, numero: proc.numeroProcesso, status: "vazio", novos: 0 });
          await _delay(3000);
          continue;
        }

        const existentes = await prisma.processoAndamento.findMany({
          where: { processoId: proc.id },
          select: { dataAndamento: true, descricao: true },
        });
        const existSet = new Set(
          existentes.map(e => `${e.dataAndamento?.toISOString().slice(0, 10)}|${e.descricao}`)
        );

        let novos = 0;
        for (const mov of movimentos) {
          const key = `${mov.dataAndamento.toISOString().slice(0, 10)}|${mov.descricao}`;
          if (!existSet.has(key)) {
            await prisma.processoAndamento.create({
              data: { processoId: proc.id, dataAndamento: mov.dataAndamento, descricao: mov.descricao, notificado: false, nota: mov.conteudo || null },
            });
            novos++;
          }
        }

        if (novos > 0) {
          const ultimo = movimentos[0];
          await prisma.processoJudicial.update({
            where: { id: proc.id },
            data: { ultimoAndamento: ultimo.descricao, ultimaDataAnd: ultimo.dataAndamento },
          });
          novosTotal += novos;
        }

        detalhes.push({ id: proc.id, numero: proc.numeroProcesso, status: "ok", novos, total: movimentos.length });
        console.log(`[sync-all] processo ${proc.id} (${proc.numeroProcesso}): ${novos} novos de ${movimentos.length}`);
      } catch (e) {
        erros++;
        detalhes.push({ id: proc.id, numero: proc.numeroProcesso, status: "erro", erro: e.message });
        console.error(`[sync-all] processo ${proc.id} (${proc.numeroProcesso}): erro — ${e.message}`);
      }

      await _delay(3000); // pausa entre requisições ao ESAJ
    }

    console.log(`[sync-all] Concluído: ${novosTotal} andamentos novos, ${erros} erros de ${processos.length} processos`);
  })().catch(e => console.error("[sync-all] Erro fatal:", e.message));
});

function _delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── POST /api/processos/:id/importar-movimentos — importa texto colado do portal ─
// Body: { texto: string } — formato ESAJ ou texto livre "DD/MM/AAAA  Descrição\nConteúdo..."
router.post("/api/processos/:id/importar-movimentos", authenticate, async (req, res) => {
  try {
    const processoId = parseInt(req.params.id);
    const { texto } = req.body;
    if (!texto?.trim()) return res.status(400).json({ message: "texto é obrigatório." });

    // Parse: linhas que começam com DD/MM/AAAA = novo andamento
    const DATE_RE = /^(\d{2})\/(\d{2})\/(\d{4})\s+(.+)$/;
    const linhas = texto.split(/\r?\n/);
    const movimentos = [];
    let atual = null;

    for (const linha of linhas) {
      const m = DATE_RE.exec(linha.trim());
      if (m) {
        if (atual) movimentos.push(atual);
        const [, d, mo, a, desc] = m;
        atual = {
          dataAndamento: new Date(`${a}-${mo}-${d}T12:00:00.000Z`),
          descricao: desc.trim(),
          conteudo: "",
        };
      } else if (atual && linha.trim()) {
        atual.conteudo = atual.conteudo ? atual.conteudo + "\n" + linha.trim() : linha.trim();
      }
    }
    if (atual) movimentos.push(atual);

    if (!movimentos.length) return res.status(400).json({ message: "Nenhuma movimentação reconhecida no texto." });

    // Buscar existentes para deduplicar
    const existentes = await prisma.processoAndamento.findMany({
      where: { processoId },
      select: { dataAndamento: true, descricao: true },
    });
    const existSet = new Set(existentes.map(e => `${e.dataAndamento?.toISOString().slice(0,10)}|${e.descricao}`));

    let novos = 0;
    for (const mov of movimentos) {
      const key = `${mov.dataAndamento.toISOString().slice(0,10)}|${mov.descricao}`;
      if (!existSet.has(key)) {
        await prisma.processoAndamento.create({
          data: { processoId, dataAndamento: mov.dataAndamento, descricao: mov.descricao, notificado: false, nota: mov.conteudo || null },
        });
        novos++;
      }
    }

    res.json({ ok: true, total: movimentos.length, novos, ignorados: movimentos.length - novos });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// ── POST /api/processos/:id/capturar-segredo — captura via PJe com credenciais
// Body: { tribunal?, instancia?, login, senha, token? }
// Credenciais NÃO são salvas — usadas apenas para esta sessão.
router.post("/api/processos/:id/capturar-segredo", authenticate, async (req, res) => {
  const processoId = parseInt(req.params.id);
  const { login, senha, token, instancia } = req.body || {};

  if (!login || !senha) {
    return res.status(400).json({ message: "Login e senha são obrigatórios." });
  }

  try {
    const processo = await prisma.processoJudicial.findUnique({
      where: { id: processoId },
      select: { id: true, numeroProcesso: true, tribunal: true, advogadoId: true },
    });
    if (!processo) return res.status(404).json({ message: "Processo não encontrado." });

    const tribunal = req.body?.tribunal || processo.tribunal;

    // Tenta buscar SEED do advogado para 2FA automático
    let seed = null;
    if (processo.advogadoId) {
      const adv = await prisma.advogado.findUnique({
        where: { id: processo.advogadoId },
        select: { pjeSeed: true },
      });
      if (adv?.pjeSeed) seed = decryptSeed(adv.pjeSeed);
    }

    console.log(`[PJe] Captura segredo solicitada: processo #${processoId} ${processo.numeroProcesso} · ${tribunal}${seed ? " (SEED automático)" : ""}`);

    // Captura via Playwright — pode levar 30–90s
    const andamentos = await capturarSegredoPJe({
      tribunal,
      instancia: instancia || "1G",
      numeroProcesso: processo.numeroProcesso,
      login: login.trim(),
      senha,
      seed: seed || undefined,
      token: seed ? undefined : (token?.trim() || undefined),
    });

    if (andamentos.length === 0) {
      return res.json({ novos: 0, message: "Nenhum andamento encontrado para este processo no portal." });
    }

    // Deduplicação
    const existentes = await prisma.processoAndamento.findMany({
      where: { processoId: processo.id },
      select: { dataAndamento: true, descricao: true },
    });
    const chaves = new Set(
      existentes.map(a => `${new Date(a.dataAndamento).toISOString().slice(0, 16)}|${a.descricao.slice(0, 100)}`)
    );

    const novos = andamentos.filter(a => {
      const k = `${a.dataAndamento.toISOString().slice(0, 16)}|${a.descricao.slice(0, 100)}`;
      return !chaves.has(k);
    });

    if (novos.length > 0) {
      await prisma.processoAndamento.createMany({
        data: novos.map(a => ({
          processoId:    processo.id,
          dataAndamento: a.dataAndamento,
          descricao:     a.descricao,
          notificado:    false,
        })),
      });
      await prisma.processoJudicial.update({
        where: { id: processo.id },
        data: { ultimoAndamento: novos[0].descricao, ultimaDataAnd: novos[0].dataAndamento, updatedAt: new Date() },
      });
    }

    console.log(`[PJe] Segredo capturado: ${novos.length} novo(s) de ${andamentos.length} total`);
    res.json({ novos: novos.length, total: andamentos.length });
  } catch (e) {
    console.error("[PJe] capturar-segredo:", e.message);
    res.status(500).json({ message: e.message });
  }
});

// ── DELETE /api/processos/:id — remover processo ──────────────────────────────
router.delete("/api/processos/:id", authenticate, async (req, res) => {
  try {
    await prisma.processoJudicial.delete({ where: { id: parseInt(req.params.id) } });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// ============================================================
// HELPER: find-or-create cliente a partir do DataJud
// ============================================================
async function _findOrCreateClienteDatajud({ nome, cpfCnpj }, numeroProcesso) {
  if (cpfCnpj) {
    const ex = await prisma.cliente.findFirst({ where: { cpfCnpj }, select: { id: true } });
    if (ex) return ex;
  }
  return prisma.cliente.create({
    data: {
      nomeRazaoSocial: nome,
      cpfCnpj: cpfCnpj || `DATAJUD_${String(numeroProcesso).replace(/[^A-Z0-9]/gi, "")}`,
    },
    select: { id: true },
  });
}

// ============================================================
// HELPER: sincroniza processos de um advogado via DataJud
// Exportado para uso no scheduler
// ============================================================
export async function _syncAdvogado(adv, tribunais = DATAJUD_TRIBUNAIS_DEFAULT) {
  console.log(`⚖️  _syncAdvogado: ${adv.nome} OAB=${adv.oab} tribunais=${tribunais.join(",")}`);
  const processos = await consultarProcessosPorOAB(adv.oab, tribunais);
  console.log(`⚖️  _syncAdvogado: ${adv.nome} → DataJud retornou ${processos.length} processo(s)`);
  let novosAndamentos = 0;

  for (const p of processos) {
    console.log(`  ↳ upsert: ${p.numeroProcesso} / ${p.tribunal}`);
    // Upsert processo
    const processo = await prisma.processoJudicial.upsert({
      where: {
        numeroProcesso_tribunal: {
          numeroProcesso: p.numeroProcesso,
          tribunal: p.tribunal,
        },
      },
      update: {
        classe:         p.classe,
        assunto:        p.assunto,
        ultimoAndamento: p.ultimoAndamento,
        ultimaDataAnd:  p.ultimaDataAnd,
        updatedAt:      new Date(),
      },
      create: {
        advogadoId:     adv.id,
        numeroProcesso: p.numeroProcesso,
        tribunal:       p.tribunal,
        classe:         p.classe,
        assunto:        p.assunto,
        dataAjuizamento: p.dataAjuizamento instanceof Date && !isNaN(p.dataAjuizamento) ? p.dataAjuizamento : undefined,
        ultimoAndamento: p.ultimoAndamento,
        ultimaDataAnd:  p.ultimaDataAnd,
      },
    });

    // Auto-cliente via DataJud partes (DATAJUD_AUTO_CLIENTES=true no .env)
    if (process.env.DATAJUD_AUTO_CLIENTES === "true"
        && p.partes?.length && !TRIBUNAIS_SEM_PARTES.has(p.tribunal)
        && !processo.clienteId) {
      const clienteInfo = _extrairClienteDePartes(p.partes, adv.oab);
      if (clienteInfo?.nome) {
        try {
          const cli = await _findOrCreateClienteDatajud(clienteInfo, p.numeroProcesso);
          await prisma.processoJudicial.update({
            where: { id: processo.id },
            data: { clienteId: cli.id, clienteNome: clienteInfo.nome },
          });
        } catch (e) {
          console.warn(`⚠️ Auto-cliente ${p.numeroProcesso}:`, e.message);
        }
      }
    }

    // Processo não monitorado: pula inserção de andamentos
    if (processo.monitorado === false) {
      console.log(`  ↳ ${p.numeroProcesso}: monitorado=false — andamentos ignorados`);
      continue;
    }

    // Modo sobrescrita: apaga tudo e reinsere (SYNC_OVERWRITE=true no env)
    const overwrite = process.env.SYNC_OVERWRITE === "true";

    if (overwrite) {
      await prisma.processoAndamento.deleteMany({ where: { processoId: processo.id } });
      const validos = p.movimentos.filter(m => m.dataHora && m.descricao);
      if (validos.length > 0) {
        await prisma.processoAndamento.createMany({
          data: validos.map(m => ({
            processoId:    processo.id,
            dataAndamento: m.dataHora,
            descricao:     m.descricao,
            notificado:    false,
          })),
        });
        novosAndamentos += validos.length;
      }
    } else {
      // Dedup normal: só insere o que não existe
      const existentes = await prisma.processoAndamento.findMany({
        where: { processoId: processo.id },
        select: { dataAndamento: true, descricao: true },
      });
      const chaves = new Set(
        existentes.map(a =>
          `${new Date(a.dataAndamento).toISOString().slice(0, 16)}|${a.descricao.slice(0, 100)}`
        )
      );

      const novos = p.movimentos.filter(m => {
        if (!m.dataHora || !m.descricao) return false;
        const k = `${new Date(m.dataHora).toISOString().slice(0, 16)}|${m.descricao.slice(0, 100)}`;
        return !chaves.has(k);
      });

      if (novos.length > 0) {
        await prisma.processoAndamento.createMany({
          data: novos.map(m => ({
            processoId:    processo.id,
            dataAndamento: m.dataHora,
            descricao:     m.descricao,
            notificado:    false,
          })),
        });
        novosAndamentos += novos.length;
      }
    }
  }

  return { advogadoId: adv.id, nome: adv.nome, processos: processos.length, novosAndamentos };
}

// ── E-mail de notificação de novos andamentos ──────────────────────────────────
export function buildEmailAndamentos(nomeAdv, qtd, processosList) {
  const linhas = processosList
    .map(p => `<li><strong>${p.numeroProcesso}</strong> (${p.tribunal.toUpperCase()}) — ${p.novos} andamento(s)</li>`)
    .join("");
  return `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <div style="background:#1e3a5f;color:white;padding:20px;border-radius:8px 8px 0 0">
        <h2 style="margin:0">⚖️ Novos Andamentos Processuais</h2>
      </div>
      <div style="padding:20px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:0 0 8px 8px">
        <p>Olá, <strong>${nomeAdv}</strong></p>
        <p>Identificamos <strong>${qtd} novo(s) andamento(s)</strong> nos seus processos:</p>
        <ul style="margin:16px 0;padding-left:20px">${linhas}</ul>
        <p>Acesse o sistema em <strong>Jurídico → Processos</strong> para ver os detalhes.</p>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0">
        <p style="font-size:12px;color:#64748b">Addere — Sistema de Controle</p>
      </div>
    </div>
  `;
}

export default router;
