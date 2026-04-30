// ============================================================
// schedulers/processos.js — Sync diário de processos judiciais
// Roda às 7h BRT (10h UTC), usa SchedulerLock para persistência
// ============================================================
import prisma from "../lib/prisma.js";
import { sendEmail } from "../lib/email.js";
import { _schedulerShouldRun, _schedulerMarkRun } from "../lib/schedulerLock.js";
import { _syncAdvogado, buildEmailAndamentos } from "../routes/processos.js";
import { verificarChaveDatajud } from "../lib/datajud.js";

const IS_TEST = process.env.NODE_ENV === "test";

export function startProcessosScheduler() {
  if (IS_TEST) return;

  setInterval(async () => {
    const now = new Date();
    const utcHour = now.getUTCHours();
    const utcMin  = now.getUTCMinutes();
    // 7h BRT = 10h UTC
    if (utcHour !== 10 || utcMin > 5) return;

    const hoje = now.toISOString().slice(0, 10);
    if (!(await _schedulerShouldRun("processos-sync", hoje))) return;
    await _schedulerMarkRun("processos-sync", hoje);

    // ── Verificação semanal da chave DataJud (toda segunda-feira) ─────────────
    if (now.getUTCDay() === 1) { // 1 = segunda-feira
      try {
        const chave = await verificarChaveDatajud();
        if (chave.changed) {
          // Notifica admins via chat
          const admins = await prisma.usuario.findMany({
            where: { ativo: true, role: "ADMIN" },
            select: { id: true },
          });
          const msg = chave.renderOk
            ? `🔑 *DataJud: chave API atualizada automaticamente*\nA chave pública do CNJ mudou e foi atualizada no sistema e no Render.\nNenhuma ação necessária.`
            : `⚠️ *DataJud: chave API atualizada em memória*\nA chave pública do CNJ mudou. Foi atualizada em memória (funciona até próximo restart).\n*Ação necessária*: adicione \`DATAJUD_API_KEY=${chave.newKey}\` no Render Environment.`;
          await Promise.allSettled(admins.map(a =>
            prisma.mensagemChat.create({
              data: { remetenteId: a.id, destinatarioId: a.id, conteudo: msg, tipoMensagem: "CHAT" },
            })
          ));
        }
      } catch (e) {
        console.warn("⚠️  Verificação chave DataJud:", e.message);
      }
    }

    console.log("⚖️  Scheduler processos: iniciando sync diário...");
    try {
      const advogados = await prisma.advogado.findMany({
        where: { ativo: true },
        select: { id: true, nome: true, oab: true, email: true },
      });

      let totalNovos = 0;
      const resumoPorAdv = []; // { nome, email, qtd, processosList[] }

      for (const adv of advogados) {
        try {
          const r = await _syncAdvogado(adv);
          if (r.novosAndamentos > 0) {
            totalNovos += r.novosAndamentos;
            // Busca os processos com andamentos novos para o e-mail
            const comNovos = await prisma.processoJudicial.findMany({
              where: {
                advogadoId: adv.id,
                andamentos: { some: { notificado: false } },
              },
              select: {
                numeroProcesso: true,
                tribunal: true,
                _count: { select: { andamentos: { where: { notificado: false } } } },
              },
            });
            resumoPorAdv.push({
              nome:  adv.nome,
              email: adv.email,
              qtd:   r.novosAndamentos,
              processosList: comNovos.map(p => ({
                numeroProcesso: p.numeroProcesso,
                tribunal:       p.tribunal,
                novos:          p._count.andamentos,
              })),
            });
          }
        } catch (e) {
          console.warn(`⚠️  Processos sync ${adv.nome}:`, e.message);
        }
      }

      if (totalNovos > 0) {
        // E-mail individual para cada advogado com novos andamentos
        await Promise.allSettled(
          resumoPorAdv
            .filter(r => r.email)
            .map(r =>
              sendEmail({
                to:      r.email,
                subject: `Addere — ${r.qtd} novo(s) andamento(s) nos seus processos`,
                html:    buildEmailAndamentos(r.nome, r.qtd, r.processosList),
              })
            )
        );

        // Notificação para admins via chat interno
        const admins = await prisma.usuario.findMany({
          where: { ativo: true, role: "ADMIN" },
          select: { id: true },
        });
        const linhas = resumoPorAdv
          .map(r => `• ${r.nome}: ${r.qtd} andamento(s)`)
          .join("\n");
        const msg = `⚖️ *Novos andamentos processuais* (${hoje})\n${linhas}\n\nAcesse Jurídico → Processos para ver os detalhes.`;

        await Promise.allSettled(
          admins.map(a =>
            prisma.mensagemChat.create({
              data: {
                remetenteId:   a.id,
                destinatarioId: a.id,
                conteudo:      msg,
                tipoMensagem:  "CHAT",
              },
            })
          )
        );

        console.log(`✅ Processos sync: ${totalNovos} novos andamentos para ${resumoPorAdv.length} advogado(s)`);
      } else {
        console.log("✅ Processos sync: nenhum andamento novo");
      }
    } catch (e) {
      console.error("❌ Scheduler processos:", e.message);
    }
  }, 5 * 60 * 1000); // verifica a cada 5 minutos
}
