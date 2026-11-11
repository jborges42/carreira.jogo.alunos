// Motor da partida — regras RF03–RF09 e RNF06 (docs/ESPECIFICACAO-TECNICA.md §4).
// Funções síncronas sobre o banco: cada ação roda numa transação e devolve o estado atualizado.
import { randomInt } from 'node:crypto';
import { db, transacao, ROTAS, ID_ENTREVISTA } from './db.js';

export const CASA_CHEGADA = db.prepare("SELECT numero FROM TB_CASA WHERE tipo = 'chegada'").get().numero; // 65 = Chegou!
const PEOES = ['verde', 'vermelho', 'azul', 'amarelo'];
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
// O dado é sempre sorteado aqui no servidor. Fica num objeto para os testes poderem fixar o resultado.
export const sorteio = { dado: () => randomInt(1, 7) };
const EM_JOGO = ['Em Andamento', 'Pausada'];

// 409 de ação fora de hora, conforme a etapa em que a partida está
const FORA_DE_HORA = {
  finalizada: 'A partida já foi finalizada.',
  premiacao: 'A partida já foi encerrada: confirme a entrega dos brindes.',
  pausada: 'A partida está pausada.',
  dado: 'Lance primeiro o dado.',
  sortear: 'Sorteie primeiro a pergunta desta jogada.',
  responder: 'Escolha primeiro uma das alternativas da pergunta.',
};

// doApp: só a mensagem destes erros (em português) sai para a tela; a das bibliotecas, não (A28, server.js)
export const erro = (status, mensagem) => Object.assign(new Error(mensagem), { status, doApp: true });
const agora = () => Math.floor(Date.now() / 1000);

// Inteiro vindo do JSON ou da URL (aceita "3"). O resto vira NaN: falha em toda comparação e vira NULL no SQLite.
// Só inteiros seguros (A22): acima de 2^53 o node:sqlite grava, mas toda leitura posterior falha (500).
export function inteiro(v) {
  const n = typeof v === 'string' && /^\s*-?\d+\s*$/.test(v) ? Number(v) : v;
  return Number.isSafeInteger(n) ? n : NaN;
}

// A23: a tela informa o que estava exibindo (jogador da vez / jogada pendente). Se a partida mudou em outra
// tela, a ação é recusada em vez de cair na jogada de outro jogador. Conferido antes da etapa (a tela velha
// recebe sempre a mesma mensagem e recarrega); campo ausente = sem conferência.
function conferirTela(enviado, atual) {
  if (enviado !== undefined && inteiro(enviado) !== atual) throw erro(409, 'A partida mudou: recarregue a tela.');
}

// RF06: só perguntas inéditas na partida. O "IS NOT NULL" corrige o SQL documentado
// (qualquer NULL na subconsulta faz o NOT IN não retornar nada).
const INEDITA = 'id_pergunta NOT IN (SELECT id_pergunta FROM TB_JOGADA WHERE id_partida = ? AND id_pergunta IS NOT NULL)';
const perguntaInedita = (idPartida, idCategoria) =>
  db.prepare(`SELECT id_pergunta FROM TB_PERGUNTA WHERE id_categoria = ? AND ${INEDITA}
              ORDER BY RANDOM() LIMIT 1`).get(idCategoria, idPartida);
// Casa sem categoria fixa (roxo/rosa/preto sem caveira): sorteia entre as categorias com pergunta inédita.
// A Entrevista só sai nas casas com maleta.
const categoriaInedita = (idPartida) =>
  db.prepare(`SELECT id_categoria FROM TB_PERGUNTA WHERE id_categoria <> ${ID_ENTREVISTA} AND ${INEDITA}
              GROUP BY id_categoria ORDER BY RANDOM() LIMIT 1`).get(idPartida)?.id_categoria;
const temInedita = (idPartida, idCategoria) =>
  Boolean(idCategoria == null ? categoriaInedita(idPartida) : perguntaInedita(idPartida, idCategoria));

// RF08 (§4.11): cargo (e chaveiro) da maior faixa que a pontuação total alcançou
const BRINDE = 'SELECT id_brinde, nome, cargo, quantidade_estoque FROM TB_BRINDE';
export const brindeDaPontuacao = (pontos) => db.prepare(`${BRINDE} WHERE pontos_minimos <= ? ORDER BY pontos_minimos DESC LIMIT 1`).get(pontos) ?? null;

