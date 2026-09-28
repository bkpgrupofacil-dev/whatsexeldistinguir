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

test('lê várias colunas de telefone e resume a linha', async () => {
  const ExcelJS = (await import('exceljs')).default;
  const { lerPlanilha, aplicarResultado, resumir } = await import('../src/planilha.js');
  const w = new ExcelJS.Workbook();
  const s = w.addWorksheet('x');
  s.addRow(['nome', 'telefone1', 'telefone2', 'cidade']);
  s.addRow(['A', '', '(85) 99290-3001', 'Fortaleza']);
  s.addRow(['B', '85988414090', '8530828957', 'Fortaleza']);
  s.addRow(['C', '123', '', 'Fortaleza']);
  const arq = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pl-')), 'p.xlsx');
  await w.xlsx.writeFile(arq);

  const p = await lerPlanilha(arq);
  assert.equal(p.nomeColuna, 'telefone1, telefone2');
  const { numeros, porTipo } = resumir(p.linhas);
  assert.deepEqual(numeros.sort(), ['558530828957', '5585988414090', '5585992903001']);
  assert.deepEqual(porTipo, { Celular: 2, Fixo: 1, 'Inválido': 1 });

  aplicarResultado(p, { '5585992903001': 'Sim', '5585988414090': 'Não', '558530828957': 'Não' });
  const v = (l, c) => p.aba.getRow(l).getCell(c).value;
  // colunas novas começam na 5: t1 tipo, t1 whats, t2 tipo, t2 whats, números, resumo
  assert.equal(v(1, 10), 'Tem WhatsApp?');
  assert.equal(v(2, 9), '5585992903001');
  assert.equal(v(2, 10), 'Sim');
  assert.equal(v(3, 10), 'Não');
  assert.equal(v(4, 10), 'Sem número válido');
  assert.match(v(4, 5), /Inválido/);
});

test('corrige o formato dos telefones e separa números juntos', async () => {
  const ExcelJS = (await import('exceljs')).default;
  const { lerPlanilha, aplicarResultado } = await import('../src/planilha.js');
  const w = new ExcelJS.Workbook();
  const s = w.addWorksheet('x');
  s.addRow(['nome', 'telefone1', 'telefone2']);
  s.addRow(['A', '88) 99340-8437', '']);
  s.addRow(['B', ' (85) 3456-7890 ', '85991430774  85988887777']);
  s.addRow(['C', '85991430774  85988887777', '']);
  s.addRow(['D', '991217000', ' n']);
  const arq = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pl-')), 'p.xlsx');
  await w.xlsx.writeFile(arq);

  const p = await lerPlanilha(arq);
  aplicarResultado(p, {}, { soTriagem: true });
  const v = (l, c) => p.aba.getRow(l).getCell(c).value;
  assert.equal(v(2, 2), '88993408437');
  assert.equal(v(3, 2), '8534567890');
  assert.equal(v(3, 3), '85991430774  85988887777'); // sem coluna vazia para separar: fica marcado
  assert.equal(p.aba.getRow(3).getCell(3).fill?.fgColor?.argb, 'FFFFFF00');
  assert.equal(v(4, 2), '85991430774');
  assert.equal(v(4, 3), '85988887777');
  assert.equal(v(5, 2), '991217000'); // sem DDD: não dá para corrigir
  assert.equal(p.aba.getRow(5).getCell(2).fill?.fgColor?.argb, 'FFFFFF00');
});

test('ignorarFixos deixa os fixos fora da checagem', async () => {
  const { fila, consultados } = montar();
  const job = await fila.criar({ buffer: exemplo, nome: 'c.xlsx', opcoes: { ignorarFixos: true } });
  assert.equal(job.progresso.aChecar, 3); // só os 3 celulares
  fila.rodar();
  await ate(() => fila.obter(job.id).status === STATUS.CONCLUIDO);
  fila.parar();
  assert.ok(consultados.every((n) => n.length === 13));

  const ExcelJS = (await import('exceljs')).default;
  const w = new ExcelJS.Workbook();
  await w.xlsx.load((await fila.resultado(job.id)).buffer);
  const a = w.worksheets[0];
  const loja = [...Array(a.rowCount).keys()].map((i) => a.getRow(i + 1)).find((r) => r.getCell(1).value === 'Loja');
  assert.equal(loja.getCell(5).value, 'Não checado (fixo)');
  assert.equal(loja.getCell(a.columnCount).value, 'Só telefone fixo');
});

test('apagarFixos tira os fixos da planilha', async () => {
  const { fila } = montar();
  const job = await fila.criar({ buffer: exemplo, nome: 'd.xlsx', opcoes: { apagarFixos: true } });
  assert.equal(job.progresso.aChecar, 3);
  assert.equal(job.porTipo['Fixo (apagado)'], 1);
  assert.equal(job.porTipo.Fixo, undefined);

  const ExcelJS = (await import('exceljs')).default;
  const w = new ExcelJS.Workbook();
  await w.xlsx.load((await fila.resultado(job.id)).buffer);
  const a = w.worksheets[0];
  const loja = [...Array(a.rowCount).keys()].map((i) => a.getRow(i + 1)).find((r) => r.getCell(1).value === 'Loja');
  assert.equal(loja.getCell(2).value, null);
  assert.equal(loja.getCell(a.columnCount).value, 'Sem número válido');
});
