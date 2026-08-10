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

| Tema | Contexto | Prazo | Origem | Status |
|---|---|---|---|---|
| Gmail C3/C4 estoura retry cap | subagente inbox+Fireflies (coleta-fanout parallel[7]) estourou StructuredOutput retry cap em 2 runs (09:58 e 14:12) -> digests parciais | corrigir ja | digest 2026-08-07 | ativo |
| Cluster ARC OOM subcontado | tabela viva listava 3 tickets; Jira ao vivo tinha 8 sem dono (ARC-225/305/386/387/389/390/391/392) -> expandir cluster pelo Jira ao vivo | sempre | run 2026-08-07 | ativo |
| Tema sensivel -> DM/canal privado | relacao de conta abalada / enquadramento de confianca nao vai a #proj aberto (FastShop Fast Pro por DM; PM risco-crise por #proj-paguemenos-gestao) | sempre | run 2026-08-07 | ativo |
| Reacoes em proposta = conta do Vitor | check/x semeados pelo bot sao indistinguiveis do clique do Vitor -> nao semear; check do Vitor na proposta e aprovacao inequivoca | sempre | correcao de run 07/08 | ativo |
| Correcao #1 (Gmail/Fireflies serial+fallback) | RESOLVIDA lado Claude: coleta-fanout com try/catch na resiliencia + controle de volume no C3/C4; instalada no skill guardiao-v3 | feito | digest 2026-08-07 | ativo |
| Correcao #2 (orfao board PMD) | APLICADA: alerta orfao board PMD (ts 1786108796.240889) registrado na tabela viva no run 14:12 | feito | digest 2026-08-07 | arquivado |
| Correcao #1 (Gmail/Fireflies serial+fallback) VALIDADA | run incremental 07/08 21:23 rodou 11/11 subagentes OK, C3/C4 varridos sem estouro de retry | feito | run 2026-08-07 21:23 | ativo |
| Host em UTC nao BRT | subagentes de coleta trataram hoje=sabado 08/08 (relogio do host em UTC); sessao principal usou BRT sexta 07/08 21:02. Passar hoje/desde/janela em BRT nos args e revalidar datas na reconciliacao | sempre | run 2026-08-07 21:23 | ativo |
| Falso-positivo evitado KRZR-2987/2988 | ambos Waiting for customer no Jira ao vivo = bola do cliente, nao alertar como sem retorno | sempre | run 2026-08-07 21:23 | ativo |
| Integridade VENA-713 | aparece Entregue (PR vpharma#6 merged) mas Jira em Backlog -> card nao atualizado pos-merge; conferir na fonte Jira antes de marcar entregue | sempre | run 2026-08-07 21:23 | ativo |
| Debito de seguranca orfao Venancio | VENA-692..695 (JWT forjavel, CORS aberto, isolamento por loja, operatorCode forjavel) em Backlog sem dono -> superficie de seguranca sem responsavel | revisar | run 2026-08-07 21:23 | ativo |
| Correcao #3 (link Jira em linha propria) | APLICADA: propostas de 07/08 usam link em linha propria, sem <...> | feito | digest 2026-08-07 | arquivado |
| Run de fim de semana = 0 alerta por tempo | run incremental sabado 08/08 rodou limpo, 0 NOVOS; silencio de sexta-noite/sabado nao vira alerta de sem-retorno, so deadline/risco ativo conta | sempre | run 2026-08-08 14:11 | ativo |
| KRZR-2991 SNGPC CRM errado | aberto sabado 08/08, producao, regulatorio (validacao SNGPC), Pending com dono Giovanelli -> nao alertado por regra de fds; cobrar triagem/status na 2a 11/08 | revisar 11/08 | run 2026-08-08 14:11 | ativo |
| DCT-56 pentest externo bloqueador go-live | To Do SEM DONO desde 01/06, rotulado BLOQUEADOR Go-Live; higiene de longa data -> confirmar se ainda e bloqueador real e atribuir dono | revisar | run 2026-08-08 14:11 | ativo |
| Divergencia Git x Jira no cluster ARC OOM | PRs #11/#12 em api-gateway-v2 existem no GitHub mas os 8 cards ARC seguem sem dono no Jira -> conferir merge/deploy e fechar cards | sempre | run 2026-08-08 14:11 | ativo |
| ARC-394 seguranca-LGPD novo sem dono | PII (NF-e XML) + apikeys em texto plano nos logs do api-gateway-v2 prod, To Do High sem dono, nascido do mesmo blind spot do cluster ARC OOM | revisar | run 2026-08-10 | ativo |
| Incidente OOM api-gateway-v2 RESOLVIDO | PRs #11/#12 (prod-0.1.49), 68h sem reciclagem; ALIVIO real, mas ARC-225 (causa raiz) + 8 cards ARC + ARC-389 seguem To Do sem dono | sempre | run 2026-08-10 | ativo |
| KRZR-2992 Done | 'repro Pedido POS em 0' fechado (era Waiting for support/cobravel) | feito | run 2026-08-10 | arquivado |
| PMD-1729 e PMD-1694 bloqueiam PMD-204 ja Done | bloqueador aberto de item concluido -> possivel obsolescencia, verificar antes de tratar como ativo | revisar | run 2026-08-10 | ativo |
| Orfao Elyneker-PO cronograma Desconto | alerta proprio ts 1785869164.362219 disparado sem registro na tabela viva -> adicionado nesta gravacao | corrigir | run 2026-08-10 | ativo |
| Samsung certs SSL fora do C10 | ~13 certs *.samsung.krzlabs.io vencem ~23/08 sem dono; cliente novo sem projeto/canal proprio; precedente FastShop virou vermelho | revisar 23/08 | run 2026-08-10 | ativo |
| KRZR-2991 Pending producao HIGH | aberto sab 08/08 (Carlos Camelo), status Pending nao mapeado, dono Giovanelli; cobrar triagem na 2a | revisar | run 2026-08-10 | ativo |
| Subagentes reinterpretam janela | passei janela=3d nos args mas subagentes aplicaram '2d uteis'; nesta 2a cobriu de sex 07/08 (fds excluido) = equivalente, mas reforcar 3d literal p/ nao perder a quinta anterior | revisar | run 2026-08-10 | ativo |
| CORRECAO do orfao Elyneker-PO Desconto | a linha anterior dizia que o ts 1785869164.362219 foi adicionado a tabela viva como orfao; ERRADO: ele ja estava no Arquivo de Resolvidos como resolvido/falso-positivo de 04/08 (Larissa ja encaminhara ao Elyneker). Inclusao REVERTIDA. Licao: na reconciliacao, checar o Arquivo de Resolvidos por ts antes de tratar alerta proprio ausente da tabela viva como orfao aberto | sempre | run 2026-08-10 | ativo |
| 5 propostas aprovadas e despachadas 10/08 10:53 | ARC-394 (seg/LGPD), KRZR-2991 (SNGPC), Credix B2B DMND0002252 (cronograma), PM URL Coelho->WS (confirmar), Samsung SSL (~23/08). Todas passaram no gate ao vivo; registradas na tabela viva + dispatch-log | feito | run 2026-08-10 10:53 | ativo |
| KRZR-2994 nao alertado (Waiting for customer) | novo highest producao Venancio aberto 13:58 (cDesc quebrado no JSON), mas Jira ao vivo mostrou ja assigned Giovanelli + Waiting for customer = bola cliente; gate ao vivo desmentiu o eco 'sem retorno' do #tickets-alerts | sempre | run 2026-08-10 17:47 | ativo |
| Samsung SSL resolvido no mesmo dia | Folco renovou os ~13 certs no mesmo dia do alerta (16:28 + check); alerta de vencimento de cert funciona mesmo com infra suspensa | feito | run 2026-08-10 17:47 | arquivado |
| KRZR-2991 destravou pos-alerta | Pending -> Work in progress logo apos o alerta das 10:59; PR api-vena-core#150 [QA] remocao codigo RJ no CRM | feito | run 2026-08-10 17:47 | ativo |
| ARC-394 reconhecido mas sem dono | Alec reconheceu no Slack ('bom ponto') mas NAO atribuiu dono nem remediacao; segue To Do High sem dono; recobrar amanha | revisar | run 2026-08-10 17:47 | ativo |
| Wagner URL Coelho->WS formalizado 07/08 | Larissa confirmou formalizacao; ressalva nao confirma reenvio ao endereco certo apos bounce @pmnos.com | revisar | run 2026-08-10 17:47 | ativo |