// O que acontece ao parar na casa (TIPO_CASA.ACAO do modelo lógico): definido pela cor e pelo ícone pintados na arte.
const acaoDaCasa = (c) => (c.tipo === 'chegada' ? 'chegada' : c.icone === 'caveira' ? 'morte' : c.cor === 'amarelo' ? 'espera' : 'pergunta');
// Passos até o Chegou! na rota do jogador. Os números das casas não medem progresso: 201 vem antes da 31.
export const faltam = (j) => ROTAS[j.rota].length - 1 - ROTAS[j.rota].indexOf(j.casa_atual);

// §4.2: etapa derivada do banco — recarregar a página retoma exatamente do mesmo ponto (RNF06)
function etapaDe(p, pendente) {
  if (p.status === 'Finalizada') return 'finalizada';
  if (p.status === 'Premiação') return 'premiacao';
  if (p.status === 'Pausada') return 'pausada';
  if (pendente) return pendente.id_pergunta == null ? 'sortear' : 'responder';
  return 'dado';
}

function carregar(id) {
  const p = db.prepare('SELECT * FROM TB_PARTIDA WHERE id_partida = ?').get(id);
  if (!p) throw erro(404, 'Partida não encontrada.');
  const pendente = db.prepare('SELECT * FROM TB_JOGADA WHERE id_partida = ? AND concluida = 0').get(p.id_partida);
  return { p, pendente, etapa: etapaDe(p, pendente) };
}

const exigirEtapa = (etapa, esperada) => {
  if (etapa !== esperada) throw erro(409, FORA_DE_HORA[etapa]);
};

// RNF06: cada ação é gravada de forma atômica antes de responder
function acao(id, fn) {
  transacao(() => fn(carregar(id)));
  return estado(id);
}

function jogadorDaPartida(idPartida, idJogador) {
  const j = db.prepare('SELECT * FROM TB_JOGADOR_PARTIDA WHERE id_partida = ? AND id_jogador = ?').get(idPartida, inteiro(idJogador));
  if (!j) throw erro(404, 'Jogador não encontrado nesta partida.');
  if (!j.ativo) throw erro(409, 'Este jogador foi removido da partida.');
  return j;
}

function concluir(jogada, acertou, pontos, alternativa = null) {
  db.prepare('UPDATE TB_JOGADA SET alternativa = ?, acertou = ?, pontos = ?, concluida = 1 WHERE id_jogada = ?')
    .run(alternativa, acertou, pontos, jogada.id_jogada);
}

// §4.9: fim do jogo — vai para a premiação e contabiliza a pausa, se a partida estava pausada
function irParaPremiacao(idPartida) {
  const t = agora();
  db.prepare(`UPDATE TB_PARTIDA SET status = 'Premiação', encerrada_em = ?,
              segundos_pausados = segundos_pausados + COALESCE(? - pausada_em, 0), pausada_em = NULL
              WHERE id_partida = ?`).run(t, t, idPartida);
}

// §4.7: vez = próximo jogador que ainda joga depois do atual (circular). Sem ninguém em jogo, a partida termina.
function passarVez(p) {
  const ordens = db.prepare('SELECT ordem FROM TB_JOGADOR_PARTIDA WHERE id_partida = ? AND ativo = 1 AND eliminado = 0 ORDER BY ordem')
    .all(p.id_partida).map((r) => r.ordem);
  if (!ordens.length) return irParaPremiacao(p.id_partida);
  db.prepare('UPDATE TB_PARTIDA SET vez = ? WHERE id_partida = ?').run(ordens.find((o) => o > p.vez) ?? ordens[0], p.id_partida);
}

// RF08: a partida só termina quando todos os jogadores ativos receberam o brinde
function finalizarSeTodosReceberam(idPartida) {
  const falta = db.prepare(`SELECT 1 FROM TB_JOGADOR_PARTIDA jp WHERE jp.id_partida = ? AND jp.ativo = 1 AND NOT EXISTS
    (SELECT 1 FROM TB_ENTREGA_BRINDE e WHERE e.id_partida = jp.id_partida AND e.id_jogador = jp.id_jogador)`).get(idPartida);
  if (!falta) db.prepare("UPDATE TB_PARTIDA SET status = 'Finalizada', finalizada_em = ? WHERE id_partida = ?").run(agora(), idPartida);
}

