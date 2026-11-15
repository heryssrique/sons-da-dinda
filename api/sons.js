// Cada som novo é um blob "sons/<nome>": adicionar e apagar não reescrevem uma lista inteira, então não há corrida entre duas pessoas.
import { list, put, del } from '@vercel/blob';
import { createHash, timingSafeEqual } from 'node:crypto';

const hash = s => createHash('sha256').update(String(s)).digest();
// Sem SENHA configurada, ninguém edita (falha fechada).
const autorizado = req => !!process.env.SENHA && timingSafeEqual(hash(req.headers['x-senha'] || ''), hash(process.env.SENHA));

const NOME = /^[a-z0-9]{1,30}$/;
const LIMITE = 300;

async function todos() {
  const { blobs } = await list({ prefix: 'sons/', limit: 1000 });
  return blobs.sort((a, b) => new Date(a.uploadedAt) - new Date(b.uploadedAt));
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method === 'GET') return res.status(200).json((await todos()).map(b => b.pathname.slice(5)));

    if (!autorizado(req)) return res.status(401).json({ erro: 'Senha errada.' });
    if (req.query.verificar) return res.status(200).json({ ok: true });

    const nome = String(req.query.nome || '');
    if (!NOME.test(nome)) return res.status(400).json({ erro: 'Use só letras e números, até 30.' });

    if (req.method === 'POST') {
      const blobs = await todos();
      if (blobs.length >= LIMITE) return res.status(400).json({ erro: 'Limite de sons atingido.' });
      await put(`sons/${nome}`, '1', { access: 'public', addRandomSuffix: false, allowOverwrite: true, contentType: 'text/plain' });
      return res.status(201).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      const alvo = (await todos()).find(b => b.pathname === `sons/${nome}`);
      if (alvo) await del(alvo.url);
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ erro: 'Método não permitido.' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ erro: 'Falha ao acessar o armazenamento.' });
  }
}
