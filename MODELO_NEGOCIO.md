# Modelo de Negócio — AMR Ads Control
**Versão:** 1.0 | **Data:** 18/04/2026 | **Status:** Rascunho estratégico

---

## 1. O Produto

**AMR Ads Control** é uma plataforma SaaS de monitoramento e inteligência de tráfego pago.

Conecta as contas de Google Ads e Meta Ads do cliente, coleta dados diariamente e entrega:
- Dashboard executivo com KPIs em tempo real
- Relatório semanal automático (o que funcionou, o que pausar, onde escalar)
- Alertas de anomalia por email (gasto fora de padrão, leads zerados)
- Gestão de leads gerados pelas campanhas
- Meta mensal com acompanhamento de progresso

O dono do negócio abre uma tela, em 30 segundos sabe onde está o dinheiro.

---

## 2. O Problema que Resolve

Negócios que investem em tráfego pago enfrentam três dores crônicas:

| Dor | Realidade atual |
|-----|----------------|
| **Não sabe se está funcionando** | Acessa as plataformas raramente, não sabe interpretar os dados |
| **Não sabe o que pausar** | Continua pagando por campanhas que não geram leads |
| **Não sabe o que escalar** | Perde oportunidade de dobrar o que já funciona |
| **Relatório da agência é opaco** | PDF bonito, sem ação clara |
| **Dinheiro sendo desperdiçado sem alerta** | Descobre o problema semanas depois |

---

## 3. Público-Alvo

### Perfil primário — Profissional liberal / pequeno negócio de serviços
- Advogados, médicos, dentistas, psicólogos, contadores, consultores
- Investem entre R$ 1.500 e R$ 15.000/mês em tráfego pago
- Têm agência ou gestor de tráfego — mas não conseguem acompanhar os resultados
- Precisam de clareza, não de mais dados

### Perfil secundário — Agências de tráfego pago
- Gerenciam 10–50 clientes
- Perdem tempo gerando relatórios manuais todo mês
- Precisam de uma ferramenta de gestão que impressione o cliente e reduza churn

### Verticals com maior fit
1. Advocacia e jurídico
2. Saúde (clínicas, especialistas)
3. Educação (cursos, escolas)
4. Imobiliário
5. Serviços financeiros (seguros, crédito)

---

## 4. Proposta de Valor

> **"Você investe em anúncios. Nós te dizemos o que está funcionando — toda segunda-feira, na sua caixa de entrada."**

### Para o dono do negócio
- Zero tempo gasto em plataformas de ads
- Decisão de pausar ou escalar campanhas em 2 minutos
- Alerta imediato quando dinheiro está sendo desperdiçado
- Custo fixo mensal previsível, sem surpresas

### Para a agência
- Relatórios automáticos profissionais para todos os clientes
- Reduz churn: cliente engajado com os resultados não cancela
- Diferencial de venda: "nossos clientes têm acesso ao dashboard em tempo real"
- Escala sem contratar analista de dados

---

## 5. Planos e Preços

### Plano Solo — R$ 197/mês
- 1 empresa (até 2 contas de ads: Google + Meta)
- Dashboard completo
- Relatório semanal por email
- Alertas de anomalia
- Até 100 leads registrados/mês

### Plano Business — R$ 397/mês
- Até 3 empresas / contas de ads
- Tudo do Solo
- Meta mensal por empresa
- Histórico de 12 semanas de relatórios
- Suporte prioritário

### Plano Agência — R$ 997/mês
- Empresas ilimitadas
- White-label (logo e cores do cliente)
- Acesso multi-usuário por empresa
- Relatórios com marca da agência
- API de integração
- Onboarding dedicado

### Setup (único)
- Solo: R$ 497 (configuração Google + Meta + primeiro relatório)
- Business: R$ 797
- Agência: R$ 1.997

---

## 6. Estrutura de Custos (por cliente ativo)

| Item | Custo mensal estimado |
|------|-----------------------|
| Render (backend) | R$ 30–80 (escala com clientes) |
| Neon PostgreSQL | R$ 0–50 (free tier até ~10 clientes) |
| Vercel (frontend) | R$ 0 (free tier) |
| Resend (emails) | R$ 0 (free até 3.000 emails/mês) |
| **Custo fixo inicial** | **~R$ 80/mês** |

**Margem bruta estimada:**
- Solo: ~R$ 117 líquido (60% margem)
- Business: ~R$ 317 líquido (80% margem)
- Agência: ~R$ 917 líquido (92% margem)

**Break-even:** 1 cliente Agência ou 5 clientes Solo cobrem toda a infra.

---

## 7. Modelo de Receita — Projeção

| Clientes | MRR | ARR |
|----------|-----|-----|
| 5 Solo + 2 Business | R$ 1.779 | R$ 21.348 |
| 10 Solo + 5 Business + 1 Agência | R$ 5.952 | R$ 71.424 |
| 20 Solo + 10 Business + 3 Agências | R$ 10.894 | R$ 130.728 |

Receita de setup não recorrente adiciona ~R$ 500–2.000 por novo cliente.

---

## 8. Estratégia de Aquisição

### Fase 1 — Validação (meses 1–3)
- 3 a 5 clientes piloto com desconto ou gratuito
- Objetivo: validar onboarding, coletar depoimentos, identificar fricções
- Canal: network direto, indicação

### Fase 2 — Tração (meses 4–9)
- Vendas diretas para profissionais liberais no Instagram/LinkedIn
- Parcerias com gestores de tráfego (comissão de 20% MRR pelo cliente indicado)
- Case da Amanda Ramalho como prova social (com autorização)

### Fase 3 — Escala (meses 10+)
- Inbound via conteúdo (posts sobre CPL, anomalias, relatórios)
- Programa de afiliados para agências
- Funcionalidade white-label como produto para agências revenderem

---

## 9. Diferenciais Competitivos

| Concorrente | Limitação | Nossa vantagem |
|-------------|-----------|---------------|
| Google Looker Studio | Exige configuração técnica, sem análise automática | Pronto para usar, análise em português |
| Meta Business Suite | Só Meta, sem Google Ads, sem relatório automático | Multi-plataforma, relatório unificado |
| Reportei / DashGoo | Foco em agências, preço alto, complexo | Simples, foco no dono do negócio |
| Planilha manual | Não escala, sem alertas, sem histórico | Automático, alerta em tempo real |

**Nosso diferencial central:** o sistema não só mostra dados — ele diz o que fazer (pausar, escalar, revisar). É inteligência operacional, não só relatório.

---

## 10. Roadmap Comercial

| Prazo | Marco |
|-------|-------|
| Maio/2026 | Primeiro cliente pagante (piloto) |
| Junho/2026 | 3 clientes ativos, onboarding documentado |
| Agosto/2026 | Plano Agência lançado com 1 agência parceira |
| Outubro/2026 | 15 clientes, R$ 5.000+ MRR |
| Janeiro/2027 | White-label funcional, 30+ clientes |

---

## 11. Próximos Passos Imediatos

- [ ] Definir nome comercial do produto (manter AMR Ads Control ou criar marca própria)
- [ ] Landing page de captação (lista de espera ou venda direta)
- [ ] Contrato de serviço / termos de uso
- [ ] Processo de onboarding documentado (passo a passo para novo cliente)
- [ ] Definir canal de suporte (WhatsApp Business, email, Intercom)
- [ ] 1 cliente piloto para validar em março — quem é o primeiro?
