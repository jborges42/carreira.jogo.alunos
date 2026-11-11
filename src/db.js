// Banco de dados SQLite pelo libSQL (@libsql/client): o arquivo data/carreira.db no servidor local ou, na Vercel, um
// banco Turso (TURSO_DATABASE_URL + TURSO_AUTH_TOKEN) — lá o disco da função é só leitura e não guarda nada entre execuções.
// Schema = união do documento de Requisitos Funcionais (tabelas TB_*) com o Modelo Lógico
// (JOGADOR_PARTIDA, CATEGORIA, CASA_TABULEIRO, CARGO...). Ver docs/DOCUMENTACAO-CONSOLIDADA.md §7.
import { AsyncLocalStorage } from 'node:async_hooks';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hashSenha } from './senha.js';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const DB_PATH = process.env.DB_PATH || join(RAIZ, 'data', 'carreira.db');
const remoto = Boolean(process.env.TURSO_DATABASE_URL);
if (!remoto && process.env.VERCEL) {
  throw new Error('Na Vercel o banco é o Turso: conecte um banco Turso ao projeto (Storage) para criar TURSO_DATABASE_URL e TURSO_AUTH_TOKEN, e faça o redeploy.');
}
const naMemoria = DB_PATH === ':memory:'; // testes
if (!remoto && !naMemoria) mkdirSync(dirname(DB_PATH), { recursive: true });
// O cliente web (só fetch, sem módulo nativo) é o indicado pelo Turso para a Vercel; o de Node abre o arquivo local.
const { createClient } = await import(remoto ? '@libsql/client/web' : '@libsql/client');
const cliente = createClient(remoto
  ? { url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN }
  : { url: naMemoria ? ':memory:' : pathToFileURL(DB_PATH).href });

// Dentro de transacao(), as consultas vão para a transação da própria requisição: com o Turso, outras requisições
// rodam ao mesmo tempo na mesma instância e não podem cair nela.
const emTransacao = new AsyncLocalStorage();
const conexao = () => emTransacao.getStore() ?? cliente;
// NaN (de inteiro() inválido) vira NULL, como fazia o node:sqlite — o libSQL recusa NaN.
const valores = (args) => args.map((v) => (Number.isNaN(v) ? null : v));
const executar = (sql, args) => conexao().execute({ sql, args: valores(args) });

export const db = {
  get: async (sql, ...args) => (await executar(sql, args)).rows[0],
  all: async (sql, ...args) => (await executar(sql, args)).rows,
  run: async (sql, ...args) => {
    const r = await executar(sql, args);
    return { changes: r.rowsAffected, lastInsertRowid: Number(r.lastInsertRowid) };
  },
  // Vários comandos numa ida só ao banco (com o Turso, cada consulta é uma ida pela rede); atômico fora de transacao()
  lote: (comandos) => conexao().batch(comandos.map(({ sql, args = [] }) => ({ sql, args: valores(args) }))),
  exec: (sql) => cliente.executeMultiple(sql),
  close: () => cliente.close(),
};

// A fase 2 mudou o schema sem migração (o banco da fase 1 só tinha dados de teste). O banco antigo é recusado antes
// de qualquer CREATE; a coluna identifica a versão porque banco novo e banco muito antigo têm o mesmo user_version.
// Só existe banco da fase 1 em arquivo local.
if (!remoto && await db.get("SELECT 1 FROM pragma_table_info('TB_BRINDE') WHERE name = 'casa_minima'")) {
  db.close();
  throw new Error(`${DB_PATH} é da fase 1 e não é migrado. Pare o servidor, guarde esse arquivo em outra pasta (com -wal e -shm, se existirem) e inicie de novo.`);
}
if (!remoto) await db.exec('PRAGMA journal_mode = WAL;');
// Chaves estrangeiras: o libSQL local as confere sempre; o Turso, não (vem desligado e vale por conexão). Por isso o
// único efeito de que o app depende — o ON DELETE da exclusão de pergunta — é feito também no código (api.js).