// A correção só sai depois que o jogador respondeu, em qualquer tela. A pergunta pendente e a encerrada sem resposta
// não revelam nada, porque podem sair de novo em outra partida. Lista de campos, e não "delete": campo novo não vaza.
function perguntaApi(j) {
  const p = db.prepare(`SELECT id_pergunta, enunciado, resposta, dificuldade, id_categoria,
    (SELECT MAX(a.pontos) FROM TB_ALTERNATIVA a WHERE a.id_pergunta = p.id_pergunta) AS pontos
    FROM TB_PERGUNTA p WHERE id_pergunta = ?`).get(j.id_pergunta);
  if (!p) return null;
  const alternativas = db.prepare('SELECT letra, texto, pontos FROM TB_ALTERNATIVA WHERE id_pergunta = ? ORDER BY letra').all(p.id_pergunta);
  const base = { id_pergunta: p.id_pergunta, enunciado: p.enunciado, dificuldade: p.dificuldade, pontos: p.pontos, entrevista: p.id_categoria === ID_ENTREVISTA };
  return j.alternativa == null
    ? { ...base, alternativas: alternativas.map(({ letra, texto }) => ({ letra, texto })) }
    : { ...base, resposta: p.resposta, alternativas };
}

function jogadaApi(j) {
  const casa = db.prepare('SELECT numero, tipo, cor, icone, id_categoria FROM TB_CASA WHERE numero = ?').get(j.casa_final);
  const acaoCasa = acaoDaCasa(casa);
  return {
    id_jogada: j.id_jogada, id_jogador: j.id_jogador, valor_dado: j.valor_dado, casa_inicial: j.casa_inicial, casa_final: j.casa_final,
    casa: { numero: casa.numero, cor: casa.cor, icone: casa.icone, acao: acaoCasa, sorteada: acaoCasa === 'pergunta' && casa.id_categoria == null },
    categoria: db.prepare('SELECT id_categoria, nome, cor, cor_hex FROM TB_CATEGORIA WHERE id_categoria = ?').get(j.id_categoria) ?? null,
    pergunta: perguntaApi(j),
    sem_perguntas: !j.concluida && j.id_pergunta == null && !temInedita(j.id_partida, j.id_categoria),
  };
}

// Objeto "estado" (§5): resposta de todas as ações de partida
export function estado(id) {
  const { p, pendente, etapa } = carregar(id);
  const t = agora();
  const comVez = ['dado', 'sortear', 'responder', 'pausada'].includes(etapa);
  const jogadores = db.prepare(`
    SELECT jp.id_jogador, j.nome, j.apelido, e.nome AS escola, jp.ordem, jp.peao, jp.rota, jp.casa_atual, jp.pontuacao, jp.ativo, jp.eliminado,
           (SELECT id_brinde FROM TB_ENTREGA_BRINDE eb WHERE eb.id_partida = jp.id_partida AND eb.id_jogador = jp.id_jogador) AS id_entregue
    FROM TB_JOGADOR_PARTIDA jp JOIN TB_JOGADOR j ON j.id_jogador = jp.id_jogador JOIN TB_ESCOLA e ON e.id_escola = j.id_escola
    WHERE jp.id_partida = ? ORDER BY jp.ordem`).all(p.id_partida).map(({ id_entregue, ...j }) => ({
    ...j,
    ativo: Boolean(j.ativo),
    eliminado: Boolean(j.eliminado),
    faltam: faltam(j),
    da_vez: comVez && Boolean(j.ativo) && !j.eliminado && j.ordem === p.vez,
    // depois da entrega vale o brinde entregue; antes, o da pontuação atual
    brinde: id_entregue ? db.prepare(`${BRINDE} WHERE id_brinde = ?`).get(id_entregue) : brindeDaPontuacao(j.pontuacao),
    entregue: id_entregue != null,
  }));
  const daVez = jogadores.find((j) => j.da_vez);
  const ultima = db.prepare('SELECT * FROM TB_JOGADA WHERE id_partida = ? AND concluida = 1 ORDER BY id_jogada DESC LIMIT 1').get(p.id_partida);
  return {
    partida: {
      id_partida: p.id_partida, status: p.status, codigo_online: p.codigo_online, unidade: p.unidade,
      mediador: db.prepare('SELECT nome FROM TB_USUARIO WHERE id_usuario = ?').get(p.id_mediador).nome,
      iniciada_em: p.iniciada_em, encerrada_em: p.encerrada_em, finalizada_em: p.finalizada_em, pausada_em: p.pausada_em,
      // §4.10
      tempo_decorrido_s: (p.encerrada_em ?? t) - p.iniciada_em - p.segundos_pausados - (p.pausada_em ? t - p.pausada_em : 0),
      vez: p.vez,
    },
    etapa,
    casa_chegada: CASA_CHEGADA,
    jogadores,
    jogador_da_vez: daVez ? { id_jogador: daVez.id_jogador, nome: daVez.nome, apelido: daVez.apelido, peao: daVez.peao } : null,
    jogada_pendente: pendente ? jogadaApi(pendente) : null,
    ultima_jogada: ultima ? {
      ...jogadaApi(ultima),
      alternativa: ultima.alternativa,
      acertou: ultima.acertou == null ? null : Boolean(ultima.acertou),
      pontos: ultima.pontos,
      nome: jogadores.find((j) => j.id_jogador === ultima.id_jogador).nome,
    } : null,
  };
}

