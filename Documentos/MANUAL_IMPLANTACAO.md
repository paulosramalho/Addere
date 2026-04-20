# Manual de Implantação — Projetos Ads Intelligence
### Addere On — Base para replicação rápida

Atualizado em: 20/04/2026  
Baseado em: projeto Amanda Ramalho (primeira implantação completa)

---

## Objetivo

Este manual descreve, passo a passo, tudo o que precisa ser criado, configurado e testado para colocar um projeto Ads Intelligence em produção. A ordem importa — algumas etapas dependem de outras.

Tempo estimado para implantação completa: **4–6 horas** (excluindo aprovações externas como Meta Review).

---

## Arquitetura do Sistema

```
GitHub (repositório monorepo)
│
├── backend/          → Render (API Node.js)
│   ├── src/
│   │   ├── server.js         # endpoints Express
│   │   ├── jobs/             # agentes de coleta e IA
│   │   └── lib/              # utilitários (prisma, email, notificações)
│   └── prisma/schema.prisma  # modelo do banco
│
├── frontend/         → Vercel (dashboard React)
│
└── docs/             → documentação técnica

Site do cliente       → Vercel (repositório separado, Next.js)
Banco de dados        → Neon (PostgreSQL serverless)
E-mail                → Resend
IA                    → Anthropic (Claude Haiku)
Alertas               → Telegram Bot
```

---

## ETAPA 1 — Contas e Serviços

### 1.1 GitHub

**Onde:** github.com  
**O que criar:** repositório monorepo

| Item | Configuração |
|------|-------------|
| Nome sugerido | `NomeProjeto` (ex: `Amanda`) |
| Visibilidade | Privado |
| Branch principal | `main` |
| Estrutura | `backend/`, `frontend/`, `docs/` |

**Status necessário:** repositório criado e clone local funcionando antes de qualquer outra etapa.

---

### 1.2 Neon (PostgreSQL)

**Onde:** neon.tech  
**O que criar:** projeto + banco de dados

| Item | Valor |
|------|-------|
| Região | `us-east-1` (padrão — compatível com Render free) |
| Nome do banco | `neondb` |
| Schema | `public` |

**Duas strings de conexão necessárias:**
- `DATABASE_URL` → endpoint com **pooler** (para a API em produção)
- `DIRECT_URL` → endpoint **direto** sem pooler (para migrations via Prisma)

> Ambas ficam em **Render → Environment** e em `backend/.env` localmente.

**Atenção:** A Prisma usa `DIRECT_URL` no `schema.prisma`:
```prisma
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}
```

---

### 1.3 Render (Backend)

**Onde:** render.com  
**O que criar:** Web Service

| Item | Configuração |
|------|-------------|
| Tipo | Web Service |
| Repositório | GitHub → branch `main` |
| Root Directory | `backend` |
| Build Command | `npm install` |
| Start Command | `npm run start` |
| Plano | Free (com keep-alive externo) ou Starter |
| Auto-deploy | Sim — a cada push no `main` |

**Status necessário:** "Live" após primeiro deploy com banco configurado.

> O free tier dorme após inatividade. Configurar keep-alive externo (UptimeRobot ou similar) para `/health`.

---

### 1.4 Vercel (Dashboard / Frontend)

**Onde:** vercel.com  
**O que criar:** projeto Vite

| Item | Configuração |
|------|-------------|
| Framework | Vite |
| Root Directory | `frontend` |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Branch de deploy | `main` |

**ENV obrigatória:**
```
VITE_API_BASE_URL=https://nome-do-servico.onrender.com
```

> Se o auto-deploy parar de funcionar: Vercel → projeto → Settings → Git → desconectar e reconectar o repositório.

---

### 1.5 Vercel (Site do cliente — opcional)

**Onde:** vercel.com (projeto separado, repositório separado)  
**Framework:** Next.js (App Router)

**ENVs obrigatórias:**
```
BACKEND_URL=https://nome-do-servico.onrender.com
SITE_SECRET=<segredo compartilhado com o backend>
RESEND_API_KEY=<para envio de e-mail de contato>
```

