// Partida em Andamento (RNF06): partidas não finalizadas, com botão para retomar de onde parou.
import { api, iniciarPagina, toast, esc, formatarData } from '/js/app.js';
import { peaoSVG } from '/js/tabuleiro.js';

await iniciarPagina({ menu: 'partidas' });
const lista = document.getElementById('lista');

try {
  const partidas = await api('GET', `/api/partidas?status=${encodeURIComponent('Em Andamento,Pausada,Premiação')}`);
  lista.innerHTML = partidas.map((p) => `<article class="cartao partida-item">
      <div class="partida-item-topo">
        <h2>Partida #${p.id_partida}</h2>
        <span class="selo status" data-status="${esc(p.status)}">${esc(p.status)}</span>
      </div>
      <p class="suave">Código <span class="codigo">${esc(p.codigo_online)}</span> · início ${formatarData(p.iniciada_em)}<br>
        Mediador: ${esc(p.mediador)}</p>
      <ul class="mini-placar">${p.jogadores.map((j) => `<li>
        <span class="peao-mini">${peaoSVG(j.peao)}</span>
        <span class="nome">${esc(j.nome)}${j.eliminado ? ' <small>(☠ fora do jogo)</small>' : ''}</span>
        <span>Casa <b>${j.casa_atual}</b></span>
        <span><b>${j.pontuacao}</b> pts</span></li>`).join('')}</ul>
      <a class="btn btn-primario largo" href="/partida/${p.id_partida}">Retomar</a>
    </article>`).join('') ||
    '<div class="cartao vazio">Nenhuma partida em andamento. <a href="/nova-partida">Iniciar uma nova partida</a></div>';
} catch (e) {
  lista.innerHTML = '';
  toast(e.message, 'erro');
}