await db.exec(`
CREATE TABLE IF NOT EXISTS TB_USUARIO (
  id_usuario INTEGER PRIMARY KEY AUTOINCREMENT,
  nome       TEXT NOT NULL,
  email      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  senha      TEXT NOT NULL,                       -- hash scrypt "salt:hash" (RNF04)
  perfil     TEXT NOT NULL CHECK (perfil IN ('Administrador','Mediador')),
  unidade    TEXT NOT NULL DEFAULT 'SENAI Videira'
);
CREATE TABLE IF NOT EXISTS TB_SESSAO (
  token      TEXT PRIMARY KEY,
  id_usuario INTEGER NOT NULL REFERENCES TB_USUARIO(id_usuario) ON DELETE CASCADE,
  criado_em  INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE IF NOT EXISTS TB_ESCOLA (                -- RF02
  id_escola INTEGER PRIMARY KEY AUTOINCREMENT,
  nome      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  cidade    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS TB_JOGADOR (               -- RF01 (+ apelido do levantamento / JOGADOR do modelo lógico)
  id_jogador INTEGER PRIMARY KEY AUTOINCREMENT,
  nome       TEXT NOT NULL,
  apelido    TEXT,
  email      TEXT,
  id_escola  INTEGER NOT NULL REFERENCES TB_ESCOLA(id_escola),
  criado_em  INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE IF NOT EXISTS TB_CATEGORIA (             -- CATEGORIA (modelo lógico)
  id_categoria INTEGER PRIMARY KEY,
  nome     TEXT NOT NULL UNIQUE,
  cor      TEXT NOT NULL,
  cor_hex  TEXT NOT NULL,
  mecanica TEXT NOT NULL DEFAULT 'Múltipla escolha'
);
CREATE TABLE IF NOT EXISTS TB_PERGUNTA (              -- RF10 (+ dificuldade da CARTA)
  id_pergunta  INTEGER PRIMARY KEY AUTOINCREMENT,
  enunciado    TEXT NOT NULL,
  resposta     TEXT NOT NULL,                          -- explicação mostrada depois de respondida
  id_categoria INTEGER NOT NULL REFERENCES TB_CATEGORIA(id_categoria),
  dificuldade  TEXT NOT NULL DEFAULT 'Médio' CHECK (dificuldade IN ('Fácil','Médio','Difícil'))
);
CREATE TABLE IF NOT EXISTS TB_ALTERNATIVA (           -- ALTERNATIVA (modelo lógico): os pontos de cada resposta
  id_pergunta INTEGER NOT NULL REFERENCES TB_PERGUNTA(id_pergunta) ON DELETE CASCADE,
  letra       TEXT NOT NULL CHECK (letra IN ('A','B','C','D')),
  texto       TEXT NOT NULL,
  pontos      INTEGER NOT NULL DEFAULT 0 CHECK (pontos >= 0),
  PRIMARY KEY (id_pergunta, letra)
);
CREATE TABLE IF NOT EXISTS TB_CASA (                  -- CASA_TABULEIRO / TIPO_CASA
  numero       INTEGER PRIMARY KEY,                    -- 0 = INÍCIO, 65 = Chegou!, 101+ = rota Centro, 201+ = rota Direita
  tipo         TEXT NOT NULL CHECK (tipo IN ('inicio','casa','chegada')),
  cor          TEXT,                                   -- cor pintada no tabuleiro
  icone        TEXT NOT NULL DEFAULT '',
  id_categoria INTEGER REFERENCES TB_CATEGORIA(id_categoria),  -- NULL em casa com pergunta = categoria sorteada
  x REAL NOT NULL, y REAL NOT NULL                     -- centro da casa em % da imagem
);
CREATE TABLE IF NOT EXISTS TB_BRINDE (                -- RF08/RF09 (CARGO do modelo lógico)
  id_brinde          INTEGER PRIMARY KEY AUTOINCREMENT,
  nome               TEXT NOT NULL UNIQUE,
  cargo              TEXT NOT NULL,
  pontos_minimos     INTEGER NOT NULL,
  quantidade_estoque INTEGER NOT NULL DEFAULT 0 CHECK (quantidade_estoque >= 0)
);
CREATE TABLE IF NOT EXISTS TB_PARTIDA (               -- RF03
  id_partida        INTEGER PRIMARY KEY AUTOINCREMENT,
  status            TEXT NOT NULL DEFAULT 'Em Andamento'
                    CHECK (status IN ('Em Andamento','Pausada','Premiação','Finalizada')),
  codigo_online     TEXT NOT NULL UNIQUE,
  unidade           TEXT NOT NULL DEFAULT 'SENAI Videira',
  id_mediador       INTEGER NOT NULL REFERENCES TB_USUARIO(id_usuario),
  vez               INTEGER NOT NULL DEFAULT 0,          -- ordem do jogador da vez
  iniciada_em       INTEGER NOT NULL DEFAULT (unixepoch()),
  encerrada_em      INTEGER,                             -- fim do jogo (início da premiação)
  finalizada_em     INTEGER,                             -- todos os brindes confirmados
  pausada_em        INTEGER,
  segundos_pausados INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS TB_JOGADOR_PARTIDA (       -- JOGADOR_PARTIDA (modelo lógico)
  id_partida INTEGER NOT NULL REFERENCES TB_PARTIDA(id_partida),
  id_jogador INTEGER NOT NULL REFERENCES TB_JOGADOR(id_jogador),
  ordem      INTEGER NOT NULL,
  peao       TEXT NOT NULL CHECK (peao IN ('verde','vermelho','azul','amarelo')),
  rota       TEXT NOT NULL DEFAULT 'esquerda' CHECK (rota IN ('esquerda','centro','direita')),
  casa_atual INTEGER NOT NULL DEFAULT 0 REFERENCES TB_CASA(numero),  -- FK ID_CASA_TABULEIRO (modelo lógico)
  pontuacao  INTEGER NOT NULL DEFAULT 0,
  ativo      INTEGER NOT NULL DEFAULT 1,               -- STATUS: 0 = removido da partida (sem brinde)
  eliminado  INTEGER NOT NULL DEFAULT 0,               -- 1 = caiu na Casa da Morte: não joga mais, mas recebe o brinde
  PRIMARY KEY (id_partida, id_jogador),
  UNIQUE (id_partida, ordem),
  UNIQUE (id_partida, peao)
);
CREATE TABLE IF NOT EXISTS TB_JOGADA (                -- RF04/RF07 (+ CARTA_PARTIDA via id_pergunta)
  id_jogada    INTEGER PRIMARY KEY AUTOINCREMENT,
  id_partida   INTEGER NOT NULL REFERENCES TB_PARTIDA(id_partida),
  id_jogador   INTEGER NOT NULL REFERENCES TB_JOGADOR(id_jogador),
  valor_dado   INTEGER NOT NULL CHECK (valor_dado BETWEEN 1 AND 6),
  casa_inicial INTEGER NOT NULL REFERENCES TB_CASA(numero),
  casa_final   INTEGER NOT NULL REFERENCES TB_CASA(numero),
  id_categoria INTEGER REFERENCES TB_CATEGORIA(id_categoria),
  id_pergunta  INTEGER REFERENCES TB_PERGUNTA(id_pergunta) ON DELETE SET NULL,
  alternativa  TEXT CHECK (alternativa IN ('A','B','C','D')),  -- a que o jogador escolheu
  acertou      INTEGER CHECK (acertou IN (0,1)),
  pontos       INTEGER NOT NULL DEFAULT 0,
  concluida    INTEGER NOT NULL DEFAULT 0,
  criado_em    INTEGER NOT NULL DEFAULT (unixepoch())
);
-- CARTA_PARTIDA: PK (ID_PARTIDA, ID_CARTA) do modelo lógico — a mesma pergunta não sai duas vezes na partida (RF06).
-- Vale também nos bancos já criados; jogadas com id_pergunta NULL continuam permitidas.
CREATE UNIQUE INDEX IF NOT EXISTS ux_jogada_pergunta ON TB_JOGADA(id_partida, id_pergunta);
CREATE TABLE IF NOT EXISTS TB_ENTREGA_BRINDE (        -- RF08 (+ id_partida p/ "1 por jogador por partida")
  id_entrega  INTEGER PRIMARY KEY AUTOINCREMENT,
  id_partida  INTEGER NOT NULL REFERENCES TB_PARTIDA(id_partida),
  id_jogador  INTEGER NOT NULL REFERENCES TB_JOGADOR(id_jogador),
  id_brinde   INTEGER NOT NULL REFERENCES TB_BRINDE(id_brinde),
  id_usuario  INTEGER REFERENCES TB_USUARIO(id_usuario),
  entregue_em INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (id_partida, id_jogador)
);
`);

