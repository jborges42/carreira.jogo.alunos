// Tela da partida (/partida/:id) — RF04 a RF09, RNF01 a RNF03, RNF06.
// Tudo é desenhado a partir do objeto "estado" da API (GET inicial e resposta de cada ação):
// recarregar a página (F5) volta exatamente na mesma etapa e na mesma vez.
import { api, iniciarPagina, toast, esc, formatarTempo, ehAdmin, valorDaPergunta, resultadoJogada } from '/js/app.js';
import { criarTabuleiro, peaoSVG, CORES_PEAO, NOMES_ROTA } from '/js/tabuleiro.js';

const usuario = await iniciarPagina({ menu: 'partidas' });
const id = location.pathname.split('/')[2];
const $ = (s) => document.querySelector(s);
const jogo = $('#jogo'), ov = $('#pergunta'), admJogador = $('#adm-jogador'), admCasa = $('#adm-casa');

// Cor de cada casa do tabuleiro: adjetivo para o texto + amostra (as 4 primeiras são as categorias do RF05).
const CORES_CASA = {
  amarelo: ['amarela', '#F2C200'], azul: ['azul', '#1E88E5'], vermelho: ['vermelha', '#E53935'], verde: ['verde', '#2E9E44'],
  roxo: ['roxa', '#A83DE0'], rosa: ['rosa', '#FF5FB3'], preto: ['preta', '#16181D'],
};
const ICONES = { '?': 'interrogação', '!': 'exclamação', '-': 'sinal de menos' };

let tabuleiro, tab, estado, ocupado = false;
let relogio = { base: 0, desde: 0, rodando: false };
let vigia = 0; // timer da premiação (A9)
let acoes = 0; // A9: conta as ações; o GET da vigia que saiu antes de uma ação traz o estado anterior a ela

