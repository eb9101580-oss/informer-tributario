# Informer — Inteligência Tributária

Painel full stack que monitora fontes oficiais brasileiras, coleta documentos, analisa o conteúdo localmente e cria alertas tributários priorizados com proveniência verificável.

## Arquitetura

```text
front (React/Vite)
  └─ painel, varredura, fila, fontes, alertas e feedback
       ↓ REST
back (Node/Express)
  ├─ agendador, conectores, filtro tributário, fila e deduplicação
  ├─ Scrapling (adaptador Python) → HTML e PDF oficial
  └─ Ollama (API local) → análise estruturada com modelo local
```

O projeto principal é JavaScript. Os dois arquivos Python em `back/scraper` são adaptadores isolados porque Scrapling é uma biblioteca Python. O `awesome-llm-apps` foi usado como referência arquitetural; nenhum repositório externo foi incorporado ao código.

## Fontes monitoradas

- Receita Federal, sistema Normas (COSIT, Instruções Normativas, Notas e Pareceres), Diário Oficial da União, NF-e e SPED;
- Câmara dos Deputados e Senado Federal;
- STF e STJ, incluindo seus informativos de jurisprudência;
- CARF e PGFN;
- TRF1, TRF2, TRF3, TRF4, TRF5 e TRF6.

O painel também separa duas curadorias temáticas: **Reforma tributária** (Portal da Reforma, CGIBS, Folha, Valor, NF-e e atos oficiais) e **Obrigações acessórias** (Ajustes SINIEF, NF-e e os módulos ECD, ECF, EFD-Contribuições, EFD ICMS/IPI, EFD-Reinf, e-Financeira, eSocial, Central de Balanços e DeRE). Os manuais e leiautes do SPED usam as páginas oficiais do novo portal `gov.br/sped`, que expõem a versão e a data de modificação do documento.

Câmara e Senado usam os serviços oficiais de dados abertos. O STJ usa seu catálogo oficial de dados abertos e gera links para o inteiro teor dos acórdãos. Os demais conectores consultam os portais oficiais de jurisprudência, precedentes ou publicações. Cada falha é registrada por fonte e nunca é tratada como “nenhuma novidade”.

## Requisitos e instalação

- Node.js 20 ou superior;
- Python 3.10 ou superior;
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

## Varredura automática

O backend inicia o primeiro ciclo 15 segundos depois de subir e repete a consulta a cada seis horas. Abra **Varredura automática** para acompanhar a fonte atual, fila, documentos, falhas e histórico de ciclos.

O fluxo é:

1. consultar cada fonte oficial;
2. filtrar títulos e ementas por vocabulário tributário;
3. deduplicar pela URL oficial;
4. enfileirar o documento com órgão, método e horário;
5. extrair HTML ou PDF com Scrapling;
6. analisar no Ollama, no máximo dois documentos por ciclo;
7. publicar somente itens relevantes com nota mínima 6.

Os limites evitam sobrecarga em computadores com 8 GB de memória. Ajuste em `back/.env`:

```dotenv
MONITOR_ENABLED=true
MONITOR_INTERVAL_MINUTES=360
MONITOR_MAX_ANALYSES_PER_RUN=2
MONITOR_LOOKBACK_DAYS=7
```

Use **Só descobrir** para testar os conectores sem ocupar o Ollama. `MONITOR_MAX_ANALYSES_PER_RUN` controla o consumo por ciclo; `OLLAMA_TIMEOUT_MS` controla o tempo de cada análise.

## Alertas por e-mail

O feed público possui cadastro para receber alertas com nota 8 ou superior. O envio usa a API do Resend (plano gratuito para testes) e a persistência dos cadastros na Vercel usa o conteúdo do repositório via `GITHUB_TOKEN`. Configure no ambiente da Vercel e nos segredos do GitHub Actions:

```dotenv
GITHUB_TOKEN=token_com_permissao_de_conteudo_no_repositorio
GITHUB_REPOSITORY=eb9101580-oss/informer-tributario
SUBSCRIPTIONS_ENCRYPTION_KEY=chave_aleatoria_forte_compartilhada_com_a_vercel
RESEND_API_KEY=re_xxxxxxxxx
ALERTS_FROM_EMAIL=Informer Tributário <onboarding@resend.dev>
ALERTS_MIN_SCORE=8
```

Sem essas chaves, o painel continua funcionando, mas o cadastro informa que o envio está aguardando configuração. A rotina `back/scripts/notify-subscribers.js` é executada após cada análise automática e envia somente alertas novos acima do limite.

## Ações acompanhadas e DataJud

Em **Ações acompanhadas**, cadastre um tema tributário (por exemplo, `ICMS`) ou um número CNJ e selecione o tribunal. O painel consulta a API Pública do DataJud, mostra a movimentação mais recente e conserva o histórico resumido. Um workflow do GitHub consulta os acompanhamentos a cada 10 minutos e publica somente o estado criptografado em `back/data/tracked-actions.json`.

Quando uma nova movimentação é detectada, ela é transformada em um alerta oficial com nota 8,5 e aparece automaticamente no dashboard, no feed geral e no histórico do acompanhamento. O alerta mantém a data, a descrição do movimento e o link oficial do processo.

Configure a chave pública vigente do CNJ somente como segredo de ambiente; nunca a grave no código:

```dotenv
DATAJUD_API_KEY=chave_publica_vigente_do_cnj
TRACKED_ACTIONS_ENCRYPTION_KEY=chave_aleatoria_forte
```

Na Vercel, `GITHUB_TOKEN` também é necessário para persistir os acompanhamentos. No GitHub Actions, crie os segredos `DATAJUD_API_KEY` e `TRACKED_ACTIONS_ENCRYPTION_KEY`. A API do DataJud fornece metadados e movimentações de processos públicos; processos em segredo não aparecem na API.

O endpoint público do DataJud não inclui o STF. Para acompanhamentos do Supremo, selecione **STF (portal oficial)** e cole o link `portal.stf.jus.br/processos/detalhe.asp?incidente=...`; o sistema consulta a página oficial, a aba de andamentos e a aba de decisões. Por exemplo, a notícia do ICMS sobre produtos intermediários identifica o RE 1.424.015, Tema 1.465.

Os registros iniciais continuam sendo cenários demonstrativos e aparecem identificados como tal. Alertas criados pela varredura usam `isDemo: false` e sempre guardam o endereço oficial e a trilha de proveniência.

## Verificação

```powershell
npm.cmd --prefix back test
npm.cmd --prefix front run build
```

## Referências

- [Scrapling](https://github.com/D4Vinci/Scrapling) — BSD-3-Clause
- [awesome-llm-apps](https://github.com/Shubhamsaboo/awesome-llm-apps) — Apache-2.0
- [Ollama](https://github.com/ollama/ollama) — MIT
