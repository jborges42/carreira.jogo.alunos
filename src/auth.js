// RNF04 — Controle de acesso: login com e-mail/senha e perfis Administrador / Mediador.
import { randomBytes } from 'node:crypto';
import { db } from './db.js';
import { confereSenha } from './senha.js';

export const ACESSO_NEGADO = 'Acesso Negado: Você não tem permissão para visualizar esta página';

// A26: a sessão vence em 7 dias também no servidor (não só no cookie). Um novo login não derruba as outras
// sessões: vários tablets usam a mesma conta de mediador.
const DURACAO_SESSAO = 60 * 60 * 24 * 7; // segundos

const lerCookie = (req, nome) =>
  (req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).find(([k]) => k === nome)?.[1];

export function sessao(req, res, next) {
  const token = lerCookie(req, 'sid');
  req.usuario = token
    ? db.prepare(`SELECT u.id_usuario, u.nome, u.email, u.perfil, u.unidade
                  FROM TB_SESSAO s JOIN TB_USUARIO u USING (id_usuario)
                  WHERE s.token = ? AND s.criado_em > unixepoch() - ?`).get(token, DURACAO_SESSAO)
    : undefined;
  next();
}

export const ehAdmin = (req) => req.usuario?.perfil === 'Administrador';

export function exigeLogin(req, res, next) {
  if (!req.usuario) return res.status(401).json({ erro: 'Faça login para continuar.' });
  next();
}

export function exigeAdmin(req, res, next) {
  if (!req.usuario) return res.status(401).json({ erro: 'Faça login para continuar.' });
  if (!ehAdmin(req)) return res.status(403).json({ erro: ACESSO_NEGADO });
  next();
}

export async function login(req, res) {
  const { email, senha } = req.body || {};
  if (!email || !senha) return res.status(400).json({ erro: 'Informe e-mail e senha.' });
  const u = db.prepare('SELECT * FROM TB_USUARIO WHERE email = ?').get(String(email).trim());
  // A42: a conferência é assíncrona — o scrypt não congela as outras requisições (RNF03)
  if (!u || !(await confereSenha(String(senha), u.senha))) return res.status(401).json({ erro: 'E-mail ou senha inválidos.' });
  const token = randomBytes(24).toString('hex');
  db.prepare('DELETE FROM TB_SESSAO WHERE criado_em <= unixepoch() - ?').run(DURACAO_SESSAO); // A26: apaga as vencidas
  db.prepare('INSERT INTO TB_SESSAO (token, id_usuario) VALUES (?, ?)').run(token, u.id_usuario);
  res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${DURACAO_SESSAO}`);
  const { senha: _, ...usuario } = u;
  res.json({ usuario });
}

export function logout(req, res) {
  const token = lerCookie(req, 'sid');
  if (token) db.prepare('DELETE FROM TB_SESSAO WHERE token = ?').run(token);
  res.setHeader('Set-Cookie', 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  res.status(204).end();
}

export function eu(req, res) {
  if (!req.usuario) return res.status(401).json({ erro: 'Faça login para continuar.' });
  res.json({ usuario: req.usuario });
}
