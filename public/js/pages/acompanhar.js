// Telão / DataShow (pública): acompanha a partida pelo código da sessão.
// Atende o "consulta pontuação" do jogador e a plateia (perfil Espectador). Atualiza a cada 2 s.
// /acompanhar/atual: telão automático da feira, que segue sozinho a partida mais recente.
import { api, iniciarPagina, esc, valorDaPergunta, resultadoJogada } from '/js/app.js';
import { criarTabuleiro, peaoSVG, CORES_PEAO } from '/js/tabuleiro.js';

await iniciarPagina({ publica: true });

const $ = (id) => document.getElementById(id);
const codigo = (location.pathname.split('/')[2] || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const automatico = codigo === 'ATUAL'; // nenhum código de partida tem 5 letras
let tabuleiro;   // { atualizar } de criarTabuleiro
let ultimo = ''; // último estado desenhado: só redesenha quando algo muda

// ---------- Sem código: formulário ----------
const mensagem = (texto = '') => { $('msg').innerHTML = texto ? `<div class="aviso aviso-erro" role="alert">${esc(texto)}</div>` : ''; };

function entrada(erro) {
  $('telao').hidden = true;
  $('entrada').hidden = false;
  $('codigo').value = codigo;
  mensagem(erro);
  $('codigo').focus();
}

$('codigo').addEventListener('input', (ev) => {
  const v = ev.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  if (v !== ev.target.value) ev.target.value = v;
});
$('form-codigo').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const c = $('codigo').value;
  if (c.length !== 6) return mensagem('O código da partida tem 6 caracteres (letras e números).');
  location.href = `/acompanhar/${c}`;
});

// ---------- Com código: telão ----------
// O estado público já troca o nome pelo apelido em jogadores[]; usamos sempre esse nome (privacidade no telão).
const nomeDe = (e, id, padrao = '') => e.jogadores.find((j) => j.id_jogador === id)?.nome ?? padrao;
const ranking = (js) => [...js].sort((a, b) => b.pontuacao - a.pontuacao || a.faltam - b.faltam);
const seloCat = (c) => `<span class="selo selo-cat" style="background:${esc(c.cor_hex)}">${esc(c.nome)}</span>`;
const peao = (j) => peaoSVG(j.peao, j.nome); // peaoSVG já escapa o título

function pendente(e, p) {
  const cat = p.categoria;
  if (p.pergunta) {
    return `<article class="pergunta" style="--cor:${esc(cat?.cor_hex)}">
      <header><strong>${esc(cat?.nome)}</strong><span>${valorDaPergunta(p.pergunta)}</span></header>
      <p>${esc(p.pergunta.enunciado)}</p>
      <ol class="alternativas-telao">${p.pergunta.alternativas.map((a) => `<li><b>${a.letra}</b><span>${esc(a.texto)}</span></li>`).join('')}</ol>
    </article>`;
  }
  return `<div class="cartao jogada">
    <p><strong>${esc(nomeDe(e, p.id_jogador))}</strong> tirou <span class="dado-mini">${esc(p.valor_dado)}</span>:
      casa ${esc(p.casa_inicial)} → casa ${esc(p.casa_final)}</p>
    <p>${cat ? `Pergunta de ${seloCat(cat)}` : 'Casa surpresa: a categoria será sorteada!'}</p>
    ${p.sem_perguntas ? '<p class="aviso aviso-alerta">Não há mais perguntas inéditas desta categoria nesta partida.</p>' : ''}
  </div>`;
}

function feedback(e, u) {
  const { tipo, html } = resultadoJogada(u, `<strong>${esc(nomeDe(e, u.id_jogador, u.nome))}</strong>`);
  // Partida contínua: quem chega ou cai na caveira sai na hora, com o chaveiro do cargo alcançado.
  const saiu = e.partida.continua && ['chegada', 'morte'].includes(u.casa.acao) && e.jogadores.find((j) => j.id_jogador === u.id_jogador);
  const cargo = saiu?.brinde ? `<br>Cargo alcançado: <strong>${esc(saiu.brinde.cargo)}</strong>` : '';
  return `<div class="feedback ${tipo}">${html}${cargo}</div>`;
}

