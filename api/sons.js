// Cada som é um blob "itens/<secao>/<ordem>-<nome>"; <ordem> é o instante em ms, com zeros à esquerda, e define a posição na tela.
// Adicionar e apagar não reescrevem uma lista inteira, então não há corrida entre dois editores.
import { list, put, del } from '@vercel/blob';
import { createHash, timingSafeEqual } from 'node:crypto';

const SECOES = ['sons', 'novos'];
const NOME = /^[a-z0-9]{1,30}$/;
const LIMITE = 500;

const hash = s => createHash('sha256').update(String(s)).digest();
// Sem SENHA configurada, ninguém edita (falha fechada).
const autorizado = req => !!process.env.SENHA && timingSafeEqual(hash(req.headers['x-senha'] || ''), hash(process.env.SENHA));

async function todos() {
  const blobs = [];
  let cursor;
  do {
    const r = await list({ prefix: 'itens/', limit: 1000, cursor });
    blobs.push(...r.blobs);
    cursor = r.hasMore ? r.cursor : undefined;
  } while (cursor);
  // uploadedAt não tem precisão suficiente para ordenar; o prefixo <ordem> tem.
  return blobs
    .map(b => { const [, secao, arquivo] = b.pathname.split('/'); return { url: b.url, secao, ordem: arquivo.split('-')[0], nome: arquivo.slice(arquivo.indexOf('-') + 1) }; })
    .sort((a, b) => a.ordem.localeCompare(b.ordem));
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method === 'GET') {
      const out = { sons: [], novos: [] };
      for (const { secao, nome } of await todos()) if (out[secao]) out[secao].push(nome);
      return res.status(200).json(out);
    }

    if (!autorizado(req)) return res.status(401).json({ erro: 'Senha errada.' });
    if (req.query.verificar) return res.status(200).json({ ok: true });

    const nome = String(req.query.nome || '');
    const secao = String(req.query.secao || '');
    if (!NOME.test(nome)) return res.status(400).json({ erro: 'Use só letras e números, até 30.' });
    if (!SECOES.includes(secao)) return res.status(400).json({ erro: 'Seção inválida.' });

    if (req.method === 'POST') {
      const blobs = await todos();
      if (blobs.length >= LIMITE) return res.status(400).json({ erro: 'Limite de sons atingido.' });
      if (blobs.some(b => b.nome === nome)) return res.status(409).json({ erro: `!${nome} já existe.` });
      await put(`itens/${secao}/${String(Date.now()).padStart(15, '0')}-${nome}`, '1', { access: 'public', addRandomSuffix: false, allowOverwrite: true, contentType: 'text/plain' });
      return res.status(201).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      const alvos = (await todos()).filter(b => b.secao === secao && b.nome === nome);
      if (alvos.length) await del(alvos.map(b => b.url));
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ erro: 'Método não permitido.' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ erro: 'Falha ao acessar o armazenamento.' });
  }
}
