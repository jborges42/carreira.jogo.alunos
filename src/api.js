// API REST (docs/ESPECIFICACAO-TECNICA.md §5). Login/logout/me ficam em auth.js; as regras da partida, em jogo.js.
import { Router } from 'express';
import { db, transacao, gravarAlternativas, ROTAS, ID_ENTREVISTA, LETRAS } from './db.js';
import { exigeLogin, exigeAdmin, ehAdmin } from './auth.js';
import * as jogo from './jogo.js';

const { erro, inteiro } = jogo;
const texto = (v) => (typeof v === 'string' ? v.trim() : '');
const vazio = (v) => v == null || v === '';
// A27: busca que ignora acentos e maiúsculas, inclusive acentuadas — mesma normalização do filtro da tela
// /admin/perguntas. Feita aqui, e não no SQL: o Turso não aceita função própria (a antiga sem_acento()).
const semAcento = (s) => String(s).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const contem = (q, ...campos) => campos.some((c) => c != null && semAcento(c).includes(q));

// Busca uma linha ou responde 404
async function achar(sql, id, mensagem) {
  const linha = await db.get(sql, id);
  if (!linha) throw erro(404, mensagem);
  return linha;
}

export const api = Router();

// ---------- Públicas (telão / DataShow) ----------
api.get('/tabuleiro', async (req, res) => {
  const casas = await db.all(`SELECT c.*, k.nome AS categoria, k.cor_hex FROM TB_CASA c
                              LEFT JOIN TB_CATEGORIA k USING (id_categoria) ORDER BY numero`);
  res.json({ imagem: '/img/tabuleiro.png', largura: 1078, altura: 948, casa_chegada: jogo.CASA_CHEGADA, casas, rotas: ROTAS });
});
api.get('/publico/partidas/:codigo', async (req, res) => res.json(await jogo.estadoPublico(req.params.codigo)));

api.use(exigeLogin); // RNF04: daqui para baixo, só logado

// ---------- RF02 — Escolas ----------
api.get('/escolas', async (req, res) => {
  res.json(await db.all(`SELECT e.id_escola, e.nome, e.cidade,
    (SELECT COUNT(*) FROM TB_JOGADOR j WHERE j.id_escola = e.id_escola) AS total_jogadores
    FROM TB_ESCOLA e ORDER BY e.nome`));
});

// Obrigatórios + "sem repetição" ignorando maiúsculas (inclusive acentuadas, que o NOCASE do SQLite não cobre)
async function dadosEscola(body, id) {
  const nome = texto(body?.nome), cidade = texto(body?.cidade);
  if (!nome || !cidade) throw erro(400, 'Informe o nome da escola e a cidade.');
  const repetida = (await db.all('SELECT id_escola, nome FROM TB_ESCOLA'))
    .some((e) => e.id_escola !== id && e.nome.toLowerCase() === nome.toLowerCase());
  if (repetida) throw erro(409, 'Já existe uma escola com esse nome.');
  return [nome, cidade];
}

api.post('/escolas', exigeAdmin, async (req, res) => {
  const [nome, cidade] = await dadosEscola(req.body);
  const { lastInsertRowid } = await db.run('INSERT INTO TB_ESCOLA (nome, cidade) VALUES (?, ?)', nome, cidade);
  res.status(201).json({ id_escola: lastInsertRowid, nome, cidade });
});

api.put('/escolas/:id', exigeAdmin, async (req, res) => {
  const { id_escola } = await achar('SELECT id_escola FROM TB_ESCOLA WHERE id_escola = ?', req.params.id, 'Escola não encontrada.');
  const [nome, cidade] = await dadosEscola(req.body, id_escola);
  await db.run('UPDATE TB_ESCOLA SET nome = ?, cidade = ? WHERE id_escola = ?', nome, cidade, id_escola);
  res.json({ id_escola, nome, cidade });
});

api.delete('/escolas/:id', exigeAdmin, async (req, res) => {
  const { id_escola } = await achar('SELECT id_escola FROM TB_ESCOLA WHERE id_escola = ?', req.params.id, 'Escola não encontrada.');
  if (await db.get('SELECT 1 FROM TB_JOGADOR WHERE id_escola = ?', id_escola)) {
    throw erro(409, 'Não é possível excluir: há jogadores cadastrados nesta escola.');
  }
  await db.run('DELETE FROM TB_ESCOLA WHERE id_escola = ?', id_escola);
  res.status(204).end();
});

