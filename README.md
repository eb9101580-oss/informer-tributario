# Informer — Inteligência Tributária

Painel full stack que monitora fontes oficiais brasileiras, coleta documentos, analisa o conteúdo localmente e cria alertas tributários priorizados com proveniência verificável.

## Arquitetura

```text
front (React/Vite)
  └─ painel, varredura, fila, fontes, alertas e feedback
       ↓ REST
back (Node/Express)
  ├─ agendador, conectores, triagem tributária rápida, fila e deduplicação
  ├─ Better Auth + PostgreSQL/Neon → usuários, sessões, preferências e fontes
  ├─ Scrapling (adaptador Python) → HTML e PDF oficial
  └─ Ollama (API local) → análise jurídica detalhada dos itens priorizados
```

O projeto principal é JavaScript. Os dois arquivos Python em `back/scraper` são adaptadores isolados porque Scrapling é uma biblioteca Python. O `awesome-llm-apps` foi usado como referência arquitetural; nenhum repositório externo foi incorporado ao código.

## Fontes monitoradas

- Receita Federal, sistema Normas (COSIT, Instruções Normativas, Notas e Pareceres), Diário Oficial da União, NF-e e SPED;
- Câmara dos Deputados e Senado Federal;
- STF e STJ, incluindo seus informativos de jurisprudência;
- CARF e PGFN;
- TRF1, TRF2, TRF3, TRF4, TRF5 e TRF6.

O painel também separa duas curadorias temáticas: **Reforma tributária** (Portal da Reforma, CGIBS, Folha, Valor, NF-e e atos oficiais) e **Obrigações acessórias** (Ajustes SINIEF, NF-e e os módulos ECD, ECF, EFD-Contribuições, EFD ICMS/IPI, EFD-Reinf, e-Financeira, eSocial, Central de Balanços e DeRE). Os manuais e leiautes do SPED usam as páginas oficiais do novo portal `gov.br/sped`, que expõem a versão e a data de modificação do documento.

Câmara e Senado usam os serviços oficiais de dados abertos. O STJ consulta o conjunto diário de decisões terminativas e acórdãos do Diário da Justiça e filtra a raiz 14 (Direito Tributário) da TPU/CNJ. O STF consulta acórdãos e decisões monocráticas na pesquisa oficial por data. TRF1 a TRF6 consultam as decisões publicadas na API pública do DJEN/CNJ e preservam, em paralelo, suas notícias oficiais. Os demais conectores consultam os portais oficiais de notícias, precedentes ou publicações. Cada falha é registrada por fonte e nunca é tratada como “nenhuma novidade”.

## Requisitos e instalação

- Node.js 22 ou superior;
- Python 3.10 ou superior;
- PostgreSQL 14 ou superior (o plano gratuito do Neon é suficiente para testes);
- Ollama em execução para as análises.

No PowerShell, use `npm.cmd` se a política de execução bloquear `npm.ps1`:

```powershell
npm.cmd run setup
ollama pull qwen3:4b
npm.cmd run dev
```

- Painel: http://localhost:5173
- API: http://localhost:3333
- Saúde: http://localhost:3333/api/health

## Login, usuários e PostgreSQL/Neon

