// API REST (docs/ESPECIFICACAO-TECNICA.md §5). Login/logout/me ficam em auth.js; as regras da partida, em jogo.js.
import { Router } from 'express';
import { db, transacao, gravarAlternativas, ROTAS, ID_ENTREVISTA, LETRAS } from './db.js';
import { exigeLogin, exigeAdmin, ehAdmin } from './auth.js';
import * as jogo from './jogo.js';

const { erro, inteiro } = jogo;
const texto = (v) => (typeof v === 'string' ? v.trim() : '');
const vazio = (v) => v == null || v === '';

// Busca uma linha ou responde 404
function achar(sql, id, mensagem) {
  const linha = db.prepare(sql).get(id);
  if (!linha) throw erro(404, mensagem);
  return linha;
}

export const api = Router();

// ---------- Públicas (telão / DataShow) ----------
api.get('/tabuleiro', (req, res) => {
  const casas = db.prepare(`SELECT c.*, k.nome AS categoria, k.cor_hex FROM TB_CASA c
                            LEFT JOIN TB_CATEGORIA k USING (id_categoria) ORDER BY numero`).all();
  res.json({ imagem: '/img/tabuleiro.png', largura: 1078, altura: 948, casa_chegada: jogo.CASA_CHEGADA, casas, rotas: ROTAS });
});
api.get('/publico/partidas/:codigo', (req, res) => res.json(jogo.estadoPublico(req.params.codigo)));

api.use(exigeLogin); // RNF04: daqui para baixo, só logado

// ---------- RF02 — Escolas ----------
api.get('/escolas', (req, res) => {
  res.json(db.prepare(`SELECT e.id_escola, e.nome, e.cidade,
    (SELECT COUNT(*) FROM TB_JOGADOR j WHERE j.id_escola = e.id_escola) AS total_jogadores
    FROM TB_ESCOLA e ORDER BY e.nome`).all());
});

// Obrigatórios + "sem repetição" ignorando maiúsculas (inclusive acentuadas, que o NOCASE do SQLite não cobre)
function dadosEscola(body, id) {
  const nome = texto(body?.nome), cidade = texto(body?.cidade);
  if (!nome || !cidade) throw erro(400, 'Informe o nome da escola e a cidade.');
  const repetida = db.prepare('SELECT id_escola, nome FROM TB_ESCOLA').all()
    .some((e) => e.id_escola !== id && e.nome.toLowerCase() === nome.toLowerCase());
  if (repetida) throw erro(409, 'Já existe uma escola com esse nome.');
  return [nome, cidade];
}

api.post('/escolas', exigeAdmin, (req, res) => {
  const [nome, cidade] = dadosEscola(req.body);
  const { lastInsertRowid } = db.prepare('INSERT INTO TB_ESCOLA (nome, cidade) VALUES (?, ?)').run(nome, cidade);
  res.status(201).json({ id_escola: lastInsertRowid, nome, cidade });
});

api.put('/escolas/:id', exigeAdmin, (req, res) => {
  const { id_escola } = achar('SELECT id_escola FROM TB_ESCOLA WHERE id_escola = ?', req.params.id, 'Escola não encontrada.');
  const [nome, cidade] = dadosEscola(req.body, id_escola);
  db.prepare('UPDATE TB_ESCOLA SET nome = ?, cidade = ? WHERE id_escola = ?').run(nome, cidade, id_escola);
  res.json({ id_escola, nome, cidade });
});

api.delete('/escolas/:id', exigeAdmin, (req, res) => {
  const { id_escola } = achar('SELECT id_escola FROM TB_ESCOLA WHERE id_escola = ?', req.params.id, 'Escola não encontrada.');
  if (db.prepare('SELECT 1 FROM TB_JOGADOR WHERE id_escola = ?').get(id_escola)) {
    throw erro(409, 'Não é possível excluir: há jogadores cadastrados nesta escola.');
  }
  db.prepare('DELETE FROM TB_ESCOLA WHERE id_escola = ?').run(id_escola);
  res.status(204).end();
});

// ---------- RF01 — Jogadores ----------
const SQL_JOGADOR = `SELECT j.id_jogador, j.nome, j.apelido, j.email, j.id_escola, e.nome AS escola, j.criado_em,
  EXISTS (SELECT 1 FROM TB_JOGADOR_PARTIDA jp JOIN TB_PARTIDA p ON p.id_partida = jp.id_partida
          WHERE jp.id_jogador = j.id_jogador AND jp.ativo = 1 AND p.status <> 'Finalizada') AS em_partida
  FROM TB_JOGADOR j JOIN TB_ESCOLA e ON e.id_escola = j.id_escola`;
