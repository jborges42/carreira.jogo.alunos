// Motor da partida — regras RF03–RF09 e RNF06 (docs/ESPECIFICACAO-TECNICA.md §4).
// Funções assíncronas sobre o banco: cada ação roda numa transação e devolve o estado atualizado.
import { randomInt } from 'node:crypto';
import { db, transacao, ROTAS, ID_ENTREVISTA } from './db.js';

export const CASA_CHEGADA = (await db.get("SELECT numero FROM TB_CASA WHERE tipo = 'chegada'")).numero; // 65 = Chegou!
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
  aguardando: 'Ninguém está jogando agora: coloque o próximo visitante na partida.',
};
// Quem está na fila de vez. Na partida contínua, quem chega ao Chegou! ou cai na caveira sai do tabuleiro (terminou_em).
const JOGANDO = 'ativo = 1 AND eliminado = 0 AND terminou_em IS NULL';

// doApp: só a mensagem destes erros (em português) sai para a tela; a das bibliotecas, não (A28, server.js)
export const erro = (status, mensagem) => Object.assign(new Error(mensagem), { status, doApp: true });
const agora = () => Math.floor(Date.now() / 1000);

// Inteiro vindo do JSON ou da URL (aceita "3"). O resto vira NaN: falha em toda comparação e vira NULL no banco (db.js).
// Só inteiros seguros (A22): acima de 2^53 a leitura posterior falharia (500).
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
  db.get(`SELECT id_pergunta FROM TB_PERGUNTA WHERE id_categoria = ? AND ${INEDITA}
          ORDER BY RANDOM() LIMIT 1`, idCategoria, idPartida);
// Casa sem categoria fixa (roxo/rosa/preto sem caveira): sorteia entre as categorias com pergunta inédita.
// A Entrevista só sai nas casas com maleta.
const categoriaInedita = async (idPartida) =>
  (await db.get(`SELECT id_categoria FROM TB_PERGUNTA WHERE id_categoria <> ${ID_ENTREVISTA} AND ${INEDITA}
                 GROUP BY id_categoria ORDER BY RANDOM() LIMIT 1`, idPartida))?.id_categoria;
const temInedita = async (idPartida, idCategoria) =>
  Boolean(idCategoria == null ? await categoriaInedita(idPartida) : await perguntaInedita(idPartida, idCategoria));

// RF08 (§4.11): cargo (e chaveiro) da maior faixa que a pontuação total alcançou
const BRINDE = 'SELECT id_brinde, nome, cargo, quantidade_estoque FROM TB_BRINDE';
export const brindeDaPontuacao = async (pontos) =>
  (await db.get(`${BRINDE} WHERE pontos_minimos <= ? ORDER BY pontos_minimos DESC LIMIT 1`, pontos)) ?? null;

// O que acontece ao parar na casa (TIPO_CASA.ACAO do modelo lógico): definido pela cor e pelo ícone pintados na arte.
const acaoDaCasa = (c) => (c.tipo === 'chegada' ? 'chegada' : c.icone === 'caveira' ? 'morte' : c.cor === 'amarelo' ? 'espera' : 'pergunta');
// Passos até o Chegou! na rota do jogador. Os números das casas não medem progresso: 201 vem antes da 31.
export const faltam = (j) => ROTAS[j.rota].length - 1 - ROTAS[j.rota].indexOf(j.casa_atual);

// §4.2: etapa derivada do banco — recarregar a página retoma exatamente do mesmo ponto (RNF06)
function etapaDe(p, pendente, alguemJogando) {
  if (p.status === 'Finalizada') return 'finalizada';
  if (p.status === 'Premiação') return 'premiacao';
  if (p.status === 'Pausada') return 'pausada';
  if (pendente) return pendente.id_pergunta == null ? 'sortear' : 'responder';
  if (!alguemJogando) return 'aguardando'; // só na partida contínua: espera o próximo visitante
  return 'dado';
}

async function carregar(id) {
  const p = await db.get('SELECT * FROM TB_PARTIDA WHERE id_partida = ?', id);
  if (!p) throw erro(404, 'Partida não encontrada.');
  const pendente = await db.get('SELECT * FROM TB_JOGADA WHERE id_partida = ? AND concluida = 0', p.id_partida);
  const alguemJogando = !p.continua || Boolean(await db.get(`SELECT 1 FROM TB_JOGADOR_PARTIDA WHERE id_partida = ? AND ${JOGANDO}`, p.id_partida));
  return { p, pendente, etapa: etapaDe(p, pendente, alguemJogando) };
}

