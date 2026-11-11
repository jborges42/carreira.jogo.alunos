// Utilitários compartilhados por todas as páginas.

let pendentes = 0;
let timerSpinner;

// RNF03: se a resposta demorar mais de 1 segundo, mostra o spinner.
export async function api(metodo, url, corpo) {
  pendentes++;
  clearTimeout(timerSpinner);
  timerSpinner = setTimeout(() => pendentes && spinner(true), 1000);
  try {
    const r = await fetch(url, {
      method: metodo,
      headers: corpo !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
    }).catch(() => {
      throw Object.assign(new Error('Sem conexão com o servidor. Confira a rede e tente de novo.'), { status: 0 });
    });
    const dados = r.status === 204 ? null : await r.json().catch(() => null);
    if (r.status === 401 && !location.pathname.startsWith('/login') && !location.pathname.startsWith('/acompanhar')) {
      location.href = `/login?volta=${encodeURIComponent(location.pathname + location.search)}`;
    }
    if (!r.ok) {
      const e = new Error(dados?.erro || `Erro ${r.status}`);
      e.status = r.status;
      e.dados = dados;
      throw e;
    }
    return dados;
  } finally {
    if (--pendentes === 0) { clearTimeout(timerSpinner); spinner(false); }
  }
}

function spinner(visivel) {
  let el = document.getElementById('carregando');
  if (!el) {
    el = document.createElement('div');
    el.id = 'carregando';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-label', 'Carregando');
    el.innerHTML = '<div class="spinner"></div>';
    document.body.append(el);
  }
  el.classList.toggle('visivel', visivel);
}

export function toast(msg, tipo = 'ok') {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.append(el);
  }
  el.textContent = msg;
  el.className = `visivel ${tipo}`;
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('visivel'), 3500);
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export const formatarData = (seg) => (seg ? new Date(seg * 1000).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
export function formatarTempo(seg) {
  seg = Math.max(0, Math.floor(seg || 0));
  const m = Math.floor(seg / 60), s = seg % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export const valorDaPergunta = (p) => (p.entrevista ? `vale até ${p.pontos} pontos` : `${esc(p.dificuldade)} · vale ${p.pontos} pontos`);

// Resultado da última jogada, igual no painel do mediador e no telão. `quem` já vem escapado; tipo: 'ok', 'erro' ou ''.
export function resultadoJogada(u, quem) {
  const andou = `${quem} tirou <b class="num-dado">${u.valor_dado}</b>: casa ${u.casa_inicial} → casa ${u.casa_final}.`;
  if (u.casa.acao === 'chegada') return { tipo: 'ok', html: `🏁 ${andou} <strong>Chegou!</strong>` };
  if (u.casa.acao === 'morte') return { tipo: 'erro', html: `☠ ${andou} <strong>Casa da Morte:</strong> eliminação na hora.` };
  if (u.casa.acao === 'espera') return { tipo: '', html: `${andou} Casa amarela: sem pergunta, passa a vez.` };
  if (u.alternativa == null) return { tipo: '', html: `A vez de ${quem} foi passada sem pergunta.` };
  const p = u.pergunta; // null se a pergunta foi excluída depois
  const certa = p?.alternativas.reduce((a, b) => (b.pontos > a.pontos ? b : a));
  const rotulo = p?.entrevista ? 'Melhor resposta' : 'Resposta certa';
  const correcao = certa && certa.letra !== u.alternativa ? `<br>${rotulo}: <strong>${certa.letra}) ${esc(certa.texto)}</strong>` : '';
  const explicacao = p?.resposta ? `<small class="explicacao">${esc(p.resposta)}</small>` : '';
  const resultado = u.acertou ? `✓ ${quem} marcou ${u.alternativa} e fez +${u.pontos} pontos!` : `✗ ${quem} marcou ${u.alternativa} e não pontuou.`;
  return { tipo: u.acertou ? 'ok' : 'erro', html: `${resultado}${correcao}${explicacao}` };
}

// Menus por perfil (RNF04). "Partida em Andamento" vem do RNF06.
const MENU = [
  ['recepcao', '/recepcao', 'Recepção'],
  ['nova-partida', '/nova-partida', 'Nova Partida'],
  ['partidas', '/partidas', 'Partida em Andamento'],
  ['estoque', '/estoque', 'Estoque de Brindes'],
  ['certificados', '/certificados', 'Certificados'],
];
const MENU_ADMIN = [
  ['admin-perguntas', '/admin/perguntas', 'Perguntas'],
  ['admin-escolas', '/admin/escolas', 'Escolas'],
  ['admin-brindes', '/admin/brindes', 'Brindes'],
  ['admin-relatorios', '/admin/relatorios', 'Relatórios'],
];

// Monta o topo da página. `menu` = chave do item ativo. Retorna o usuário logado (ou null em página pública).
export async function iniciarPagina({ menu = '', publica = false } = {}) {
  // RNF04: depois de Sair, o Voltar não pode reabrir do cache do navegador uma tela com dados: recarrega e confere o login.
  if (!publica) addEventListener('pageshow', (ev) => { if (ev.persisted) location.reload(); });
  const topo = document.getElementById('topo');
  let usuario = null;
  try {
    // O telão (página pública) não consulta o login: no DataShow, o topo não mostra quem está logado.
    usuario = publica ? null : (await api('GET', '/api/me')).usuario;
  } catch (e) {
    // A37: sem rede no /api/me, avisa no lugar do conteúdo (em vez de ficar em "Carregando…") e para.
    const main = e.status === 0 && document.querySelector('main');
    if (main) {
      main.innerHTML = `<div class="aviso aviso-erro" role="alert">${esc(e.message)}
        <button class="btn btn-pequeno" type="button">Recarregar</button></div>`;
      main.querySelector('button').addEventListener('click', () => location.reload());
    }
    throw e;
  }
  if (topo) {
    const link = ([k, href, txt]) =>
      `<a href="${href}" class="${k === menu ? 'ativo' : ''}" ${k === menu ? 'aria-current="page"' : ''}>${txt}</a>`;
    // RNF04: o Administrador ganha "um menu extra chamado Painel Admin".
    const painel = usuario?.perfil === 'Administrador'
      ? `<details class="painel-admin ${MENU_ADMIN.some(([k]) => k === menu) ? 'ativo' : ''}">
          <summary>Painel Admin</summary><div class="submenu">${MENU_ADMIN.map(link).join('')}</div></details>`
      : '';
    // A38: em tela estreita o texto da marca some (style.css); o aria-label mantém o nome do link.
    topo.innerHTML = `
      <header class="topo">
        <a class="marca" href="${usuario ? '/recepcao' : '/acompanhar'}" aria-label="Carreira em Jogo — página inicial"><img src="/img/logo.png" alt=""><span>Carreira em Jogo</span></a>
        ${usuario ? `<nav class="menu" aria-label="Menu principal">${MENU.map(link).join('')}${painel}</nav>
          <div class="usuario"><span class="nome-usuario">${esc(usuario.nome)}</span><span class="perfil">${esc(usuario.perfil)}</span>
          <button class="btn btn-pequeno" id="sair">Sair</button></div>` : ''}
      </header>`;
    topo.querySelector('#sair')?.addEventListener('click', async () => {
      await api('POST', '/api/logout');
      location.href = '/login';
    });
    const det = topo.querySelector('.painel-admin');
    if (det) document.addEventListener('click', (ev) => { if (!det.contains(ev.target)) det.open = false; });
  }
  return usuario;
}

export const ehAdmin = (usuario) => usuario?.perfil === 'Administrador';
