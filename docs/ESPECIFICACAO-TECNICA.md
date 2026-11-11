# Especificação Técnica — Carreira em Jogo (versão web, fases 1 e 2)

Contrato de implementação derivado de `docs/DOCUMENTACAO-CONSOLIDADA.md`, atualizado para descrever o sistema atual. A fase 1 implementou **exatamente** o que os alunos documentaram; a fase 2 mudou regras do jogo por decisão do responsável pelo projeto. **Onde as duas divergem, vale a fase 2**, mesmo que a documentação dos alunos ou a consolidada digam outra coisa, e o código (`src/`, `data/`) é a fonte da verdade. A documentação original dos alunos fica como está.

As regras novas estão marcadas como **[FASE 2]**. Onde a documentação é omissa ou contraditória, a decisão adotada está marcada como **[DECISÃO]**; as da fase 1 estão listadas na documentação consolidada (§11).

| Tema | Fase 1 (substituída) | Fase 2 (vale agora) | Regra |
|---|---|---|---|
| Dado | O mediador informava o valor | **Girar o dado**: o servidor sempre sorteia. O jogo é só digital: não há tabuleiro nem dado físico, e os botões e as teclas de 1 a 6 saíram | §4.3 |
| Casa amarela | Pergunta de Gestão do Tempo | Sem pergunta: a jogada termina e a vez passa, inclusive na amarela com seta | §4.3 |
| Resposta | **Correta**/**Incorreta**, com o gabarito na tela | Alternativas A, B, C e D, corrigidas pelo servidor; a coluna `resposta` agora é a explicação | §4.6 |
| Pontos | 10 por pergunta, editáveis | Fácil 5, Médio 10, Difícil 15; o administrador não digita pontos | §4.6 |
| Categorias | Verde = Finanças, amarelo = Gestão do Tempo | Verde = Entrevista (5ª categoria, nota por alternativa); Finanças e Gestão do Tempo só nas casas-surpresa | §4 e §4.4 |
| Caveira | Casa-surpresa, com pergunta | Casa da Morte: elimina na hora, sem pergunta | §4.3 |
| Percurso | Uma linha, de 0 a 65 | Três rotas à escolha: Esquerda, Centro e Direita | §4 |
| Brinde | 3 níveis, pela casa alcançada | 8 cargos, pela pontuação total | §4.11 |
| Certificado | Não havia | Página por jogador, para imprimir ou salvar em PDF | §4.15 |
| Banco | Bancos antigos eram aceitos | Sem migração: banco da fase 1 é recusado na subida | §1 |
| Pergunta em jogo | Podia ser editada | Editar responde 409 | §5 |

Os riscos medidos e o que fica fora do sistema estão no §8.

## 1. Stack e estrutura

- **Node.js ≥ 22.13** (usa `node:sqlite`, embutido), **Express 5**, HTML5 + CSS3 + JavaScript puro (ES modules, sem build) — RNF05.
- **SQLite** local em `data/carreira.db`, criado e populado automaticamente na 1ª execução: os seeds só rodam com `PRAGMA user_version = 0` e gravam `PRAGMA user_version = 1` na mesma transação, então o que o administrador excluir (escola, perguntas) não volta ao reiniciar. Num banco já no schema atual, mas com `user_version = 0`, cada seed só preenche tabela vazia. `DB_PATH=:memory:` nos testes.
- **Banco da fase 1 é recusado, sem migração [FASE 2]** — a coluna `casa_minima` em `TB_BRINDE` o identifica, e a subida para antes de qualquer `CREATE` com o erro `<caminho> é da fase 1 e não é migrado. Pare o servidor, guarde esse arquivo em outra pasta (com -wal e -shm, se existirem) e inicie de novo.` Os três arquivos saem juntos: os dados mais recentes podem estar no `-wal`, e o SQLite descarta um `-wal` deixado para trás ao criar o banco novo. Ao fechar a conexão recusada, o SQLite pode consolidar o `-wal` no `.db`; nesse caso sobra um arquivo só. O banco de teste da fase 1 fica guardado em `data/backup-fase1/`.
- Fonte Fredoka (OFL) servida localmente em `/vendor/fredoka/...` — nada depende de internet no dia do evento.

```
src/server.js      rotas de página + guarda de acesso (RNF04) + bloqueio de origem cruzada + monta /api + erros em JSON
src/auth.js        sessão por cookie (7 dias), login/logout/me, exigeLogin/exigeAdmin
src/senha.js       hash scrypt (conferência assíncrona no login)
src/db.js          recusa do banco da fase 1 + schema + seeds só em banco novo (usuários, escola, categorias, casas, brindes, perguntas e alternativas) + função sem_acento() das buscas + ROTAS e gravarAlternativas()
src/api.js         TODAS as rotas /api (exceto login/logout/me)
src/jogo.js        motor da partida (regras RF03–RF09, RNF06) + dados do certificado
data/tabuleiro.json  121 casas (0 = INÍCIO, 1–64, 65 = Chegou!, 101–119 só na rota Centro, 201–236 só na rota Direita) com coordenadas em % da imagem + "rotas" (a sequência de casas de cada rota)
data/perguntas.json  banco inicial de 112 perguntas com 4 alternativas cada: 25 por categoria + 12 de Entrevista (correta e dificuldade; na Entrevista, a nota de cada alternativa)
views/*.html       páginas (servidas por rota, nunca como arquivo estático), inclusive certificado.html
public/css/style.css  estilos base (tokens, topo, cartões, formulários, botões RNF01, tabela, toast, spinner, tabuleiro)
public/css/certificado.css  certificado virtual: A4 deitado, igual na tela e no PDF
public/js/app.js      api(), iniciarPagina(), toast(), esc(), formatarData(), formatarTempo(), valorDaPergunta(), resultadoJogada(), ehAdmin()
public/js/tabuleiro.js criarTabuleiro(), peaoSVG(), CORES_PEAO, NOMES_ROTA
public/js/pages/*.js  script de cada página, inclusive certificado.js
public/img/        tabuleiro.png, logo.png, chaveiro-centro.png (recorte usado nas telas), chaveiro.png (sem uso nas telas desde a fase 2), verso-carta.jpg, adm.png, peoes.png; logo-senai.png é a logo oficial do SENAI e não vem no projeto (sem o arquivo, o certificado sai com o texto "SENAI")
test/*.test.js     testes com node:test (npm test)
```

## 2. Convenções

- **Erros da API**: sempre JSON `{ "erro": "mensagem em português para exibir ao mediador" }` com status: 400 validação, 401 sem login, 403 sem permissão (mensagem exata: `Acesso Negado: Você não tem permissão para visualizar esta página`) ou requisição de outra origem (`Requisição de outra origem bloqueada.`), 404 não encontrado, 409 conflito de regra (duplicidade, estoque zero, etapa errada, tela desatualizada, pergunta em jogo, certificado antes do fim), 413 corpo grande demais, 415 formato não suportado.
- **Erros de entrada tratados pelo servidor** (também em português, nunca a mensagem técnica em inglês): JSON malformado → 400 `Corpo da requisição inválido (JSON malformado).`; corpo grande demais → 413 `Requisição grande demais.`; charset/encoding não suportado → 415 `Formato de requisição não suportado.`; parâmetro malformado na URL → 400 `Parâmetro inválido na URL.`; rota `/api` inexistente → 404 `Rota não encontrada.`; outro status 4xx vindo das bibliotecas (ex.: 412/416 de `If-Match`/`Range` nas páginas) → `Requisição inválida.`; erro inesperado → 500 `Erro interno no servidor.`. Só a mensagem dos erros do próprio app (`erro()` de `src/jogo.js`, já em português) vai direto para a tela.
- **Inteiros** vindos do corpo ou da URL passam por `inteiro()` (`src/jogo.js`): aceita número ou texto só com dígitos (sinal de menos e espaços nas pontas são tolerados) que resulte num inteiro seguro (`Number.isSafeInteger`) — ex.: `"3"`, e também `"01"`, que vale 1; o resto é inválido, inclusive `"1.0"`.
- **Datas**: inteiros *epoch* em segundos (`unixepoch()` no SQLite). O front formata com `formatarData()`.
- **Booleanos** na API: `true/false` (no banco 0/1).
- **Segurança**: toda string vinda do usuário é escapada com `esc()` antes de ir para `innerHTML`. SQL sempre com parâmetros `?`. Antes de todas as rotas `/api` (inclusive login e logout), um middleware em `src/server.js` responde 403 `{ "erro": "Requisição de outra origem bloqueada." }` a toda requisição de método diferente de GET/HEAD quando o cabeçalho `Sec-Fetch-Site` for `cross-site` ou `same-site`, ou quando houver cabeçalho `Origin` cujo host não seja igual ao cabeçalho `Host`.
- **Front**: cada página usa o modelo abaixo; a função `api(metodo, url, corpo)` já trata JSON, erro (lança `Error` com `.status` e `.dados`), redireciona ao login em 401 e mostra spinner após 1 s (RNF03).

```html
<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Recepção · Carreira em Jogo</title>
  <link rel="icon" href="/img/logo.png">
  <link rel="stylesheet" href="/css/style.css">
  <!-- CSS específico opcional: /css/<pagina>.css -->
</head>
<body>
  <div id="topo"></div>
  <main class="conteudo">
    <h1 class="titulo-pagina">Recepção</h1>
    ...
  </main>
  <script type="module" src="/js/pages/recepcao.js"></script>
</body>
</html>
```
```js
import { api, iniciarPagina, toast, esc } from '/js/app.js';
const usuario = await iniciarPagina({ menu: 'recepcao' }); // chaves: recepcao, nova-partida, partidas, estoque, admin-perguntas, admin-escolas, admin-brindes, admin-relatorios
```
- Classes base disponíveis em `style.css`: `.cartao`, `.grade`, `.campo` (+ `label`, `.obrigatorio`, `.erro-campo`), `.btn` (`.btn-primario` amarelo, `.btn-azul`, `.btn-perigo`, `.btn-pequeno`), `.botao-resposta` (largura total em tela estreita, RNF01), `.tabela-wrap` + `table`, `.selo` (`.selo-cat`, `.selo-esgotado`), `.aviso` (`.aviso-erro`, `.aviso-ok`, `.aviso-alerta`), `.suave`, `.linha-acoes`, `.vazio`, `.titulo-pagina`. Variáveis de cor em `:root` (ex.: `--cat-etica`, `--amarelo`, `--tinta`). `.botao-correta`, `.botao-incorreta` e `.botoes-resposta` saíram na fase 2, com os botões Correta/Incorreta; `.dados` e `.dado`, com os botões do dado físico.

## 3. Banco de dados

O schema completo está em `src/db.js` (fonte da verdade). Resumo:

| Tabela | Origem na documentação | Colunas principais |
|---|---|---|
| TB_USUARIO | RNF04 | id_usuario, nome, email (único), senha (hash), perfil `Administrador`/`Mediador`, unidade |
| TB_SESSAO | RNF04 | token, id_usuario, criado_em (a sessão vence 7 dias depois — §5) |
| TB_ESCOLA | RF02 | id_escola, nome (único, sem diferenciar maiúsculas), cidade |
| TB_JOGADOR | RF01 + JOGADOR (levantamento de entidades / modelo lógico) | id_jogador, nome, apelido?, email?, id_escola, criado_em |
| TB_CATEGORIA | Modelo lógico | id_categoria (1 Ética/Vermelho, 2 Finanças/Verde, 3 Rotinas/Azul, 4 Gestão do Tempo/Amarelo, 5 Entrevista/Verde-escuro), nome, cor, cor_hex, mecanica (`Múltipla escolha`; na Entrevista, `Nota por alternativa`) — a cor é a do fundo da pergunta; a cor da casa que leva a cada categoria está no §4 |
| TB_PERGUNTA | RF10 + CARTA | id_pergunta, enunciado, resposta (a explicação, mostrada depois de respondida), id_categoria, dificuldade `Fácil/Médio/Difícil` |
| TB_ALTERNATIVA | ALTERNATIVA (modelo lógico) | (id_pergunta, letra `A/B/C/D`), texto, pontos (≥ 0) — sai junto com a pergunta (`ON DELETE CASCADE`) |
| TB_CASA | CASA_TABULEIRO/TIPO_CASA | numero (0 = INÍCIO, 1 a 64, 65 = Chegou!, 101 a 119 = rota Centro, 201 a 236 = rota Direita), tipo `inicio/casa/chegada`, cor, icone, id_categoria (NULL em casa com pergunta = sorteada), x, y (%) |
| TB_BRINDE | RF08/RF09 + CARGO | id_brinde, nome (único), cargo, pontos_minimos, quantidade_estoque (≥ 0) |
| TB_PARTIDA | RF03 + PARTIDA | id_partida, status `Em Andamento/Pausada/Premiação/Finalizada`, codigo_online, unidade, id_mediador, vez, iniciada_em, encerrada_em, finalizada_em, pausada_em, segundos_pausados |
| TB_JOGADOR_PARTIDA | JOGADOR_PARTIDA | (id_partida, id_jogador), ordem 0..3, peao `verde/vermelho/azul/amarelo`, rota `esquerda/centro/direita` (padrão `esquerda`), casa_atual (→ TB_CASA), pontuacao, ativo (0 = removido, sem brinde), eliminado (1 = caiu na Casa da Morte, recebe o brinde) |
| TB_JOGADA | RF04/RF07 (+ CARTA_PARTIDA) | id_jogada, id_partida, id_jogador, valor_dado, casa_inicial e casa_final (→ TB_CASA), id_categoria, id_pergunta, alternativa (`A/B/C/D`, NULL até responder), acertou (NULL/0/1), pontos, concluida (0/1), criado_em — índice único `ux_jogada_pergunta` (id_partida, id_pergunta), a chave de CARTA_PARTIDA (RF06; aceita vários NULL) |
| TB_ENTREGA_BRINDE | RF08 | id_entrega, id_partida, id_jogador, id_brinde, id_usuario (quem confirmou), entregue_em — UNIQUE(id_partida, id_jogador) |

**Mudanças da fase 2, sem migração** (§1): tabela nova TB_ALTERNATIVA; colunas novas `TB_BRINDE.cargo` e `pontos_minimos`, `TB_JOGADOR_PARTIDA.rota` e `eliminado`, `TB_JOGADA.alternativa`; colunas removidas `TB_PERGUNTA.pontos` (agora vem das alternativas), `TB_BRINDE.nivel` e `casa_minima`. Como o banco da fase 1 é recusado, todo banco em uso já tem este schema, com as referências a `TB_CASA(numero)` e o índice `ux_jogada_pergunta`.

`src/db.js` exporta `db` (DatabaseSync) e `transacao(fn)` (BEGIN IMMEDIATE/COMMIT/ROLLBACK). Toda ação que grava mais de uma linha usa `transacao` (RNF06).

## 4. Regras do motor (`src/jogo.js`)

**Rotas [FASE 2]** — cada jogador segue a sua rota (RF04), uma sequência de casas definida em `data/tabuleiro.json` (`rotas`). Casa 0 = INÍCIO e casa 65 = **Chegou!** (`CASA_CHEGADA`, a casa com `tipo = 'chegada'`) nas três.

| Rota | Sequência | Passos até o Chegou! | Caveiras |
|---|---|---|---|
| `esquerda` (padrão) | 0 a 65 | 65 | 17 e 51 |
| `centro` | 0, 101 a 119, 23 a 65 | 62 | 51 |
| `direita` | 0, 201 a 236, 31 a 65 | 71 | 208 e 51 |

Nenhuma seta da arte define o sentido do anel no trecho do Centro: foi escolhida a subida até a casa 23. A alternativa seria descer até a 14, o que deixaria a rota sempre pior que a Esquerda **[DECISÃO]**. Atalhos e outros ramais da arte continuam fora.

**Faltam [FASE 2]** — `faltam(j)` = passos até o Chegou! na rota do jogador. Os números das casas não medem progresso (a 201 vem antes da 31), então é `faltam` que desempata o ranking da partida (tela final e telão) e o `vencedor` dos relatórios.

**Ação da casa [FASE 2]** — `acaoDaCasa(casa)` decide pela cor e pelo ícone pintados na arte, na ordem da tabela, e sai na API como `casa.acao`:

| `acao` | Casa | Ao parar nela pelo dado |
|---|---|---|
| `chegada` | `tipo = 'chegada'` (65) | a partida vai para a Premiação |
| `morte` | ícone `caveira` (17, 51 e 208) | Casa da Morte: elimina na hora, sem pergunta |
| `espera` | amarela, com ou sem seta | sem pergunta: a jogada termina e a vez passa |
| `pergunta` | todas as outras | jogada pendente, etapa `sortear` |

**Categoria da casa com pergunta [FASE 2]** — vermelho = Ética (a vermelha "-" da rota Centro, casa 116, funciona como vermelha comum), azul = Rotinas, verde = Entrevista (as casas verdes são as com maleta: 12, 35, 45 e 219). Roxo, rosa e preto sem caveira (casa 235) = **casa-surpresa**: `TB_CASA.id_categoria` é NULL e a categoria é sorteada (§4.4). Finanças e Gestão do Tempo só saem nas casas-surpresa.

1. **Criar partida (RF03)** — recebe 1 a 4 jogadores distintos já cadastrados (id inválido ou inexistente → 400 `Jogador não encontrado.`), cada um com peão distinto entre `verde, vermelho, azul, amarelo` (se o peão não vier, atribuir na ordem verde → vermelho → azul → amarelo, pulando os já usados) e com a sua `rota` (se não vier, `esquerda`; outra → 400 `Rota inválida: escolha esquerda, centro ou direita.`). `ordem` = posição na lista (0..n-1). Status `Em Andamento`, `vez = 0`, `codigo_online` = 6 caracteres de `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (único), `id_mediador` = usuário logado, `unidade` = unidade do usuário.
2. **Etapa** (derivada, nesta ordem): `Finalizada` → `finalizada`; `Premiação` → `premiacao`; `Pausada` → `pausada`; existe jogada com `concluida = 0` → `sortear` (se `id_pergunta` IS NULL) ou `responder`; senão → `dado`. Só a casa com ação `pergunta` deixa jogada pendente.
3. **Dado (RF04) [FASE 2]** — só na etapa `dado`. O servidor sempre sorteia, com `randomInt(1, 7)`; um número enviado pela tela é ignorado. Jogador da vez = jogador ativo com `ordem = vez`. `casa_final` = a casa tantas posições adiante na rota do jogador quanto o número sorteado, limitada ao Chegou! Grava TB_JOGADA (`casa_inicial`, `casa_final`, `valor_dado`, `id_categoria` = categoria da casa ou NULL) e atualiza `TB_JOGADOR_PARTIDA.casa_atual = casa_final` **na mesma transação** (o peão anda com o dado). O efeito depende da ação da casa:
   - `pergunta`: a jogada fica pendente, na etapa `sortear`.
   - `espera` **[FASE 2]**: a jogada já nasce `concluida = 1`, sem pergunta nem pontos, e a vez passa.
   - `morte` **[FASE 2]**: a jogada já nasce `concluida = 1`, sem pergunta nem pontos; `eliminado = 1` e a vez passa. O eliminado mantém os pontos, não joga mais, recebe o chaveiro e pode receber o certificado. Isso é diferente de removido (§4.13). Sem ninguém para jogar, a partida vai para a Premiação (§4.7).
   - `chegada`: a jogada já nasce `concluida = 1` sem pergunta e a partida vai para `Premiação` (`encerrada_em = agora`) **[DECISÃO]**.
4. **Sortear pergunta (RF05 + RF06)** — só na etapa `sortear`. Se a jogada não tem `id_categoria` (casa-surpresa) **[DECISÃO]**, sorteia uma categoria aleatória entre Ética, Finanças, Rotinas e Gestão do Tempo, só as que ainda têm perguntas inéditas na partida (a Entrevista só sai nas casas com maleta **[FASE 2]**). Depois:
   ```sql
   SELECT id_pergunta FROM TB_PERGUNTA
   WHERE id_categoria = ?
     AND id_pergunta NOT IN (SELECT id_pergunta FROM TB_JOGADA WHERE id_partida = ? AND id_pergunta IS NOT NULL)
   ORDER BY RANDOM() LIMIT 1;
   ```
   (o `AND id_pergunta IS NOT NULL` corrige um bug do SQL documentado: com qualquer NULL na subconsulta o `NOT IN` não retorna nada). Grava `id_pergunta` e `id_categoria` na jogada imediatamente (RNF06). Se não houver pergunta inédita: 409 `{ erro: 'Não há mais perguntas inéditas da categoria X nesta partida.', sem_perguntas: true }` (sem categoria com pergunta inédita: `Não há mais perguntas inéditas nesta partida.`) e o estado passa a indicar `jogada_pendente.sem_perguntas = true`.
5. **Pular (sem pergunta disponível)** — só na etapa `sortear` e somente se não existe pergunta inédita para a categoria da jogada (ou para nenhuma categoria, se a casa é sorteada). Conclui a jogada com `acertou = NULL`, `pontos = 0` e passa a vez.
6. **Responder (RF07) [FASE 2]** — só na etapa `responder`. `alternativa` obrigatória: `A`, `B`, `C` ou `D`, em maiúscula (outra coisa → 400 `Escolha uma das alternativas: A, B, C ou D.`). **O servidor corrige**: `pontos` da jogada = `TB_ALTERNATIVA.pontos` da letra escolhida, somados em `TB_JOGADOR_PARTIDA.pontuacao`, e `acertou` = 1 se os pontos forem acima de 0, senão 0. Pergunta comum: a alternativa correta vale pela dificuldade (Fácil 5, Médio 10, Difícil 15) e as outras valem 0. Entrevista: cada alternativa vale 15, 10, 5 ou 0, e conta como acerto com pontos acima de 0. Sem pontos, o peão **permanece** na casa (regra principal do RF07; "recua uma casa" não foi adotada) **[DECISÃO]**. Grava `alternativa`, marca `concluida = 1` e passa a vez. **A correção** (`resposta` e `alternativas[].pontos`) só é enviada a qualquer tela depois de a jogada ser respondida, com `alternativa` preenchida: nunca antes e nunca em jogada encerrada sem resposta, porque a pergunta pode sair de novo em outra partida.
7. **Passar a vez** — `vez` = `ordem` do próximo jogador que ainda joga (`ativo = 1` e `eliminado = 0`) após o atual (circular). Sem ninguém para jogar, a partida vai para `Premiação`, como no §4.9 **[FASE 2]**.
8. **Pausar / retomar** (perfil Mediador: "Iniciar, pausar e controlar o tempo") — pausar só em `Em Andamento` (grava `pausada_em`); retomar soma `agora - pausada_em` em `segundos_pausados`, limpa `pausada_em`, volta a `Em Andamento`. Em `Pausada`, dado/sortear/responder/pular → 409 `A partida está pausada.`.
9. **Encerrar** (fim por tempo, decidido pelo mediador) — permitido em `Em Andamento` ou `Pausada` (se pausada, contabiliza a pausa). Se houver jogada pendente, ela é concluída sem pontos e sem `alternativa`, então a correção não sai (§4.6). Status `Premiação`, `encerrada_em = agora`. A partida também chega à Premiação pelo Chegou! (§4.3) e quando não sobra ninguém para jogar (§4.7), inclusive se estiver pausada.
10. **Tempo de jogo** — `tempo_decorrido_s = (encerrada_em ?? agora) − iniciada_em − segundos_pausados − (pausada_em ? agora − pausada_em : 0)`.
11. **Brinde do jogador (RF08) [FASE 2]** — cargo = chaveiro: vale a faixa da **pontuação total**, `SELECT ... FROM TB_BRINDE WHERE pontos_minimos <= pontuacao ORDER BY pontos_minimos DESC LIMIT 1`. Não há teto de pontos: acima de 80 continua CEO. Dois brindes não podem ter os mesmos pontos mínimos (§5, `PUT /api/brindes/:id`). Se o administrador deixar a pontuação sem faixa, `brinde` é `null` e a entrega responde 409 `Nenhum brinde cadastrado para a pontuação deste jogador.`. Seed da hierarquia oficial, com as faixas baixadas a pedido do usuário (nome do brinde `Chaveiro <cargo>`, estoque inicial de 300 dividido pela procura simulada, tudo editável):

    | Cargo | Pontos mínimos | Estoque inicial |
    |---|---|---|
    | Jovem Aprendiz | 0 | 42 |
    | Estagiário | 10 | 32 |
    | Coordenador | 20 | 59 |
    | Gerente | 35 | 72 |
    | Gerente Geral | 50 | 41 |
    | Diretor de Área | 60 | 27 |
    | Vice-Presidente | 70 | 15 |
    | CEO | 80 | 12 |

    Na lista oficial, os nomes completos são "Gerente Geral / Gerente Regional" e "CEO (Diretor Executivo)"; o seed usa a forma curta e o administrador pode renomear.
12. **Confirmar entrega (RF08 + RF09)** — só na etapa `premiacao`, jogador ativo da partida, inclusive eliminado (removido → 409 `Este jogador foi removido da partida.`). Já entregue → 409 `Este jogador já recebeu o brinde desta partida.`. Estoque 0 → 409 `O "<nome do brinde>" esgotou! Não há unidades na mesa.` (nada é gravado). Senão, na mesma transação: `UPDATE TB_BRINDE SET quantidade_estoque = quantidade_estoque - 1 WHERE id_brinde = ? AND quantidade_estoque > 0` + `INSERT TB_ENTREGA_BRINDE`, com `id_usuario` = quem confirmou. Quando **todos os jogadores ativos** (eliminados inclusive) tiverem entrega → status `Finalizada`, `finalizada_em = agora`.
13. **Admin — gerenciar peões/jogadores na partida** (casos de uso do administrador): mover peão para uma casa da rota do jogador, exceto o Chegou! (outra → 400 `A casa deve fazer parte da rota deste jogador e não pode ser o Chegou!.`), só em `Em Andamento`/`Pausada`, sem jogada pendente. O efeito da casa só acontece no dado, nunca ao mover **[FASE 2]**. Mover um eliminado o devolve ao jogo (`eliminado = 0`) como correção de toque errado, e ele joga na sua próxima vez **[FASE 2]**; isso vale enquanto a partida está em jogo: se o toque errado eliminou o último jogador, ela já está na Premiação e o mover responde 409. Remover jogador (`ativo = 0`; só em `Em Andamento`/`Pausada`, sem jogada pendente; não pode remover o último ativo, e eliminado conta como ativo; se era a vez dele, passa a vez). Removido não recebe brinde nem certificado, ao contrário do eliminado. Na `Premiação` e na `Finalizada` as duas ações respondem 409 com a mensagem da etapa (`A partida já foi encerrada: confirme a entrega dos brindes.` / `A partida já foi finalizada.`): a partida só é finalizada depois de premiar todos os jogadores ativos (RF08), e remover alguém na premiação não a finaliza.
14. **Tela desatualizada** — `POST .../dado` aceita `id_jogador` (o jogador da vez exibido na tela) e `POST .../sortear`, `.../pular` e `.../resposta` aceitam `id_jogada` (a jogada pendente exibida), todos opcionais. Se o campo vier e não bater com o estado atual → 409 `A partida mudou: recarregue a tela.` e nada é gravado; sem o campo, não há conferência.
15. **Certificado [FASE 2]** — só nas etapas `premiacao` e `finalizada` (antes → 409 `O certificado só é emitido depois do fim da partida.`), para jogador ativo da partida, inclusive eliminado (removido → 409 `Este jogador foi removido da partida.`). Traz o cargo do `brinde` do jogador e os pontos. O `email` só vai para o perfil Administrador (RNF04).

## 5. API

Todas exigem login (`exigeLogin`), exceto as marcadas **pública**; as marcadas **admin** usam `exigeAdmin`. Toda rota `/api` com método diferente de GET/HEAD passa antes pelo bloqueio de origem cruzada (§2). Já implementadas em `src/auth.js`: `POST /api/login {email, senha}` → `{usuario}` (400 `Informe e-mail e senha.` · 401 `E-mail ou senha inválidos.`); `POST /api/logout` → 204; `GET /api/me` → `{usuario:{id_usuario,nome,email,perfil,unidade}}`.

**Sessão (RNF04):** o login grava um token em `TB_SESSAO` e devolve o cookie `sid` (`HttpOnly; SameSite=Lax; Path=/; Max-Age` de 7 dias). A sessão vence também no servidor 7 dias depois de criada (uma única constante vale para o `Max-Age` e para a consulta da sessão); vencida, a API responde 401. Cada login apaga as sessões vencidas, mas não derruba as outras sessões da mesma conta (vários tablets podem usar a mesma conta de mediador). A senha é conferida com `crypto.scrypt` assíncrono (`confereSenha`, aguardada pelo login), sem travar as outras requisições.

### Escolas (RF02)
| Método e rota | Corpo | Resposta |
|---|---|---|
| `GET /api/escolas` | — | `[{id_escola, nome, cidade, total_jogadores}]` ordenado por nome |
| `POST /api/escolas` **admin** | `{nome, cidade}` | 201 `{id_escola, nome, cidade}` · 400 `Informe o nome da escola e a cidade.` · 409 `Já existe uma escola com esse nome.` |
| `PUT /api/escolas/:id` **admin** | `{nome, cidade}` | 200 escola · 400 · 404 · 409 |
| `DELETE /api/escolas/:id` **admin** | — | 204 · 404 · 409 `Não é possível excluir: há jogadores cadastrados nesta escola.` |

Nomes passam por `trim()`; comparação de duplicidade ignora maiúsculas/minúsculas.

### Jogadores (RF01)
| Método e rota | Corpo | Resposta |
|---|---|---|
| `GET /api/jogadores?q=` | — | `[{id_jogador, nome, apelido, id_escola, escola, criado_em, em_partida}]` (sem `email`: nenhuma tela usa o e-mail dos visitantes; mais recentes primeiro, máx. 300; `q` filtra nome/apelido/escola ignorando maiúsculas e acentos, ex.: `erica` acha "Érica"; `em_partida` = está em partida não finalizada) |
| `POST /api/jogadores` | `{nome, apelido?, email?, id_escola}` | 201 jogador (formato do GET + o `email` que acabou de ser digitado) · 400 `O nome completo é obrigatório.` / `Selecione a escola de origem.` / `E-mail inválido.` (se preenchido e fora do formato `x@y` — `/^[^\s@]+@[^\s@]+$/`, o "com o @" do RF01, a mesma regra do front — ou com mais de 254 caracteres) / `Escola não encontrada.` |

### Categorias, tabuleiro, perguntas (RF10)
| Método e rota | Corpo | Resposta |
|---|---|---|
| `GET /api/categorias` | — | `[{id_categoria, nome, cor, cor_hex, mecanica, total_perguntas}]` |
| `GET /api/tabuleiro` **pública** | — | `{imagem, largura:1078, altura:948, casa_chegada:65, casas:[{numero, tipo, cor, icone, id_categoria, categoria, cor_hex, x, y}], rotas:{esquerda:[0,1,…,65], centro:[0,101,…,65], direita:[0,201,…,65]}}` (`casa_chegada` substitui o `total_casas` da fase 1, porque o maior número de casa deixou de ser o Chegou!) |
| `GET /api/perguntas?categoria=&q=` **admin** | — | `[{id_pergunta, enunciado, resposta, id_categoria, categoria, cor_hex, mecanica, dificuldade, pontos, vezes_sorteada, alternativas:[{letra, texto, pontos}]}]` (`resposta` = explicação; `pontos` = o maior valor entre as alternativas; `q` busca no enunciado e na explicação ignorando maiúsculas e acentos) |
| `POST /api/perguntas` **admin** | `{enunciado, resposta, id_categoria, dificuldade?, alternativas:[4 textos], correta:"A"\|"B"\|"C"\|"D"}`; na Entrevista (`id_categoria` 5), `notas:[4 valores]` no lugar de `correta` | 201 pergunta · 400 `Preencha o enunciado, a explicação e a categoria.` / `Dificuldade inválida: use Fácil, Médio ou Difícil.` / `Preencha as quatro alternativas (A, B, C e D).` / `Indique a alternativa correta (A, B, C ou D).` / `Na Entrevista, cada alternativa vale 15, 10, 5 ou 0 pontos, com pelo menos uma acima de zero.` (`dificuldade` omitida = `Médio`; um campo `pontos` no corpo é ignorado: os pontos vêm da dificuldade ou das notas) |
| `PUT /api/perguntas/:id` **admin** | idem (`dificuldade` omitida fica como estava) | 200 · 400 · 404 · 409 `Esta pergunta está em jogo agora: salve depois que a jogada terminar.` (a letra que o jogador tocar não pode passar a valer para outro texto) |
| `DELETE /api/perguntas/:id` **admin** | — | 204 · 404 (histórico de jogadas mantém a jogada com `id_pergunta = NULL`; se a pergunta estava em jogo, a jogada volta para a etapa `sortear`) |

### Brindes / estoque (RF08, RF09)
| Método e rota | Corpo | Resposta |
|---|---|---|
| `GET /api/brindes` | — | `[{id_brinde, nome, cargo, pontos_minimos, quantidade_estoque, entregues}]` ordenado por pontos_minimos |
| `PUT /api/brindes/:id` **admin** | `{nome?, cargo?, pontos_minimos?, quantidade_estoque?}` (inteiros seguros ≥ 0, sem teto) | 200 brinde · 400 `Informe o nome do brinde e o cargo.` / `Os pontos mínimos e a quantidade em estoque devem ser números inteiros maiores ou iguais a zero.` · 404 `Brinde não encontrado.` · 409 `Já existe um brinde com esse nome.` / `Já existe um brinde com esses pontos mínimos.` (`pontos_minimos` enviados que outro brinde já usa) |

### Partidas (RF03–RF09, RNF06)
| Método e rota | Corpo | Resposta |
|---|---|---|
| `GET /api/partidas?status=Em Andamento,Pausada,Premiação` | — | `[{id_partida, status, codigo_online, iniciada_em, finalizada_em, mediador, jogadores:[{id_jogador, nome, peao, rota, casa_atual, pontuacao, eliminado}]}]` mais recentes primeiro (sem `status` = todas, máx. 100) |
| `POST /api/partidas` | `{jogadores:[{id_jogador, peao?, rota?}]}` | 201 **estado** · 400 `Selecione de 1 a 4 jogadores.` / `O mesmo jogador foi selecionado mais de uma vez.` / `Peão inválido: escolha verde, vermelho, azul ou amarelo.` / `Cada jogador deve ter um peão de cor diferente.` / `Rota inválida: escolha esquerda, centro ou direita.` / `Jogador não encontrado.` (id inválido ou inexistente) |
| `GET /api/partidas/:id` | — | **estado** · 404 |
| `GET /api/partidas/:id/certificados/:id_jogador` | — | `{id_jogador, nome, escola, cargo, pontuacao, unidade, encerrada_em, email?}` (`email` só para o administrador; `cargo` e `email` podem ser `null`) · 404 `Partida não encontrada.` / `Jogador não encontrado nesta partida.` · 409 (§4.15) |
| `GET /api/certificados` | — | `[{id_partida, id_jogador, nome, escola, cargo, pontuacao, encerrada_em}]` por nome: partidas terminadas, sem removidos e sem e-mail |
| `POST /api/partidas/:id/dado` | `{id_jogador?}` (o servidor sempre sorteia) | **estado** · 409 |
| `POST /api/partidas/:id/sortear` | `{id_jogada?}` | **estado** (com `jogada_pendente.pergunta`) · 409 (`sem_perguntas: true` quando esgotou) |
| `POST /api/partidas/:id/pular` | `{id_jogada?}` | **estado** · 409 |
| `POST /api/partidas/:id/resposta` | `{alternativa: "A"\|"B"\|"C"\|"D", id_jogada?}` | **estado** · 400 · 409 |
| `POST /api/partidas/:id/pausar` · `/retomar` · `/encerrar` | — | **estado** · 409 |
| `POST /api/partidas/:id/entregas` | `{id_jogador}` | **estado** · 404 · 409 |
| `PUT /api/partidas/:id/jogadores/:id_jogador/casa` **admin** | `{casa}` (da rota do jogador, exceto o Chegou!) | **estado** · 400 · 404 · 409 |
| `DELETE /api/partidas/:id/jogadores/:id_jogador` **admin** | — | **estado** · 404 · 409 (fora de `Em Andamento`/`Pausada`, com jogada pendente, jogador já removido ou último ativo — §4.13) |
| `GET /api/publico/partidas/:codigo` **pública** | — | **estado público** (abaixo) · 404 `Partida não encontrada.` |

`id_jogador` (dado) e `id_jogada` (sortear, pular, resposta) são opcionais: a tela manda o que está exibindo e, se a partida mudou, recebe 409 `A partida mudou: recarregue a tela.` (§4.14).

#### Objeto **estado** (resposta de todas as ações de partida)
```json
{
  "partida": { "id_partida": 1, "status": "Em Andamento", "codigo_online": "K7P2QX", "unidade": "SENAI Videira",
               "mediador": "Aprendiz Mediador", "iniciada_em": 1793000000, "encerrada_em": null, "finalizada_em": null,
               "pausada_em": null, "tempo_decorrido_s": 125, "vez": 0 },
  "etapa": "dado",
  "casa_chegada": 65,
  "jogadores": [
    { "id_jogador": 2, "nome": "Ana Souza", "apelido": "Aninha", "escola": "SENAI Videira", "ordem": 0, "peao": "verde",
      "rota": "esquerda", "casa_atual": 6, "pontuacao": 10, "ativo": true, "eliminado": false, "faltam": 59, "da_vez": true,
      "brinde": { "id_brinde": 1, "nome": "Chaveiro Jovem Aprendiz", "cargo": "Jovem Aprendiz", "quantidade_estoque": 42 },
      "entregue": false }
  ],
  "jogador_da_vez": { "id_jogador": 2, "nome": "Ana Souza", "apelido": "Aninha", "peao": "verde" },
  "jogada_pendente": null,
  "ultima_jogada": null
}
```
- `jogadores` em ordem de jogada (`ordem`), incluindo inativos (`ativo:false`) e eliminados (`eliminado:true`). `da_vez` só é `true` nas etapas `dado`/`sortear`/`responder`/`pausada`, e nunca para removido ou eliminado. `brinde`: antes da entrega, o da pontuação atual; depois, o que foi entregue; `null` se a pontuação não tem faixa (§4.11).
- `jogada_pendente` (quando etapa = `sortear`/`responder`, ou pausada com jogada pendente):
```json
{ "id_jogada": 10, "id_jogador": 2, "valor_dado": 2, "casa_inicial": 2, "casa_final": 4,
  "casa": { "numero": 4, "cor": "azul", "icone": "?", "acao": "pergunta", "sorteada": false },
  "categoria": { "id_categoria": 3, "nome": "Rotinas", "cor": "Azul", "cor_hex": "#1E88E5" },
  "pergunta": { "id_pergunta": 45, "enunciado": "...", "dificuldade": "Médio", "pontos": 10, "entrevista": false,
                "alternativas": [{ "letra": "A", "texto": "..." }, { "letra": "B", "texto": "..." },
                                 { "letra": "C", "texto": "..." }, { "letra": "D", "texto": "..." }] },
  "sem_perguntas": false }
```
  (`categoria` é `null` enquanto a casa sorteada ainda não sorteou; `pergunta` é `null` antes do sorteio; `casa.sorteada = true` na casa-surpresa; `pontos` = o maior valor entre as alternativas; `entrevista = true` nas perguntas de Entrevista.)
- `ultima_jogada`: a última jogada **concluída** da partida, no mesmo formato + `alternativa` (letra ou `null`), `acertou` (true/false/null), `pontos`, `nome` do jogador — usada para o feedback "Ana marcou B e fez +10 pontos!". Na casa amarela, na caveira e no Chegou!, `categoria`, `pergunta`, `alternativa` e `acertou` são `null` e `pontos` é 0. Com a jogada respondida, a `pergunta` traz também a correção:
```json
{ "id_pergunta": 45, "enunciado": "...", "dificuldade": "Médio", "pontos": 10, "entrevista": false, "resposta": "explicação",
  "alternativas": [{ "letra": "A", "texto": "...", "pontos": 0 }, { "letra": "B", "texto": "...", "pontos": 10 },
                   { "letra": "C", "texto": "...", "pontos": 0 }, { "letra": "D", "texto": "...", "pontos": 0 }] }
```
  Encerrada sem resposta (§4.9), a `pergunta` continua sem `resposta` e sem `alternativas[].pontos`.
- **Estado público** (`/api/publico/...`, sem login e com menores de idade): só o que o telão usa. O `nome` de `jogadores`, `jogador_da_vez` e `ultima_jogada` é o apelido ou, sem apelido, o primeiro nome; sem `escola`, `apelido` e `partida.mediador`, e sem os jogadores removidos (`ultima_jogada` de um removido vira `null`). A correção segue a mesma regra de todas as telas (§4.6), e o estado não traz `email` em nenhuma delas.

### Relatórios (admin) — "visualizar relatório e estatísticas", "relatórios de participação das escolas", Ranking, Relatorio_Categoria
`GET /api/relatorios` **admin** →
```json
{ "resumo": { "partidas": 0, "partidas_finalizadas": 0, "jogadores": 0, "escolas": 0, "perguntas": 0, "jogadas": 0, "acertos": 0, "erros": 0, "brindes_entregues": 0 },
  "por_escola":   [{ "id_escola": 1, "escola": "SENAI Videira", "cidade": "Videira", "jogadores": 0, "partidas": 0, "pontos": 0 }],
  "por_categoria":[{ "id_categoria": 1, "categoria": "Ética", "cor_hex": "#E53935", "perguntas": 25, "respondidas": 0, "acertos": 0, "erros": 0, "percentual_acerto": 0 }],
  "por_jogador_categoria": [{ "id_jogador": 1, "nome": "...", "apelido": "...", "id_categoria": 1, "categoria": "Ética", "cor_hex": "#E53935", "respondidas": 0, "acertos": 0, "erros": 0, "percentual_acerto": 0 }],
  "ranking":      [{ "id_jogador": 1, "nome": "...", "apelido": "...", "escola": "...", "pontos": 0, "partidas": 0, "melhor_cargo": "Jovem Aprendiz" }],
  "brindes":      [{ "id_brinde": 1, "nome": "...", "cargo": "...", "pontos_minimos": 0, "quantidade_estoque": 38, "entregues": 0 }],
  "partidas":     [{ "id_partida": 1, "status": "...", "codigo_online": "...", "iniciada_em": 0, "finalizada_em": null, "mediador": "...", "jogadores": "Ana, Beto", "vencedor": "Ana" }] }
```
`por_jogador_categoria` = o Relatorio_Categoria do DER, que pertence a um jogador: desempenho de cada jogador em cada categoria, com `percentual_acerto` de 0 a 100, como em `por_categoria`; na Entrevista, `acertos` conta as respostas com pontos acima de 0; `resumo.jogadas` conta todas as jogadas, inclusive as sem pergunta; `ranking` = top 20 por pontos somados, e `melhor_cargo` = o cargo da melhor pontuação do jogador em uma partida; `partidas` = 50 mais recentes; `vencedor` = maior pontuação (desempate: menor `faltam`).

## 6. Páginas

| Rota | Arquivo | Acesso | Conteúdo |
|---|---|---|---|
| `/login` | login.html | pública | Feito. Depois do login, vai para `?volta=` só se ele casar com `/^\/(?![\/\\])[^\s\\]*$/` (caminho deste site: começa com uma barra, não com `//` nem `/\`, sem barra invertida, espaço, tab ou quebra de linha); senão, para `/recepcao`. |
| `/recepcao` | recepcao.html + pages/recepcao.js | login | **RF01**: Nome Completo* , Apelido, E-mail, Escola de Origem* (`<select>` — não pode digitar). Validação no front (mesmas regras/mensagens da API). Salvar → toast de sucesso e limpa o formulário (foco volta no nome). Abaixo: lista dos jogadores cadastrados (busca), com escola e data. |
| `/nova-partida` | nova-partida.html + pages/nova-partida.js | login | **RF03**: busca de jogadores cadastrados; adicionar até 4 (bloquear repetição); para cada um escolher o peão (4 cores, imagens SVG `peaoSVG`) e a rota (**Esquerda**, já marcada, **Centro** ou **Direita**), botão grande **Iniciar** (habilitado com 1–4) → `POST /api/partidas` → vai para `/partida/:id`. Aviso se o jogador já está em partida não finalizada (`em_partida`). |
| `/partidas` | partidas.html + pages/partidas.js | login | **RNF06** "Partida em Andamento": lista de partidas `Em Andamento/Pausada/Premiação` com jogadores (eliminado com a marca "☠ fora do jogo") e botão **Retomar** → `/partida/:id`. |
| `/partida/:id` | partida.html + pages/partida.js (+ css/partida.css) | login | Tela principal do jogo (ver abaixo). |
| `/partida/:id/certificado/:id_jogador` | certificado.html + pages/certificado.js (+ css/certificado.css) | login | Certificado virtual (ver abaixo). |
| `/certificados` | certificados.html + pages/certificados.js | login | Etapa 3: todos os certificados que podem ser emitidos, com busca por nome ou escola e filtro por cargo; cada linha abre o certificado do jogador. |
| `/estoque` | estoque.html + pages/estoque.js | login | **RF09** "Estoque de Brindes": um cartão por brinde (imagem do chaveiro, nome, cargo, faixa de pontos, quantidade grande, entregues), alerta vermelho **ESGOTADO** quando 0. Somente leitura; admin vê link para `/admin/brindes`. Atualiza a cada 10 s. |
| `/admin/perguntas` | admin-perguntas.html + pages/admin-perguntas.js | admin | **RF10**: formulário Enunciado* (textarea), Categoria* (dropdown com os 5 temas), Dificuldade (informa quanto vale cada uma; oculta na Entrevista), Alternativas* (quatro textos, de A a D, com a marca da correta; na Entrevista, com a nota de cada uma), Explicação da resposta* (textarea), sem campo de pontos; botões **Salvar (Novo)**, **Editar** (salva alterações da selecionada), **Excluir** (com confirmação) e **Limpar**. Lista filtrável por categoria e busca (enunciado, alternativas e explicação), mostrando contagem por categoria. |
| `/admin/escolas` | admin-escolas.html + pages/admin-escolas.js | admin | **RF02**: Nome da Escola*, Cidade*; lista com editar/excluir. |
| `/admin/brindes` | admin-brindes.html + pages/admin-brindes.js | admin | "Gerencia estoque de brindes": editar nome, cargo, pontos mínimos e quantidade (entrada/ajuste, com atalhos +10 e +50). Cada cartão mostra a faixa de pontos; há aviso se nenhum brinde começa em 0 pontos. |
| `/admin/relatorios` | admin-relatorios.html + pages/admin-relatorios.js | admin | Cartões de resumo + tabelas: participação por escola, desempenho por categoria (barra de % de acerto), desempenho por jogador e categoria, ranking (com melhor cargo), brindes (com cargo), partidas. |
| `/acompanhar` e `/acompanhar/:codigo` | acompanhar.html + pages/acompanhar.js | pública | Telão/DataShow e "consulta pontuação" pelo código da sessão: campo para digitar o código; com código, mostra tabuleiro grande, placar (cargo, "☠ fora do jogo" e "entregue ✓"), jogador da vez, enunciado e alternativas da pergunta atual (sem correção) com a cor da categoria; depois da resposta, o resultado com a correção e a explicação; atualiza a cada 2 s via `GET /api/publico/partidas/:codigo`. |

### Tela da partida (`/partida/:id`) — RF04, RF05, RF06, RF07, RF08, RF09, RNF01–RNF03, RNF06
- Carrega `GET /api/tabuleiro` + `GET /api/partidas/:id` e renderiza **sempre a partir do estado** (recarregar a página retoma exatamente na etapa e na vez certas — RNF06).
- Layout: tela larga = tabuleiro à esquerda (≈ 60%) e painel à direita; tela estreita (≤ 768px) ou tablet em pé (retrato até 1024 px) = empilhado (RNF01).
- Cabeçalho da partida: código da sessão + link "Abrir telão" (`/acompanhar/<codigo>`, nova aba), cronômetro (`tempo_decorrido_s`, atualizado localmente a cada segundo; parado se pausada), botões **Pausar/Retomar** e **Encerrar partida** (confirmação).
- Placar: jogadores em ordem com peão, nome (apelido), casa atual e rota, pontos, cargo atual; destaque para o da vez; removido e eliminado ("☠ fora do jogo") ficam marcados, e o peão do eliminado fica cinza no tabuleiro.
- Etapa `dado`: **"Vez de: NOME"** em destaque (RF04 controle de turno) + botão grande **Girar o dado**: gira por 0,8 s com números ao acaso, só como efeito, e o resultado é o que o servidor sorteou. Feedback da `ultima_jogada` (`resultadoJogada()`, igual no telão): "Ana marcou B e fez +10 pontos!" / "Beto marcou A e não pontuou." com a resposta certa e a explicação / "Casa amarela: sem pergunta, passa a vez." / "Casa da Morte: fora do jogo."
- Etapa `sortear`: mostra "NOME tirou 4: casa 2 → casa 6", cor/ícone da casa e categoria (ou "Casa surpresa: categoria será sorteada"), destaque da casa no tabuleiro; botão grande **Sortear Pergunta** (RNF03). Se `sem_perguntas`, aviso + botão **Passar a vez** (`/pular`).
- Etapa `responder`: sobreposição de tela cheia com **fundo da cor da categoria** (RF05), nome da categoria, jogador da vez, casa e quanto vale ("Fácil · vale 5 pontos"; na Entrevista, "vale até 15 pontos"), botão **Pausar**, enunciado com a **maior fonte da tela** (RNF02) e as quatro alternativas em botões (`.btn.botao-resposta.alternativa`, RF07/RNF02). **Sem gabarito e sem correção na tela** **[FASE 2]**: a resposta certa e a explicação só aparecem depois de responder, no feedback. O texto deve ter bom contraste sobre a cor (amarelo usa texto escuro).
- Etapa `pausada`: aviso grande "Partida pausada" + botão Retomar; dados desabilitados. Com jogada pendente, mostra o movimento no lugar dos dados, e a pergunta aberta fica oculta até retomar.
- Etapa `premiacao` (**RF08**): um cartão por jogador ativo, inclusive eliminado (selo "☠ Saiu na Casa da Morte"): nome, **pontos**, casa final, **cargo alcançado** em destaque, **brinde** (imagem `/img/chaveiro-centro.png` + o nome vindo da API, `brinde.nome`), estoque restante, botão **Confirmar Entrega** e link **Certificado**; se estoque = 0, alerta **ESGOTADO** e botão desabilitado (RF09); após confirmar, "Entregue ✓". O aviso do topo diz o motivo do fim: alguém chegou, todos caíram na Casa da Morte ou a partida foi encerrada. Enquanto a etapa for `premiacao`, a tela recarrega o estado a cada 5 s (percebe a reposição do estoque) e para ao sair dela.
- Etapa `finalizada`: resumo final (ranking da partida, com cargo, pontos e link **Certificado**; desempate por `faltam`) + botão **Nova Partida**.
- Admin (somente perfil Administrador): painel recolhível "Gerenciar partida" com mover peão (casa da rota do jogador) e remover jogador, só entre jogadas; mover quem está fora do jogo o devolve à partida; oculto nas etapas `premiacao` e `finalizada` (§4.13).
- Chamadas de ação desabilitam os botões enquanto aguardam (evita clique duplo). O dado envia o `id_jogador` da vez exibido e sortear/pular/resposta enviam o `id_jogada` da jogada pendente exibida (§4.14); ao receber 409, a tela recarrega o estado.

### Certificado virtual (`/partida/:id/certificado/:id_jogador`) — [FASE 2]
- Aberto em nova aba pelo link **Certificado** das etapas `premiacao` e `finalizada`. Antes do fim da partida ou para jogador removido, mostra a mensagem do 409 (§4.15).
- Traz as logos, "Certificado de Participação", nome, escola, cargo alcançado, pontos, unidade, data do fim da partida e o docente responsável.
- Botão **Imprimir ou salvar em PDF** (impressão do navegador): página A4 deitada, sem o topo e sem os botões. O título da página, `Certificado - Nome - Cargo`, é o nome de arquivo que o navegador sugere.
- O e-mail só aparece para o administrador, no link `mailto:` "Enviar para ..." (com assunto, sem anexo). Salvar na pasta compartilhada e enviar continua manual.
- A logo oficial do SENAI deve ser colocada em `public/img/logo-senai.png`; sem o arquivo, sai o texto "SENAI".

## 7. Testes

`npm test` roda `node --test test/*.test.js`. `test/api.test.js` sobe o app com `DB_PATH=:memory:` e cobre o fluxo completo: login, RNF04 (mediador recebe 403 em `/api/perguntas` e em `/admin/perguntas`), RF01/RF02 validações, RF03 limites e rota de cada jogador, RF04 limites do dado, RF05/RF06 (nenhuma pergunta repetida em uma partida), RF07 correção pela alternativa e troca de vez, chegada → premiação, RF08 duplicidade, RF09 decremento e estoque zero, finalização.

Regras da fase 2 cobertas: dado sempre sorteado pelo servidor, com número enviado pela tela ignorado (os testes fixam o resultado por `sorteio.dado`, de `src/jogo.js`); casa amarela sem pergunta (com e sem seta); Entrevista (casa com maleta, nota por alternativa, fora das casas-surpresa); Casa da Morte (elimina sem pergunta, a vez pula o eliminado, mover o devolve ao jogo, todos eliminados → premiação, preta sem caveira não elimina, eliminado recebe e removido não); rotas (sequências, junções nas casas 23 e 31, mover só dentro da rota, `faltam` e desempate); as 8 faixas de cargo nos seus limites, com 500 pontos continuando CEO; sigilo da correção (encerrada sem resposta não revela, respondida revela também no telão, editar pergunta em jogo → 409); certificado (só depois do fim, e-mail só para o administrador, página exige login); recusa do banco da fase 1; banco inicial (quantidade por categoria, alternativas completas, notas da Entrevista, letras equilibradas).

## 8. Riscos medidos e limites da fase 2

Simulação de 200 mil partidas com as regras finais, com um jogador percorrendo a rota até o Chegou! ou a eliminação. Com 2 a 4 jogadores a partida acaba quando o primeiro chega, então a pontuação real tende a ser menor.

- **Eliminações:** cerca de 49% dos jogadores caem numa caveira em Esquerda e Direita, e 29% no Centro.
- **Rota mais vantajosa:** o Centro, com chegada em 71% contra cerca de 51% das outras.
- **Pontuação média:** quem acerta tudo faz cerca de 50 pontos (Esquerda 51, Centro 63, Direita 49). Quem acerta 60% faz cerca de 31 pontos (Esquerda 31, Centro 38, Direita 30).
- **Faixas de cargo:** a tabela original do usuário ia até 180 pontos e, com a casa amarela sem pergunta, CEO ficava inalcançável (0,0% mesmo entre quem acerta tudo). A pedido dele, as faixas foram baixadas para CEO em 80. Em partidas de 4 jogadores, chegam a CEO cerca de 2% de quem acerta 60%, 7% de quem acerta 80% e 17% de quem acerta tudo. As faixas são editáveis em Painel Admin → Brindes.
- **Estoque:** o estoque inicial segue a procura simulada de quem acerta 70%, mas a procura real muda com o desempenho dos jogadores. Com estoque zero a entrega fica bloqueada, e a partida não finaliza até a reposição em Painel Admin → Brindes (§4.12).
- **Casa vermelha "-" (116, rota Centro):** funciona como vermelha comum, porque nenhuma regra de perda de pontos foi definida.

Fora do sistema:

- **Etapa 2 (contagem, etiquetas, armazenamento, quem libera os itens):** tarefa física e organizacional. O sistema já tem estoque por cargo, entrada pelo administrador e registro de quem confirmou cada entrega (`TB_ENTREGA_BRINDE.id_usuario`, que nenhuma tela mostra hoje); um brinde pode ser renomeado.
- **Envio do certificado:** salvar na pasta compartilhada e enviar continua manual (§6).