const exigirEtapa = (etapa, esperada) => {
  if (etapa !== esperada) throw erro(409, FORA_DE_HORA[etapa]);
};

// RNF06: cada ação é gravada de forma atômica antes de responder
async function acao(id, fn) {
  await transacao(async () => fn(await carregar(id)));
  return estado(id);
}

async function jogadorDaPartida(idPartida, idJogador) {
  const j = await db.get('SELECT * FROM TB_JOGADOR_PARTIDA WHERE id_partida = ? AND id_jogador = ?', idPartida, inteiro(idJogador));
  if (!j) throw erro(404, 'Jogador não encontrado nesta partida.');
  if (!j.ativo) throw erro(409, 'Este jogador foi removido da partida.');
  return j;
}

async function concluir(jogada, acertou, pontos, alternativa = null) {
  await db.run('UPDATE TB_JOGADA SET alternativa = ?, acertou = ?, pontos = ?, concluida = 1 WHERE id_jogada = ?',
    alternativa, acertou, pontos, jogada.id_jogada);
}

// §4.9: fim do jogo — vai para a premiação e contabiliza a pausa, se a partida estava pausada
async function irParaPremiacao(idPartida) {
  const t = agora();
  await db.run(`UPDATE TB_PARTIDA SET status = 'Premiação', encerrada_em = ?,
                segundos_pausados = segundos_pausados + COALESCE(? - pausada_em, 0), pausada_em = NULL
                WHERE id_partida = ?`, t, t, idPartida);
}

// §4.7: vez = próximo jogador que ainda joga depois do atual (circular). Sem ninguém em jogo, a partida termina
// (a contínua, não: fica aguardando o próximo visitante).
async function passarVez(p) {
  const ordens = (await db.all(`SELECT ordem FROM TB_JOGADOR_PARTIDA WHERE id_partida = ? AND ${JOGANDO} ORDER BY ordem`,
    p.id_partida)).map((r) => r.ordem);
  if (!ordens.length) return p.continua ? undefined : irParaPremiacao(p.id_partida);
  await db.run('UPDATE TB_PARTIDA SET vez = ? WHERE id_partida = ?', ordens.find((o) => o > p.vez) ?? ordens[0], p.id_partida);
}

// RF08: a partida só termina quando todos os jogadores ativos receberam o brinde
async function finalizarSeTodosReceberam(idPartida) {
  const falta = await db.get(`SELECT 1 FROM TB_JOGADOR_PARTIDA jp WHERE jp.id_partida = ? AND jp.ativo = 1 AND NOT EXISTS
    (SELECT 1 FROM TB_ENTREGA_BRINDE e WHERE e.id_partida = jp.id_partida AND e.id_jogador = jp.id_jogador)`, idPartida);
  if (!falta) await db.run("UPDATE TB_PARTIDA SET status = 'Finalizada', finalizada_em = ? WHERE id_partida = ?", agora(), idPartida);
}

// A correção só sai depois que o jogador respondeu, em qualquer tela. A pergunta pendente e a encerrada sem resposta
// não revelam nada, porque podem sair de novo em outra partida. Lista de campos, e não "delete": campo novo não vaza.
async function perguntaApi(j) {
  const p = await db.get(`SELECT id_pergunta, enunciado, resposta, dificuldade, id_categoria,
    (SELECT MAX(a.pontos) FROM TB_ALTERNATIVA a WHERE a.id_pergunta = p.id_pergunta) AS pontos
    FROM TB_PERGUNTA p WHERE id_pergunta = ?`, j.id_pergunta);
  if (!p) return null;
  const alternativas = await db.all('SELECT letra, texto, pontos FROM TB_ALTERNATIVA WHERE id_pergunta = ? ORDER BY letra', p.id_pergunta);
  const base = { id_pergunta: p.id_pergunta, enunciado: p.enunciado, dificuldade: p.dificuldade, pontos: p.pontos, entrevista: p.id_categoria === ID_ENTREVISTA };
  return j.alternativa == null
    ? { ...base, alternativas: alternativas.map(({ letra, texto }) => ({ letra, texto })) }
    : { ...base, resposta: p.resposta, alternativas };
}