// ---------- RF01 — Jogadores ----------
const SQL_JOGADOR = `SELECT j.id_jogador, j.nome, j.apelido, j.email, j.id_escola, e.nome AS escola, j.criado_em,
  EXISTS (SELECT 1 FROM TB_JOGADOR_PARTIDA jp JOIN TB_PARTIDA p ON p.id_partida = jp.id_partida
          WHERE jp.id_jogador = j.id_jogador AND jp.ativo = 1 AND p.status <> 'Finalizada') AS em_partida
  FROM TB_JOGADOR j JOIN TB_ESCOLA e ON e.id_escola = j.id_escola`;
const jogadorApi = (j) => ({ ...j, em_partida: Boolean(j.em_partida) });

// q ignora acentos e maiúsculas (A27). Sem o e-mail dos visitantes na listagem (A44, RNF04): nenhuma tela o usa.
// ponytail: lê todos os jogadores a cada busca (o evento tem ~300); com dezenas de milhares, gravar o nome já normalizado
api.get('/jogadores', async (req, res) => {
  const q = semAcento(texto(req.query.q));
  const todos = await db.all(`${SQL_JOGADOR} ORDER BY j.criado_em DESC, j.id_jogador DESC`);
  res.json(todos.filter((j) => contem(q, j.nome, j.apelido, j.escola)).slice(0, 300).map(({ email, ...j }) => jogadorApi(j)));
});

api.post('/jogadores', async (req, res) => {
  const b = req.body ?? {};
  const nome = texto(b.nome), apelido = texto(b.apelido) || null, email = texto(b.email) || null;
  if (!nome) throw erro(400, 'O nome completo é obrigatório.');
  if (vazio(b.id_escola)) throw erro(400, 'Selecione a escola de origem.');
  // RF01 "com o @" (formato x@y, igual ao front — A2). Até 254 caracteres (RFC 5321), conferido antes da regex (A41).
  if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+$/.test(email))) throw erro(400, 'E-mail inválido.');
  const escola = await db.get('SELECT id_escola FROM TB_ESCOLA WHERE id_escola = ?', inteiro(b.id_escola));
  if (!escola) throw erro(400, 'Escola não encontrada.');
  const { lastInsertRowid } = await db.run('INSERT INTO TB_JOGADOR (nome, apelido, email, id_escola) VALUES (?, ?, ?, ?)',
    nome, apelido, email, escola.id_escola);
  res.status(201).json(jogadorApi(await db.get(`${SQL_JOGADOR} WHERE j.id_jogador = ?`, lastInsertRowid)));
});

// ---------- RF10 — Categorias e perguntas ----------
api.get('/categorias', async (req, res) => {
  res.json(await db.all(`SELECT c.id_categoria, c.nome, c.cor, c.cor_hex, c.mecanica,
    (SELECT COUNT(*) FROM TB_PERGUNTA p WHERE p.id_categoria = c.id_categoria) AS total_perguntas
    FROM TB_CATEGORIA c ORDER BY c.id_categoria`));
});

const SQL_PERGUNTA = `SELECT p.id_pergunta, p.enunciado, p.resposta, p.id_categoria, c.nome AS categoria, c.cor_hex, c.mecanica, p.dificuldade,
  (SELECT MAX(a.pontos) FROM TB_ALTERNATIVA a WHERE a.id_pergunta = p.id_pergunta) AS pontos,
  (SELECT COUNT(*) FROM TB_JOGADA j WHERE j.id_pergunta = p.id_pergunta) AS vezes_sorteada
  FROM TB_PERGUNTA p JOIN TB_CATEGORIA c ON c.id_categoria = p.id_categoria`;
const perguntaPorId = async (id) => ({
  ...(await db.get(`${SQL_PERGUNTA} WHERE p.id_pergunta = ?`, id)),
  alternativas: await db.all('SELECT letra, texto, pontos FROM TB_ALTERNATIVA WHERE id_pergunta = ? ORDER BY letra', id),
});

