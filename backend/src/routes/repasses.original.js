import { Router } from "express";
import crypto from "crypto";
import prisma from "../lib/prisma.js";
import { authenticate, requireAdmin, requireAuth, getUserAdvogadoId } from "../lib/auth.js";
import { logAuditoria } from "../lib/audit.js";
import { sendEmail } from "../lib/email.js";
import { sendWhatsApp, sendWhatsAppStrict, sendWhatsAppTemplate, _waPhone } from "../lib/whatsapp.js";

const router = Router();

// ── Local helpers ─────────────────────────────────────────────────────────────

const _MESES_PT = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];

function _fmtDatePT(d) {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d) : d;
  if (!dt || isNaN(dt.getTime())) return "—";
  const [y, m, dd] = dt.toISOString().slice(0, 10).split("-");
  const mes = _MESES_PT[parseInt(m, 10) - 1] || m;
  return `${parseInt(dd, 10)} de ${mes} de ${y}`;
}

function parseDDMMYYYYToDate(s) {
  const str = String(s || "").trim();
  const m = str.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const dd = Number(m[1]);
  const mm = Number(m[2]);
  const yyyy = Number(m[3]);
  const dt = new Date(yyyy, mm - 1, dd, 12, 0, 0, 0);
  if (
    dt.getFullYear() !== yyyy ||
    dt.getMonth() !== mm - 1 ||
    dt.getDate() !== dd
  ) return null;
  return dt;
}

function buildEmailApuracaoAdvogado(nomeAdvogado, { mes, ano, valorLiquidoCentavos, qtdParcelas }) {
  const fmtBRL = (c) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const mesNome = _MESES_PT[mes - 1] || String(mes);
  return `<!DOCTYPE html><html><body style="font-family:sans-serif;background:#f8fafc;margin:0;padding:20px">
  <div style="max-width:640px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.1)">
    <div style="background:#92400e;padding:24px 28px">
      <div style="font-size:20px;font-weight:700;color:#fff">Addere</div>
      <div style="font-size:13px;color:#fde68a;margin-top:4px">Apuração de repasse disponível</div>
      <div style="font-size:12px;color:#fef3c7;margin-top:4px">Mensagem direcionada à ${nomeAdvogado}</div>
    </div>
    <div style="padding:24px 28px">
      <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:16px 20px;margin-bottom:20px">
        <table style="width:100%;border-collapse:collapse">
          <tr>
            <td style="padding:6px 0;font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase;width:160px">Competência</td>
            <td style="padding:6px 0;font-size:14px;color:#0f172a;font-weight:600">${mesNome} de ${ano}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase">Parcelas apuradas</td>
            <td style="padding:6px 0;font-size:14px;color:#0f172a">${qtdParcelas}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase">Valor apurado</td>
            <td style="padding:6px 0;font-size:18px;font-weight:700;color:#92400e">${fmtBRL(valorLiquidoCentavos)}</td>
          </tr>
        </table>
      </div>
      <div style="background:#fefce8;border:1px solid #fde68a;border-radius:8px;padding:12px 16px;font-size:13px;color:#713f12">
        ℹ️ Este é o valor apurado com base no Modelo de Distribuição do seu contrato. O pagamento efetivo será realizado após confirmação do financeiro.
      </div>
    </div>
    <div style="padding:16px 28px;background:#f8fafc;border-top:1px solid #e5e7eb;font-size:12px;color:#94a3b8;text-align:center">
      Addere Control — notificação automática
    </div>
  </div>
</body></html>`;
}

function buildEmailRepasseRealizado(nomeAdvogado, { competenciaMes, competenciaAno, valorEfetivadoCentavos, dataRepasse }) {
  const fmtBRL = (c) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const mesNome = _MESES_PT[competenciaMes - 1] || String(competenciaMes);
  const dataStr = dataRepasse ? _fmtDatePT(dataRepasse) : "—";
  return `<!DOCTYPE html><html><body style="font-family:sans-serif;background:#f8fafc;margin:0;padding:20px">
  <div style="max-width:640px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.1)">
    <div style="background:#1e40af;padding:24px 28px">
      <div style="font-size:20px;font-weight:700;color:#fff">Addere</div>
      <div style="font-size:13px;color:#bfdbfe;margin-top:4px">Repasse processado pelo financeiro</div>
      <div style="font-size:12px;color:#dbeafe;margin-top:4px">Mensagem direcionada à ${nomeAdvogado}</div>
    </div>
    <div style="padding:24px 28px">
      <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:16px 20px;margin-bottom:20px">
        <table style="width:100%;border-collapse:collapse">
          <tr>
            <td style="padding:6px 0;font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase;width:160px">Competência</td>
            <td style="padding:6px 0;font-size:14px;color:#0f172a;font-weight:600">${mesNome} de ${competenciaAno}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase">Data do repasse</td>
            <td style="padding:6px 0;font-size:14px;color:#0f172a">${dataStr}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase">Valor efetivado</td>
            <td style="padding:6px 0;font-size:18px;font-weight:700;color:#1e40af">${fmtBRL(valorEfetivadoCentavos)}</td>
          </tr>
        </table>
      </div>
      <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:12px 16px;font-size:13px;color:#1e3a8a">
        ✅ Seu repasse foi processado. Aguarde o crédito em conta — em caso de dúvidas, entre em contato com o financeiro.
      </div>
    </div>
    <div style="padding:16px 28px;background:#f8fafc;border-top:1px solid #e5e7eb;font-size:12px;color:#94a3b8;text-align:center">
      Addere Control — notificação automática
    </div>
  </div>
</body></html>`;
}

// ============================================================
// ENDPOINTS DE REPASSES - VERSÃO CORRIGIDA
// Adicione/Substitua estas rotas no server.js
// ============================================================