const msgErro = (e) => (e.status ? e.message : 'Sem conexão com o servidor. Confira a rede e tente de novo.');
const ativos = () => estado.jogadores.filter((j) => j.ativo);
// Partida contínua: quem chegou ou caiu na caveira sai do tabuleiro (terminou_em) e recebe o chaveiro na hora.
const naMesa = () => ativos().filter((j) => j.terminou_em == null);
const terminaram = () => ativos().filter((j) => j.terminou_em != null).sort((a, b) => b.terminou_em - a.terminou_em);
const comApelido = (j) => `${esc(j.nome)}${j.apelido ? ` <small>(${esc(j.apelido)})</small>` : ''}`;
const peao = (cor) => `<span class="peao-mini">${peaoSVG(cor)}</span>`;
// Texto escuro sobre cor clara (amarelo #F2C200), branco nas demais — brilho YIQ.
function corClara(hex) {
  const n = parseInt(String(hex).slice(1), 16);
  return ((n >> 16) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000 > 150;
}

// ---------- Pedaços do painel ----------
function blocoVez() {
  const j = estado.jogador_da_vez;
  if (!j) return '';
  return `<div class="vez" style="--peao:${CORES_PEAO[j.peao]?.corpo || '#999'}">${peaoSVG(j.peao)}
    <div><span class="vez-rotulo">Vez de:</span> <strong class="vez-nome">${esc(j.nome)}</strong>
    ${j.apelido ? `<span class="vez-apelido">(${esc(j.apelido)})</span>` : ''}</div></div>`;
}

// RF04: quem sorteia é o servidor.
const botaoDado = (desligado) => `<button class="btn btn-primario btn-grande" data-acao="lancar" ${desligado ? 'disabled' : ''}>🎲 Girar o dado</button>`;

// Resultado da última jogada (a chegada ao fim aparece na premiação, que é para onde ela leva).
function feedback() {
  const u = estado.ultima_jogada;
  if (!u) return '';
  const { tipo, html } = resultadoJogada(u, `<strong>${esc(u.nome)}</strong>`);
  return `<div class="aviso ${tipo ? `aviso-${tipo}` : ''} feedback">${html}</div>`;
}

// "NOME tirou 4: casa 2 → casa 6" + cor/ícone da casa e categoria.
function movimento() {
  const jp = estado.jogada_pendente;
  const dono = estado.jogadores.find((j) => j.id_jogador === jp.id_jogador);
  const [adjetivo, amostra] = CORES_CASA[jp.casa.cor] || ['', '#fff'];
  const icone = jp.casa.icone ? `, com ${esc(ICONES[jp.casa.icone] || jp.casa.icone)}` : '';
  const categoria = jp.categoria
    ? `Categoria: <strong>${esc(jp.categoria.nome)}</strong>${jp.casa.sorteada ? ' (sorteada)' : ''}`
    : 'Casa surpresa: categoria será sorteada';
  return `<p class="movimento"><strong>${esc(dono?.nome)}</strong> tirou <span class="num-dado">${jp.valor_dado}</span>:
      casa ${jp.casa_inicial} → casa ${jp.casa_final}</p>
    <div class="casa-info"><span class="amostra" style="background:${amostra}"></span>
      <div><strong>Casa ${jp.casa_final}${adjetivo ? ` (${adjetivo}${icone})` : ''}</strong><br>${categoria}</div></div>`;
}

const linkCertificado = (j) => `<a class="btn btn-pequeno" href="/partida/${id}/certificado/${j.id_jogador}" target="_blank" rel="noopener">Certificado</a>`;

// RF08: cargo alcançado em destaque + nome do brinde como o administrador cadastrou (A10, igual ao Estoque).
function cartaoPremio(j) {
  const b = j.brinde;
  const zero = b && b.quantidade_estoque <= 0;
  let acao = '';
  if (j.entregue) acao = '<div class="entregue-ok">Entregue ✓</div>';
  else if (zero) acao = `<div class="alerta-esgotado" role="alert">ESGOTADO</div>
      <p class="suave">O "${esc(b.nome)}" esgotou! Não há unidades na mesa.</p>
      <button class="btn btn-primario" disabled>Confirmar Entrega</button>`;
  else if (b) acao = `<button class="btn btn-primario" data-acao="entregas" data-jogador="${j.id_jogador}">Confirmar Entrega</button>`;
  return `<article class="premio${j.entregue ? ' entregue' : zero ? ' esgotado' : ''}">
    <div class="premio-jogador">${peao(j.peao)}<div class="nome">${comApelido(j)}</div></div>
    ${j.eliminado ? '<span class="selo selo-eliminado">☠ Saiu na Casa da Morte</span>' : ''}
    <p><strong class="casa-final">${j.pontuacao}</strong> pontos · Casa final: <strong>${j.casa_atual}</strong></p>
    ${b ? `<p class="rotulo-cargo">Cargo alcançado</p><p class="cargo">${esc(b.cargo)}</p>
      <img class="chaveiro" src="/img/chaveiro-centro.png" alt="Chaveiro" width="140" height="140" decoding="async">
      <p class="nivel">${esc(b.nome)}</p>
      <p class="suave">Estoque: ${b.quantidade_estoque} ${b.quantidade_estoque === 1 ? 'unidade' : 'unidades'}</p>`
      : '<p class="aviso aviso-alerta">Nenhum brinde configurado para esta pontuação.</p>'}
    ${acao}
    ${linkCertificado(j)}
  </article>`;
}

// ---------- Etapas (derivadas pelo servidor) ----------
const ETAPAS = {
  dado: () => `${blocoVez()}${feedback()}${botaoDado(false)}`,

  sortear: () => {
    const jp = estado.jogada_pendente;
    return `${blocoVez()}${movimento()}${jp.sem_perguntas
      ? `<div class="aviso aviso-alerta">Não há mais perguntas inéditas
          ${jp.categoria ? `da categoria ${esc(jp.categoria.nome)}` : 'em nenhuma categoria'} nesta partida.</div>
        <button class="btn btn-azul btn-grande" data-acao="pular">Passar a vez</button>`
      : `<button class="btn btn-primario btn-grande btn-sortear" data-acao="sortear">
          <img src="/img/verso-carta.jpg" alt="">Sortear Pergunta</button>`}`;
  },

  // A pergunta aparece na sobreposição de tela cheia (renderPergunta).
  responder: () => `${blocoVez()}${movimento()}`,

  aguardando: () => `<div class="aviso aviso-alerta">Ninguém está jogando agora: coloque o próximo visitante em
      <strong>Entrar na partida</strong>.</div>${feedback()}`,

  pausada: () => `<div class="pausada"><strong>Partida pausada</strong><span>O cronômetro está parado.</span>
      <button class="btn btn-primario btn-grande" data-acao="retomar">Retomar</button></div>
    ${blocoVez()}${estado.jogada_pendente ? movimento() : feedback() + botaoDado(true)}`,

  premiacao: () => {
    const u = estado.ultima_jogada;
    // A jogada que encerrou a partida mostra o número sorteado: a tela não passa pela etapa de dado de novo.
    const ultimoDado = ['chegada', 'morte'].includes(u?.casa.acao) ? resultadoJogada(u, `<strong>${esc(u.nome)}</strong>`).html : '';
    const motivo = estado.partida.continua ? 'A partida contínua foi encerrada.'
      : u?.casa.acao === 'chegada' ? ultimoDado
      : ativos().every((j) => j.eliminado) ? `${ultimoDado} Todos os jogadores caíram na Casa da Morte.` : 'A partida foi encerrada.';
    return `<h2 class="titulo-etapa">Premiação</h2>
      <div class="aviso aviso-ok">${motivo}
        Entregue o chaveiro de cada jogador e toque em <strong>Confirmar Entrega</strong>.</div>
      <div class="premios">${ativos().map(cartaoPremio).join('')}</div>`;
  },

  finalizada: () => {
    const ranking = ativos().sort((a, b) => b.pontuacao - a.pontuacao || a.faltam - b.faltam);
    return `<h2 class="titulo-etapa">Partida finalizada</h2>
      <p>Todos os brindes foram entregues. Tempo de jogo: <strong>${formatarTempo(estado.partida.tempo_decorrido_s)}</strong>.</p>
      <ol class="ranking">${ranking.map((j, i) => `<li${i === 0 ? ' class="primeiro"' : ''}>
        <span class="pos">${i + 1}º</span>${peao(j.peao)}<span class="nome">${comApelido(j)}</span>
        <span class="cargo">${esc(j.brinde?.cargo ?? '—')}</span>
        <span><b>${j.pontuacao}</b> pts</span> ${linkCertificado(j)}</li>`).join('')}</ol>
      <a class="btn btn-primario btn-grande" href="/nova-partida">Nova Partida</a>`;
  },
};

// ---------- Renderização ----------
function cabecalho() {
  const { partida: p, etapa } = estado;
  const codigo = esc(p.codigo_online);
  const emJogo = p.status === 'Em Andamento' || p.status === 'Pausada';
  // Partida contínua: o telão da feira é o automático, que segue sempre a partida mais recente.
  const telao = p.continua ? '/acompanhar/atual' : `/acompanhar/${codigo}`;
  return `<h1 class="titulo-pagina">Partida #${p.id_partida}</h1>
    <span class="selo status" data-status="${esc(p.status)}">${esc(p.status)}</span>
    ${p.continua ? '<span class="chip">Partida contínua</span>' : ''}
    <span class="chip">Código da sessão <span class="codigo">${codigo}</span>
      <a class="btn btn-pequeno" href="${telao}" target="_blank" rel="noopener">Abrir telão</a></span>
    <span class="chip cronometro">Tempo <strong id="cronometro">00:00</strong></span>
    <span class="cab-acoes">
      ${etapa === 'pausada' ? '<button class="btn btn-primario" data-acao="retomar">Retomar</button>'
        : p.status === 'Em Andamento' ? '<button class="btn" data-acao="pausar">Pausar</button>' : ''}
      ${emJogo ? '<button class="btn btn-perigo" data-acao="encerrar">Encerrar partida</button>' : ''}
    </span>`;
}

const linhaPlacar = (j) => `<li class="${j.da_vez ? 'da-vez' : ''}${j.ativo && !j.eliminado ? '' : ' inativo'}">
    ${peao(j.peao)}
    <span class="nome">${comApelido(j)}${j.ativo ? '' : ' <small>(removido)</small>'}${j.eliminado ? ' <small>(☠ fora do jogo)</small>' : ''}</span>
    <span>Casa <b>${j.casa_atual}</b> <small>${NOMES_ROTA[j.rota]}</small></span>
    <span class="pontos"><b>${j.pontuacao}</b> pts</span>
    ${j.brinde ? `<span class="selo">${esc(j.brinde.cargo)}</span>` : ''}
  </li>`;

function renderAdmin() {
  const { etapa } = estado;
  $('#admin').hidden = !ehAdmin(usuario) || etapa === 'premiacao' || etapa === 'finalizada';
  if ($('#admin').hidden) return;
  const lista = naMesa(), antes = admJogador.value;
  admJogador.innerHTML = lista.map((j) => `<option value="${j.id_jogador}">${esc(j.nome)} (casa ${j.casa_atual}, ${NOMES_ROTA[j.rota]}${j.eliminado ? ', fora do jogo' : ''})</option>`).join('');
  if (lista.some((j) => String(j.id_jogador) === antes)) admJogador.value = antes;
  admCasa.value = lista.find((j) => String(j.id_jogador) === admJogador.value)?.casa_atual ?? '';
  // Só entre jogadas: Em Andamento/Pausada sem jogada pendente (regra 13 da especificação).
  const livre = etapa === 'dado' || (etapa === 'pausada' && !estado.jogada_pendente);
  $('#admin').querySelectorAll('button').forEach((b) => (b.disabled = !livre));
  $('#adm-dica').textContent = livre
    ? 'A casa precisa ser da rota do jogador. Mover quem está fora do jogo o devolve à partida.'
    : 'Disponível apenas entre jogadas (antes de lançar o dado).';
}

// RF05: sobreposição de tela cheia com o fundo na cor da categoria, enunciado em destaque e as 4 alternativas.
function renderPergunta() {
  const jp = estado.jogada_pendente;
  const aberta = estado.etapa === 'responder' && !!jp?.pergunta;
  document.body.classList.toggle('sem-rolagem', aberta);
  ov.hidden = !aberta;
  $('#topo').inert = $('#partida').inert = aberta; // A34: aria-modal de verdade, o Tab não sai da pergunta
  if (!aberta) { ov.innerHTML = ''; return; }
  const { categoria: c, pergunta: p } = jp;
  const cor = c?.cor_hex || '#1f6fd1';
  ov.style.setProperty('--cat', cor);
  ov.classList.toggle('escuro', corClara(cor));
  // A1: tudo fica em .pergunta-conteudo, a área que rola: com pergunta longa, nenhuma alternativa fica inalcançável.
  ov.innerHTML = `
    <div class="pergunta-conteudo" tabindex="-1">
      <div class="pergunta-topo">
        <span class="pergunta-categoria">${esc(c?.nome)}</span>
        <span class="pergunta-meta">Vez de: ${esc(estado.jogador_da_vez?.nome)} · casa ${jp.casa_final} · ${valorDaPergunta(p)}</span>
        <button class="btn btn-pequeno" data-acao="pausar">Pausar</button>
      </div>
      <p class="enunciado" id="enunciado">${esc(p.enunciado)}</p>
      <div class="alternativas">${p.alternativas.map((a) => `
        <button class="btn botao-resposta alternativa" data-acao="resposta" data-letra="${a.letra}">
          <b class="letra">${a.letra}</b><span>${esc(a.texto)}</span></button>`).join('')}
      </div>
    </div>`;
  ov.querySelector('.pergunta-conteudo').focus(); // foco na área que rola: PageDown/setas rolam a pergunta
}

function desenharPeoes() {
  tab.atualizar(estado.jogadores.filter((j) => j.terminou_em == null), { destaque: estado.jogada_pendente?.casa_final ?? null });
}

// ---------- Partida contínua: entrar na partida e entregar o chaveiro de quem terminou ----------
let rotaEntrar = 'esquerda', encontrados = [], seqEntrar = 0, esperaEntrar;

function renderContinua() {
  const p = estado.partida;
  const emJogo = p.continua && (p.status === 'Em Andamento' || p.status === 'Pausada');
  $('#entrar').hidden = !emJogo;
  $('#terminaram').hidden = !emJogo || !terminaram().length;
  if (!emJogo) return;
  $('#terminaram-lista').innerHTML = terminaram().map(cartaoPremio).join('');
  const usadas = naMesa().map((j) => j.peao);
  const livres = Object.keys(CORES_PEAO).filter((cor) => !usadas.includes(cor));
  $('#entrar-rotas').innerHTML = `<span class="rotas-rotulo">Rota:</span>${Object.entries(NOMES_ROTA).map(([rota, nome]) =>
    `<button class="opcao-rota" data-rota-entrar="${rota}" aria-pressed="${rota === rotaEntrar}">${nome}</button>`).join('')}`;
  $('#entrar-dica').textContent = livres.length
    ? 'Toque na cor do peão do visitante: ele entra no INÍCIO, na rota escolhida, e joga depois de quem já está na fila.'
    : 'O tabuleiro está cheio (4 jogadores): espere alguém terminar.';
  $('#entrar-lista').innerHTML = livres.length ? encontrados.slice(0, 8).map((j) => `<li>
      <div class="info"><strong class="nome">${esc(j.nome)}</strong>${j.apelido ? ` <span class="suave">(${esc(j.apelido)})</span>` : ''}
        <div class="suave">${esc(j.escola)}</div>${j.em_partida ? '<span class="selo selo-alerta">Em partida</span>' : ''}</div>
      <div class="peoes">${livres.map((cor) => `<button class="opcao-peao" data-acao="entrar" data-jogador="${j.id_jogador}" data-peao="${cor}"
        title="Entrar com o peão ${CORES_PEAO[cor].nome}">${peaoSVG(cor, `Entrar com o peão ${CORES_PEAO[cor].nome}`)}</button>`).join('')}</div>
    </li>`).join('') || '<li class="vazio">Nenhum visitante encontrado. <a href="/recepcao" target="_blank" rel="noopener">Cadastrar na Recepção</a></li>' : '';
}

// Sem busca, vêm os cadastrados mais recentes: quem acabou de passar pela Recepção.
async function buscarEntrar() {
  const n = ++seqEntrar;
  try {
    const lista = await api('GET', `/api/jogadores?q=${encodeURIComponent($('#entrar-busca').value.trim())}`);
    if (n === seqEntrar) { encontrados = lista; renderContinua(); }
  } catch (e) {
    toast(msgErro(e), 'erro');
  }
}
$('#entrar-busca').addEventListener('input', () => { clearTimeout(esperaEntrar); esperaEntrar = setTimeout(buscarEntrar, 300); });
$('#entrar-rotas').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-rota-entrar]');
  if (b) { rotaEntrar = b.dataset.rotaEntrar; renderContinua(); }
});