const jogadorApi = (j) => ({ ...j, em_partida: Boolean(j.em_partida) });

// q ignora acentos e maiúsculas (A27). Sem o e-mail dos visitantes na listagem (A44, RNF04): nenhuma tela o usa.
api.get('/jogadores', (req, res) => {
  const q = `%${texto(req.query.q)}%`;
  res.json(db.prepare(`${SQL_JOGADOR}
    WHERE sem_acento(j.nome) LIKE sem_acento(?) OR sem_acento(j.apelido) LIKE sem_acento(?) OR sem_acento(e.nome) LIKE sem_acento(?)
    ORDER BY j.criado_em DESC, j.id_jogador DESC LIMIT 300`).all(q, q, q).map(({ email, ...j }) => jogadorApi(j)));
});

api.post('/jogadores', (req, res) => {
  const b = req.body ?? {};
  const nome = texto(b.nome), apelido = texto(b.apelido) || null, email = texto(b.email) || null;
  if (!nome) throw erro(400, 'O nome completo é obrigatório.');
  if (vazio(b.id_escola)) throw erro(400, 'Selecione a escola de origem.');
  // RF01 "com o @" (formato x@y, igual ao front — A2). Até 254 caracteres (RFC 5321), conferido antes da regex (A41).
  if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+$/.test(email))) throw erro(400, 'E-mail inválido.');
  const escola = db.prepare('SELECT id_escola FROM TB_ESCOLA WHERE id_escola = ?').get(inteiro(b.id_escola));
  if (!escola) throw erro(400, 'Escola não encontrada.');
  const { lastInsertRowid } = db.prepare('INSERT INTO TB_JOGADOR (nome, apelido, email, id_escola) VALUES (?, ?, ?, ?)')
    .run(nome, apelido, email, escola.id_escola);
  res.status(201).json(jogadorApi(db.prepare(`${SQL_JOGADOR} WHERE j.id_jogador = ?`).get(lastInsertRowid)));
});

// ---------- RF10 — Categorias e perguntas ----------
api.get('/categorias', (req, res) => {
  res.json(db.prepare(`SELECT c.id_categoria, c.nome, c.cor, c.cor_hex, c.mecanica,
    (SELECT COUNT(*) FROM TB_PERGUNTA p WHERE p.id_categoria = c.id_categoria) AS total_perguntas
    FROM TB_CATEGORIA c ORDER BY c.id_categoria`).all());
});

const SQL_PERGUNTA = `SELECT p.id_pergunta, p.enunciado, p.resposta, p.id_categoria, c.nome AS categoria, c.cor_hex, c.mecanica, p.dificuldade,
  (SELECT MAX(a.pontos) FROM TB_ALTERNATIVA a WHERE a.id_pergunta = p.id_pergunta) AS pontos,
  (SELECT COUNT(*) FROM TB_JOGADA j WHERE j.id_pergunta = p.id_pergunta) AS vezes_sorteada
  FROM TB_PERGUNTA p JOIN TB_CATEGORIA c ON c.id_categoria = p.id_categoria`;
const comAlternativas = (p) => ({
  ...p,
  alternativas: db.prepare('SELECT letra, texto, pontos FROM TB_ALTERNATIVA WHERE id_pergunta = ? ORDER BY letra').all(p.id_pergunta),
});
const perguntaPorId = (id) => comAlternativas(db.prepare(`${SQL_PERGUNTA} WHERE p.id_pergunta = ?`).get(id));

api.get('/perguntas', exigeAdmin, (req, res) => {
  const q = `%${texto(req.query.q)}%`, cat = inteiro(req.query.categoria) || null;
  res.json(db.prepare(`${SQL_PERGUNTA} WHERE (? IS NULL OR p.id_categoria = ?) -- q ignora acentos e maiúsculas (A27)
    AND (sem_acento(p.enunciado) LIKE sem_acento(?) OR sem_acento(p.resposta) LIKE sem_acento(?))
    ORDER BY p.id_categoria, p.id_pergunta`).all(cat, cat, q, q).map(comAlternativas));
});

