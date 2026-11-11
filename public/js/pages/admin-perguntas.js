// RF10 — Banco de perguntas: Salvar (Novo), Editar e Excluir, com as 4 alternativas. Somente Administrador (RNF04).
import { api, iniciarPagina, toast, esc } from '/js/app.js';

await iniciarPagina({ menu: 'admin-perguntas' });

const $ = (id) => document.getElementById(id);
const form = $('form-pergunta');
const lista = $('lista');
const busca = $('busca');
const LETRAS = ['A', 'B', 'C', 'D'];
const OBRIGATORIOS = ['enunciado', 'resposta', 'id_categoria', ...LETRAS.map((l) => `texto-${l}`)];

// Pergunta comum: marca-se a correta. Entrevista: cada alternativa tem uma nota (os dois controles existem, um fica oculto).
$('alternativas').innerHTML = LETRAS.map((l) => `<div class="linha-alternativa">
    <b>${l}</b>
    <input type="text" name="texto-${l}" aria-label="Texto da alternativa ${l}" required>
    <input type="radio" name="correta" value="${l}" class="so-comum" aria-label="A alternativa ${l} é a correta">
    <select name="nota-${l}" class="so-entrevista" aria-label="Nota da alternativa ${l}">
      ${[15, 10, 5, 0].map((n) => `<option${n === 0 ? ' selected' : ''}>${n}</option>`).join('')}
    </select>
  </div>`).join('');

let categorias = [];
let perguntas = [];
let filtro = '';         // id_categoria (texto) do filtro; '' = todas
let selecionada = null;  // pergunta carregada no formulário: alvo de Editar/Excluir

