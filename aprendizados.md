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
| ARC-394 ganhou dono | Alec se atribuiu ontem 18:38 (apos o alerta da manha); segue To Do High; o reforco 'ainda sem dono' cairia em falso -> gate ao vivo pegou | revisar | run 2026-08-11 10:10 | ativo |
| FastShop integracao Amazon x AnyMarket x Kruzer x GAN | notas nao recebidas em producao (impede expedicao/escrituracao/contabilizacao), reportado 11/08 09:19 a Matheus/Felipe/Rogerio, sem ticket -> proposta vermelha | revisar | run 2026-08-11 10:10 | ativo |
| Webhook Tuna so aceita token fixo | inviabiliza Bearer/JWT; cliente espera a Kruzer definir a validacao do token fixo (~1 dia util) -> proposta amarela | revisar | run 2026-08-11 10:10 | ativo |
| KRZR-2994 virou Waiting for support | de Waiting for customer p/ bola da Kruzer apos cliente enviar cod promo 64439 hoje 09:15; highest producao, dono Giovanelli | revisar | run 2026-08-11 10:10 | ativo |
| KRZR-2995 Rappi bloqueio externo | Kruzer diagnosticou store id divergente (Rappi 900734007 vs loja 41), cliente vai reportar a Rappi -> nao e atraso da Kruzer | sempre | run 2026-08-11 10:10 | ativo |
| KRZR-2996 pede revisao de regra PBM | aberto 11/08, alem do ajuste do pedido pede revisar a regra de bloqueio de edicao para pedidos com PBM (mudanca de comportamento) | revisar | run 2026-08-11 10:10 | ativo |
| Etapa APPEND-HERMES sem marcar bot | por decisao do Vitor 11/08 o bloco de aprendizados nao menciona mais o KruzerBot nem instrui commit; o Claude do canal reage ao bloco e commita | sempre | run 2026-08-11 10:10 | ativo |
| Bug de args corrigido (v4) | args chegava ao coleta-fanout como STRING JSON -> saude/janela/desde ignorados em silencio (subagentes usavam a data do proprio env); script v4 agora normaliza string OU objeto no topo; validado nesta run: subagentes=12, saude_rodou=true, janela incremental respeitada | feito | run 2026-08-11 13:46 | ativo |
| C11 Saude do Jira 1a execucao em producao | 150+ tickets orfaos (FST26/KOMS21/DCT19/KP15/KL10/VENA8); KL-1 Highest vencido ~85d parado em Em Revisao; concentracoes DCT(Folco 5)/PMD(Menendes 21)/KOMS(6) ongoing; terca sem reforco => panorama; 2 propostas: KL-1 e backlog orfao em massa | revisar | run 2026-08-11 13:46 | ativo |
| Cadencia C11 confirmada | itens estruturais ongoing NAO viram alerta em dia normal, so panorama 'aberto ha N dias'; reforco so na segunda (realerta_semanal) ou no cruzamento de limiar de idade | sempre | run 2026-08-11 13:46 | ativo |
| GAN FastShop escalou no e-mail | alerta despachado 10:23; Slack engajou (Rogerio) mas a thread de e-mail cobrou prazo/evidencias ~13:32 sem devolutiva formal da Kruzer; homologacao parada, impacto fiscal; recobrar a resposta formal | revisar | run 2026-08-11 13:46 | ativo |
| Venancio KRZR-2899/2980/2923 reabertos | bot auto-expirou por silencio de 3 dias, cliente reabriu hoje (10:15-11:04); bola voltou p/ Kruzer (Waiting for support); fixes reprovados no QA; KRZR-2899 pede deploy em PROD porque nao consegue testar no QA (volume incompativel) | revisar amanha | run 2026-08-11 13:46 | ativo |
| Coleta via Task validada (sem Workflow) | correcao 11-12/08: run agendado travava no prompt do Workflow; trocado por subagentes Task + IDs de servidor MCP fixos trocados por nomes estaveis (mcp__Slack__/Atlassian_Rovo__/Gmail__/Granola__/tldv__/Kruzer_Pulse__); 1o run ao vivo 11/11 OK, zero prompt, zero falha | feito | run 2026-08-12 09:16 | ativo |
| Causa do crash de 11/08 era 1 so | nao eram 3 causas (query removida/channel_not_found/nao-membro): era so o hardcode de UUID de servidor MCP de outra sessao; select vinha vazio e foi mal interpretado; licao: nunca chumbar UUID de servidor, usar nome de conector + fallback keyword | sempre | run 2026-08-12 09:16 | ativo |
| Homologacao FastShop 401 | <http://apiqa.fastshop.com.br/order-management/v0|apiqa.fastshop.com.br/order-management/v0> erro 401, cliente Cortezi parado, Matheus 11/08 16:41 sem estimativa -> despachado #proj-fastshop | revisar | run 2026-08-12 | ativo |
| KRZR-2994 causa raiz pendente | cliente perguntou 12/08 08:46 se causa corrigida ou se repete; Waiting for support (bola Kruzer), Highest -> despachado #proj-venancio | revisar | run 2026-08-12 | ativo |
| Decathlon Adequacoes Operacionais | Takeshi devolveu doc 26 pontos 11/08 17:02, pede data final comite + liberacao imobilizado -> despachado #proj-decathlon | revisar | run 2026-08-12 | ativo |
| Risco LGPD PagueMenos | Daily 11/08 (tl;dv): time tecnico seguiu frente contraria ao consentimento LGPD definido, impacto cadastro/identificacao, sem ticket -> DM Bruno Pavan (sensivel, nao canal) | revisar | run 2026-08-12 | ativo |
| KRZR-2917/2979/2997 Done | cliente encerrou na janela, confirmado terminal no Jira ao vivo | feito | run 2026-08-12 | arquivado |
| KRZR-2899 mis-tag possivel | eco cliente 'pede deploy PROD/nao testa no QA' mas Jira KRZR-2899 e 'Integracao Abbiamo erro 506' Waiting for customer; possivel key trocada, conferir | revisar | run 2026-08-12 | ativo |
| Assinatura Prime QA2 stale | Rogerio prometeu analise 04/08, cliente Murozaki re-cobrou 11/08 16:26, ~7d sem retorno; rastreado como engajado mas candidato a refresh | revisar | run 2026-08-12 | ativo |
| FALSO-POSITIVO FastShop Homolog-401 | despachado 12/08 09:16 #proj-fastshop, mas Rogerio esclareceu no thread que o 401 era da API de MANUTENCAO da propria FastShop e o cliente ja validou o ajuste ontem; o e-mail parou em 11/08 16:41 'sem estimativa' e a resolucao veio FORA daquela thread. Fechado/desconsiderado. Score do run -1 (credibilidade) | corrigir | run 2026-08-12 09:16 | ativo |
| Gate reforcado p/ item sem ticket | item derivado de e-mail (sem key Jira) DEVE passar por convergencia cross-superficie (Slack + thread-mae + ProdDb/ask) buscando desfecho posterior a ULTIMA mensagem, ANTES de despachar; e checar se o sistema com erro e da Kruzer ou do cliente (401 era manutencao FastShop) | sempre | run 2026-08-12 09:16 | ativo |
| Decathlon Adequacoes reverificado VALIDO | sem resposta Kruzer apos Takeshi 11/08 17:02 em nenhuma superficie; alerta procede | feito | run 2026-08-12 09:16 | ativo |
| FastShop 401 encerrado como falso-positivo | a linha 'revisar' da manha fecha: 401 era API de manutencao da propria FastShop, cliente ja validara ontem; desconsiderado e arquivado | feito | run 2026-08-12 10:56 | arquivado |
| KRZR-2998 Done | normalizacao de pedido (endereco pos-delecao Minicart, PIX pago) validado pelo cliente 10:25, Done 10:41; ciclo completo dentro da janela | feito | run 2026-08-12 10:56 | arquivado |
| Decathlon Adequacoes segue sem data ao cliente | despachado 09:16; Matheus respondeu 09:20 que esta estimando esforco/prazo, mas ate 10:56 nenhuma data foi devolvida ao Takeshi | revisar | run 2026-08-12 10:56 | ativo |
| Decathlon Integracao de Preco | cliente pediu disponibilidade Folco/Matheus (canal externo 09:50) + convite p/ hoje 17:00 (Takeshi); reuniao ja sendo agendada -> radar, nao alerta | revisar | run 2026-08-12 10:56 | ativo |
| Saude do Jira quarta = panorama | 0 alerta novo (sem reforco semanal); KL-1 ja despachado 11/08, backlog orfao descartado 11/08; ~150+ orfaos e vencidos KL/PMD/DCT seguem como panorama 'aberto ha N dias' | sempre | run 2026-08-12 10:56 | ativo |
| Coleta via Task 2o run headless OK | 12/12 subagentes, saude_rodou=true, zero prompt, zero falha; correcao 11-12/08 segue firme | feito | run 2026-08-12 10:56 | ativo |
| Higiene tabela viva pendente | linhas terminais no Jira (PMD-1246/1642/1671/1698 Done) aparecem embutidas em narrativas/bullets agrupados, nao como linhas discretas -> poda segura exige reestruturar a tabela viva, nao apagar bullet historico | revisar | run 2026-08-12 10:56 | ativo |
| Tarde 12/08 0 NOVO | run incremental confirmou rastreio e nao re-alertou escalada FastShop nem desvio LGPD PM (ambos tratados de manha) | sempre | run 2026-08-12 15:02 | ativo |
| FastShop escalada arquitetura/relacao segue aberta | ~5,5h, 2a msg 14:34 (checklist logistico), sem devolutiva Kruzer no thread; DM Vitor desde 10:56; ligado a desligamentos Larissa 13/08 e Rogerio 14/08 | revisar | run 2026-08-12 15:02 | ativo |
| KL-1 ownership em risco | assignee Rogerio Junior (Rogerinho) sai 14/08 e KL-1 Homologacao FastShop segue Em Revisao parado ~69d -> reatribuir dono | revisar 14/08 | run 2026-08-12 15:02 | ativo |
| ARC-277 migracao OMS Mongo->Postgres Done hoje | OMS zerado em prod (Alec 11:58), pede testar tudo e reespelhar PRs Mongo->Postgres; cleanup Mongo semana que vem; janela de estresse 1 semana | monitorar | run 2026-08-12 15:02 | ativo |
| iFood webhook erro nao despachado | alerta automatico ->Folco 14:51; item sem ticket, sem convergencia cross-superficie, falha Kruzer-vs-iFood nao confirmada -> radar, aplicou regra dura pos-401 | sempre | run 2026-08-12 15:02 | ativo |
| Coleta via Task 3o run headless OK | 11/11 subagentes, saude:false, zero prompt, zero falha; correcao 11-12/08 estavel | feito | run 2026-08-12 15:02 | ativo |
| LGPD Pague Menos consentimento RESOLVIDO | Victor Ferreira declarou 15:05 no #proj-paguemenos: agenda com a PGM alinhou, prototipo nao muda; item despachado 09:16 (DM Bruno) encerrado -> movido p/ Arquivo de Resolvidos | feito | run 2026-08-12 18:19 | arquivado |
| ARC-335/396/400 Concluidos na tarde | plataforma ARC fechou 3 tickets 15:56-16:54 (CSR Infra QA, CSR blocker, OMS-PG busca EAN/telefone); nao eram alertas do Guardiao, so movimento de alivio | feito | run 2026-08-12 18:19 | ativo |
| Cora Hub cronograma entregue no prazo | Larissa entregou 12/08 a versao atualizada (GMO/Gestao de Mudanca) a Fernanda -> fecha o radar 'cronograma promete 12/08' | feito | run 2026-08-12 18:19 | ativo |
| FastShop LG QA cadastro usuario radar | Mateus pediu 16:10 cadastrar INTERFACERHKRUZERQA no QA da Kruzer (a Rogerio), sem retorno ~2h; nao despachado (piso < meio dia util + sem ticket superficie unica); Rogerio sai 14/08 -> se seguir sem dono amanha cedo, vira alerta | revisar amanha | run 2026-08-12 18:19 | ativo |
| KRZR-2999 troca Fidelize radar | cliente Carlos Camelo 18:04 pediu cancelar troca e refazer como Devolucao (convenio nao permite mais); voltou a Aguardando pelo suporte (bola Kruzer, Giovanelli); fresquissimo ~15min -> radar, nao alertado; relacionado KRZR-3000 | revisar amanha | run 2026-08-12 18:19 | ativo |
| KRZR-2994 corrigido p/ Aguardando cliente | tabela viva dizia Waiting for support; ao vivo 15:11 suporte apontou origem VTEX (promocoes agrupadas), sem correcao Kruzer, status Aguardando cliente = bola do cliente; linha da tabela viva corrigida | sempre | run 2026-08-12 18:19 | ativo |
| KL-1 assignee ao vivo e Felipe Martins | input/memoria diziam dono Rogerio Junior (sai 14/08) mas Jira ao vivo mostra felipe.martins; Highest Em Revisao ~69d segue aberto; reconfirmar ownership antes do desligamento | revisar 14/08 | run 2026-08-12 18:19 | ativo |
| FastShop GAN notas re-cobrado sem devolutiva | cliente cobrou prazo/painel 15:52 na thread da integracao AnyMarket x Kruzer x GAN sem resposta na propria thread (Matheus ativo no topico irmao de cancelamento, subiu solucao testavel 17:36); item ja rastreado/despachado 11/08, dentro do cluster FastShop ja com o Vitor -> nao re-despachado, segue ⏳ | revisar | run 2026-08-12 18:19 | ativo |
| KRZR-2899/2980/2923/2996 = Aguardando cliente | os quatro estao com bola do cliente ao vivo (nao reabertos como Waiting for support); a duvida de mis-tag do run da manha fica esclarecida -> nao sao alerta Kruzer | sempre | run 2026-08-12 18:19 | ativo |