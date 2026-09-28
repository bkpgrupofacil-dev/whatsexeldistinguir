// Leitura da planilha, triagem de cada linha e montagem do resultado.
// Uma linha pode ter vários telefones (ex.: telefone1, telefone2, telefone3...).

import ExcelJS from 'exceljs';
import { triar, podeChecar, TIPOS } from './triagem.js';

/**
 * Lê a planilha e faz a triagem de cada telefone de cada linha.
 * Devolve { livro, aba, colunas: [{ numero, nome }], nomeColuna, linhas: [{ linha, rs: [r, ...] }] }
 * (rs tem um resultado de triagem por coluna de telefone, na mesma ordem de colunas).
 */
export async function lerPlanilha(arquivo, { coluna, aba: nomeAba, ddd, csv, apagarFixos = false } = {}) {
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
    separarNumerosJuntos(linha, colunas, ddd);
    const rs = colunas.map((c) => {
      const r = triar(textoCelula(linha.getCell(c.numero)), { dddPadrao: ddd });
      if (!apagarFixos || r.tipo !== TIPOS.FIXO) return r;
      linha.getCell(c.numero).value = null; // telefone fixo apagado da planilha
      return { ...triar(''), apagado: true };
    });
    linhas.push({ linha, rs });
  }
  return { livro, aba, colunas, nomeColuna: colunas.map((c) => c.nome).join(', '), linhas };
}

/**
 * Célula com dois números juntos (ex.: "85991430774  85988887777" ou "(85) 9999-1111 / 3222-3333"):
 * deixa o primeiro na célula e move os outros para colunas de telefone vazias da mesma linha.
 */
function separarNumerosJuntos(linha, colunas, ddd) {
  for (const c of colunas) {
    const texto = textoCelula(linha.getCell(c.numero));
    if (texto.replace(/\D/g, '').length < 16) continue;
    const partes = texto.split(/\s*(?:[\/;|,]|\be\b|\s{2,}|\t)\s*/).map((p) => p.trim()).filter(Boolean);
    if (partes.length < 2 || !partes.every((p) => triar(p, { dddPadrao: ddd }).numero)) continue;
    const vazias = colunas.filter((o) => !textoCelula(linha.getCell(o.numero)).trim());
    if (vazias.length < partes.length - 1) continue;
    linha.getCell(c.numero).value = partes[0];
    partes.slice(1).forEach((p, k) => (linha.getCell(vazias[k].numero).value = p));
  }
}

/** Um número entra na checagem? (com ignorarFixos, telefones fixos ficam de fora) */
function vaiChecar(r, ignorarFixos) {
  return podeChecar(r) && !(ignorarFixos && r.tipo === TIPOS.FIXO);
}

/** Contagem por tipo (ignorando células vazias) e lista de números (sem repetição) que dá para checar. */
export function resumir(linhas, { ignorarFixos = false } = {}) {
  const porTipo = {};
  const numeros = new Set();
  for (const { rs } of linhas) {
    for (const r of rs) {
      if (r.apagado) porTipo['Fixo (apagado)'] = (porTipo['Fixo (apagado)'] || 0) + 1;
      if (r.tipo === TIPOS.VAZIO) continue;
      porTipo[r.tipo] = (porTipo[r.tipo] || 0) + 1;
      if (vaiChecar(r, ignorarFixos)) numeros.add(r.numero);
    }
  }
  return { total: linhas.length, porTipo, numeros: [...numeros] };
}

const COR_SIM = 'FFC6EFCE';
const COR_NAO = 'FFFFC7CE';
const COR_CORRIGIR = 'FFFFFF00';

