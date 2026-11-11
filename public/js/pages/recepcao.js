// Recepção (RF01): cadastro rápido de jogadores na fila + lista dos cadastrados.
import { api, iniciarPagina, toast, esc, formatarData, ehAdmin } from '/js/app.js';

const usuario = await iniciarPagina({ menu: 'recepcao' });
const form = document.getElementById('form-jogador');
const botao = form.querySelector('[type=submit]');
const busca = document.getElementById('busca');
const lista = document.getElementById('lista');

// Mesmas regras e mensagens da API (POST /api/jogadores).
const REGRAS = {
  nome: (v) => !v && 'O nome completo é obrigatório.',
  email: (v) => v && (v.length > 254 || !/^[^\s@]+@[^\s@]+$/.test(v)) && 'E-mail inválido.', // até 254 caracteres (D4/A41)
  escola: (v) => !v && 'Selecione a escola de origem.',
};

// "Escola padronizada": o mediador só escolhe na lista, não digita.
async function carregarEscolas() {
  try {
    const escolas = await api('GET', '/api/escolas');
    form.escola.innerHTML = '<option value="">Selecione a escola…</option>' +
      escolas.map((e) => `<option value="${e.id_escola}">${esc(e.nome)} — ${esc(e.cidade)}</option>`).join('');
    if (!escolas.length) {
      document.getElementById('aviso-escolas').innerHTML = `<div class="aviso aviso-alerta">Nenhuma escola cadastrada.
        ${ehAdmin(usuario) ? '<a href="/admin/escolas">Cadastrar escolas</a>' : 'Peça ao administrador para cadastrar as escolas.'}</div>`;
    }
  } catch (e) {
    toast(e.message, 'erro');
  }
}

let seq = 0;
async function carregarLista() {
  const n = ++seq; // descarta respostas de buscas antigas
  try {
    const jogadores = await api('GET', `/api/jogadores?q=${encodeURIComponent(busca.value.trim())}`);
    if (n !== seq) return;
    lista.innerHTML = jogadores.length
      ? `<div class="tabela-wrap"><table>
          <thead><tr><th>Nome</th><th>Escola</th><th>Cadastro</th></tr></thead>
          <tbody>${jogadores.map((j) => `<tr>
            <td><strong class="nome">${esc(j.nome)}</strong>${j.apelido ? `<br><span class="suave nome">${esc(j.apelido)}</span>` : ''}</td>
            <td>${esc(j.escola)}</td>
            <td>${formatarData(j.criado_em)}</td></tr>`).join('')}</tbody>
        </table></div>`
      : '<p class="vazio">Nenhum jogador encontrado.</p>';
  } catch (e) {
    toast(e.message, 'erro');
  }
}

let salvoEm = 0; // A39: hora do último cadastro salvo
form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  // A39: 2º clique/toque/Enter logo depois de salvar não valida o formulário já limpo; o foco fica no nome
  if (Date.now() - salvoEm < 400) return form.nome.focus();
  const dados = {
    nome: form.nome.value.trim(),
    apelido: form.apelido.value.trim(),
    email: form.email.value.trim(),
    escola: form.escola.value,
  };
  let primeiro;
  for (const [campo, regra] of Object.entries(REGRAS)) {
    const erro = regra(dados[campo]) || '';
    document.getElementById(`erro-${campo}`).textContent = erro;
    form[campo].setAttribute('aria-invalid', String(!!erro));
    if (erro && !primeiro) primeiro = form[campo];
  }
  if (primeiro) return primeiro.focus();

  botao.disabled = true;
  try {
    await api('POST', '/api/jogadores', {
      nome: dados.nome,
      apelido: dados.apelido || undefined,
      email: dados.email || undefined,
      id_escola: Number(dados.escola),
    });
    salvoEm = Date.now();
    toast(`Cadastro de ${dados.nome} salvo com sucesso!`);
    form.reset(); // "Agilidade na fila": limpa tudo e volta ao nome
    form.nome.focus();
    carregarLista();
  } catch (e) {
    toast(e.message, 'erro');
  } finally {
    botao.disabled = false;
  }
});
// A39: o 2º clique de um clique duplo não envia de novo (o toque pode chegar com detail = 1: vale a trava acima)
botao.addEventListener('click', (ev) => {
  if (ev.detail > 1) { ev.preventDefault(); form.nome.focus(); }
});

let espera;
busca.addEventListener('input', () => {
  clearTimeout(espera);
  espera = setTimeout(carregarLista, 300);
});

carregarEscolas();
carregarLista();
