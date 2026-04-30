# Replica Controles-AMR para Addere

Atualizado em: 30/04/2026  
Destino inicial: `C:\Addere\sistema.html`  
Referencia estudada: `C:\Controles-AMR`

## Decisao de entrega

O repositorio Addere ainda e uma landing page estatica, sem `backend/`, `frontend/`, `package.json`, banco ou autenticação real. Para nao substituir a landing atual nem importar uma base full stack incompleta, a primeira entrega foi uma replica navegavel em HTML/CSS/JS, com persistencia em `localStorage`.

Essa replica cobre os modulos pedidos:

- Notice Board
- Agenda
- Dashboard
- Recebimentos
- Livro Caixa
- Configuracoes: Clientes, Usuarios, Contas Contabeis, Seguranca 2FA
- Utilitarios: Importacao PDF Livro Caixa, Emissao de Nota Fiscal

## Arquivos AMR usados como base

Frontend:

- `frontend/src/App.jsx`: rotas, shell, menu, bloqueio de sessao, lazy loading.
- `frontend/src/lib/api.js`: padrao `apiFetch`, token JWT e base URL.
- `frontend/src/pages/NoticeBoard.jsx`: chat, avisos, mencoes, confirmacao de leitura, anexos e presenca.
- `frontend/src/pages/Agenda.jsx`: calendario, participantes, lembretes, status, recorrencia e reagendamento.
- `frontend/src/pages/DashboardFinanceiro.jsx`: KPIs financeiros e resumo do Livro Caixa.
- `frontend/src/pages/ComprovantesRecebidos.jsx`: revisao de comprovantes e vinculacao.
- `frontend/src/pages/LivroCaixaContas.jsx`, `LivroCaixaLancamentos.jsx`, `LivroCaixaVisualizacao.jsx`, `LivroCaixaEmissao.jsx`: contas, lancamentos, visualizacao e emissao.
- `frontend/src/pages/Clientes.jsx`: cadastro, validacoes, status, tipos C/F/A.
- `frontend/src/pages/Usuarios.jsx`: usuarios, papeis, troca de senha, perfil.
- `frontend/src/pages/Seguranca2FA.jsx`: setup, verificacao e desativacao de TOTP.
- `frontend/src/pages/ImportacaoLivroCaixaPdf.jsx`: parse de PDF, revisao de linhas e confirmacao.
- `frontend/src/pages/EmissaoNotaFiscal.jsx`: placeholder/entrada para o utilitario fiscal.

Backend:

- `backend/src/server.js`: registro das rotas e middlewares.
- `backend/src/routes/auth.js`: login JWT, 2FA, avatar, recuperacao e cadastro.
- `backend/src/routes/noticeboard.js`: usuarios, mensagens, avisos, leituras, reacoes, upload e vencimentos.
- `backend/src/routes/agenda.js`: eventos, participantes, lembretes, recorrencia, status e integracao Google Calendar.
- `backend/src/routes/dashboard.js`: indicadores financeiros a partir de Livro Caixa, parcelas e repasses.
- `backend/src/routes/comprovantes.js`: comprovantes recebidos, anexos e palavras-chave Gmail.
- `backend/src/routes/livroCaixa.js`: contas, saldos, lancamentos, importacao PDF, emissao e vencidos.
- `backend/src/routes/clientes.js`: clientes, busca global, duplicados e auditoria.
- `backend/src/routes/usuarios.js`: usuarios administrativos e perfil.
- `backend/prisma/schema.prisma`: modelos e relacionamentos.

## Modelos essenciais a migrar

Para a versao full stack Addere, a fatia minima do Prisma deve conter:

- `Usuario`: nome, email, senha, role, ativo, tipoUsuario, telefone, avatar, `totpSecret`, `totpEnabled`.
- `Cliente`: doc, nome, email, telefone, endereco, tipo `C/F/A`, ativo, observacoes.
- `MensagemChat`, `MensagemLeitura`, `MensagemReacao`, `PresencaUsuario`.
- `AgendaEvento`, `AgendaParticipante`, `AgendaLembrete`.
- `LivroCaixaConta`, `LivroCaixaLancamento`, `ImportacaoPdfSessao`, `ImportacaoPdfLinha`.
- `ComprovanteRespostaCliente`, `ComprovanteAnexo`.
- Para Addere: adicionar `NotaFiscalServico` e `Recebimento` como modelos explicitos, ou adaptar `ParcelaContrato` se houver contratos recorrentes.

## Adaptacao de dominio para Addere

No AMR, varios fluxos sao juridicos: advogados, repasses, processos, intimacoes, contratos e parcelas. Para Addere, a replica preserva a arquitetura operacional, mas troca o dominio para marketing/ads:

- Cliente vira empresa atendida pela Addere.
- Fornecedor cobre Google Ads, Meta Ads, bancos e ferramentas.
- Recebimento substitui a baixa de parcelas/contratos.
- Livro Caixa mantem entradas, saidas, conta contabil, origem e status.
- Nota Fiscal passa a representar servicos de licenciamento, gestao de midia e inteligencia de trafego.
- Notice Board e Agenda permanecem quase identicos conceitualmente.

## O que a replica local implementa

`sistema.html` inclui:

- Navegacao lateral com os modulos pedidos.
- Dados iniciais de clientes, usuarios, contas, lancamentos, recebimentos, notas, avisos e eventos.
- Persistencia no navegador via `localStorage`.
- Dashboard calculado a partir dos dados locais.
- Baixa de recebimento que cria entrada no Livro Caixa.
- Lancamento manual no Livro Caixa e emissao por `window.print()`.
- Cadastro e ativacao/inativacao de clientes, usuarios e contas.
- 2FA simulado com chave local e codigo demo `123456`.
- Importacao PDF simulada, com linhas extraidas e confirmacao para o Livro Caixa.
- Emissao de nota fiscal simulada e geracao de recebimento a partir da nota.

## Lacunas da replica estatica

Estas partes estao simuladas e precisam de backend real para producao:

- Login JWT, hash de senha, refresh de sessao e bloqueio real.
- 2FA TOTP real com segredo criptografado/armazenado.
- Upload/download de anexos e PDFs.
- Parser real de PDF (`pdfjs-dist`/OCR) e deduplicacao por hash.
- Banco PostgreSQL, migracoes Prisma e auditoria.
- Integracao Gmail para comprovantes.
- Integracao com prefeitura/NFS-e.
- Integracao bancaria para Pix, boletos e conciliacao.
- Permissoes por role em rotas e componentes.

## Proximo passo recomendado

1. Criar monorepo Addere com `frontend/` e `backend/`, mantendo a landing atual na raiz ou em `website/`.
2. Copiar do AMR apenas a fatia selecionada: `auth`, `noticeboard`, `agenda`, `dashboard`, `livroCaixa`, `clientes`, `usuarios`, `comprovantes`.
3. Remover dependencias juridicas: advogados, repasses, processos, intimacoes e contratos, exceto se forem reaproveitados como contratos comerciais Addere.
4. Criar modelos Addere para `Recebimento` e `NotaFiscalServico`.
5. Migrar a UI da replica estatica para React/Vite, reaproveitando os componentes e padroes do AMR.
6. Subir PostgreSQL/Neon, aplicar migrations e seed inicial.
7. Testar cada modulo com dados reais antes de ativar integracoes externas.