api.get('/perguntas', exigeAdmin, async (req, res) => {
  const q = semAcento(texto(req.query.q)), cat = inteiro(req.query.categoria) || null;
  const perguntas = (await db.all(`${SQL_PERGUNTA} WHERE (? IS NULL OR p.id_categoria = ?)
    ORDER BY p.id_categoria, p.id_pergunta`, cat, cat)).filter((p) => contem(q, p.enunciado, p.resposta)); // A27
  // As alternativas de todas numa consulta só (com o Turso, uma por pergunta seria uma ida ao banco para cada)
  const alternativas = Map.groupBy(await db.all('SELECT id_pergunta, letra, texto, pontos FROM TB_ALTERNATIVA ORDER BY letra'), (a) => a.id_pergunta);
  res.json(perguntas.map((p) => ({ ...p, alternativas: (alternativas.get(p.id_pergunta) ?? []).map(({ letra, texto, pontos }) => ({ letra, texto, pontos })) })));
});

// Enunciado, explicação, categoria e as 4 alternativas são obrigatórios; dificuldade opcional (padrão: valor atual ou Médio).
// Os pontos vêm da dificuldade (alternativa correta) ou, na Entrevista, da nota de cada alternativa.
async function dadosPergunta(b = {}, atual = { dificuldade: 'Médio' }) {
  const enunciado = texto(b.enunciado), resposta = texto(b.resposta);
  const categoria = await db.get('SELECT id_categoria FROM TB_CATEGORIA WHERE id_categoria = ?', inteiro(b.id_categoria));
  if (!enunciado || !resposta || !categoria) throw erro(400, 'Preencha o enunciado, a explicação e a categoria.');
  const dificuldade = texto(b.dificuldade) || atual.dificuldade;
  if (!['Fácil', 'Médio', 'Difícil'].includes(dificuldade)) throw erro(400, 'Dificuldade inválida: use Fácil, Médio ou Difícil.');
  const alternativas = Array.isArray(b.alternativas) ? b.alternativas.map(texto) : [];
  if (alternativas.length !== 4 || alternativas.some((a) => !a)) throw erro(400, 'Preencha as quatro alternativas (A, B, C e D).');
  const dados = { enunciado, resposta, id_categoria: categoria.id_categoria, dificuldade, alternativas };
  if (categoria.id_categoria !== ID_ENTREVISTA) {
    if (!LETRAS.includes(b.correta)) throw erro(400, 'Indique a alternativa correta (A, B, C ou D).');
    return { ...dados, correta: b.correta };
  }
  const notas = Array.isArray(b.notas) ? b.notas.map(inteiro) : [];
  if (notas.length !== 4 || notas.some((n) => ![0, 5, 10, 15].includes(n)) || !notas.some((n) => n > 0)) {
    throw erro(400, 'Na Entrevista, cada alternativa vale 15, 10, 5 ou 0 pontos, com pelo menos uma acima de zero.');
  }
  return { ...dados, notas };
}

api.post('/perguntas', exigeAdmin, async (req, res) => {
  const d = await dadosPergunta(req.body);
  const id = await transacao(async () => { // nunca fica pergunta com menos de 4 alternativas
    const { lastInsertRowid } = await db.run('INSERT INTO TB_PERGUNTA (enunciado, resposta, id_categoria, dificuldade) VALUES (?, ?, ?, ?)',
      d.enunciado, d.resposta, d.id_categoria, d.dificuldade);
    await gravarAlternativas(lastInsertRowid, d);
    return lastInsertRowid;
  });
  res.status(201).json(await perguntaPorId(id));
});

// "Edição em tempo real": vale já para o próximo sorteio. A pergunta na tela de um jogador fica como está:
// a letra que ele tocar não pode passar a valer para outro texto.
api.put('/perguntas/:id', exigeAdmin, async (req, res) => {
  const atual = await achar('SELECT * FROM TB_PERGUNTA WHERE id_pergunta = ?', req.params.id, 'Pergunta não encontrada.');
  const d = await dadosPergunta(req.body, atual);
  if (await db.get('SELECT 1 FROM TB_JOGADA WHERE id_pergunta = ? AND concluida = 0', atual.id_pergunta)) {
    throw erro(409, 'Esta pergunta está em jogo agora: salve depois que a jogada terminar.');
  }
  await transacao(async () => {
    await db.run('UPDATE TB_PERGUNTA SET enunciado = ?, resposta = ?, id_categoria = ?, dificuldade = ? WHERE id_pergunta = ?',
      d.enunciado, d.resposta, d.id_categoria, d.dificuldade, atual.id_pergunta);
    await gravarAlternativas(atual.id_pergunta, d);
  });
  res.json(await perguntaPorId(atual.id_pergunta));
});