const json = (arq) => JSON.parse(readFileSync(join(RAIZ, 'data', arq), 'utf8'));

export const ROTAS = json('tabuleiro.json').rotas; // sequência de casas de cada rota, do INÍCIO ao Chegou!
export const ID_ENTREVISTA = 5;
export const LETRAS = ['A', 'B', 'C', 'D'];
const PONTOS_DA_DIFICULDADE = { Fácil: 5, Médio: 10, Difícil: 15 };

// Ordem e cores: RF10 lista (Ética, Finanças, Rotinas, Gestão do Tempo) e RF05 lista
// (Vermelho, Verde, Azul, Amarelo) — pareadas pela posição. O exemplo do RF10 (CLT -> id 3) confirma Rotinas = 3.
const CATEGORIAS = [
  [1, 'Ética', 'Vermelho', '#E53935', 'Múltipla escolha'],
  [2, 'Finanças', 'Verde', '#2E9E44', 'Múltipla escolha'],
  [3, 'Rotinas', 'Azul', '#1E88E5', 'Múltipla escolha'],
  [4, 'Gestão do Tempo', 'Amarelo', '#F2C200', 'Múltipla escolha'],
  [ID_ENTREVISTA, 'Entrevista', 'Verde-escuro', '#0B7A3B', 'Nota por alternativa'],
];
// Casa amarela não tem pergunta; Finanças e Gestão do Tempo saem só nas casas-surpresa (roxo, rosa, preto sem caveira).
const CATEGORIA_DA_COR = { vermelho: 1, verde: ID_ENTREVISTA, azul: 3 };
// Hierarquia oficial; o chaveiro entregue é o do cargo alcançado. Faixas baixadas pelo usuário: sem pergunta na casa
// amarela, a tabela original (CEO em 180) ficava fora de alcance. Os 300 chaveiros (panorama geral §4.1) seguem a
// procura simulada (docs/DOCUMENTACAO-CONSOLIDADA.md §14).
const CARGOS = [
  ['Jovem Aprendiz', 0, 42], ['Estagiário', 10, 32], ['Coordenador', 20, 59], ['Gerente', 35, 72],
  ['Gerente Geral', 50, 41], ['Diretor de Área', 60, 27], ['Vice-Presidente', 70, 15], ['CEO', 80, 12],
];