function podio(ativos) {
  return `<div class="cartao podio">${ranking(ativos).slice(0, 3).map((j, i) => `
    <div class="degrau d${i + 1}">${peao(j)}<strong>${esc(j.nome)}</strong><span class="cargo">${esc(j.brinde?.cargo ?? '')}</span><span>${esc(j.pontuacao)} pontos</span>
      <div class="bloco">${i + 1}º</div></div>`).join('')}</div>`;
}

function destaque(e, ativos) {
  const { etapa, jogador_da_vez: vez, jogada_pendente: pend, ultima_jogada: ult } = e;
  const partes = [];
  if (etapa === 'pausada') partes.push('<div class="faixa-status pausada">Partida pausada</div>');
  if (etapa === 'aguardando') partes.push('<div class="faixa-status">Aguardando o próximo visitante</div>');
  if (etapa === 'premiacao') {
    const chegou = ult?.casa.acao === 'chegada' ? `${esc(nomeDe(e, ult.id_jogador, ult.nome))} tirou ${esc(ult.valor_dado)} e chegou! ` : '';
    partes.push(`<div class="faixa-status premiacao">${chegou}Fim de jogo: hora da premiação!</div>`);
    if (ult?.casa.acao === 'morte' && ativos.every((j) => j.eliminado)) partes.push(feedback(e, ult));
  }
  if (etapa === 'finalizada') partes.push(`<div class="faixa-status">Partida finalizada</div>${podio(ativos)}`);
  if (vez && ['dado', 'sortear', 'responder'].includes(etapa)) {
    const j = { ...vez, nome: nomeDe(e, vez.id_jogador, vez.apelido || vez.nome) };
    partes.push(`<div class="vez" style="--cor-peao:${CORES_PEAO[vez.peao]?.corpo || 'var(--tinta)'}">
      ${peao(j)}<span>Vez de</span><strong>${esc(j.nome)}</strong></div>`);
  }
  // Em pausa, a pergunta some também do telão, como na tela do mediador: ninguém discute a resposta com o tempo parado.
  if (pend) partes.push(pendente(e, etapa === 'pausada' ? { ...pend, pergunta: null } : pend));
  if (['dado', 'pausada', 'aguardando'].includes(etapa) && !pend && ult) partes.push(feedback(e, ult));
  return partes.join('');
}

// Partida contínua: os últimos a terminar, do mais recente ao mais antigo.
const linhaTerminou = (j) => `
    <li>
      <span class="placar-peao">${peao(j)}</span>
      <span class="placar-nome">${esc(j.nome)}<small>${esc(j.brinde?.cargo || 'Sem cargo')}${j.entregue ? ' · entregue ✓' : ''}</small></span>
      <span class="placar-num"><small>Casa</small>${j.eliminado ? '☠' : '<span class="chegou">Chegou!</span>'}</span>
      <span class="placar-num"><small>Pontos</small>${esc(j.pontuacao)}</span>
    </li>`;

function placar(e, ativos) {
  const fim = e.etapa === 'premiacao' || e.etapa === 'finalizada';
  return (fim ? ranking(ativos) : ativos).map((j) => `
    <li class="${j.da_vez ? 'da-vez' : ''}">
      <span class="placar-peao">${peao(j)}</span>
      <span class="placar-nome">${esc(j.nome)}<small>${esc(j.brinde?.cargo || 'Sem cargo')}${j.eliminado ? ' · ☠ fora do jogo' : ''}${fim && j.entregue ? ' · entregue ✓' : ''}</small></span>
      <span class="placar-num"><small>Casa</small>${j.casa_atual === e.casa_chegada ? '<span class="chegou">Chegou!</span>' : esc(j.casa_atual)}</span>
      <span class="placar-num"><small>Pontos</small>${esc(j.pontuacao)}</span>
    </li>`).join('');
}