**Padrão para a rota de formulário de contato (`/api/contato/route.js`):**
- Validar campos
- `await fetch(BACKEND_URL + "/api/site/lead", ...)` — SEMPRE `await`, nunca fire-and-forget (Vercel serverless mata o processo após enviar a resposta)
- Enviar e-mail de confirmação via Resend

---

### 1.6 Resend (E-mail transacional)

**Onde:** resend.com  
**O que criar:** conta, domínio verificado, API key

| Etapa | Ação |
|-------|------|
| 1 | Criar conta |
| 2 | Adicionar domínio do cliente (ex: `amandaramalho.adv.br`) |
| 3 | Configurar registros DNS (MX, TXT, DKIM) no registrador do domínio |
| 4 | Aguardar verificação (minutos a horas) |
| 5 | Criar API Key com permissão "Sending access" |
| 6 | Definir endereço remetente (ex: `ads@dominiocliente.com.br`) |

**ENVs:**
```
RESEND_API_KEY=re_...
NOTIFY_EMAIL_FROM=ads@dominiocliente.com.br
NOTIFY_EMAIL_TO=email@cliente.com
ADMIN_ALERT_EMAILS=admin1@email.com,admin2@email.com
```

> Enquanto o domínio não for verificado, usar `onboarding@resend.dev` como fallback — funciona apenas para o e-mail da conta Resend.

---

### 1.7 Anthropic (Claude AI)

**Onde:** console.anthropic.com  
**O que criar:** conta, projeto, API key

| Item | Valor |
|------|-------|
| Modelo recomendado | `claude-haiku-4-5-20251001` — melhor custo-benefício para automações |
| Uso | Análise de posts, sugestões de conteúdo, processamento de RSS |

**ENV:**
```
ANTHROPIC_API_KEY=sk-ant-...
```

**Padrão de prompt:**
- Pedir resposta em JSON estruturado
- Incluir `max_tokens` explícito
- Especificar critérios numéricos claros (evita viés nas classificações)

---

### 1.8 Telegram (Alertas críticos)

**Onde:** Telegram — conversa com @BotFather  
**O que criar:** bot

**Passo a passo:**
1. Abrir Telegram → procurar `@BotFather`
2. Enviar `/newbot`
3. Dar nome e username ao bot
4. Copiar o **bot token** fornecido
5. Iniciar conversa com o bot (enviar qualquer mensagem)
6. Acessar `https://api.telegram.org/bot<TOKEN>/getUpdates` para pegar o `chat_id`

**ENVs:**
```
TELEGRAM_BOT_TOKEN=1234567890:AAH...
TELEGRAM_CHAT_ID=987654321
```

> `chat_id` é o número no campo `message.chat.id` do resultado do `getUpdates`. Pode ser negativo para grupos.

**Testar via curl:**
```bash
curl -X POST "https://api.telegram.org/bot<TOKEN>/sendMessage" \
  -H "Content-Type: application/json; charset=utf-8" \
  -d '{"chat_id": <CHAT_ID>, "text": "Teste"}'
```

---

### 1.9 Meta Developer (Instagram + Meta Ads)

**Onde:** developers.facebook.com  
**O que criar:** App do tipo Business

**Configuração do App:**
1. Criar app → tipo **Business**
2. Adicionar use cases:
   - "Gerenciar mensagens e conteúdo no Instagram" (para Instagram Graph API)
   - "Gerenciar anúncios" (para Meta Ads API)
3. Confirmar que o app está em **modo Live** (não Development)

**Token de acesso (Instagram):**
- Usar **Graph API Explorer**: developers.facebook.com/tools/explorer
- Selecionar o app correto
- Permissões: `instagram_basic`, `instagram_manage_comments`
- Gerar token → copiar imediatamente
- Token expira em ~60 dias — configurar `INSTAGRAM_TOKEN_ISSUED_DATE` para controle de expiração

**Token de acesso (Meta Ads):**
- Permissões: `ads_read`, `ads_management`, `business_management`
- Trocar por token de longa duração (60 dias):
  ```
  GET /oauth/access_token?grant_type=fb_exchange_token
    &client_id=<APP_ID>
    &client_secret=<APP_SECRET>
    &fb_exchange_token=<TOKEN_CURTO>
  ```