// Telão / consulta pública, sem login e com menores de idade: só o que a tela usa. Apelido ou primeiro nome, nunca o
// nome completo; sem escola, sem mediador e sem quem foi removido da partida (privacidade).
export function estadoPublico(codigo) {
  const p = db.prepare('SELECT id_partida FROM TB_PARTIDA WHERE codigo_online = ?').get(String(codigo).trim().toUpperCase());
  if (!p) throw erro(404, 'Partida não encontrada.');
  const e = estado(p.id_partida);
  const nome = new Map(e.jogadores.map((j) => [j.id_jogador, j.apelido || j.nome.split(/\s+/)[0]]));
  for (const j of [e.jogador_da_vez, e.ultima_jogada]) if (j) j.nome = nome.get(j.id_jogador);
  if (e.jogador_da_vez) delete e.jogador_da_vez.apelido;
  delete e.partida.mediador;
  e.jogadores = e.jogadores.filter((j) => j.ativo).map(({ escola, apelido, ...j }) => ({ ...j, nome: nome.get(j.id_jogador) }));
  if (!e.jogadores.some((j) => j.id_jogador === e.ultima_jogada?.id_jogador)) e.ultima_jogada = null;
  return e;
}

// Etapa 3: dados do certificado virtual, só depois do fim do jogo (o cargo não muda mais).
// comEmail: só o administrador vê o endereço de envio (RNF04).
export function certificado(id, idJogador, comEmail) {
  const { p, etapa } = carregar(id);
  if (etapa !== 'premiacao' && etapa !== 'finalizada') throw erro(409, 'O certificado só é emitido depois do fim da partida.');
  const { id_jogador } = jogadorDaPartida(p.id_partida, idJogador);
  const j = estado(id).jogadores.find((x) => x.id_jogador === id_jogador);
  const { email } = db.prepare('SELECT email FROM TB_JOGADOR WHERE id_jogador = ?').get(id_jogador);
  return {
    id_jogador, nome: j.nome, escola: j.escola, cargo: j.brinde?.cargo ?? null, pontuacao: j.pontuacao,
    unidade: p.unidade, encerrada_em: p.encerrada_em, ...(comEmail && { email }),
  };
}

// Etapa 3: todos os certificados que podem ser emitidos (partidas terminadas, sem quem foi removido), por nome.
export function certificados() {
  return db.prepare(`SELECT jp.id_partida, jp.id_jogador, j.nome, e.nome AS escola, jp.pontuacao, p.encerrada_em,
      (SELECT b.cargo FROM TB_ENTREGA_BRINDE eb JOIN TB_BRINDE b ON b.id_brinde = eb.id_brinde
       WHERE eb.id_partida = jp.id_partida AND eb.id_jogador = jp.id_jogador) AS cargo_entregue
    FROM TB_JOGADOR_PARTIDA jp JOIN TB_PARTIDA p ON p.id_partida = jp.id_partida
    JOIN TB_JOGADOR j ON j.id_jogador = jp.id_jogador JOIN TB_ESCOLA e ON e.id_escola = j.id_escola
    WHERE jp.ativo = 1 AND p.status IN ('Premiação', 'Finalizada') ORDER BY j.nome, jp.id_partida DESC`).all()
    .map(({ cargo_entregue, ...c }) => ({ ...c, cargo: cargo_entregue ?? brindeDaPontuacao(c.pontuacao)?.cargo ?? null }));
}