// O histórico fica: TB_JOGADA.id_pergunta vira NULL e as alternativas saem junto. É o ON DELETE do schema, feito
// aqui também porque o Turso não confere as chaves estrangeiras (db.js).
api.delete('/perguntas/:id', exigeAdmin, async (req, res) => {
  const { id_pergunta } = await achar('SELECT id_pergunta FROM TB_PERGUNTA WHERE id_pergunta = ?', req.params.id, 'Pergunta não encontrada.');
  await db.lote([
    { sql: 'UPDATE TB_JOGADA SET id_pergunta = NULL WHERE id_pergunta = ?', args: [id_pergunta] },
    { sql: 'DELETE FROM TB_ALTERNATIVA WHERE id_pergunta = ?', args: [id_pergunta] },
    { sql: 'DELETE FROM TB_PERGUNTA WHERE id_pergunta = ?', args: [id_pergunta] },
  ]);
  res.status(204).end();
});

// ---------- RF08/RF09 — Brindes ----------
const SQL_BRINDE = `SELECT b.id_brinde, b.nome, b.cargo, b.pontos_minimos, b.quantidade_estoque,
  (SELECT COUNT(*) FROM TB_ENTREGA_BRINDE e WHERE e.id_brinde = b.id_brinde) AS entregues FROM TB_BRINDE b`;

api.get('/brindes', async (req, res) => res.json(await db.all(`${SQL_BRINDE} ORDER BY b.pontos_minimos`)));

// "Gerencia estoque de brindes": campos ausentes ficam como estão
api.put('/brindes/:id', exigeAdmin, async (req, res) => {
  const atual = await achar('SELECT * FROM TB_BRINDE WHERE id_brinde = ?', req.params.id, 'Brinde não encontrado.');
  const b = req.body ?? {};
  const nome = b.nome == null ? atual.nome : texto(b.nome);
  const cargo = b.cargo == null ? atual.cargo : texto(b.cargo);
  const minimo = b.pontos_minimos == null ? atual.pontos_minimos : inteiro(b.pontos_minimos);
  const qtd = b.quantidade_estoque == null ? atual.quantidade_estoque : inteiro(b.quantidade_estoque);
  if (!nome || !cargo) throw erro(400, 'Informe o nome do brinde e o cargo.');
  if (!(minimo >= 0 && qtd >= 0)) throw erro(400, 'Os pontos mínimos e a quantidade em estoque devem ser números inteiros maiores ou iguais a zero.');
  if (await db.get('SELECT 1 FROM TB_BRINDE WHERE nome = ? AND id_brinde <> ?', nome, atual.id_brinde)) {
    throw erro(409, 'Já existe um brinde com esse nome.');
  }
  // A24: com duas faixas nos mesmos pontos, só uma seria entregue (§4.11). Conferido só quando o valor vem no corpo,
  // para um empate antigo não travar o +10/+50 do estoque.
  if (b.pontos_minimos != null && await db.get('SELECT 1 FROM TB_BRINDE WHERE pontos_minimos = ? AND id_brinde <> ?', minimo, atual.id_brinde)) {
    throw erro(409, 'Já existe um brinde com esses pontos mínimos.');
  }
  await db.run('UPDATE TB_BRINDE SET nome = ?, cargo = ?, pontos_minimos = ?, quantidade_estoque = ? WHERE id_brinde = ?', nome, cargo, minimo, qtd, atual.id_brinde);
  res.json(await db.get(`${SQL_BRINDE} WHERE b.id_brinde = ?`, atual.id_brinde));
});

// ---------- RF03–RF09 — Partidas (regras em jogo.js) ----------
const SQL_PARTIDA = `SELECT p.id_partida, p.status, p.codigo_online, p.iniciada_em, p.finalizada_em, u.nome AS mediador
  FROM TB_PARTIDA p JOIN TB_USUARIO u ON u.id_usuario = p.id_mediador`;