async function jogadaApi(j) {
  const casa = await db.get('SELECT numero, tipo, cor, icone, id_categoria FROM TB_CASA WHERE numero = ?', j.casa_final);
  const acaoCasa = acaoDaCasa(casa);
  return {
    id_jogada: j.id_jogada, id_jogador: j.id_jogador, valor_dado: j.valor_dado, casa_inicial: j.casa_inicial, casa_final: j.casa_final,
    casa: { numero: casa.numero, cor: casa.cor, icone: casa.icone, acao: acaoCasa, sorteada: acaoCasa === 'pergunta' && casa.id_categoria == null },
    categoria: (await db.get('SELECT id_categoria, nome, cor, cor_hex FROM TB_CATEGORIA WHERE id_categoria = ?', j.id_categoria)) ?? null,
    pergunta: await perguntaApi(j),
    sem_perguntas: !j.concluida && j.id_pergunta == null && !(await temInedita(j.id_partida, j.id_categoria)),
  };
}

// Objeto "estado" (§5): resposta de todas as ações de partida
export async function estado(id) {
  const { p, pendente, etapa } = await carregar(id);
  const t = agora();
  const comVez = ['dado', 'sortear', 'responder', 'pausada'].includes(etapa);
  // Partida contínua: o dia inteiro cabe nela, então só vem quem está na mesa — jogando, esperando o chaveiro ou entre
  // os 6 últimos a terminar (o telão mostra esses). Os demais estão nos certificados e relatórios.
  const linhas = await db.all(`
    SELECT jp.id_jogador, j.nome, j.apelido, e.nome AS escola, jp.ordem, jp.peao, jp.rota, jp.casa_atual, jp.pontuacao, jp.ativo, jp.eliminado,
           jp.terminou_em,
           (SELECT id_brinde FROM TB_ENTREGA_BRINDE eb WHERE eb.id_partida = jp.id_partida AND eb.id_jogador = jp.id_jogador) AS id_entregue
    FROM TB_JOGADOR_PARTIDA jp JOIN TB_JOGADOR j ON j.id_jogador = jp.id_jogador JOIN TB_ESCOLA e ON e.id_escola = j.id_escola
    WHERE jp.id_partida = ? AND (? = 0 OR jp.ativo = 1 AND (jp.terminou_em IS NULL
      OR NOT EXISTS (SELECT 1 FROM TB_ENTREGA_BRINDE eb WHERE eb.id_partida = jp.id_partida AND eb.id_jogador = jp.id_jogador)
      OR jp.id_jogador IN (SELECT id_jogador FROM TB_JOGADOR_PARTIDA WHERE id_partida = jp.id_partida AND terminou_em IS NOT NULL
                           ORDER BY terminou_em DESC, ordem DESC LIMIT 6)))
    ORDER BY jp.ordem`, p.id_partida, p.continua);
  const jogadores = await Promise.all(linhas.map(async ({ id_entregue, ...j }) => ({
    ...j,
    ativo: Boolean(j.ativo),
    eliminado: Boolean(j.eliminado),
    faltam: faltam(j),
    da_vez: comVez && Boolean(j.ativo) && !j.eliminado && j.terminou_em == null && j.ordem === p.vez,
    // depois da entrega vale o brinde entregue; antes, o da pontuação atual
    brinde: id_entregue ? await db.get(`${BRINDE} WHERE id_brinde = ?`, id_entregue) : await brindeDaPontuacao(j.pontuacao),
    entregue: id_entregue != null,
  })));
  const daVez = jogadores.find((j) => j.da_vez);
  const ultima = await db.get('SELECT * FROM TB_JOGADA WHERE id_partida = ? AND concluida = 1 ORDER BY id_jogada DESC LIMIT 1', p.id_partida);
  const mediador = (await db.get('SELECT nome FROM TB_USUARIO WHERE id_usuario = ?', p.id_mediador)).nome;
  return {
    partida: {
      id_partida: p.id_partida, status: p.status, codigo_online: p.codigo_online, unidade: p.unidade, mediador,
      iniciada_em: p.iniciada_em, encerrada_em: p.encerrada_em, finalizada_em: p.finalizada_em, pausada_em: p.pausada_em,
      // §4.10
      tempo_decorrido_s: (p.encerrada_em ?? t) - p.iniciada_em - p.segundos_pausados - (p.pausada_em ? t - p.pausada_em : 0),
      vez: p.vez,
      continua: Boolean(p.continua),
    },
    etapa,
    casa_chegada: CASA_CHEGADA,
    jogadores,
    jogador_da_vez: daVez ? { id_jogador: daVez.id_jogador, nome: daVez.nome, apelido: daVez.apelido, peao: daVez.peao } : null,
    jogada_pendente: pendente ? await jogadaApi(pendente) : null,
    ultima_jogada: ultima ? {
      ...(await jogadaApi(ultima)),
      alternativa: ultima.alternativa,
      acertou: ultima.acertou == null ? null : Boolean(ultima.acertou),
      pontos: ultima.pontos,
      nome: jogadores.find((j) => j.id_jogador === ultima.id_jogador)?.nome ?? '', // contínua: removido já saiu da lista
    } : null,
  };
}