O painel interno usa [Better Auth](https://www.better-auth.com/) com links mágicos enviados por e-mail. Não existe cadastro público: o administrador inicial é definido por ambiente e somente ele pode convidar novos usuários na engrenagem de configurações. Os papéis são:

- `admin`: acessa a operação completa e gerencia usuários, sugestões e fontes;
- `user`: acessa o feed, ações acompanhadas, Reforma Tributária, Obrigações Acessórias, alertas, oportunidades e feedback.

Crie um projeto PostgreSQL no [Neon](https://neon.tech/docs/get-started-with-neon/signing-up), copie a connection string com SSL e configure `back/.env` sem versionar o arquivo:

```dotenv
DATABASE_URL=
DATABASE_POOL_MAX=5
BETTER_AUTH_SECRET=
BETTER_AUTH_URL=http://localhost:3333
AUTH_FRONTEND_URL=http://localhost:5173
AUTH_TRUSTED_ORIGINS=http://localhost:5173,http://localhost:3333
AUTH_ADMIN_EMAIL=
AUTH_ADMIN_NAME=
```

Gere `BETTER_AUTH_SECRET` com pelo menos 32 bytes aleatórios; por exemplo, `openssl rand -base64 32`. Não reutilize a chave do Resend, do GitHub ou do DataJud. Na primeira chamada de autenticação, o backend aplica de forma idempotente a migration [001_auth_and_user_data.sql](back/migrations/001_auth_and_user_data.sql) e cria ou promove `AUTH_ADMIN_EMAIL` como administrador. Se preferir provisionar antes do primeiro acesso, execute o mesmo SQL no console do Neon.

Em produção com um único deploy Vercel, use o domínio público em `BETTER_AUTH_URL`, `AUTH_FRONTEND_URL` e `AUTH_TRUSTED_ORIGINS`. Não é necessário criar um segundo frontend: `/app` entrega a experiência adequada ao papel da sessão. Cookies de produção são `HttpOnly`, `Secure` e `SameSite=Lax`.

## Varredura automática

O backend inicia o primeiro ciclo 15 segundos depois de subir e repete a consulta a cada seis horas. Abra **Varredura automática** para acompanhar a fonte atual, fila, documentos, falhas e histórico de ciclos.

No GitHub Actions, cada ciclo agendado consulta todas as fontes para hoje e repete a coleta exata para ontem. Nos TRF1–TRF6, o sistema baixa o caderno diário completo e compactado do DJEN/CNJ, lê todos os JSONs e só então filtra as decisões tributárias. STJ, STF, CARF, Receita Federal, Cosit, PGFN, Confaz, Câmara, Senado, SPED, NF-e e as fontes de notícias seguem a mesma janela de hoje e ontem pelos respectivos conectores oficiais; quando uma página não informa a data, o sistema não inventa uma data histórica.

O fluxo híbrido é:

1. consultar cada fonte oficial;
2. filtrar e classificar todos os metadados com regras tributárias rápidas;
3. eliminar atos meramente processuais e deduplicar documentos repetidos;
4. priorizar mérito judicial, atos da Receita e mudanças operacionais;
5. extrair HTML ou PDF com Scrapling somente para os melhores candidatos;
6. usar o Ollama para a análise jurídica detalhada, no máximo dois documentos por ciclo local;
7. publicar somente itens relevantes com nota mínima 6.

Os limites evitam sobrecarga em computadores com 8 GB de memória. Ajuste em `back/.env`:

```dotenv
MONITOR_ENABLED=true
MONITOR_INTERVAL_MINUTES=360
MONITOR_MAX_ANALYSES_PER_RUN=2
MONITOR_LOOKBACK_DAYS=2
DJEN_MAX_CANDIDATES_PER_TRIBUNAL_DATE=60
```

Use **Só descobrir** para testar os conectores sem ocupar o Ollama. `MONITOR_MAX_ANALYSES_PER_RUN` controla o consumo por ciclo; `OLLAMA_TIMEOUT_MS` controla o tempo de cada análise. O limite do DJEN é aplicado somente depois de ler o caderno completo, eliminar duplicatas e ranquear mérito e precedentes; os totais do funil ficam registrados no histórico do ciclo.

### Busca por data

Em **Varredura automática**, escolha uma data e use **Puxar publicações**. A busca reúne todas as categorias tributárias monitoradas — notícias, atos, normas, proposições legislativas e decisões — e coloca os resultados na fila sem consumir o Ollama.

O histórico do ciclo informa a cobertura de cada fonte. STF, STJ, Câmara e as decisões dos seis TRFs possuem consulta judicial pela data; o Senado é filtrado pela data informada. Portais de notícias e índices genéricos nem sempre oferecem arquivo histórico; nesses casos, o sistema verifica somente os itens datados que ainda aparecem no índice atual e sinaliza essa limitação, sem atribuir uma data inexistente ao conteúdo.

## Alertas por e-mail

O envio usa a API do [Resend](https://resend.com/docs/send-with-nodejs). A Vercel precisa da chave para links mágicos, convites e notificações do painel; o GitHub Actions precisa dela para os alertas gerados pela varredura. Verifique um domínio no Resend antes de usar remetentes próprios. `onboarding@resend.dev` serve apenas para os testes permitidos pela conta.

Configure na Vercel e, quando indicado, também nos segredos do GitHub Actions. Os campos abaixo devem receber valores no provedor, nunca no repositório:

```dotenv
GITHUB_TOKEN=
GITHUB_REPOSITORY=
SUBSCRIPTIONS_ENCRYPTION_KEY=
RESEND_API_KEY=
ALERTS_FROM_EMAIL=
ALERTS_MIN_SCORE=8
```

Para que a varredura do GitHub Actions também notifique as contas criadas no painel, adicione `DATABASE_URL` como secret do repositório, além de `RESEND_API_KEY`, `ALERTS_FROM_EMAIL` e `SUBSCRIPTIONS_ENCRYPTION_KEY`. Use a connection string com pool do Neon e nunca a grave no YAML.

Sem `RESEND_API_KEY` e `ALERTS_FROM_EMAIL`, o painel pode ler os dados, mas convites, login por e-mail e alertas não são enviados. Revogue imediatamente qualquer chave que tenha aparecido em imagem, terminal, log ou commit e gere outra no painel do Resend. A rotina `back/scripts/notify-subscribers.js` é executada após cada análise automática e envia somente alertas novos acima do limite.

Na Vercel, as rotas de leitura consultam o `database.json` atual do branch `main`. Assim, os commits de dados produzidos pelo GitHub Actions chegam ao feed sem exigir um novo build da interface a cada varredura; a cópia incluída no deploy permanece como contingência se o GitHub estiver indisponível.

## Ações acompanhadas e DataJud

Em **Ações acompanhadas**, cadastre um tema tributário (por exemplo, `ICMS`) ou um número CNJ e selecione o tribunal. O painel consulta a API Pública do DataJud, mostra a movimentação mais recente e conserva o histórico resumido. Um workflow do GitHub consulta os acompanhamentos uma vez por dia e publica somente o estado criptografado em `back/data/tracked-actions.json`.

Quando uma nova movimentação é detectada, ela é transformada em um alerta oficial com nota 8,5 e aparece automaticamente no dashboard, no feed geral e no histórico do acompanhamento. O alerta mantém a data, a descrição do movimento e o link oficial do processo.

Configure a chave pública vigente do CNJ somente como segredo de ambiente; nunca a grave no código:

```dotenv
DATAJUD_API_KEY=chave_publica_vigente_do_cnj
TRACKED_ACTIONS_ENCRYPTION_KEY=chave_aleatoria_forte
ACTIONS_CRON_SECRET=segredo_aleatorio_compartilhado
```

Use exatamente o mesmo `ACTIONS_CRON_SECRET` na Vercel e no segredo homônimo do GitHub Actions; ele autentica o `POST /api/actions/refresh-all` diário. Na Vercel, `GITHUB_TOKEN` também é necessário para persistir os acompanhamentos. No GitHub Actions, crie os segredos `DATAJUD_API_KEY`, `TRACKED_ACTIONS_ENCRYPTION_KEY` e `ACTIONS_CRON_SECRET`. A API do DataJud fornece metadados e movimentações de processos públicos; processos em segredo não aparecem na API.

O endpoint público do DataJud não inclui o STF. Para acompanhamentos do Supremo, selecione **STF (portal oficial)** e cole o link `portal.stf.jus.br/processos/detalhe.asp?incidente=...`; o sistema consulta a página oficial, a aba de andamentos e a aba de decisões. Por exemplo, a notícia do ICMS sobre produtos intermediários identifica o RE 1.424.015, Tema 1.465.

## Fontes personalizadas no monitor automático

Fontes cadastradas por usuários ficam pendentes até aprovação do administrador. O backend valida HTTPS e bloqueia endereços privados antes de permitir a coleta. As fontes ativas ficam no PostgreSQL e o endpoint público `/api/sources/approved-custom` entrega apenas o catálogo mínimo necessário ao coletor, sem dados de usuários.

Quando o monitor roda junto do backend e possui `DATABASE_URL`, deixe `CUSTOM_SOURCES_URL` vazio: ele lê o catálogo diretamente do banco. Para o GitHub Actions, que não precisa receber a credencial do Neon, aponte a variável para o endpoint público do deploy:

```dotenv
CUSTOM_SOURCES_URL=https://SEU_DOMINIO/api/sources/approved-custom
```

O workflow `tax-monitor.yml` pode definir esse endereço como variável normal, pois ele não é segredo. O endpoint garante a migration antes da consulta, então também funciona no primeiro acesso a um banco novo.

### Checklist de produção

Na Vercel, configure `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `AUTH_FRONTEND_URL`, `AUTH_TRUSTED_ORIGINS`, `AUTH_ADMIN_EMAIL`, `AUTH_ADMIN_NAME`, `RESEND_API_KEY`, `ALERTS_FROM_EMAIL`, `ACTIONS_CRON_SECRET`, `GITHUB_TOKEN` e as chaves já usadas pelo DataJud. No GitHub Actions, mantenha como secrets somente credenciais e chaves; `CUSTOM_SOURCES_URL` pode permanecer como variável pública. Depois do deploy, valide `/api/health`, solicite o link mágico do administrador e só então envie convites aos usuários.

O feed interno e o blog público exibem somente alertas reais (`isDemo: false`), com endereço original e trilha de proveniência verificável.

## Verificação

```powershell
npm.cmd --prefix back test
npm.cmd --prefix front run build
```

### Provedor de analise rapida

O monitor normaliza metadados, deduplica por URL/processo/ementa, ranqueia merito e publica imediatamente documentos oficiais de alta confianca com um resumo factual. Ollama ou llama.cpp fica reservado para substituir o cartao por uma analise detalhada.

Para testar llama.cpp no Windows, instale o servidor e inicie um modelo GGUF. Com `ANALYSIS_PROVIDER=auto`, o backend tenta `http://localhost:8080` e volta automaticamente para o Ollama se o servidor nao estiver disponivel:

```powershell
winget install --id ggml.llamacpp -e
llama-server.exe -hf Qwen/Qwen3-4B-GGUF:Q4_K_M --host 127.0.0.1 --port 8080 --ctx-size 8192 --reasoning off
```

Variaveis opcionais: `ANALYSIS_PROVIDER=llama.cpp`, `LLAMA_CPP_URL`, `LLAMA_CPP_MODEL` e `LLAMA_CPP_TIMEOUT_MS`. Redis, Qdrant e PostgreSQL podem ser adicionados depois para uma instalacao multiworker; o fluxo atual permanece funcional no plano gratuito.

## Referências

- [Scrapling](https://github.com/D4Vinci/Scrapling) — BSD-3-Clause
- [awesome-llm-apps](https://github.com/Shubhamsaboo/awesome-llm-apps) — Apache-2.0
- [Ollama](https://github.com/ollama/ollama) — MIT