// §4.1 — RF03: 1 a 4 jogadores distintos, cada um com um peão de cor diferente e a sua rota
export function criarPartida(usuario, lista) {
  if (!Array.isArray(lista) || lista.length < 1 || lista.length > 4) throw erro(400, 'Selecione de 1 a 4 jogadores.');
  const ids = lista.map((j) => inteiro(j?.id_jogador));
  if (ids.some(Number.isNaN)) throw erro(400, 'Jogador não encontrado.'); // A29: no Set, NaN = NaN pareceria "repetido"
  if (new Set(ids).size < ids.length) throw erro(400, 'O mesmo jogador foi selecionado mais de uma vez.');
  const escolhidos = lista.map((j) => j?.peao || null);
  const usados = escolhidos.filter(Boolean);
  if (usados.some((c) => !PEOES.includes(c))) throw erro(400, 'Peão inválido: escolha verde, vermelho, azul ou amarelo.');
  if (new Set(usados).size < usados.length) throw erro(400, 'Cada jogador deve ter um peão de cor diferente.');
  const rotas = lista.map((j) => j?.rota ?? 'esquerda');
  if (rotas.some((r) => !Object.keys(ROTAS).includes(r))) throw erro(400, 'Rota inválida: escolha esquerda, centro ou direita.');
  const existe = db.prepare('SELECT 1 FROM TB_JOGADOR WHERE id_jogador = ?');
  if (ids.some((id) => !existe.get(id))) throw erro(400, 'Jogador não encontrado.');
  const livres = PEOES.filter((c) => !usados.includes(c)); // sem peão: verde → vermelho → azul → amarelo
  const peoes = escolhidos.map((c) => c || livres.shift());

  const id = transacao(() => {
    let codigo;
    do codigo = Array.from({ length: 6 }, () => ALFABETO[randomInt(ALFABETO.length)]).join('');
    while (db.prepare('SELECT 1 FROM TB_PARTIDA WHERE codigo_online = ?').get(codigo));
    const { lastInsertRowid } = db.prepare(`INSERT INTO TB_PARTIDA (status, codigo_online, unidade, id_mediador, vez)
                                            VALUES ('Em Andamento', ?, ?, ?, 0)`).run(codigo, usuario.unidade, usuario.id_usuario);
    const ins = db.prepare('INSERT INTO TB_JOGADOR_PARTIDA (id_partida, id_jogador, ordem, peao, rota) VALUES (?, ?, ?, ?, ?)');
    ids.forEach((idJogador, ordem) => ins.run(lastInsertRowid, idJogador, ordem, peoes[ordem], rotas[ordem]));
    return lastInsertRowid;
  });
  return estado(id);
}

// §4.3 — RF04: o servidor sorteia o dado e o peão anda pela rota do jogador.
// Só a casa com pergunta deixa a jogada pendente: Chegou! abre a premiação, a caveira elimina e a amarela só passa a vez.
export const lancarDado = (id, idJogador) => acao(id, ({ p, etapa }) => {
  const j = db.prepare('SELECT id_jogador, casa_atual, rota FROM TB_JOGADOR_PARTIDA WHERE id_partida = ? AND ativo = 1 AND ordem = ?')
    .get(p.id_partida, p.vez);
  conferirTela(idJogador, j?.id_jogador);
  exigirEtapa(etapa, 'dado');
  const v = sorteio.dado();
  const rota = ROTAS[j.rota];
  const casaFinal = rota[Math.min(rota.indexOf(j.casa_atual) + v, rota.length - 1)];
  const casa = db.prepare('SELECT tipo, cor, icone, id_categoria FROM TB_CASA WHERE numero = ?').get(casaFinal);
  const acaoCasa = acaoDaCasa(casa);
  db.prepare(`INSERT INTO TB_JOGADA (id_partida, id_jogador, valor_dado, casa_inicial, casa_final, id_categoria, concluida)
              VALUES (?, ?, ?, ?, ?, ?, ?)`).run(p.id_partida, j.id_jogador, v, j.casa_atual, casaFinal, casa.id_categoria, acaoCasa === 'pergunta' ? 0 : 1);
  db.prepare('UPDATE TB_JOGADOR_PARTIDA SET casa_atual = ?, eliminado = ? WHERE id_partida = ? AND id_jogador = ?')
    .run(casaFinal, acaoCasa === 'morte' ? 1 : 0, p.id_partida, j.id_jogador);
  if (acaoCasa === 'chegada') irParaPremiacao(p.id_partida);
  else if (acaoCasa !== 'pergunta') passarVez(p);
});