**ENVs:**
```
INSTAGRAM_ACCESS_TOKEN=EAAcvx...
INSTAGRAM_USER_ID=17841401...        # ID numérico da conta IG, não o @handle
INSTAGRAM_TOKEN_ISSUED_DATE=YYYY-MM-DD
META_ADS_ACCESS_TOKEN=EAAcvx...
META_ADS_ACCOUNT_ID=246112715        # act_ sem o prefixo
```

**Como encontrar o Ad Account ID correto:**
```
GET /me/adaccounts?access_token=<TOKEN>
```
Retorna lista de contas — usar a que corresponde à conta correta do cliente.

**Armadilha:** token gerado com a conta logada. Se o usuário sair da sessão do Facebook após gerar o token, ele é invalidado imediatamente. Gerar o token e salvar no Render sem fechar o Facebook.

---

### 1.10 Google Cloud + Google Ads

**Onde:** console.cloud.google.com + ads.google.com  
**O que criar:** projeto GCP, OAuth client, Developer Token

**Passo a passo:**

1. **Google Cloud Console:**
   - Criar projeto (ex: `amr-controles`)
   - Ativar API: **Google Ads API**
   - Criar credenciais → OAuth 2.0 → tipo **Aplicativo da Web**
   - Authorized redirect URIs: `https://developers.google.com/oauthplayground`
   - Publicar consent screen para **Produção** (evita expiração do refresh token)

2. **Google Ads:**
   - Acessar conta MCC (gerenciadora) se houver
   - Pegar `Customer ID` (10 dígitos, formato XXX-XXX-XXXX)
   - Solicitar **Developer Token** em API Center → nível "Test Account" basta para início

3. **Refresh Token via OAuth Playground:**
   - Acessar: developers.google.com/oauthplayground
   - Configurar OAuth client (ícone de engrenagem → usar credenciais próprias)
   - Scope: `https://www.googleapis.com/auth/adwords`
   - Logar com a conta Google que tem acesso à conta de Ads
   - Exchange authorization code → copiar **Refresh Token**

**ENVs:**
```
GOOGLE_ADS_ENABLED=true
GOOGLE_ADS_CLIENT_ID=929549819941-...
GOOGLE_ADS_CLIENT_SECRET=GOCSPX-...
GOOGLE_ADS_REFRESH_TOKEN=1//04...
GOOGLE_ADS_DEVELOPER_TOKEN=...
GOOGLE_ADS_CUSTOMER_ID=5439313784
GOOGLE_ADS_LOGIN_CUSTOMER_ID=6627616245   # ID do MCC, se houver
```

**Armadilha:** consent screen em modo "Testing" faz o refresh token expirar em 7 dias. Publicar para **Produção** antes de gerar o refresh token definitivo.

---

## ETAPA 2 — Estrutura do Projeto

### 2.1 Estrutura de pastas (backend)

```
backend/
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── src/
│   ├── server.js              # Express app, todos os endpoints
│   ├── jobs/
│   │   ├── adsCollectionJob.js
│   │   ├── adsScheduler.js
│   │   ├── instagramCollectionJob.js
│   │   ├── instagramScheduler.js
│   │   ├── postAnalysisJob.js
│   │   ├── contentSuggestionsJob.js
│   │   ├── trendingSuggestionsJob.js
│   │   └── ads/providers/
│   │       ├── googleAds.js
│   │       └── metaAds.js
│   └── lib/
│       ├── prisma.js          # singleton PrismaClient
│       ├── businessDate.js    # lógica de data UTC-3
│       ├── instagramNotify.js # e-mail de análise de posts
│       └── adminNotify.js     # alerta crítico (e-mail + Telegram)
├── .env
└── package.json
```

### 2.2 Modelos Prisma essenciais

```prisma
model JobExecution {
  id           Int       @id @default(autoincrement())
  jobName      String    # nome único por tipo de job
  status       String    # RUNNING | SUCCESS | FAILED
  attempt      Int       @default(1)
  startedAt    DateTime
  finishedAt   DateTime?
  details      Json?
  errorMessage String?
  createdAt    DateTime  @default(now())
}
```

> Todos os jobs devem gravar `JobExecution` ao iniciar (RUNNING) e ao terminar (SUCCESS ou FAILED com `errorMessage`). Isso alimenta a aba Agentes do dashboard.

### 2.3 Padrão de jobName