const jogadoresAtivos = async (idPartida) => (await db.all(`SELECT j.id_jogador, j.nome, jp.peao, jp.rota, jp.casa_atual, jp.pontuacao, jp.eliminado
  FROM TB_JOGADOR_PARTIDA jp JOIN TB_JOGADOR j ON j.id_jogador = jp.id_jogador
  WHERE jp.id_partida = ? AND jp.ativo = 1 ORDER BY jp.ordem`, idPartida)).map((j) => ({ ...j, eliminado: Boolean(j.eliminado) }));

// RNF06 "Partida em Andamento": ?status=Em Andamento,Pausada,Premiação
api.get('/partidas', async (req, res) => {
  const status = texto(req.query.status).split(',').map((s) => s.trim()).filter(Boolean);
  const filtro = status.length ? `WHERE p.status IN (${status.map(() => '?').join(', ')})` : '';
  const partidas = await db.all(`${SQL_PARTIDA} ${filtro} ORDER BY p.id_partida DESC LIMIT 100`, ...status);
  res.json(await Promise.all(partidas.map(async (p) => ({ ...p, jogadores: await jogadoresAtivos(p.id_partida) }))));
});

api.post('/partidas', async (req, res) => res.status(201).json(await jogo.criarPartida(req.usuario, req.body?.jogadores)));
api.get('/partidas/:id', async (req, res) => res.json(await jogo.estado(req.params.id)));
api.get('/certificados', async (req, res) => res.json(await jogo.certificados()));
api.get('/partidas/:id/certificados/:id_jogador', async (req, res) =>
  res.json(await jogo.certificado(req.params.id, req.params.id_jogador, ehAdmin(req))));
// A23: id_jogador (dado) e id_jogada (sortear, pular, resposta) opcionais = o que a tela exibia; divergente → 409
api.post('/partidas/:id/dado', async (req, res) => res.json(await jogo.lancarDado(req.params.id, req.body?.id_jogador)));
api.post('/partidas/:id/sortear', async (req, res) => {
  try {
    res.json(await jogo.sortear(req.params.id, req.body?.id_jogada));
  } catch (e) {
    if (!e.sem_perguntas) throw e;
    res.status(409).json({ erro: e.message, sem_perguntas: true }); // RF06: categoria esgotada → "Passar a vez"
  }
});
api.post('/partidas/:id/pular', async (req, res) => res.json(await jogo.pular(req.params.id, req.body?.id_jogada)));
api.post('/partidas/:id/resposta', async (req, res) => res.json(await jogo.responder(req.params.id, req.body?.alternativa, req.body?.id_jogada)));
api.post('/partidas/:id/pausar', async (req, res) => res.json(await jogo.pausar(req.params.id)));
api.post('/partidas/:id/retomar', async (req, res) => res.json(await jogo.retomar(req.params.id)));
api.post('/partidas/:id/encerrar', async (req, res) => res.json(await jogo.encerrar(req.params.id)));
api.post('/partidas/:id/entregas', async (req, res) => res.json(await jogo.entregarBrinde(req.params.id, req.body?.id_jogador, req.usuario)));
api.put('/partidas/:id/jogadores/:id_jogador/casa', exigeAdmin, async (req, res) =>
  res.json(await jogo.moverPeao(req.params.id, req.params.id_jogador, req.body?.casa)));
api.delete('/partidas/:id/jogadores/:id_jogador', exigeAdmin, async (req, res) =>
  res.json(await jogo.removerJogador(req.params.id, req.params.id_jogador)));

// ---------- Relatórios (admin): participação das escolas, desempenho por categoria (e por jogador), ranking ----------
// erros e % de acerto (0–100) a partir de respondidas e acertos
const desempenho = (c) => ({
  ...c,
  erros: c.respondidas - c.acertos,
  percentual_acerto: c.respondidas ? Math.round((100 * c.acertos) / c.respondidas) : 0,
});