// ============================================================
// 1. EM APURAÇÃO (PARCELAS PREVISTAS)
// ============================================================
router.get("/api/repasses/em-apuracao", authenticate, async (req, res) => {
  try {
    const ano = Number(req.query.ano);
    const mes = Number(req.query.mes);

    console.log('\n========================================');
    console.log('📊 EM APURAÇÃO - DEBUG');
    console.log('========================================');
    console.log('Competência (M):', { ano, mes });

    // Validações
    if (!ano || Number.isNaN(ano) || ano < 2000) {
      return res.status(400).json({ message: "Parâmetro 'ano' inválido." });
    }
    if (!mes || Number.isNaN(mes) || mes < 1 || mes > 12) {
      return res.status(400).json({ message: "Parâmetro 'mes' inválido." });
    }

    // Calcular mês de REFERÊNCIA (M-1)
    const mesReferencia = mes === 1 ? 12 : mes - 1;
    const anoReferencia = mes === 1 ? ano - 1 : ano;

    console.log('Mês de referência (M-1):', { ano: anoReferencia, mes: mesReferencia });

    // Buscar alíquota
    let aliquota = await prisma.aliquota.findUnique({
      where: {
        mes_ano: {
          mes: parseInt(mes),
          ano: parseInt(ano),
        },
      },
    });

    if (!aliquota) {
      console.log('⚠️ Alíquota não encontrada para', mes, '/', ano);
      console.log('Buscando última alíquota cadastrada...');
      
      aliquota = await prisma.aliquota.findFirst({
        orderBy: [{ ano: 'desc' }, { mes: 'desc' }],
      });

      if (aliquota) {
        console.log('✅ Usando alíquota de', aliquota.mes, '/', aliquota.ano);
      }
    }

    if (!aliquota) {
      console.log('❌ NENHUMA alíquota cadastrada no sistema');
      return res.json({
        competencia: { ano, mes },
        referencia: { ano: anoReferencia, mes: mesReferencia },
        items: [],
        totais: {
          bruto: "0.00",
          imposto: "0.00",
          liquido: "0.00",
          escritorio: "0.00",
          fundoReserva: "0.00",
          socios: "0.00",
        },
        alerta: `⚠️ Nenhuma alíquota cadastrada no sistema.`,
      });
    }

    // Buscar parcelas PREVISTAS com vencimento em M-1
    const primeiroDia = new Date(anoReferencia, mesReferencia - 1, 1, 0, 0, 0);
    const ultimoDia = new Date(anoReferencia, mesReferencia, 0, 23, 59, 59);

    console.log('Período de busca (M-1):', {
      de: primeiroDia.toISOString(),
      ate: ultimoDia.toISOString(),
    });

    const parcelas = await prisma.parcelaContrato.findMany({
      where: {
        status: "PREVISTA",
        excluirDoRepasse: false,
        vencimento: {
          gte: primeiroDia,
          lte: ultimoDia,
        },
      },
      include: {
        contrato: {
          include: {
            cliente: {
              select: {
                id: true,
                nomeRazaoSocial: true,
              },
            },
            modeloDistribuicao: {
              include: {
                itens: {
                  orderBy: { ordem: "asc" },
                },
              },
            },
            splits: {
              include: {
                advogado: {
                  select: {
                    id: true,
                    nome: true,
                    oab: true,
                  },
                },
              },
            },
            repasseAdvogadoPrincipal: {
              select: {
                id: true,
                nome: true,
                oab: true,
              },
            },
            // ✅ CORREÇÃO: INCLUIR ADVOGADO DE INDICAÇÃO
            repasseIndicacaoAdvogado: {
              select: {
                id: true,
                nome: true,
                oab: true,
              },
            },
          },
        },
      },
      orderBy: {
        vencimento: 'asc',
      },
    });

    console.log(`✅ ${parcelas.length} parcelas PREVISTAS encontradas`);

    if (parcelas.length === 0) {
      return res.json({
        competencia: { ano, mes },
        referencia: { ano: anoReferencia, mes: mesReferencia },
        periodo: {
          descricao: `Parcelas previstas para vencimento em ${mesReferencia}/${anoReferencia}`,
        },
        aliquota: {
          id: aliquota.id,
          percentualBp: aliquota.percentualBp,
          percentual: (aliquota.percentualBp / 100).toFixed(2),
          mes: aliquota.mes,
          ano: aliquota.ano,
          avisoAliquota: aliquota.mes !== mes || aliquota.ano !== ano 
            ? `Usando alíquota de ${aliquota.mes}/${aliquota.ano} (alíquota de ${mes}/${ano} não cadastrada)`
            : null,
        },
        items: [],
        totais: {
          bruto: "0.00",
          imposto: "0.00",
          liquido: "0.00",
          escritorio: "0.00",
          fundoReserva: "0.00",
          socios: "0.00",
        },
        mensagem: `Nenhuma parcela prevista para ${mesReferencia}/${anoReferencia}.`,
      });
    }

    // Processar parcelas
    const items = [];
    let totalBruto = 0;
    let totalImposto = 0;
    let totalLiquido = 0;
    let totalEscritorio = 0;
    let totalFundoReserva = 0;
    let totalSocios = 0;

    for (const parcela of parcelas) {
      const contrato = parcela.contrato;
      const valorBruto = Math.round(parseFloat(parcela.valorPrevisto) * 100);

      const imposto = contrato.isentoTributacao
        ? 0
        : Math.round((valorBruto * aliquota.percentualBp) / 10000);

      const liquido = valorBruto - imposto;

      const modelo = contrato.modeloDistribuicao;
      
      if (!modelo || !modelo.itens || modelo.itens.length === 0) {
        console.warn(`⚠️ Contrato ${contrato.numeroContrato} sem modelo de distribuição`);
        continue;
      }

      let escritorio = 0;
      let fundoReserva = 0;
      let socioTotal = 0;

      for (const item of modelo.itens) {
        const valor = Math.round((liquido * item.percentualBp) / 10000);

        if (item.destinoTipo === "ESCRITORIO") {
          escritorio += valor;
        } else if (item.destinoTipo === "FUNDO_RESERVA") {
          fundoReserva += valor;
        } else if (item.destinoTipo === "SOCIO") {
          socioTotal += valor;
        }
      }

      // ✅ CORREÇÃO: PROCESSAR ADVOGADOS COM INDICAÇÃO
      const advogados = [];
 
      // 1. INDICAÇÃO (se houver)
      if (contrato.repasseIndicacaoAdvogado) {
        let percentualIndicacao = 0;
  
        // ✅ CORREÇÃO: Buscar em TODOS os itens do modelo, independente do tipo
        for (const item of modelo.itens) {
          // Aceita qualquer destinoTipo que mencione INDICACAO
          if (
            item.destinoTipo === "INDICACAO" ||
            item.destinoTipo === "INDICACAO_ADVOGADO" ||
            (item.destinoTipo === "SOCIO" && item.destinatario === "INDICACAO") ||
            (item.destinoTipo === "ADVOGADO" && item.destinatario === "INDICACAO")
          ) {
            percentualIndicacao += item.percentualBp;
          }
        }
  
        console.log('🔍 Percentual de indicação encontrado:', {
          advogado: contrato.repasseIndicacaoAdvogado.nome,
          percentualBp: percentualIndicacao,
          percentual: (percentualIndicacao / 100).toFixed(2) + '%',
        });
  
        if (percentualIndicacao > 0) {
          const valorIndicacao = Math.round((liquido * percentualIndicacao) / 10000);
    
          advogados.push({
            advogadoId: contrato.repasseIndicacaoAdvogado.id,
            advogadoNome: contrato.repasseIndicacaoAdvogado.nome,
            advogadoOab: contrato.repasseIndicacaoAdvogado.oab,
            percentualBp: percentualIndicacao,
            valorCentavos: valorIndicacao,
            valorReais: (valorIndicacao / 100).toFixed(2),
            tipo: 'INDICACAO',
          });
        } else {
          console.warn('⚠️ Advogado de indicação definido mas sem percentual no modelo:', {
            contrato: contrato.numeroContrato,
            advogado: contrato.repasseIndicacaoAdvogado.nome,
            modelo: modelo.codigo,
          });
        }
      }

      // 2. SPLITS DE SÓCIOS (se houver)
      if (contrato.usaSplitSocio && contrato.splits && contrato.splits.length > 0) {
        console.log('  👥 SPLITS (calculados sobre o LÍQUIDO):');
    
        for (const split of contrato.splits) {
          const valorAdv = Math.round((liquido * split.percentualBp) / 10000);
    
          console.log(`    - ${split.advogado.nome}:`, {
            percentualSplit: (split.percentualBp / 100).toFixed(2) + '% do líquido',
            valorAdvogado: (valorAdv / 100).toFixed(2),
          });
    
          advogados.push({
            advogadoId: split.advogado.id,
            advogadoNome: split.advogado.nome,
            advogadoOab: split.advogado.oab,
            percentualBp: split.percentualBp,
            valorCentavos: valorAdv,
            valorReais: (valorAdv / 100).toFixed(2),
            tipo: 'SPLIT',
          });
        }
      } 
      // 3. ADVOGADO PRINCIPAL (quando não há splits)
      else if (contrato.repasseAdvogadoPrincipal) {
        // Calcular percentual restante (total sócios - indicação)
        let percentualAdvogadoPrincipal = 0;
        let percentualIndicacaoJaUsado = 0;
  
        for (const item of modelo.itens) {
          if (item.destinoTipo === "SOCIO") {
            if (item.destinatario === "INDICACAO") {
              percentualIndicacaoJaUsado += item.percentualBp;
            } else {
              percentualAdvogadoPrincipal += item.percentualBp;
            }
          }
        }
  
        if (percentualAdvogadoPrincipal > 0) {
          const valorAdvPrincipal = Math.round((liquido * percentualAdvogadoPrincipal) / 10000);
       
          console.log('  👤 ADVOGADO PRINCIPAL:', {
            nome: contrato.repasseAdvogadoPrincipal.nome,
            percentual: (percentualAdvogadoPrincipal / 100).toFixed(2) + '%',
            valorTotal: (valorAdvPrincipal / 100).toFixed(2),
          });
    
          advogados.push({
            advogadoId: contrato.repasseAdvogadoPrincipal.id,
            advogadoNome: contrato.repasseAdvogadoPrincipal.nome,
            advogadoOab: contrato.repasseAdvogadoPrincipal.oab,
            percentualBp: percentualAdvogadoPrincipal,
            valorCentavos: valorAdvPrincipal,
            valorReais: (valorAdvPrincipal / 100).toFixed(2),
            tipo: 'PRINCIPAL',
          });
        }
      }

      items.push({
        parcelaId: parcela.id,
        parcelaNumero: parcela.numero,
        contratoId: contrato.id,
        contratoNumero: contrato.numeroContrato,
        clienteNome: contrato.cliente?.nomeRazaoSocial || "N/A",
        dataVencimento: parcela.vencimento,
        valorBruto: (valorBruto / 100).toFixed(2),
        valorBrutoCentavos: valorBruto,
        aliquotaBp: aliquota.percentualBp,
        aliquotaPercentual: (aliquota.percentualBp / 100).toFixed(2),
        imposto: (imposto / 100).toFixed(2),
        impostoCentavos: imposto,
        liquido: (liquido / 100).toFixed(2),
        liquidoCentavos: liquido,
        escritorio: (escritorio / 100).toFixed(2),
        escritorioCentavos: escritorio,
        fundoReserva: (fundoReserva / 100).toFixed(2),
        fundoReservaCentavos: fundoReserva,
        socioTotal: (socioTotal / 100).toFixed(2),
        socioTotalCentavos: socioTotal,
        advogados,
        isentoTributacao: contrato.isentoTributacao,
      });

      totalBruto += valorBruto;
      totalImposto += imposto;
      totalLiquido += liquido;
      totalEscritorio += escritorio;
      totalFundoReserva += fundoReserva;
      totalSocios += socioTotal;
    }

    console.log(`✅ ${items.length} itens processados`);

    // USER: filtra items para mostrar apenas os que incluem o advogado do usuário
    const roleStrEA = String(req.user?.role || "").toUpperCase();
    let filteredItems = items;
    if (roleStrEA !== "ADMIN") {
      const myAdvIdEA = await getUserAdvogadoId(req.user?.id);
      if (myAdvIdEA) {
        filteredItems = items.filter(it =>
          (it.advogados || []).some(a => a.advogadoId === myAdvIdEA)
        );
      } else {
        filteredItems = [];
      }
    }

    // Recalcular totais com base nos itens filtrados
    let fTotalBruto = 0, fTotalImposto = 0, fTotalLiquido = 0, fTotalEscritorio = 0, fTotalFundoReserva = 0, fTotalSocios = 0;
    for (const it of filteredItems) {
      fTotalBruto += it.valorBrutoCentavos || 0;
      fTotalImposto += it.impostoCentavos || 0;
      fTotalLiquido += it.liquidoCentavos || 0;
      fTotalEscritorio += it.escritorioCentavos || 0;
      fTotalFundoReserva += it.fundoReservaCentavos || 0;
      fTotalSocios += it.socioTotalCentavos || 0;
    }

    res.json({
      competencia: { ano, mes },
      referencia: { ano: anoReferencia, mes: mesReferencia },
      periodo: {
        descricao: `Parcelas previstas para vencimento em ${mesReferencia}/${anoReferencia}`,
      },
      aliquota: {
        id: aliquota.id,
        percentualBp: aliquota.percentualBp,
        percentual: (aliquota.percentualBp / 100).toFixed(2),
        mes: aliquota.mes,
        ano: aliquota.ano,
        avisoAliquota: aliquota.mes !== mes || aliquota.ano !== ano
          ? `Usando alíquota de ${aliquota.mes}/${aliquota.ano} (alíquota de ${mes}/${ano} não cadastrada)`
          : null,
      },
      items: filteredItems,
      totais: {
        bruto: ((roleStrEA !== "ADMIN" ? fTotalBruto : totalBruto) / 100).toFixed(2),
        brutoCentavos: roleStrEA !== "ADMIN" ? fTotalBruto : totalBruto,
        imposto: ((roleStrEA !== "ADMIN" ? fTotalImposto : totalImposto) / 100).toFixed(2),
        impostoCentavos: roleStrEA !== "ADMIN" ? fTotalImposto : totalImposto,
        liquido: ((roleStrEA !== "ADMIN" ? fTotalLiquido : totalLiquido) / 100).toFixed(2),
        liquidoCentavos: roleStrEA !== "ADMIN" ? fTotalLiquido : totalLiquido,
        escritorio: ((roleStrEA !== "ADMIN" ? fTotalEscritorio : totalEscritorio) / 100).toFixed(2),
        escritorioCentavos: roleStrEA !== "ADMIN" ? fTotalEscritorio : totalEscritorio,
        fundoReserva: ((roleStrEA !== "ADMIN" ? fTotalFundoReserva : totalFundoReserva) / 100).toFixed(2),
        fundoReservaCentavos: roleStrEA !== "ADMIN" ? fTotalFundoReserva : totalFundoReserva,
        socios: ((roleStrEA !== "ADMIN" ? fTotalSocios : totalSocios) / 100).toFixed(2),
        sociosCentavos: roleStrEA !== "ADMIN" ? fTotalSocios : totalSocios,
      },
      quantidadeParcelas: filteredItems.length,
    });

  } catch (error) {
    console.error("❌ ERRO em /api/repasses/em-apuracao:", error);
    res.status(500).json({
      message: "Erro ao calcular repasses em apuração.",
      error: error?.message || "Erro desconhecido",
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  }
});

// ============================================================
// 2. A REALIZAR (PARCELAS RECEBIDAS AGRUPADAS - SEM JÁ PAGAS)
// ============================================================
router.get("/api/repasses/a-realizar", authenticate, async (req, res) => {
  try {
    const { ano, mes } = req.query;

    console.log('\n========================================');
    console.log('💰 A REALIZAR - DEBUG');
    console.log('========================================');
    console.log('Competência (M):', { ano, mes });

    if (!ano || Number.isNaN(Number(ano)) || Number(ano) < 2000) {
      return res.status(400).json({ message: "Parâmetro 'ano' inválido." });
    }
    if (!mes || Number.isNaN(Number(mes)) || Number(mes) < 1 || Number(mes) > 12) {
      return res.status(400).json({ message: "Parâmetro 'mes' inválido." });
    }

    const mesReferencia = Number(mes) === 1 ? 12 : Number(mes) - 1;
    const anoReferencia = Number(mes) === 1 ? Number(ano) - 1 : Number(ano);

    console.log('Mês de referência (M-1):', { ano: anoReferencia, mes: mesReferencia });

    // Buscar alíquota
    let aliquota = await prisma.aliquota.findUnique({
      where: { mes_ano: { mes: parseInt(mes), ano: parseInt(ano) } },
    });

    if (!aliquota) {
      console.log('⚠️ Alíquota não encontrada, buscando última...');
      aliquota = await prisma.aliquota.findFirst({
        orderBy: [{ ano: 'desc' }, { mes: 'desc' }],
      });
    }

    if (!aliquota) {
      console.log('❌ NENHUMA alíquota cadastrada');
      return res.json({
        competencia: { ano: Number(ano), mes: Number(mes) },
        referencia: { ano: anoReferencia, mes: mesReferencia },
        items: [],
        alerta: `⚠️ Nenhuma alíquota cadastrada no sistema.`,
      });
    }

    // Buscar IDs das parcelas que JÁ FORAM PAGAS nesta competência
    const parcelasJaPagas = await prisma.repasseLancamento.findMany({
      where: {
        repasseRealizado: {
          competenciaAno: Number(ano),
          competenciaMes: Number(mes),
        },
      },
      select: {
        parcelaId: true,
        advogadoId: true,
      },
    });

    const parcelasJaPagasSet = new Set(
      parcelasJaPagas.map(p => `${p.parcelaId}-${p.advogadoId}`)
    );

    console.log(`🔍 ${parcelasJaPagas.length} lançamentos já pagos nesta competência`);

    // Buscar parcelas RECEBIDAS no mês M-1
    const primeiroDia = new Date(anoReferencia, mesReferencia - 1, 1, 0, 0, 0);
    const ultimoDia = new Date(anoReferencia, mesReferencia, 0, 23, 59, 59);

    console.log('Período de busca (M-1):', {
      de: primeiroDia.toISOString(),
      ate: ultimoDia.toISOString(),
    });

    const parcelas = await prisma.parcelaContrato.findMany({
      where: {
        status: "RECEBIDA",
        excluirDoRepasse: false,
        dataRecebimento: {
          gte: primeiroDia,
          lte: ultimoDia,
        },
      },
      include: {
        contrato: {
          include: {
            cliente: { select: { id: true, nomeRazaoSocial: true } },
            modeloDistribuicao: { include: { itens: { orderBy: { ordem: "asc" } } } },
            splits: { include: { advogado: { select: { id: true, nome: true, oab: true } } } },
            repasseAdvogadoPrincipal: { select: { id: true, nome: true, oab: true } },
            // ✅ CORREÇÃO: INCLUIR ADVOGADO DE INDICAÇÃO
            repasseIndicacaoAdvogado: { select: { id: true, nome: true, oab: true } },
          },
        },
      },
      orderBy: { dataRecebimento: 'asc' },
    });

    console.log(`✅ ${parcelas.length} parcelas RECEBIDAS encontradas`);

    // Carregar overrides de valor de repasse
    const parcelaIdsAR = parcelas.map(p => p.id);
    const overridesAR = parcelaIdsAR.length > 0
      ? await prisma.parcelaRepasseOverride.findMany({ where: { parcelaId: { in: parcelaIdsAR } } })
      : [];
    const overrideMapAR = new Map(overridesAR.map(o => [`${o.parcelaId}-${o.advogadoId}`, o.valorCentavos]));

    // (Não retorna vazio aqui — advogados com parcela fixa podem aparecer sem parcelas)

    // Agrupar por advogado
    const porAdvogado = new Map();
    let parcelasIgnoradas = 0;

    for (const parcela of parcelas) {
      const contrato = parcela.contrato;
      const valorBruto = Math.round(parseFloat(parcela.valorRecebido || parcela.valorPrevisto) * 100);
      const imposto = contrato.isentoTributacao ? 0 : Math.round((valorBruto * aliquota.percentualBp) / 10000);
      const liquido = valorBruto - imposto;

      const modelo = contrato.modeloDistribuicao;
      if (!modelo?.itens?.length) {
        console.warn(`⚠️ Contrato ${contrato.numeroContrato} sem modelo`);
        continue;
      }

      // ✅ CORREÇÃO: PROCESSAR TODOS OS ADVOGADOS (INDICAÇÃO + PRINCIPAL/SPLITS)
      const advogadosDaParcela = [];

      // 1. INDICAÇÃO (se houver)
      if (contrato.repasseIndicacaoAdvogado) {
        let percentualIndicacao = 0;
        
        for (const item of modelo.itens) {
          if (item.destinoTipo === "INDICACAO" || 
              (item.destinoTipo === "SOCIO" && item.destinatario === "INDICACAO")) {
            percentualIndicacao += item.percentualBp;
          }
        }
        
        if (percentualIndicacao > 0) {
          const valorIndicacao = Math.round((liquido * percentualIndicacao) / 10000);
          
          advogadosDaParcela.push({
            advogadoId: contrato.repasseIndicacaoAdvogado.id,
            advogadoNome: contrato.repasseIndicacaoAdvogado.nome,
            advogadoOab: contrato.repasseIndicacaoAdvogado.oab,
            valorCentavos: valorIndicacao,
          });
        }
      }

      // 2. SPLITS ou ADVOGADO PRINCIPAL
      if (contrato.usaSplitSocio && contrato.splits?.length > 0) {
        for (const split of contrato.splits) {
          const valorAdv = Math.round((liquido * split.percentualBp) / 10000);
          advogadosDaParcela.push({
            advogadoId: split.advogado.id,
            advogadoNome: split.advogado.nome,
            advogadoOab: split.advogado.oab,
            valorCentavos: valorAdv,
          });
        }
      } else if (contrato.repasseAdvogadoPrincipal) {
        let percentualAdvogadoPrincipal = 0;
        
        for (const item of modelo.itens) {
          if (item.destinoTipo === "SOCIO" && item.destinatario !== "INDICACAO") {
            percentualAdvogadoPrincipal += item.percentualBp;
          }
        }
        
        if (percentualAdvogadoPrincipal > 0) {
          const valorAdvPrincipal = Math.round((liquido * percentualAdvogadoPrincipal) / 10000);
          
          advogadosDaParcela.push({
            advogadoId: contrato.repasseAdvogadoPrincipal.id,
            advogadoNome: contrato.repasseAdvogadoPrincipal.nome,
            advogadoOab: contrato.repasseAdvogadoPrincipal.oab,
            valorCentavos: valorAdvPrincipal,
          });
        }
      }

      for (const adv of advogadosDaParcela) {
        const chaveParcela = `${parcela.id}-${adv.advogadoId}`;
    
        if (parcelasJaPagasSet.has(chaveParcela)) {
          parcelasIgnoradas++;
          continue;
        }

        if (!porAdvogado.has(adv.advogadoId)) {
          porAdvogado.set(adv.advogadoId, {
            advogadoId: adv.advogadoId,
            advogadoNome: adv.advogadoNome,
            advogadoOab: adv.advogadoOab,

            valorTotalCentavos: 0,        // total exibível (split + fixa somada)
            valorSplitCentavos: 0,        // apenas split (percentual do modelo)

            parcelas: [],
          });
        }

        const registro = porAdvogado.get(adv.advogadoId);

        const overrideValAR = overrideMapAR.get(`${parcela.id}-${adv.advogadoId}`);
        const valorFinalAR = overrideValAR !== undefined ? overrideValAR : adv.valorCentavos;

        registro.valorSplitCentavos += valorFinalAR;
        registro.valorTotalCentavos += valorFinalAR;

        registro.parcelas.push({
          parcelaId: parcela.id,
          contratoId: contrato.id,
          contratoNumero: contrato.numeroContrato,
          clienteNome: contrato.cliente?.nomeRazaoSocial,
          dataRecebimento: parcela.dataRecebimento,
          valorBrutoCentavos: valorBruto,
          valorRepasseCentavos: valorFinalAR,
        });
      }
    }

    // ✅ ADICIONAR INFORMAÇÕES DE SÓCIO + PARCELA FIXA
    console.log('\n👤 Processando informações dos advogados...');

    for (const [advogadoId, registro] of porAdvogado.entries()) {
      const advogado = await prisma.advogado.findUnique({
        where: { id: advogadoId },
        select: {
          ehSocio: true,
          parcelaFixaAtiva: true,
          parcelaFixaNome: true,
          parcelaFixaValor: true,
        },
      });

      if (!advogado) continue;

      registro.ehSocio = advogado.ehSocio;
      registro.descricaoRepasse = advogado.ehSocio
        ? "Antecipação de lucro"
        : "Prestação de serviços";
      registro.parcelaFixaAtiva = advogado.parcelaFixaAtiva;
      registro.parcelaFixaNome = advogado.parcelaFixaNome;
      registro.parcelaFixaValorCentavos = advogado.parcelaFixaValor
        ? Math.round(parseFloat(advogado.parcelaFixaValor) * 100)
        : 0;

      console.log(`  👤 ${registro.advogadoNome}: ${registro.descricaoRepasse}, parcelaFixa=${advogado.parcelaFixaAtiva}`);
    }

    // ✅ INCLUIR ADVOGADOS COM PARCELA FIXA QUE NÃO ESTÃO NO MAP
    const advogadosParcelaFixa = await prisma.advogado.findMany({
      where: { parcelaFixaAtiva: true, ativo: true },
      select: {
        id: true,
        nome: true,
        oab: true,
        ehSocio: true,
        parcelaFixaAtiva: true,
        parcelaFixaNome: true,
        parcelaFixaValor: true,
      },
    });

    for (const adv of advogadosParcelaFixa) {
      if (porAdvogado.has(adv.id)) continue;

      // Verificar se já foi processado nesta competência (SEPARADA ou SOMADA)
      const jaProcessado = await prisma.livroCaixaLancamento.findFirst({
        where: {
          origem: "REPASSES_REALIZADOS",
          referenciaOrigem: {
            in: [
              `PARCELA_FIXA_REPASSE_${adv.id}_${Number(ano)}_${Number(mes)}`,
              `REPASSE_PARCELA_FIXA_SOMADA_${adv.id}_${Number(ano)}_${Number(mes)}`,
            ],
          },
        },
      });
      if (jaProcessado) continue;

      // Verificar se já tem repasse realizado nesta competência
      const jaRealizado = await prisma.repasseRealizado.findFirst({
        where: {
          advogadoId: adv.id,
          competenciaAno: Number(ano),
          competenciaMes: Number(mes),
        },
      });
      if (jaRealizado) continue;

      porAdvogado.set(adv.id, {
        advogadoId: adv.id,
        advogadoNome: adv.nome,
        advogadoOab: adv.oab,
        valorTotalCentavos: 0,
        valorSplitCentavos: 0,
        parcelas: [],
        ehSocio: adv.ehSocio,
        descricaoRepasse: adv.ehSocio ? "Antecipação de lucro" : "Prestação de serviços",
        parcelaFixaAtiva: adv.parcelaFixaAtiva,
        parcelaFixaNome: adv.parcelaFixaNome,
        parcelaFixaValorCentavos: adv.parcelaFixaValor
          ? Math.round(parseFloat(adv.parcelaFixaValor) * 100)
          : 0,
      });

      console.log(`  ➕ ${adv.nome}: adicionado por parcela fixa (sem parcelas regulares)`);
    }

    console.log(`\n📢 ${parcelasIgnoradas} parcelas já pagas (ignoradas)`);

    // Incluir adiantamentos do período no valorTotal
    const adiantamentosPeriodo = await prisma.adiantamentoSocio.findMany({
      where: { competenciaAno: Number(ano), competenciaMes: Number(mes) },
      select: { advogadoId: true, valorAdiantadoCentavos: true },
    });
    for (const adt of adiantamentosPeriodo) {
      const reg = porAdvogado.get(adt.advogadoId);
      if (reg) {
        reg.valorTotalCentavos += adt.valorAdiantadoCentavos;
        reg.adiantamentosCentavos = (reg.adiantamentosCentavos || 0) + adt.valorAdiantadoCentavos;
      }
    }

    const items = Array.from(porAdvogado.values()).map(registro => ({
      advogadoId: registro.advogadoId,
      advogadoNome: registro.advogadoNome,
      advogadoOab: registro.advogadoOab,
      valorTotal: (registro.valorTotalCentavos / 100).toFixed(2),
      adiantamentosCentavos: registro.adiantamentosCentavos || 0,
      quantidadeParcelas: registro.parcelas.length,

      // ✅ Informações de sócio
      ehSocio: registro.ehSocio,
      descricaoRepasse: registro.descricaoRepasse,

      // ✅ Informações de parcela fixa
      parcelaFixaAtiva: registro.parcelaFixaAtiva || false,
      parcelaFixaNome: registro.parcelaFixaNome || null,
      parcelaFixaValorCentavos: registro.parcelaFixaValorCentavos || 0,

      parcelas: registro.parcelas.map(p => ({
        parcelaId: p.parcelaId,
        contratoId: p.contratoId,
        contratoNumero: p.contratoNumero,
        clienteNome: p.clienteNome,
        dataRecebimento: p.dataRecebimento,
        valorBruto: (p.valorBrutoCentavos / 100).toFixed(2),
        valorRepasse: (p.valorRepasseCentavos / 100).toFixed(2),
      })),
    }));

    console.log(`✅ ${items.length} advogados com repasses pendentes`);

    // USER: filtra apenas o próprio advogado
    const roleStrAR = String(req.user?.role || "").toUpperCase();
    let filteredItemsAR = items;
    if (roleStrAR !== "ADMIN") {
      const myAdvIdAR = await getUserAdvogadoId(req.user?.id);
      if (myAdvIdAR) {
        filteredItemsAR = items.filter(it => it.advogadoId === myAdvIdAR);
      } else {
        filteredItemsAR = [];
      }
    }

    res.json({
      competencia: { ano: Number(ano), mes: Number(mes) },
      referencia: { ano: anoReferencia, mes: mesReferencia },
      periodo: { descricao: `Parcelas recebidas em ${mesReferencia}/${anoReferencia}` },
      aliquota: {
        percentual: (aliquota.percentualBp / 100).toFixed(2),
        avisoAliquota: aliquota.mes !== Number(mes) || aliquota.ano !== Number(ano)
          ? `Usando alíquota de ${aliquota.mes}/${aliquota.ano}`
          : null,
      },
      items: filteredItemsAR,
    });

  } catch (error) {
    console.error("❌ ERRO em /api/repasses/a-realizar:", error);
    res.status(500).json({ 
      message: "Erro ao buscar repasses a realizar.",
      error: error?.message || "Erro desconhecido",
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  }
});


// GET /api/repasses/adiantamentos-pendentes?advogadoId=X
router.get("/api/repasses/adiantamentos-pendentes", authenticate, requireAdmin, async (req, res) => {
  try {
    const { advogadoId } = req.query;
    if (!advogadoId) return res.status(400).json({ message: "advogadoId é obrigatório" });
    const adiantamentos = await prisma.adiantamentoSocio.findMany({
      where: { advogadoId: parseInt(advogadoId), quitado: false },
      include: { cliente: { select: { nomeRazaoSocial: true } } },
      orderBy: [{ competenciaAno: "asc" }, { competenciaMes: "asc" }],
    });
    const result = adiantamentos
      .map(a => ({
        id: a.id,
        clienteNome: a.cliente?.nomeRazaoSocial || "—",
        competenciaAno: a.competenciaAno,
        competenciaMes: a.competenciaMes,
        valorAdiantadoCentavos: a.valorAdiantadoCentavos,
        valorDevolvidoCentavos: a.valorDevolvidoCentavos,
        saldoCentavos: a.valorAdiantadoCentavos - a.valorDevolvidoCentavos,
      }))
      .filter(a => a.saldoCentavos > 0);
    res.json(result);
  } catch (e) {
    console.error("❌ Erro ao buscar adiantamentos pendentes:", e);
    res.status(500).json({ message: "Erro ao buscar adiantamentos pendentes" });
  }
});

// ============================================================
// ✅ CORREÇÃO: REALIZAR REPASSE (Status correto das parcelas)
// POST /api/repasses/realizar
// ============================================================

router.post("/api/repasses/realizar", authenticate, requireAdmin, async (req, res) => {
  try {
    const {
      advogadoId,
      ano,
      mes,
      valorEfetivado,
      dataRepasse,
      observacoes,
      contaIdRepasse,
      contaIdParcelaFixa,
      contasSplit,
      confirmarParcelaFixa,
      adiantamentosAbater,
    } = req.body || {};

    // Normalizar split de contas
    const splitArr = Array.isArray(contasSplit) && contasSplit.length > 0
      ? contasSplit.map(s => ({ contaId: parseInt(s.contaId), valorCentavos: parseInt(s.valorCentavos) }))
      : null;

    // Conta efetiva para parcela fixa (fallback: mesma do repasse)
    const contaIdPFInt = contaIdParcelaFixa
      ? parseInt(contaIdParcelaFixa)
      : (contaIdRepasse ? parseInt(contaIdRepasse) : null);

    const confirmarParcelaFixaBool = toBool(confirmarParcelaFixa);

    console.log('========================================');
    console.log('💰 REALIZAR REPASSE');
    console.log('========================================');
    console.log('Dados recebidos:', { advogadoId, ano, mes, valorEfetivado, dataRepasse });

    // Validações básicas
    if (!advogadoId || !ano || !mes) {
      return res.status(400).json({ message: "advogadoId, ano e mes são obrigatórios" });
    }

    // valorEfetivado pode ser 0 para advogados com parcela fixa apenas
    // (neste caso, o repasse regular é zero mas a parcela fixa é processada)

    // Converter valor efetivado (vem em centavos como string de dígitos)
    const valorEfetivadoCentavos = Number(String(valorEfetivado || "0").replace(/\D/g, "")) || 0;

    // Processar abatimentos de adiantamentos
    // valorEfetivadoCentavos = valor TOTAL do repasse (cash + abatimento)
    // cashRepasseCentavos = valor que sai do caixa (LC) = valorEfetivado - abatimento
    const abaterArr = Array.isArray(adiantamentosAbater) && adiantamentosAbater.length > 0
      ? adiantamentosAbater
          .map(a => ({ id: parseInt(a.id), valorAbaterCentavos: parseInt(a.valorAbaterCentavos) }))
          .filter(a => a.id > 0 && a.valorAbaterCentavos > 0)
      : [];
    const valorAbatimentoTotalCentavos = abaterArr.reduce((s, a) => s + a.valorAbaterCentavos, 0);
    const cashRepasseCentavos = valorEfetivadoCentavos - valorAbatimentoTotalCentavos;

    console.log('Valor efetivado total (centavos):', valorEfetivadoCentavos);
    if (valorAbatimentoTotalCentavos > 0) {
      console.log('Abatimento de adiantamentos (centavos):', valorAbatimentoTotalCentavos);
      console.log('Cash a transferir (centavos):', cashRepasseCentavos);
    }

    // 1. Buscar parcelas RECEBIDAS do advogado no período M-1
    const mesReferencia = mes === 1 ? 12 : mes - 1;
    const anoReferencia = mes === 1 ? ano - 1 : ano;

    const primeiroDia = new Date(anoReferencia, mesReferencia - 1, 1, 0, 0, 0);
    const ultimoDia = new Date(anoReferencia, mesReferencia, 0, 23, 59, 59);

    console.log('\n📅 Período de referência (M-1):', {
      mes: mesReferencia,
      ano: anoReferencia,
      de: primeiroDia.toISOString(),
      ate: ultimoDia.toISOString(),
    });

    // Buscar parcelas recebidas
    const parcelas = await prisma.parcelaContrato.findMany({
      where: {
        status: "RECEBIDA",
        dataRecebimento: {
          gte: primeiroDia,
          lte: ultimoDia,
        },
      },
      include: {
        contrato: {
          include: {
            cliente: true,
            modeloDistribuicao: {
              include: { itens: true },
            },
            splits: {
              include: { advogado: true },
            },
            repasseAdvogadoPrincipal: true,
            repasseIndicacaoAdvogado: true,
          },
        },
      },
    });

    console.log(`\n📦 ${parcelas.length} parcelas recebidas encontradas`);

    // Buscar overrides de valor de repasse para as parcelas do período
    const parcelaIdsPost = parcelas.map(p => p.id);
    const overridesPost = parcelaIdsPost.length > 0
      ? await prisma.parcelaRepasseOverride.findMany({ where: { parcelaId: { in: parcelaIdsPost } } })
      : [];
    const overrideMapPost = new Map(overridesPost.map(o => [`${o.parcelaId}-${o.advogadoId}`, o.valorCentavos]));

    // Buscar dados do advogado (incluindo parcela fixa e se é sócio)
    const advogado = await prisma.advogado.findUnique({
      where: { id: parseInt(advogadoId) },
      select: {
        nome: true,
        email: true,
        ativo: true,
        ehSocio: true,
        whatsapp: true,
        telefone: true,
        parcelaFixaAtiva: true,
        parcelaFixaNome: true,
        parcelaFixaValor: true,
        parcelaFixaTipo: true,
      },
    });

    if (!advogado) {
      return res.status(404).json({ message: "Advogado não encontrado" });
    }

    // ✅ Descrição do repasse baseada se é sócio ou não
    const descricaoRepasse = advogado.ehSocio 
      ? "Antecipação de lucro" 
      : "Prestação de serviços";

    
    // ✅ Parcela fixa (tipo pode ser "SEPARADA" ou "SOMADA")
    const parcelaFixaValorCentavos =
      advogado.parcelaFixaAtiva && advogado.parcelaFixaValor
        ? Math.round(parseFloat(advogado.parcelaFixaValor) * 100)
        : 0;

    const parcelaFixaTipoRaw = String(advogado.parcelaFixaTipo || "").toUpperCase().trim();

    const parcelaFixaTipo =
      (parcelaFixaTipoRaw === "SOMADA" ||
      parcelaFixaTipoRaw === "SOMAR" ||
      parcelaFixaTipoRaw === "SOMADO" ||
      parcelaFixaTipoRaw === "SOMA")
        ? "SOMADA"
        : "SEPARADA";

    const parcelaFixaNome =
      String(advogado.parcelaFixaNome || "").trim() || "Parcela Fixa Mensal";

    // Gera empréstimo quando sócio tem parcela fixa desmarcada — há movimento no LC
    const geraEmprestimo = !confirmarParcelaFixaBool && advogado.ehSocio && parcelaFixaValorCentavos > 0 && valorEfetivadoCentavos > 0;
    // Sem movimentação financeira: cash líquido = 0 (inclui caso de abatimento cobrindo tudo)
    const semMovimento = !geraEmprestimo && cashRepasseCentavos <= 0 &&
      (!advogado.parcelaFixaAtiva || parcelaFixaValorCentavos === 0 || !confirmarParcelaFixaBool);
    const dataRepasseDate = parseDDMMYYYYToDate(dataRepasse) ?? (semMovimento ? new Date(ano, mes - 1, 1) : null);
    if (!dataRepasseDate) {
      return res.status(400).json({ message: "Data de repasse inválida (DD/MM/AAAA)" });
    }
    // Rejeitar abatimento maior que o valor efetivado (#15)
    if (cashRepasseCentavos < 0) {
      return res.status(400).json({ message: "Valor de abatimento não pode ser maior que o valor efetivado." });
    }
    if (!semMovimento && !contaIdRepasse && !splitArr) {
      return res.status(400).json({ message: "Informe a conta para o lançamento do repasse." });
    }
    if (splitArr) {
      const splitTotal = splitArr.reduce((s, c) => s + c.valorCentavos, 0);
      const splitEsperado = cashRepasseCentavos; // splits cobrem o cash (sem abatimento)
      if (splitTotal !== splitEsperado) {
        return res.status(400).json({
          message: `Soma das contas (R$${(splitTotal/100).toFixed(2)}) deve ser igual ao valor a transferir (R$${(splitEsperado/100).toFixed(2)})`,
        });
      }
    }

    console.log("------ DEBUG PARCELA FIXA ------");
    console.log("confirmarParcelaFixa:", confirmarParcelaFixa);
    console.log("typeof confirmarParcelaFixa:", typeof confirmarParcelaFixa);
    console.log("parcelaFixaTipo:", parcelaFixaTipo);
    console.log("parcelaFixaValorCentavos:", parcelaFixaValorCentavos);
    console.log("---------------------------------");

    const parcelaFixaSomada =
      parcelaFixaValorCentavos > 0 &&
      parcelaFixaTipo === "SOMADA" &&
      confirmarParcelaFixaBool;

    console.log('\n👤 Advogado:', {
      nome: advogado.nome,
      ehSocio: advogado.ehSocio,
      descricao: descricaoRepasse,
    });

    // 2. Calcular valor previsto para o advogado (inicialização antes da parcela fixa)
    let valorPrevistoTotalCentavos = 0;
    const parcelasDoAdvogado = [];

    // 3. Calcular valor previsto para o advogado
    let aliquota = await prisma.aliquota.findUnique({
      where: { mes_ano: { mes: parseInt(mes), ano: parseInt(ano) } },
    });

    if (!aliquota) {
      aliquota = await prisma.aliquota.findFirst({
        orderBy: [{ ano: 'desc' }, { mes: 'desc' }],
      });
    }

    if (!aliquota) {
      return res.status(400).json({ message: "Nenhuma alíquota cadastrada no sistema" });
    }

    console.log('\n💵 Alíquota:', (aliquota.percentualBp / 100).toFixed(2) + '%');

    for (const parcela of parcelas) {
      const contrato = parcela.contrato;
      const valorBruto = Math.round(parseFloat(parcela.valorRecebido || parcela.valorPrevisto) * 100);
      const imposto = contrato.isentoTributacao ? 0 : Math.round((valorBruto * aliquota.percentualBp) / 10000);
      const liquido = valorBruto - imposto;

      const modelo = contrato.modeloDistribuicao;
      if (!modelo?.itens?.length) continue;

      // 2.1) Percentual de INDICAÇÃO no modelo
      let percentualIndicacaoBp = 0;
      for (const item of modelo.itens) {
        if (
          item.destinoTipo === "INDICACAO" ||
          (item.destinoTipo === "SOCIO" && item.destinatario === "INDICACAO")
        ) {
          percentualIndicacaoBp += item.percentualBp;
        }
      }

      // 2.2) Percentual do ADVOGADO PRINCIPAL (SOCIO sem ser INDICAÇÃO)
      let percentualAdvPrincipalBp = 0;
      for (const item of modelo.itens) {
        if (item.destinoTipo === "SOCIO" && item.destinatario !== "INDICACAO") {
          percentualAdvPrincipalBp += item.percentualBp;
        }
      }

      // Verificar se este advogado recebe dessa parcela (INDICAÇÃO / SPLIT / PRINCIPAL)
      let valorAdvogadoCentavos = 0;
      const advId = parseInt(advogadoId);

      // a) INDICAÇÃO (destinoTipo = INDICACAO)
      if (contrato.repasseIndicacaoAdvogadoId === advId && percentualIndicacaoBp > 0) {
        valorAdvogadoCentavos = Math.round((liquido * percentualIndicacaoBp) / 10000);

      // b) SPLITS (quando usaSplitSocio = true)
      } else if (contrato.usaSplitSocio && contrato.splits?.length > 0) {
        const split = contrato.splits.find(s => s.advogadoId === advId);
        if (split) {
          valorAdvogadoCentavos = Math.round((liquido * split.percentualBp) / 10000);
        }

      // c) ADVOGADO PRINCIPAL (SOCIO “normal”)
      } else if (contrato.repasseAdvogadoPrincipalId === advId && percentualAdvPrincipalBp > 0) {
        valorAdvogadoCentavos = Math.round((liquido * percentualAdvPrincipalBp) / 10000);
      }

      // Aplicar override de valor se existir
      const overrideKey = `${parcela.id}-${advId}`;
      if (overrideMapPost.has(overrideKey)) {
        valorAdvogadoCentavos = overrideMapPost.get(overrideKey);
      }

      if (valorAdvogadoCentavos > 0) {
        valorPrevistoTotalCentavos += valorAdvogadoCentavos;
        parcelasDoAdvogado.push({
          parcelaId: parcela.id,
          contratoId: contrato.id,
          numeroContrato: contrato.numeroContrato,
          clienteNome: contrato.cliente?.nomeRazaoSocial,
          valorBruto,
          imposto,
          liquido,
          valorRepasse: valorAdvogadoCentavos,
        });
      }
    }

    // Adicionar adiantamentos do período ao valor previsto (mesma lógica do a-realizar)
    const adiantamentosPeriodo = await prisma.adiantamentoSocio.findMany({
      where: { advogadoId: parseInt(advogadoId), competenciaAno: parseInt(ano), competenciaMes: parseInt(mes) },
      select: { valorAdiantadoCentavos: true },
    });
    const adiantamentosTotalCentavos = adiantamentosPeriodo.reduce((s, a) => s + a.valorAdiantadoCentavos, 0);
    valorPrevistoTotalCentavos += adiantamentosTotalCentavos;

    console.log('\n💰 Valor previsto total (c/ adiantamentos):', (valorPrevistoTotalCentavos / 100).toFixed(2));
    console.log('💰 Valor efetivado:', (valorEfetivadoCentavos / 100).toFixed(2));

    if (valorPrevistoTotalCentavos === 0 && !advogado.parcelaFixaAtiva) {
      return res.status(400).json({
        message: "Nenhum valor previsto para este advogado nesta competência"
      });
    }

    // 3. Buscar saldo atual do advogado
    const saldoAtual = await prisma.repasseSaldo.findUnique({
      where: { advogadoId: parseInt(advogadoId) },
    });

    const saldoCentavos = saldoAtual?.saldoCentavos || 0;
    console.log('💳 Saldo disponível:', (saldoCentavos / 100).toFixed(2));

    // 4. Validar se pode realizar com o valor informado
    // valorEfetivadoCentavos = total do repasse (cash + abatimento recuperado)
    // Saldo gerado/consumido = diferença entre total efetivado e previsto
    const diferenca = valorEfetivadoCentavos - valorPrevistoTotalCentavos;

    console.log('\n📊 Análise:');
    console.log('Diferença:', (diferenca / 100).toFixed(2));

    if (diferenca > 0) {
      console.log('⚠️ Valor MAIOR que previsto - precisa de saldo');

      if (diferenca > saldoCentavos) {
        return res.status(400).json({
          message: `Saldo insuficiente. Disponível: R$ ${(saldoCentavos / 100).toFixed(2)}. Necessário: R$ ${(diferenca / 100).toFixed(2)}`,
          saldoDisponivel: (saldoCentavos / 100).toFixed(2),
          necessario: (diferenca / 100).toFixed(2),
        });
      }

      console.log('✅ Saldo suficiente para cobrir diferença');
    } else if (diferenca < 0) {
      console.log('✅ Valor MENOR que previsto - gera saldo de', (Math.abs(diferenca) / 100).toFixed(2));
    } else {
      console.log('✅ Valor IGUAL ao previsto - sem alteração de saldo');
    }

    // 5. Executar transação
    
    // ✅ Se o repasse regular é zero, não gravar RepasseRealizado. Processa apenas a parcela fixa.
    if (valorEfetivadoCentavos === 0 && valorPrevistoTotalCentavos === 0 && parcelaFixaValorCentavos > 0) {
      await prisma.$transaction(async (tx) => {
        // reusa a mesma lógica já existente de parcela fixa, com a regra de SOMADA/SEPARADA

        // Conta da parcela fixa (pode ser diferente da conta do repasse)
        const contaIdParcelaFixaLocal = contaIdPFInt;

        if (parcelaFixaSomada) {
          // SOMADA: vira um "repasse" único com a descrição padrão (Antecipação de lucro / Prestação de serviços)
          const refSomada = `REPASSE_PARCELA_FIXA_SOMADA_${parseInt(advogadoId)}_${parseInt(ano)}_${parseInt(mes)}`;
          const jaExiste = await tx.livroCaixaLancamento.findFirst({
            where: { origem: "REPASSES_REALIZADOS", referenciaOrigem: refSomada },
          });
          if (!jaExiste) {
            await tx.livroCaixaLancamento.create({
              data: {
                competenciaAno: parseInt(ano),
                competenciaMes: parseInt(mes),
                data: dataRepasseDate,
                documento: "",
                es: "S",
                clienteFornecedor: advogado.nome,
                historico: `${descricaoRepasse} - Competência ${String(mes).padStart(2, "0")}/${ano}${observacoes ? " - " + observacoes : ""}`,
                valorCentavos: parcelaFixaValorCentavos,
                contaId: contaIdParcelaFixaLocal,
                ordemDia: 0,
                origem: "REPASSES_REALIZADOS",
                status: "OK",
                statusFluxo: "EFETIVADO",
                referenciaOrigem: refSomada,
              },
            });
          }
        } else {
          // SEPARADA: grava como item separado e usa o "nome do cadastro" na coluna Cliente/Fornecedor
          const refParcelaFixa = `PARCELA_FIXA_REPASSE_${parseInt(advogadoId)}_${parseInt(ano)}_${parseInt(mes)}`;
          const jaExisteParcelaFixa = await tx.livroCaixaLancamento.findFirst({
            where: { origem: "REPASSES_REALIZADOS", referenciaOrigem: refParcelaFixa },
          });
          if (!jaExisteParcelaFixa) {
            await tx.livroCaixaLancamento.create({
              data: {
                competenciaAno: parseInt(ano),
                competenciaMes: parseInt(mes),
                data: dataRepasseDate,
                documento: null,
                es: "S",
                clienteFornecedor: advogado.nome,
                historico: `${parcelaFixaNome} - Competência ${String(mes).padStart(2, "0")}/${ano}${observacoes ? " - " + observacoes : ""}`,
                valorCentavos: parcelaFixaValorCentavos,
                contaId: contaIdParcelaFixaLocal,
                ordemDia: 0,
                origem: "REPASSES_REALIZADOS",
                status: "OK",
                statusFluxo: "EFETIVADO",
                referenciaOrigem: refParcelaFixa,
              },
            });
          }
        }
      });

      return res.json({
        message: "Parcela fixa registrada (repasse regular = 0)",
        repasse: {
          id: null,
          advogadoId: Number(advogadoId),
          competencia: { ano: Number(ano), mes: Number(mes) },
          valorPrevisto: "0.00",
          valorEfetivado: "0.00",
          parcelaFixa: (parcelaFixaValorCentavos / 100).toFixed(2),
        },
      });
    }

    const result = await prisma.$transaction(async (tx) => {

      // 5.1. Criar registro de repasse realizado
      const repasseRealizado = await tx.repasseRealizado.create({
        data: {
          advogadoId: parseInt(advogadoId),
          competenciaAno: parseInt(ano),
          competenciaMes: parseInt(mes),
          referenciaAno: parseInt(anoReferencia),
          referenciaMes: parseInt(mesReferencia),
          valorPrevistoTotalCentavos,
          valorEfetivadoCentavos, // total do repasse (cash + abatimento)
          dataRepasse: dataRepasseDate,
          observacoes: observacoes || null,
          descricaoRepasse, // ✅ NOVO
          saldoAnteriorCentavos: saldoCentavos,
          saldoGeradoCentavos: diferenca < 0 ? Math.abs(diferenca) : 0,
          saldoConsumidoCentavos: diferenca > 0 ? diferenca : 0,
          saldoPosteriorCentavos: saldoCentavos - diferenca,
        },
      });

      console.log('\n✅ Repasse registrado:', repasseRealizado.id);

      // 5.2. Criar lançamentos individuais por parcela
      for (const p of parcelasDoAdvogado) {
        await tx.repasseLancamento.create({
          data: {
            repasseRealizado: { connect: { id: repasseRealizado.id } },
            parcela: { connect: { id: p.parcelaId } },
            contrato: { connect: { id: p.contratoId } },
            advogado: { connect: { id: Number(advogadoId) } },
            valorBrutoCentavos: p.valorBruto,
            impostoCentavos: p.imposto,
            liquidoCentavos: p.liquido,
            valorRepasseCentavos: p.valorRepasse,
          },
        });
      }

      console.log(`✅ ${parcelasDoAdvogado.length} lançamentos criados`);

      // 5.3. Atualizar saldo do advogado
      const novoSaldoCentavos = saldoCentavos - diferenca;

      await tx.repasseSaldo.upsert({
        where: { advogadoId: parseInt(advogadoId) },
        update: {
          saldoCentavos: novoSaldoCentavos,
          ultimaAtualizacao: new Date(),
        },
        create: {
          advogadoId: parseInt(advogadoId),
          saldoCentavos: novoSaldoCentavos,
        },
      });

      console.log('✅ Saldo atualizado:', (novoSaldoCentavos / 100).toFixed(2));

      // 5.4. Atualizar adiantamentos abatidos
      for (const ab of abaterArr) {
        const adt = await tx.adiantamentoSocio.findUnique({ where: { id: ab.id } });
        if (!adt) continue;
        const novoDevolvido = adt.valorDevolvidoCentavos + ab.valorAbaterCentavos;
        const quitado = novoDevolvido >= adt.valorAdiantadoCentavos;
        const obsAbatimento = `Abatido R$${(ab.valorAbaterCentavos/100).toFixed(2).replace(".",",")} em Repasse #${repasseRealizado.id} — Competência ${String(parseInt(mes)).padStart(2,"0")}/${ano}`;
        await tx.adiantamentoSocio.update({
          where: { id: ab.id },
          data: {
            valorDevolvidoCentavos: novoDevolvido,
            quitado,
            dataQuitacao: quitado && !adt.dataQuitacao ? new Date() : adt.dataQuitacao,
            observacoes: adt.observacoes ? `${adt.observacoes} | ${obsAbatimento}` : obsAbatimento,
          },
        });
        console.log(`✅ Adiantamento ${ab.id}: abatido R$${(ab.valorAbaterCentavos/100).toFixed(2)}${quitado ? " (QUITADO)" : ""}`);
      }

      // ✅ Coletar parcelas impactadas (vamos processar fora da transação)
      const parcelaIdsUnicos = [...new Set(
        (parcelasDoAdvogado || [])
          .map(p => Number(p?.parcelaId))
          .filter(n => Number.isInteger(n) && n > 0)
      )];

      // ✅ Livro Caixa — criar lançamento(s) do REPASSE
      // Quando usando split de contas, sempre separar parcela fixa SOMADA em LC próprio.
      const pfSomadaSeparar = parcelaFixaSomada && (splitArr || (contaIdParcelaFixa && parseInt(contaIdParcelaFixa) !== parseInt(contaIdRepasse)));
      // LC: usa o cash efetivo (sem abatimento, pois abatimento não gera saída de caixa)
      const totalSaidaRepasseCentavos = cashRepasseCentavos + (parcelaFixaSomada && !pfSomadaSeparar ? parcelaFixaValorCentavos : 0);

      if (totalSaidaRepasseCentavos > 0) {
        console.log('\n📝 Criando lançamento(s) no Livro Caixa...');

        if (splitArr && splitArr.length > 0) {
          // Split: um LC por conta
          for (let si = 0; si < splitArr.length; si++) {
            const sp = splitArr[si];
            const refSplit = `REPASSE_${repasseRealizado.id}_SPLIT_${si}`;
            const jaExiste = await tx.livroCaixaLancamento.findFirst({ where: { origem: "REPASSES_REALIZADOS", referenciaOrigem: refSplit } });
            if (!jaExiste) {
              await tx.livroCaixaLancamento.create({
                data: {
                  competenciaAno: parseInt(ano),
                  competenciaMes: parseInt(mes),
                  data: dataRepasseDate,
                  documento: "RC",
                  es: "S",
                  clienteFornecedor: advogado?.nome || "Advogado",
                  historico: `${descricaoRepasse} - Competência ${String(mes).padStart(2, "0")}/${ano}${observacoes ? " - " + observacoes : ""}`,
                  valorCentavos: sp.valorCentavos,
                  contaId: sp.contaId,
                  ordemDia: 0,
                  origem: "REPASSES_REALIZADOS",
                  status: "OK",
                  statusFluxo: "EFETIVADO",
                  referenciaOrigem: refSplit,
                },
              });
            }
          }
        } else {
          // LC único
          const refRepasseLC = `REPASSE_${repasseRealizado.id}`;
          const jaExisteRepasseLC = await tx.livroCaixaLancamento.findFirst({ where: { origem: "REPASSES_REALIZADOS", referenciaOrigem: refRepasseLC } });
          if (!jaExisteRepasseLC) {
            await tx.livroCaixaLancamento.create({
              data: {
                competenciaAno: parseInt(ano),
                competenciaMes: parseInt(mes),
                data: dataRepasseDate,
                documento: "RC",
                es: "S",
                clienteFornecedor: advogado?.nome || "Advogado",
                historico: `${descricaoRepasse} - Competência ${String(mes).padStart(2, "0")}/${ano}${observacoes ? " - " + observacoes : ""}`,
                valorCentavos: totalSaidaRepasseCentavos,
                contaId: parseInt(contaIdRepasse),
                ordemDia: 0,
                origem: "REPASSES_REALIZADOS",
                status: "OK",
                statusFluxo: "EFETIVADO",
                referenciaOrigem: refRepasseLC,
              },
            });
          }
        }

        console.log(`✅ Livro Caixa: Saída(s) de repasse criada(s)`);
      }

      // Parcela fixa SOMADA que precisa de LC separado (split ativo ou conta diferente)
      if (parcelaFixaSomada && pfSomadaSeparar && parcelaFixaValorCentavos > 0) {
        const refPFSomada = `REPASSE_PARCELA_FIXA_SOMADA_${parseInt(advogadoId)}_${parseInt(ano)}_${parseInt(mes)}`;
        const jaExistePF = await tx.livroCaixaLancamento.findFirst({ where: { origem: "REPASSES_REALIZADOS", referenciaOrigem: refPFSomada } });
        if (!jaExistePF) {
          await tx.livroCaixaLancamento.create({
            data: {
              competenciaAno: parseInt(ano),
              competenciaMes: parseInt(mes),
              data: dataRepasseDate,
              documento: null,
              es: "S",
              clienteFornecedor: advogado.nome,
              historico: `${parcelaFixaNome} - Competência ${String(mes).padStart(2, "0")}/${ano}${observacoes ? " - " + observacoes : ""}`,
              valorCentavos: parcelaFixaValorCentavos,
              contaId: contaIdPFInt,
              ordemDia: 0,
              origem: "REPASSES_REALIZADOS",
              status: "OK",
              statusFluxo: "EFETIVADO",
              referenciaOrigem: refPFSomada,
            },
          });
        }
      }

       // ✅ PARCELA FIXA — processar se advogado tem parcela fixa ativa
      // Se for SOMADA e foi marcada para somar neste repasse, NÃO cria item separado.
      if (advogado.parcelaFixaAtiva && advogado.parcelaFixaValor && !parcelaFixaSomada) {
        const parcelaFixaValorCentavos = Math.round(parseFloat(advogado.parcelaFixaValor) * 100);
        const parcelaFixaNome = advogado.parcelaFixaNome || "Parcela Fixa Mensal";
        const refParcelaFixa = `PARCELA_FIXA_REPASSE_${parseInt(advogadoId)}_${parseInt(ano)}_${parseInt(mes)}`;

        // Verificar se já foi processado
        const jaExisteParcelaFixa = await tx.livroCaixaLancamento.findFirst({
          where: {
            origem: "REPASSES_REALIZADOS",
            referenciaOrigem: refParcelaFixa,
          },
        });

        if (!jaExisteParcelaFixa && parcelaFixaValorCentavos > 0) {
          // Conta da parcela fixa (pode ser diferente da conta do repasse)
          const contaIdParcelaFixaLocal = contaIdPFInt;

          if (confirmarParcelaFixa === true) {
            // 3A. CONFIRMADA — saída simples no Livro Caixa
            await tx.livroCaixaLancamento.create({
              data: {
                competenciaAno: parseInt(ano),
                competenciaMes: parseInt(mes),
                data: dataRepasseDate,
                documento: null,
                es: "S",
                clienteFornecedor: advogado.nome,
                historico: `${parcelaFixaNome} - Competência ${String(mes).padStart(2, "0")}/${ano}${observacoes ? " - " + observacoes : ""}`,
                valorCentavos: parcelaFixaValorCentavos,
                contaId: contaIdParcelaFixaLocal,
                ordemDia: 0,
                origem: "REPASSES_REALIZADOS",
                status: "OK",
                statusFluxo: "EFETIVADO",
                referenciaOrigem: refParcelaFixa,
              },
            });
            console.log(`✅ Parcela Fixa CONFIRMADA: Saída de R$ ${(parcelaFixaValorCentavos / 100).toFixed(2)} criada`);

          } else if (advogado.ehSocio) {
            // 3B. NÃO CONFIRMADA + SÓCIO — saída + entrada (empréstimo)

            // Conta: sempre Caixa Geral
            const contaCaixaGeral = await tx.livroCaixaConta.findFirst({
              where: { nome: { contains: "Caixa Geral", mode: "insensitive" }, ativa: true },
              select: { id: true },
            });
            const contaIdEmprestimo = contaCaixaGeral?.id ?? null;

            // Data: primeiro repasse do mês, ou dia 05
            const primeiroRepasse = await tx.repasseRealizado.findFirst({
              where: { competenciaAno: parseInt(ano), competenciaMes: parseInt(mes) },
              orderBy: { dataRepasse: "asc" },
              select: { dataRepasse: true },
            });
            const dataEmprestimo = primeiroRepasse?.dataRepasse ?? new Date(parseInt(ano), parseInt(mes) - 1, 5);

            await tx.livroCaixaLancamento.create({
              data: {
                competenciaAno: parseInt(ano),
                competenciaMes: parseInt(mes),
                data: dataEmprestimo,
                documento: null,
                es: "S",
                clienteFornecedor: advogado.nome,
                historico: `${parcelaFixaNome} - Competência ${String(mes).padStart(2, "0")}/${ano}`,
                valorCentavos: parcelaFixaValorCentavos,
                contaId: contaIdEmprestimo,
                ordemDia: 0,
                origem: "REPASSES_REALIZADOS",
                status: "OK",
                statusFluxo: "EFETIVADO",
                referenciaOrigem: refParcelaFixa,
              },
            });

            const refEmprestimo = `EMPRESTIMO_SOCIO_${parseInt(advogadoId)}_${parseInt(ano)}_${parseInt(mes)}`;
            await tx.livroCaixaLancamento.create({
              data: {
                competenciaAno: parseInt(ano),
                competenciaMes: parseInt(mes),
                data: dataEmprestimo,
                documento: null,
                es: "E",
                clienteFornecedor: advogado.nome,
                historico: `Empréstimo do sócio para despesas - Competência ${String(mes).padStart(2, "0")}/${ano}`,
                valorCentavos: parcelaFixaValorCentavos,
                contaId: contaIdEmprestimo,
                ordemDia: 0,
                origem: "REPASSES_REALIZADOS",
                status: "OK",
                statusFluxo: "EFETIVADO",
                referenciaOrigem: refEmprestimo,
              },
            });

            // Registrar empréstimo
            await tx.emprestimoSocio.create({
              data: {
                advogadoId: parseInt(advogadoId),
                competenciaAno: parseInt(ano),
                competenciaMes: parseInt(mes),
                valorCentavos: parcelaFixaValorCentavos,
                descricao: "Empréstimo do sócio para despesas",
                dataRegistro: dataEmprestimo,
                referenciaOrigem: refEmprestimo,
              },
            });
            console.log(`✅ Parcela Fixa SÓCIO: Saída + Empréstimo de R$ ${(parcelaFixaValorCentavos / 100).toFixed(2)} criados (conta: ${contaIdEmprestimo}, data: ${dataEmprestimo.toISOString().slice(0,10)})`);

          } else {
            // 3C. NÃO CONFIRMADA + NÃO SÓCIO — adicionar ao saldo
            await tx.repasseSaldo.upsert({
              where: { advogadoId: parseInt(advogadoId) },
              update: {
                saldoCentavos: { increment: parcelaFixaValorCentavos },
                ultimaAtualizacao: new Date(),
              },
              create: {
                advogadoId: parseInt(advogadoId),
                saldoCentavos: parcelaFixaValorCentavos,
              },
            });
            console.log(`✅ Parcela Fixa NÃO-SÓCIO: R$ ${(parcelaFixaValorCentavos / 100).toFixed(2)} adicionado ao saldo`);
          }
        }
      }

      return { repasseRealizado, parcelaIdsUnicos };
    });
    // ✅ 5.4: marcar parcela como REPASSE_EFETUADO quando TODOS estiverem pagos
    // Executado em transação separada para garantir atomicidade (F4 — race condition fix)
    const parcelasParaChecar = result?.parcelaIdsUnicos || [];

    try {
      // Coletar dados fora da transação (leituras)
      const parcelasParaAtualizar = [];
      for (const parcelaId of parcelasParaChecar) {
        const parcelaCompleta = await prisma.parcelaContrato.findUnique({
          where: { id: parcelaId },
          include: {
            contrato: {
              include: {
                splits: true,
                repasseAdvogadoPrincipal: true,
                repasseIndicacaoAdvogado: true,
                modeloDistribuicao: { include: { itens: true } },
              },
            },
          },
        });

        if (!parcelaCompleta) {
          console.log(`⚠️ Parcela ${parcelaId} não encontrada. Pulando.`);
          continue;
        }

        if (parcelaCompleta.status !== "RECEBIDA") {
          console.log(`⚠️ Parcela ${parcelaId} pulada - status atual: ${parcelaCompleta.status}`);
          continue;
        }

        const contrato = parcelaCompleta.contrato;
        const advogadosEsperados = new Set();

        if (contrato?.usaSplitSocio && contrato?.splits?.length > 0) {
          contrato.splits.forEach(s => advogadosEsperados.add(s.advogadoId));
        } else if (contrato?.repasseAdvogadoPrincipalId) {
          advogadosEsperados.add(contrato.repasseAdvogadoPrincipalId);
        }

        // Se o modelo prevê INDICAÇÃO (>0), também exige pagamento da indicação
        const itensModelo = contrato?.modeloDistribuicao?.itens || [];
        let indicacaoBp = 0;
        for (const it of itensModelo) {
          if (
            it.destinoTipo === "INDICACAO" ||
            (it.destinoTipo === "SOCIO" && it.destinatario === "INDICACAO")
          ) {
            indicacaoBp += Number(it.percentualBp || 0);
          }
        }
        if (indicacaoBp > 0 && contrato?.repasseIndicacaoAdvogadoId) {
          advogadosEsperados.add(contrato.repasseIndicacaoAdvogadoId);
        }

        const lancamentosExistentes = await prisma.repasseLancamento.findMany({
          where: { parcelaId },
          select: { advogadoId: true },
        });

        const advogadosPagos = new Set(lancamentosExistentes.map(l => l.advogadoId));
        const todosPagos = [...advogadosEsperados].every(id => advogadosPagos.has(id));

        if (!todosPagos) {
          console.log(`⏳ Parcela ${parcelaId} ainda aguarda pagamento de outros advogados`);
          continue;
        }

        parcelasParaAtualizar.push(parcelaId);
      }

      // Aplicar todas as atualizações em uma única transação
      if (parcelasParaAtualizar.length > 0) {
        await prisma.$transaction(
          parcelasParaAtualizar.map(parcelaId =>
            prisma.parcelaContrato.update({
              where: { id: parcelaId },
              data: { status: "REPASSE_EFETUADO" },
            })
          )
        );
        for (const parcelaId of parcelasParaAtualizar) {
          console.log(`✅ Parcela ${parcelaId} marcada como REPASSE_EFETUADO (todos os advogados pagos)`);
        }
      }
    } catch (e) {
      console.error("❌ Pós-processamento REPASSE_EFETUADO falhou:", e);
      // Não rejeita a resposta — o repasse já foi realizado com sucesso
    }

    console.log('\n========================================');
    console.log('✅ REPASSE REALIZADO COM SUCESSO');
    console.log('========================================\n');

    // Notificar advogado + admins (fire-and-forget)
    {
      const repasse_ = result.repasseRealizado;
      const dadosRepasse = {
        competenciaMes: repasse_.competenciaMes ?? mes,
        competenciaAno: repasse_.competenciaAno ?? ano,
        valorEfetivadoCentavos: repasse_.valorEfetivadoCentavos ?? valorEfetivadoCentavos,
        dataRepasse: dataRepasseDate,
      };
      const subjectRepasse = `✅ Addere — Repasse processado: ${_MESES_PT[dadosRepasse.competenciaMes - 1]} de ${dadosRepasse.competenciaAno} — ${advogado.nome}`;
      (async () => {
        try {
          if (advogado?.ativo && advogado?.email) {
            await sendEmail({
              to: advogado.email,
              subject: subjectRepasse,
              html: buildEmailRepasseRealizado(advogado.nome, dadosRepasse),
            });
          }
          const admins = await prisma.usuario.findMany({
            where: { role: "ADMIN", ativo: true },
            select: { email: true },
          });
          for (const admin of admins) {
            await sendEmail({
              to: admin.email,
              subject: subjectRepasse,
              html: buildEmailRepasseRealizado(advogado.nome, dadosRepasse),
            });
          }
        } catch (e) {
          console.error("❌ E-mail repasse realizado:", e.message);
        }
      })();
    }

    // Retornar dados completos
    const repasse = result.repasseRealizado;

    logAuditoria(req, "REALIZAR_REPASSE", "RepasseRealizado", repasse.id,
      null,
      { advogadoId: repasse.advogadoId, ano: repasse.competenciaAno, mes: repasse.competenciaMes, valorEfetivadoCentavos: repasse.valorEfetivadoCentavos }
    ).catch(() => {});

    // WhatsApp — repasse_realizado para advogado
    ;(async () => {
      try {
        const phone = _waPhone(advogado.telefone);
        if (!phone) return;
        const fmtVal = (c) => (c / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 });
        const mesStr = String(repasse.competenciaMes || mes).padStart(2, "0");
        sendWhatsAppTemplate(phone, "realizado_repasse", "pt_BR", [{
          type: "body",
          parameters: [
            { type: "text", text: advogado.nome },
            { type: "text", text: mesStr },
            { type: "text", text: String(repasse.competenciaAno || ano) },
            { type: "text", text: fmtVal(repasse.valorEfetivadoCentavos) },
          ],
        }]).catch(() => {});
      } catch (_) {}
    })();

    res.json({
      message: "Repasse realizado com sucesso",
      repasse: {
        id: repasse.id,
        advogadoId: repasse.advogadoId,
        competencia: { ano: repasse.competenciaAno, mes: repasse.competenciaMes },
        referencia: { ano: repasse.referenciaAno, mes: repasse.referenciaMes },
        valorPrevisto: (repasse.valorPrevistoTotalCentavos / 100).toFixed(2),
        valorEfetivado: (repasse.valorEfetivadoCentavos / 100).toFixed(2),
        dataRepasse: repasse.dataRepasse,
        saldoAnterior: (repasse.saldoAnteriorCentavos / 100).toFixed(2),
        saldoGerado: (repasse.saldoGeradoCentavos / 100).toFixed(2),
        saldoConsumido: (repasse.saldoConsumidoCentavos / 100).toFixed(2),
        saldoPosterior: (repasse.saldoPosteriorCentavos / 100).toFixed(2),
        quantidadeParcelas: parcelasDoAdvogado.length,
      },
    });
  } catch (error) {
    console.error("❌ ERRO ao realizar repasse:", error);
    res.status(500).json({
      message: "Erro ao realizar repasse",
      error: error?.message || "Erro desconhecido",
    });
  }
});

// ============================================================
// 🔍 ENDPOINT DE DEBUG - Status de Parcelas
// Adicione temporariamente ao server.js para investigar
// ============================================================

router.get("/api/debug/parcelas-status", authenticate, async (req, res) => {
  try {
    const { contratoId, parcelaId } = req.query;

    const where = {};
    
    if (contratoId) {
      where.contratoId = parseInt(contratoId);
    }
    
    if (parcelaId) {
      where.id = parseInt(parcelaId);
    }

    const parcelas = await prisma.parcelaContrato.findMany({
      where,
      include: {
        contrato: {
          select: {
            numeroContrato: true,
            usaSplitSocio: true,
            splits: {
              include: {
                advogado: {
                  select: { id: true, nome: true },
                },
              },
            },
            repasseAdvogadoPrincipalId: true,
            repasseAdvogadoPrincipal: {
              select: { id: true, nome: true },
            },
          },
        },
      },
      orderBy: { numero: 'asc' },
    });

    const resultado = [];

    // ✅ CORREÇÃO: DECLARAR ANTES DE USAR
    let valorPrevistoTotalCentavos = 0;
    const parcelasDoAdvogado = [];

    for (const parcela of parcelas) {
      const contrato = parcela.contrato;

      // Identificar advogados esperados
      const advogadosEsperados = [];
      
      if (contrato.usaSplitSocio && contrato.splits?.length > 0) {
        contrato.splits.forEach(s => {
          advogadosEsperados.push({
            id: s.advogadoId,
            nome: s.advogado.nome,
          });
        });
      } else if (contrato.repasseAdvogadoPrincipal) {
        advogadosEsperados.push({
          id: contrato.repasseAdvogadoPrincipal.id,
          nome: contrato.repasseAdvogadoPrincipal.nome,
        });
      }

      // Buscar lançamentos de repasse
      const lancamentos = await prisma.repasseLancamento.findMany({
        where: { parcelaId: parcela.id },
        include: {
          advogado: {
            select: { id: true, nome: true },
          },
          repasseRealizado: {
            select: { 
              id: true, 
              dataRepasse: true,
              competenciaAno: true,
              competenciaMes: true,
            },
          },
        },
      });

      const advogadosPagos = lancamentos.map(l => ({
        id: l.advogadoId,
        nome: l.advogado.nome,
        dataRepasse: l.repasseRealizado.dataRepasse,
        competencia: `${l.repasseRealizado.competenciaMes}/${l.repasseRealizado.competenciaAno}`,
      }));

      const todosPagos = advogadosEsperados.every(esperado => 
        advogadosPagos.some(pago => pago.id === esperado.id)
      );

      resultado.push({
        parcelaId: parcela.id,
        parcelaNumero: parcela.numero,
        contratoNumero: contrato.numeroContrato,
        statusAtual: parcela.status,
        statusCorreto: parcela.status === "RECEBIDA" 
          ? "RECEBIDA (aguardando repasse)"
          : parcela.status === "REPASSE_EFETUADO"
          ? "REPASSE_EFETUADO (todos pagos)"
          : parcela.status,
        dataRecebimento: parcela.dataRecebimento,
        valorRecebido: parcela.valorRecebido,
        advogadosEsperados: advogadosEsperados.length,
        advogadosPagos: advogadosPagos.length,
        todosPagos,
        detalheAdvogados: {
          esperados: advogadosEsperados,
          pagos: advogadosPagos,
        },
        acaoNecessaria: parcela.status === "PREVISTA" && parcela.valorRecebido 
          ? "⚠️ ERRO: Status PREVISTA mas tem valorRecebido"
          : parcela.status === "RECEBIDA" && todosPagos
          ? "⚠️ Deveria ser REPASSE_EFETUADO"
          : parcela.status === "REPASSE_EFETUADO" && !todosPagos
          ? "⚠️ ERRO: REPASSE_EFETUADO mas nem todos pagos"
          : "✅ Status correto",
      });
    }

    res.json({
      total: resultado.length,
      parcelas: resultado,
    });

  } catch (error) {
    console.error("❌ Erro no debug:", error);
    res.status(500).json({ 
      message: "Erro ao debugar parcelas",
      error: error?.message 
    });
  }
});

// ============================================================
// 🔧 ENDPOINT DE CORREÇÃO - Corrigir status de parcelas
// ============================================================

router.post("/api/debug/corrigir-status-parcelas", authenticate, requireAdmin, async (req, res) => {
  try {
    const { dryRun = true } = req.body;

    console.log('\n========================================');
    console.log('🔧 CORRIGIR STATUS DE PARCELAS');
    console.log('========================================');
    console.log('Modo:', dryRun ? 'SIMULAÇÃO' : '⚠️ APLICAR MUDANÇAS');

    // Buscar todas as parcelas RECEBIDAS
    const parcelas = await prisma.parcelaContrato.findMany({
      where: {
        status: "RECEBIDA",
      },
      include: {
        contrato: {
          include: {
            splits: true,
            repasseAdvogadoPrincipal: true,
          },
        },
      },
    });

    console.log(`\n📦 ${parcelas.length} parcelas RECEBIDAS encontradas`);

    const correcoes = [];

    for (const parcela of parcelas) {
      const contrato = parcela.contrato;

      // Identificar advogados esperados
      const advogadosEsperados = new Set();

      if (contrato.usaSplitSocio && contrato.splits?.length > 0) {
        contrato.splits.forEach(s => advogadosEsperados.add(s.advogadoId));
      } else if (contrato.repasseAdvogadoPrincipalId) {
        advogadosEsperados.add(contrato.repasseAdvogadoPrincipalId);
      }

      // Verificar quais já foram pagos
      const lancamentos = await prisma.repasseLancamento.findMany({
        where: { parcelaId: parcela.id },
        select: { advogadoId: true },
      });

      const advogadosPagos = new Set(lancamentos.map(l => l.advogadoId));

      // Se todos foram pagos, deveria ser REPASSE_EFETUADO
      const todosPagos = [...advogadosEsperados].every(id => advogadosPagos.has(id));

      if (todosPagos && advogadosEsperados.size > 0) {
        correcoes.push({
          parcelaId: parcela.id,
          contratoNumero: contrato.numeroContrato,
          parcelaNumero: parcela.numero,
          statusAtual: "RECEBIDA",
          statusCorreto: "REPASSE_EFETUADO",
          advogadosEsperados: advogadosEsperados.size,
          advogadosPagos: advogadosPagos.size,
        });

        console.log(`\n🔄 Parcela ${parcela.id} (Contrato ${contrato.numeroContrato}):`);
        console.log('  Status atual: RECEBIDA');
        console.log('  Status correto: REPASSE_EFETUADO');
        console.log(`  Advogados: ${advogadosPagos.size}/${advogadosEsperados.size} pagos`);
      }
    }

    console.log(`\n📊 RESUMO:`);
    console.log(`Total de correções necessárias: ${correcoes.length}`);

    if (!dryRun && correcoes.length > 0) {
      console.log('\n⚠️ APLICANDO CORREÇÕES...');

      for (const corr of correcoes) {
        await prisma.parcelaContrato.update({
          where: { id: corr.parcelaId },
          data: { status: "REPASSE_EFETUADO" },
        });
      }

      console.log('✅ Correções aplicadas com sucesso!');
    }

    res.json({
      modo: dryRun ? 'SIMULAÇÃO' : 'APLICADO',
      correcoes: correcoes.length,
      detalhes: correcoes,
      aviso: dryRun 
        ? 'Esta foi uma simulação. Para aplicar, envie dryRun: false'
        : 'Correções aplicadas! Recarregue as páginas de contratos.',
    });

  } catch (error) {
    console.error("❌ Erro ao corrigir:", error);
    res.status(500).json({ 
      message: "Erro ao corrigir status",
      error: error?.message 
    });
  }
});

/**
 * ✅ CONSULTAR SALDOS DE ADVOGADOS
 * GET /api/repasses/saldos
 * 
 * Query params:
 * - advogadoId?: number (filtrar por advogado)
 */
router.get("/api/repasses/saldos", authenticate, async (req, res) => {
  try {
    let { advogadoId } = req.query;

    // USER: forçar filtro pelo próprio advogado
    const roleStrSL = String(req.user?.role || "").toUpperCase();
    if (roleStrSL !== "ADMIN") {
      const myAdvIdSL = await getUserAdvogadoId(req.user?.id);
      if (!myAdvIdSL) return res.json({ saldos: [] });
      advogadoId = String(myAdvIdSL);
    }

    const where = {};
    if (advogadoId) {
      where.advogadoId = parseInt(advogadoId);
    }

    const saldos = await prisma.repasseSaldo.findMany({
      where,
      include: {
        advogado: {
          select: {
            id: true,
            nome: true,
            oab: true,
            email: true,
          },
        },
      },
      orderBy: { saldoCentavos: 'desc' },
    });

    res.json({
      saldos: saldos.map(s => ({
        advogadoId: s.advogadoId,
        advogadoNome: s.advogado.nome,
        advogadoOab: s.advogado.oab,
        saldo: (s.saldoCentavos / 100).toFixed(2),
        saldoCentavos: s.saldoCentavos,
        ultimaAtualizacao: s.ultimaAtualizacao,
      })),
      totalSaldo: (saldos.reduce((sum, s) => sum + s.saldoCentavos, 0) / 100).toFixed(2),
    });

  } catch (error) {
    console.error("❌ Erro ao buscar saldos:", error);
    res.status(500).json({ message: "Erro ao buscar saldos" });
  }
});

/**
 * ✅ FINANÇAS DO ADVOGADO (saldo + empréstimos + adiantamentos)
 * GET /api/repasses/minha-financas
 * Acessível a qualquer usuário autenticado; força advogadoId próprio para não-admin.
 */
router.get("/api/repasses/minha-financas", authenticate, async (req, res) => {
  try {
    const roleStr = String(req.user?.role || "").toUpperCase();
    let advogadoId;
    if (roleStr === "ADMIN") {
      const qId = req.query.advogadoId;
      if (!qId) return res.status(400).json({ message: "advogadoId é obrigatório para admin" });
      advogadoId = parseInt(qId);
    } else {
      advogadoId = await getUserAdvogadoId(req.user?.id);
      if (!advogadoId) return res.status(404).json({ message: "Advogado não encontrado para este usuário" });
    }

    // 1) Saldo
    const saldoRec = await prisma.repasseSaldo.findFirst({ where: { advogadoId } });
    const saldoCentavos = saldoRec?.saldoCentavos ?? 0;

    // 2) Empréstimos pendentes
    const emprestimos = await prisma.emprestimoSocio.findMany({
      where: { advogadoId, quitado: false },
      select: { valorCentavos: true, valorPagoCentavos: true },
    });
    const emprestimosCentavos = emprestimos.reduce((sum, e) => sum + Math.max(0, e.valorCentavos - (e.valorPagoCentavos || 0)), 0);

    // 3) Adiantamentos pendentes
    const adiantamentos = await prisma.adiantamentoSocio.findMany({
      where: { advogadoId, quitado: false },
      select: { valorAdiantadoCentavos: true, valorDevolvidoCentavos: true },
    });
    const adiantamentosCentavos = adiantamentos.reduce((sum, a) => sum + Math.max(0, a.valorAdiantadoCentavos - (a.valorDevolvidoCentavos || 0)), 0);

    // Empréstimo: crédito do advogado sobre o escritório → soma ao balanço
    // Adiantamento: crédito do escritório sobre o advogado → subtrai do balanço
    const balanceCentavos = saldoCentavos + emprestimosCentavos - adiantamentosCentavos;

    res.json({
      saldoCentavos,
      saldo: (saldoCentavos / 100).toFixed(2),
      emprestimosCentavos,
      emprestimos: (emprestimosCentavos / 100).toFixed(2),
      adiantamentosCentavos,
      adiantamentos: (adiantamentosCentavos / 100).toFixed(2),
      balanceCentavos,
      balance: (balanceCentavos / 100).toFixed(2),
      ultimaAtualizacao: saldoRec?.ultimaAtualizacao ?? null,
    });
  } catch (error) {
    console.error("❌ Erro em /api/repasses/minha-financas:", error);
    res.status(500).json({ message: "Erro ao buscar finanças do advogado" });
  }
});

/**
 * ✅ HISTÓRICO DE MOVIMENTAÇÕES DE SALDO
 * GET /api/repasses/saldos/:advogadoId/historico
 */
router.get("/api/repasses/saldos/:advogadoId/historico", authenticate, async (req, res) => {
  try {
    let { advogadoId } = req.params;
    const { ano, mes } = req.query;

    // USER: forçar acesso apenas ao próprio advogado
    const roleStrHist = String(req.user?.role || "").toUpperCase();
    if (roleStrHist !== "ADMIN") {
      const myAdvIdHist = await getUserAdvogadoId(req.user?.id);
      if (!myAdvIdHist || parseInt(advogadoId) !== myAdvIdHist) {
        return res.status(403).json({ message: "Acesso negado." });
      }
    }

    const where = {
      advogadoId: parseInt(advogadoId),
    };

    if (ano) {
      where.competenciaAno = parseInt(ano);
    }

    if (mes) {
      where.competenciaMes = parseInt(mes);
    }

    const historico = await prisma.repasseRealizado.findMany({
      where,
      orderBy: { dataRepasse: 'desc' },
      include: {
        advogado: {
          select: { id: true, nome: true, oab: true },
        },
        lancamentos: {
          include: {
            contrato: {
              select: { numeroContrato: true },
            },
            parcela: {
              select: { numero: true },
            },
          },
        },
      },
    });

    res.json({
      advogadoId: parseInt(advogadoId),
      historico: historico.map(h => ({
        id: h.id,
        competencia: { ano: h.competenciaAno, mes: h.competenciaMes },
        referencia: { ano: h.referenciaAno, mes: h.referenciaMes },
        dataRepasse: h.dataRepasse,
        valorPrevisto: (h.valorPrevistoTotalCentavos / 100).toFixed(2),
        valorEfetivado: (h.valorEfetivadoCentavos / 100).toFixed(2),
        saldoAnterior: (h.saldoAnteriorCentavos / 100).toFixed(2),
        saldoGerado: (h.saldoGeradoCentavos / 100).toFixed(2),
        saldoConsumido: (h.saldoConsumidoCentavos / 100).toFixed(2),
        saldoPosterior: (h.saldoPosteriorCentavos / 100).toFixed(2),
        observacoes: h.observacoes,
        quantidadeParcelas: h.lancamentos.length,
      })),
    });

  } catch (error) {
    console.error("❌ Erro ao buscar histórico:", error);
    res.status(500).json({ message: "Erro ao buscar histórico" });
  }
});

/**
 * ✅ DETALHAMENTO DE LANÇAMENTOS DE UM REPASSE
 * GET /api/repasses/:repasseId/lancamentos
 */
router.get("/api/repasses/:repasseId/lancamentos", authenticate, async (req, res) => {
  try {
    const { repasseId } = req.params;

    const repasse = await prisma.repasseRealizado.findUnique({
      where: { id: parseInt(repasseId) },
      include: {
        advogado: {
          select: { id: true, nome: true, oab: true },
        },
        lancamentos: {
          include: {
            contrato: {
              include: {
                cliente: {
                  select: { nomeRazaoSocial: true },
                },
              },
            },
            parcela: {
              select: { numero: true, dataRecebimento: true },
            },
          },
          orderBy: { id: 'asc' },
        },
      },
    });

    if (!repasse) {
      return res.status(404).json({ message: "Repasse não encontrado" });
    }

    // USER: restringe ao próprio advogado
    const roleStrRL = String(req.user?.role || "").toUpperCase();
    if (roleStrRL !== "ADMIN") {
      const myAdvIdRL = await getUserAdvogadoId(req.user?.id);
      if (!myAdvIdRL || repasse.advogadoId !== myAdvIdRL) {
        return res.status(403).json({ message: "Acesso negado." });
      }
    }

    res.json({
      repasse: {
        id: repasse.id,
        advogadoNome: repasse.advogado.nome,
        competencia: { ano: repasse.competenciaAno, mes: repasse.competenciaMes },
        referencia: { ano: repasse.referenciaAno, mes: repasse.referenciaMes },
        dataRepasse: repasse.dataRepasse,
        valorPrevisto: (repasse.valorPrevistoTotalCentavos / 100).toFixed(2),
        valorEfetivado: (repasse.valorEfetivadoCentavos / 100).toFixed(2),
      },
      lancamentos: repasse.lancamentos.map(l => ({
        id: l.id,
        contratoNumero: l.contrato.numeroContrato,
        clienteNome: l.contrato.cliente?.nomeRazaoSocial,
        parcelaNumero: l.parcela.numero,
        dataRecebimento: l.parcela.dataRecebimento,
        valorBruto: (l.valorBrutoCentavos / 100).toFixed(2),
        imposto: (l.impostoCentavos / 100).toFixed(2),
        liquido: (l.liquidoCentavos / 100).toFixed(2),
        valorRepasse: (l.valorRepasseCentavos / 100).toFixed(2),
      })),
    });

  } catch (error) {
    console.error("❌ Erro ao buscar lançamentos:", error);
    res.status(500).json({ message: "Erro ao buscar lançamentos" });
  }
});

// ============================================================
// COMPETÊNCIAS DE REPASSE
// ============================================================

/**
 * GET /api/repasses/competencias
 * Lista todas as competências (mês/ano de repasse)
 */
router.get("/api/repasses/competencias", authenticate, async (req, res) => {
  try {
    const competencias = await prisma.repasseCompetencia.findMany({
      orderBy: [{ ano: "desc" }, { mes: "desc" }],
      include: {
        _count: {
          select: {
            linhas: true,
            pagamentos: true,
          },
        },
      },
    });

    // Calcular totais por competência
    const competenciasComTotais = await Promise.all(
      competencias.map(async (comp) => {
        const linhas = await prisma.repasseLinha.findMany({
          where: { competenciaId: comp.id },
        });

        const totalBruto = linhas.reduce((sum, l) => sum + l.valorBrutoCentavos, 0);
        const totalLiquido = linhas.reduce((sum, l) => sum + l.liquidoCentavos, 0);

        return {
          ...comp,
          totais: {
            bruto: (totalBruto / 100).toFixed(2),
            liquido: (totalLiquido / 100).toFixed(2),
            parcelas: linhas.length,
          },
        };
      })
    );

    res.json(competenciasComTotais);
  } catch (error) {
    console.error("Erro ao listar competências:", error);
    res.status(500).json({ message: "Erro ao listar competências" });
  }
});

/**
 * POST /api/repasses/competencias
 * Cria uma nova competência (mês de apuração)
 */
router.post("/api/repasses/competencias", authenticate, requireAdmin, async (req, res) => {
  try {
    const { mes, ano } = req.body;

    if (!mes || !ano) {
      return res.status(400).json({ message: "Mês e ano são obrigatórios" });
    }

    if (mes < 1 || mes > 12) {
      return res.status(400).json({ message: "Mês deve estar entre 1 e 12" });
    }

    const existente = await prisma.repasseCompetencia.findUnique({
      where: {
        ano_mes: {
          ano: parseInt(ano),
          mes: parseInt(mes),
        },
      },
    });

    if (existente) {
      return res.status(400).json({
        message: "Já existe uma competência para este mês/ano",
      });
    }

    const competencia = await prisma.repasseCompetencia.create({
      data: {
        mes: parseInt(mes),
        ano: parseInt(ano),
      },
    });

    res.status(201).json(competencia);
  } catch (error) {
    console.error("Erro ao criar competência:", error);
    res.status(500).json({ message: "Erro ao criar competência" });
  }
});

// ============================================================
// APURAÇÃO DE REPASSES (Linhas de Repasse)
// ============================================================

/**
 * GET /api/repasses/competencias/:competenciaId/linhas
 * Lista linhas de repasse de uma competência
 */
router.get("/api/repasses/competencias/:competenciaId/linhas", authenticate, async (req, res) => {
  try {
    const { competenciaId } = req.params;

    const linhas = await prisma.repasseLinha.findMany({
      where: { competenciaId: parseInt(competenciaId) },
      include: {
        contrato: {
          include: {
            cliente: true,
          },
        },
        parcela: true,
        advogados: {
          include: {
            advogado: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    res.json(linhas);
  } catch (error) {
    console.error("Erro ao listar linhas:", error);
    res.status(500).json({ message: "Erro ao listar linhas de repasse" });
  }
});

/**
 * POST /api/repasses/apurar
 * Apura repasses de parcelas recebidas em um período
 */
router.post("/api/repasses/apurar", authenticate, requireAdmin, async (req, res) => {
  try {
    const { competenciaId, dataInicio, dataFim } = req.body;

    if (!competenciaId) {
      return res.status(400).json({ message: "Competência é obrigatória" });
    }

    const competencia = await prisma.repasseCompetencia.findUnique({
      where: { id: parseInt(competenciaId) },
    });

    if (!competencia) {
      return res.status(404).json({ message: "Competência não encontrada" });
    }

    if (competencia.fechadaEm) {
      return res.status(400).json({ message: "Competência já está fechada" });
    }

    const aliquota = await prisma.aliquota.findUnique({
      where: {
        mes_ano: {
          mes: competencia.mes,
          ano: competencia.ano,
        },
      },
    });

    if (!aliquota) {
      return res.status(400).json({
        message: `Alíquota não configurada para ${competencia.mes}/${competencia.ano}`,
      });
    }

    const where = {
      status: "RECEBIDA",
      dataRecebimento: {},
    };

    if (dataInicio) {
      where.dataRecebimento.gte = new Date(dataInicio);
    }

    if (dataFim) {
      where.dataRecebimento.lte = new Date(dataFim);
    }

    const parcelas = await prisma.parcelaContrato.findMany({
      where,
      include: {
        contrato: {
          include: {
            modeloDistribuicao: {
              include: {
                itens: {
                  orderBy: { ordem: "asc" },
                },
              },
            },
            splits: {
              include: {
                advogado: true,
              },
            },
            repasseAdvogadoPrincipal: true,
          },
        },
      },
    });

    if (!parcelas.length) {
      return res.json({
        message: "Nenhuma parcela recebida no período",
        linhasCriadas: 0,
      });
    }

    const linhasCriadas = [];
    const advogadosTotais = new Map(); // advogadoId → { valorCentavos, qtd }

    for (const parcela of parcelas) {
      const existe = await prisma.repasseLinha.findFirst({
        where: {
          parcelaId: parcela.id,
          competenciaId: competencia.id,
        },
      });

      if (existe) continue;

      const contrato = parcela.contrato;
      const valorBruto = Math.round(parseFloat(parcela.valorRecebido || parcela.valorPrevisto) * 100);

      const imposto = contrato.isentoTributacao
        ? 0
        : Math.round((valorBruto * aliquota.percentualBp) / 10000);

      const liquido = valorBruto - imposto;

      const modelo = contrato.modeloDistribuicao;
      if (!modelo || !modelo.itens || !modelo.itens.length) {
        continue;
      }

      let escritorio = 0;
      let fundoReserva = 0;
      let socioTotal = 0;

      for (const item of modelo.itens) {
        const valor = Math.round((liquido * item.percentualBp) / 10000);

        if (item.destinoTipo === "ESCRITORIO") {
          escritorio += valor;
        } else if (item.destinoTipo === "FUNDO_RESERVA") {
          fundoReserva += valor;
        } else if (item.destinoTipo === "SOCIO") {
          socioTotal += valor;
        }
      }

      // Transação por parcela — garante atomicidade entre linha e lançamentos de advogados
      const { linha, advogadosRepasse } = await prisma.$transaction(async (tx) => {
        const linha = await tx.repasseLinha.create({
          data: {
            competenciaId: competencia.id,
            contratoId: contrato.id,
            parcelaId: parcela.id,
            valorBrutoCentavos: valorBruto,
            aliquotaUsadaBp: aliquota.percentualBp,
            impostoCentavos: imposto,
            liquidoCentavos: liquido,
            escritorioCentavos: escritorio,
            fundoReservaCentavos: fundoReserva,
            socioTotalCentavos: socioTotal,
          },
        });

        const advogadosRepasse = [];

        if (contrato.usaSplitSocio && contrato.splits.length > 0) {
          for (const split of contrato.splits) {
            const valorAdv = Math.round((liquido * split.percentualBp) / 10000);
            advogadosRepasse.push({
              repasseLinhaId: linha.id,
              advogadoId: split.advogadoId,
              percentualBp: split.percentualBp,
              valorCentavos: valorAdv,
            });
          }
        } else if (contrato.repasseAdvogadoPrincipalId) {
          advogadosRepasse.push({
            repasseLinhaId: linha.id,
            advogadoId: contrato.repasseAdvogadoPrincipalId,
            percentualBp: 10000,
            valorCentavos: socioTotal,
          });
        }

        if (advogadosRepasse.length > 0) {
          await tx.repasseLinhaAdvogado.createMany({ data: advogadosRepasse });
        }

        return { linha, advogadosRepasse };
      });

      linhasCriadas.push(linha);

      // Acumular totais por advogado para notificação
      for (const adv of advogadosRepasse) {
        const key = adv.advogadoId;
        const existing = advogadosTotais.get(key) || { valorCentavos: 0, qtd: 0 };
        advogadosTotais.set(key, { valorCentavos: existing.valorCentavos + adv.valorCentavos, qtd: existing.qtd + 1 });
      }
    }

    res.json({
      message: `${linhasCriadas.length} linhas de repasse criadas com sucesso`,
      linhasCriadas: linhasCriadas.length,
      competencia,
    });

    // Notificar advogados com participação na apuração (fire-and-forget)
    if (advogadosTotais.size > 0) {
      (async () => {
        try {
          const ids = [...advogadosTotais.keys()];
          const advogadosDados = await prisma.advogado.findMany({
            where: { id: { in: ids } },
            select: { id: true, nome: true, email: true, whatsapp: true, telefone: true, ativo: true },
          });
          for (const adv of advogadosDados) {
            if (!adv.ativo) continue;
            const totais = advogadosTotais.get(adv.id);
            const fmtMesComp = `${String(competencia.mes).padStart(2, "0")}/${competencia.ano}`;
            const fmtValor = (totais.valorCentavos / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, style: "currency", currency: "BRL" });

            // E-mail
            if (adv.email) {
              await sendEmail({
                to: adv.email,
                subject: `📊 Addere — Apuração de repasse: ${_MESES_PT[competencia.mes - 1]} de ${competencia.ano}`,
                html: buildEmailApuracaoAdvogado(adv.nome, {
                  mes: competencia.mes,
                  ano: competencia.ano,
                  valorLiquidoCentavos: totais.valorCentavos,
                  qtdParcelas: totais.qtd,
                }),
              });
            }

            // WhatsApp
            const waPhone = _waPhone(adv.whatsapp || adv.telefone);
            if (waPhone) {
              try {
                await sendWhatsAppStrict(waPhone,
                  `📊 *Repasse apurado — ${fmtMesComp}*\n\nOlá, *${adv.nome}*! O seu repasse referente à competência *${fmtMesComp}* foi apurado.\n\nValor previsto: *${fmtValor}*\n\nPara consultar detalhes, envie qualquer mensagem para este número.`
                );
              } catch {
                // Fora da janela 24h → usa template proativo
                await sendWhatsAppTemplate(waPhone, "previsao_repasse", "pt_BR", [
                  { type: "body", parameters: [
                    { type: "text", text: adv.nome },
                    { type: "text", text: fmtMesComp },
                    { type: "text", text: fmtValor },
                  ]},
                ]);
              }
            }
          }
        } catch (e) {
          console.error("❌ Erro ao enviar notificações de apuração:", e.message);
        }
      })();
    }
  } catch (error) {
    console.error("Erro ao apurar repasses:", error);
    res.status(500).json({ message: "Erro ao apurar repasses" });
  }
});

// ============================================================
// FECHAR COMPETÊNCIA
// ============================================================

router.post("/api/repasses/competencias/:id/fechar", authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const competencia = await prisma.repasseCompetencia.findUnique({
      where: { id: parseInt(id) },
      include: {
        linhas: {
          include: {
            advogados: true,
          },
        },
      },
    });

    if (!competencia) {
      return res.status(404).json({ message: "Competência não encontrada" });
    }

    if (competencia.fechadaEm) {
      return res.status(400).json({ message: "Competência já está fechada" });
    }

    const advogadosMap = new Map();

    for (const linha of competencia.linhas) {
      for (const adv of linha.advogados) {
        const key = adv.advogadoId;
        const atual = advogadosMap.get(key) || 0;
        advogadosMap.set(key, atual + adv.valorCentavos);
      }
    }

    const pagamentos = [];

    for (const [advogadoId, valorCentavos] of advogadosMap) {
      const pagamento = await prisma.repassePagamento.create({
        data: {
          competenciaId: competencia.id,
          advogadoId,
          status: "PENDENTE",
          valorPrevisto: valorCentavos / 100,
        },
      });

      pagamentos.push(pagamento);
    }

    await prisma.repasseCompetencia.update({
      where: { id: competencia.id },
      data: { fechadaEm: new Date() },
    });

    res.json({
      message: "Competência fechada com sucesso",
      pagamentosCriados: pagamentos.length,
      competencia: {
        ...competencia,
        fechadaEm: new Date(),
      },
    });
  } catch (error) {
    console.error("Erro ao fechar competência:", error);
    res.status(500).json({ message: "Erro ao fechar competência" });
  }
});

// ============================================================
// 3. REALIZADOS (AGRUPADOS SEM DUPLICATAS)
// ============================================================
router.get("/api/repasses/realizados", authenticate, async (req, res) => {
  try {
    const { ano, mes } = req.query;
    let { advogadoId } = req.query;

    // USER: forçar filtro pelo próprio advogado
    const roleStrRZ = String(req.user?.role || "").toUpperCase();
    if (roleStrRZ !== "ADMIN") {
      const myAdvIdRZ = await getUserAdvogadoId(req.user?.id);
      if (!myAdvIdRZ) return res.json({ items: [] });
      advogadoId = String(myAdvIdRZ);
    }

    console.log('\n========================================');
    console.log('📊 REALIZADOS - DEBUG');
    console.log('========================================');
    console.log('Filtros:', { ano, mes, advogadoId });

    const where = {};
    if (ano) where.competenciaAno = parseInt(ano);
    if (mes) where.competenciaMes = parseInt(mes);
    if (advogadoId) where.advogadoId = parseInt(advogadoId);

    const repasses = await prisma.repasseRealizado.findMany({
      where,
      include: {
        advogado: { select: { id: true, nome: true, oab: true } },
        lancamentos: {
          include: {
            contrato: { select: { numeroContrato: true } },
            parcela: { select: { numero: true, dataRecebimento: true } },
          },
        },
      },
      orderBy: [
        { dataRepasse: 'desc' },
        { competenciaAno: 'desc' },
        { competenciaMes: 'desc' },
      ],
    });

    console.log(`✅ ${repasses.length} repasses encontrados no banco`);

    // Agrupar para evitar duplicatas
    const grupos = new Map();

    for (const r of repasses) {
      const chave = `${r.advogadoId}-${r.competenciaAno}/${r.competenciaMes}-${r.referenciaAno}/${r.referenciaMes}`;
      
      if (!grupos.has(chave)) {
        grupos.set(chave, {
          id: r.id,
          advogadoId: r.advogadoId,
          advogadoNome: r.advogado.nome,
          advogadoOab: r.advogado.oab,
          competenciaAno: r.competenciaAno,
          competenciaMes: r.competenciaMes,
          referenciaAno: r.referenciaAno,
          referenciaMes: r.referenciaMes,
          dataRepasse: r.dataRepasse,
          valorPrevisto: r.valorPrevistoTotalCentavos,
          valorEfetivado: r.valorEfetivadoCentavos,
          saldoGerado: Number(r.saldoGeradoCentavos) || 0,
          saldoAtual: Number.isFinite(Number(r.saldoPosteriorCentavos)) ? Number(r.saldoPosteriorCentavos) : null,
          saldoRef: (r.dataRepasse || r.createdAt || null),
          quantidadeParcelas: r.lancamentos.length,
          repasseIds: [r.id],
        });
      } else {
        const grupo = grupos.get(chave);
        grupo.valorPrevisto += r.valorPrevistoTotalCentavos;
        grupo.valorEfetivado += r.valorEfetivadoCentavos;
        grupo.saldoGerado = (grupo.saldoGerado || 0) + (Number(r.saldoGeradoCentavos) || 0);
        grupo.quantidadeParcelas += r.lancamentos.length;
        grupo.repasseIds.push(r.id);

        // ✅ saldo deve ser o do repasse mais recente (não o primeiro que entrou no grupo)
        const saldoRR = r?.saldoPosteriorCentavos;
        const refRR = (r?.dataRepasse || r?.createdAt || null);

        if (Number.isFinite(Number(saldoRR))) {
          if (!grupo.saldoRef || (refRR && new Date(refRR) > new Date(grupo.saldoRef))) {
            grupo.saldoAtual = Number(saldoRR);
            grupo.saldoRef = refRR;
            grupo.dataRepasse = r.dataRepasse; // opcional: mantém dataRepasse coerente com o “mais recente”
          }
        }

        console.warn(`⚠️ Duplicata agrupada: ${chave}`);
      }
    }

    const items = Array.from(grupos.values()).map(g => ({
      id: g.id,
      advogadoId: g.advogadoId,
      advogadoNome: g.advogadoNome,
      advogadoOab: g.advogadoOab,
      competenciaAno: g.competenciaAno,
      competenciaMes: g.competenciaMes,
      referenciaAno: g.referenciaAno,
      referenciaMes: g.referenciaMes,
      dataRepasse: g.dataRepasse,
      valorPrevisto: (g.valorPrevisto / 100).toFixed(2),
      valorEfetivado: (g.valorEfetivado / 100).toFixed(2),
      saldoGerado: ((Number(g.saldoGerado) || 0) / 100).toFixed(2),
      saldoAtual: ((Number(g.saldoAtual) || 0) / 100).toFixed(2),
      quantidadeParcelas: g.quantidadeParcelas,
    }));

    console.log(`📋 ${items.length} grupos únicos retornados`);

    res.json({ items });

  } catch (error) {
    console.error("❌ ERRO em /api/repasses/realizados:", error);
    res.status(500).json({ 
      message: "Erro ao buscar repasses realizados.",
      error: error?.message || "Erro desconhecido",
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  }
});

console.log('✅ Rotas de repasses carregadas com debug habilitado');

// ============================================================
// FERRAMENTA ADMIN: Recalcular lançamentos antigos
// ============================================================
router.post("/api/repasses/admin/recalcular-lancamentos", authenticate, requireAdmin, async (req, res) => {
  try {
    const { competenciaAno, competenciaMes, advogadoId, dryRun = true } = req.body;

    console.log('\n========================================');
    console.log('🔧 RECALCULAR LANÇAMENTOS');
    console.log('========================================');
    console.log('Competência:', { ano: competenciaAno, mes: competenciaMes });
    console.log('Advogado:', advogadoId || 'TODOS');
    console.log('Modo:', dryRun ? 'SIMULAÇÃO (dry-run)' : '⚠️ APLICAR MUDANÇAS');

    const where = {
      competenciaAno: parseInt(competenciaAno),
      competenciaMes: parseInt(competenciaMes),
    };

    if (advogadoId) {
      where.advogadoId = parseInt(advogadoId);
    }

    // Buscar repasses realizados
    const repasses = await prisma.repasseRealizado.findMany({
      where,
      include: {
        advogado: true,
        lancamentos: {
          include: {
            parcela: {
              include: {
                contrato: {
                  include: {
                    modeloDistribuicao: { select: { id: true, codigo: true, descricao: true, itens: true } },
                    splits: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    console.log(`\n📦 ${repasses.length} repasse(s) encontrado(s)`);

    // Buscar alíquota
    let aliquota = await prisma.aliquota.findUnique({
      where: { 
        mes_ano: { 
          mes: parseInt(competenciaMes), 
          ano: parseInt(competenciaAno) 
        } 
      },
    });

    if (!aliquota) {
      aliquota = await prisma.aliquota.findFirst({
        orderBy: [{ ano: 'desc' }, { mes: 'desc' }],
      });
    }

    if (!aliquota) {
      return res.status(400).json({ message: "Alíquota não encontrada" });
    }

    const correcoes = [];
    let totalDiferenca = 0;

    for (const repasse of repasses) {
      for (const lanc of repasse.lancamentos) {
        const parcela = lanc.parcela;
        const contrato = parcela.contrato;

        // Recalcular valor correto
        const valorBruto = Math.round(parseFloat(parcela.valorRecebido || parcela.valorPrevisto) * 100);
        const imposto = contrato.isentoTributacao ? 0 : Math.round((valorBruto * aliquota.percentualBp) / 10000);
        const liquido = valorBruto - imposto;

        let valorCorreto = 0;

        if (contrato.usaSplitSocio && contrato.splits?.length > 0) {
          const split = contrato.splits.find(s => s.advogadoId === repasse.advogadoId);
          if (split) {
            // ✅ CÁLCULO CORRETO: sobre o líquido
            valorCorreto = Math.round((liquido * split.percentualBp) / 10000);
          }
        } else if (contrato.repasseAdvogadoPrincipalId === repasse.advogadoId) {
          let socioTotal = 0;
          for (const item of contrato.modeloDistribuicao?.itens || []) {
            if (item.destinoTipo === "SOCIO") {
              socioTotal += Math.round((liquido * item.percentualBp) / 10000);
            }
          }
          valorCorreto = socioTotal;
        }

        const valorAtual = lanc.valorRepasseCentavos;
        const diferenca = valorCorreto - valorAtual;

        if (diferenca !== 0) {
          totalDiferenca += diferenca;
          
          correcoes.push({
            lancamentoId: lanc.id,
            parcelaId: parcela.id,
            contratoNumero: contrato.numeroContrato,
            advogadoNome: repasse.advogado.nome,
            valorAtual: (valorAtual / 100).toFixed(2),
            valorCorreto: (valorCorreto / 100).toFixed(2),
            diferenca: (diferenca / 100).toFixed(2),
          });

          console.log(`\n📝 Lançamento ${lanc.id}:`, {
            contrato: contrato.numeroContrato,
            advogado: repasse.advogado.nome,
            valorAtual: (valorAtual / 100).toFixed(2),
            valorCorreto: (valorCorreto / 100).toFixed(2),
            diferenca: (diferenca / 100).toFixed(2),
          });
        }
      }
    }

    console.log('\n📊 RESUMO:');
    console.log('Correções necessárias:', correcoes.length);
    console.log('Diferença total:', (totalDiferenca / 100).toFixed(2));

    if (!dryRun && correcoes.length > 0) {
      console.log('\n⚠️ APLICANDO CORREÇÕES...');

      for (const corr of correcoes) {
        await prisma.repasseLancamento.update({
          where: { id: corr.lancamentoId },
          data: {
            valorRepasseCentavos: Math.round(parseFloat(corr.valorCorreto) * 100),
          },
        });
      }

      console.log('✅ Correções aplicadas com sucesso!');
    }

    res.json({
      modo: dryRun ? 'SIMULAÇÃO' : 'APLICADO',
      repasses: repasses.length,
      correcoes: correcoes.length,
      diferencaTotal: (totalDiferenca / 100).toFixed(2),
      detalhes: correcoes,
      aviso: dryRun 
        ? 'Esta foi uma simulação. Para aplicar, envie dryRun: false'
        : 'Correções aplicadas! Recarregue a página de repasses.',
    });

  } catch (error) {
    console.error("❌ Erro ao recalcular:", error);
    res.status(500).json({ 
      message: "Erro ao recalcular lançamentos",
      error: error?.message 
    });
  }
});

// ============================================================
// ROTA AUXILIAR: Verificar se repasse já foi realizado
// ============================================================
router.get("/api/repasses/verificar-duplicata", authenticate, async (req, res) => {
  try {
    const { advogadoId, ano, mes } = req.query;

    if (!advogadoId || !ano || !mes) {
      return res.status(400).json({ message: "Parâmetros obrigatórios faltando" });
    }

    const jaRealizado = await prisma.repasseRealizado.findFirst({
      where: {
        advogadoId: parseInt(advogadoId),
        competenciaAno: parseInt(ano),  // ✅ CORREÇÃO: usar ano/mes dos params
        competenciaMes: parseInt(mes),  // ✅ CORREÇÃO: usar ano/mes dos params
      },
    });

    res.json({
      jaRealizado: !!jaRealizado,
      repasse: jaRealizado ? {
        id: jaRealizado.id,
        dataRepasse: jaRealizado.dataRepasse,
        valorEfetivado: (jaRealizado.valorEfetivadoCentavos / 100).toFixed(2),
      } : null,
    });

  } catch (error) {
    console.error("❌ Erro ao verificar duplicata:", error);
    res.status(500).json({ message: "Erro ao verificar duplicata" });
  }
});

/**
 * ✅ ENDPOINT: LANÇAMENTOS DE UM REPASSE
 * GET /api/repasses/pagamentos/:repassePagamentoId/lancamentos
 */
router.get("/api/repasses/pagamentos/:repassePagamentoId/lancamentos", authenticate, async (req, res) => {
  try {
    const { repassePagamentoId } = req.params;

    console.log('📋 Buscando lançamentos do repasse:', repassePagamentoId);

    const repasse = await prisma.repasseRealizado.findUnique({
      where: { id: parseInt(repassePagamentoId) },
      include: {
        advogado: { select: { id: true, nome: true, oab: true } },
        lancamentos: {
          include: {
            contrato: {
              include: {
                cliente: { select: { id: true, nomeRazaoSocial: true } },
              },
            },
            parcela: { select: { numero: true, dataRecebimento: true } },
          },
          orderBy: { id: 'asc' },
        },
      },
    });

    if (!repasse) {
      return res.status(404).json({ message: "Repasse não encontrado" });
    }

    // USER: restringe ao próprio advogado
    const roleStrPL = String(req.user?.role || "").toUpperCase();
    if (roleStrPL !== "ADMIN") {
      const myAdvIdPL = await getUserAdvogadoId(req.user?.id);
      if (!myAdvIdPL || repasse.advogadoId !== myAdvIdPL) {
        return res.status(403).json({ message: "Acesso negado." });
      }
    }

    console.log(`✅ Repasse encontrado com ${repasse.lancamentos.length} lançamentos`);

    res.json({
      meta: {
        titulo: `Lançamentos - ${repasse.advogado.nome}`,
        competencia: `${String(repasse.competenciaMes).padStart(2, '0')}/${repasse.competenciaAno}`,
        referencia: `${String(repasse.referenciaMes).padStart(2, '0')}/${repasse.referenciaAno}`,
        dataRepasse: repasse.dataRepasse,
        valorPrevisto: (repasse.valorPrevistoTotalCentavos / 100).toFixed(2),
        valorEfetivado: (repasse.valorEfetivadoCentavos / 100).toFixed(2),
      },
      lancamentos: repasse.lancamentos.map(l => ({
        id: l.id,
        contratoId: l.contratoId,
        numeroContrato: l.contrato.numeroContrato,
        clienteId: l.contrato.clienteId,
        clienteNome: l.contrato.cliente?.nomeRazaoSocial || "N/A",
        parcelaNumero: l.parcela.numero,
        dataRecebimento: l.parcela.dataRecebimento,
        valorBruto: (l.valorBrutoCentavos / 100).toFixed(2),
        imposto: (l.impostoCentavos / 100).toFixed(2),
        liquido: (l.liquidoCentavos / 100).toFixed(2),
        percentualBp: Math.round((l.valorRepasseCentavos / l.liquidoCentavos) * 10000),
        valorRepasse: (l.valorRepasseCentavos / 100).toFixed(2),
      })),
    });

  } catch (error) {
    console.error("❌ Erro ao buscar lançamentos:", error);
    res.status(500).json({ message: "Erro ao buscar lançamentos" });
  }
});

// ============================================================
// LANÇAMENTOS DETALHADOS DE "A REALIZAR"
// ============================================================
router.get("/api/repasses/a-realizar/:advogadoId/lancamentos", authenticate, async (req, res) => {
  try {
    const { advogadoId } = req.params;
    const { ano, mes } = req.query;

    // USER: restringe ao próprio advogado
    const roleStrARL = String(req.user?.role || "").toUpperCase();
    if (roleStrARL !== "ADMIN") {
      const myAdvIdARL = await getUserAdvogadoId(req.user?.id);
      if (!myAdvIdARL || parseInt(advogadoId) !== myAdvIdARL) {
        return res.status(403).json({ message: "Acesso negado." });
      }
    }

    if (!ano || !mes) {
      return res.status(400).json({ message: "ano e mes são obrigatórios" });
    }

    console.log('\n📋 Buscando lançamentos a realizar:', { advogadoId, ano, mes });

    const mesReferencia = Number(mes) === 1 ? 12 : Number(mes) - 1;
    const anoReferencia = Number(mes) === 1 ? Number(ano) - 1 : Number(ano);

    const primeiroDia = new Date(anoReferencia, mesReferencia - 1, 1, 0, 0, 0);
    const ultimoDia = new Date(anoReferencia, mesReferencia, 0, 23, 59, 59);

    // Buscar advogado
    const advogado = await prisma.advogado.findUnique({
      where: { id: parseInt(advogadoId) },
      select: { id: true, nome: true, oab: true },
    });

    if (!advogado) {
      return res.status(404).json({ message: "Advogado não encontrado" });
    }

    // Buscar parcelas RECEBIDAS
    const parcelas = await prisma.parcelaContrato.findMany({
      where: {
        status: "RECEBIDA",
        dataRecebimento: { gte: primeiroDia, lte: ultimoDia },
      },
      include: {
        contrato: {
          include: {
            cliente: { select: { nomeRazaoSocial: true } },
            modeloDistribuicao: { include: { itens: true } },
            splits: { include: { advogado: true } },
            repasseAdvogadoPrincipal: true,
            repasseIndicacaoAdvogado: true,
          },
        },
      },
    });

    // Carregar overrides para este advogado no período
    const parcelaIdsLanc = parcelas.map(p => p.id);
    const overridesLanc = parcelaIdsLanc.length > 0
      ? await prisma.parcelaRepasseOverride.findMany({
          where: { parcelaId: { in: parcelaIdsLanc }, advogadoId: parseInt(advogadoId) },
        })
      : [];
    const overrideMapLanc = new Map(overridesLanc.map(o => [o.parcelaId, o.valorCentavos]));

    // Buscar alíquota
    let aliquota = await prisma.aliquota.findUnique({
      where: { mes_ano: { mes: parseInt(mes), ano: parseInt(ano) } },
    });

    if (!aliquota) {
      aliquota = await prisma.aliquota.findFirst({
        orderBy: [{ ano: 'desc' }, { mes: 'desc' }],
      });
    }

    // Calcular lançamentos
    const lancamentos = [];

    for (const parcela of parcelas) {
      const contrato = parcela.contrato;
      const valorBruto = Math.round(parseFloat(parcela.valorRecebido || parcela.valorPrevisto) * 100);
      const imposto = contrato.isentoTributacao ? 0 : Math.round((valorBruto * aliquota.percentualBp) / 10000);
      const liquido = valorBruto - imposto;

      const modelo = contrato.modeloDistribuicao;
      if (!modelo?.itens?.length) continue;

      let socioTotal = 0;
      for (const item of modelo.itens) {
        if (item.destinoTipo === "SOCIO") {
          socioTotal += Math.round((liquido * item.percentualBp) / 10000);
        }
      }

      // ✅ CORREÇÃO: Verificar se este advogado recebe (calculando sobre LÍQUIDO)
      let valorAdvogadoCentavos = 0;
      let percentualBp = 0;

      let valorSplitCentavos = 0; // ✅ novo: split separado p/ debug/UI

      if (contrato.usaSplitSocio && contrato.splits?.length > 0) {
        const split = contrato.splits.find(s => s.advogadoId === parseInt(advogadoId));
        if (split) {
          // ✅ CORREÇÃO: Calcula sobre o LÍQUIDO
          valorAdvogadoCentavos = Math.round((liquido * split.percentualBp) / 10000);
          percentualBp = split.percentualBp;

          valorSplitCentavos = valorAdvogadoCentavos; // ✅ split separado

        }
        else if (contrato.repasseIndicacaoAdvogadoId === parseInt(advogadoId)) {
        // ✅ INDICAÇÃO
          let percentualIndicacaoBp = 0;

          for (const item of modelo.itens) {
            if (
              item.destinoTipo === "INDICACAO" ||
              item.destinoTipo === "INDICACAO_ADVOGADO" ||
              (item.destinoTipo === "SOCIO" && item.destinatario === "INDICACAO") ||
              (item.destinoTipo === "ADVOGADO" && item.destinatario === "INDICACAO")
            ) {
              percentualIndicacaoBp += item.percentualBp;
            }
          }

          if (percentualIndicacaoBp > 0) {
            valorAdvogadoCentavos = Math.round((liquido * percentualIndicacaoBp) / 10000);
            percentualBp = percentualIndicacaoBp;
          }
        }

      } else if (contrato.repasseAdvogadoPrincipalId === parseInt(advogadoId)) {
        valorAdvogadoCentavos = socioTotal;
        percentualBp = liquido > 0 ? Math.round((socioTotal / liquido) * 10000) : 0;
      } else if (contrato.repasseIndicacaoAdvogadoId === parseInt(advogadoId)) {
        // ✅ INDICAÇÃO (também para contratos SEM split)
        let percentualIndicacaoBp = 0;

        for (const item of modelo.itens) {
          if (
            item.destinoTipo === "INDICACAO" ||
            item.destinoTipo === "INDICACAO_ADVOGADO" ||
            (item.destinoTipo === "SOCIO" && item.destinatario === "INDICACAO") ||
            (item.destinoTipo === "ADVOGADO" && item.destinatario === "INDICACAO")
          ) {
            percentualIndicacaoBp += item.percentualBp;
          }
        }

        if (percentualIndicacaoBp > 0) {
          valorAdvogadoCentavos = Math.round((liquido * percentualIndicacaoBp) / 10000);
          percentualBp = percentualIndicacaoBp;
        }
      }

      if (valorAdvogadoCentavos > 0) {

        const overrideValLanc = overrideMapLanc.get(parcela.id);
        const valorFinalLanc = overrideValLanc !== undefined ? overrideValLanc : valorAdvogadoCentavos;
        const valorSplitCentavos = valorFinalLanc;

        lancamentos.push({
          parcelaId: parcela.id,
          contratoId: contrato.id,
          numeroContrato: contrato.numeroContrato,
          clienteNome: contrato.cliente?.nomeRazaoSocial,
          parcelaNumero: parcela.numero,
          dataRecebimento: parcela.dataRecebimento,
          valorBruto: (valorBruto / 100).toFixed(2),
          imposto: (imposto / 100).toFixed(2),
          liquido: (liquido / 100).toFixed(2),
          percentualBp,
          valorRepasseCalculado: (valorAdvogadoCentavos / 100).toFixed(2),
          valorRepasse: (valorFinalLanc / 100).toFixed(2),
          valorRepasseOverrideCentavos: overrideValLanc !== undefined ? overrideValLanc : null,
          excluirDoRepasse: parcela.excluirDoRepasse,

          // ✅ split separado (debug/UI)
          valorSplitCentavos,
          valorSplit: (valorSplitCentavos / 100).toFixed(2),

          modeloDistribuicao: {
            id: contrato.modeloDistribuicao?.id || null,
            codigo: contrato.modeloDistribuicao?.codigo || null,
            descricao: contrato.modeloDistribuicao?.descricao || null,
          },

        });
      }
    }

    // Buscar adiantamentos do advogado para esta competência
    const adiantamentosAdv = await prisma.adiantamentoSocio.findMany({
      where: { advogadoId: parseInt(advogadoId), competenciaAno: parseInt(ano), competenciaMes: parseInt(mes) },
      include: { cliente: { select: { id: true, nomeRazaoSocial: true } } },
      orderBy: { createdAt: "asc" },
    });

    res.json({
      meta: {
        titulo: `Lançamentos a Realizar - ${advogado.nome}`,
        competencia: `${String(mes).padStart(2, '0')}/${ano}`,
        referencia: `${String(mesReferencia).padStart(2, '0')}/${anoReferencia}`,
      },
      lancamentos,
      adiantamentos: adiantamentosAdv.map(a => ({
        id: a.id,
        clienteId: a.clienteId,
        clienteNome: a.cliente.nomeRazaoSocial,
        valorPrevistoCentavos: a.valorPrevistoCentavos,
        valorAdiantadoCentavos: a.valorAdiantadoCentavos,
        valorDevolvidoCentavos: a.valorDevolvidoCentavos,
        quitado: a.quitado,
        observacoes: a.observacoes,
        dataRegistro: a.dataRegistro,
      })),
    });

  } catch (error) {
    console.error("❌ Erro ao buscar lançamentos a realizar:", error);
    res.status(500).json({ message: "Erro ao buscar lançamentos" });
  }
});

// PATCH /api/parcelas/:id/excluir-do-repasse — toggle (admin only)
router.patch("/api/parcelas/:id/excluir-do-repasse", authenticate, requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const parcela = await prisma.parcelaContrato.findUnique({ where: { id }, select: { id: true, excluirDoRepasse: true } });
    if (!parcela) return res.status(404).json({ message: "Parcela não encontrada" });
    const updated = await prisma.parcelaContrato.update({
      where: { id },
      data: { excluirDoRepasse: !parcela.excluirDoRepasse },
      select: { id: true, excluirDoRepasse: true },
    });
    res.json({ excluirDoRepasse: updated.excluirDoRepasse });
  } catch (error) {
    console.error("❌ Erro ao toggle excluirDoRepasse:", error);
    res.status(500).json({ message: "Erro ao atualizar parcela" });
  }
});

// PUT /api/parcelas/:parcelaId/repasse-override — upsert override (admin only)
router.put("/api/parcelas/:parcelaId/repasse-override", authenticate, requireAdmin, async (req, res) => {
  try {
    const parcelaId = parseInt(req.params.parcelaId);
    const { advogadoId, valorCentavos } = req.body;
    if (!advogadoId || valorCentavos === undefined || valorCentavos === null) {
      return res.status(400).json({ message: "advogadoId e valorCentavos são obrigatórios" });
    }
    const record = await prisma.parcelaRepasseOverride.upsert({
      where: { parcelaId_advogadoId: { parcelaId, advogadoId: parseInt(advogadoId) } },
      create: { parcelaId, advogadoId: parseInt(advogadoId), valorCentavos: parseInt(valorCentavos) },
      update: { valorCentavos: parseInt(valorCentavos), updatedAt: new Date() },
    });
    res.json({ valorRepasseOverrideCentavos: record.valorCentavos });
  } catch (error) {
    console.error("❌ Erro ao salvar override:", error);
    res.status(500).json({ message: "Erro ao salvar override" });
  }
});

// DELETE /api/parcelas/:parcelaId/repasse-override/:advogadoId — remove override (admin only)
router.delete("/api/parcelas/:parcelaId/repasse-override/:advogadoId", authenticate, requireAdmin, async (req, res) => {
  try {
    const parcelaId = parseInt(req.params.parcelaId);
    const advogadoId = parseInt(req.params.advogadoId);
    await prisma.parcelaRepasseOverride.deleteMany({ where: { parcelaId, advogadoId } });
    res.json({ valorRepasseOverrideCentavos: null });
  } catch (error) {
    console.error("❌ Erro ao remover override:", error);
    res.status(500).json({ message: "Erro ao remover override" });
  }
});

// ============================================================
// UTILITÁRIOS - REPASSES MANUAIS (AJUSTES ANTIGOS)
// ============================================================

// Lista de base: clientes/advogados/contas
router.get("/api/util/repasses-manuais/base", requireAuth, async (req, res) => {
  try {
    const [clientes, advogados] = await Promise.all([
      prisma.cliente.findMany({ where: { ativo: true }, orderBy: { nomeRazaoSocial: "asc" } }),
      prisma.advogado.findMany({ where: { ativo: true }, orderBy: { nome: "asc" } }),
    ]);

    // ✅ Contas (Livro Caixa): algumas bases não têm o campo "ativa"
    // então fazemos fallback para não quebrar a tela e os selects.
    let contas = [];
    try {
      contas = await prisma.livroCaixaConta.findMany({
        where: { ativa: true },
        orderBy: { ordem: "asc" },
      });
    } catch (eAtiva) {
      // fallback (sem where.ativa)
      try {
        contas = await prisma.livroCaixaConta.findMany({
          orderBy: [
            { tipo: "asc" },
            { ordem: "asc" },
          ],
        });
      } catch (eOrder) {
        // último fallback (sem orderBy)
        contas = await prisma.livroCaixaConta.findMany();
      }
    }

    res.json({ clientes, advogados, contas });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Falha ao carregar base de repasses manuais." });
  }
});

// Listar pagamentos/contratos existentes no mês (para selecionar em vez de criar novo AV)
router.get("/api/util/repasses-manuais/pagamentos", requireAuth, async (req, res) => {
  try {
    const ano = Number(req.query.ano);
    const mes = Number(req.query.mes);
    if (!ano || !mes) return res.status(400).json({ error: "Informe ano e mes." });

    const dtIni = new Date(ano, mes - 1, 1, 0, 0, 0);
    const dtFim = new Date(ano, mes, 0, 23, 59, 59, 999);

    const contratos = await prisma.contratoPagamento.findMany({
      where: {
        parcelas: {
          some: {
            dataRecebimento: { gte: dtIni, lte: dtFim },
            status: { in: ["RECEBIDA", "REPASSE_EFETUADO"] },
          },
        },
      },
      include: {
        cliente: { select: { id: true, nomeRazaoSocial: true } },
        parcelas: {
          where: {
            dataRecebimento: { gte: dtIni, lte: dtFim },
            status: { in: ["RECEBIDA", "REPASSE_EFETUADO"] },
          },
          orderBy: { numero: "asc" },
          take: 1,
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const rows = contratos
      .filter((c) => c.parcelas.length > 0)
      .map((c) => {
        const p = c.parcelas[0];
        return {
          contratoId: c.id,
          parcelaId: p.id,
          clienteId: c.clienteId,
          numeroContrato: c.numeroContrato,
          clienteNome: c.cliente?.nomeRazaoSocial || "",
          dataRecebimento: p.dataRecebimento,
          valorRecebidoCentavos: p.valorRecebido != null ? Math.round(Number(p.valorRecebido) * 100) : 0,
        };
      });

    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Falha ao listar pagamentos do mês." });
  }
});

// Listar repasses manuais ligados a um contrato
router.get("/api/util/repasses-manuais/repasses-por-contrato", requireAuth, async (req, res) => {
  try {
    const contratoId = Number(req.query.contratoId);
    if (!contratoId) return res.status(400).json({ error: "Informe contratoId." });

    const itens = await prisma.repasseManualLancamento.findMany({
      where: { contratoId },
      include: {
        advogado: { select: { id: true, nome: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    const rows = itens.map((it) => ({
      id: it.id,
      advogadoId: it.advogadoId,
      advogadoNome: it.advogado?.nome || "",
      tipo: it.tipo,
      valorPrevistoCentavos: it.valorPrevistoCentavos,
      valorEfetivadoCentavos: it.valorEfetivadoCentavos,
      repasseRealizadoId: it.repasseRealizadoId,
      competenciaAno: it.competenciaAno,
      competenciaMes: it.competenciaMes,
    }));

    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Falha ao buscar repasses do contrato." });
  }
});

// Criar lançamento manual
router.post("/api/util/repasses-manuais/lancamentos", requireAuth, async (req, res) => {
  try {
    const {
      contratoId,
      parcelaId,
      clienteId,
      advogadoId,
      tipo, // "ADVOGADO" | "INDICACAO"
      competenciaAno,
      competenciaMes,
      valorPrevistoCentavos,
      observacoes,
    } = req.body || {};

    if (!contratoId || !parcelaId || !clienteId || !advogadoId) {
      return res.status(400).json({ error: "Informe contratoId, parcelaId, clienteId e advogadoId." });
    }
    if (!competenciaAno || !competenciaMes) {
      return res.status(400).json({ error: "Informe competenciaAno e competenciaMes." });
    }
    if (!valorPrevistoCentavos || Number(valorPrevistoCentavos) <= 0) {
      return res.status(400).json({ error: "valorPrevistoCentavos inválido." });
    }

    const item = await prisma.repasseManualLancamento.create({
      data: {
        contratoId: Number(contratoId),
        parcelaId: Number(parcelaId),
        clienteId: Number(clienteId),
        advogadoId: Number(advogadoId),
        tipo: (String(tipo || "ADVOGADO").toUpperCase() === "INDICACAO" ? "INDICACAO" : "ADVOGADO"),
        competenciaAno: Number(competenciaAno),
        competenciaMes: Number(competenciaMes),
        valorPrevistoCentavos: Number(valorPrevistoCentavos),
        // se você quiser guardar observações no manual, adicione campo no prisma (não está no teu model colado)
      },
    });

    res.json(item);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Falha ao criar lançamento manual." });
  }
});

// Listar lançamentos manuais do mês
router.get("/api/util/repasses-manuais/lancamentos", requireAuth, async (req, res) => {
  try {
    const ano = Number(req.query.ano);
    const mes = Number(req.query.mes);
    const advogadoId = req.query.advogadoId ? Number(req.query.advogadoId) : null;

    if (!ano || !mes) return res.status(400).json({ error: "Informe ano e mes." });

    const where = {
      competenciaAno: ano,
      competenciaMes: mes,
      ...(advogadoId ? { advogadoId } : {}),
    };

    const itens = await prisma.repasseManualLancamento.findMany({
      where,
      include: {
        advogado: true,
        cliente: true,
        contrato: true,
        parcela: true,
      },
      orderBy: [{ advogadoId: "asc" }, { createdAt: "asc" }],
    });

    res.json(itens);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Falha ao listar lançamentos manuais." });
  }
});

// Repasses a realizar (agrupado por advogado) + saldo anterior
router.get("/api/util/repasses-manuais/repasses-a-realizar", requireAuth, async (req, res) => {
  try {
    const ano = Number(req.query.ano);
    const mes = Number(req.query.mes);
    if (!ano || !mes) return res.status(400).json({ error: "Informe ano e mes." });

    const itens = await prisma.repasseManualLancamento.findMany({
      where: {
        competenciaAno: ano,
        competenciaMes: mes,
        OR: [{ repasseRealizadoId: null }, { repasseRealizadoId: 0 }],
      },
      select: { advogadoId: true, valorPrevistoCentavos: true },
    });

    const totalsMap = new Map();
    for (const it of itens) {
      totalsMap.set(it.advogadoId, (totalsMap.get(it.advogadoId) || 0) + Number(it.valorPrevistoCentavos || 0));
    }

    const advogadoIds = Array.from(totalsMap.keys());
    const [advogados, saldos] = await Promise.all([
      prisma.advogado.findMany({ where: { id: { in: advogadoIds } }, orderBy: { nome: "asc" } }),
      prisma.repasseSaldo.findMany({ where: { advogadoId: { in: advogadoIds } } }),
    ]);

    const saldoByAdv = new Map(saldos.map((s) => [s.advogadoId, s.saldoCentavos]));
    const rows = advogados.map((a) => {
      const previsto = totalsMap.get(a.id) || 0;
      const saldoAnterior = saldoByAdv.get(a.id) || 0;
      return {
        advogadoId: a.id,
        advogadoNome: a.nome,
        valorPrevistoTotalCentavos: previsto,
        saldoAnteriorCentavos: saldoAnterior,
        totalDisponivelCentavos: previsto + saldoAnterior,
      };
    });

    res.json({ ano, mes, rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Falha ao montar repasses a realizar (manuais)." });
  }
});

// Efetivar repasse manual por advogado (gera RepasseRealizado + RepasseLancamento + Livro Caixa + ajusta saldo)
router.post("/api/util/repasses-manuais/efetivar", requireAuth, async (req, res) => {
  try {
    const {
      advogadoId,
      ano,
      mes,
      dataRepasse, // ISO
      valorEfetivadoCentavos,
      contaId, // opcional p/ livro caixa
      observacoes,
      descricaoRepasse,
    } = req.body || {};

    if (!advogadoId || !ano || !mes) return res.status(400).json({ error: "Informe advogadoId, ano e mes." });
    if (!dataRepasse) return res.status(400).json({ error: "Informe dataRepasse." });
    if (valorEfetivadoCentavos == null) return res.status(400).json({ error: "Informe valorEfetivadoCentavos." });

    const advId = Number(advogadoId);
    const compAno = Number(ano);
    const compMes = Number(mes);
    const efet = Number(valorEfetivadoCentavos);

    const result = await prisma.$transaction(async (tx) => {
      const advogado = await tx.advogado.findUnique({ where: { id: advId }, select: { nome: true } });
      const advNome = advogado?.nome || `Advogado #${advId}`;

      const itens = await tx.repasseManualLancamento.findMany({
        where: {
          advogadoId: advId,
          competenciaAno: compAno,
          competenciaMes: compMes,
          repasseRealizadoId: null,
        },
        orderBy: { createdAt: "asc" },
      });

      const previstoTotal = itens.reduce((acc, it) => acc + Number(it.valorPrevistoCentavos || 0), 0);

      // saldo anterior
      const saldoRow = await tx.repasseSaldo.findUnique({ where: { advogadoId: advId } });
      const saldoAnterior = saldoRow?.saldoCentavos || 0;

      const totalDisponivel = previstoTotal + saldoAnterior;
      if (efet < 0) throw new Error("valorEfetivadoCentavos inválido.");
      if (efet > totalDisponivel) {
        throw new Error("Valor efetivado maior que o disponível (previsto + saldo anterior).");
      }

      const saldoPosterior = totalDisponivel - efet;
      const saldoConsumido = Math.max(0, efet - previstoTotal); // se pagou mais do que gerou, consumiu saldo
      const saldoGerado = previstoTotal;

      const repasseRealizado = await tx.repasseRealizado.create({
        data: {
          advogadoId: advId,
          competenciaAno: compAno,
          competenciaMes: compMes,
          referenciaAno: compAno,
          referenciaMes: compMes,
          valorPrevistoTotalCentavos: previstoTotal,
          valorEfetivadoCentavos: efet,
          dataRepasse: new Date(dataRepasse),
          observacoes: observacoes || null,
          descricaoRepasse: descricaoRepasse || "Repasse manual (ajustes antigos)",
          saldoAnteriorCentavos: saldoAnterior,
          saldoGeradoCentavos: saldoGerado,
          saldoConsumidoCentavos: saldoConsumido,
          saldoPosteriorCentavos: saldoPosterior,
        },
      });

      // cria repasses_lancamentos (pra relatórios)
      if (itens.length) {
        await tx.repasseLancamento.createMany({
          data: itens.map((it) => ({
            repasseRealizadoId: repasseRealizado.id,
            parcelaId: it.parcelaId,
            contratoId: it.contratoId,
            advogadoId: it.advogadoId,
            valorBrutoCentavos: it.valorPrevistoCentavos,
            impostoCentavos: 0,
            liquidoCentavos: it.valorPrevistoCentavos,
            valorRepasseCentavos: it.valorPrevistoCentavos,
            observacoes: "Manual (utilitário)",
          })),
        });

        // vincula os manuais ao repasseRealizado
        for (const it of itens) {
          await tx.repasseManualLancamento.update({
            where: { id: it.id },
            data: { repasseRealizadoId: repasseRealizado.id, valorEfetivadoCentavos: it.valorPrevistoCentavos },
          });
        }
      }

      // atualiza saldo
      if (saldoRow) {
        await tx.repasseSaldo.update({
          where: { advogadoId: advId },
          data: { saldoCentavos: saldoPosterior },
        });
      } else {
        await tx.repasseSaldo.create({
          data: { advogadoId: advId, saldoCentavos: saldoPosterior },
        });
      }

      // livro caixa (saída)
      await tx.livroCaixaLancamento.create({
        data: {
          competenciaAno: compAno,
          competenciaMes: compMes,
          data: new Date(dataRepasse),
          es: "S",
          clienteFornecedor: advNome,
          historico: `${descricaoRepasse || "Prestação de serviços"} - Competência ${String(compMes).padStart(2, "0")}/${compAno}`,
          valorCentavos: efet,
          contaId: contaId ? Number(contaId) : null,
          origem: "REPASSES_REALIZADOS",
          referenciaOrigem: `REPASSE_MANUAL_${repasseRealizado.id}`,
          status: "OK",
          statusFluxo: "EFETIVADO",
        },
      });

      return { repasseRealizado, previstoTotal, saldoAnterior, totalDisponivel, saldoPosterior };
    });

    res.json(result);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e?.message || "Falha ao efetivar repasse manual." });
  }
});

// ============================================================
// DASHBOARD DE REPASSES COM FILTROS
// ============================================================

router.get("/api/repasses/dashboard", authenticate, async (req, res) => {
  try {
    const { ano, mes } = req.query;
    let { advogadoId } = req.query;

    // USER: forçar advogadoId do próprio usuário
    const roleStr = String(req.user?.role || "").toUpperCase();
    if (roleStr !== "ADMIN") {
      const myAdvId = await getUserAdvogadoId(req.user?.id);
      if (!myAdvId) return res.json({ competenciasAbertas: 0, repassesPendentes: { quantidade: 0, valorTotal: "0.00" }, repassesRealizados: { quantidade: 0, valorTotal: "0.00", valorPrevisto: "0.00" }, saldoAdvogado: null, topAdvogados: [], historicoMensal: [] });
      advogadoId = String(myAdvId);
    }

    console.log('📊 Dashboard - Filtros:', { ano, mes, advogadoId });

    // 1. Competências Abertas
    const abertas = await prisma.repasseCompetencia.count({
      where: { fechadaEm: null },
    });

    // 2. Repasses Pendentes (com filtros)
    const wherePendentes = { status: "PENDENTE" };
    
    if (advogadoId) {
      wherePendentes.advogadoId = parseInt(advogadoId);
    }

    const pendentes = await prisma.repassePagamento.aggregate({
      where: wherePendentes,
      _sum: { valorPrevisto: true },
      _count: true,
    });

    // 3. Repasses Realizados (com filtros)
    const whereRealizados = {};
    
    if (ano) {
      whereRealizados.competenciaAno = parseInt(ano);
    }
    
    if (mes) {
      whereRealizados.competenciaMes = parseInt(mes);
    }
    
    if (advogadoId) {
      whereRealizados.advogadoId = parseInt(advogadoId);
    }

    const realizados = await prisma.repasseRealizado.aggregate({
      where: whereRealizados,
      _sum: { 
        valorEfetivadoCentavos: true,
        valorPrevistoTotalCentavos: true,
      },
      _count: true,
    });

    // 4. Saldo do advogado (se filtrado)
    let saldoAdvogado = null;
    if (advogadoId) {
      const saldo = await prisma.repasseSaldo.findUnique({
        where: { advogadoId: parseInt(advogadoId) },
        include: {
          advogado: {
            select: { nome: true, oab: true },
          },
        },
      });

      if (saldo) {
        saldoAdvogado = {
          advogadoNome: saldo.advogado.nome,
          advogadoOab: saldo.advogado.oab,
          saldo: (saldo.saldoCentavos / 100).toFixed(2),
          ultimaAtualizacao: saldo.ultimaAtualizacao,
        };
      }
    }

    // 5. Totais por advogado (top 5 no período)
    const topAdvogados = await prisma.repasseRealizado.groupBy({
      by: ['advogadoId'],
      where: whereRealizados,
      _sum: {
        valorEfetivadoCentavos: true,
      },
      _count: true,
      orderBy: {
        _sum: {
          valorEfetivadoCentavos: 'desc',
        },
      },
      take: 5,
    });

    // Busca todos os advogados necessários em uma única query (evita N+1)
    const topIds = topAdvogados.map(a => a.advogadoId);
    const topAdvogadosInfo = await prisma.advogado.findMany({
      where: { id: { in: topIds } },
      select: { id: true, nome: true, oab: true },
    });
    const topAdvogadosMap = new Map(topAdvogadosInfo.map(a => [a.id, a]));

    const topAdvogadosComNomes = topAdvogados.map((item) => {
      const adv = topAdvogadosMap.get(item.advogadoId);
      return {
        advogadoId: item.advogadoId,
        advogadoNome: adv?.nome || 'N/A',
        advogadoOab: adv?.oab || '',
        valorTotal: ((item._sum.valorEfetivadoCentavos || 0) / 100).toFixed(2),
        quantidade: item._count,
      };
    });

    // 6. Histórico mensal (últimos 6 meses relativos ao período selecionado)
    const hoje = new Date();
    const baseAno = ano ? parseInt(ano) : hoje.getFullYear();
    const baseMes = mes ? parseInt(mes) : (hoje.getMonth() + 1);
    const historicoMensal = [];

    for (let i = 5; i >= 0; i--) {
      const data = new Date(baseAno, baseMes - 1 - i, 1);
      const mesHistorico = data.getMonth() + 1;
      const anoHistorico = data.getFullYear();

      const whereHistorico = {
        competenciaAno: anoHistorico,
        competenciaMes: mesHistorico,
      };

      if (advogadoId) {
        whereHistorico.advogadoId = parseInt(advogadoId);
      }

      const dados = await prisma.repasseRealizado.aggregate({
        where: whereHistorico,
        _sum: { valorEfetivadoCentavos: true },
        _count: true,
      });

      historicoMensal.push({
        mes: mesHistorico,
        ano: anoHistorico,
        label: `${String(mesHistorico).padStart(2, '0')}/${anoHistorico}`,
        valor: ((dados._sum.valorEfetivadoCentavos || 0) / 100).toFixed(2),
        quantidade: dados._count || 0,
      });
    }

    res.json({
      competenciasAbertas: abertas,
      repassesPendentes: {
        quantidade: pendentes._count || 0,
        valorTotal: (pendentes._sum?.valorPrevisto || 0).toFixed(2),
      },
      repassesRealizados: {
        quantidade: realizados._count || 0,
        valorTotal: ((realizados._sum?.valorEfetivadoCentavos || 0) / 100).toFixed(2),
        valorPrevisto: ((realizados._sum?.valorPrevistoTotalCentavos || 0) / 100).toFixed(2),
      },
      saldoAdvogado,
      topAdvogados: topAdvogadosComNomes,
      historicoMensal,
      filtros: {
        ano: ano ? parseInt(ano) : null,
        mes: mes ? parseInt(mes) : null,
        advogadoId: advogadoId ? parseInt(advogadoId) : null,
      },
    });

  } catch (error) {
    console.error("❌ Erro ao buscar dashboard:", error);
    res.status(500).json({ 
      message: "Erro ao buscar dashboard de repasses",
      error: error?.message || "Erro desconhecido",
    });
  }
});

// ============================================================
// CORREÇÃO: CÁLCULO DO SALDO ANTERIOR
// ============================================================
// Adicione essas funções ANTES das rotas do Livro Caixa no server.js

/**
 * Calcula o saldo anterior (acumulado até o mês anterior)
 * @param {number} ano - Ano da competência atual
 * @param {number} mes - Mês da competência atual (1-12)
 * @returns {Promise<number>} - Saldo em centavos
 */
async function calcularSaldoAnterior(ano, mes) {
  try {
    // 1️⃣ Calcular o mês anterior ao solicitado
    let anoAnt = mes === 1 ? ano - 1 : ano;
    let mesAnt = mes === 1 ? 12 : mes - 1;

    console.log(`🔍 Calculando saldo anterior para ${mes}/${ano} (buscando até ${mesAnt}/${anoAnt})`);

    // 2️⃣ Buscar o saldo inicial mais antigo (ponto de partida opcional)
      const saldoInicial = await prisma.livroCaixaSaldoInicial.findFirst({
        orderBy: [
          { competenciaAno: 'asc' },
            { competenciaMes: 'asc' }
        ]
      });

      let saldoAcumulado = saldoInicial?.saldoInicialCent ?? 0;
      let anoInicio = saldoInicial?.competenciaAno ?? 1900;
      let mesInicio = saldoInicial?.competenciaMes ?? 1;

      if (saldoInicial) {
        console.log(`   📌 Saldo inicial encontrado: R$ ${(saldoAcumulado / 100).toFixed(2)} em ${mesInicio}/${anoInicio}`);
    }

    // 3️⃣ Buscar TODOS os lançamentos efetivados desde o início até o MÊS ANTERIOR (não inclui o mês atual!)
    const lancamentos = await prisma.livroCaixaLancamento.findMany({
      where: {
        statusFluxo: "EFETIVADO",
        OR: [
          // Caso 1: Todos os anos anteriores ao ano anterior
          {
            competenciaAno: {
              gte: anoInicio,
              lt: anoAnt
            }
          },
          // Caso 2: O ano atual/anterior, mas apenas até o mês anterior (exclusive)
          {
            competenciaAno: anoAnt,
            competenciaMes: {
              lte: mesAnt
            }
          }
        ]
      },
      orderBy: [
        { competenciaAno: 'asc' },
        { competenciaMes: 'asc' },
        { data: 'asc' }
      ],
      select: {
        competenciaAno: true,
        competenciaMes: true,
        es: true,
        valorCentavos: true
      }
    });

    console.log(`   📋 ${lancamentos.length} lançamentos efetivados encontrados`);

    // 4️⃣ Somar/subtrair os lançamentos
    for (const lanc of lancamentos) {
      if (lanc.es === "E") {
        saldoAcumulado += lanc.valorCentavos;
      } else if (lanc.es === "S") {
        saldoAcumulado -= lanc.valorCentavos;
      }
    }

    // 5️⃣ Somar saldos iniciais de contas abertas ANTES do período solicitado
    const primeiroDiaPeriodo = new Date(Date.UTC(ano, mes - 1, 1));
    const contasAnteriores = await prisma.livroCaixaConta.findMany({
      where: {
        saldoInicialCent: { not: 0 },
        dataInicial: { not: null, lt: primeiroDiaPeriodo },
      },
      select: { saldoInicialCent: true, nome: true },
    });
    for (const conta of contasAnteriores) {
      saldoAcumulado += conta.saldoInicialCent;
      console.log(`   💰 Saldo inicial conta "${conta.nome}": R$ ${(conta.saldoInicialCent / 100).toFixed(2)}`);
    }

    console.log(`   ✅ Saldo anterior calculado: R$ ${(saldoAcumulado / 100).toFixed(2)}\n`);

    return saldoAcumulado;

  } catch (error) {
    console.error("❌ Erro ao calcular saldo anterior:", error);
    return 0;
  }
}

/**
 * Versão simplificada: calcula saldo de um mês específico
 * @param {number} ano 
 * @param {number} mes 
 * @returns {Promise<number>}
 */
async function calcularSaldoMesEspecifico(ano, mes) {
  const saldoAnterior = await calcularSaldoAnterior(ano, mes);
  
  // Buscar lançamentos do mês atual
  const lancamentos = await prisma.livroCaixaLancamento.findMany({
    where: {
      competenciaAno: ano,
      competenciaMes: mes,
      statusFluxo: "EFETIVADO"
    },
    select: {
      es: true,
      valorCentavos: true
    }
  });

  let saldo = saldoAnterior;
  for (const lanc of lancamentos) {
    if (lanc.es === "E") {
      saldo += lanc.valorCentavos;
    } else if (lanc.es === "S") {
      saldo -= lanc.valorCentavos;
    }
  }

  return saldo;
}

function toBool(v) {
  if (v === true) return true;
  if (v === false) return false;
  if (v == null) return false;

  const s = String(v).trim().toLowerCase();
  return s === "true" || s === "1" || s === "on" || s === "yes" || s === "sim";
}
// GET /api/relatorios/emprestimos-socios
// ============================================================
router.get("/api/relatorios/emprestimos-socios", authenticate, requireAdmin, async (req, res) => {
  try {
    const ano = Number(req.query.ano) || new Date().getFullYear();
    const mes = Number(req.query.mes) || 0; // 0 = todos os meses
    const advogadoIdRaw = String(req.query.advogadoId || "ALL").trim();

    const where = {};
    if (mes > 0) {
      where.competenciaAno = ano;
      where.competenciaMes = mes;
    } else {
      where.competenciaAno = ano;
    }

    if (advogadoIdRaw !== "ALL" && !isNaN(Number(advogadoIdRaw))) {
      where.advogadoId = Number(advogadoIdRaw);
    }

    const emprestimosRaw = await prisma.emprestimoSocio.findMany({
      where,
      include: {
        advogado: { select: { id: true, nome: true } },
      },
      orderBy: [{ competenciaAno: "desc" }, { competenciaMes: "desc" }, { dataRegistro: "desc" }],
    });

    // Agrupar por advogado
    const porAdvogado = new Map();
    for (const e of emprestimosRaw) {
      if (!porAdvogado.has(e.advogadoId)) {
        porAdvogado.set(e.advogadoId, {
          advogadoId: e.advogadoId,
          advogadoNome: e.advogado.nome,
          items: [],
          totalPendenteCentavos: 0,
          totalQuitadoCentavos: 0,
        });
      }
      const grupo = porAdvogado.get(e.advogadoId);
      const saldoCentavos = Math.max(0, e.valorCentavos - (e.valorPagoCentavos || 0));
      grupo.items.push({
        id: e.id,
        competencia: `${String(e.competenciaMes).padStart(2, "0")}/${e.competenciaAno}`,
        competenciaAno: e.competenciaAno,
        competenciaMes: e.competenciaMes,
        valor: (e.valorCentavos / 100).toFixed(2),
        valorCentavos: e.valorCentavos,
        valorPagoCentavos: e.valorPagoCentavos || 0,
        saldoCentavos,
        descricao: e.descricao,
        quitado: e.quitado,
        dataRegistro: e.dataRegistro,
        dataQuitacao: e.dataQuitacao,
      });
      if (e.quitado) {
        grupo.totalQuitadoCentavos += e.valorCentavos;
      } else {
        grupo.totalPendenteCentavos += saldoCentavos;
      }
    }

    const emprestimos = Array.from(porAdvogado.values());
    const totalGeralPendenteCentavos = emprestimos.reduce((s, g) => s + g.totalPendenteCentavos, 0);
    const totalGeralQuitadoCentavos = emprestimos.reduce((s, g) => s + g.totalQuitadoCentavos, 0);

    res.json({
      emprestimos,
      totalGeralPendenteCentavos,
      totalGeralQuitadoCentavos,
    });
  } catch (error) {
    console.error("Erro em /api/relatorios/emprestimos-socios:", error);
    res.status(500).json({ message: "Erro ao buscar empréstimos de sócios." });
  }
});

// ============================================================
// POST /api/adiantamentos-socios — registrar adiantamento
// ============================================================
router.post("/api/adiantamentos-socios", authenticate, requireAdmin, async (req, res) => {
  try {
    const { advogadoId, clienteId, competenciaAno, competenciaMes, valorPrevistoCentavos, valorAdiantadoCentavos, observacoes, dataRegistro } = req.body;
    if (!advogadoId || !clienteId || !competenciaAno || !competenciaMes || !valorAdiantadoCentavos) {
      return res.status(400).json({ message: "Campos obrigatórios: advogadoId, clienteId, competenciaAno, competenciaMes, valorAdiantadoCentavos" });
    }
    const adiantamento = await prisma.adiantamentoSocio.create({
      data: {
        advogadoId: parseInt(advogadoId),
        clienteId: parseInt(clienteId),
        competenciaAno: parseInt(competenciaAno),
        competenciaMes: parseInt(competenciaMes),
        valorPrevistoCentavos: parseInt(valorPrevistoCentavos || 0),
        valorAdiantadoCentavos: parseInt(valorAdiantadoCentavos),
        observacoes: observacoes || null,
        dataRegistro: dataRegistro ? new Date(`${dataRegistro}T12:00:00`) : new Date(),
      },
      include: { cliente: { select: { id: true, nomeRazaoSocial: true } } },
    });
    res.json({
      id: adiantamento.id,
      clienteId: adiantamento.clienteId,
      clienteNome: adiantamento.cliente.nomeRazaoSocial,
      valorPrevistoCentavos: adiantamento.valorPrevistoCentavos,
      valorAdiantadoCentavos: adiantamento.valorAdiantadoCentavos,
      valorDevolvidoCentavos: 0,
      quitado: false,
      observacoes: adiantamento.observacoes,
      dataRegistro: adiantamento.dataRegistro,
    });
  } catch (error) {
    console.error("Erro em POST /api/adiantamentos-socios:", error);
    res.status(500).json({ message: "Erro ao registrar adiantamento." });
  }
});

// ============================================================
// PATCH /api/adiantamentos-socios/:id/devolver
// ============================================================
router.patch("/api/adiantamentos-socios/:id/devolver", authenticate, requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { valorDevolvidoCentavos, dataQuitacao } = req.body;
    const valorDev = parseInt(valorDevolvidoCentavos || 0);
    if (!valorDev || valorDev <= 0) return res.status(400).json({ message: "Valor inválido" });

    const adt = await prisma.adiantamentoSocio.findUnique({ where: { id } });
    if (!adt) return res.status(404).json({ message: "Adiantamento não encontrado" });
    if (adt.quitado) return res.status(400).json({ message: "Adiantamento já quitado" });

    const novoDevolvido = (adt.valorDevolvidoCentavos || 0) + valorDev;
    const quitado = novoDevolvido >= adt.valorAdiantadoCentavos;
    const updated = await prisma.adiantamentoSocio.update({
      where: { id },
      data: {
        valorDevolvidoCentavos: novoDevolvido,
        quitado,
        dataQuitacao: quitado ? (dataQuitacao ? new Date(`${dataQuitacao}T12:00:00`) : new Date()) : null,
      },
    });
    res.json({ id: updated.id, valorDevolvidoCentavos: updated.valorDevolvidoCentavos, quitado: updated.quitado, dataQuitacao: updated.dataQuitacao });
  } catch (error) {
    console.error("Erro em PATCH /api/adiantamentos-socios/:id/devolver:", error);
    res.status(500).json({ message: "Erro ao registrar devolução." });
  }
});

// ============================================================
// PUT /api/adiantamentos-socios/:id — editar adiantamento
// ============================================================
router.put("/api/adiantamentos-socios/:id", authenticate, requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { clienteId, valorPrevistoCentavos, valorAdiantadoCentavos, observacoes } = req.body;
    if (!id) return res.status(400).json({ message: "ID inválido" });
    if (!valorAdiantadoCentavos) return res.status(400).json({ message: "Valor adiantado é obrigatório" });
    const updated = await prisma.adiantamentoSocio.update({
      where: { id },
      data: {
        clienteId: clienteId ? parseInt(clienteId) : undefined,
        valorPrevistoCentavos: parseInt(valorPrevistoCentavos || 0),
        valorAdiantadoCentavos: parseInt(valorAdiantadoCentavos),
        observacoes: observacoes || null,
      },
      include: { cliente: { select: { id: true, nomeRazaoSocial: true } } },
    });
    res.json({
      id: updated.id,
      clienteId: updated.clienteId,
      clienteNome: updated.cliente.nomeRazaoSocial,
      valorPrevistoCentavos: updated.valorPrevistoCentavos,
      valorAdiantadoCentavos: updated.valorAdiantadoCentavos,
      valorDevolvidoCentavos: updated.valorDevolvidoCentavos,
      quitado: updated.quitado,
      observacoes: updated.observacoes,
      dataRegistro: updated.dataRegistro,
    });
  } catch (error) {
    console.error("Erro em PUT /api/adiantamentos-socios/:id:", error);
    res.status(500).json({ message: "Erro ao editar adiantamento." });
  }
});

// ============================================================
// DELETE /api/adiantamentos-socios/:id — excluir adiantamento
// ============================================================
router.delete("/api/adiantamentos-socios/:id", authenticate, requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ message: "ID inválido" });
    await prisma.adiantamentoSocio.delete({ where: { id } });
    res.json({ ok: true });
  } catch (error) {
    console.error("Erro em DELETE /api/adiantamentos-socios/:id:", error);
    res.status(500).json({ message: "Erro ao excluir adiantamento." });
  }
});

// ============================================================
// GET /api/relatorios/adiantamentos-socios
// ============================================================
router.get("/api/relatorios/adiantamentos-socios", authenticate, requireAdmin, async (req, res) => {
  try {
    const ano = Number(req.query.ano) || new Date().getFullYear();
    const mes = Number(req.query.mes) || 0;
    const advogadoIdRaw = String(req.query.advogadoId || "ALL").trim();

    const where = {};
    if (mes > 0) {
      where.competenciaAno = ano;
      where.competenciaMes = mes;
    } else {
      where.competenciaAno = ano;
    }
    if (advogadoIdRaw !== "ALL" && !isNaN(Number(advogadoIdRaw))) {
      where.advogadoId = Number(advogadoIdRaw);
    }

    const rows = await prisma.adiantamentoSocio.findMany({
      where,
      include: {
        advogado: { select: { id: true, nome: true } },
        cliente: { select: { id: true, nomeRazaoSocial: true } },
      },
      orderBy: [{ competenciaAno: "desc" }, { competenciaMes: "desc" }, { dataRegistro: "desc" }],
    });

    const porAdvogado = new Map();
    for (const a of rows) {
      if (!porAdvogado.has(a.advogadoId)) {
        porAdvogado.set(a.advogadoId, {
          advogadoId: a.advogadoId,
          advogadoNome: a.advogado.nome,
          items: [],
          totalPendenteCentavos: 0,
          totalQuitadoCentavos: 0,
        });
      }
      const grupo = porAdvogado.get(a.advogadoId);
      const saldoCentavos = Math.max(0, a.valorAdiantadoCentavos - (a.valorDevolvidoCentavos || 0));
      grupo.items.push({
        id: a.id,
        competencia: `${String(a.competenciaMes).padStart(2, "0")}/${a.competenciaAno}`,
        competenciaAno: a.competenciaAno,
        competenciaMes: a.competenciaMes,
        clienteId: a.clienteId,
        clienteNome: a.cliente.nomeRazaoSocial,
        valorPrevistoCentavos: a.valorPrevistoCentavos,
        valorAdiantadoCentavos: a.valorAdiantadoCentavos,
        valorDevolvidoCentavos: a.valorDevolvidoCentavos || 0,
        saldoCentavos,
        quitado: a.quitado,
        observacoes: a.observacoes,
        dataRegistro: a.dataRegistro,
        dataQuitacao: a.dataQuitacao,
      });
      if (a.quitado) {
        grupo.totalQuitadoCentavos += a.valorAdiantadoCentavos;
      } else {
        grupo.totalPendenteCentavos += saldoCentavos;
      }
    }

    const adiantamentos = Array.from(porAdvogado.values());
    res.json({
      adiantamentos,
      totalGeralPendenteCentavos: adiantamentos.reduce((s, g) => s + g.totalPendenteCentavos, 0),
      totalGeralQuitadoCentavos: adiantamentos.reduce((s, g) => s + g.totalQuitadoCentavos, 0),
    });
  } catch (error) {
    console.error("Erro em /api/relatorios/adiantamentos-socios:", error);
    res.status(500).json({ message: "Erro ao buscar adiantamentos." });
  }
});

// ============================================================
// GET /api/adiantamentos-socios/anos-resumo
// ============================================================
router.get("/api/adiantamentos-socios/anos-resumo", authenticate, requireAdmin, async (req, res) => {
  try {
    const rows = await prisma.adiantamentoSocio.groupBy({
      by: ["competenciaAno"],
      _count: { id: true },
      orderBy: { competenciaAno: "desc" },
    });
    const result = await Promise.all(rows.map(async (r) => {
      const pendente = await prisma.adiantamentoSocio.count({
        where: { competenciaAno: r.competenciaAno, quitado: false },
      });
      return { ano: r.competenciaAno, status: pendente === 0 ? "Quitados" : "Pendentes", total: r._count.id, pendentes: pendente };
    }));
    res.json(result);
  } catch (error) {
    console.error("Erro em /api/adiantamentos-socios/anos-resumo:", error);
    res.status(500).json({ message: "Erro ao buscar resumo por ano." });
  }
});

// ============================================================
// GET /api/emprestimos-socios/anos-resumo
// ============================================================
router.get("/api/emprestimos-socios/anos-resumo", authenticate, requireAdmin, async (req, res) => {
  try {
    const rows = await prisma.emprestimoSocio.groupBy({
      by: ["competenciaAno"],
      _count: { id: true },
      orderBy: { competenciaAno: "desc" },
    });

    const result = await Promise.all(rows.map(async (r) => {
      const pendente = await prisma.emprestimoSocio.count({
        where: { competenciaAno: r.competenciaAno, quitado: false },
      });
      return {
        ano: r.competenciaAno,
        status: pendente === 0 ? "Quitados" : "Pendentes",
        total: r._count.id,
        pendentes: pendente,
      };
    }));

    res.json(result);
  } catch (error) {
    console.error("Erro em /api/emprestimos-socios/anos-resumo:", error);
    res.status(500).json({ message: "Erro ao buscar resumo por ano." });
  }
});

// ============================================================
// PATCH /api/emprestimos-socios/:id/quitar
// ============================================================
router.patch("/api/emprestimos-socios/:id/quitar", authenticate, requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ message: "ID inválido" });

    const { dataPagamento, valorPagamentoCentavos, contaId } = req.body;
    const valorPago = parseInt(valorPagamentoCentavos || 0);
    if (!valorPago || valorPago <= 0) return res.status(400).json({ message: "Valor inválido" });
    const dataPag = dataPagamento ? new Date(`${dataPagamento}T12:00:00`) : new Date();
    const contaIdInt = contaId ? parseInt(contaId) : null;

    const emprestimo = await prisma.emprestimoSocio.findUnique({
      where: { id },
      include: { advogado: { select: { nome: true } } },
    });
    if (!emprestimo) return res.status(404).json({ message: "Empréstimo não encontrado" });
    if (emprestimo.quitado) return res.status(400).json({ message: "Empréstimo já quitado" });

    const novoValorPago = (emprestimo.valorPagoCentavos || 0) + valorPago;
    const quitado = novoValorPago >= emprestimo.valorCentavos;
    const competencia = `${String(emprestimo.competenciaMes).padStart(2, "0")}/${emprestimo.competenciaAno}`;
    const compPagAno = dataPag.getFullYear();
    const compPagMes = dataPag.getMonth() + 1;

    const [updated] = await prisma.$transaction([
      prisma.emprestimoSocio.update({
        where: { id },
        data: {
          valorPagoCentavos: novoValorPago,
          quitado,
          dataQuitacao: quitado ? dataPag : undefined,
        },
      }),
      prisma.livroCaixaLancamento.create({
        data: {
          competenciaAno: compPagAno,
          competenciaMes: compPagMes,
          data: dataPag,
          documento: null,
          es: "S",
          clienteFornecedor: emprestimo.advogado.nome,
          historico: `Pagamento de empréstimo - Competência ${competencia}`,
          valorCentavos: valorPago,
          contaId: contaIdInt,
          ordemDia: 0,
          origem: "EMPRESTIMO_SOCIO_PAGAMENTO",
          status: "OK",
          statusFluxo: "EFETIVADO",
          referenciaOrigem: `EMPRESTIMO_PAG_${id}_${Date.now()}`,
        },
      }),
    ]);

    res.json({ message: quitado ? "Empréstimo quitado!" : "Pagamento registrado!", emprestimo: updated });
  } catch (error) {
    console.error("Erro em PATCH /api/emprestimos-socios/:id/quitar:", error);
    res.status(500).json({ message: "Erro ao registrar pagamento." });
  }
});

// GET /api/repasses/relatorio?ano=YYYY&mes=M&advogadoId=ALL|ID&ultimos=10
// - Advogado logado: só vê o próprio, ignora advogadoId vindo do client
// - Admin: pode escolher um advogado ou ALL
// - Tendência: 6 meses anteriores (M1..M6), só repasses (sem parcela fixa)
// ============================================================
router.get("/api/relatorios/repasses", authenticate, async (req, res) => {
  try {
    const ano = Number(req.query.ano);
    const mes = Number(req.query.mes);
    const advogadoIdRaw = String(req.query.advogadoId || "").trim(); // "ALL" | "123" | ""
    const ultimos = Math.max(1, Math.min(50, Number(req.query.ultimos || 10)));

    if (!ano || Number.isNaN(ano) || ano < 2000) {
      return res.status(400).json({ message: "Parâmetro 'ano' inválido." });
    }
    if (!mes || Number.isNaN(mes) || mes < 1 || mes > 12) {
      return res.status(400).json({ message: "Parâmetro 'mes' inválido." });
    }

    const roleStr = String(req.user?.role || "").toUpperCase();
    const isAdmin = roleStr === "ADMIN";

    // -------------------------
    // Resolve escopo (admin vs advogado)
    // -------------------------
    let advogadoIds = [];

    if (!isAdmin) {
      const myAdvId = await getUserAdvogadoId(req.user?.id);
      if (!myAdvId) return res.status(403).json({ message: "Usuário não vinculado a um advogado." });
      advogadoIds = [myAdvId];
    } else {
      // Admin: pode filtrar por 1 advogado ou ALL
      if (!advogadoIdRaw || advogadoIdRaw.toUpperCase() === "ALL") {
        const advs = await prisma.advogado.findMany({ select: { id: true } });
        advogadoIds = advs.map((a) => a.id);
      } else {
        const idNum = Number(advogadoIdRaw);
        if (!idNum) return res.status(400).json({ message: "advogadoId inválido." });
        advogadoIds = [idNum];
      }
    }

    // -------------------------
    // Helpers
    // -------------------------

    // ===============================
    // CLIENTE / FORNECEDOR (C | F | A)
    // ===============================

    const normalizeName = (s) =>
      String(s || "").replace(/\s+/g, " ").trim();

    const mergeTipo = (current, desired) => {
      if (!current) return desired;
      if (current === "A" || desired === "A") return "A";
      if (current === desired) return current;
      return "A"; // C + F => A
    };

    const makePlaceholderCpfCnpj = () => {
      const base = String(Date.now()); // 13 dígitos
      const rand = String(crypto.randomBytes(1)[0] % 10);
      return (base + rand).slice(0, 14);
    };

    const getOrCreatePessoaByNomeETipo = async (nome, tipoDesejado /* C | F */) => {
      const nomeClean = normalizeName(nome);
      if (!nomeClean) return null;

      const existing = await prisma.cliente.findFirst({
        where: {
          nomeRazaoSocial: { equals: nomeClean, mode: "insensitive" },
        },
        select: { id: true, nomeRazaoSocial: true, tipo: true },
      });

      if (!existing) {
        const created = await prisma.cliente.create({
          data: {
            nomeRazaoSocial: nomeClean,
            cpfCnpj: makePlaceholderCpfCnpj(), // estratégia B
            email: null,
            telefone: null,
            observacoes: "Criado automaticamente na importação do Livro Caixa (PDF).",
            tipo: tipoDesejado,
          },
          select: { id: true, nomeRazaoSocial: true, tipo: true },
        });

        return { pessoa: created, created: true, promoted: false };
      }

      const novoTipo = mergeTipo(existing.tipo, tipoDesejado);
      if (novoTipo !== existing.tipo) {
        const updated = await prisma.cliente.update({
          where: { id: existing.id },
          data: { tipo: novoTipo },
          select: { id: true, nomeRazaoSocial: true, tipo: true },
        });

        return { pessoa: updated, created: false, promoted: true };
      }

      return { pessoa: existing, created: false, promoted: false };
    };

    const pad2 = (n) => String(n).padStart(2, "0");
    const labelMesAno = (a, m) => `${pad2(m)}/${a}`;

    function prevMonths(baseAno, baseMes, count) {
      // retorna array do mais antigo -> mais recente (M1..M6)
      const out = [];
      let y = baseAno;
      let m = baseMes;
      for (let i = 0; i < count; i++) {
        // volta 1 mês
        m -= 1;
        if (m <= 0) {
          m = 12;
          y -= 1;
        }
        out.push({ ano: y, mes: m });
      }
      return out.reverse();
    }

    // -------------------------
    // 2) Carrega advogados (com campos de parcela fixa)
    // -------------------------
    const advogados = await prisma.advogado.findMany({
      where: { id: { in: advogadoIds } },
      select: {
        id: true,
        nome: true,
        // ajuste se seus nomes forem diferentes:
        parcelaFixaAtiva: true,
        parcelaFixaNome: true,
        parcelaFixaTipo: true,
        parcelaFixaValor: true, // ou parcelaFixaValorCentavos
      },
      orderBy: { nome: "asc" },
    });

    // -------------------------
    // 3) Repasses da competência (itens detalhados)
    // -------------------------
    // Observação: aqui eu uso um formato genérico, pois seu schema exato do Prisma
    // não está todo aqui. A ideia é:
    // - buscar repasseRealizado (competenciaAno/Mes)
    // - incluir itens com contrato->cliente e data do repasse
    //
    // Se sua model for outra (ex.: repasseLancamento), me diga o nome exato e eu ajusto.
    const repassesPorAdv = new Map(); // advId -> { itens:[], totalCent:0 }

    // ✅ Buscar saldos históricos (inclui mês atual e anteriores)
    const saldosHistoricos = await prisma.repasseRealizado.findMany({
      where: {
        advogadoId: { in: advogadoIds },
        OR: [
          {
            competenciaAno: { lt: ano },
          },
          {
            competenciaAno: ano,
            competenciaMes: { lte: mes }, // Inclui mês atual
          },
        ],
      },
      select: {
        advogadoId: true,
        competenciaAno: true,
        competenciaMes: true,
        dataRepasse: true,
        saldoPosteriorCentavos: true,
        saldoConsumidoCentavos: true,
        saldoGeradoCentavos: true,
        createdAt: true,
      },
      orderBy: [
        { competenciaAno: 'desc' },
        { competenciaMes: 'desc' },
        { dataRepasse: 'desc' },
      ],
    });

    // Separar: saldos anteriores (para cálculo) e histórico completo (para exibição)
    const saldosAnteriores = saldosHistoricos.filter(s =>
      s.competenciaAno < ano || (s.competenciaAno === ano && s.competenciaMes < mes)
    );

    // ✅ Pegar o saldo mais recente de cada advogado
    const saldoAnteriorMap = new Map();
    for (const s of saldosAnteriores) {
      if (!saldoAnteriorMap.has(s.advogadoId)) {
        saldoAnteriorMap.set(s.advogadoId, Number(s.saldoPosteriorCentavos || 0));
      }
    }

    // ✅ Criar histórico de saldos por mês (últimos N meses + agregado anterior)
    // N é controlado pelo parâmetro 'ultimos' (max 6)
    // Inclui o mês atual se houver repasse
    const mesesSaldoHistorico = Math.min(ultimos, 6);
    const saldoHistoricoPorAdv = new Map(); // advId -> [{ano, mes, label, saldoCentavos, consumido, gerado}]
    for (const advId of advogadoIds) {
      // Agrupar saldos por competência (pegar o último saldo de cada mês)
      // Usa saldosHistoricos que inclui o mês atual
      const saldosPorMes = new Map(); // "YYYY-MM" -> dados
      for (const s of saldosHistoricos) {
        if (s.advogadoId !== advId) continue;
        const key = `${s.competenciaAno}-${String(s.competenciaMes).padStart(2, '0')}`;
        if (!saldosPorMes.has(key)) {
          saldosPorMes.set(key, {
            ano: s.competenciaAno,
            mes: s.competenciaMes,
            saldoCentavos: Number(s.saldoPosteriorCentavos || 0),
            saldoConsumidoCentavos: Number(s.saldoConsumidoCentavos || 0),
            saldoGeradoCentavos: Number(s.saldoGeradoCentavos || 0),
          });
        } else {
          // Acumular consumido/gerado do mesmo mês (pode ter mais de um repasse)
          const existing = saldosPorMes.get(key);
          existing.saldoConsumidoCentavos += Number(s.saldoConsumidoCentavos || 0);
          existing.saldoGeradoCentavos += Number(s.saldoGeradoCentavos || 0);
        }
      }

      // Ordenar por data (mais recente primeiro)
      const sorted = Array.from(saldosPorMes.values())
        .sort((a, b) => {
          if (a.ano !== b.ano) return b.ano - a.ano;
          return b.mes - a.mes;
        });

      // Pegar os últimos N meses (max 6)
      const ultimosN = sorted.slice(0, mesesSaldoHistorico).reverse(); // mais antigo -> mais recente

      // Se houver mais meses, agregar os anteriores
      let saldoAnteriorAgregado = null;
      if (sorted.length > mesesSaldoHistorico) {
        const anteriores = sorted.slice(mesesSaldoHistorico);
        // anteriores[0]  = mês mais recente do grupo agregado (sorted é desc)
        // anteriores[N-1] = mês mais antigo de todos
        const maisRecente = anteriores[0];   // fim do período agregado — saldo correto
        const maisAntigo  = anteriores[anteriores.length - 1]; // para compor o label "De … a …"
        const totalConsumidoAnterior = anteriores.reduce((sum, s) => sum + s.saldoConsumidoCentavos, 0);
        const totalGeradoAnterior = anteriores.reduce((sum, s) => sum + s.saldoGeradoCentavos, 0);
        const labelFim = `${String(maisRecente.mes).padStart(2, '0')}/${maisRecente.ano}`;
        const labelInicio = `${String(maisAntigo.mes).padStart(2, '0')}/${maisAntigo.ano}`;
        saldoAnteriorAgregado = {
          label: anteriores.length === 1
            ? labelFim
            : `${labelInicio} – ${labelFim}`,
          saldoCentavos: maisRecente.saldoCentavos, // saldo ao FIM do período agregado
          saldoConsumidoCentavos: totalConsumidoAnterior,
          saldoGeradoCentavos: totalGeradoAnterior,
          mesesAgregados: anteriores.length,
        };
      }

      saldoHistoricoPorAdv.set(advId, {
        historico: ultimosN.map(s => ({
          ano: s.ano,
          mes: s.mes,
          label: `${String(s.mes).padStart(2, '0')}/${s.ano}`,
          saldoCentavos: s.saldoCentavos,
          saldoConsumidoCentavos: s.saldoConsumidoCentavos,
          saldoGeradoCentavos: s.saldoGeradoCentavos,
        })),
        agregadoAnterior: saldoAnteriorAgregado,
      });
    }

    for (const adv of advogados) {
      repassesPorAdv.set(adv.id, {
        itens: [],
        totalCent: 0,
        saldoPosteriorCentavos: null,
        saldoPosteriorRef: null, // guarda a data/ordem do saldo
        saldoAnteriorCentavos: saldoAnteriorMap.get(adv.id) || 0,  // ✅ NOVO CAMPO
      });
    }

    // Tente primeiro por uma model provável: RepasseRealizado + itens (ajuste se necessário)
    const repasses = await prisma.repasseRealizado.findMany({
      where: {
        competenciaAno: ano,
        competenciaMes: mes,
        advogadoId: { in: advogadoIds },
      },
      include: {
        advogado: true,
        lancamentos: {
          include: {
            contrato: { include: { cliente: true } },
            parcela: true,
          },
        },
      },
      orderBy: [{ dataRepasse: "asc" }],
    });

    for (const rr of repasses) {
      const pack = repassesPorAdv.get(rr.advogadoId);
      if (!pack) continue;

        const saldoRR = rr?.saldoPosteriorCentavos;
        const refRR = rr?.dataRepasse || rr?.createdAt || null;

      const lancs = Array.isArray(rr.lancamentos) ? rr.lancamentos : [];

      // soma do previsto (por lançamentos)
      const somaPrevisto = lancs.reduce((acc, l) => acc + Number(l?.valorRepasseCentavos || 0), 0);

      // total efetivamente repassado (fonte da verdade)
      const efetivadoCent = Number(rr?.valorEfetivadoCentavos || 0);

      // guarda saldo do repasse (para seção/coluna)
      pack.saldoPosteriorCentavos = Number(rr?.saldoPosteriorCentavos ?? pack.saldoPosteriorCentavos ?? 0);

      // rateio proporcional do efetivado nas linhas do detalhamento
      let acumuladoRateio = 0;

      for (let i = 0; i < lancs.length; i++) {
        const l = lancs[i];
        const previstoCent = Number(l?.valorRepasseCentavos || 0);

        let recebidoCent = 0;
        if (somaPrevisto > 0) {
          // proporcional
          recebidoCent = Math.round((efetivadoCent * previstoCent) / somaPrevisto);
          acumuladoRateio += recebidoCent;
        } else {
          recebidoCent = 0;
        }

        pack.itens.push({
          cliente: l?.contrato?.cliente?.nomeRazaoSocial || "—",
          contrato: l?.contrato?.numeroContrato || l?.contrato?.numero || "—",
          dataRecebimento: l?.parcela?.dataRecebimento || rr?.dataRepasse || null,

          // ✅ previsto/calculado por contrato/parcela
          valorCentavos: previstoCent,

          // ✅ efetivamente recebido (rateado)
          valorRecebidoCentavos: recebidoCent,
        });
      }

      // corrige arredondamento (garante que soma do detalhamento = efetivado)
      const diff = efetivadoCent - acumuladoRateio;
      if (diff !== 0 && pack.itens.length) {
        pack.itens[pack.itens.length - 1].valorRecebidoCentavos =
          Number(pack.itens[pack.itens.length - 1].valorRecebidoCentavos || 0) + diff;
      }

      // ✅ total do relatório = efetivado (não o somatório previsto)
      pack.totalCent += efetivadoCent;

    }

    // -------------------------
    // 4) Parcela fixa recebida (não entra na tendência)
    // -------------------------
    // Como não temos aqui o model exato de "recebimento parcela fixa",
    // vou buscar no Livro Caixa por lançamentos de origem "PARCELA_FIXA"
    // ou por histórico contendo o nome. AJUSTE se você tiver tabela própria.
    //
    // Importante: isso só serve para "listar recebimentos" do mês.
    const parcelasFixasPorAdv = new Map(); // advId -> { itens:[], totalCent:0, nome, tipo }

    for (const adv of advogados) {
      parcelasFixasPorAdv.set(adv.id, {
        nome: adv.parcelaFixaNome || "Parcela fixa",
        tipo: adv.parcelaFixaTipo || null,
        itens: [],
        totalCent: 0,
      });
    }

    // Busca no mês pelo Livro Caixa (se sua "parcela fixa" é lançada lá)
    const inicio = new Date(ano, mes - 1, 1, 0, 0, 0);
    const fim = new Date(ano, mes, 0, 23, 59, 59);

    // se seu schema não tiver advogadoId em livroCaixaLancamento, remova esse filtro e
    // use heurística por historico (nome) e origem.
    const lcFixas = await prisma.livroCaixaLancamento.findMany({
      where: {
        data: { gte: inicio, lte: fim },
        statusFluxo: "EFETIVADO",
        es: "E", // entrada
        advogadoId: { in: advogadoIds }, // se não existir no schema, vai estourar => me avise
      },
      orderBy: [{ data: "asc" }],
    }).catch(() => []);

    for (const l of lcFixas) {
      const advId = Number(l.advogadoId);
      const pack = parcelasFixasPorAdv.get(advId);
      if (!pack) continue;

      // filtro conservador: se tiver origem PARCELA_FIXA ou historico menciona
      const hist = String(l.historico || "").toLowerCase();
      const nome = String(pack.nome || "").toLowerCase();
      const ok =
        String(l.origem || "") === "PARCELA_FIXA" ||
        (nome && hist.includes(nome));

      if (!ok) continue;

      const v = Number(l.valorCentavos || 0);
      pack.itens.push({
        nome: pack.nome,
        dataRecebimento: l.data,
        valorCentavos: v,
      });
      pack.totalCent += v;
    }

    // -------------------------
    // 5) Tendência M1..M6 (somente REPASSES variáveis)
    //    Regra: parcela fixa NÃO entra => usar RepasseLancamento com parcelaId != null
    // -------------------------
    const ymKey = (a, m) => `${a}-${pad2(m)}`;
    const ymLabel = (a, m) => `${pad2(m)}/${a}`;

    function prevMonthsRelatorio(baseAno, baseMes, count) {
      // retorna array do mais antigo -> mais recente (M1..M6), sempre meses anteriores (M-6..M-1)
      const out = [];
      let y = baseAno;
      let m = baseMes;
      for (let i = 0; i < count; i++) {
        m -= 1;
        if (m <= 0) { m = 12; y -= 1; }
        out.push({ ano: y, mes: m });
      }
      return out.reverse();
    }

    const tendenciaMesesRelatorio = prevMonthsRelatorio(ano, mes, 6); // 6 meses anteriores à competência do relatório
    const ymSet = new Set(tendenciaMesesRelatorio.map((x) => ymKey(x.ano, x.mes)));

    // ✅ NOVO: Buscar repasses EFETIVADOS dos últimos 6 meses
    const repassesEfetivados = await prisma.repasseRealizado.findMany({
      where: {
        advogadoId: { in: advogadoIds },
        OR: tendenciaMesesRelatorio.map((mm) => ({
          competenciaAno: mm.ano,
          competenciaMes: mm.mes,
        })),
      },
      select: {
        advogadoId: true,
        competenciaAno: true,
        competenciaMes: true,
        valorEfetivadoCentavos: true,
      },
    });

    // ✅ Criar mapa de valores efetivados por (advId, ym)
    const efetivadoMap = new Map(); // `${advId}|${ym}` -> centavos
    for (const r of repassesEfetivados) {
      const ym = ymKey(r.competenciaAno, r.competenciaMes);
      if (!ymSet.has(ym)) continue;
      const k = `${r.advogadoId}|${ym}`;
      efetivadoMap.set(k, (efetivadoMap.get(k) || 0) + Number(r.valorEfetivadoCentavos || 0));
    }

    // Busca tudo de uma vez: lançamentos de repasse (variáveis) nos meses da janela
    const lancsTend = await prisma.repasseLancamento.findMany({
      where: {
        // somente repasses variáveis
        parcelaId: { not: null },

        repasseRealizado: {
          advogadoId: { in: advogadoIds },
          OR: tendenciaMesesRelatorio.map((mm) => ({
            competenciaAno: mm.ano,
            competenciaMes: mm.mes,
          })),
        },
      },
      select: {
        valorRepasseCentavos: true,
        repasseRealizado: {
          select: {
            competenciaAno: true,
            competenciaMes: true,
            advogadoId: true,
          },
        },
      },
    });

    // soma por (advogadoId, ym) - valores CALCULADOS/PREVISTOS
    const sumMap = new Map(); // `${advId}|${ym}` -> centavos
    for (const l of lancsTend) {
      const rr = l.repasseRealizado;
      if (!rr?.advogadoId) continue;
      const ym = ymKey(rr.competenciaAno, rr.competenciaMes);
      if (!ymSet.has(ym)) continue;

      const k = `${rr.advogadoId}|${ym}`;
      sumMap.set(k, (sumMap.get(k) || 0) + Number(l.valorRepasseCentavos || 0));
    }

    // monta série por advogado com ícones
    const tendenciaPorAdv = new Map(); // advId -> [{ano,mes,label,totalCentavos,valorEfetivadoCentavos,icon}]
    for (const advId of advogadoIds) {
      const serie = tendenciaMesesRelatorio.map((mm, idx) => {
        const ym = ymKey(mm.ano, mm.mes);
        const total = sumMap.get(`${advId}|${ym}`) || 0;
        const efetivado = efetivadoMap.get(`${advId}|${ym}`) || 0;  // ✅ NOVO CAMPO

        return {
          ano: mm.ano,
          mes: mm.mes,
          label: ymLabel(mm.ano, mm.mes),
          totalCentavos: total,                    // Valor calculado/previsto
          valorEfetivadoCentavos: efetivado,       // ✅ Valor realizado/efetivado
          icon: idx === 0 ? "•" : "■",             // placeholder (base = •)
        };
      });

      // ✅ ícone usa VALORES EFETIVADOS para comparação (não calculados)
      for (let i = 1; i < serie.length; i++) {
        const prev = serie[i - 1].valorEfetivadoCentavos || 0;
        const cur = serie[i].valorEfetivadoCentavos || 0;
        if (cur > prev) serie[i].icon = "▲";
        else if (cur < prev) serie[i].icon = "▼";
        else serie[i].icon = "■";
      }

      tendenciaPorAdv.set(advId, serie);
    }

    // -------------------------
    // 6) Empréstimos e Adiantamentos pendentes por advogado
    // -------------------------

    // Empréstimos não quitados
    const emprestimosRows = await prisma.emprestimoSocio.findMany({
      where: { advogadoId: { in: advogadoIds }, quitado: false },
      select: {
        id: true, advogadoId: true, competenciaAno: true, competenciaMes: true,
        valorCentavos: true, valorPagoCentavos: true, descricao: true, dataRegistro: true,
      },
      orderBy: [{ competenciaAno: 'asc' }, { competenciaMes: 'asc' }],
    });

    const emprestimosPorAdv = new Map(); // advId -> []
    for (const e of emprestimosRows) {
      if (!emprestimosPorAdv.has(e.advogadoId)) emprestimosPorAdv.set(e.advogadoId, []);
      emprestimosPorAdv.get(e.advogadoId).push({
        id: e.id,
        competencia: labelMesAno(e.competenciaAno, e.competenciaMes),
        descricao: e.descricao || "Empréstimo",
        valorCentavos: Number(e.valorCentavos || 0),
        valorPagoCentavos: Number(e.valorPagoCentavos || 0),
        saldoPendenteCentavos: Number(e.valorCentavos || 0) - Number(e.valorPagoCentavos || 0),
        dataRegistro: e.dataRegistro,
      });
    }

    // Adiantamentos não quitados (com nome do cliente)
    const adiantamentosRows = await prisma.adiantamentoSocio.findMany({
      where: { advogadoId: { in: advogadoIds }, quitado: false },
      include: { cliente: { select: { nomeRazaoSocial: true } } },
      orderBy: [{ competenciaAno: 'asc' }, { competenciaMes: 'asc' }],
    });

    const adiantamentosPorAdv = new Map(); // advId -> []
    for (const a of adiantamentosRows) {
      if (!adiantamentosPorAdv.has(a.advogadoId)) adiantamentosPorAdv.set(a.advogadoId, []);
      adiantamentosPorAdv.get(a.advogadoId).push({
        id: a.id,
        competencia: labelMesAno(a.competenciaAno, a.competenciaMes),
        cliente: a.cliente?.nomeRazaoSocial || "—",
        valorAdiantadoCentavos: Number(a.valorAdiantadoCentavos || 0),
        valorDevolvidoCentavos: Number(a.valorDevolvidoCentavos || 0),
        saldoPendenteCentavos: Number(a.valorAdiantadoCentavos || 0) - Number(a.valorDevolvidoCentavos || 0),
        observacoes: a.observacoes || null,
        dataRegistro: a.dataRegistro,
      });
    }

    // -------------------------
    // 7) Monta payload final
    // -------------------------

    const out = advogados.map((adv) => {
      const rep = repassesPorAdv.get(adv.id) || { itens: [], totalCent: 0, saldoAnteriorCentavos: 0 };
      const pf = parcelasFixasPorAdv.get(adv.id) || { itens: [], totalCent: 0, nome: null, tipo: null };
      const saldoHist = saldoHistoricoPorAdv.get(adv.id) || { historico: [], agregadoAnterior: null };

      const emprestimos = emprestimosPorAdv.get(adv.id) || [];
      const adiantamentos = adiantamentosPorAdv.get(adv.id) || [];

      return {
        advogado: { id: adv.id, nome: adv.nome },
        competencia: { ano, mes, label: labelMesAno(ano, mes) },

        repasses: rep.itens,
        totalRepassesCentavos: rep.totalCent,
        saldoPosteriorCentavos: Number(rep.saldoPosteriorCentavos ?? 0),
        saldoAnteriorCentavos: Number(rep.saldoAnteriorCentavos ?? 0),

        parcelaFixa: {
          ativa: !!adv.parcelaFixaAtiva,
          nome: adv.parcelaFixaNome || null,
          tipo: adv.parcelaFixaTipo || null,
          valorConfigurado: adv.parcelaFixaValor || null,
          recebimentos: pf.itens,
          totalCentavos: pf.totalCent,
        },

        totalGeralCentavos: rep.totalCent + pf.totalCent,
        tendencia6m: tendenciaPorAdv.get(adv.id) || [],
        saldoHistorico: saldoHist.historico,
        saldoAgregadoAnterior: saldoHist.agregadoAnterior,

        emprestimos,   // pendentes (não quitados)
        adiantamentos, // pendentes (não quitados)
        totalEmprestimosPendenteCentavos: emprestimos.reduce((s, e) => s + e.saldoPendenteCentavos, 0),
        totalAdiantamentosPendenteCentavos: adiantamentos.reduce((s, a) => s + a.saldoPendenteCentavos, 0),
      };
    });

    // Quando "Todos", omite advogados sem repasse no mês
    const isAllMode = isAdmin && (!advogadoIdRaw || advogadoIdRaw.toUpperCase() === "ALL");
    const items = isAllMode
      ? out.filter(item => item.repasses.length > 0 || item.parcelaFixa.totalCentavos > 0)
      : out;

    res.json({
      competencia: { ano, mes, label: labelMesAno(ano, mes) },
      scope: { isAdmin, advogadoId: isAdmin ? (advogadoIdRaw || "ALL") : "SELF" },
      ultimos,
      items,
    });
  } catch (e) {
    console.error("❌ Erro no relatório de repasses:", e);
    res.status(500).json({ message: e.message || "Erro ao gerar relatório." });
  }
});

// ============================================================
// RELATÓRIO — FLUXO DE CAIXA CONSOLIDADO (PERÍODO)
// Front chama: GET /relatorios/fluxo-caixa/consolidado?dtIni=YYYY-MM-DD&dtFim=YYYY-MM-DD&contaId=ALL|<id>&contaId=<id>...&incluirPrevistos=0|1
// ============================================================

export default router;
export { toBool, calcularSaldoAnterior, calcularSaldoMesEspecifico };
