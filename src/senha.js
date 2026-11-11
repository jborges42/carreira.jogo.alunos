import { scrypt, scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

// Síncrona: só roda no seed, na criação do banco
export function hashSenha(senha) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(senha, salt, 32).toString('hex')}`;
}

// Assíncrona (A42): no login público, o scrypt roda fora da thread principal e não trava o servidor (RNF03)
export async function confereSenha(senha, guardada) {
  const [salt, hash] = String(guardada).split(':');
  if (!salt || !hash) return false;
  return timingSafeEqual(await scryptAsync(senha, salt, 32), Buffer.from(hash, 'hex'));
}
