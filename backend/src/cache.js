// Respostas do WhatsApp já obtidas ({ numero: 'Sim' | 'Não' }), salvas em arquivo JSON.

import fs from 'node:fs';

export class Cache {
  constructor(arquivo) {
    this.arquivo = arquivo;
    this.dados = fs.existsSync(arquivo) ? JSON.parse(fs.readFileSync(arquivo, 'utf8')) : {};
  }

  tem(numero) {
    return numero in this.dados;
  }

  get(numero) {
    return this.dados[numero];
  }

  set(numero, resposta) {
    this.dados[numero] = resposta;
    const tmp = `${this.arquivo}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.dados));
    fs.renameSync(tmp, this.arquivo);
  }

  get tamanho() {
    return Object.keys(this.dados).length;
  }
}