O `jobName` no código deve ser **idêntico** ao `jobName` no `AGENT_REGISTRY` do `server.js`. Divergência faz o dashboard mostrar "Nunca executou" mesmo o job rodando.

---

## ETAPA 3 — Ordem de Implantação

Seguir esta ordem evita bloqueios por dependência:

```
1. GitHub — criar repo, estrutura inicial, primeiro commit
2. Neon — criar banco, copiar DATABASE_URL e DIRECT_URL
3. Render — criar serviço, configurar ENVs mínimas (DATABASE_URL, JWT_SECRET)
4. Rodar migrations — npx prisma migrate deploy (local ou via Render shell)
5. Vercel (dashboard) — conectar repo, configurar VITE_API_BASE_URL
6. Testar /health e /health/db
7. Resend — verificar domínio, configurar ENVs de e-mail
8. Anthropic — adicionar ANTHROPIC_API_KEY
9. Meta/Instagram — gerar tokens, testar coleta manual
10. Google Ads — configurar OAuth, testar coleta manual
11. Telegram — criar bot, testar alerta
12. Vercel (site) — conectar repo separado, configurar ENVs
13. Teste end-to-end de cada fluxo
14. Ativar schedulers (INSTAGRAM_SCHEDULER_ENABLED=true, etc.)
```

---

## ETAPA 4 — Variáveis de Ambiente

### Backend (Render)

| Variável | Descrição | Obrigatória |
|----------|-----------|-------------|
| `DATABASE_URL` | Neon pooler | ✅ |
| `DIRECT_URL` | Neon direto (migrations) | ✅ |
| `JWT_SECRET` | Segredo JWT — string aleatória longa | ✅ |
| `DASHBOARD_PASSWORD` | Senha do painel | ✅ |
| `NODE_ENV` | `production` | ✅ |
| `ANTHROPIC_API_KEY` | Claude API | ✅ |
| `RESEND_API_KEY` | Envio de e-mails | ✅ |
| `NOTIFY_EMAIL_FROM` | Remetente dos e-mails | ✅ |
| `NOTIFY_EMAIL_TO` | Destinatário dos relatórios | ✅ |
| `ADMIN_ALERT_EMAILS` | E-mails para alertas críticos (vírgula-sep.) | ✅ |
| `TELEGRAM_BOT_TOKEN` | Token do bot de alertas | ✅ |
| `TELEGRAM_CHAT_ID` | Chat ID do destinatário | ✅ |
| `SITE_SECRET` | Segredo compartilhado com o site | ✅ |
| `INSTAGRAM_ENABLED` | `true` / `false` | ✅ |
| `INSTAGRAM_ACCESS_TOKEN` | Token Graph API (~60 dias) | ✅ |
| `INSTAGRAM_USER_ID` | ID numérico da conta IG | ✅ |
| `INSTAGRAM_TOKEN_ISSUED_DATE` | Data de emissão `YYYY-MM-DD` | ✅ |
| `INSTAGRAM_SCHEDULER_ENABLED` | `true` para ativar scheduler | ✅ |
| `INSTAGRAM_RUN_UTC_HOUR` | Hora UTC do ciclo diário (4 = 01h BRT) | ✅ |
| `INSTAGRAM_NOTIFY_EMAILS` | E-mail para relatório de posts | ✅ |
| `META_ADS_ENABLED` | `true` / `false` | ✅ |
| `META_ADS_ACCESS_TOKEN` | Token Meta Ads (~60 dias) | ✅ |
| `META_ADS_ACCOUNT_ID` | ID da conta de anúncios (sem `act_`) | ✅ |
| `GOOGLE_ADS_ENABLED` | `true` / `false` | ✅ |
| `GOOGLE_ADS_CLIENT_ID` | OAuth Client ID | ✅ |
| `GOOGLE_ADS_CLIENT_SECRET` | OAuth Client Secret | ✅ |
| `GOOGLE_ADS_REFRESH_TOKEN` | Refresh token (não expira em Produção) | ✅ |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | Developer token | ✅ |
| `GOOGLE_ADS_CUSTOMER_ID` | ID da conta de anúncios | ✅ |
| `GOOGLE_ADS_LOGIN_CUSTOMER_ID` | ID do MCC (se houver) | — |
| `ADS_COLLECTION_SCHEDULER_ENABLED` | `true` para ativar | ✅ |