// Telão / consulta pública, sem login e com menores de idade: só o que a tela usa. Apelido ou primeiro nome, nunca o
// nome completo; sem escola, sem mediador e sem quem foi removido da partida (privacidade).
export async function estadoPublico(codigo) {
  const p = await db.get('SELECT id_partida FROM TB_PARTIDA WHERE codigo_online = ?', String(codigo).trim().toUpperCase());
  if (!p) throw erro(404, 'Partida não encontrada.');
  const e = await estado(p.id_partida);
  const nome = new Map(e.jogadores.map((j) => [j.id_jogador, j.apelido || j.nome.split(/\s+/)[0]]));
  for (const j of [e.jogador_da_vez, e.ultima_jogada]) if (j) j.nome = nome.get(j.id_jogador);
  if (e.jogador_da_vez) delete e.jogador_da_vez.apelido;
  delete e.partida.mediador;
  e.jogadores = e.jogadores.filter((j) => j.ativo).map(({ escola, apelido, ...j }) => ({ ...j, nome: nome.get(j.id_jogador) }));
  if (!e.jogadores.some((j) => j.id_jogador === e.ultima_jogada?.id_jogador)) e.ultima_jogada = null;
  return e;
}

// Telão automático (/acompanhar/atual): a partida em jogo mais recente ou, sem nenhuma, a última finalizada.
export async function estadoPublicoAtual() {
  const p = await db.get("SELECT codigo_online FROM TB_PARTIDA ORDER BY status = 'Finalizada', id_partida DESC LIMIT 1");
  if (!p) throw erro(404, 'Nenhuma partida ainda.');
  return estadoPublico(p.codigo_online);
}

// Etapa 3: dados do certificado virtual, só depois do fim do jogo (o cargo não muda mais).
// comEmail: só o administrador vê o endereço de envio (RNF04).
// Partida contínua: quem já terminou tem o certificado na hora, com a data em que terminou.
export async function certificado(id, idJogador, comEmail) {
  const { p, etapa } = await carregar(id);
  const fim = etapa === 'premiacao' || etapa === 'finalizada';
  const NAO_EMITIDO = 'O certificado só é emitido depois do fim da partida.';
  if (!fim && !p.continua) throw erro(409, NAO_EMITIDO);
  const jp = await jogadorDaPartida(p.id_partida, idJogador);
  if (!fim && jp.terminou_em == null) throw erro(409, NAO_EMITIDO);
  // depois da entrega vale o brinde entregue; antes, o da pontuação (como no estado)
  const j = await db.get(`SELECT j.nome, e.nome AS escola, j.email,
      (SELECT b.cargo FROM TB_ENTREGA_BRINDE eb JOIN TB_BRINDE b ON b.id_brinde = eb.id_brinde
       WHERE eb.id_partida = ? AND eb.id_jogador = j.id_jogador) AS cargo_entregue
    FROM TB_JOGADOR j JOIN TB_ESCOLA e ON e.id_escola = j.id_escola WHERE j.id_jogador = ?`, p.id_partida, jp.id_jogador);
  return {
    id_jogador: jp.id_jogador, nome: j.nome, escola: j.escola,
    cargo: j.cargo_entregue ?? (await brindeDaPontuacao(jp.pontuacao))?.cargo ?? null, pontuacao: jp.pontuacao,
    unidade: p.unidade, encerrada_em: jp.terminou_em ?? p.encerrada_em, ...(comEmail && { email: j.email }),
  };
}

