// Tabuleiro digital: a imagem original (docs/TABULEIRO.png) com os peões posicionados
// nas coordenadas de cada casa do percurso (TB_CASA / GET /api/tabuleiro).
import { esc } from '/js/app.js';

export const CORES_PEAO = {
  verde: { corpo: '#43b649', nome: 'Verde' },
  vermelho: { corpo: '#e53935', nome: 'Vermelho' },
  azul: { corpo: '#4aa3f0', nome: 'Azul' },
  amarelo: { corpo: '#f4d03f', nome: 'Amarelo' },
};
export const NOMES_ROTA = { esquerda: 'Esquerda', centro: 'Centro', direita: 'Direita' };

// Peão no estilo do documento design-personagens (cartola, cabeça branca sorridente, bolso, cinto, pernas azuis).
export function peaoSVG(cor, titulo = '') {
  const c = CORES_PEAO[cor]?.corpo || '#999';
  return `<svg viewBox="0 0 40 60" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(titulo || `Peão ${cor}`)}">
    <g stroke="#1b1b1b" stroke-width="1.2" stroke-linejoin="round">
      <rect x="12" y="1" width="16" height="9" rx="2" fill="${c}"/>
      <rect x="8" y="8.5" width="24" height="3" rx="1.5" fill="${c}"/>
      <rect x="12.5" y="11.5" width="15" height="12.5" rx="3" fill="#f5f5f5"/>
      <rect x="3" y="24" width="7" height="15" rx="2" fill="${c}"/>
      <rect x="30" y="24" width="7" height="15" rx="2" fill="${c}"/>
      <rect x="10" y="24" width="20" height="17" rx="2" fill="${c}"/>
      <rect x="11" y="41" width="8.6" height="17" rx="1.5" fill="#2f6fd6"/>
      <rect x="20.4" y="41" width="8.6" height="17" rx="1.5" fill="#2f6fd6"/>
    </g>
    <rect x="23" y="27" width="4.5" height="4.5" rx="1" fill="#fff" opacity=".45"/>
    <rect x="10.6" y="37" width="18.8" height="1.8" fill="#fff"/>
    <circle cx="17.3" cy="16.6" r="1.2" fill="#1b1b1b"/><circle cx="22.7" cy="16.6" r="1.2" fill="#1b1b1b"/>
    <path d="M16.3 19.6 Q20 22.6 23.7 19.6" stroke="#1b1b1b" stroke-width="1.2" fill="none" stroke-linecap="round"/>
  </svg>`;
}

const DESLOC = [[0, 0], [-1.6, -1.2], [1.6, -1.2], [-1.6, 1.4], [1.6, 1.4]];

// tabuleiro = resposta de GET /api/tabuleiro. Retorna { atualizar(jogadores, { destaque }) }.
// jogadores: [{ id_jogador, nome, peao, rota, casa_atual, da_vez, eliminado }]
export function criarTabuleiro(container, tabuleiro, { numeros = false } = {}) {
  const casas = new Map(tabuleiro.casas.map((c) => [c.numero, c]));
  container.innerHTML = `<div class="tabuleiro"><img src="${tabuleiro.imagem}" alt="Tabuleiro Carreira em Jogo"></div>`;
  const raiz = container.firstElementChild;
  if (numeros) {
    for (const c of tabuleiro.casas) {
      if (c.tipo !== 'casa') continue;
      raiz.insertAdjacentHTML('beforeend', `<span class="num-casa" style="left:${c.x}%;top:${c.y}%">${c.numero}</span>`);
    }
  }
  const peoes = new Map(); // id_jogador -> { el, casa }
  let anel;

  function posicionar(el, casa, i, n) {
    const c = casas.get(casa) || casas.get(0);
    const [dx, dy] = n > 1 ? DESLOC[1 + (i % 4)] : DESLOC[0];
    el.style.left = `${c.x + dx}%`;
    el.style.top = `${c.y + dy}%`;
  }

  // Move o peão casa por casa (animação) pela rota do jogador até o destino. Salto do administrador: direto.
  function andar(p, rota, destino, i, n) {
    clearInterval(p.timer);
    let k = rota.indexOf(p.casa);
    const fim = rota.indexOf(destino);
    if (k < 0 || fim < k || fim - k > 12) { p.casa = destino; posicionar(p.el, destino, i, n); return; }
    p.timer = setInterval(() => {
      if (k === fim) return clearInterval(p.timer);
      p.casa = rota[++k];
      posicionar(p.el, p.casa, k === fim ? i : 0, k === fim ? n : 1);
    }, 200);
  }

  return {
    atualizar(jogadores, { destaque = null } = {}) {
      const ativos = jogadores.filter((j) => j.ativo !== false);
      for (const [id, p] of peoes) if (!ativos.some((j) => j.id_jogador === id)) { p.el.remove(); peoes.delete(id); }
      for (const j of ativos) {
        let p = peoes.get(j.id_jogador);
        const mesmos = ativos.filter((o) => o.casa_atual === j.casa_atual);
        const i = mesmos.indexOf(j), n = mesmos.length;
        if (!p) {
          const el = document.createElement('div');
          el.className = 'peao';
          el.innerHTML = peaoSVG(j.peao, j.nome);
          el.title = j.nome;
          raiz.append(el);
          p = { el, casa: j.casa_atual };
          peoes.set(j.id_jogador, p);
          posicionar(el, j.casa_atual, i, n);
        } else if (p.casa !== j.casa_atual) {
          andar(p, tabuleiro.rotas[j.rota], j.casa_atual, i, n);
        } else {
          posicionar(p.el, j.casa_atual, i, n);
        }
        p.el.classList.toggle('da-vez', !!j.da_vez);
        p.el.classList.toggle('eliminado', !!j.eliminado);
      }
      anel?.remove();
      anel = null;
      const c = destaque != null && casas.get(destaque);
      if (c) {
        anel = document.createElement('div');
        anel.className = 'destaque';
        anel.style.left = `${c.x}%`;
        anel.style.top = `${c.y}%`;
        raiz.append(anel);
      }
    },
  };
}