// §4.4 — RF05 + RF06: pergunta aleatória e inédita da categoria da casa, gravada na hora
export const sortear = (id, idJogada) => acao(id, ({ p, pendente, etapa }) => {
  conferirTela(idJogada, pendente?.id_jogada);
  exigirEtapa(etapa, 'sortear');
  const cat = pendente.id_categoria ?? categoriaInedita(p.id_partida);
  const pergunta = cat != null && perguntaInedita(p.id_partida, cat);
  if (!pergunta) {
    const nome = cat != null && db.prepare('SELECT nome FROM TB_CATEGORIA WHERE id_categoria = ?').get(cat).nome;
    const msg = nome ? `Não há mais perguntas inéditas da categoria ${nome} nesta partida.` : 'Não há mais perguntas inéditas nesta partida.';
    throw Object.assign(erro(409, msg), { sem_perguntas: true });
  }
  db.prepare('UPDATE TB_JOGADA SET id_categoria = ?, id_pergunta = ? WHERE id_jogada = ?').run(cat, pergunta.id_pergunta, pendente.id_jogada);
});

// §4.5: sem pergunta inédita, conclui a jogada sem pontos e passa a vez
export const pular = (id, idJogada) => acao(id, ({ p, pendente, etapa }) => {
  conferirTela(idJogada, pendente?.id_jogada);
  exigirEtapa(etapa, 'sortear');
  if (temInedita(p.id_partida, pendente.id_categoria)) throw erro(409, 'Ainda há perguntas inéditas para esta jogada: sorteie a pergunta.');
  concluir(pendente, null, 0);
  passarVez(p);
});

// §4.6 — RF07: o servidor corrige a alternativa escolhida e soma os pontos dela. Sem pontos, o peão fica na casa.
export const responder = (id, alternativa, idJogada) => acao(id, ({ p, pendente, etapa }) => {
  conferirTela(idJogada, pendente?.id_jogada);
  exigirEtapa(etapa, 'responder');
  const escolhida = typeof alternativa === 'string'
    && db.prepare('SELECT letra, pontos FROM TB_ALTERNATIVA WHERE id_pergunta = ? AND letra = ?').get(pendente.id_pergunta, alternativa);
  if (!escolhida) throw erro(400, 'Escolha uma das alternativas: A, B, C ou D.');
  concluir(pendente, escolhida.pontos > 0 ? 1 : 0, escolhida.pontos, escolhida.letra);
  db.prepare('UPDATE TB_JOGADOR_PARTIDA SET pontuacao = pontuacao + ? WHERE id_partida = ? AND id_jogador = ?')
    .run(escolhida.pontos, p.id_partida, pendente.id_jogador);
  passarVez(p);
});

// §4.8 — Mediador: "iniciar, pausar e controlar o tempo"
export const pausar = (id) => acao(id, ({ p, etapa }) => {
  if (p.status !== 'Em Andamento') throw erro(409, p.status === 'Pausada' ? 'A partida já está pausada.' : FORA_DE_HORA[etapa]);
  db.prepare("UPDATE TB_PARTIDA SET status = 'Pausada', pausada_em = ? WHERE id_partida = ?").run(agora(), p.id_partida);
});

export const retomar = (id) => acao(id, ({ p }) => {
  if (p.status !== 'Pausada') throw erro(409, 'A partida não está pausada.');
  db.prepare(`UPDATE TB_PARTIDA SET status = 'Em Andamento', segundos_pausados = segundos_pausados + (? - pausada_em), pausada_em = NULL
              WHERE id_partida = ?`).run(agora(), p.id_partida);
});