/**
 * Corrige o formato dos telefones nas colunas originais (só dígitos, DDD + número, ex.: 85999998888;
 * os que não dá para corrigir, como sem DDD ou inválidos, ficam pintados de amarelo)
 * e acrescenta as colunas de resultado no fim da planilha:
 *  - para cada coluna de telefone: "<coluna> - tipo" e "<coluna> - WhatsApp"
 *  - "Números com WhatsApp" (todos os da linha que têm) e "Tem WhatsApp?" (resumo da linha)
 * respostas: { '5511987654321': 'Sim' | 'Não' }. Com soTriagem, nada aparece como checado.
 * Com ignorarFixos, telefones fixos aparecem como "Não checado (fixo)".
 */
export function aplicarResultado({ aba, colunas, linhas }, respostas = {}, { soTriagem = false, ignorarFixos = false } = {}) {
  corrigirFormato(colunas, linhas);
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
    let fixosIgnorados = 0;
    rs.forEach((r, i) => {
      const cTipo = linha.getCell(base + 1 + i * 2);
      const cWhats = linha.getCell(base + 2 + i * 2);
      if (r.tipo === TIPOS.VAZIO) return;
      cTipo.value = r.tipo === TIPOS.INVALIDO || r.tipo === TIPOS.SEM_DDD ? `${r.tipo} (${r.motivo})` : r.tipo;
      if (!podeChecar(r)) {
        cWhats.value = 'Não';
        return;
      }
      if (!vaiChecar(r, ignorarFixos)) {
        cWhats.value = 'Não checado (fixo)';
        fixosIgnorados++;
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
    else if (!checaveis && fixosIgnorados) resumo = 'Só telefone fixo';
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

/**
 * Planilha limpa: só as colunas do arquivo original (sem as colunas de resultado),
 * com os telefones corrigidos. Os fixos já chegam apagados se a planilha foi lida com apagarFixos.
 * soWhatsApp: mantém só os telefones confirmados com WhatsApp e só as linhas que ficaram com algum.
 * Devolve um novo ExcelJS.Workbook.
 */
export function planilhaLimpa({ aba, colunas, linhas }, respostas = {}, { soWhatsApp = false } = {}) {
  const livro = new ExcelJS.Workbook();
  const nova = livro.addWorksheet(aba.name);
  aba.columns?.forEach((c, i) => {
    if (c.width) nova.getColumn(i + 1).width = c.width;
  });
  copiarLinha(aba.getRow(1), nova.getRow(1));

  let destino = 2;
  for (const { linha, rs } of linhas) {
    let algum = false;
    const valores = rs.map((r) => {
      const numero = r.tipo === TIPOS.INTERNACIONAL ? `+${r.numero}` : r.numero.slice(2);
      if (soWhatsApp) {
        if (respostas[r.numero] !== 'Sim') return null;
        algum = true;
        return numero;
      }
      if (r.tipo === TIPOS.VAZIO) return null; // células só com espaço
      return r.tipo === TIPOS.CELULAR || r.tipo === TIPOS.FIXO ? numero : undefined; // undefined: mantém como está
    });
    if (soWhatsApp && !algum) continue;
    const alvo = nova.getRow(destino++);
    copiarLinha(linha, alvo);
    valores.forEach((v, i) => {
      if (v !== undefined) alvo.getCell(colunas[i].numero).value = v;
    });
  }
  return livro;
}

function copiarLinha(de, para) {
  de.eachCell({ includeEmpty: false }, (celula, col) => {
    const alvo = para.getCell(col);
    alvo.value = celula.value;
    alvo.style = celula.style;
  });
}

function corrigirFormato(colunas, linhas) {
  for (const { linha, rs } of linhas) {
    rs.forEach((r, i) => {
      const celula = linha.getCell(colunas[i].numero);
      if (r.tipo === TIPOS.CELULAR || r.tipo === TIPOS.FIXO) {
        celula.value = r.numero.slice(2); // tira o 55
      } else if (r.tipo === TIPOS.INVALIDO || r.tipo === TIPOS.SEM_DDD) {
        celula.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COR_CORRIGIR } };
      }
    });
  }
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