// O tabuleiro ocupa a altura que sobra abaixo do topo e do cabeçalho (o menu pode quebrar em 2 linhas).
// Em tela cheia o #telao vira o offsetParent, então offsetTop já desconta só o cabeçalho.
const ajustarAltura = () => $('telao').style.setProperty('--desconto', `${$('t-tabuleiro').offsetTop + 28}px`);
addEventListener('resize', ajustarAltura);

function desenhar(e) {
  ajustarAltura();
  if (automatico) { // a partida pode ter mudado
    $('t-codigo').textContent = e.partida.codigo_online;
    document.title = `Partida ${e.partida.codigo_online} · Carreira em Jogo`;
  }
  const ativos = e.jogadores.filter((j) => j.ativo !== false);
  // Partida contínua: no tabuleiro e no placar, só quem está jogando; quem terminou vai para "Terminaram".
  const naMesa = ativos.filter((j) => j.terminou_em == null);
  const terminaram = ativos.filter((j) => j.terminou_em != null).sort((a, b) => b.terminou_em - a.terminou_em);
  tabuleiro.atualizar(naMesa, { destaque: e.jogada_pendente?.casa_final ?? null });
  $('t-status').textContent = e.partida.status;
  $('t-status').dataset.status = e.partida.status;
  $('t-destaque').innerHTML = destaque(e, ativos);
  $('t-placar').innerHTML = placar(e, naMesa);
  $('t-terminaram-cartao').hidden = !terminaram.length;
  $('t-terminaram').innerHTML = terminaram.map(linhaTerminou).join('');
}

// fetch direto (sem api()): a consulta automática não deve cobrir o telão com o spinner do RNF03.
async function atualizar() {
  if (!document.hidden) {
    try {
      const url = automatico ? '/api/publico/atual' : `/api/publico/partidas/${codigo}`;
      const r = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout?.(8000) });
      if (r.status === 404 && automatico) { // nenhuma partida ainda: espera a primeira
        $('t-destaque').innerHTML = '<div class="faixa-status">Aguardando a primeira partida</div>';
        $('t-conexao').hidden = true;
        return setTimeout(atualizar, 2000);
      }
      if (r.status === 404) return entrada('Partida não encontrada.');
      if (!r.ok) throw new Error(`Erro ${r.status}`);
      const estado = await r.json();
      $('t-conexao').hidden = true;
      // tempo_decorrido_s muda a cada segundo; ignorá-lo evita redesenhar (e reiniciar animações) sem mudança no jogo.
      const chave = JSON.stringify({ ...estado, partida: { ...estado.partida, tempo_decorrido_s: 0 } });
      if (chave !== ultimo) { ultimo = chave; desenhar(estado); }
    } catch {
      $('t-conexao').hidden = false; // Wi-Fi oscilou: mantém o último estado na tela e tenta de novo
    }
  }
  setTimeout(atualizar, 2000);
}

const btnTela = $('tela-cheia');
btnTela.hidden = !document.fullscreenEnabled;
btnTela.addEventListener('click', () =>
  (document.fullscreenElement ? document.exitFullscreen() : $('telao').requestFullscreen()).catch(() => {}));
document.addEventListener('fullscreenchange', () => {
  btnTela.textContent = document.fullscreenElement ? 'Sair da tela cheia' : 'Tela cheia';
  ajustarAltura();
});

if (!codigo) {
  entrada();
} else {
  document.title = automatico ? 'Telão · Carreira em Jogo' : `Partida ${codigo} · Carreira em Jogo`;
  $('t-codigo').textContent = automatico ? '…' : codigo;
  try {
    tabuleiro = criarTabuleiro($('t-tabuleiro'), await api('GET', '/api/tabuleiro'));
    $('telao').hidden = false; // já mostra o tabuleiro: se a rede falhar, aparece o aviso "Sem conexão"
    atualizar();
  } catch (e) {
    entrada(`Não foi possível carregar o tabuleiro: ${e.message}`);
  }
}