// Enunciado, explicação, categoria e as 4 alternativas são obrigatórios; dificuldade opcional (padrão: valor atual ou Médio).
// Os pontos vêm da dificuldade (alternativa correta) ou, na Entrevista, da nota de cada alternativa.
function dadosPergunta(b = {}, atual = { dificuldade: 'Médio' }) {
  const enunciado = texto(b.enunciado), resposta = texto(b.resposta);
  const categoria = db.prepare('SELECT id_categoria FROM TB_CATEGORIA WHERE id_categoria = ?').get(inteiro(b.id_categoria));
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

api.post('/perguntas', exigeAdmin, (req, res) => {
  const d = dadosPergunta(req.body);
  const id = transacao(() => { // nunca fica pergunta com menos de 4 alternativas
    const { lastInsertRowid } = db.prepare('INSERT INTO TB_PERGUNTA (enunciado, resposta, id_categoria, dificuldade) VALUES (?, ?, ?, ?)')
      .run(d.enunciado, d.resposta, d.id_categoria, d.dificuldade);
    gravarAlternativas(lastInsertRowid, d);
    return lastInsertRowid;
  });
  res.status(201).json(perguntaPorId(id));
});

// "Edição em tempo real": vale já para o próximo sorteio. A pergunta na tela de um jogador fica como está:
// a letra que ele tocar não pode passar a valer para outro texto.
api.put('/perguntas/:id', exigeAdmin, (req, res) => {
  const atual = achar('SELECT * FROM TB_PERGUNTA WHERE id_pergunta = ?', req.params.id, 'Pergunta não encontrada.');
  const d = dadosPergunta(req.body, atual);
  if (db.prepare('SELECT 1 FROM TB_JOGADA WHERE id_pergunta = ? AND concluida = 0').get(atual.id_pergunta)) {
    throw erro(409, 'Esta pergunta está em jogo agora: salve depois que a jogada terminar.');
  }
  transacao(() => {
    db.prepare('UPDATE TB_PERGUNTA SET enunciado = ?, resposta = ?, id_categoria = ?, dificuldade = ? WHERE id_pergunta = ?')
      .run(d.enunciado, d.resposta, d.id_categoria, d.dificuldade, atual.id_pergunta);
    gravarAlternativas(atual.id_pergunta, d);
  });
  res.json(perguntaPorId(atual.id_pergunta));
});

// O histórico fica: TB_JOGADA.id_pergunta vira NULL (ON DELETE SET NULL)
api.delete('/perguntas/:id', exigeAdmin, (req, res) => {
  const { id_pergunta } = achar('SELECT id_pergunta FROM TB_PERGUNTA WHERE id_pergunta = ?', req.params.id, 'Pergunta não encontrada.');
  db.prepare('DELETE FROM TB_PERGUNTA WHERE id_pergunta = ?').run(id_pergunta);
  res.status(204).end();
});

// ---------- RF08/RF09 — Brindes ----------
const SQL_BRINDE = `SELECT b.id_brinde, b.nome, b.cargo, b.pontos_minimos, b.quantidade_estoque,
  (SELECT COUNT(*) FROM TB_ENTREGA_BRINDE e WHERE e.id_brinde = b.id_brinde) AS entregues FROM TB_BRINDE b`;

api.get('/brindes', (req, res) => res.json(db.prepare(`${SQL_BRINDE} ORDER BY b.pontos_minimos`).all()));

// "Gerencia estoque de brindes": campos ausentes ficam como estão
api.put('/brindes/:id', exigeAdmin, (req, res) => {
  const atual = achar('SELECT * FROM TB_BRINDE WHERE id_brinde = ?', req.params.id, 'Brinde não encontrado.');
  const b = req.body ?? {};
  const nome = b.nome == null ? atual.nome : texto(b.nome);
  const cargo = b.cargo == null ? atual.cargo : texto(b.cargo);
  const minimo = b.pontos_minimos == null ? atual.pontos_minimos : inteiro(b.pontos_minimos);
  const qtd = b.quantidade_estoque == null ? atual.quantidade_estoque : inteiro(b.quantidade_estoque);
  if (!nome || !cargo) throw erro(400, 'Informe o nome do brinde e o cargo.');
  if (!(minimo >= 0 && qtd >= 0)) throw erro(400, 'Os pontos mínimos e a quantidade em estoque devem ser números inteiros maiores ou iguais a zero.');
  if (db.prepare('SELECT 1 FROM TB_BRINDE WHERE nome = ? AND id_brinde <> ?').get(nome, atual.id_brinde)) {
    throw erro(409, 'Já existe um brinde com esse nome.');
  }
  // A24: com duas faixas nos mesmos pontos, só uma seria entregue (§4.11). Conferido só quando o valor vem no corpo,
  // para um empate antigo não travar o +10/+50 do estoque.
  if (b.pontos_minimos != null && db.prepare('SELECT 1 FROM TB_BRINDE WHERE pontos_minimos = ? AND id_brinde <> ?').get(minimo, atual.id_brinde)) {
    throw erro(409, 'Já existe um brinde com esses pontos mínimos.');
  }
  db.prepare('UPDATE TB_BRINDE SET nome = ?, cargo = ?, pontos_minimos = ?, quantidade_estoque = ? WHERE id_brinde = ?').run(nome, cargo, minimo, qtd, atual.id_brinde);
  res.json(db.prepare(`${SQL_BRINDE} WHERE b.id_brinde = ?`).get(atual.id_brinde));
});

// ---------- RF03–RF09 — Partidas (regras em jogo.js) ----------
const SQL_PARTIDA = `SELECT p.id_partida, p.status, p.codigo_online, p.iniciada_em, p.finalizada_em, u.nome AS mediador
  FROM TB_PARTIDA p JOIN TB_USUARIO u ON u.id_usuario = p.id_mediador`;
const jogadoresAtivos = (idPartida) => db.prepare(`SELECT j.id_jogador, j.nome, jp.peao, jp.rota, jp.casa_atual, jp.pontuacao, jp.eliminado
  FROM TB_JOGADOR_PARTIDA jp JOIN TB_JOGADOR j ON j.id_jogador = jp.id_jogador
  WHERE jp.id_partida = ? AND jp.ativo = 1 ORDER BY jp.ordem`).all(idPartida).map((j) => ({ ...j, eliminado: Boolean(j.eliminado) }));

// RNF06 "Partida em Andamento": ?status=Em Andamento,Pausada,Premiação
api.get('/partidas', (req, res) => {
  const status = texto(req.query.status).split(',').map((s) => s.trim()).filter(Boolean);
  const filtro = status.length ? `WHERE p.status IN (${status.map(() => '?').join(', ')})` : '';
  const partidas = db.prepare(`${SQL_PARTIDA} ${filtro} ORDER BY p.id_partida DESC LIMIT 100`).all(...status);
  res.json(partidas.map((p) => ({ ...p, jogadores: jogadoresAtivos(p.id_partida) })));
});

api.post('/partidas', (req, res) => res.status(201).json(jogo.criarPartida(req.usuario, req.body?.jogadores)));
api.get('/partidas/:id', (req, res) => res.json(jogo.estado(req.params.id)));
api.get('/certificados', (req, res) => res.json(jogo.certificados()));
api.get('/partidas/:id/certificados/:id_jogador', (req, res) =>
  res.json(jogo.certificado(req.params.id, req.params.id_jogador, ehAdmin(req))));
// A23: id_jogador (dado) e id_jogada (sortear, pular, resposta) opcionais = o que a tela exibia; divergente → 409
api.post('/partidas/:id/dado', (req, res) => res.json(jogo.lancarDado(req.params.id, req.body?.id_jogador)));
api.post('/partidas/:id/sortear', (req, res) => {
  try {
    res.json(jogo.sortear(req.params.id, req.body?.id_jogada));
  } catch (e) {
    if (!e.sem_perguntas) throw e;
    res.status(409).json({ erro: e.message, sem_perguntas: true }); // RF06: categoria esgotada → "Passar a vez"
  }
});
api.post('/partidas/:id/pular', (req, res) => res.json(jogo.pular(req.params.id, req.body?.id_jogada)));
api.post('/partidas/:id/resposta', (req, res) => res.json(jogo.responder(req.params.id, req.body?.alternativa, req.body?.id_jogada)));
api.post('/partidas/:id/pausar', (req, res) => res.json(jogo.pausar(req.params.id)));
api.post('/partidas/:id/retomar', (req, res) => res.json(jogo.retomar(req.params.id)));
api.post('/partidas/:id/encerrar', (req, res) => res.json(jogo.encerrar(req.params.id)));
api.post('/partidas/:id/entregas', (req, res) => res.json(jogo.entregarBrinde(req.params.id, req.body?.id_jogador, req.usuario)));
api.put('/partidas/:id/jogadores/:id_jogador/casa', exigeAdmin, (req, res) =>
  res.json(jogo.moverPeao(req.params.id, req.params.id_jogador, req.body?.casa)));
api.delete('/partidas/:id/jogadores/:id_jogador', exigeAdmin, (req, res) =>
  res.json(jogo.removerJogador(req.params.id, req.params.id_jogador)));

// ---------- Relatórios (admin): participação das escolas, desempenho por categoria (e por jogador), ranking ----------
// erros e % de acerto (0–100) a partir de respondidas e acertos
const desempenho = (c) => ({
  ...c,
  erros: c.respondidas - c.acertos,
  percentual_acerto: c.respondidas ? Math.round((100 * c.acertos) / c.respondidas) : 0,
});

api.get('/relatorios', exigeAdmin, (req, res) => {
  const resumo = db.prepare(`SELECT
    (SELECT COUNT(*) FROM TB_PARTIDA) AS partidas,
    (SELECT COUNT(*) FROM TB_PARTIDA WHERE status = 'Finalizada') AS partidas_finalizadas,
    (SELECT COUNT(*) FROM TB_JOGADOR) AS jogadores,
    (SELECT COUNT(*) FROM TB_ESCOLA) AS escolas,
    (SELECT COUNT(*) FROM TB_PERGUNTA) AS perguntas,
    (SELECT COUNT(*) FROM TB_JOGADA) AS jogadas,
    (SELECT COUNT(*) FROM TB_JOGADA WHERE acertou = 1) AS acertos,
    (SELECT COUNT(*) FROM TB_JOGADA WHERE acertou = 0) AS erros,
    (SELECT COUNT(*) FROM TB_ENTREGA_BRINDE) AS brindes_entregues`).get();
  const por_escola = db.prepare(`SELECT e.id_escola, e.nome AS escola, e.cidade,
    (SELECT COUNT(*) FROM TB_JOGADOR x WHERE x.id_escola = e.id_escola) AS jogadores,
    COUNT(DISTINCT jp.id_partida) AS partidas, COALESCE(SUM(jp.pontuacao), 0) AS pontos
    FROM TB_ESCOLA e LEFT JOIN TB_JOGADOR j ON j.id_escola = e.id_escola LEFT JOIN TB_JOGADOR_PARTIDA jp ON jp.id_jogador = j.id_jogador
    GROUP BY e.id_escola ORDER BY jogadores DESC, e.nome`).all();
  const por_categoria = db.prepare(`SELECT c.id_categoria, c.nome AS categoria, c.cor_hex,
    (SELECT COUNT(*) FROM TB_PERGUNTA p WHERE p.id_categoria = c.id_categoria) AS perguntas,
    COUNT(jg.acertou) AS respondidas, COALESCE(SUM(jg.acertou), 0) AS acertos
    FROM TB_CATEGORIA c LEFT JOIN TB_JOGADA jg ON jg.id_categoria = c.id_categoria
    GROUP BY c.id_categoria ORDER BY c.id_categoria`).all().map(desempenho);
  // A18 — Relatorio_Categoria do DER pertence a um Jogador (1,1): desempenho de cada jogador em cada categoria
  const por_jogador_categoria = db.prepare(`SELECT jg.id_jogador, j.nome, j.apelido, c.id_categoria, c.nome AS categoria, c.cor_hex,
    COUNT(*) AS respondidas, SUM(jg.acertou) AS acertos
    FROM TB_JOGADA jg JOIN TB_JOGADOR j ON j.id_jogador = jg.id_jogador JOIN TB_CATEGORIA c ON c.id_categoria = jg.id_categoria
    WHERE jg.acertou IS NOT NULL
    GROUP BY jg.id_jogador, c.id_categoria ORDER BY j.nome, jg.id_jogador, c.id_categoria`).all().map(desempenho);
  const ranking = db.prepare(`SELECT j.id_jogador, j.nome, j.apelido, e.nome AS escola,
    SUM(jp.pontuacao) AS pontos, COUNT(*) AS partidas, MAX(CASE WHEN jp.ativo = 1 THEN jp.pontuacao END) AS melhor_partida
    FROM TB_JOGADOR_PARTIDA jp JOIN TB_JOGADOR j ON j.id_jogador = jp.id_jogador JOIN TB_ESCOLA e ON e.id_escola = j.id_escola
    GROUP BY j.id_jogador ORDER BY pontos DESC, melhor_partida DESC, j.nome LIMIT 20`).all()
    .map(({ melhor_partida, ...j }) => ({ ...j, melhor_cargo: jogo.brindeDaPontuacao(melhor_partida)?.cargo ?? null }));
  const brindes = db.prepare(`${SQL_BRINDE} ORDER BY b.pontos_minimos`).all();
  const partidas = db.prepare(`${SQL_PARTIDA} ORDER BY p.id_partida DESC LIMIT 50`).all().map((p) => {
    const js = jogadoresAtivos(p.id_partida);
    const vencedor = js.toSorted((a, b) => b.pontuacao - a.pontuacao || jogo.faltam(a) - jogo.faltam(b))[0]; // desempate: mais perto do Chegou!
    return { ...p, jogadores: js.map((j) => j.nome).join(', '), vencedor: vencedor?.nome ?? null };
  });
  res.json({ resumo, por_escola, por_categoria, por_jogador_categoria, ranking, brindes, partidas });
});
