// Estoque de Brindes (RF09): somente leitura, atualiza sozinho a cada 10 segundos.
import { api, iniciarPagina, esc, ehAdmin } from '/js/app.js';

const usuario = await iniciarPagina({ menu: 'estoque' });
document.getElementById('gerenciar').hidden = !ehAdmin(usuario);
const $brindes = document.getElementById('brindes');
const $info = document.getElementById('info');
const $erro = document.getElementById('erro');

// Faixa de pontos de cada cargo: dos pontos mínimos dele até um ponto antes dos do próximo cargo.
function faixa(brindes, i) {
  const de = brindes[i].pontos_minimos, prox = brindes[i + 1];
  if (!prox) return `A partir de ${de} pontos`;
  return prox.pontos_minimos - 1 > de ? `De ${de} a ${prox.pontos_minimos - 1} pontos` : `${de} pontos`;
}

async function carregar() {
  try {
    const brindes = await api('GET', '/api/brindes');
    $brindes.innerHTML = brindes.map((b, i) => {
      const zero = b.quantidade_estoque <= 0;
      return `<article class="cartao brinde${zero ? ' esgotado' : ''}">
        <img class="chaveiro" src="/img/chaveiro-centro.png" alt="Chaveiro" width="140" height="140" decoding="async">
        <h2>${esc(b.nome)}</h2>
        <p><span class="selo">${esc(b.cargo)}</span> ${faixa(brindes, i)}</p>
        <p class="quantidade"><strong>${b.quantidade_estoque}</strong> em estoque</p>
        <p class="suave">Entregues: ${b.entregues}</p>
        ${zero ? '<div class="alerta-esgotado" role="alert">ESGOTADO</div>' : ''}
      </article>`;
    }).join('') || '<div class="cartao vazio">Nenhum brinde cadastrado.</div>';
    $info.textContent = `Atualizado às ${new Date().toLocaleTimeString('pt-BR')} · atualiza sozinho a cada 10 segundos.`;
    $erro.innerHTML = '';
  } catch (e) {
    $erro.innerHTML = `<div class="aviso aviso-erro">Não foi possível atualizar o estoque: ${esc(e.message)}</div>`;
  }
}

carregar();
setInterval(carregar, 10000);