function tick() {
  const el = document.getElementById('cronometro');
  if (el) el.textContent = formatarTempo(relogio.base + (relogio.rodando ? (Date.now() - relogio.desde) / 1000 : 0));
}

function render(novo) {
  estado = novo;
  const { partida: p, etapa } = estado;
  document.title = `Partida #${p.id_partida} · Carreira em Jogo`;
  jogo.classList.toggle('fim', etapa === 'premiacao' || etapa === 'finalizada');
  $('#cab').innerHTML = cabecalho();
  $('#etapa').innerHTML = ETAPAS[etapa]?.() ?? '';
  $('#placar').innerHTML = estado.jogadores.filter((j) => j.terminou_em == null).map(linhaPlacar).join('');
  renderContinua();
  renderAdmin();
  renderPergunta();
  desenharPeoes();
  // Cronômetro local: parte do tempo do servidor e só corre com a partida Em Andamento.
  relogio = { base: p.tempo_decorrido_s, desde: Date.now(), rodando: p.status === 'Em Andamento' };
  tick();
  // A9: a vigia da premiação só roda nesta etapa.
  if (etapa !== 'premiacao') { clearInterval(vigia); vigia = 0; }
  else if (!vigia) vigia = setInterval(vigiarPremiacao, 5000);
}

// ---------- Ações ----------
async function carregar() {
  try {
    render(await api('GET', `/api/partidas/${id}`));
  } catch (e) {
    toast(msgErro(e), 'erro');
  }
}

