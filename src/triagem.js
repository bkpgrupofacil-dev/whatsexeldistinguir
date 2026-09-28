// Triagem de números de telefone brasileiros pelo formato.
// Não consulta o WhatsApp: só diz se o número é celular, fixo, inválido etc.

export const DDDS_VALIDOS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19,
  21, 22, 24, 27, 28,
  31, 32, 33, 34, 35, 37, 38,
  41, 42, 43, 44, 45, 46, 47, 48, 49,
  51, 53, 54, 55,
  61, 62, 63, 64, 65, 66, 67, 68, 69,
  71, 73, 74, 75, 77, 79,
  81, 82, 83, 84, 85, 86, 87, 88, 89,
  91, 92, 93, 94, 95, 96, 97, 98, 99,
]);

export const TIPOS = {
  CELULAR: 'Celular',
  FIXO: 'Fixo',
  INTERNACIONAL: 'Internacional',
  SEM_DDD: 'Sem DDD',
  SERVICO: 'Serviço (0800/0300/4004)',
  INVALIDO: 'Inválido',
  VAZIO: 'Vazio',
};

/**
 * Analisa um número e devolve:
 *  - tipo: um dos TIPOS
 *  - numero: número normalizado para consulta (ex.: 5511987654321) ou '' se não der
 *  - formatado: forma legível (ex.: (11) 98765-4321)
 *  - motivo: explicação curta
 *
 * dddPadrao: DDD a usar quando o número vier sem DDD (opcional).
 */
export function triar(valor, { dddPadrao } = {}) {
  const original = valor == null ? '' : String(valor).trim();
  if (!original) return resultado(TIPOS.VAZIO, '', '', 'Célula vazia');

  // Excel às vezes guarda o número como 5.51198765432E+12
  let texto = original;
  if (/^\d+(\.\d+)?e\+\d+$/i.test(texto)) texto = BigInt(Math.round(Number(texto))).toString();

  const temMais = texto.startsWith('+');
  let d = texto.replace(/\D/g, '');

  if (!d) return resultado(TIPOS.INVALIDO, '', '', 'Sem dígitos');

  // Número estrangeiro: +XX que não seja +55
  if (temMais && !d.startsWith('55')) {
    if (d.length < 8 || d.length > 15) return resultado(TIPOS.INVALIDO, '', '', 'Tamanho internacional inválido');
    return resultado(TIPOS.INTERNACIONAL, d, `+${d}`, 'Número de outro país');
  }

  // Números de serviço
  if (/^0?(800|300|303|500|900)\d{6,7}$/.test(d) || /^[34]00[0-9]\d{4}$/.test(d)) {
    return resultado(TIPOS.SERVICO, '', d, 'Número de serviço, não usa WhatsApp pessoal');
  }

  // Tira o 55 do país
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) d = d.slice(2);
  // Tira o 0 de discagem e o código de operadora (ex.: 0 15 11 98765-4321)
  if (d.startsWith('0')) {
    d = d.replace(/^0+/, '');
    if (d.length === 12 || d.length === 13) d = d.slice(2);
  }

  // Sem DDD
  if (d.length === 8 || d.length === 9) {
    if (!dddPadrao) return resultado(TIPOS.SEM_DDD, '', d, 'Falta o DDD');
    d = String(dddPadrao) + d;
  }

  if (d.length !== 10 && d.length !== 11) {
    return resultado(TIPOS.INVALIDO, '', '', `Quantidade de dígitos errada (${d.length})`);
  }

  const ddd = Number(d.slice(0, 2));
  if (!DDDS_VALIDOS.has(ddd)) return resultado(TIPOS.INVALIDO, '', '', `DDD ${d.slice(0, 2)} não existe`);

  let local = d.slice(2);
  if (/^(\d)\1+$/.test(local)) return resultado(TIPOS.INVALIDO, '', '', 'Dígitos todos iguais');

  if (local.length === 9) {
    if (local[0] !== '9') return resultado(TIPOS.INVALIDO, '', '', 'Celular com 9 dígitos deve começar com 9');
    return resultado(TIPOS.CELULAR, `55${ddd}${local}`, formatar(ddd, local), 'Celular');
  }

  // 8 dígitos
  if (/^[2-5]/.test(local)) {
    return resultado(TIPOS.FIXO, `55${ddd}${local}`, formatar(ddd, local), 'Telefone fixo');
  }
  if (/^[6-9]/.test(local)) {
    local = `9${local}`;
    return resultado(TIPOS.CELULAR, `55${ddd}${local}`, formatar(ddd, local), 'Celular antigo, 9 acrescentado');
  }
  return resultado(TIPOS.INVALIDO, '', '', 'Número local começa com dígito inválido');
}

function formatar(ddd, local) {
  const corte = local.length - 4;
  return `(${ddd}) ${local.slice(0, corte)}-${local.slice(corte)}`;
}

function resultado(tipo, numero, formatado, motivo) {
  return { tipo, numero, formatado, motivo };
}

/** Palpite de WhatsApp só pelo formato (sem consultar). */
export function palpite(tipo) {
  switch (tipo) {
    case TIPOS.CELULAR: return 'Provável';
    case TIPOS.INTERNACIONAL: return 'Possível';
    case TIPOS.FIXO: return 'Improvável (só se for WhatsApp Business)';
    default: return 'Não';
  }
}

/** Vale a pena consultar no WhatsApp? */
export function podeChecar(r) {
  return Boolean(r.numero);
}