### Frontend (Vercel)

| Variável | Valor |
|----------|-------|
| `VITE_API_BASE_URL` | `https://<servico>.onrender.com` |

### Site (Vercel — repositório separado)

| Variável | Valor |
|----------|-------|
| `BACKEND_URL` | `https://<servico>.onrender.com` |
| `SITE_SECRET` | Igual ao `SITE_SECRET` do Render |
| `RESEND_API_KEY` | Para envio do e-mail de contato |

---

## ETAPA 5 — Padrões de Código

### Timezone e datas
- Timezone do projeto: **UTC-3** (America/Belem / America/Sao_Paulo)
- Toda lógica de "hoje" usa `toBusinessDateAtNoon()` → gera `YYYY-MM-DDT12:00:00Z`
- **Por quê T12:** midnight UTC = 21h do dia anterior em BRT. Meio-dia UTC = 09h BRT — nunca cruza de dia.
- Exibição ao usuário: sempre `DD/MM/AAAA` com `timeZone: "America/Belem"` no `toLocaleString`

### Campos `<input type="date">`
```javascript
// Ao enviar para o backend:
const iso = form.data + "T12:00:00Z";
```

### Valores monetários
- Armazenar em **centavos** (inteiro)
- Exibir com `toLocaleString("pt-BR", { style: "currency", currency: "BRL" })`
- Input: comportamento de calculadora (dígitos da direita, vírgula flutuante)

### Notificações (frontend)
- **Nunca** usar `alert()`, `confirm()`, `prompt()`
- Feedback sempre via Toast ou modal de confirmação (para ações destrutivas)

---

## ETAPA 6 — Schedulers

Dois schedulers independentes:

| Scheduler | ENV de controle | Horário padrão | O que faz |
|-----------|----------------|----------------|-----------|
| Ads Collection | `ADS_COLLECTION_SCHEDULER_ENABLED` | 15h UTC (12h BRT) | Coleta Google Ads + Meta Ads, detecta anomalias, gera relatório semanal |
| Instagram | `INSTAGRAM_SCHEDULER_ENABLED` | 04h UTC (01h BRT) | Coleta posts, analisa com Claude, gera sugestões, notifica |

**Padrão de implementação:**
```javascript
// tick roda a cada tickMs (padrão 60s)
// só executa se a hora UTC atual == runUtcHour
// guarda lastRunKey = "YYYY-MM-DD_Xh" para não executar mais de uma vez por dia
```

---

## ETAPA 7 — Alertas Críticos

Implementar `adminNotify.js` com dois canais:

1. **E-mail** via Resend para `ADMIN_ALERT_EMAILS`
2. **Telegram** via Bot API para `TELEGRAM_CHAT_ID`

Disparar em:
- Token de API expirado (OAuthException / erro 190)
- Falha crítica de coleta que não se auto-resolve
- Qualquer erro que requeira ação humana imediata

Incluir na mensagem:
- O que falhou
- Mensagem de erro (primeiros 300 chars)
- Passos numerados para corrigir, com URLs diretas

---

## ETAPA 8 — Tokens com Expiração

| Token | Expira em | Como renovar |
|-------|-----------|-------------|
| Instagram Graph API | ~60 dias | Graph API Explorer → novo token → Render |
| Meta Ads | ~60 dias | Graph API Explorer → token longa duração → Render |
| Google Ads Refresh Token | Não expira* | Só se revogar ou consent em Testing mode |

*Refresh token do Google expira em 7 dias se o OAuth consent screen estiver em modo "Testing". Publicar para **Produção** antes de gerar.

**Alerta automático de renovação:**
- Armazenar `INSTAGRAM_TOKEN_ISSUED_DATE` no Render
- Backend calcula dias de uso e inclui banner no e-mail de análise
- Alerta começa aos 45 dias, torna-se urgente aos 55 dias

---

## ETAPA 9 — Checklist de Go-Live