// A9 (RF09): na premiação o estoque muda fora desta tela (reposição pelo administrador, entrega em outro tablet).
// Relê o estado a cada 5 s e só redesenha se algo mudou (não repete o aria-live nem tira o foco).
async function vigiarPremiacao() {
  if (ocupado) return;
  const n = acoes;
  try {
    // fetch direto (sem api()): a consulta automática não pode cobrir a tela com o spinner do RNF03
    const r = await fetch(`/api/partidas/${id}`);
    if (!r.ok) return; // falha passageira: a próxima consulta tenta de novo
    const novo = await r.json();
    // Houve ação depois que este GET saiu (ocupado ou acoes ≠ n): vale a resposta dela, este estado é anterior.
    if (!ocupado && n === acoes && JSON.stringify(novo) !== JSON.stringify(estado)) render(novo);
  } catch (e) {
    toast(msgErro(e), 'erro');
  }
}

// O dado gira por 0,8 s com números ao acaso. É só efeito: quem sorteia é o servidor, e depois vale o número dele.
function girarDado(botao) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return Promise.resolve();
  botao.classList.add('girando');
  const fim = Date.now() + 800;
  return new Promise((pronto) => {
    const giro = setInterval(() => {
      botao.textContent = `🎲 ${1 + Math.floor(Math.random() * 6)}`;
      if (Date.now() >= fim) { clearInterval(giro); pronto(); }
    }, 90);
  });
}