const semAcento = (s) => String(s ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const seloCat = (nome, hex) => `<span class="selo selo-cat" style="background:${esc(hex)}">${esc(nome)}</span>`;
const aviso = (texto = '') => { $('msg').innerHTML = texto ? `<div class="aviso aviso-erro" role="alert">${esc(texto)}</div>` : ''; };
const marcar = () => lista.querySelectorAll('.item-pergunta')
  .forEach((b) => b.setAttribute('aria-pressed', Number(b.dataset.id) === selecionada?.id_pergunta));
const ehEntrevista = () => categorias.find((c) => String(c.id_categoria) === form.id_categoria.value)?.mecanica === 'Nota por alternativa';
const melhor = (p) => p.alternativas.reduce((a, b) => (b.pontos > a.pontos ? b : a));

function estadoForm() {
  $('editar').disabled = $('excluir').disabled = !selecionada;
  $('titulo-form').textContent = selecionada ? `Editando a pergunta nº ${selecionada.id_pergunta}` : 'Nova pergunta';
  const cat = categorias.find((c) => String(c.id_categoria) === form.id_categoria.value);
  form.id_categoria.style.setProperty('--cor', cat?.cor_hex || '');
  const entrevista = ehEntrevista();
  form.querySelectorAll('.so-comum').forEach((el) => { el.hidden = entrevista; });
  form.querySelectorAll('.so-entrevista').forEach((el) => { el.hidden = !entrevista; });
  $('campo-dificuldade').hidden = entrevista;
  $('ajuda-alternativas').textContent = entrevista
    ? 'Dê uma nota a cada alternativa: 15, 10, 5 ou 0 pontos.'
    : 'Marque a alternativa correta. Ela vale os pontos da dificuldade; as outras valem 0.';
}

function renderFiltros() {
  const qtd = (id) => perguntas.filter((p) => p.id_categoria === id).length;
  $('filtros').innerHTML =
    `<button type="button" class="chip" data-cat="" aria-pressed="${filtro === ''}">Todas <b>${perguntas.length}</b></button>` +
    categorias.map((c) => `<button type="button" class="chip" data-cat="${esc(c.id_categoria)}" aria-pressed="${filtro === String(c.id_categoria)}"
      style="--cor:${esc(c.cor_hex)}">${esc(c.nome)} <b>${qtd(c.id_categoria)}</b></button>`).join('');
}

function renderLista() {
  const termo = semAcento(busca.value.trim());
  const visiveis = perguntas.filter((p) => (!filtro || String(p.id_categoria) === filtro)
    && (!termo || semAcento(`${p.enunciado} ${p.resposta} ${p.alternativas.map((a) => a.texto).join(' ')}`).includes(termo)));
  $('total').textContent = visiveis.length === perguntas.length ? `(${perguntas.length})` : `(${visiveis.length} de ${perguntas.length})`;
  lista.innerHTML = visiveis.map((p) => `
    <li><button type="button" class="item-pergunta" data-id="${esc(p.id_pergunta)}" style="--cor:${esc(p.cor_hex)}"
        aria-pressed="${p.id_pergunta === selecionada?.id_pergunta}">
      <span class="item-meta">${seloCat(p.categoria, p.cor_hex)}${p.mecanica === 'Nota por alternativa' ? '' : `<span class="selo">${esc(p.dificuldade)}</span>`}
        <span class="selo">${p.mecanica === 'Nota por alternativa' ? 'até ' : ''}${esc(p.pontos)} pts</span>
        <span class="suave">Sorteada ${esc(p.vezes_sorteada)} ${p.vezes_sorteada === 1 ? 'vez' : 'vezes'}</span></span>
      <span class="item-enunciado">${esc(p.enunciado)}</span>
      <span class="item-resposta"><b>${esc(melhor(p).letra)}) ${esc(melhor(p).texto)}</b> · ${esc(p.resposta)}</span>
    </button></li>`).join('') || '<li class="vazio">Nenhuma pergunta encontrada.</li>';
}

async function carregar() {
  perguntas = await api('GET', '/api/perguntas');
  selecionada = selecionada && (perguntas.find((p) => p.id_pergunta === selecionada.id_pergunta) ?? null);
  estadoForm();
  renderFiltros();
  renderLista();
}

function limpar() {
  form.reset();
  selecionada = null;
  OBRIGATORIOS.forEach((k) => form[k].removeAttribute('aria-invalid'));
  aviso();
  estadoForm();
  marcar();
  form.enunciado.focus();
}

// Mesmas regras e mensagens da API: não salva com campo em branco nem sem a alternativa correta.
function lerFormulario() {
  const vazios = OBRIGATORIOS.filter((k) => !form[k].value.trim());
  OBRIGATORIOS.forEach((k) => form[k].setAttribute('aria-invalid', vazios.includes(k)));
  if (vazios.length) {
    aviso('Preencha o enunciado, as quatro alternativas, a explicação e a categoria.');
    form[vazios[0]].focus();
    return null;
  }
  const entrevista = ehEntrevista();
  if (!entrevista && !form.correta.value) { aviso('Indique a alternativa correta (A, B, C ou D).'); return null; }
  const notas = LETRAS.map((l) => Number(form[`nota-${l}`].value));
  if (entrevista && !notas.some((n) => n > 0)) { aviso('Na Entrevista, pelo menos uma alternativa precisa valer mais de zero.'); return null; }
  aviso();
  return {
    enunciado: form.enunciado.value.trim(),
    resposta: form.resposta.value.trim(),
    id_categoria: Number(form.id_categoria.value),
    dificuldade: form.dificuldade.value,
    alternativas: LETRAS.map((l) => form[`texto-${l}`].value.trim()),
    ...(entrevista ? { notas } : { correta: form.correta.value }),
  };
}

// Trava os botões enquanto a API responde (evita clique duplo).
function travar(sim) {
  form.querySelectorAll('button').forEach((b) => { b.disabled = sim; });
  if (!sim) estadoForm();
}

async function acao(fn) {
  travar(true);
  try { await fn(); } catch (e) { aviso(e.message); } finally { travar(false); }
}

$('salvar').addEventListener('click', () => {
  const dados = lerFormulario();
  if (dados) acao(async () => {
    await api('POST', '/api/perguntas', dados);
    toast('Pergunta cadastrada!');
    limpar();
    await carregar();
  });
});

$('editar').addEventListener('click', () => {
  const dados = lerFormulario();
  if (dados) acao(async () => {
    await api('PUT', `/api/perguntas/${selecionada.id_pergunta}`, dados);
    toast('Alterações salvas!');
    await carregar();
  });
});

$('excluir').addEventListener('click', () => {
  if (!confirm(`Excluir esta pergunta do banco?\n\n${selecionada.enunciado}\n\nEsta ação não pode ser desfeita.`)) return;
  acao(async () => {
    await api('DELETE', `/api/perguntas/${selecionada.id_pergunta}`);
    toast('Pergunta excluída.');
    limpar();
    await carregar();
  });
});

$('limpar').addEventListener('click', limpar);
form.addEventListener('submit', (ev) => ev.preventDefault()); // Enter em um campo de texto não envia nada
form.addEventListener('input', (ev) => ev.target.removeAttribute('aria-invalid'));
form.id_categoria.addEventListener('change', estadoForm);

lista.addEventListener('click', (ev) => {
  const item = ev.target.closest('.item-pergunta');
  if (!item) return;
  selecionada = perguntas.find((p) => p.id_pergunta === Number(item.dataset.id));
  for (const k of ['enunciado', 'resposta', 'id_categoria', 'dificuldade']) form[k].value = selecionada[k];
  for (const a of selecionada.alternativas) {
    form[`texto-${a.letra}`].value = a.texto;
    form[`nota-${a.letra}`].value = [15, 10, 5, 0].includes(a.pontos) ? a.pontos : 0;
  }
  form.correta.value = melhor(selecionada).letra;
  OBRIGATORIOS.forEach((k) => form[k].removeAttribute('aria-invalid'));
  aviso();
  estadoForm();
  marcar();
  form.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); // em tela estreita o formulário fica acima da lista
});

$('filtros').addEventListener('click', (ev) => {
  const chip = ev.target.closest('.chip');
  if (!chip) return;
  filtro = chip.dataset.cat;
  for (const c of $('filtros').children) c.setAttribute('aria-pressed', c === chip);
  renderLista();
});
busca.addEventListener('input', renderLista);

try {
  categorias = await api('GET', '/api/categorias');
  form.id_categoria.insertAdjacentHTML('beforeend', categorias
    .map((c) => `<option value="${esc(c.id_categoria)}">${esc(c.nome)} (${esc(c.cor)})</option>`).join(''));
  await carregar();
} catch (e) {
  lista.innerHTML = `<li class="aviso aviso-erro">Não foi possível carregar as perguntas: ${esc(e.message)}</li>`;
}
