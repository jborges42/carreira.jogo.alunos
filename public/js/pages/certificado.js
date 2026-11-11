// Certificado virtual do jogador (Etapa 3): nome + cargo alcançado, para imprimir ou salvar em PDF pelo navegador.
import { api, iniciarPagina, esc } from '/js/app.js';

await iniciarPagina({ menu: 'partidas' });
const $ = (id) => document.getElementById(id);
const [, , idPartida, , idJogador] = location.pathname.split('/');

$('imprimir').addEventListener('click', () => window.print());

try {
  const c = await api('GET', `/api/partidas/${idPartida}/certificados/${idJogador}`);
  $('c-nome').textContent = c.nome;
  $('c-escola').textContent = c.escola;
  $('c-cargo').textContent = c.cargo ?? '—';
  $('c-pontos').textContent = c.pontuacao;
  const data = new Date(c.encerrada_em * 1000).toLocaleDateString('pt-BR', { dateStyle: 'long' });
  $('c-local').textContent = `${c.unidade}, ${data}`;
  // O navegador sugere o título como nome do PDF: deixa a pasta compartilhada organizada por nome e cargo.
  document.title = `Certificado - ${c.nome} - ${c.cargo ?? 'sem cargo'}`;
  // Só o administrador recebe o e-mail (RNF04). O link não anexa o PDF: quem envia anexa o arquivo salvo.
  if (c.email) {
    const assunto = encodeURIComponent('Certificado Carreira em Jogo');
    $('envio').href = `mailto:${encodeURIComponent(c.email)}?subject=${assunto}`;
    $('envio').textContent = `Enviar para ${c.email}`;
    $('envio').hidden = false;
  }
  $('acoes').hidden = $('certificado').hidden = false;
} catch (e) {
  $('erro').innerHTML = `<div class="aviso aviso-erro" role="alert">${esc(e.message)}</div>`;
}