// Desliga todos os botões enquanto a requisição está no ar (evita clique duplo).
// efeito: animação que precisa terminar antes de redesenhar a tela.
async function acao(metodo, caminho, corpo, efeito) {
  if (ocupado) return;
  ocupado = true;
  acoes++;
  const botoes = [...document.querySelectorAll('button:not(:disabled)')];
  botoes.forEach((b) => (b.disabled = true));
  let novo, erro;
  try {
    novo = await api(metodo, `/api/partidas/${id}${caminho}`, corpo);
  } catch (e) {
    erro = e;
  }
  await efeito; // também no erro: o botão só religa depois de o dado parar de girar
  botoes.forEach((b) => (b.disabled = false));
  // A30: a trava dura mais ~400 ms depois de redesenhar, senão o 2º toque de um toque duplo aciona o botão novo.
  setTimeout(() => { ocupado = false; }, 400);
  if (!erro) return novo ? render(novo) : carregar();
  toast(msgErro(erro), 'erro');
  // 409 = a tela está atrás do servidor (ex.: sem perguntas inéditas, ação feita em outra aba/tablet): busca o estado atual.
  if (erro.status === 409) carregar();
}

document.addEventListener('click', (ev) => {
  const b = ev.target.closest('button[data-acao]');
  // A30: ignora o 2º clique de um clique duplo e o clique com a trava ligada.
  // A trava é conferida aqui, antes do confirm() de Encerrar/Remover: o confirm() segura o setTimeout que a solta
  // e o OK seria descartado sem aviso.
  if (!b || b.disabled || !estado || ev.detail > 1 || ocupado) return;
  const a = b.dataset.acao;
  // A23: dado e pergunta levam a vez/jogada que esta tela mostra; se a partida mudou, o servidor responde 409.
  const idJogada = estado.jogada_pendente?.id_jogada;
  if (a === 'lancar') {
    const rotulo = b.textContent, giro = girarDado(b);
    acao('POST', '/dado', { id_jogador: estado.jogador_da_vez?.id_jogador }, giro);
    // Se o servidor recusar, o botão volta ao normal; no sucesso, ele já terá sido redesenhado.
    return giro.then(() => { b.textContent = rotulo; b.classList.remove('girando'); });
  }
  if (a === 'resposta') return acao('POST', '/resposta', { alternativa: b.dataset.letra, id_jogada: idJogada });
  if (a === 'sortear' || a === 'pular') return acao('POST', `/${a}`, { id_jogada: idJogada });
  if (a === 'entregas') return acao('POST', '/entregas', { id_jogador: Number(b.dataset.jogador) });
  if (a === 'entrar') { // partida contínua: o visitante entra com a cor tocada
    $('#entrar-busca').value = '';
    return acao('POST', '/jogadores', { id_jogador: Number(b.dataset.jogador), peao: b.dataset.peao, rota: rotaEntrar }).then(buscarEntrar);
  }
  if (a === 'mover') {
    const casa = admCasa.valueAsNumber;
    if (!Number.isInteger(casa) || casa < 0) return toast('Informe o número da casa.', 'erro');
    return acao('PUT', `/jogadores/${admJogador.value}/casa`, { casa }); // o servidor confere se é da rota do jogador
  }
  if (a === 'remover') {
    const j = estado.jogadores.find((x) => String(x.id_jogador) === admJogador.value);
    if (j && confirm(`Remover ${j.nome} da partida?`)) acao('DELETE', `/jogadores/${j.id_jogador}`);
    return;
  }
  if (a === 'encerrar' && !confirm('Encerrar a partida agora? Os jogadores vão para a premiação com a pontuação atual.')) return;
  acao('POST', `/${a}`); // pausar, retomar, encerrar
});

admJogador.addEventListener('change', () => {
  admCasa.value = estado.jogadores.find((j) => String(j.id_jogador) === admJogador.value)?.casa_atual ?? '';
});

$('#numeros').addEventListener('change', (ev) => {
  tab = criarTabuleiro($('#tabuleiro'), tabuleiro, { numeros: ev.target.checked });
  desenharPeoes();
});

setInterval(tick, 1000);

// ---------- Início ----------
try {
  [tabuleiro, estado] = await Promise.all([api('GET', '/api/tabuleiro'), api('GET', `/api/partidas/${id}`)]);
} catch (e) {
  $('#partida').innerHTML = `<section class="cartao aviso-pagina">
    <h1>${e.status === 404 ? 'Partida não encontrada' : 'Não foi possível abrir a partida'}</h1>
    <p>${esc(msgErro(e))}</p>
    <a class="btn btn-primario" href="/partidas">Ver partidas em andamento</a></section>`;
}
if (estado) {
  tab = criarTabuleiro($('#tabuleiro'), tabuleiro);
  render(estado);
  if (estado.partida.continua) buscarEntrar();
}