// Etapa 3: todos os certificados que podem ser emitidos (partidas terminadas, sem quem foi removido), por nome.
// Cargo: o do brinde entregue ou, antes da entrega, o da pontuação (a regra de brindeDaPontuacao, aqui no próprio SQL
// para a lista toda sair numa consulta só).
export function certificados() {
  return db.all(`SELECT jp.id_partida, jp.id_jogador, j.nome, e.nome AS escola, jp.pontuacao, COALESCE(jp.terminou_em, p.encerrada_em) AS encerrada_em,
      COALESCE((SELECT b.cargo FROM TB_ENTREGA_BRINDE eb JOIN TB_BRINDE b ON b.id_brinde = eb.id_brinde
                WHERE eb.id_partida = jp.id_partida AND eb.id_jogador = jp.id_jogador),
               (SELECT b.cargo FROM TB_BRINDE b WHERE b.pontos_minimos <= jp.pontuacao ORDER BY b.pontos_minimos DESC LIMIT 1)) AS cargo
    FROM TB_JOGADOR_PARTIDA jp JOIN TB_PARTIDA p ON p.id_partida = jp.id_partida
    JOIN TB_JOGADOR j ON j.id_jogador = jp.id_jogador JOIN TB_ESCOLA e ON e.id_escola = j.id_escola
    WHERE jp.ativo = 1 AND (p.status IN ('Premiação', 'Finalizada') OR jp.terminou_em IS NOT NULL) -- contínua: quem já terminou
    ORDER BY j.nome, jp.id_partida DESC`);
}

// §4.1 — RF03: 1 a 4 jogadores distintos, cada um com um peão de cor diferente e a sua rota.
// continua: partida contínua da feira (visitantes entram e saem ao longo do dia, ver adicionarJogador).
export async function criarPartida(usuario, lista, continua = false) {
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
  for (const idJogador of ids) {
    if (!(await db.get('SELECT 1 FROM TB_JOGADOR WHERE id_jogador = ?', idJogador))) throw erro(400, 'Jogador não encontrado.');
  }
  const livres = PEOES.filter((c) => !usados.includes(c)); // sem peão: verde → vermelho → azul → amarelo
  const peoes = escolhidos.map((c) => c || livres.shift());

  const id = await transacao(async () => {
    let codigo;
    do codigo = Array.from({ length: 6 }, () => ALFABETO[randomInt(ALFABETO.length)]).join('');
    while (await db.get('SELECT 1 FROM TB_PARTIDA WHERE codigo_online = ?', codigo));
    const { lastInsertRowid } = await db.run(`INSERT INTO TB_PARTIDA (status, codigo_online, unidade, id_mediador, vez, continua)
                                              VALUES ('Em Andamento', ?, ?, ?, 0, ?)`, codigo, usuario.unidade, usuario.id_usuario, continua ? 1 : 0);
    await db.lote(ids.map((idJogador, ordem) => ({
      sql: 'INSERT INTO TB_JOGADOR_PARTIDA (id_partida, id_jogador, ordem, peao, rota) VALUES (?, ?, ?, ?, ?)',
      args: [lastInsertRowid, idJogador, ordem, peoes[ordem], rotas[ordem]],
    })));
    return lastInsertRowid;
  });
  return estado(id);
}