api.get('/relatorios', exigeAdmin, async (req, res) => {
  const resumo = await db.get(`SELECT
    (SELECT COUNT(*) FROM TB_PARTIDA) AS partidas,
    (SELECT COUNT(*) FROM TB_PARTIDA WHERE status = 'Finalizada') AS partidas_finalizadas,
    (SELECT COUNT(*) FROM TB_JOGADOR) AS jogadores,
    (SELECT COUNT(*) FROM TB_ESCOLA) AS escolas,
    (SELECT COUNT(*) FROM TB_PERGUNTA) AS perguntas,
    (SELECT COUNT(*) FROM TB_JOGADA) AS jogadas,
    (SELECT COUNT(*) FROM TB_JOGADA WHERE acertou = 1) AS acertos,
    (SELECT COUNT(*) FROM TB_JOGADA WHERE acertou = 0) AS erros,
    (SELECT COUNT(*) FROM TB_ENTREGA_BRINDE) AS brindes_entregues`);
  const por_escola = await db.all(`SELECT e.id_escola, e.nome AS escola, e.cidade,
    (SELECT COUNT(*) FROM TB_JOGADOR x WHERE x.id_escola = e.id_escola) AS jogadores,
    COUNT(DISTINCT jp.id_partida) AS partidas, COALESCE(SUM(jp.pontuacao), 0) AS pontos
    FROM TB_ESCOLA e LEFT JOIN TB_JOGADOR j ON j.id_escola = e.id_escola LEFT JOIN TB_JOGADOR_PARTIDA jp ON jp.id_jogador = j.id_jogador
    GROUP BY e.id_escola ORDER BY jogadores DESC, e.nome`);
  const por_categoria = (await db.all(`SELECT c.id_categoria, c.nome AS categoria, c.cor_hex,
    (SELECT COUNT(*) FROM TB_PERGUNTA p WHERE p.id_categoria = c.id_categoria) AS perguntas,
    COUNT(jg.acertou) AS respondidas, COALESCE(SUM(jg.acertou), 0) AS acertos
    FROM TB_CATEGORIA c LEFT JOIN TB_JOGADA jg ON jg.id_categoria = c.id_categoria
    GROUP BY c.id_categoria ORDER BY c.id_categoria`)).map(desempenho);
  // A18 — Relatorio_Categoria do DER pertence a um Jogador (1,1): desempenho de cada jogador em cada categoria
  const por_jogador_categoria = (await db.all(`SELECT jg.id_jogador, j.nome, j.apelido, c.id_categoria, c.nome AS categoria, c.cor_hex,
    COUNT(*) AS respondidas, SUM(jg.acertou) AS acertos
    FROM TB_JOGADA jg JOIN TB_JOGADOR j ON j.id_jogador = jg.id_jogador JOIN TB_CATEGORIA c ON c.id_categoria = jg.id_categoria
    WHERE jg.acertou IS NOT NULL
    GROUP BY jg.id_jogador, c.id_categoria ORDER BY j.nome, jg.id_jogador, c.id_categoria`)).map(desempenho);
  const ranking = await Promise.all((await db.all(`SELECT j.id_jogador, j.nome, j.apelido, e.nome AS escola,
    SUM(jp.pontuacao) AS pontos, COUNT(*) AS partidas, MAX(CASE WHEN jp.ativo = 1 THEN jp.pontuacao END) AS melhor_partida
    FROM TB_JOGADOR_PARTIDA jp JOIN TB_JOGADOR j ON j.id_jogador = jp.id_jogador JOIN TB_ESCOLA e ON e.id_escola = j.id_escola
    GROUP BY j.id_jogador ORDER BY pontos DESC, melhor_partida DESC, j.nome LIMIT 20`))
    .map(async ({ melhor_partida, ...j }) => ({ ...j, melhor_cargo: (await jogo.brindeDaPontuacao(melhor_partida))?.cargo ?? null })));
  const brindes = await db.all(`${SQL_BRINDE} ORDER BY b.pontos_minimos`);
  const partidas = await Promise.all((await db.all(`${SQL_PARTIDA} ORDER BY p.id_partida DESC LIMIT 50`)).map(async (p) => {
    const js = await jogadoresAtivos(p.id_partida);
    const vencedor = js.toSorted((a, b) => b.pontuacao - a.pontuacao || jogo.faltam(a) - jogo.faltam(b))[0]; // desempate: mais perto do Chegou!
    return { ...p, jogadores: js.map((j) => j.nome).join(', '), vencedor: vencedor?.nome ?? null };
  }));
  res.json({ resumo, por_escola, por_categoria, por_jogador_categoria, ranking, brindes, partidas });
});
