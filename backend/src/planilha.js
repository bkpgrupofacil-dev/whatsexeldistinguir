// Leitura da planilha, triagem de cada linha e montagem do resultado.
// Uma linha pode ter vários telefones (ex.: telefone1, telefone2, telefone3...).

import ExcelJS from 'exceljs';
import { triar, podeChecar, TIPOS } from './triagem.js';

/**
 * Lê a planilha e faz a triagem de cada telefone de cada linha.
 * Devolve { livro, aba, colunas: [{ numero, nome }], nomeColuna, linhas: [{ linha, rs: [r, ...] }] }
 * (rs tem um resultado de triagem por coluna de telefone, na mesma ordem de colunas).
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

  const colunas = acharColunas(aba, coluna).map((numero) => ({ numero, nome: textoCelula(aba.getRow(1).getCell(numero)) || `Coluna ${numero}` }));
  const linhas = [];
  for (let i = 2; i <= aba.rowCount; i++) {
    const linha = aba.getRow(i);
    linhas.push({ linha, rs: colunas.map((c) => triar(textoCelula(linha.getCell(c.numero)), { dddPadrao: ddd })) });
  }
  return { livro, aba, colunas, nomeColuna: colunas.map((c) => c.nome).join(', '), linhas };
}

/** Contagem por tipo (ignorando células vazias) e lista de números (sem repetição) que dá para checar. */
export function resumir(linhas) {
  const porTipo = {};
  const numeros = new Set();
  for (const { rs } of linhas) {
    for (const r of rs) {
      if (r.tipo === TIPOS.VAZIO) continue;
      porTipo[r.tipo] = (porTipo[r.tipo] || 0) + 1;
      if (podeChecar(r)) numeros.add(r.numero);
    }
  }
  return { total: linhas.length, porTipo, numeros: [...numeros] };
}

const COR_SIM = 'FFC6EFCE';
const COR_NAO = 'FFFFC7CE';

/**
 * Acrescenta as colunas de resultado no fim da planilha:
 *  - para cada coluna de telefone: "<coluna> - tipo" e "<coluna> - WhatsApp"
 *  - "Números com WhatsApp" (todos os da linha que têm) e "Tem WhatsApp?" (resumo da linha)
 * respostas: { '5511987654321': 'Sim' | 'Não' }. Com soTriagem, nada aparece como checado.
 */
export function aplicarResultado({ aba, colunas, linhas }, respostas = {}, { soTriagem = false } = {}) {
  const base = aba.columnCount;
  const cabecalhos = [];
  for (const c of colunas) cabecalhos.push(`${c.nome} - tipo`, `${c.nome} - WhatsApp`);
  cabecalhos.push('Números com WhatsApp', 'Tem WhatsApp?');
  cabecalhos.forEach((h, i) => {
    const cel = aba.getRow(1).getCell(base + 1 + i);
    cel.value = h;
    cel.font = { bold: true };
  });

  let sim = 0;
  let nao = 0;
  for (const { linha, rs } of linhas) {
    const comWhats = [];
    let checaveis = 0;
    let checados = 0;
    rs.forEach((r, i) => {
      const cTipo = linha.getCell(base + 1 + i * 2);
      const cWhats = linha.getCell(base + 2 + i * 2);
      if (r.tipo === TIPOS.VAZIO) return;
      cTipo.value = r.tipo === TIPOS.INVALIDO || r.tipo === TIPOS.SEM_DDD ? `${r.tipo} (${r.motivo})` : r.tipo;
      if (!podeChecar(r)) {
        cWhats.value = 'Não';
        return;
      }
      checaveis++;
      const resp = soTriagem ? undefined : respostas[r.numero];
      cWhats.value = resp ?? 'Não checado';
      if (resp) checados++;
      if (resp === 'Sim') comWhats.push(r.numero);
      pintar(cWhats, resp);
    });

    let resumo;
    if (comWhats.length) resumo = 'Sim';
    else if (!checaveis) resumo = 'Sem número válido';
    else if (checados === checaveis) resumo = 'Não';
    else resumo = 'Não checado';
    if (resumo === 'Sim') sim++;
    if (resumo === 'Não') nao++;

    linha.getCell(base + 1 + rs.length * 2).value = [...new Set(comWhats)].join(', ');
    const cResumo = linha.getCell(base + 2 + rs.length * 2);
    cResumo.value = resumo;
    pintar(cResumo, resumo);
  }
  return { sim, nao };
}

function pintar(celula, valor) {
  const cor = valor === 'Sim' ? COR_SIM : valor === 'Não' ? COR_NAO : null;
  if (cor) celula.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: cor } };
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

/**
 * Colunas de telefone. "pedida" pode ser nomes ou letras separados por vírgula (ex.: "C, D" ou "Telefone, Celular").
 * Sem "pedida": todas as colunas cujo cabeçalho parece telefone.
 */
function acharColunas(aba, pedida) {
  const cab = aba.getRow(1);
  const nomes = [];
  for (let c = 1; c <= aba.columnCount; c++) nomes.push([c, normalizar(textoCelula(cab.getCell(c)))]);

  if (pedida) {
    return pedida.split(',').map((p) => p.trim()).filter(Boolean).map((p) => {
      if (/^[A-Z]{1,3}$/i.test(p)) return aba.getColumn(p.toUpperCase()).number;
      const achada = nomes.find(([, n]) => n === normalizar(p));
      if (!achada) throw new Error(`Coluna "${p}" não encontrada no cabeçalho.`);
      return achada[0];
    });
  }

  const fortes = nomes.filter(([, n]) => /whats|celular|telefone|fone|phone|^tel\b|^tel\d|^tel$/.test(n)).map(([c]) => c);
  if (fortes.length) return fortes;
  const fracas = nomes.filter(([, n]) => /numero|contato/.test(n)).map(([c]) => c);
  if (fracas.length) return fracas.slice(0, 1);

  // Sem cabeçalho reconhecível: coluna com mais valores que parecem telefone
  let melhor = 1;
  let max = -1;
  for (let c = 1; c <= aba.columnCount; c++) {
    let n = 0;
    for (let i = 2; i <= Math.min(aba.rowCount, 50); i++) if (triar(textoCelula(aba.getRow(i).getCell(c))).numero) n++;
    if (n > max) [melhor, max] = [c, n];
  }
  return [melhor];
}

const normalizar = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