// §4.3 — RF04: o servidor sorteia o dado e o peão anda pela rota do jogador.
// Só a casa com pergunta deixa a jogada pendente: Chegou! abre a premiação, a caveira elimina e a amarela só passa a vez.
export const lancarDado = (id, idJogador) => acao(id, async ({ p, etapa }) => {
  const j = await db.get(`SELECT id_jogador, casa_atual, rota FROM TB_JOGADOR_PARTIDA WHERE id_partida = ? AND ordem = ? AND ${JOGANDO}`,
    p.id_partida, p.vez);
  conferirTela(idJogador, j?.id_jogador);
  exigirEtapa(etapa, 'dado');
  const v = sorteio.dado();
  const rota = ROTAS[j.rota];
  const casaFinal = rota[Math.min(rota.indexOf(j.casa_atual) + v, rota.length - 1)];
  const casa = await db.get('SELECT tipo, cor, icone, id_categoria FROM TB_CASA WHERE numero = ?', casaFinal);
  const acaoCasa = acaoDaCasa(casa);
  await db.run(`INSERT INTO TB_JOGADA (id_partida, id_jogador, valor_dado, casa_inicial, casa_final, id_categoria, concluida)
                VALUES (?, ?, ?, ?, ?, ?, ?)`, p.id_partida, j.id_jogador, v, j.casa_atual, casaFinal, casa.id_categoria, acaoCasa === 'pergunta' ? 0 : 1);
  // Partida contínua: Chegou! e caveira tiram só este jogador do tabuleiro (chaveiro na hora) e a partida segue.
  const terminou = p.continua && (acaoCasa === 'chegada' || acaoCasa === 'morte') ? agora() : null;
  await db.run('UPDATE TB_JOGADOR_PARTIDA SET casa_atual = ?, eliminado = ?, terminou_em = ? WHERE id_partida = ? AND id_jogador = ?',
    casaFinal, acaoCasa === 'morte' ? 1 : 0, terminou, p.id_partida, j.id_jogador);
  if (acaoCasa === 'chegada' && !p.continua) await irParaPremiacao(p.id_partida);
  else if (acaoCasa !== 'pergunta') await passarVez(p);
});

// Partida contínua: o próximo visitante entra no fim da fila de vez, numa cor livre, e começa no INÍCIO.
// No máximo 4 no tabuleiro; cada visitante joga uma vez na partida (a chave é partida + jogador).
export const adicionarJogador = (id, idJogador, peao, rota = 'esquerda') => acao(id, async ({ p, etapa }) => {
  if (!p.continua) throw erro(409, 'Só a partida contínua recebe jogadores depois de começar.');
  if (!EM_JOGO.includes(p.status)) throw erro(409, FORA_DE_HORA[etapa]);
  const idj = inteiro(idJogador);
  if (!(await db.get('SELECT 1 FROM TB_JOGADOR WHERE id_jogador = ?', idj))) throw erro(400, 'Jogador não encontrado.');
  if (await db.get('SELECT 1 FROM TB_JOGADOR_PARTIDA WHERE id_partida = ? AND id_jogador = ?', p.id_partida, idj)) {
    throw erro(409, 'Este jogador já jogou nesta partida.');
  }
  if (!PEOES.includes(peao)) throw erro(400, 'Peão inválido: escolha verde, vermelho, azul ou amarelo.');
  if (!Object.keys(ROTAS).includes(rota)) throw erro(400, 'Rota inválida: escolha esquerda, centro ou direita.');
  const naMesa = await db.all('SELECT peao FROM TB_JOGADOR_PARTIDA WHERE id_partida = ? AND ativo = 1 AND terminou_em IS NULL', p.id_partida);
  if (naMesa.length >= PEOES.length) throw erro(409, 'O tabuleiro já tem 4 jogadores: espere alguém terminar.');
  if (naMesa.some((j) => j.peao === peao)) throw erro(409, 'Esta cor de peão está em jogo: escolha outra.');
  const { ordem } = await db.get('SELECT COALESCE(MAX(ordem), -1) + 1 AS ordem FROM TB_JOGADOR_PARTIDA WHERE id_partida = ?', p.id_partida);
  await db.run('INSERT INTO TB_JOGADOR_PARTIDA (id_partida, id_jogador, ordem, peao, rota) VALUES (?, ?, ?, ?, ?)', p.id_partida, idj, ordem, peao, rota);
  // Ninguém mais jogando: a vez é dele
  if (!(await db.get(`SELECT 1 FROM TB_JOGADOR_PARTIDA WHERE id_partida = ? AND id_jogador <> ? AND ${JOGANDO}`, p.id_partida, idj))) {
    await db.run('UPDATE TB_PARTIDA SET vez = ? WHERE id_partida = ?', ordem, p.id_partida);
  }
});

