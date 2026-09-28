import { test } from 'node:test';
import assert from 'node:assert/strict';
import { triar, TIPOS } from '../src/triagem.js';

const casos = [
  ['(11) 98765-4321', TIPOS.CELULAR, '5511987654321'],
  ['+55 21 99876-5432', TIPOS.CELULAR, '5521998765432'],
  ['5511987654321', TIPOS.CELULAR, '5511987654321'],
  [5511987654321, TIPOS.CELULAR, '5511987654321'],
  ['011 98765-4321', TIPOS.CELULAR, '5511987654321'],
  ['0 15 11 98765-4321', TIPOS.CELULAR, '5511987654321'],
  ['11 8765-4321', TIPOS.CELULAR, '5511987654321'], // celular antigo sem o 9
  ['(11) 3456-7890', TIPOS.FIXO, '551134567890'],
  ['98765-4321', TIPOS.SEM_DDD, ''],
  ['(20) 98765-4321', TIPOS.INVALIDO, ''],
  ['(11) 99999-9999', TIPOS.INVALIDO, ''],
  ['(11) 88765-4321', TIPOS.INVALIDO, ''],
  ['123', TIPOS.INVALIDO, ''],
  ['0800 123 4567', TIPOS.SERVICO, ''],
  ['4004-1234', TIPOS.SERVICO, ''],
  ['+1 415 555 2671', TIPOS.INTERNACIONAL, '14155552671'],
  ['', TIPOS.VAZIO, ''],
  ['5.511987654321E+12', TIPOS.CELULAR, '5511987654321'],
];

for (const [entrada, tipo, numero] of casos) {
  test(`${JSON.stringify(entrada)} -> ${tipo}`, () => {
    const r = triar(entrada);
    assert.equal(r.tipo, tipo, r.motivo);
    assert.equal(r.numero, numero);
  });
}

test('usa DDD padrão quando falta', () => {
  assert.equal(triar('98765-4321', { dddPadrao: '31' }).numero, '5531987654321');
});