// Pontos de cada alternativa: a correta vale pela dificuldade; na Entrevista, cada uma tem a sua nota.
const sqlAlternativas = (idPergunta, { alternativas, correta, notas, dificuldade }) => [
  { sql: 'DELETE FROM TB_ALTERNATIVA WHERE id_pergunta = ?', args: [idPergunta] },
  ...LETRAS.map((letra, i) => ({
    sql: 'INSERT INTO TB_ALTERNATIVA (id_pergunta, letra, texto, pontos) VALUES (?, ?, ?, ?)',
    args: [idPergunta, letra, alternativas[i], notas ? notas[i] : letra === correta ? PONTOS_DA_DIFICULDADE[dificuldade] : 0],
  })),
];
export const gravarAlternativas = (idPergunta, dados) => db.lote(sqlAlternativas(idPergunta, dados));

// Executa fn numa transação de escrita (RNF06: cada passo gravado de forma atômica).
export async function transacao(fn) {
  const tx = await cliente.transaction('write');
  try {
    const r = await emTransacao.run(tx, fn);
    await tx.commit();
    return r;
  } finally {
    tx.close(); // sem o commit (erro em fn), desfaz tudo
  }
}

// A6: seeds só na criação do banco ("populado na 1ª execução"): excluir todas as perguntas ou escolas
// não as traz de volta no próximo início. Banco novo = sem usuários, que o app nunca exclui (a marca era o
// PRAGMA user_version, mas o Turso não deixa gravá-lo). Numa transação de escrita e numa ida só ao banco: duas
// instâncias da Vercel subindo juntas não semeiam duas vezes, e um erro no meio desfaz tudo.
await transacao(async () => {
  if (await db.get('SELECT 1 FROM TB_USUARIO')) return;
  // Na Vercel o site é público e o README (também público) mostra as senhas padrão: lá elas são obrigatórias.
  if (remoto && !(process.env.SENHA_ADMIN && process.env.SENHA_MEDIADOR)) {
    throw new Error('Defina SENHA_ADMIN e SENHA_MEDIADOR nas variáveis de ambiente antes do primeiro acesso: as senhas padrão estão no README público.');
  }
  const lote = [];
  const inserir = (sql, ...linhas) => linhas.forEach((args) => lote.push({ sql, args }));
  inserir('INSERT INTO TB_USUARIO (nome, email, senha, perfil) VALUES (?, ?, ?, ?)',
    ['Prof. Carlos Alexandre dos Santos', 'professor@senai.com.br', hashSenha(process.env.SENHA_ADMIN || 'admin123'), 'Administrador'],
    ['Aprendiz Mediador', 'mediador@senai.com.br', hashSenha(process.env.SENHA_MEDIADOR || 'mediador123'), 'Mediador']);
  inserir('INSERT INTO TB_ESCOLA (nome, cidade) VALUES (?, ?)', ['SENAI Videira', 'Videira']);
  inserir('INSERT INTO TB_CATEGORIA (id_categoria, nome, cor, cor_hex, mecanica) VALUES (?, ?, ?, ?, ?)', ...CATEGORIAS);
  inserir('INSERT INTO TB_CASA (numero, tipo, cor, icone, id_categoria, x, y) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ...json('tabuleiro.json').casas.map((c) => [c.numero, c.tipo, c.cor, c.icone, CATEGORIA_DA_COR[c.cor] ?? null, c.x, c.y]));
  inserir('INSERT INTO TB_BRINDE (nome, cargo, pontos_minimos, quantidade_estoque) VALUES (?, ?, ?, ?)',
    ...CARGOS.map(([cargo, pontos, estoque]) => [`Chaveiro ${cargo}`, cargo, pontos, estoque]));
  if (existsSync(join(RAIZ, 'data', 'perguntas.json'))) {
    // Banco novo: os ids 1, 2, 3... estão livres e ligam cada pergunta às suas alternativas dentro do mesmo lote
    json('perguntas.json').forEach((p, i) => {
      const dificuldade = p.dificuldade || 'Médio';
      inserir('INSERT INTO TB_PERGUNTA (id_pergunta, enunciado, resposta, id_categoria, dificuldade) VALUES (?, ?, ?, ?, ?)',
        [i + 1, p.enunciado, p.resposta, p.id_categoria, dificuldade]);
      lote.push(...sqlAlternativas(i + 1, { ...p, dificuldade }));
    });
  }
  await db.lote(lote);
});