// §4.9: fim por tempo — conclui a jogada pendente sem pontos, contabiliza a pausa e vai para a premiação
export const encerrar = (id) => acao(id, ({ p, pendente, etapa }) => {
  if (!EM_JOGO.includes(p.status)) throw erro(409, FORA_DE_HORA[etapa]);
  if (pendente) concluir(pendente, null, 0);
  irParaPremiacao(p.id_partida);
});

// §4.12 — RF08 (um brinde por jogador por partida) + RF09 (baixa automática no estoque)
export const entregarBrinde = (id, idJogador, usuario) => acao(id, ({ p, etapa }) => {
  if (etapa !== 'premiacao') throw erro(409, etapa === 'finalizada' ? FORA_DE_HORA.finalizada : 'O brinde só é entregue ao final da partida.');
  const j = jogadorDaPartida(p.id_partida, idJogador);
  if (db.prepare('SELECT 1 FROM TB_ENTREGA_BRINDE WHERE id_partida = ? AND id_jogador = ?').get(p.id_partida, j.id_jogador)) {
    throw erro(409, 'Este jogador já recebeu o brinde desta partida.');
  }
  const b = brindeDaPontuacao(j.pontuacao);
  if (!b) throw erro(409, 'Nenhum brinde cadastrado para a pontuação deste jogador.');
  // RF09: só dá baixa se houver unidade; com estoque zero nada é gravado
  const baixa = db.prepare('UPDATE TB_BRINDE SET quantidade_estoque = quantidade_estoque - 1 WHERE id_brinde = ? AND quantidade_estoque > 0')
    .run(b.id_brinde);
  if (!baixa.changes) throw erro(409, `O "${b.nome}" esgotou! Não há unidades na mesa.`);
  db.prepare('INSERT INTO TB_ENTREGA_BRINDE (id_partida, id_jogador, id_brinde, id_usuario) VALUES (?, ?, ?, ?)')
    .run(p.id_partida, j.id_jogador, b.id_brinde, usuario.id_usuario);
  finalizarSeTodosReceberam(p.id_partida);
});

// §4.13 — Admin: mover peão dentro da rota do jogador (sem jogada pendente, partida em jogo).
// A casa de destino não tem efeito. Mover um eliminado o devolve ao jogo, por decisão do administrador.
export const moverPeao = (id, idJogador, casa) => acao(id, ({ p, pendente, etapa }) => {
  if (!EM_JOGO.includes(p.status)) throw erro(409, FORA_DE_HORA[etapa]);
  if (pendente) throw erro(409, 'Conclua a jogada atual antes de mover um peão.');
  const j = jogadorDaPartida(p.id_partida, idJogador);
  const c = inteiro(casa);
  if (c === CASA_CHEGADA || !ROTAS[j.rota].includes(c)) throw erro(400, 'A casa deve fazer parte da rota deste jogador e não pode ser o Chegou!.');
  db.prepare('UPDATE TB_JOGADOR_PARTIDA SET casa_atual = ?, eliminado = 0 WHERE id_partida = ? AND id_jogador = ?').run(c, p.id_partida, j.id_jogador);
});

// §4.13 — Admin: remover jogador (ativo = 0); nunca o último ativo; só com a partida em jogo.
// A7/RF08: na premiação a remoção finalizaria a partida sem premiar todos — lá vale a reposição do estoque (§11 nº 14).
export const removerJogador = (id, idJogador) => acao(id, ({ p, pendente, etapa }) => {
  if (!EM_JOGO.includes(p.status)) throw erro(409, FORA_DE_HORA[etapa]);
  if (pendente) throw erro(409, 'Conclua a jogada atual antes de remover um jogador.');
  const j = jogadorDaPartida(p.id_partida, idJogador);
  const ativos = db.prepare('SELECT COUNT(*) AS n FROM TB_JOGADOR_PARTIDA WHERE id_partida = ? AND ativo = 1').get(p.id_partida).n;
  if (ativos === 1) throw erro(409, 'Não é possível remover o último jogador da partida.');
  db.prepare('UPDATE TB_JOGADOR_PARTIDA SET ativo = 0 WHERE id_partida = ? AND id_jogador = ?').run(p.id_partida, j.id_jogador);
  if (j.ordem === p.vez) passarVez(p);
});
