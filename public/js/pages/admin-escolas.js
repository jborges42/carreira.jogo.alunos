// RF02 — Cadastro prévio das escolas visitantes: Nome da Escola*, Cidade*; lista com editar e excluir. Somente Administrador.
import { api, iniciarPagina, toast, esc } from '/js/app.js';

await iniciarPagina({ menu: 'admin-escolas' });

const $ = (id) => document.getElementById(id);
const form = $('form-escola');
const corpo = $('escolas');
let escolas = [];
let editando = null; // escola carregada no formulário

const aviso = (texto = '') => { $('msg').innerHTML = texto ? `<div class="aviso aviso-erro" role="alert">${esc(texto)}</div>` : ''; };
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

function render() {
  const jogadores = escolas.reduce((s, e) => s + (e.total_jogadores || 0), 0);
  $('resumo').textContent = `${plural(escolas.length, 'escola', 'escolas')} · ${plural(jogadores, 'jogador', 'jogadores')}`;
  corpo.innerHTML = escolas.map((e) => `
    <tr${e.id_escola === editando?.id_escola ? ' class="editando"' : ''}>
      <td><b>${esc(e.nome)}</b></td>
      <td data-rotulo="Cidade">${esc(e.cidade)}</td>
      <td class="num" data-rotulo="Jogadores">${esc(e.total_jogadores)}</td>
      <td><div class="acoes-linha">
        <button type="button" class="btn btn-pequeno" data-editar="${esc(e.id_escola)}">Editar</button>
        <button type="button" class="btn btn-pequeno btn-perigo" data-excluir="${esc(e.id_escola)}">Excluir</button>
      </div></td>
    </tr>`).join('') || '<tr><td colspan="4" class="vazio">Nenhuma escola cadastrada.</td></tr>';
}

async function carregar() {
  escolas = await api('GET', '/api/escolas');
  render();
}

// escola = null volta ao modo "Nova escola".
function editar(escola) {
  editando = escola;
  form.reset();
  if (escola) { form.nome.value = escola.nome; form.cidade.value = escola.cidade; }
  for (const el of [form.nome, form.cidade]) el.removeAttribute('aria-invalid');
  $('titulo-form').textContent = escola ? 'Editar escola' : 'Nova escola';
  $('salvar').textContent = escola ? 'Salvar alterações' : 'Salvar';
  $('cancelar').hidden = !escola;
  aviso();
  render();
  form.nome.focus();
}

form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const dados = { nome: form.nome.value.trim(), cidade: form.cidade.value.trim() };
  for (const k of ['nome', 'cidade']) form[k].setAttribute('aria-invalid', !dados[k]);
  if (!dados.nome || !dados.cidade) {
    aviso('Informe o nome da escola e a cidade.');
    return (dados.nome ? form.cidade : form.nome).focus();
  }
  $('salvar').disabled = true;
  try {
    if (editando) await api('PUT', `/api/escolas/${editando.id_escola}`, dados);
    else await api('POST', '/api/escolas', dados);
    toast(editando ? 'Escola atualizada!' : 'Escola cadastrada!');
    editar(null);
    await carregar();
  } catch (e) {
    aviso(e.message); // 409: "Já existe uma escola com esse nome."
  } finally {
    $('salvar').disabled = false;
  }
});

form.addEventListener('input', (ev) => ev.target.removeAttribute('aria-invalid'));
$('cancelar').addEventListener('click', () => editar(null));

corpo.addEventListener('click', async (ev) => {
  const btn = ev.target.closest('button');
  if (!btn) return;
  const escola = escolas.find((e) => e.id_escola === Number(btn.dataset.editar ?? btn.dataset.excluir));
  if (btn.dataset.editar) return editar(escola);
  if (!confirm(`Excluir a escola "${escola.nome}" (${escola.cidade})?`)) return;
  btn.disabled = true;
  try {
    await api('DELETE', `/api/escolas/${escola.id_escola}`);
    toast('Escola excluída.');
    if (editando?.id_escola === escola.id_escola) editar(null);
    await carregar();
  } catch (e) {
    toast(e.message, 'erro'); // 409: "Não é possível excluir: há jogadores cadastrados nesta escola."
    btn.disabled = false;
  }
});

try {
  await carregar();
} catch (e) {
  corpo.innerHTML = `<tr><td colspan="4"><div class="aviso aviso-erro">Não foi possível carregar as escolas: ${esc(e.message)}</div></td></tr>`;
}
