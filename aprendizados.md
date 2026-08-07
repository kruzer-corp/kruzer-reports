# Aprendizados Compartilhados — Guardião (Claude) ↔ KruzerBot (Hermes)

> Canal de memória viva entre o Guardião v3 (que roda na conversa do Vitor com o Claude)
> e o KruzerBot (Hermes). Cada agente **append** aqui aprendizados que o outro deve
> carregar no próximo run. Versionado via git; publicado em gh-pages para leitura por ambos.
>
> **Convenção de linha:** `{tema} | {quem/contexto} | {prazo} | {origem} | {status}`
> **Status:** `ativo` | `revisar` | `arquivado` — nunca apagar linha ativa, marcar `arquivado`.

## Dump inicial — memória Hermes (KruzerBot), 2026-08-07

Aprendizados já consolidados no Hermes que o Guardião deve respeitar:

| Tema | Contexto | Prazo | Origem | Status |
|---|---|---|---|---|
| Board KRZR — semântica de status | `Waiting for support` = bola Kruzer = **cobrável**; `Waiting for customer` = bola cliente = **não cobrável**; Done/Duplicated/Cancelado/Expired = terminal | sempre | memória Hermes | ativo |
| Board VENA — UAT | UAT = bola do cliente (confirmado Matheus Mereb) — tempo do cliente, **não** é atraso Kruzer. Equivale a Waiting for customer | sempre | memória Hermes | ativo |
| Alertas IN-* | Alertas de infra derivados de ticket de monitoramento **suspensos** (decisão Vitor, 27/07) até auto-fechamento dos IN-* no ar | revisar após auto-fechamento | decisão Vitor | ativo |
| Conversão de hora | BRT = UTC−3 via `date -u -3h`; **nunca** `TZ='America/Sao_Paulo'` (zona ausente no host → cai em UTC silenciosamente) | sempre | correção de run | ativo |
| Slack — leitura de mensagem | Antes de afirmar "não consigo acessar", sempre tentar `conversations.history` com channel ID + `oldest/latest` parseados da URL | sempre | correção de run | ativo |
| Jira — cloudId | `dd987a38-5d13-4230-ab43-7141dc3695e1`; proxy `api.atlassian.com` | sempre | infra | ativo |
| Jira — KOMS | Projeto classic; `customfield_10014` = Epic Link | sempre | infra | ativo |
| Jira — KRS (sales) | `Customer (10293)` = lead frio; `Oportunidade (10294)` = com solução | sempre | infra | ativo |
| Jira — KDT | Projeto classic; Rafael é stakeholder | sempre | infra | ativo |
| Story template | Context / Who / What / Why / ACs / TechNotes / OutOfScope | sempre | convenção | ativo |
| Subtasks Jira | Criar via `parent.key` + `issuetype=10008` | sempre | convenção | ativo |
| Reports | Nginx 8081, auth `j4pm`; staticrypt `KzrReports`; htpasswd desconhecido | sempre | infra | ativo |
| Briefing diário | `daily_briefing.py` roda seg–sex 8h/14h; publica em `kruzer-corp.github.io/kruzer-reports/briefing/` | sempre | infra | ativo |

## Correções pendentes no fluxo do Guardião (aplicar no lado Claude)

| # | Correção | Origem |
|---|---|---|
| 1 | Varredura Gmail/Fireflies: rodar em série, janela menor, fallback sem subagente quando estourar retry (digests de hoje saíram parciais) | digest 2026-08-07 |
| 2 | Tabela viva: registrar alerta órfão do board PMD (100+ vencidas) apontado no digest 14:12 | digest 2026-08-07 |
| 3 | Propostas: link do Jira em linha própria, sem `<…>` (hoje engole o ":white_check_mark: aprovar e postar") | digest 2026-08-07 |

## Espaço para append do Claude

<!-- O Claude adiciona aqui, na mesma convenção de tabela acima. -->
