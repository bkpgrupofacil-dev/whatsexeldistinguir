import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Fila, STATUS } from '../src/fila.js';
import { Cache } from '../src/cache.js';

const exemplo = fs.readFileSync(new URL('../exemplo/contatos-exemplo.xlsx', import.meta.url));

function montar({ limiteDiario = 100 } = {}) {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'fila-'));
  const consultados = [];
  const wa = {
    estado: 'conectado',
    async temWhatsApp(n) {
      consultados.push(n);
      return n.startsWith('5511');
    },
  };
  const cache = new Cache(path.join(pasta, 'cache.json'));
  const fila = new Fila({ pasta, wa, cache, intervaloMs: 1, limiteDiario, fusoHorario: 'America/Sao_Paulo' });
  return { fila, pasta, consultados, cache };
}

async function ate(cond) {
  for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 10));
}

test('checa todos os números checáveis e gera o resultado', async () => {
  const { fila, consultados } = montar();
  const job = await fila.criar({ buffer: exemplo, nome: 'contatos.xlsx', opcoes: {} });
  assert.equal(job.total, 7);
  assert.equal(job.progresso.aChecar, 4); // 3 celulares + 1 fixo
  fila.rodar();
  await ate(() => fila.obter(job.id).status === STATUS.CONCLUIDO);
  const fim = fila.publico(fila.obter(job.id));
  assert.equal(fim.status, STATUS.CONCLUIDO);
  assert.deepEqual(fim.progresso, { aChecar: 4, checados: 4, sim: 2, nao: 2 });
  assert.equal(consultados.length, 4);
  const { buffer } = await fila.resultado(job.id);
  assert.ok(buffer.byteLength > 1000);
  fila.parar();
});

test('respeita o limite diário e só triagem não consulta', async () => {
  const { fila, consultados } = montar({ limiteDiario: 2 });
  const so = await fila.criar({ buffer: exemplo, nome: 'a.xlsx', opcoes: { soTriagem: true } });
  assert.equal(so.status, STATUS.CONCLUIDO);
  await fila.criar({ buffer: exemplo, nome: 'b.xlsx', opcoes: {} });
  fila.rodar();
  await ate(() => fila.situacao.includes('Limite'));
  assert.equal(consultados.length, 2);
  fila.parar();
});

test('recusa formato errado', async () => {
  const { fila } = montar();
  await assert.rejects(fila.criar({ buffer: Buffer.from('x'), nome: 'a.xls', opcoes: {} }), /xlsx/);
});
