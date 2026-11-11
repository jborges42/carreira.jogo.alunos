// "Gerencia estoque de brindes" (caso de uso do Administrador; RF08/RF09): nome, cargo, pontos mínimos e quantidade (entrada/ajuste).
import { api, iniciarPagina, toast, esc } from '/js/app.js';

await iniciarPagina({ menu: 'admin-brindes' });

const lista = document.getElementById('brindes');
const CAMPOS = ['nome', 'cargo', 'pontos_minimos', 'quantidade_estoque'];
let brindes = [];

const cartaoDe = (id) => lista.querySelector(`form[data-id="${id}"]`);

function cartao(b) {
  const id = esc(b.id_brinde);
  return `
  <form class="cartao brinde" data-id="${id}">
    <div class="brinde-topo">
      <img class="brinde-img" src="/img/chaveiro-centro.png" alt="" width="112" height="112" decoding="async">
      <div>
        <span class="selo selo-nivel selo-cargo"></span>
        <p class="brinde-qtd"><b class="qtd"></b> em estoque <span class="selo selo-esgotado" hidden>ESGOTADO</span></p>
        <p class="suave"><span class="entregues"></span> · Faixa: <span class="faixa"></span></p>
      </div>
    </div>
    <div class="campo">
      <label for="nome-${id}">Nome do brinde</label>
      <input type="text" id="nome-${id}" name="nome" required>
    </div>
    <div class="campo">
      <label for="cargo-${id}">Cargo</label>
      <input type="text" id="cargo-${id}" name="cargo" required>
    </div>
    <div class="campos-2">
      <div class="campo">
        <label for="pontos-${id}">Pontos mínimos</label>
        <input type="number" id="pontos-${id}" name="pontos_minimos" min="0" step="1" inputmode="numeric" required>
      </div>
      <div class="campo">
        <label for="qtd-${id}">Quantidade em estoque</label>
        <input type="number" id="qtd-${id}" name="quantidade_estoque" min="0" step="1" inputmode="numeric" required>
      </div>
    </div>
    <div class="linha-acoes">
      <span class="suave">Entrada de estoque:</span>
      <button type="button" class="btn btn-pequeno" data-somar="10" aria-label="Somar 10 unidades ao estoque">+10</button>
      <button type="button" class="btn btn-pequeno" data-somar="50" aria-label="Somar 50 unidades ao estoque">+50</button>
      <button type="submit" class="btn btn-primario salvar">Salvar</button>
    </div>
  </form>`;
}

// Copia os dados salvos para o cartão. `campos` = inputs a sobrescrever (os demais mantêm o que foi digitado).
function preencher(b, campos = CAMPOS) {
  const f = cartaoDe(b.id_brinde);
  for (const k of campos) { f[k].value = b[k]; delete f[k].dataset.alterado; }
  f.querySelector('.selo-cargo').textContent = b.cargo;
  f.querySelector('.qtd').textContent = b.quantidade_estoque;
  f.querySelector('.selo-esgotado').hidden = b.quantidade_estoque > 0;
  f.classList.toggle('esgotado', b.quantidade_estoque <= 0);
  f.querySelector('.entregues').textContent = `${b.entregues ?? 0} ${b.entregues === 1 ? 'entregue' : 'entregues'}`;
}

// Regra do RF08: vale o brinde de maiores pontos mínimos ≤ pontuação, então cada um cobre até um ponto antes do próximo.
function atualizarFaixas() {
  const ordem = [...brindes].sort((a, b) => a.pontos_minimos - b.pontos_minimos);
  ordem.forEach((b, i) => {
    const de = b.pontos_minimos, prox = ordem[i + 1];
    cartaoDe(b.id_brinde).querySelector('.faixa').textContent =
      !prox ? `a partir de ${de} pontos`
      : prox.pontos_minimos === de ? 'nenhuma (outro brinde tem os mesmos pontos mínimos)'
      : prox.pontos_minimos - 1 > de ? `de ${de} a ${prox.pontos_minimos - 1} pontos` : `${de} pontos`;
  });
  const menor = ordem[0]?.pontos_minimos ?? 0;
  const aviso = document.getElementById('aviso-faixa');
  aviso.hidden = menor === 0;
  aviso.textContent = `Atenção: nenhum brinde começa em 0 pontos. Quem terminar com menos de ${menor} pontos fica sem brinde.`;
}

// A32: enquanto uma operação do cartão espera o servidor, +10, +50 e Salvar ficam desabilitados
// (antes, +50 e +10 seguidos liam o mesmo estoque e o último PUT apagava o primeiro).
const travar = (f, sim) => f.querySelectorAll('button').forEach((b) => { b.disabled = sim; });

lista.addEventListener('input', (ev) => { ev.target.dataset.alterado = '1'; });

// Salvar: envia só os campos que o professor mexeu, para não sobrescrever baixas feitas pelos mediadores enquanto isso.
lista.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = ev.target;
  const corpo = {};
  for (const el of f.querySelectorAll('[data-alterado]')) corpo[el.name] = el.type === 'number' ? Number(el.value) : el.value.trim();
  if (!Object.keys(corpo).length) return toast('Nenhuma alteração para salvar.');
  travar(f, true);
  try {
    const b = brindes.find((x) => x.id_brinde === Number(f.dataset.id));
    Object.assign(b, await api('PUT', `/api/brindes/${b.id_brinde}`, corpo));
    preencher(b);
    atualizarFaixas();
    toast(`${b.nome} salvo!`);
  } catch (e) {
    toast(e.message, 'erro');
  } finally {
    travar(f, false);
  }
});

// +10 / +50: entrada de mercadoria, gravada na hora. Em série (A32): soma sobre o estoque que o servidor devolve.
lista.addEventListener('click', async (ev) => {
  const btn = ev.target.closest('[data-somar]');
  if (!btn) return;
  const f = btn.closest('form'), id = Number(f.dataset.id), n = Number(btn.dataset.somar);
  travar(f, true);
  try {
    // ponytail: a API só aceita quantidade absoluta; relê o estoque logo antes de somar (janela de corrida de milissegundos).
    // Se houver entregas simultâneas demais, criar uma rota de incremento atômico.
    const atual = (await api('GET', '/api/brindes')).find((x) => x.id_brinde === id);
    if (!atual) throw new Error('Brinde não encontrado.');
    const b = brindes.find((x) => x.id_brinde === id);
    Object.assign(b, atual, await api('PUT', `/api/brindes/${id}`, { quantidade_estoque: atual.quantidade_estoque + n }));
    preencher(b, ['quantidade_estoque']);
    toast(`+${n} unidades: ${b.nome} agora tem ${b.quantidade_estoque} em estoque.`);
  } catch (e) {
    toast(e.message, 'erro');
  } finally {
    travar(f, false);
  }
});

try {
  brindes = await api('GET', '/api/brindes');
  lista.innerHTML = brindes.map(cartao).join('') || '<div class="cartao vazio">Nenhum brinde cadastrado.</div>';
  brindes.forEach((b) => preencher(b));
  atualizarFaixas();
} catch (e) {
  lista.innerHTML = `<div class="aviso aviso-erro">Não foi possível carregar os brindes: ${esc(e.message)}</div>`;
}
