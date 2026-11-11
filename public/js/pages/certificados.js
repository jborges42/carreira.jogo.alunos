// Certificados (Etapa 3): todos os que podem ser emitidos, por nome e cargo. Cada linha abre o certificado do jogador.
import { api, iniciarPagina, esc } from '/js/app.js';

await iniciarPagina({ menu: 'certificados' });
const $ = (id) => document.getElementById(id);
const semAcento = (s) => String(s ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
let certificados = [];

function render() {
  const termo = semAcento($('busca').value.trim()), cargo = $('cargo').value;
  const visiveis = certificados.filter((c) => (!cargo || c.cargo === cargo) && (!termo || semAcento(`${c.nome} ${c.escola}`).includes(termo)));
  $('total').textContent = `${visiveis.length} de ${certificados.length} ${certificados.length === 1 ? 'certificado' : 'certificados'}`;
  $('lista').innerHTML = visiveis.map((c) => `<tr>
      <td><b>${esc(c.nome)}</b></td><td>${esc(c.escola)}</td><td>${esc(c.cargo ?? '—')}</td><td>${esc(c.pontuacao)}</td>
      <td>${new Date(c.encerrada_em * 1000).toLocaleDateString('pt-BR')}</td>
      <td><a class="btn btn-pequeno" href="/partida/${esc(c.id_partida)}/certificado/${esc(c.id_jogador)}" target="_blank" rel="noopener">Abrir</a></td>
    </tr>`).join('') || '<tr><td colspan="6" class="vazio">Nenhum certificado encontrado.</td></tr>';
}

$('busca').addEventListener('input', render);
$('cargo').addEventListener('change', render);

try {
  certificados = await api('GET', '/api/certificados');
  const brindes = await api('GET', '/api/brindes'); // cargos na ordem da hierarquia
  $('cargo').insertAdjacentHTML('beforeend', brindes.map((b) => `<option>${esc(b.cargo)}</option>`).join(''));
  render();
} catch (e) {
  $('lista').innerHTML = `<tr><td colspan="6" class="aviso aviso-erro">Não foi possível carregar os certificados: ${esc(e.message)}</td></tr>`;
}
