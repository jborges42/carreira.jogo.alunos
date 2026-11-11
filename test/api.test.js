// Testes de ponta a ponta da API (docs/ESPECIFICACAO-TECNICA.md §7).
// Banco em memória; o teste cadastra as próprias perguntas, então funciona com ou sem data/perguntas.json.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs, { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

process.env.DB_PATH = ':memory:';
process.env.SENHA_ADMIN = 'admin123';
process.env.SENHA_MEDIADOR = 'mediador123';
// O handler de erro do server.js loga todo erro; aqui só aparecem os inesperados (500).
const logErro = console.error;
console.error = (e, ...resto) => { if (!(e?.status < 500)) logErro(e, ...resto); };

const { app } = await import('../src/server.js');
const { ACESSO_NEGADO } = await import('../src/auth.js');
const { db } = await import('../src/db.js'); // o mesmo banco em memória do servidor (conferências de schema e sessão)
const { sorteio } = await import('../src/jogo.js'); // o mesmo módulo do servidor: os testes fixam o resultado do dado

const servidor = app.listen(0, '127.0.0.1');
await new Promise((pronto) => servidor.once('listening', pronto));
after(() => servidor.close());
const BASE = `http://127.0.0.1:${servidor.address().port}`;

async function chamar(sid, metodo, url, corpo, cabecalhos = {}) {
  const r = await fetch(BASE + url, {
    method: metodo,
    redirect: 'manual',
    headers: { ...(sid && { cookie: `sid=${sid}` }), ...(corpo !== undefined && { 'content-type': 'application/json' }), ...cabecalhos },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const json = (r.headers.get('content-type') || '').includes('json');
  return { status: r.status, corpo: json ? await r.json() : await r.text(), cookie: r.headers.get('set-cookie') };
}
const ok = (r, status = 200) => (assert.equal(r.status, status, JSON.stringify(r.corpo)), r.corpo);
function falha(r, status, mensagem) {
  assert.equal(r.status, status, JSON.stringify(r.corpo));
  if (mensagem) assert.equal(r.corpo.erro, mensagem);
}
async function entrar(email, senha) {
  const r = await chamar(null, 'POST', '/api/login', { email, senha });
  ok(r);
  return r.cookie.match(/sid=([^;]+)/)[1];
}
const admin = await entrar('professor@senai.com.br', 'admin123');
const med = await entrar('mediador@senai.com.br', 'mediador123');
const A = (...a) => chamar(admin, ...a);
const M = (...a) => chamar(med, ...a);
const anonimo = (...a) => chamar(null, ...a);
// O dado é sorteado no servidor: aqui, fixa o número da jogada para os testes não dependerem da sorte.
async function dado(url, valor, corpo = {}) {
  const real = sorteio.dado;
  sorteio.dado = () => valor;
  try {
    return await M('POST', `${url}/dado`, corpo);
  } finally {
    sorteio.dado = real;
  }
}

let escola, ana, beto, caio, duda, eva, fabio, p1;

// Quatro alternativas válidas para cadastrar perguntas nos testes
const ALTERNATIVAS = ['Primeira', 'Segunda opção', 'Terceira opção', 'Quarta opção dada'];
const nova = (extra) => ({ enunciado: 'Teste?', resposta: 'Porque sim.', id_categoria: 1, alternativas: ALTERNATIVAS, correta: 'B', ...extra });
// O estado das telas não entrega a correção antes da resposta: os testes a consultam direto no banco.
const letraCerta = (idPergunta) => db.prepare('SELECT letra FROM TB_ALTERNATIVA WHERE id_pergunta = ? ORDER BY pontos DESC LIMIT 1').get(idPergunta).letra;
const letraErrada = (idPergunta) => db.prepare('SELECT letra FROM TB_ALTERNATIVA WHERE id_pergunta = ? AND pontos = 0 LIMIT 1').get(idPergunta).letra;
// Partida de teste + atalho que põe o peão na casa e joga o dado
async function partida(jogadores) {
  const e = ok(await M('POST', '/api/partidas', { jogadores }), 201);
  const url = `/api/partidas/${e.partida.id_partida}`;
  const vaiPara = async (idJogador, casa, valor) => {
    ok(await A('PUT', `${url}/jogadores/${idJogador}/casa`, { casa }));
    return ok(await dado(url, valor));
  };
  return { url, e, vaiPara };
}

test('RNF04: login, rotas públicas e mediador bloqueado nas rotas admin', async () => {
  falha(await anonimo('POST', '/api/login', { email: 'professor@senai.com.br', senha: 'errada' }), 401);
  falha(await anonimo('GET', '/api/escolas'), 401);
  const tab = ok(await anonimo('GET', '/api/tabuleiro'));
  assert.deepEqual([tab.casa_chegada, tab.casas.length, tab.casas[4].categoria], [65, 121, 'Rotinas']);
  const rotasAdmin = [['GET', '/api/perguntas'], ['POST', '/api/perguntas'], ['POST', '/api/escolas'], ['PUT', '/api/escolas/1'],
    ['DELETE', '/api/escolas/1'], ['PUT', '/api/brindes/1'], ['GET', '/api/relatorios'],
    ['PUT', '/api/partidas/1/jogadores/1/casa'], ['DELETE', '/api/partidas/1/jogadores/1']];
  for (const [metodo, url] of rotasAdmin) falha(await M(metodo, url), 403, ACESSO_NEGADO);
  assert.equal((await M('GET', '/admin/perguntas')).status, 403); // bloqueio de link (página)
  ok(await A('GET', '/api/perguntas'));
  assert.equal(ok(await M('GET', '/api/me')).usuario.perfil, 'Mediador');
});

test('RF02: escolas — obrigatórios, sem repetição, editar e excluir', async () => {
  falha(await A('POST', '/api/escolas', { nome: '  ', cidade: 'Videira' }), 400, 'Informe o nome da escola e a cidade.');
  const e = ok(await A('POST', '/api/escolas', { nome: '  Escola Básica São João ', cidade: ' Caçador ' }), 201);
  assert.deepEqual(e, { id_escola: e.id_escola, nome: 'Escola Básica São João', cidade: 'Caçador' });
  escola = e.id_escola;
  falha(await A('POST', '/api/escolas', { nome: 'ESCOLA BÁSICA SÃO JOÃO', cidade: 'X' }), 409, 'Já existe uma escola com esse nome.');
  falha(await A('PUT', `/api/escolas/${escola}`, { nome: 'senai videira', cidade: 'X' }), 409, 'Já existe uma escola com esse nome.');
  assert.equal(ok(await A('PUT', `/api/escolas/${escola}`, { nome: 'Escola Básica São João', cidade: 'Videira' })).cidade, 'Videira');
  falha(await A('PUT', '/api/escolas/9999', { nome: 'A', cidade: 'B' }), 404);
  const temp = ok(await A('POST', '/api/escolas', { nome: 'Escola Temporária', cidade: 'Videira' }), 201);
  ok(await A('DELETE', `/api/escolas/${temp.id_escola}`), 204);
  falha(await A('DELETE', `/api/escolas/${temp.id_escola}`), 404);
  const lista = ok(await M('GET', '/api/escolas'));
  assert.deepEqual(lista.map((x) => [x.nome, x.total_jogadores]), [['Escola Básica São João', 0], ['SENAI Videira', 0]]);
});

test('RF01: cadastro de jogadores com validações', async () => {
  const novo = (corpo) => M('POST', '/api/jogadores', corpo);
  falha(await novo({ nome: '   ', id_escola: escola }), 400, 'O nome completo é obrigatório.');
  falha(await novo({ nome: 'Ana Souza', id_escola: '' }), 400, 'Selecione a escola de origem.');
  falha(await novo({ nome: 'Ana Souza', id_escola: escola, email: 'ana.escola.com' }), 400, 'E-mail inválido.');
  falha(await novo({ nome: 'Ana Souza', id_escola: 9999 }), 400, 'Escola não encontrada.');
  const a = ok(await novo({ nome: ' Ana Souza ', apelido: ' Aninha ', email: ' ana@escola.com ', id_escola: escola }), 201);
  assert.deepEqual([a.nome, a.apelido, a.email, a.escola, a.em_partida], ['Ana Souza', 'Aninha', 'ana@escola.com', 'Escola Básica São João', false]);
  ana = a.id_jogador;
  const cria = async (nome) => ok(await novo({ nome, email: '', id_escola: String(escola) }), 201);
  const b = await cria('Beto Lima');
  assert.deepEqual([b.apelido, b.email], [null, null]);
  beto = b.id_jogador;
  caio = (await cria('Caio Prado')).id_jogador;
  duda = (await cria('Duda Reis')).id_jogador;
  eva = (await cria('Eva Martins')).id_jogador;
  fabio = (await cria('Fábio Nunes')).id_jogador;
  assert.deepEqual(ok(await M('GET', '/api/jogadores?q=aninha')).map((j) => j.id_jogador), [ana]);
  assert.equal(ok(await M('GET', '/api/jogadores')).at(0).id_jogador, fabio); // mais recentes primeiro
  assert.equal(ok(await M('GET', `/api/jogadores?q=${encodeURIComponent('São João')}`)).length, 6); // busca pela escola
  // A27: a busca ignora acentos e maiúsculas também em letras acentuadas
  assert.deepEqual(ok(await M('GET', '/api/jogadores?q=fabio')).map((j) => j.id_jogador), [fabio]);
  assert.equal(ok(await M('GET', `/api/jogadores?q=${encodeURIComponent('BÁSICA SAO')}`)).length, 6);
  // A44: a listagem não entrega o e-mail dos visitantes
  assert.ok(ok(await M('GET', '/api/jogadores')).every((j) => !('email' in j)));
  falha(await A('DELETE', `/api/escolas/${escola}`), 409, 'Não é possível excluir: há jogadores cadastrados nesta escola.');

  // A2: formato x@y (RF01 "com o @", igual ao front); A41: até 254 caracteres, conferidos antes da regex (sem ReDoS)
  falha(await novo({ nome: 'Zé Teste', id_escola: 1, email: `${'a'.repeat(250)}@b.com` }), 400, 'E-mail inválido.');
  const inicio = performance.now();
  falha(await novo({ nome: 'Zé Teste', id_escola: 1, email: `a@${'.'.repeat(50000)}@` }), 400, 'E-mail inválido.');
  assert.ok(performance.now() - inicio < 1000, 'a validação do e-mail não pode travar o servidor');
  assert.equal(ok(await novo({ nome: 'Zé Teste', email: 'ze@escola', id_escola: 1 }), 201).email, 'ze@escola');
});

test('RF10: perguntas (admin) — inserir, editar, excluir e filtrar', async () => {
  falha(await A('POST', '/api/perguntas', nova({ resposta: ' ' })), 400, 'Preencha o enunciado, a explicação e a categoria.');
  falha(await A('POST', '/api/perguntas', nova({ id_categoria: 9 })), 400, 'Preencha o enunciado, a explicação e a categoria.');
  for (const alternativas of [undefined, 'A', ALTERNATIVAS.slice(0, 3), [...ALTERNATIVAS, 'Quinta'], ['a', 'b', ' ', 'd']]) {
    falha(await A('POST', '/api/perguntas', nova({ alternativas })), 400, 'Preencha as quatro alternativas (A, B, C e D).');
  }
  for (const correta of [undefined, 'E', 'a', 1]) {
    falha(await A('POST', '/api/perguntas', nova({ correta })), 400, 'Indique a alternativa correta (A, B, C ou D).');
  }
  const antes = ok(await M('GET', '/api/categorias'));
  assert.equal(antes.length, 5);
  for (const id_categoria of [1, 2, 3, 4]) for (const n of [1, 2]) {
    ok(await A('POST', '/api/perguntas', nova({ enunciado: `Teste ${n} da categoria ${id_categoria}?`, id_categoria })), 201);
  }
  ok(await M('GET', '/api/categorias')).forEach((c, i) => assert.equal(c.total_perguntas, antes[i].total_perguntas + (c.mecanica === 'Múltipla escolha' ? 2 : 0)));
  // Dificuldade define os pontos: Fácil 5, Médio 10, Difícil 15, e o valor enviado em "pontos" é ignorado
  for (const [dificuldade, valor] of [['Fácil', 5], ['Médio', 10], ['Difícil', 15]]) {
    const q = ok(await A('POST', '/api/perguntas', nova({ enunciado: `Vale ${valor}?`, dificuldade, pontos: 999 })), 201);
    assert.deepEqual(q.alternativas.map((a) => a.pontos), [0, valor, 0, 0]);
    assert.equal(q.pontos, valor);
    ok(await A('DELETE', `/api/perguntas/${q.id_pergunta}`), 204);
  }
  const p = ok(await A('POST', '/api/perguntas', nova({ enunciado: 'Zxq: o que é a CLT?', resposta: 'Consolidação das Leis do Trabalho', id_categoria: 3, dificuldade: 'Fácil', correta: 'C' })), 201);
  assert.deepEqual([p.categoria, p.dificuldade, p.pontos, p.vezes_sorteada, p.alternativas.map((a) => a.letra)], ['Rotinas', 'Fácil', 5, 0, ['A', 'B', 'C', 'D']]);
  // A27: "é" gravado é achado digitando "E" (sem acento e em maiúscula)
  assert.deepEqual(ok(await A('GET', `/api/perguntas?q=${encodeURIComponent('ZXQ: O QUE E A CLT')}`)).map((x) => x.id_pergunta), [p.id_pergunta]);
  const e = ok(await A('PUT', `/api/perguntas/${p.id_pergunta}`, nova({ enunciado: 'Zxq: o que significa a sigla CLT?', resposta: p.resposta, id_categoria: 3, correta: 'D' })));
  assert.deepEqual([e.enunciado, e.dificuldade, e.pontos, letraCerta(p.id_pergunta)], ['Zxq: o que significa a sigla CLT?', 'Fácil', 5, 'D']); // dificuldade omitida fica como estava
  falha(await A('PUT', '/api/perguntas/99999', nova()), 404);
  const tmp = ok(await A('POST', '/api/perguntas', nova({ enunciado: 'Temporária?' })), 201);
  ok(await A('DELETE', `/api/perguntas/${tmp.id_pergunta}`), 204);
  falha(await A('DELETE', `/api/perguntas/${tmp.id_pergunta}`), 404);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM TB_ALTERNATIVA WHERE id_pergunta = ?').get(tmp.id_pergunta).n, 0); // saem junto com a pergunta

  // Entrevista: uma nota por alternativa (15, 10, 5 ou 0), com pelo menos uma acima de zero
  const NOTAS = 'Na Entrevista, cada alternativa vale 15, 10, 5 ou 0 pontos, com pelo menos uma acima de zero.';
  for (const notas of [undefined, [15, 10, 5], [15, 10, 5, 7], [0, 0, 0, 0], ['a', 0, 0, 15]]) {
    falha(await A('POST', '/api/perguntas', nova({ id_categoria: 5, correta: undefined, notas })), 400, NOTAS);
  }
  const ent = ok(await A('POST', '/api/perguntas', nova({ enunciado: 'Zxq entrevista?', id_categoria: 5, correta: undefined, notas: [10, 0, 15, 5] })), 201);
  assert.deepEqual([ent.mecanica, ent.pontos, ent.alternativas.map((a) => a.pontos)], ['Nota por alternativa', 15, [10, 0, 15, 5]]);
  ok(await A('DELETE', `/api/perguntas/${ent.id_pergunta}`), 204);
  assert.ok(ok(await A('GET', '/api/perguntas?categoria=3')).every((x) => x.id_categoria === 3));
  assert.deepEqual(ok(await A('GET', '/api/perguntas?q=zxq')).map((x) => x.id_pergunta), [p.id_pergunta]);
});

test('RF03: nova partida com 1 a 4 jogadores, peões distintos e rota de cada um', async () => {
  const nova = (jogadores) => M('POST', '/api/partidas', { jogadores });
  falha(await nova([]), 400, 'Selecione de 1 a 4 jogadores.');
  for (const rota of ['cima', 1, ['esquerda'], 'constructor']) {
    falha(await nova([{ id_jogador: ana, rota }]), 400, 'Rota inválida: escolha esquerda, centro ou direita.');
  }
  falha(await M('POST', '/api/partidas', {}), 400, 'Selecione de 1 a 4 jogadores.');
  falha(await nova([ana, beto, caio, duda, eva].map((id_jogador) => ({ id_jogador }))), 400, 'Selecione de 1 a 4 jogadores.');
  falha(await nova([{ id_jogador: ana }, { id_jogador: ana }]), 400, 'O mesmo jogador foi selecionado mais de uma vez.');
  falha(await nova([{ id_jogador: ana, peao: 'azul' }, { id_jogador: beto, peao: 'azul' }]), 400, 'Cada jogador deve ter um peão de cor diferente.');
  falha(await nova([{ id_jogador: 99999 }]), 400, 'Jogador não encontrado.');
  // A29: ids inválidos não são "o mesmo jogador" (NaN = NaN no Set)
  falha(await nova([{}, {}]), 400, 'Jogador não encontrado.');
  falha(await nova([{ id_jogador: 'abc' }, { id_jogador: 'xyz' }]), 400, 'Jogador não encontrado.');

  const quatro = ok(await nova([caio, duda, eva, fabio].map((id_jogador) => ({ id_jogador }))), 201);
  assert.deepEqual(quatro.jogadores.map((j) => j.peao), ['verde', 'vermelho', 'azul', 'amarelo']);

  const e = ok(await nova([{ id_jogador: ana }, { id_jogador: beto, peao: 'verde' }]), 201);
  p1 = e.partida.id_partida;
  assert.match(e.partida.codigo_online, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
  assert.deepEqual([e.partida.status, e.partida.mediador, e.partida.unidade, e.partida.vez, e.etapa, e.casa_chegada],
    ['Em Andamento', 'Aprendiz Mediador', 'SENAI Videira', 0, 'dado', 65]);
  assert.ok(e.partida.tempo_decorrido_s >= 0);
  assert.deepEqual(e.jogadores.map((j) => [j.id_jogador, j.ordem, j.peao, j.rota, j.casa_atual, j.pontuacao, j.ativo, j.eliminado, j.da_vez, j.entregue]),
    [[ana, 0, 'vermelho', 'esquerda', 0, 0, true, false, true, false], [beto, 1, 'verde', 'esquerda', 0, 0, true, false, false, false]]);
  assert.deepEqual([e.jogador_da_vez.id_jogador, e.jogadores[0].brinde.cargo, e.jogada_pendente, e.ultima_jogada], [ana, 'Jovem Aprendiz', null, null]);
  assert.equal(ok(await M('GET', '/api/jogadores?q=Aninha'))[0].em_partida, true);
});

test('RF04: o peão anda com o dado sorteado', async () => {
  const url = `/api/partidas/${p1}`;
  falha(await M('POST', `${url}/sortear`), 409);
  const e = ok(await dado(url, 4)); // casa 4 = azul (Rotinas)
  assert.equal(e.etapa, 'sortear');
  assert.equal(e.jogadores[0].casa_atual, 4);
  const j = e.jogada_pendente;
  assert.deepEqual([j.id_jogador, j.valor_dado, j.casa_inicial, j.casa_final, j.casa.cor, j.casa.acao, j.casa.sorteada, j.categoria.nome, j.pergunta, j.sem_perguntas],
    [ana, 4, 0, 4, 'azul', 'pergunta', false, 'Rotinas', null, false]);
  falha(await dado(url, 2), 409);
  falha(await M('POST', `${url}/resposta`, { acertou: true }), 409);
  falha(await M('POST', `${url}/pular`), 409); // ainda há perguntas inéditas
});

test('RF05/RF07 + RNF06: sorteio, retomada após recarregar e resposta com troca de vez', async () => {
  const url = `/api/partidas/${p1}`;
  const s = ok(await M('POST', `${url}/sortear`));
  const perg = s.jogada_pendente.pergunta;
  assert.equal(s.etapa, 'responder');
  assert.ok(perg.enunciado);
  // Antes de responder, a tela do mediador também não recebe a correção
  assert.deepEqual(Object.keys(perg.alternativas[0]), ['letra', 'texto']);
  assert.deepEqual(perg.alternativas.map((a) => a.letra), ['A', 'B', 'C', 'D']);
  assert.equal('resposta' in perg, false);
  assert.ok(ok(await A('GET', '/api/perguntas?categoria=3')).some((p) => p.id_pergunta === perg.id_pergunta)); // categoria da casa
  // RNF06: "F5" no meio da jogada volta na mesma etapa e com a mesma pergunta
  const r = ok(await M('GET', url));
  assert.deepEqual([r.etapa, r.jogada_pendente.pergunta.id_pergunta, r.jogador_da_vez.id_jogador], ['responder', perg.id_pergunta, ana]);
  falha(await M('POST', `${url}/sortear`), 409);
  for (const alternativa of [undefined, 'E', 'a', true, ['A']]) {
    falha(await M('POST', `${url}/resposta`, { alternativa }), 400, 'Escolha uma das alternativas: A, B, C ou D.');
  }
  const certa = letraCerta(perg.id_pergunta);
  const c = ok(await M('POST', `${url}/resposta`, { alternativa: certa }));
  assert.deepEqual([c.etapa, c.jogadores[0].pontuacao, c.jogador_da_vez.id_jogador], ['dado', perg.pontos, beto]);
  assert.deepEqual([c.ultima_jogada.alternativa, c.ultima_jogada.acertou, c.ultima_jogada.pontos, c.ultima_jogada.nome], [certa, true, perg.pontos, 'Ana Souza']);
  // Depois de respondida, a correção e a explicação aparecem
  assert.ok(c.ultima_jogada.pergunta.resposta);
  assert.equal(c.ultima_jogada.pergunta.alternativas.find((a) => a.letra === certa).pontos, perg.pontos);
  // Beto erra: sem pontos, o peão fica na casa e a vez volta para Ana (circular)
  ok(await dado(url, 4));
  const errada = letraErrada(ok(await M('POST', `${url}/sortear`)).jogada_pendente.pergunta.id_pergunta);
  const i = ok(await M('POST', `${url}/resposta`, { alternativa: errada }));
  assert.deepEqual([i.jogadores[1].casa_atual, i.jogadores[1].pontuacao, i.ultima_jogada.alternativa, i.ultima_jogada.acertou, i.ultima_jogada.pontos], [4, 0, errada, false, 0]);
  assert.deepEqual([i.partida.vez, i.jogador_da_vez.id_jogador], [0, ana]);
});

test('pausar e retomar: ações do jogo bloqueadas enquanto pausada', async () => {
  const url = `/api/partidas/${p1}`;
  const p = ok(await M('POST', `${url}/pausar`));
  assert.deepEqual([p.etapa, p.jogador_da_vez.id_jogador], ['pausada', ana]);
  assert.ok(p.partida.pausada_em);
  falha(await M('POST', `${url}/pausar`), 409);
  falha(await dado(url, 2), 409, 'A partida está pausada.');
  for (const acao of ['sortear', 'pular', 'resposta']) falha(await M('POST', `${url}/${acao}`, { alternativa: 'A' }), 409, 'A partida está pausada.');
  const r = ok(await M('POST', `${url}/retomar`));
  assert.deepEqual([r.etapa, r.partida.pausada_em], ['dado', null]);
  falha(await M('POST', `${url}/retomar`), 409);
});

test('Chegou! → premiação; RF08 duplicidade; RF09 baixa e estoque zero; finalização', async () => {
  const url = `/api/partidas/${p1}`;
  falha(await A('PUT', `${url}/jogadores/${ana}/casa`, { casa: 65 }), 400);
  ok(await A('PUT', `${url}/jogadores/${ana}/casa`, { casa: 64 }));
  db.prepare('UPDATE TB_JOGADOR_PARTIDA SET pontuacao = 180 WHERE id_partida = ? AND id_jogador = ?').run(p1, ana); // cargo mais alto
  const fim = ok(await dado(url, 6)); // para no fim da rota
  assert.deepEqual([fim.etapa, fim.partida.status, fim.jogadores[0].casa_atual, fim.ultima_jogada.casa_final, fim.ultima_jogada.casa.acao, fim.ultima_jogada.pergunta],
    ['premiacao', 'Premiação', 65, 65, 'chegada', null]);
  assert.ok(fim.partida.encerrada_em);
  assert.equal(fim.jogador_da_vez, null);
  assert.ok(fim.jogadores.every((j) => !j.da_vez));
  assert.deepEqual(fim.jogadores.map((j) => j.brinde.cargo), ['CEO', 'Jovem Aprendiz']); // pela pontuação, não pela casa
  falha(await dado(url, 1), 409);
  falha(await A('PUT', `${url}/jogadores/${beto}/casa`, { casa: 10 }), 409);
  // A7/RF08: na premiação ninguém é removido — a partida só finaliza depois de premiar todos
  falha(await A('DELETE', `${url}/jogadores/${beto}`), 409, 'A partida já foi encerrada: confirme a entrega dos brindes.');

  const estoque = async () => Object.fromEntries(ok(await M('GET', '/api/brindes')).map((b) => [b.cargo, b]));
  const antes = await estoque();
  const e1 = ok(await M('POST', `${url}/entregas`, { id_jogador: ana }));
  assert.deepEqual([e1.jogadores[0].entregue, e1.etapa], [true, 'premiacao']);
  const depois = await estoque();
  assert.equal(depois['CEO'].quantidade_estoque, antes['CEO'].quantidade_estoque - 1);
  assert.equal(depois['CEO'].entregues, antes['CEO'].entregues + 1);
  falha(await M('POST', `${url}/entregas`, { id_jogador: ana }), 409, 'Este jogador já recebeu o brinde desta partida.');
  assert.equal((await estoque())['CEO'].quantidade_estoque, depois['CEO'].quantidade_estoque);
  falha(await M('POST', `${url}/entregas`, { id_jogador: eva }), 404); // não joga esta partida

  // RF09: estoque zero não dá baixa nem registra entrega
  const ini = depois['Jovem Aprendiz'];
  falha(await A('PUT', `/api/brindes/${ini.id_brinde}`, { quantidade_estoque: -1 }), 400);
  falha(await A('PUT', '/api/brindes/999', { quantidade_estoque: 1 }), 404);
  // A22: só inteiros seguros (acima de 2^53 o banco grava, mas toda leitura falha)
  falha(await A('PUT', `/api/brindes/${ini.id_brinde}`, { quantidade_estoque: 2 ** 53 }), 400);
  falha(await A('PUT', `/api/brindes/${ini.id_brinde}`, { pontos_minimos: '100000000000000000' }), 400);
  // A24: duas faixas nos mesmos pontos mínimos → 409; os pontos do próprio brinde continuam aceitos
  falha(await A('PUT', `/api/brindes/${ini.id_brinde}`, { pontos_minimos: depois['Estagiário'].pontos_minimos }), 409, 'Já existe um brinde com esses pontos mínimos.');
  ok(await A('PUT', `/api/brindes/${ini.id_brinde}`, { pontos_minimos: ini.pontos_minimos }));
  // O administrador pode renomear o cargo
  assert.equal(ok(await A('PUT', `/api/brindes/${ini.id_brinde}`, { cargo: 'Aprendiz' })).cargo, 'Aprendiz');
  ok(await A('PUT', `/api/brindes/${ini.id_brinde}`, { cargo: 'Jovem Aprendiz' }));
  falha(await A('PUT', `/api/brindes/${ini.id_brinde}`, { cargo: ' ' }), 400, 'Informe o nome do brinde e o cargo.');
  ok(await A('PUT', `/api/brindes/${ini.id_brinde}`, { quantidade_estoque: 0 }));
  falha(await M('POST', `${url}/entregas`, { id_jogador: beto }), 409, 'O "Chaveiro Jovem Aprendiz" esgotou! Não há unidades na mesa.');
  const semBaixa = ok(await M('GET', url));
  assert.deepEqual([semBaixa.etapa, semBaixa.jogadores[1].entregue, semBaixa.jogadores[1].brinde.quantidade_estoque], ['premiacao', false, 0]);
  assert.equal((await estoque())['Jovem Aprendiz'].entregues, ini.entregues);

  ok(await A('PUT', `/api/brindes/${ini.id_brinde}`, { quantidade_estoque: 5 }));
  const fin = ok(await M('POST', `${url}/entregas`, { id_jogador: beto }));
  assert.deepEqual([fin.etapa, fin.partida.status], ['finalizada', 'Finalizada']);
  assert.ok(fin.partida.finalizada_em);
  assert.equal((await estoque())['Jovem Aprendiz'].quantidade_estoque, 4);
  falha(await M('POST', `${url}/entregas`, { id_jogador: beto }), 409);
  falha(await A('DELETE', `${url}/jogadores/${beto}`), 409, 'A partida já foi finalizada.');
  assert.equal(ok(await M('GET', '/api/jogadores?q=Beto'))[0].em_partida, false);
});

test('RF06: nenhuma pergunta se repete; categoria esgotada → sem_perguntas e "passar a vez"; casa surpresa', async () => {
  const url = `/api/partidas/${ok(await M('POST', '/api/partidas', { jogadores: [{ id_jogador: caio }] }), 201).partida.id_partida}`;
  const vaiPara = async (casa, valor) => {
    ok(await A('PUT', `${url}/jogadores/${caio}/casa`, { casa }));
    return ok(await dado(url, valor)).jogada_pendente;
  };
  const rotinas = ok(await A('GET', '/api/perguntas?categoria=3')).map((p) => p.id_pergunta);
  const sorteadas = [];
  for (let i = 0; i < rotinas.length; i++) {
    assert.equal((await vaiPara(3, 1)).categoria.nome, 'Rotinas'); // casa 4 = azul
    sorteadas.push(ok(await M('POST', `${url}/sortear`)).jogada_pendente.pergunta.id_pergunta);
    ok(await M('POST', `${url}/resposta`, { alternativa: i % 2 === 0 ? letraCerta(sorteadas.at(-1)) : letraErrada(sorteadas.at(-1)) }));
  }
  const ordenar = (ids) => ids.toSorted((a, b) => a - b);
  assert.deepEqual(ordenar(sorteadas), ordenar(rotinas)); // todas as de Rotinas, nenhuma repetida

  await vaiPara(3, 1);
  const esgotou = await M('POST', `${url}/sortear`);
  falha(esgotou, 409, 'Não há mais perguntas inéditas da categoria Rotinas nesta partida.');
  assert.equal(esgotou.corpo.sem_perguntas, true);
  assert.equal(ok(await M('GET', url)).jogada_pendente.sem_perguntas, true);
  const pulou = ok(await M('POST', `${url}/pular`));
  assert.deepEqual([pulou.etapa, pulou.ultima_jogada.acertou, pulou.ultima_jogada.pontos], ['dado', null, 0]);

  // Casa roxa (7): categoria sorteada entre as que ainda têm pergunta inédita — nunca Rotinas nem Entrevista
  for (let i = 0; i < 3; i++) {
    const roxa = await vaiPara(6, 1);
    assert.deepEqual([roxa.casa.numero, roxa.casa.sorteada, roxa.categoria, roxa.sem_perguntas], [7, true, null, false]);
    const s = ok(await M('POST', `${url}/sortear`)).jogada_pendente;
    assert.ok(![3, 5].includes(s.categoria.id_categoria));
    sorteadas.push(s.pergunta.id_pergunta);
    ok(await M('POST', `${url}/resposta`, { alternativa: letraCerta(s.pergunta.id_pergunta) }));
  }
  assert.equal(new Set(sorteadas).size, sorteadas.length);

  // Excluir pergunta já sorteada mantém o histórico da partida (id_pergunta → NULL)
  ok(await A('DELETE', `/api/perguntas/${sorteadas.at(-1)}`), 204);
  assert.equal(ok(await M('GET', url)).ultima_jogada.pergunta, null);

  // A16: restrições do modelo lógico no schema — CARTA_PARTIDA (partida, pergunta) única e casa → TB_CASA
  const idPartida = Number(url.split('/').at(-1));
  assert.throws(() => db.prepare(`INSERT INTO TB_JOGADA (id_partida, id_jogador, valor_dado, casa_inicial, casa_final, id_pergunta, concluida)
    VALUES (?, ?, 1, 3, 4, ?, 1)`).run(idPartida, caio, sorteadas[0]), /UNIQUE/);
  assert.throws(() => db.prepare('UPDATE TB_JOGADOR_PARTIDA SET casa_atual = 999 WHERE id_partida = ?').run(idPartida), /FOREIGN KEY/);
});

test('admin remove jogador; encerrar pausada com jogada pendente vai para a premiação', async () => {
  const url = `/api/partidas/${ok(await M('POST', '/api/partidas', { jogadores: [{ id_jogador: duda }, { id_jogador: eva }] }), 201).partida.id_partida}`;
  falha(await A('DELETE', `${url}/jogadores/99999`), 404);
  const r = ok(await A('DELETE', `${url}/jogadores/${duda}`)); // era a vez da Duda
  assert.deepEqual([r.jogadores[0].ativo, r.jogadores[0].da_vez, r.partida.vez, r.jogador_da_vez.id_jogador], [false, false, 1, eva]);
  falha(await A('DELETE', `${url}/jogadores/${eva}`), 409, 'Não é possível remover o último jogador da partida.');
  falha(await A('PUT', `${url}/jogadores/${eva}/casa`, { casa: 'x' }), 400);
  ok(await dado(url, 4)); // casa azul: fica pendente
  falha(await A('PUT', `${url}/jogadores/${eva}/casa`, { casa: 10 }), 409); // jogada pendente
  ok(await M('POST', `${url}/pausar`));
  const fim = ok(await M('POST', `${url}/encerrar`));
  assert.deepEqual([fim.etapa, fim.partida.pausada_em, fim.jogada_pendente], ['premiacao', null, null]);
  assert.deepEqual([fim.ultima_jogada.id_jogador, fim.ultima_jogada.acertou, fim.ultima_jogada.pontos], [eva, null, 0]);
  assert.ok(fim.partida.encerrada_em);
  falha(await M('POST', `${url}/encerrar`), 409);
  falha(await M('POST', `${url}/entregas`, { id_jogador: duda }), 409); // removida da partida
  assert.equal(ok(await M('POST', `${url}/entregas`, { id_jogador: eva })).etapa, 'finalizada'); // todos os ativos receberam
});

test('estado público (telão): sem correção antes da resposta, sem e-mail e com apelido', async () => {
  const e = ok(await M('POST', '/api/partidas', { jogadores: [{ id_jogador: ana }] }), 201);
  const url = `/api/partidas/${e.partida.id_partida}`;
  ok(await dado(url, 4));
  ok(await M('POST', `${url}/sortear`));
  const pub = ok(await anonimo('GET', `/api/publico/partidas/${e.partida.codigo_online.toLowerCase()}`));
  assert.deepEqual([pub.etapa, pub.jogadores[0].nome, pub.jogador_da_vez.nome], ['responder', 'Aninha', 'Aninha']);
  assert.ok(pub.jogada_pendente.pergunta.enunciado);
  assert.equal('resposta' in pub.jogada_pendente.pergunta, false);
  assert.deepEqual(pub.jogada_pendente.pergunta.alternativas.map((a) => Object.keys(a)), Array(4).fill(['letra', 'texto']));
  // Página sem login, com menores de idade: nada além do que o telão usa
  assert.ok(!JSON.stringify(pub).includes('Ana Souza') && !JSON.stringify(pub).includes('Escola Básica'));
  assert.ok(!('escola' in pub.jogadores[0]) && !('apelido' in pub.jogadores[0]) && !('apelido' in pub.jogador_da_vez) && !('mediador' in pub.partida));
  // Sem apelido, só o primeiro nome; quem foi removido não aparece
  const dupla = ok(await M('POST', '/api/partidas', { jogadores: [{ id_jogador: beto }, { id_jogador: fabio }] }), 201);
  ok(await A('DELETE', `/api/partidas/${dupla.partida.id_partida}/jogadores/${fabio}`));
  const semApelido = ok(await anonimo('GET', `/api/publico/partidas/${dupla.partida.codigo_online}`));
  assert.deepEqual([semApelido.jogadores.map((j) => j.nome), semApelido.jogador_da_vez.nome], [['Beto'], 'Beto']);
  assert.ok(!JSON.stringify(semApelido).includes('Lima') && !JSON.stringify(semApelido).includes('Nunes'));
  // Quem jogou e depois foi removido também some: a última jogada dele não vai para o telão
  const trio = await partida([{ id_jogador: beto }, { id_jogador: fabio }]);
  ok(await dado(trio.url, 3)); // casa amarela: a vez passa para o Fábio
  ok(await A('DELETE', `${trio.url}/jogadores/${beto}`));
  const semRemovido = ok(await anonimo('GET', `/api/publico/partidas/${trio.e.partida.codigo_online}`));
  assert.deepEqual([semRemovido.jogadores.map((j) => j.nome), semRemovido.ultima_jogada], [['Fábio'], null]);
  assert.ok(!JSON.stringify(semRemovido).includes('Beto'));
  assert.ok(!JSON.stringify(pub).includes('"email"'));
  falha(await anonimo('GET', '/api/publico/partidas/ZZZZZZ'), 404, 'Partida não encontrada.');
  falha(await anonimo('GET', url), 401);
  falha(await M('GET', '/api/partidas/99999'), 404, 'Partida não encontrada.');
});

test('listagem de partidas e relatórios (admin)', async () => {
  const ativas = ok(await M('GET', `/api/partidas?status=${encodeURIComponent('Em Andamento,Pausada,Premiação')}`));
  assert.ok(ativas.length >= 2 && ativas.every((p) => p.status !== 'Finalizada'));
  const todas = ok(await M('GET', '/api/partidas'));
  assert.ok(todas.some((p) => p.id_partida === p1 && p.status === 'Finalizada'));
  assert.ok(todas[0].id_partida > todas.at(-1).id_partida); // mais recentes primeiro
  assert.deepEqual(todas.find((p) => p.id_partida === p1).jogadores.map((j) => j.id_jogador), [ana, beto]);

  const rel = ok(await A('GET', '/api/relatorios'));
  assert.equal(rel.resumo.partidas, todas.length);
  assert.ok(rel.resumo.partidas_finalizadas >= 2 && rel.resumo.brindes_entregues >= 3 && rel.resumo.acertos >= 1 && rel.resumo.erros >= 1);
  assert.equal(rel.por_categoria.length, 5);
  for (const c of rel.por_categoria) assert.equal(c.respondidas, c.acertos + c.erros);
  // A18: Relatorio_Categoria por jogador (DER) — Ana acertou 1 de Rotinas; Beto errou 1 de Rotinas
  const doJogador = (id) => rel.por_jogador_categoria.filter((x) => x.id_jogador === id)
    .map((x) => [x.nome, x.categoria, x.cor_hex, x.respondidas, x.acertos, x.erros, x.percentual_acerto]);
  assert.deepEqual(doJogador(ana), [['Ana Souza', 'Rotinas', '#1E88E5', 1, 1, 0, 100]]);
  assert.deepEqual(doJogador(beto), [['Beto Lima', 'Rotinas', '#1E88E5', 1, 0, 1, 0]]);
  for (const c of rel.por_categoria) {
    const linhas = rel.por_jogador_categoria.filter((x) => x.id_categoria === c.id_categoria);
    assert.equal(linhas.reduce((soma, x) => soma + x.respondidas, 0), c.respondidas); // fecha com o total da categoria
  }
  assert.ok(rel.ranking.every((j, i) => i === 0 || rel.ranking[i - 1].pontos >= j.pontos));
  assert.equal(rel.ranking.find((j) => j.id_jogador === ana).melhor_cargo, 'CEO'); // os 180 pontos da partida de Ana
  // Cargo só de partida em que o jogador não foi removido: o Fábio foi removido na única em que entrou com pontos 0
  db.prepare('UPDATE TB_JOGADOR_PARTIDA SET pontuacao = 500 WHERE id_jogador = ? AND ativo = 0').run(fabio);
  const semCargo = ok(await A('GET', '/api/relatorios')).ranking.find((j) => j.id_jogador === fabio);
  assert.notEqual(semCargo?.melhor_cargo, 'CEO');
  db.prepare('UPDATE TB_JOGADOR_PARTIDA SET pontuacao = 0 WHERE id_jogador = ? AND ativo = 0').run(fabio);
  assert.deepEqual(rel.por_escola.find((x) => x.id_escola === escola).jogadores, 6);
  const r1 = rel.partidas.find((p) => p.id_partida === p1);
  assert.deepEqual([r1.jogadores, r1.vencedor], ['Ana Souza, Beto Lima', 'Ana Souza']);
  assert.equal(rel.brindes.length, 8);
});

test('A23: ação de uma tela desatualizada (outra aba) → 409, sem cair na jogada de outro jogador', async () => {
  const url = `/api/partidas/${ok(await M('POST', '/api/partidas', { jogadores: [{ id_jogador: duda }, { id_jogador: eva }] }), 201).partida.id_partida}`;
  const MUDOU = 'A partida mudou: recarregue a tela.';
  falha(await dado(url, 2, { id_jogador: eva }), 409, MUDOU); // a vez é da Duda
  const x = ok(await dado(url, 4, { id_jogador: duda })).jogada_pendente.id_jogada;
  falha(await M('POST', `${url}/sortear`, { id_jogada: x + 1 }), 409, MUDOU);
  falha(await M('POST', `${url}/pular`, { id_jogada: x + 1 }), 409, MUDOU);
  ok(await M('POST', `${url}/sortear`, { id_jogada: String(x) }));
  ok(await M('POST', `${url}/resposta`, { alternativa: 'A', id_jogada: x })); // outra aba responde a jogada x...
  ok(await dado(url, 4)); // ...e a Eva joga, casa 4 = Rotinas (sem os campos: sem conferência)
  falha(await M('POST', `${url}/resposta`, { alternativa: 'B', id_jogada: x }), 409, MUDOU); // a tela velha ainda mostra x
  const y = ok(await M('POST', `${url}/sortear`)).jogada_pendente.id_jogada;
  falha(await M('POST', `${url}/resposta`, { alternativa: 'B', id_jogada: x }), 409, MUDOU); // nem na etapa certa cai na jogada da Eva
  const e = ok(await M('GET', url));
  assert.deepEqual([e.etapa, e.jogada_pendente.id_jogada, e.jogada_pendente.id_jogador], ['responder', y, eva]);
});

test('A45: ação na API vinda de outra origem → 403 (CSRF); a própria tela passa', async () => {
  const url = `/api/partidas/${ok(await M('POST', '/api/partidas', { jogadores: [{ id_jogador: eva }] }), 201).partida.id_partida}`;
  const BLOQUEADA = 'Requisição de outra origem bloqueada.';
  falha(await M('POST', `${url}/encerrar`, undefined, { origin: 'http://evil.example' }), 403, BLOQUEADA);
  falha(await M('POST', `${url}/encerrar`, undefined, { origin: 'null' }), 403, BLOQUEADA);
  falha(await M('POST', `${url}/encerrar`, undefined, { 'sec-fetch-site': 'same-site' }), 403, BLOQUEADA); // outra porta no mesmo IP
  falha(await M('POST', '/api/logout', undefined, { 'sec-fetch-site': 'cross-site' }), 403, BLOQUEADA);
  falha(await anonimo('POST', '/api/login', { email: 'mediador@senai.com.br', senha: 'mediador123' }, { origin: 'http://192.168.0.9:8080' }), 403, BLOQUEADA);
  ok(await M('GET', '/api/me')); // o logout bloqueado não derrubou a sessão
  assert.equal(ok(await M('GET', url, undefined, { 'sec-fetch-site': 'cross-site' })).partida.status, 'Em Andamento'); // GET não altera nada
  const p = ok(await M('POST', `${url}/pausar`, undefined, { origin: BASE, 'sec-fetch-site': 'same-origin' }));
  assert.equal(p.partida.status, 'Pausada');
});

test('A26: sessão vencida (7 dias) → 401; o login apaga as vencidas sem derrubar as outras', async () => {
  const velha = await entrar('mediador@senai.com.br', 'mediador123');
  db.prepare('UPDATE TB_SESSAO SET criado_em = unixepoch() - 7 * 86400 WHERE token = ?').run(velha);
  falha(await chamar(velha, 'GET', '/api/me'), 401);
  await entrar('mediador@senai.com.br', 'mediador123');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM TB_SESSAO WHERE token = ?').get(velha).n, 0);
  ok(await M('GET', '/api/me')); // vários tablets na mesma conta: as sessões válidas continuam
});

test('A28: erros do corpo e da URL também em português', async () => {
  const enviar = async (corpo, tipo = 'application/json', extra = {}) => {
    const r = await fetch(`${BASE}/api/partidas`, { method: 'POST', headers: { cookie: `sid=${med}`, 'content-type': tipo, ...extra }, body: corpo });
    return { status: r.status, corpo: await r.json() };
  };
  falha(await enviar('{"jogadores": ['), 400, 'Corpo da requisição inválido (JSON malformado).');
  falha(await enviar(JSON.stringify({ x: 'a'.repeat(200_000) })), 413, 'Requisição grande demais.');
  falha(await enviar('{}', 'application/json; charset=klingon'), 415, 'Formato de requisição não suportado.');
  falha(await M('GET', '/api/partidas/%E0%A4%A'), 400, 'Parâmetro inválido na URL.');
  // nunca a mensagem técnica em inglês: gzip corrompido (zlib) e Range/If-Match nas páginas (envio de arquivo)
  falha(await enviar('nao-e-gzip', undefined, { 'content-encoding': 'gzip' }), 400, 'Corpo da requisição inválido (JSON malformado).');
  falha(await anonimo('GET', '/login', undefined, { range: 'bytes=99999999-' }), 416, 'Requisição inválida.');
  falha(await anonimo('GET', '/login', undefined, { 'if-match': '"x"' }), 412, 'Requisição inválida.');
});

test('A42: as rotas /api não passam pelo express.static (o fs.stat dele espera no threadpool, que o scrypt dos logins ocupa)', async () => {
  const stat = fs.stat;
  let chamadas = 0;
  fs.stat = (...a) => (chamadas++, stat(...a));
  try {
    ok(await anonimo('GET', '/api/tabuleiro'));
    ok(await M('GET', `/api/partidas/${p1}`));
    assert.equal(chamadas, 0);
    assert.equal((await anonimo('GET', '/css/style.css')).status, 200); // os arquivos estáticos continuam servidos
    assert.ok(chamadas > 0);
  } finally {
    fs.stat = stat;
  }
});

test('A6: os exemplos só são semeados na criação do banco (PRAGMA user_version)', async () => {
  const pasta = mkdtempSync(join(tmpdir(), 'carreira-'));
  // nova instância do módulo sobre o mesmo arquivo = novo início do servidor
  const abrir = async (n) => {
    process.env.DB_PATH = join(pasta, 'teste.db');
    try {
      return (await import(`../src/db.js?inicio=${n}`)).db;
    } finally {
      process.env.DB_PATH = ':memory:';
    }
  };
  const contar = (d) => ({ ...d.prepare(`SELECT (SELECT COUNT(*) FROM TB_USUARIO) AS usuarios, (SELECT COUNT(*) FROM TB_ESCOLA) AS escolas,
    (SELECT COUNT(*) FROM TB_PERGUNTA) AS perguntas, (SELECT user_version FROM pragma_user_version) AS versao`).get() });
  try {
    let d = await abrir(1);
    assert.deepEqual([contar(d).versao, contar(d).escolas], [1, 1]);
    assert.deepEqual(d.prepare('SELECT quantidade_estoque AS n FROM TB_BRINDE ORDER BY pontos_minimos').all().map((b) => b.n), [42, 32, 59, 72, 41, 27, 15, 12]); // 300 chaveiros
    d.exec('DELETE FROM TB_ESCOLA; DELETE FROM TB_PERGUNTA;'); // o admin apagou tudo
    d.close();
    d = await abrir(2);
    assert.deepEqual(contar(d), { usuarios: 2, escolas: 0, perguntas: 0, versao: 1 }); // e continua apagado
    // banco de antes da versão (user_version 0) já populado: não duplica nada e passa para a versão 1
    d.exec('PRAGMA user_version = 0');
    d.close();
    d = await abrir(3);
    assert.deepEqual([contar(d).usuarios, contar(d).versao], [2, 1]);
    d.close();
    // Banco da fase 1 (coluna casa_minima): recusado com mensagem clara, sem criar nem alterar nada nele
    const fase1 = new DatabaseSync(join(pasta, 'fase1.db'));
    fase1.exec('CREATE TABLE TB_BRINDE (id_brinde INTEGER PRIMARY KEY, casa_minima INTEGER)');
    fase1.close();
    process.env.DB_PATH = join(pasta, 'fase1.db');
    await assert.rejects(import('../src/db.js?inicio=fase1'), /é da fase 1 e não é migrado/);
    process.env.DB_PATH = ':memory:';
    const conferir = new DatabaseSync(join(pasta, 'fase1.db'));
    assert.equal(conferir.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'TB_ALTERNATIVA'").get().n, 0);
    conferir.close();
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
});

test('Dado: sempre sorteado no servidor, de 1 a 6; número enviado pela tela é ignorado', async () => {
  const { url } = await partida([{ id_jogador: caio }]);
  const saiu = new Set();
  for (let i = 0; i < 120; i++) {
    ok(await A('PUT', `${url}/jogadores/${caio}/casa`, { casa: 52 })); // casas 53 a 57 amarelas, 58 roxa: nenhuma caveira
    const e = ok(await M('POST', `${url}/dado`));
    const j = e.jogada_pendente ?? e.ultima_jogada;
    assert.equal(j.casa_final, 52 + j.valor_dado);
    saiu.add(j.valor_dado);
    if (e.etapa === 'sortear') { // casa 58: responde para poder lançar de novo
      ok(await M('POST', `${url}/sortear`));
      ok(await M('POST', `${url}/resposta`, { alternativa: 'A' }));
    }
  }
  assert.deepEqual([...saiu].toSorted(), [1, 2, 3, 4, 5, 6]);
  ok(await A('PUT', `${url}/jogadores/${caio}/casa`, { casa: 52 }));
  const r = ok(await dado(url, 3, { valor: 5 })); // a tela não escolhe o número
  assert.deepEqual([r.ultima_jogada.valor_dado, r.ultima_jogada.casa_final], [3, 55]);
});

test('Casa amarela: sem pergunta, a jogada termina e a vez passa', async () => {
  const { url, e, vaiPara } = await partida([{ id_jogador: duda }, { id_jogador: eva }]);
  assert.equal(e.jogador_da_vez.id_jogador, duda);
  const r = ok(await dado(url, 3)); // casa 3 = amarela
  assert.deepEqual([r.etapa, r.jogada_pendente, r.jogadores[0].casa_atual, r.jogadores[0].pontuacao, r.jogador_da_vez.id_jogador], ['dado', null, 3, 0, eva]);
  const u = r.ultima_jogada;
  assert.deepEqual([u.valor_dado, u.casa_final, u.casa.acao, u.categoria, u.pergunta, u.alternativa, u.acertou, u.pontos], [3, 3, 'espera', null, null, null, null, 0]);
  falha(await M('POST', `${url}/sortear`), 409, 'Lance primeiro o dado.');
  const seta = await vaiPara(eva, 0, 1); // casa 1 = amarela com seta
  assert.deepEqual([seta.etapa, seta.ultima_jogada.casa.acao, seta.jogador_da_vez.id_jogador], ['dado', 'espera', duda]);
});

test('Entrevista: casa com maleta, nota por alternativa e fora das casas-surpresa', async () => {
  const { url, vaiPara } = await partida([{ id_jogador: fabio }]);
  for (const nota of [15, 10, 5, 0]) {
    const e = await vaiPara(fabio, 11, 1); // casa 12 = verde com maleta
    assert.deepEqual([e.jogada_pendente.casa.icone, e.jogada_pendente.casa.sorteada, e.jogada_pendente.categoria.nome], ['maleta', false, 'Entrevista']);
    const p = ok(await M('POST', `${url}/sortear`)).jogada_pendente.pergunta;
    assert.deepEqual([p.entrevista, p.pontos], [true, 15]);
    const { letra } = db.prepare('SELECT letra FROM TB_ALTERNATIVA WHERE id_pergunta = ? AND pontos = ?').get(p.id_pergunta, nota);
    const antes = ok(await M('GET', url)).jogadores[0].pontuacao;
    const r = ok(await M('POST', `${url}/resposta`, { alternativa: letra }));
    assert.deepEqual([r.jogadores[0].pontuacao, r.ultima_jogada.pontos, r.ultima_jogada.acertou], [antes + nota, nota, nota > 0]);
  }
});

test('Casa da Morte: elimina sem pergunta, a vez pula o eliminado e ele recebe o brinde', async () => {
  for (const b of ok(await M('GET', '/api/brindes'))) ok(await A('PUT', `/api/brindes/${b.id_brinde}`, { quantidade_estoque: 50 })); // os testes anteriores gastaram
  const { url, e, vaiPara } = await partida([{ id_jogador: duda }, { id_jogador: eva }, { id_jogador: fabio }]);
  assert.equal(e.jogador_da_vez.id_jogador, duda);
  db.prepare('UPDATE TB_JOGADOR_PARTIDA SET pontuacao = 50 WHERE id_partida = ? AND id_jogador = ?').run(e.partida.id_partida, duda);
  const m = await vaiPara(duda, 16, 1); // casa 17 = caveira
  const d = m.jogadores[0];
  assert.deepEqual([m.etapa, m.jogada_pendente, d.eliminado, d.ativo, d.da_vez, d.pontuacao, d.brinde.cargo], ['dado', null, true, true, false, 50, 'Gerente Geral']);
  assert.deepEqual([m.ultima_jogada.casa.acao, m.ultima_jogada.acertou, m.ultima_jogada.pergunta, m.jogador_da_vez.id_jogador], ['morte', null, null, eva]);
  // Eva e Fábio se alternam, sem voltar para a eliminada
  assert.equal((await vaiPara(eva, 0, 3)).jogador_da_vez.id_jogador, fabio);
  assert.equal((await vaiPara(fabio, 0, 3)).jogador_da_vez.id_jogador, eva);
  // O administrador pode devolver a eliminada ao jogo movendo o peão: ela joga na sua próxima vez
  const volta = ok(await A('PUT', `${url}/jogadores/${duda}/casa`, { casa: 16 }));
  assert.deepEqual([volta.jogadores[0].eliminado, volta.jogadores[0].casa_atual], [false, 16]);
  assert.equal((await vaiPara(eva, 0, 3)).jogador_da_vez.id_jogador, fabio);
  assert.equal((await vaiPara(fabio, 0, 3)).jogador_da_vez.id_jogador, duda);
  // Todos eliminados: a partida vai para a premiação e cada um recebe o brinde do seu cargo
  const a = await vaiPara(duda, 16, 1);
  assert.equal(a.jogador_da_vez.id_jogador, eva);
  const b = await vaiPara(eva, 16, 1);
  assert.equal(b.jogador_da_vez.id_jogador, fabio);
  const fim = await vaiPara(fabio, 50, 1); // casa 51 = outra caveira
  assert.deepEqual([fim.etapa, fim.partida.status, fim.jogador_da_vez], ['premiacao', 'Premiação', null]);
  assert.ok(fim.partida.encerrada_em);
  assert.ok(fim.jogadores.every((j) => j.eliminado && j.ativo && !j.da_vez));
  ok(await M('POST', `${url}/entregas`, { id_jogador: duda }));
  ok(await M('POST', `${url}/entregas`, { id_jogador: eva }));
  assert.equal(ok(await M('POST', `${url}/entregas`, { id_jogador: fabio })).etapa, 'finalizada');
});

test('Casa da Morte: casos de borda', async () => {
  // Partida de 1 jogador: a eliminação abre a premiação
  const so = await partida([{ id_jogador: duda }]);
  assert.equal((await so.vaiPara(duda, 16, 1)).etapa, 'premiacao');
  // Casa preta sem caveira não elimina: é casa-surpresa (rota Direita, casa 235)
  const preta = await partida([{ id_jogador: duda, rota: 'direita' }]);
  const c = await preta.vaiPara(duda, 234, 1);
  assert.deepEqual([c.etapa, c.jogadores[0].eliminado, c.jogada_pendente.casa.sorteada], ['sortear', false, true]);
  // O último vivo removido pelo administrador, com um eliminado na partida: premiação, inclusive se estiver pausada
  const dois = await partida([{ id_jogador: duda }, { id_jogador: eva }]);
  await dois.vaiPara(duda, 16, 1);
  ok(await M('POST', `${dois.url}/pausar`));
  const r = ok(await A('DELETE', `${dois.url}/jogadores/${eva}`));
  assert.deepEqual([r.etapa, r.partida.pausada_em, r.jogadores.map((j) => j.ativo)], ['premiacao', null, [true, false]]);
  falha(await M('POST', `${dois.url}/entregas`, { id_jogador: eva }), 409); // removida não recebe
  assert.equal(ok(await M('POST', `${dois.url}/entregas`, { id_jogador: duda })).etapa, 'finalizada'); // eliminada recebe
});

test('Rotas: cada jogador segue a sua, com caminhos que se juntam até o Chegou!', async () => {
  const tab = ok(await anonimo('GET', '/api/tabuleiro'));
  const numeros = new Set(tab.casas.map((c) => c.numero));
  const seq = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
  assert.deepEqual(tab.rotas, { esquerda: seq(0, 65), centro: [0, ...seq(101, 119), ...seq(23, 65)], direita: [0, ...seq(201, 236), ...seq(31, 65)] });
  for (const [nome, rota] of Object.entries(tab.rotas)) {
    assert.deepEqual([rota[0], rota.at(-1), new Set(rota).size], [0, 65, rota.length], nome);
    assert.ok(rota.every((n) => numeros.has(n)), nome);
  }
  const { url, e, vaiPara } = await partida([{ id_jogador: duda, rota: 'centro' }, { id_jogador: eva, rota: 'direita' }, { id_jogador: fabio }]);
  assert.deepEqual(e.jogadores.map((j) => [j.rota, j.faltam]), [['centro', 62], ['direita', 71], ['esquerda', 65]]);
  // Saídas: dado 2 leva a casas diferentes em cada rota (todas amarelas)
  assert.equal(ok(await dado(url, 2)).jogadores[0].casa_atual, 102);
  assert.equal(ok(await dado(url, 2)).jogadores[1].casa_atual, 202);
  assert.equal(ok(await dado(url, 2)).jogadores[2].casa_atual, 2);
  // Junções: Centro entra na casa 23 e Direita na casa 31
  assert.equal((await vaiPara(duda, 119, 1)).jogadores[0].casa_atual, 23);
  assert.equal((await vaiPara(eva, 236, 1)).jogada_pendente.casa_final, 31);
  ok(await M('POST', `${url}/sortear`));
  ok(await M('POST', `${url}/encerrar`));
  // Mover peão: só dentro da rota do jogador
  const m = await partida([{ id_jogador: duda, rota: 'centro' }]);
  const FORA = 'A casa deve fazer parte da rota deste jogador e não pode ser o Chegou!.';
  for (const casa of [5, 201, 65, 999, -1, 'x']) falha(await A('PUT', `${m.url}/jogadores/${duda}/casa`, { casa }), 400, FORA);
  assert.equal(ok(await A('PUT', `${m.url}/jogadores/${duda}/casa`, { casa: 110 })).jogadores[0].faltam, 52);
  // Caveira só da rota Direita (casa 208)
  const d = await partida([{ id_jogador: duda, rota: 'direita' }]);
  assert.equal((await d.vaiPara(duda, 207, 1)).etapa, 'premiacao');
  // Chegou! também no fim das rotas novas
  const c = await partida([{ id_jogador: duda, rota: 'centro' }]);
  const fim = await c.vaiPara(duda, 64, 6);
  assert.deepEqual([fim.etapa, fim.jogadores[0].casa_atual, fim.jogadores[0].faltam], ['premiacao', 65, 0]);
  // Desempate pelo que falta até o Chegou!, e não pelo número da casa: quem está na 64 vence quem está na 201
  const emp = await partida([{ id_jogador: duda, rota: 'direita' }, { id_jogador: eva }]);
  db.prepare('UPDATE TB_JOGADOR_PARTIDA SET casa_atual = 201 WHERE id_partida = ? AND id_jogador = ?').run(emp.e.partida.id_partida, duda);
  db.prepare('UPDATE TB_JOGADOR_PARTIDA SET casa_atual = 64 WHERE id_partida = ? AND id_jogador = ?').run(emp.e.partida.id_partida, eva);
  const rel = ok(await A('GET', '/api/relatorios')).partidas.find((p) => p.id_partida === emp.e.partida.id_partida);
  assert.equal(rel.vencedor, 'Eva Martins');
});

test('Cargos: oito faixas de pontos, do Jovem Aprendiz ao CEO', async () => {
  const brindes = ok(await M('GET', '/api/brindes'));
  assert.deepEqual(brindes.map((b) => [b.cargo, b.pontos_minimos]), [['Jovem Aprendiz', 0], ['Estagiário', 10], ['Coordenador', 20], ['Gerente', 35],
    ['Gerente Geral', 50], ['Diretor de Área', 60], ['Vice-Presidente', 70], ['CEO', 80]]);
  const { url, e } = await partida([{ id_jogador: duda }]);
  const casos = [[0, 'Jovem Aprendiz'], [9, 'Jovem Aprendiz'], [10, 'Estagiário'], [19, 'Estagiário'], [20, 'Coordenador'], [34, 'Coordenador'], [35, 'Gerente'],
    [49, 'Gerente'], [50, 'Gerente Geral'], [59, 'Gerente Geral'], [60, 'Diretor de Área'], [69, 'Diretor de Área'], [70, 'Vice-Presidente'],
    [79, 'Vice-Presidente'], [80, 'CEO'], [500, 'CEO']];
  for (const [pontos, cargo] of casos) {
    db.prepare('UPDATE TB_JOGADOR_PARTIDA SET pontuacao = ? WHERE id_partida = ?').run(pontos, e.partida.id_partida);
    assert.equal(ok(await M('GET', url)).jogadores[0].brinde.cargo, cargo, `${pontos} pontos`);
  }
});

test('Sigilo: a pergunta encerrada sem resposta não revela a correção; a respondida revela também no telão', async () => {
  const { url, vaiPara } = await partida([{ id_jogador: caio }]);
  await vaiPara(caio, 3, 1);
  const naTela = ok(await M('POST', `${url}/sortear`)).jogada_pendente.pergunta;
  // A pergunta na tela não muda: a letra tocada não pode passar a valer para outro texto
  falha(await A('PUT', `/api/perguntas/${naTela.id_pergunta}`, nova({ id_categoria: 3 })), 409, 'Esta pergunta está em jogo agora: salve depois que a jogada terminar.');
  const fim = ok(await M('POST', `${url}/encerrar`));
  assert.equal('resposta' in fim.ultima_jogada.pergunta, false);
  assert.ok(fim.ultima_jogada.pergunta.alternativas.every((a) => !('pontos' in a)));

  const d = await partida([{ id_jogador: caio }]);
  await d.vaiPara(caio, 3, 1);
  const p = ok(await M('POST', `${d.url}/sortear`)).jogada_pendente.pergunta;
  ok(await M('POST', `${d.url}/resposta`, { alternativa: letraCerta(p.id_pergunta) }));
  const pub = ok(await anonimo('GET', `/api/publico/partidas/${d.e.partida.codigo_online}`));
  assert.ok(pub.ultima_jogada.pergunta.resposta);
  assert.ok(pub.ultima_jogada.pergunta.alternativas.some((a) => a.pontos > 0));
  assert.equal(pub.ultima_jogada.nome, 'Caio'); // primeiro nome: Caio não tem apelido
});

test('Certificado: só depois do fim, com cargo, e e-mail apenas para o administrador', async () => {
  const { url, e } = await partida([{ id_jogador: ana }, { id_jogador: beto }]);
  const cert = `${url}/certificados/${ana}`;
  falha(await M('GET', cert), 409, 'O certificado só é emitido depois do fim da partida.');
  falha(await anonimo('GET', cert), 401);
  db.prepare('UPDATE TB_JOGADOR_PARTIDA SET pontuacao = 75 WHERE id_partida = ? AND id_jogador = ?').run(e.partida.id_partida, ana);
  ok(await M('POST', `${url}/encerrar`));
  const c = ok(await M('GET', cert));
  assert.deepEqual([c.nome, c.escola, c.cargo, c.pontuacao, c.unidade, 'email' in c], ['Ana Souza', 'Escola Básica São João', 'Vice-Presidente', 75, 'SENAI Videira', false]);
  assert.ok(c.encerrada_em);
  assert.equal(ok(await A('GET', cert)).email, 'ana@escola.com');
  falha(await M('GET', `${url}/certificados/${eva}`), 404); // não joga esta partida
  falha(await M('GET', `/api/partidas/99999/certificados/${ana}`), 404);
  // Eliminado recebe certificado; removido, não. Mover para a caveira não elimina: só o dado aplica o efeito da casa
  const elim = await partida([{ id_jogador: duda }, { id_jogador: eva }, { id_jogador: caio }]);
  await elim.vaiPara(duda, 16, 1);
  const naCaveira = ok(await A('PUT', `${elim.url}/jogadores/${eva}/casa`, { casa: 17 }));
  assert.deepEqual([naCaveira.jogadores[1].casa_atual, naCaveira.jogadores[1].eliminado, naCaveira.etapa], [17, false, 'dado']);
  ok(await A('DELETE', `${elim.url}/jogadores/${caio}`));
  ok(await M('POST', `${elim.url}/encerrar`));
  assert.equal(ok(await M('GET', `${elim.url}/certificados/${duda}`)).cargo, 'Jovem Aprendiz');
  falha(await M('GET', `${elim.url}/certificados/${caio}`), 409, 'Este jogador foi removido da partida.');
  // A lista: por nome, com o cargo, sem quem foi removido, sem partida em andamento e sem e-mail
  const emAndamento = await partida([{ id_jogador: fabio }]);
  const lista = ok(await M('GET', '/api/certificados'));
  const desta = lista.filter((c) => c.id_partida === elim.e.partida.id_partida);
  assert.deepEqual(desta.map((c) => [c.nome, c.cargo]), [['Duda Reis', 'Jovem Aprendiz'], ['Eva Martins', 'Jovem Aprendiz']]);
  assert.equal(lista.find((c) => c.id_partida === e.partida.id_partida && c.id_jogador === ana).cargo, 'Vice-Presidente');
  assert.ok(!lista.some((c) => c.id_partida === emAndamento.e.partida.id_partida));
  assert.ok(lista.every((c, i) => i === 0 || lista[i - 1].nome.localeCompare(c.nome, 'en') <= 0 || lista[i - 1].nome <= c.nome));
  assert.ok(!JSON.stringify(lista).includes('@'));
  falha(await anonimo('GET', '/api/certificados'), 401);
  assert.equal((await anonimo('GET', '/certificados')).status, 302);
  assert.equal((await M('GET', '/certificados')).status, 200);
  const pagina = `/partida/${e.partida.id_partida}/certificado/${ana}`;
  assert.equal((await M('GET', pagina)).status, 200);
  assert.equal((await anonimo('GET', pagina)).status, 302);
});

test('Banco inicial: alternativas completas, pontos pela dificuldade e letras equilibradas', () => {
  const perguntas = JSON.parse(readFileSync(new URL('../data/perguntas.json', import.meta.url), 'utf8'));
  const porCategoria = Map.groupBy(perguntas, (p) => p.id_categoria);
  assert.deepEqual([1, 2, 3, 4, 5].map((c) => porCategoria.get(c)?.length), [25, 25, 25, 25, 12]);
  assert.equal(new Set(perguntas.map((p) => p.enunciado)).size, perguntas.length);
  for (const p of perguntas) {
    assert.ok(p.enunciado && p.resposta, p.enunciado);
    assert.ok(!/Aceitar/.test(p.resposta), p.enunciado); // a explicação vai para o público: sem instrução ao mediador
    assert.equal(p.alternativas.length, 4, p.enunciado);
    assert.equal(new Set(p.alternativas).size, 4, p.enunciado);
    // Escadinha (convenção do SENAI/SC): do mais curto para o mais longo, sem empate
    p.alternativas.slice(1).forEach((a, i) => assert.ok(a.length > p.alternativas[i].length, p.enunciado));
    if (p.id_categoria === 5) assert.deepEqual(p.notas.toSorted((a, b) => a - b), [0, 5, 10, 15], p.enunciado);
    else assert.ok(['A', 'B', 'C', 'D'].includes(p.correta) && ['Fácil', 'Médio', 'Difícil'].includes(p.dificuldade), p.enunciado);
  }
  // Nenhuma letra concentra as respostas
  for (const [categoria, lista] of porCategoria) {
    const letras = lista.map((p) => p.correta ?? 'ABCD'[p.notas.indexOf(15)]);
    for (const l of 'ABCD') assert.ok(letras.filter((x) => x === l).length / lista.length <= 0.35, `categoria ${categoria}, letra ${l}`);
  }
  // Toda pergunta semeada no banco tem 4 alternativas
  const semQuatro = db.prepare(`SELECT p.id_pergunta FROM TB_PERGUNTA p LEFT JOIN TB_ALTERNATIVA a USING (id_pergunta)
    GROUP BY p.id_pergunta HAVING COUNT(a.letra) <> 4`).all();
  assert.deepEqual(semQuatro, []);
  // Pergunta comum: só a correta pontua, pela dificuldade. Entrevista: as notas 15, 10, 5 e 0
  const pontosErrados = db.prepare(`SELECT p.id_pergunta FROM TB_PERGUNTA p WHERE p.id_categoria <> 5 AND (
    (SELECT COUNT(*) FROM TB_ALTERNATIVA a WHERE a.id_pergunta = p.id_pergunta AND a.pontos > 0) <> 1
    OR (SELECT MAX(a.pontos) FROM TB_ALTERNATIVA a WHERE a.id_pergunta = p.id_pergunta)
       <> CASE p.dificuldade WHEN 'Fácil' THEN 5 WHEN 'Médio' THEN 10 ELSE 15 END)`).all();
  assert.deepEqual(pontosErrados, []);
  const notasErradas = db.prepare(`SELECT p.id_pergunta FROM TB_PERGUNTA p WHERE p.id_categoria = 5 AND
    (SELECT GROUP_CONCAT(pontos) FROM (SELECT a.pontos FROM TB_ALTERNATIVA a WHERE a.id_pergunta = p.id_pergunta ORDER BY a.pontos)) <> '0,5,10,15'`).all();
  assert.deepEqual(notasErradas, []);
});