### Backend
- [ ] `/health` retorna `{ ok: true }`
- [ ] `/health/db` retorna `{ ok: true }`
- [ ] Migrations aplicadas (todas as tabelas existem)
- [ ] JWT funcionando — `/auth/login` retorna token
- [ ] Coleta de anúncios manual funciona (Ads Collection → Executar)
- [ ] Coleta Instagram manual funciona
- [ ] Análise de posts com Claude funciona
- [ ] Sugestões de conteúdo geradas
- [ ] Alerta Telegram recebido (testar via `/jobs/admin-alert/test`)
- [ ] E-mail de alerta recebido

### Frontend
- [ ] Login com senha funciona
- [ ] Aba Visão Geral carrega dados
- [ ] Aba Leads mostra leads e permite criar
- [ ] Aba Conteúdo → sub-aba Conteúdo mostra posts
- [ ] Aba Conteúdo → sub-aba Sugestão de Conteúdo mostra sugestões
- [ ] Aba Agentes mostra todos os agentes com status OK

### Site (se aplicável)
- [ ] Formulário de contato cria lead no backend
- [ ] E-mail de confirmação chega para o cliente
- [ ] Lead aparece na aba Leads do dashboard

### Schedulers
- [ ] `INSTAGRAM_SCHEDULER_ENABLED=true` no Render
- [ ] `ADS_COLLECTION_SCHEDULER_ENABLED=true` no Render
- [ ] Aguardar próxima janela e confirmar execução automática

---

## ETAPA 10 — Armadilhas Conhecidas

| Problema | Causa | Solução |
|----------|-------|---------|
| Token Instagram inválido imediatamente | Usuário saiu do Facebook após gerar o token | Gerar e salvar no Render sem fechar o Facebook |
| "Nunca executou" no dashboard mesmo o job rodando | `jobName` no código diferente do `AGENT_REGISTRY` | Alinhar os nomes exatamente |
| Lead do site não chega | `BACKEND_URL` no Vercel apontando para URL errada | Verificar via endpoint `/api/debug-env` temporário |
| Formulário site não funciona em produção Vercel | Uso de `fetch` sem `await` (fire-and-forget) | Sempre `await fetch(...)` nas API routes do Next.js |
| Refresh token Google expira em 7 dias | Consent screen em modo "Testing" | Publicar consent screen para "Produção" antes de gerar o token |
| Meta Ads conta errada (0 campanhas) | Ad Account ID da conta empresarial em vez da pessoal | Descobrir via `GET /me/adaccounts` no Graph API Explorer |
| 401 no endpoint de anúncios pelo dashboard | Endpoint usa API key (`JOB_RUNNER_API_KEY`), não JWT | Endpoint deve aceitar ambos: JWT do dashboard e API key para automação externa |
| Deploy Vercel não dispara após push | Webhook do GitHub desconectado | Settings → Git → desconectar e reconectar repositório |
| Posts todos classificados como "Redirecionar" | Prompt sem critérios numéricos explícitos | Definir thresholds claros: INVEST >80 curtidas, REDIRECT >14 dias E <20 curtidas, etc. |
| Emoji em curl (Windows) → erro de encoding | Shell Windows não envia UTF-8 por padrão | Remover emoji do texto ou usar `Content-Type: application/json; charset=utf-8` |

---

## ETAPA 11 — Documentação do Projeto

Criar e manter três arquivos em `docs/`:

| Arquivo | Conteúdo |
|---------|----------|
| `README.md` | Estrutura, endpoints, modelos, agentes, ENVs, deploy, regras de negócio |
| `PLANO_STATUS.md` | Status atual, ENVs de produção com valores, alertas de renovação, histórico de migrations |
| `SETUP_INTEGRACOES.md` | Contas, IDs, tokens, OAuth, instruções de renovação por integração |

**Regra:** atualizar os três após cada sessão com mudanças significativas (novas features, novas ENVs, migrações, novos agentes).

---

## Referências Rápidas

| Serviço | URL de acesso |
|---------|--------------|
| GitHub | github.com |
| Neon | console.neon.tech |
| Render | dashboard.render.com |
| Vercel | vercel.com/dashboard |
| Resend | resend.com |
| Anthropic | console.anthropic.com |
| Meta for Developers | developers.facebook.com |
| Graph API Explorer | developers.facebook.com/tools/explorer |
| Google Cloud Console | console.cloud.google.com |
| OAuth Playground | developers.google.com/oauthplayground |
| Telegram BotFather | t.me/BotFather |
