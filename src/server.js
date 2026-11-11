import express from 'express';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sessao, login, logout, eu, ehAdmin } from './auth.js';
import { api } from './api.js';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const VIEWS = join(RAIZ, 'views');

export const app = express();
app.disable('x-powered-by');
app.use(express.json());
app.use(sessao);

// A45 (RNF04): ação na API vinda de outro site ou de outra origem do mesmo site (ex.: outra porta no mesmo IP) é
// recusada — o SameSite=Lax do cookie não cobre esses casos (CSRF). Vale também para login e logout.
app.use('/api', (req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  const site = req.headers['sec-fetch-site'], origem = req.headers.origin;
  if (site === 'cross-site' || site === 'same-site' || (origem && URL.parse(origem)?.host !== req.headers.host)) {
    return res.status(403).json({ erro: 'Requisição de outra origem bloqueada.' });
  }
  next();
});

app.post('/api/login', login);
app.post('/api/logout', logout);
app.get('/api/me', eu);
app.use('/api', api);
app.use('/api', (req, res) => res.status(404).json({ erro: 'Rota não encontrada.' }));

// Páginas. Acesso: 'publica' | 'login' (Mediador ou Admin) | 'admin' (RNF04).
const pagina = (arquivo, acesso) => (req, res) => {
  if (acesso !== 'publica' && !req.usuario) return res.redirect(`/login?volta=${encodeURIComponent(req.originalUrl)}`);
  if (acesso === 'admin' && !ehAdmin(req)) return res.status(403).sendFile(join(VIEWS, '403.html'));
  res.sendFile(join(VIEWS, arquivo));
};

app.get('/', (req, res) => res.redirect(req.usuario ? '/recepcao' : '/login'));
app.get('/login', pagina('login.html', 'publica'));
app.get('/recepcao', pagina('recepcao.html', 'login'));
app.get('/nova-partida', pagina('nova-partida.html', 'login'));
app.get('/partidas', pagina('partidas.html', 'login'));
app.get('/partida/:id', pagina('partida.html', 'login'));
app.get('/partida/:id/certificado/:id_jogador', pagina('certificado.html', 'login'));
app.get('/estoque', pagina('estoque.html', 'login'));
app.get('/certificados', pagina('certificados.html', 'login'));
app.get('/acompanhar', pagina('acompanhar.html', 'publica'));
app.get('/acompanhar/:codigo', pagina('acompanhar.html', 'publica'));

// Bloqueio de link (RNF04): qualquer /admin/... digitado por um Mediador recebe "Acesso Negado".
app.use('/admin', (req, res, next) => {
  if (!req.usuario) return res.redirect(`/login?volta=${encodeURIComponent(req.originalUrl)}`);
  if (!ehAdmin(req)) return res.status(403).sendFile(join(VIEWS, '403.html'));
  next();
});
app.get('/admin', (req, res) => res.redirect('/admin/perguntas'));
app.get('/admin/perguntas', pagina('admin-perguntas.html', 'admin'));
app.get('/admin/escolas', pagina('admin-escolas.html', 'admin'));
app.get('/admin/brindes', pagina('admin-brindes.html', 'admin'));
app.get('/admin/relatorios', pagina('admin-relatorios.html', 'admin'));

// A42 (RNF03): arquivos estáticos só depois da API e das páginas. O express.static faz fs.stat no threadpool do
// libuv, que o scrypt dos logins pode ocupar; assim as rotas /api (ações do mediador, telão) não esperam por ele.
app.use(express.static(join(RAIZ, 'public'), { index: false }));
app.use('/vendor/fredoka', express.static(join(RAIZ, 'node_modules/@fontsource/fredoka')));

app.use((req, res) => res.status(404).sendFile(join(VIEWS, '404.html')));

// A28 (ESPECIFICACAO §2): err.message só sai nos erros do próprio app (erro() em jogo.js, já em português). Os das
// bibliotecas (leitor de JSON, zlib, roteador, envio de arquivos) viram texto fixo em português, conforme o status.
const ERRO_DO_CORPO = {
  400: 'Corpo da requisição inválido (JSON malformado).',
  413: 'Requisição grande demais.',
  415: 'Formato de requisição não suportado.',
};

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
  if (status === 404 && !req.path.startsWith('/api')) return res.status(404).sendFile(join(VIEWS, '404.html'));
  const erro = status >= 500 ? 'Erro interno no servidor.'
    : err.doApp ? err.message
    : err instanceof URIError ? 'Parâmetro inválido na URL.'
    : ERRO_DO_CORPO[status] ?? 'Requisição inválida.'; // ex.: 412/416 de cabeçalhos If-Match/Range nas páginas
  res.status(status).type('json').json({ erro }); // type: o envio de arquivo pode já ter posto text/html
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const PORTA = Number(process.env.PORT) || 3000;
  // O Express 5 entrega o erro de bind ao callback: com a porta ocupada, para aqui em vez de dizer "rodando".
  app.listen(PORTA, '0.0.0.0', (e) => {
    if (e) throw e;
    console.log(`Carreira em Jogo rodando em http://localhost:${PORTA}`);
  });
}
