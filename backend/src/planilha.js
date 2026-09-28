// Leitura da planilha, triagem de cada linha e montagem do resultado.

import ExcelJS from 'exceljs';
import { triar, palpite, podeChecar } from './triagem.js';

export const CABECALHOS = ['Número normalizado', 'Tipo', 'Observação', 'WhatsApp pelo formato', 'Tem WhatsApp? (checado)'];

/**
 * Lê a planilha e faz a triagem de cada linha.
 * Devolve { livro, aba, colTel, nomeColuna, linhas: [{ linha, r }] }.
 */
export async function lerPlanilha(arquivo, { coluna, aba: nomeAba, ddd, csv } = {}) {
  const livro = new ExcelJS.Workbook();
  const ehCsv = csv ?? arquivo.toLowerCase().endsWith('.csv');
  let aba;
  if (ehCsv) {
    aba = await livro.csv.readFile(arquivo);
  } else {
    await livro.xlsx.readFile(arquivo);
    aba = nomeAba ? livro.getWorksheet(nomeAba) : livro.worksheets[0];
  }
  if (!aba) throw new Error(nomeAba ? `Aba não encontrada: ${nomeAba}` : 'A planilha está vazia');

  const colTel = acharColuna(aba, coluna);
  const linhas = [];
  for (let i = 2; i <= aba.rowCount; i++) {
    const linha = aba.getRow(i);
    linhas.push({ linha, r: triar(textoCelula(linha.getCell(colTel)), { dddPadrao: ddd }) });
  }
  return { livro, aba, colTel, nomeColuna: textoCelula(aba.getRow(1).getCell(colTel)), linhas };
}

/** Contagem por tipo e lista de números (sem repetição) que dá para checar. */
export function resumir(linhas) {
  const porTipo = {};
  for (const { r } of linhas) porTipo[r.tipo] = (porTipo[r.tipo] || 0) + 1;
  const numeros = [...new Set(linhas.filter(({ r }) => podeChecar(r)).map(({ r }) => r.numero))];
  return { total: linhas.length, porTipo, numeros };
}

/**
 * Acrescenta as colunas de resultado na planilha.
 * respostas: objeto { '5511987654321': 'Sim' | 'Não' }. Com soTriagem, a coluna de checagem fica "Não checado".
 */
export function aplicarResultado({ aba, linhas }, respostas = {}, { soTriagem = false } = {}) {
  const base = aba.columnCount;
  const [cNum, cTipo, cObs, cPalpite, cTem] = CABECALHOS.map((_, i) => base + 1 + i);
  CABECALHOS.forEach((h, i) => {
    const c = aba.getRow(1).getCell(base + 1 + i);
    c.value = h;
    c.font = { bold: true };
  });

  let sim = 0;
  let nao = 0;
  for (const { linha, r } of linhas) {
    linha.getCell(cNum).value = r.numero || r.formatado;
    linha.getCell(cTipo).value = r.tipo;
    linha.getCell(cObs).value = r.motivo;
    linha.getCell(cPalpite).value = palpite(r.tipo);

    let tem;
    if (!podeChecar(r)) tem = 'Não (número inválido)';
    else if (soTriagem) tem = 'Não checado';
    else tem = respostas[r.numero] ?? 'Não checado ainda';
    const celula = linha.getCell(cTem);
    celula.value = tem;
    if (tem === 'Sim') sim++;
    if (tem === 'Não') nao++;
    const cor = tem === 'Sim' ? 'FFC6EFCE' : tem === 'Não' ? 'FFFFC7CE' : null;
    if (cor) celula.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: cor } };
  }
  return { sim, nao };
}

export function textoCelula(celula) {
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
  let melhor = 1;
  let max = -1;
  for (let c = 1; c <= aba.columnCount; c++) {
    let n = 0;
    for (let i = 2; i <= Math.min(aba.rowCount, 50); i++) if (triar(textoCelula(aba.getRow(i).getCell(c))).numero) n++;
    if (n > max) [melhor, max] = [c, n];
  }
  return melhor;
}

const normalizar = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
