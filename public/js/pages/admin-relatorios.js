// Relatórios do Administrador: "visualizar relatório e estatísticas" e "relatórios de participação das escolas".
import { api, iniciarPagina, esc, formatarData } from '/js/app.js';

await iniciarPagina({ menu: 'admin-relatorios' });

const $ = (id) => document.getElementById(id);
const seloCat = (nome, hex) => `<span class="selo selo-cat" style="background:${esc(hex)}">${esc(nome)}</span>`;

function linhas(id, itens, colunas, linha) {
  $(id).innerHTML = itens?.length
    ? itens.map((x, i) => `<tr>${linha(x, i)}</tr>`).join('')
    : `<tr><td colspan="${colunas}" class="vazio">Nenhum dado ainda.</td></tr>`;
  // A14 (RNF01): em tela estreita cada linha vira um cartão; a célula mostra o nome da coluna (a 1ª é o título).
  const titulos = $(id).parentElement.tHead.rows[0].cells;
  for (const td of $(id).querySelectorAll('td:not(:first-child):not(.so-tela)')) td.dataset.rotulo = titulos[td.cellIndex].textContent;
}

// % de acerto (0–100) em barra na cor da categoria.
function barra(c) {
  const pct = Math.min(100, Math.max(0, Number(c.percentual_acerto) || 0)); // 0–100
  return `<div class="col-barra">
      <div class="barra" role="img" aria-label="${pct}% de acerto"><span style="width:${pct}%;background:${esc(c.cor_hex)}"></span></div>
      <b>${pct}%</b>
    </div>`;
}

$('imprimir').addEventListener('click', () => window.print());

try {
  const r = await api('GET', '/api/relatorios');
  $('gerado').textContent = `Participação das escolas e resultados do evento · gerado em ${formatarData(Date.now() / 1000)}`;

  const s = r.resumo;
  $('resumo').innerHTML = [
    ['Partidas', s.partidas], ['Finalizadas', s.partidas_finalizadas], ['Jogadores', s.jogadores],
    ['Escolas', s.escolas], ['Perguntas', s.perguntas], ['Jogadas', s.jogadas],
    ['Acertos', s.acertos, 'ok'], ['Erros', s.erros, 'erro'], ['Brindes entregues', s.brindes_entregues],
  ].map(([rotulo, n, tipo = '']) => `<div class="stat ${tipo}"><b>${esc(n ?? 0)}</b><span>${rotulo}</span></div>`).join('');

  linhas('t-escolas', r.por_escola, 5, (e) => `
    <td><b>${esc(e.escola)}</b></td><td>${esc(e.cidade)}</td>
    <td class="num">${esc(e.jogadores)}</td><td class="num">${esc(e.partidas)}</td><td class="num">${esc(e.pontos)}</td>`);

  linhas('t-categorias', r.por_categoria, 6, (c) => `
    <td>${seloCat(c.categoria, c.cor_hex)}</td><td class="num">${esc(c.perguntas)}</td><td class="num">${esc(c.respondidas)}</td>
    <td class="num">${esc(c.acertos)}</td><td class="num">${esc(c.erros)}</td><td>${barra(c)}</td>`);

  linhas('t-ranking', r.ranking, 6, (j, i) => `
    <td><span class="pos">${i + 1}º</span></td>
    <td><b>${esc(j.nome)}</b>${j.apelido ? ` <span class="suave">(${esc(j.apelido)})</span>` : ''}</td>
    <td>${esc(j.escola)}</td><td class="num"><b>${esc(j.pontos)}</b></td>
    <td class="num">${esc(j.partidas)}</td><td>${esc(j.melhor_cargo ?? '—')}</td>`);

  linhas('t-brindes', r.brindes, 4, (b) => `
    <td><b>${esc(b.nome)}</b></td><td>${esc(b.cargo)}</td><td class="num">${esc(b.entregues)}</td>
    <td class="num">${esc(b.quantidade_estoque)}${b.quantidade_estoque === 0 ? ' <span class="selo selo-esgotado">ESGOTADO</span>' : ''}</td>`);

  linhas('t-partidas', r.partidas, 7, (p) => {
    const parcial = p.vencedor && (p.status === 'Em Andamento' || p.status === 'Pausada');
    return `
    <td><span class="codigo">${esc(p.codigo_online)}</span></td>
    <td><span class="selo status" data-status="${esc(p.status)}">${esc(p.status)}</span></td>
    <td>${formatarData(p.iniciada_em)}</td><td>${esc(p.mediador)}</td><td>${esc(p.jogadores)}</td>
    <td>${esc(p.vencedor || '—')}${parcial ? ' <span class="suave">(parcial)</span>' : ''}</td>
    <td class="so-tela"><a class="btn btn-pequeno" href="/partida/${esc(p.id_partida)}">Abrir</a></td>`;
  });

  // A18 — DER: cada Relatorio_Categoria é gerado por um Jogador (1,1). Sem o campo na API, mostra "Nenhum dado ainda."
  linhas('t-jogador-categoria', r.por_jogador_categoria, 6, (c) => `
    <td><b>${esc(c.nome)}</b>${c.apelido ? ` <span class="suave">(${esc(c.apelido)})</span>` : ''}</td>
    <td>${seloCat(c.categoria, c.cor_hex)}</td><td class="num">${esc(c.respondidas)}</td>
    <td class="num">${esc(c.acertos)}</td><td class="num">${esc(c.erros)}</td><td>${barra(c)}</td>`);
} catch (e) {
  $('erro').innerHTML = `<div class="aviso aviso-erro">Não foi possível carregar os relatórios: ${esc(e.message)}</div>`;
}
