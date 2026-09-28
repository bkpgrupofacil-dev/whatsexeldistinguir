#!/usr/bin/env node
// Lê uma planilha, faz a triagem dos números e (opcionalmente) checa no WhatsApp.
// Uso: node src/index.js contatos.xlsx [opções]   (veja o README)

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import ExcelJS from 'exceljs';
import { triar, palpite, podeChecar } from './triagem.js';

const AJUDA = `
Uso: node src/index.js <planilha.xlsx|.csv> [opções]

Opções:
  --coluna NOME     Nome (ou letra, ex.: C) da coluna com os telefones. Padrão: detecta sozinho
  --aba NOME        Aba da planilha. Padrão: a primeira
  --ddd XX          DDD para números que vieram sem DDD
  --so-triagem      Só faz a triagem pelo formato, sem conectar no WhatsApp
  --intervalo S     Segundos entre cada consulta ao WhatsApp. Padrão: 5
  --limite N        Máximo de consultas nesta execução. Padrão: 200
  --saida ARQUIVO   Arquivo de resultado. Padrão: <nome>-resultado.xlsx
`;

const CACHE = 'cache-checagem.json';

async function main() {
  const { values: op, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      coluna: { type: 'string' },
      aba: { type: 'string' },
      ddd: { type: 'string' },
      'so-triagem': { type: 'boolean', default: false },
      intervalo: { type: 'string', default: '5' },
      limite: { type: 'string', default: '200' },
      saida: { type: 'string' },
      ajuda: { type: 'boolean', short: 'h', default: false },
    },
  });

  const arquivo = positionals[0];
  if (op.ajuda || !arquivo) {
    console.log(AJUDA);
    process.exit(arquivo ? 0 : 1);
  }
  if (!fs.existsSync(arquivo)) throw new Error(`Arquivo não encontrado: ${arquivo}`);

  const livro = new ExcelJS.Workbook();
  const ehCsv = arquivo.toLowerCase().endsWith('.csv');
  const aba = ehCsv ? await livro.csv.readFile(arquivo) : (await livro.xlsx.readFile(arquivo), op.aba ? livro.getWorksheet(op.aba) : livro.worksheets[0]);
  if (!aba) throw new Error(`Aba não encontrada: ${op.aba}`);

  const colTel = acharColuna(aba, op.coluna);
  console.log(`Coluna de telefone: ${colTel} ("${textoCelula(aba.getRow(1).getCell(colTel))}")`);

  // Novas colunas no fim
  const base = aba.columnCount;
  const cabecalhos = ['Número normalizado', 'Tipo', 'Observação', 'WhatsApp pelo formato', 'Tem WhatsApp? (checado)'];
  const [cNum, cTipo, cObs, cPalpite, cTem] = cabecalhos.map((_, i) => base + 1 + i);
  cabecalhos.forEach((h, i) => {
    const c = aba.getRow(1).getCell(base + 1 + i);
    c.value = h;
    c.font = { bold: true };
  });

  // 1) Triagem
  const linhas = [];
  for (let i = 2; i <= aba.rowCount; i++) {
    const linha = aba.getRow(i);
    const r = triar(textoCelula(linha.getCell(colTel)), { dddPadrao: op.ddd });
    linha.getCell(cNum).value = r.numero || r.formatado;
    linha.getCell(cTipo).value = r.tipo;
    linha.getCell(cObs).value = r.motivo;
    linha.getCell(cPalpite).value = palpite(r.tipo);
    linhas.push({ linha, r });
  }
  resumoTriagem(linhas);

  // 2) Checagem real
  if (!op['so-triagem']) {
    await checar(linhas, cTem, { intervalo: Number(op.intervalo) * 1000, limite: Number(op.limite) });
  } else {
    for (const { linha } of linhas) linha.getCell(cTem).value = 'Não checado';
  }

  // Cores
  for (const { linha } of linhas) {
    const tem = linha.getCell(cTem).value;
    const cor = tem === 'Sim' ? 'FFC6EFCE' : tem === 'Não' ? 'FFFFC7CE' : null;
    if (cor) linha.getCell(cTem).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: cor } };
  }

  const saida = op.saida || path.join(path.dirname(arquivo), `${path.parse(arquivo).name}-resultado.xlsx`);
  await livro.xlsx.writeFile(saida);
  console.log(`\nResultado salvo em: ${saida}`);
  process.exit(0);
}

