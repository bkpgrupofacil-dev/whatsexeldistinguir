#!/usr/bin/env node
// Versão de linha de comando: lê uma planilha, faz a triagem e (opcionalmente) checa no WhatsApp.
// Uso: node src/cli.js contatos.xlsx [opções]   (veja o README)

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import qrcode from 'qrcode-terminal';
import { lerPlanilha, resumir, aplicarResultado } from './planilha.js';
import { Cache } from './cache.js';

const AJUDA = `
Uso: node src/cli.js <planilha.xlsx|.csv> [opções]

Opções:
  --coluna NOMES    Nomes ou letras das colunas de telefone, separados por vírgula (ex.: "C,D"). Padrão: detecta sozinho
  --aba NOME        Aba da planilha. Padrão: a primeira
  --ddd XX          DDD para números que vieram sem DDD
  --so-triagem      Só faz a triagem pelo formato, sem conectar no WhatsApp
  --ignorar-fixos   Não consulta telefones fixos no WhatsApp (só celulares)
  --intervalo S     Segundos entre cada consulta ao WhatsApp. Padrão: 5
  --limite N        Máximo de consultas nesta execução. Padrão: 200
  --saida ARQUIVO   Arquivo de resultado. Padrão: <nome>-resultado.xlsx
`;

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const { values: op, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      coluna: { type: 'string' },
      aba: { type: 'string' },
      ddd: { type: 'string' },
      'so-triagem': { type: 'boolean', default: false },
      'ignorar-fixos': { type: 'boolean', default: false },
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

  const planilha = await lerPlanilha(arquivo, { coluna: op.coluna, aba: op.aba, ddd: op.ddd });
  console.log(`Colunas de telefone: ${planilha.nomeColuna}`);

  const { porTipo, numeros } = resumir(planilha.linhas, { ignorarFixos: op['ignorar-fixos'] });
  console.log('\nTriagem:');
  for (const [tipo, n] of Object.entries(porTipo)) console.log(`  ${tipo}: ${n}`);

  const cache = new Cache('cache-checagem.json');
  if (!op['so-triagem']) {
    await checar(numeros, cache, { intervalo: Number(op.intervalo) * 1000, limite: Number(op.limite) });
  }

  const { sim, nao } = aplicarResultado(planilha, cache.dados, { soTriagem: op['so-triagem'], ignorarFixos: op['ignorar-fixos'] });
  if (!op['so-triagem']) console.log(`\nCom WhatsApp: ${sim} | Sem WhatsApp: ${nao}`);

  const saida = op.saida || path.join(path.dirname(arquivo), `${path.parse(arquivo).name}-resultado.xlsx`);
  await planilha.livro.xlsx.writeFile(saida);
  console.log(`\nResultado salvo em: ${saida}`);
  process.exit(0);
}

async function checar(numeros, cache, { intervalo, limite }) {
  const pendentes = numeros.filter((n) => !cache.tem(n));
  const agora = pendentes.slice(0, limite);
  console.log(`\nChecagem: ${pendentes.length} números novos para consultar (${cache.tamanho} já no cache).`);
  if (pendentes.length > agora.length) console.log(`Nesta execução serão consultados ${agora.length} (--limite). Rode de novo depois para continuar.`);
  if (!agora.length) return;

  const { WhatsApp } = await import('./whatsapp.js');
  const wa = new WhatsApp('.login-whatsapp');
  await new Promise((resolve, reject) => {
    wa.on('qr', (qr) => {
      console.log('\nAbra o WhatsApp no celular > Aparelhos conectados > Conectar um aparelho, e leia o QR Code:\n');
      qrcode.generate(qr, { small: true });
    });
    wa.on('conectado', resolve);
    wa.on('estado', (e) => (e === 'desconectado' || e === 'bloqueado') && reject(new Error(wa.erro)));
    wa.conectar().catch(reject);
  });
  console.log('Conectado ao WhatsApp.');

  let erros = 0;
  for (const [i, numero] of agora.entries()) {
    try {
      cache.set(numero, (await wa.temWhatsApp(numero)) ? 'Sim' : 'Não');
      erros = 0;
    } catch (e) {
      console.log(`  erro em ${numero}: ${e.message}`);
      if (++erros >= 3) {
        console.log('3 erros seguidos. Parando para proteger a conta. Rode de novo mais tarde.');
        break;
      }
    }
    console.log(`  [${i + 1}/${agora.length}] ${numero}: ${cache.get(numero) ?? 'erro'}`);
    // intervalo com variação aleatória de ±30% para não parecer robô
    if (i < agora.length - 1) await esperar(intervalo * (0.7 + Math.random() * 0.6));
  }
  wa.fechar();
}

main().catch((e) => {
  console.error(`Erro: ${e.message}`);
  process.exit(1);
});