// §4.4 — RF05 + RF06: pergunta aleatória e inédita da categoria da casa, gravada na hora
export const sortear = (id, idJogada) => acao(id, async ({ p, pendente, etapa }) => {
  conferirTela(idJogada, pendente?.id_jogada);
  exigirEtapa(etapa, 'sortear');
  const cat = pendente.id_categoria ?? await categoriaInedita(p.id_partida);
  const pergunta = cat != null && await perguntaInedita(p.id_partida, cat);
  if (!pergunta) {
    const nome = cat != null && (await db.get('SELECT nome FROM TB_CATEGORIA WHERE id_categoria = ?', cat)).nome;
    const msg = nome ? `Não há mais perguntas inéditas da categoria ${nome} nesta partida.` : 'Não há mais perguntas inéditas nesta partida.';
    throw Object.assign(erro(409, msg), { sem_perguntas: true });
  }
  await db.run('UPDATE TB_JOGADA SET id_categoria = ?, id_pergunta = ? WHERE id_jogada = ?', cat, pergunta.id_pergunta, pendente.id_jogada);
});

// §4.5: sem pergunta inédita, conclui a jogada sem pontos e passa a vez
export const pular = (id, idJogada) => acao(id, async ({ p, pendente, etapa }) => {
  conferirTela(idJogada, pendente?.id_jogada);
  exigirEtapa(etapa, 'sortear');
  if (await temInedita(p.id_partida, pendente.id_categoria)) throw erro(409, 'Ainda há perguntas inéditas para esta jogada: sorteie a pergunta.');
  await concluir(pendente, null, 0);
  await passarVez(p);
});

// §4.6 — RF07: o servidor corrige a alternativa escolhida e soma os pontos dela. Sem pontos, o peão fica na casa.
export const responder = (id, alternativa, idJogada) => acao(id, async ({ p, pendente, etapa }) => {
  conferirTela(idJogada, pendente?.id_jogada);
  exigirEtapa(etapa, 'responder');
  const escolhida = typeof alternativa === 'string'
    && await db.get('SELECT letra, pontos FROM TB_ALTERNATIVA WHERE id_pergunta = ? AND letra = ?', pendente.id_pergunta, alternativa);
  if (!escolhida) throw erro(400, 'Escolha uma das alternativas: A, B, C ou D.');
  await concluir(pendente, escolhida.pontos > 0 ? 1 : 0, escolhida.pontos, escolhida.letra);
  await db.run('UPDATE TB_JOGADOR_PARTIDA SET pontuacao = pontuacao + ? WHERE id_partida = ? AND id_jogador = ?',
    escolhida.pontos, p.id_partida, pendente.id_jogador);
  await passarVez(p);
});

// §4.8 — Mediador: "iniciar, pausar e controlar o tempo"
export const pausar = (id) => acao(id, async ({ p, etapa }) => {
  if (p.status !== 'Em Andamento') throw erro(409, p.status === 'Pausada' ? 'A partida já está pausada.' : FORA_DE_HORA[etapa]);
  await db.run("UPDATE TB_PARTIDA SET status = 'Pausada', pausada_em = ? WHERE id_partida = ?", agora(), p.id_partida);
});

export const retomar = (id) => acao(id, async ({ p }) => {
  if (p.status !== 'Pausada') throw erro(409, 'A partida não está pausada.');
  await db.run(`UPDATE TB_PARTIDA SET status = 'Em Andamento', segundos_pausados = segundos_pausados + (? - pausada_em), pausada_em = NULL
                WHERE id_partida = ?`, agora(), p.id_partida);
});

// §4.9: fim por tempo — conclui a jogada pendente sem pontos, contabiliza a pausa e vai para a premiação
export const encerrar = (id) => acao(id, async ({ p, pendente, etapa }) => {
  if (!EM_JOGO.includes(p.status)) throw erro(409, FORA_DE_HORA[etapa]);
  if (pendente) await concluir(pendente, null, 0);
  await irParaPremiacao(p.id_partida);
});