async function checar(linhas, cTem, { intervalo, limite }) {
  const { conectar, temWhatsApp, esperar } = await import('./checagem.js');
  const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};

  const pendentes = [...new Set(linhas.filter(({ r }) => podeChecar(r)).map(({ r }) => r.numero))].filter((n) => !(n in cache));
  const agora = pendentes.slice(0, limite);
  console.log(`\nChecagem: ${pendentes.length} números novos para consultar (${Object.keys(cache).length} já no cache).`);
  if (pendentes.length > agora.length) console.log(`Nesta execução serão consultados ${agora.length} (--limite). Rode de novo depois para continuar.`);

  if (agora.length) {
    const sock = await conectar();
    let erros = 0;
    for (const [i, numero] of agora.entries()) {
      try {
        cache[numero] = (await temWhatsApp(sock, numero)) ? 'Sim' : 'Não';
        erros = 0;
      } catch (e) {
        console.log(`  erro em ${numero}: ${e.message}`);
        if (++erros >= 3) {
          console.log('3 erros seguidos. Parando para proteger a conta. Rode de novo mais tarde.');
          break;
        }
      }
      fs.writeFileSync(CACHE, JSON.stringify(cache, null, 1));
      console.log(`  [${i + 1}/${agora.length}] ${numero}: ${cache[numero] ?? 'erro'}`);
      // intervalo com variação aleatória de ±30% para não parecer robô
      if (i < agora.length - 1) await esperar(intervalo * (0.7 + Math.random() * 0.6));
    }
    sock.end(undefined);
  }

  for (const { linha, r } of linhas) {
    linha.getCell(cTem).value = !podeChecar(r) ? 'Não (número inválido)' : cache[r.numero] ?? 'Não checado ainda';
  }
  const sim = linhas.filter(({ linha }) => linha.getCell(cTem).value === 'Sim').length;
  const nao = linhas.filter(({ linha }) => linha.getCell(cTem).value === 'Não').length;
  console.log(`\nCom WhatsApp: ${sim} | Sem WhatsApp: ${nao}`);
}

function resumoTriagem(linhas) {
  const cont = {};
  for (const { r } of linhas) cont[r.tipo] = (cont[r.tipo] || 0) + 1;
  console.log('\nTriagem:');
  for (const [tipo, n] of Object.entries(cont)) console.log(`  ${tipo}: ${n}`);
}

function textoCelula(celula) {
  const v = celula.value;
  if (v == null) return '';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v));
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if ('result' in v) return String(v.result ?? '');
    if ('text' in v) return String(v.text);
  }
  return String(v);
}

function acharColuna(aba, pedida) {
  const cab = aba.getRow(1);
  if (pedida) {
    if (/^[A-Z]{1,3}$/i.test(pedida)) return aba.getColumn(pedida.toUpperCase()).number;
    for (let c = 1; c <= aba.columnCount; c++) {
      if (normalizar(textoCelula(cab.getCell(c))) === normalizar(pedida)) return c;
    }
    throw new Error(`Coluna "${pedida}" não encontrada no cabeçalho.`);
  }
  const chaves = ['whats', 'celular', 'telefone', 'fone', 'tel', 'numero', 'contato', 'phone'];
  for (const chave of chaves) {
    for (let c = 1; c <= aba.columnCount; c++) {
      if (normalizar(textoCelula(cab.getCell(c))).includes(chave)) return c;
    }
  }
  // Sem cabeçalho reconhecível: coluna com mais valores que parecem telefone
  let melhor = 1, max = -1;
  for (let c = 1; c <= aba.columnCount; c++) {
    let n = 0;
    for (let i = 2; i <= Math.min(aba.rowCount, 50); i++) if (triar(textoCelula(aba.getRow(i).getCell(c))).numero) n++;
    if (n > max) [melhor, max] = [c, n];
  }
  return melhor;
}

const normalizar = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

main().catch((e) => {
  console.error(`Erro: ${e.message}`);
  process.exit(1);
});
