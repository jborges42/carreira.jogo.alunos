// Nova Partida (RF03): de 1 a 4 jogadores já cadastrados, sem repetição, cada um com um peão de cor diferente e a sua rota.
import { api, iniciarPagina, toast, esc } from '/js/app.js';
import { peaoSVG, CORES_PEAO, NOMES_ROTA } from '/js/tabuleiro.js';

await iniciarPagina({ menu: 'nova-partida' });
const MAX = 4;
const PEOES = Object.keys(CORES_PEAO); // verde → vermelho → azul → amarelo
const busca = document.getElementById('busca');
const $resultados = document.getElementById('resultados');
const $selecionados = document.getElementById('selecionados');
const $iniciar = document.getElementById('iniciar');
let resultados = null; // null = ainda carregando
const escolhidos = []; // [{ id_jogador, nome, apelido, escola, em_partida, peao, rota }]
let iniciando = false; // A31: POST /api/partidas no ar (um 2º toque criaria outra partida)
let travaAte = 0; // A33: depois de remover, a lista sobe e o 2º toque cairia no ✗ do jogador seguinte

const identificacao = (j) =>
  `<strong class="nome">${esc(j.nome)}</strong>${j.apelido ? ` <span class="suave">(${esc(j.apelido)})</span>` : ''}
   <div class="suave">${esc(j.escola)}</div>`;

function render() {
  const cheio = escolhidos.length >= MAX;
  if (resultados) $resultados.innerHTML = resultados.map((j) => {
    const ja = escolhidos.some((e) => e.id_jogador === j.id_jogador);
    return `<li>
      <div class="info">${identificacao(j)}${j.em_partida ? '<span class="selo selo-alerta">Em partida</span>' : ''}</div>
      <button class="btn btn-pequeno${ja ? '' : ' btn-azul'}" data-adicionar="${j.id_jogador}" ${ja || cheio ? 'disabled' : ''}>
        ${ja ? 'Adicionado ✓' : 'Adicionar'}</button>
    </li>`;
  }).join('') || '<li class="vazio">Nenhum jogador encontrado. <a href="/recepcao">Cadastrar na Recepção</a></li>';

  document.getElementById('contagem').textContent = `${escolhidos.length}/${MAX}`;
  $selecionados.innerHTML = escolhidos.map((e, i) => `<li class="slot">
      <div class="slot-topo">
        <span class="ordem">${i + 1}º</span>
        <div class="info">${identificacao(e)}</div>
        <button class="btn btn-pequeno" data-remover="${e.id_jogador}" aria-label="Remover ${esc(e.nome)}">✗</button>
      </div>
      ${e.em_partida ? `<div class="aviso aviso-alerta">Atenção: ${esc(e.nome)} já está em uma partida não finalizada.</div>` : ''}
      <div class="peoes" role="group" aria-label="Peão de ${esc(e.nome)}">${PEOES.map((cor) => `
        <button class="opcao-peao" data-jogador="${e.id_jogador}" data-peao="${cor}" aria-pressed="${e.peao === cor}"
          title="${CORES_PEAO[cor].nome}">${peaoSVG(cor, `Peão ${CORES_PEAO[cor].nome}`)}</button>`).join('')}
      </div>
      <div class="rotas" role="group" aria-label="Rota de ${esc(e.nome)}"><span class="rotas-rotulo">Rota:</span>${Object.entries(NOMES_ROTA).map(([rota, nome]) => `
        <button class="opcao-rota" data-jogador="${e.id_jogador}" data-rota="${rota}" aria-pressed="${e.rota === rota}">${nome}</button>`).join('')}
      </div>
    </li>`).join('') +
    Array.from({ length: MAX - escolhidos.length }, (_, i) =>
      `<li class="slot slot-vazio">${escolhidos.length + i + 1}º jogador · vaga livre</li>`).join('');
  $iniciar.disabled = iniciando || !escolhidos.length;
}

$resultados.addEventListener('click', (ev) => {
  const id = Number(ev.target.closest('[data-adicionar]')?.dataset.adicionar);
  const j = resultados?.find((r) => r.id_jogador === id);
  // RF03: no máximo 4 e sem repetir a mesma pessoa.
  if (!j || escolhidos.length >= MAX || escolhidos.some((e) => e.id_jogador === id)) return;
  escolhidos.push({ ...j, peao: PEOES.find((cor) => !escolhidos.some((e) => e.peao === cor)), rota: 'esquerda' });
  render();
});

$selecionados.addEventListener('click', (ev) => {
  const b = ev.target.closest('button');
  if (!b || ev.detail > 1 || Date.now() < travaAte) return; // A33: clique/toque duplo
  if (b.dataset.remover) {
    escolhidos.splice(escolhidos.findIndex((e) => e.id_jogador === Number(b.dataset.remover)), 1);
    travaAte = Date.now() + 400;
  }
  if (b.dataset.peao) {
    const e = escolhidos.find((x) => x.id_jogador === Number(b.dataset.jogador));
    const dono = escolhidos.find((x) => x.peao === b.dataset.peao);
    if (dono) dono.peao = e.peao; // cor já usada: os dois trocam de peão
    e.peao = b.dataset.peao;
  }
  if (b.dataset.rota) escolhidos.find((x) => x.id_jogador === Number(b.dataset.jogador)).rota = b.dataset.rota;
  render();
});

let seq = 0, espera;
async function buscar() {
  const n = ++seq;
  try {
    const lista = await api('GET', `/api/jogadores?q=${encodeURIComponent(busca.value.trim())}`);
    if (n === seq) { resultados = lista; render(); }
  } catch (e) {
    toast(e.message, 'erro');
  }
}
busca.addEventListener('input', () => {
  clearTimeout(espera);
  espera = setTimeout(buscar, 300);
});

$iniciar.addEventListener('click', async (ev) => {
  if (iniciando || ev.detail > 1) return; // A31: o render() da busca/peão não pode reabilitar o botão durante o POST
  iniciando = $iniciar.disabled = true;
  try {
    const estado = await api('POST', '/api/partidas', {
      jogadores: escolhidos.map(({ id_jogador, peao, rota }) => ({ id_jogador, peao, rota })),
      continua: document.getElementById('continua').checked,
    });
    location.href = `/partida/${estado.partida.id_partida}`; // continua "iniciando" até a página trocar
  } catch (e) {
    toast(e.message, 'erro');
    iniciando = false;
    $iniciar.disabled = !escolhidos.length;
  }
});

render();
buscar();