// §4.12 — RF08 (um brinde por jogador por partida) + RF09 (baixa automática no estoque)
// Partida contínua: quem terminou recebe na hora, com a partida em jogo.
export const entregarBrinde = (id, idJogador, usuario) => acao(id, async ({ p, etapa }) => {
  const naHora = p.continua && EM_JOGO.includes(p.status);
  if (etapa !== 'premiacao' && !naHora) throw erro(409, etapa === 'finalizada' ? FORA_DE_HORA.finalizada : 'O brinde só é entregue ao final da partida.');
  const j = await jogadorDaPartida(p.id_partida, idJogador);
  if (etapa !== 'premiacao' && j.terminou_em == null) throw erro(409, 'O chaveiro é entregue quando o jogador termina: no Chegou! ou na Casa da Morte.');
  if (await db.get('SELECT 1 FROM TB_ENTREGA_BRINDE WHERE id_partida = ? AND id_jogador = ?', p.id_partida, j.id_jogador)) {
    throw erro(409, 'Este jogador já recebeu o brinde desta partida.');
  }
  const b = await brindeDaPontuacao(j.pontuacao);
  if (!b) throw erro(409, 'Nenhum brinde cadastrado para a pontuação deste jogador.');
  // RF09: só dá baixa se houver unidade; com estoque zero nada é gravado
  const baixa = await db.run('UPDATE TB_BRINDE SET quantidade_estoque = quantidade_estoque - 1 WHERE id_brinde = ? AND quantidade_estoque > 0',
    b.id_brinde);
  if (!baixa.changes) throw erro(409, `O "${b.nome}" esgotou! Não há unidades na mesa.`);
  await db.run('INSERT INTO TB_ENTREGA_BRINDE (id_partida, id_jogador, id_brinde, id_usuario) VALUES (?, ?, ?, ?)',
    p.id_partida, j.id_jogador, b.id_brinde, usuario.id_usuario);
  if (etapa === 'premiacao') await finalizarSeTodosReceberam(p.id_partida);
});

// §4.13 — Admin: mover peão dentro da rota do jogador (sem jogada pendente, partida em jogo).
// A casa de destino não tem efeito. Mover um eliminado o devolve ao jogo, por decisão do administrador.
export const moverPeao = (id, idJogador, casa) => acao(id, async ({ p, pendente, etapa }) => {
  if (!EM_JOGO.includes(p.status)) throw erro(409, FORA_DE_HORA[etapa]);
  if (pendente) throw erro(409, 'Conclua a jogada atual antes de mover um peão.');
  const j = await jogadorDaPartida(p.id_partida, idJogador);
  if (j.terminou_em != null) throw erro(409, 'Este jogador já terminou a partida.');
  const c = inteiro(casa);
  if (c === CASA_CHEGADA || !ROTAS[j.rota].includes(c)) throw erro(400, 'A casa deve fazer parte da rota deste jogador e não pode ser o Chegou!.');
  await db.run('UPDATE TB_JOGADOR_PARTIDA SET casa_atual = ?, eliminado = 0 WHERE id_partida = ? AND id_jogador = ?', c, p.id_partida, j.id_jogador);
});

// §4.13 — Admin: remover jogador (ativo = 0); nunca o último ativo; só com a partida em jogo.
// A7/RF08: na premiação a remoção finalizaria a partida sem premiar todos — lá vale a reposição do estoque (§11 nº 14).
export const removerJogador = (id, idJogador) => acao(id, async ({ p, pendente, etapa }) => {
  if (!EM_JOGO.includes(p.status)) throw erro(409, FORA_DE_HORA[etapa]);
  if (pendente) throw erro(409, 'Conclua a jogada atual antes de remover um jogador.');
  const j = await jogadorDaPartida(p.id_partida, idJogador);
  if (j.terminou_em != null) throw erro(409, 'Este jogador já terminou a partida.');
  const ativos = (await db.get('SELECT COUNT(*) AS n FROM TB_JOGADOR_PARTIDA WHERE id_partida = ? AND ativo = 1', p.id_partida)).n;
  if (ativos === 1 && !p.continua) throw erro(409, 'Não é possível remover o último jogador da partida.'); // a contínua fica aguardando
  await db.run('UPDATE TB_JOGADOR_PARTIDA SET ativo = 0 WHERE id_partida = ? AND id_jogador = ?', p.id_partida, j.id_jogador);
  if (j.ordem === p.vez) await passarVez(p);
});
