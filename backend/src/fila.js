// Fila de planilhas: guarda cada envio em disco e checa os números um por um no WhatsApp,
// respeitando o intervalo entre consultas e o limite diário.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { lerPlanilha, resumir, aplicarResultado, planilhaLimpa } from './planilha.js';
import { ESTADOS } from './whatsapp.js';

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

export const STATUS = {
  NA_FILA: 'na_fila',
  CHECANDO: 'checando',
  PAUSADO: 'pausado',
  CONCLUIDO: 'concluido',
};

export class Fila {
  constructor({ pasta, wa, cache, intervaloMs, limiteDiario, fusoHorario }) {
    this.pasta = pasta;
    this.pastaJobs = path.join(pasta, 'planilhas');
    this.arquivoUso = path.join(pasta, 'uso.json');
    this.wa = wa;
    this.cache = cache;
    this.intervaloMs = intervaloMs;
    this.limiteDiario = limiteDiario;
    this.fusoHorario = fusoHorario;
    this.jobs = new Map();
    this.situacao = 'Parado';
    this.acordarFila = null;
    fs.mkdirSync(this.pastaJobs, { recursive: true });
    this.uso = fs.existsSync(this.arquivoUso) ? JSON.parse(fs.readFileSync(this.arquivoUso, 'utf8')) : { dia: '', consultas: 0 };
    this.carregar();
  }

  carregar() {
    for (const id of fs.readdirSync(this.pastaJobs)) {
      const arq = path.join(this.pastaJobs, id, 'job.json');
      if (!fs.existsSync(arq)) continue;
      const job = JSON.parse(fs.readFileSync(arq, 'utf8'));
      if (job.status === STATUS.CHECANDO) job.status = STATUS.NA_FILA;
      this.jobs.set(id, job);
    }
  }

  async criar({ buffer, nome, opcoes }) {
    const ext = path.extname(nome).toLowerCase();
    if (ext !== '.xlsx' && ext !== '.csv') throw new ErroUsuario('Envie um arquivo .xlsx ou .csv (se for .xls, abra no Excel e salve como .xlsx).');

    const id = `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
    const dir = path.join(this.pastaJobs, id);
    fs.mkdirSync(dir, { recursive: true });
    const entrada = path.join(dir, `entrada${ext}`);
    fs.writeFileSync(entrada, buffer);

    let planilha;
    try {
      planilha = await lerPlanilha(entrada, opcoes);
    } catch (e) {
      fs.rmSync(dir, { recursive: true, force: true });
      throw new ErroUsuario(`Não consegui ler a planilha: ${e.message}`);
    }
    const { total, porTipo, numeros } = resumir(planilha.linhas, opcoes);

    const job = {
      id,
      nome,
      entrada: path.basename(entrada),
      criadoEm: new Date().toISOString(),
      opcoes,
      coluna: planilha.nomeColuna,
      total,
      porTipo,
      numeros,
      status: opcoes.soTriagem ? STATUS.CONCLUIDO : STATUS.NA_FILA,
      erro: null,
    };
    this.salvar(job);
    this.acordar();
    return this.publico(job);
  }

  listar() {
    return [...this.jobs.values()].sort((a, b) => b.criadoEm.localeCompare(a.criadoEm)).map((j) => this.publico(j));
  }

  obter(id) {
    const job = this.jobs.get(id);
    if (!job) throw new ErroUsuario('Planilha não encontrada', 404);
    return job;
  }

  publico(job) {
    const { numeros, ...resto } = job;
    let checados = 0;
    let sim = 0;
    for (const n of numeros) {
      const r = this.cache.get(n);
      if (r) checados++;
      if (r === 'Sim') sim++;
    }
    return { ...resto, progresso: { aChecar: numeros.length, checados, sim, nao: checados - sim } };
  }

  /** Planilha de resultado (buffer .xlsx) com o que já foi checado até agora. */
  async resultado(id) {
    const job = this.obter(id);
    const planilha = await lerPlanilha(path.join(this.pastaJobs, id, job.entrada), job.opcoes);
    aplicarResultado(planilha, this.cache.dados, job.opcoes);
    return { buffer: await planilha.livro.xlsx.writeBuffer(), nome: `${path.parse(job.nome).name}-resultado.xlsx` };
  }

  /**
   * Planilha limpa no mesmo formato da enviada: telefones corrigidos e fixos apagados.
   * soWhatsApp: só os telefones (e as linhas) com WhatsApp confirmado.
   */
  async limpa(id, { soWhatsApp = false } = {}) {
    const job = this.obter(id);
    const planilha = await lerPlanilha(path.join(this.pastaJobs, id, job.entrada), { ...job.opcoes, apagarFixos: true });
    const livro = planilhaLimpa(planilha, this.cache.dados, { soWhatsApp });
    const sufixo = soWhatsApp ? 'so-whatsapp' : 'limpa';
    return { buffer: await livro.xlsx.writeBuffer(), nome: `${path.parse(job.nome).name}-${sufixo}.xlsx` };
  }

  pausar(id) {
    const job = this.obter(id);
    if (job.status === STATUS.NA_FILA || job.status === STATUS.CHECANDO) {
      job.status = STATUS.PAUSADO;
      this.salvar(job);
    }
    return this.publico(job);
  }

  retomar(id) {
    const job = this.obter(id);
    if (job.status === STATUS.PAUSADO || (job.status === STATUS.CONCLUIDO && job.opcoes.soTriagem)) {
      job.opcoes.soTriagem = false;
      job.status = STATUS.NA_FILA;
      job.erro = null;
      this.salvar(job);
      this.acordar();
    }
    return this.publico(job);
  }

  excluir(id) {
    this.obter(id);
    this.jobs.delete(id);
    fs.rmSync(path.join(this.pastaJobs, id), { recursive: true, force: true });
  }

  /** Consultas feitas hoje. */
  usoHoje() {
    const hoje = this.hoje();
    if (this.uso.dia !== hoje) this.uso = { dia: hoje, consultas: 0 };
    return this.uso.consultas;
  }

  limiteAtingido() {
    return this.usoHoje() >= this.limiteDiario;
  }

  /** Consulta um número no WhatsApp, contando no limite diário. */
  async consultar(numero) {
    if (this.cache.tem(numero)) return this.cache.get(numero);
    if (this.limiteAtingido()) throw new ErroUsuario(`Limite diário de ${this.limiteDiario} consultas atingido. Tente amanhã.`, 429);
    if (this.wa.estado !== ESTADOS.CONECTADO) throw new ErroUsuario('Conecte o WhatsApp antes de checar.', 409);
    const resposta = (await this.wa.temWhatsApp(numero)) ? 'Sim' : 'Não';
    this.cache.set(numero, resposta);
    this.usoHoje();
    this.uso.consultas++;
    fs.writeFileSync(this.arquivoUso, JSON.stringify(this.uso));
    return resposta;
  }

  /** Laço que processa a fila para sempre. */
  async rodar() {
    let erros = 0;
    this.parado = false;
    while (!this.parado) {
      const job = this.proximo();
      if (!job) {
        this.situacao = 'Sem planilhas para checar';
        await this.dormir();
        continue;
      }
      const numero = job.numeros.find((n) => !this.cache.tem(n));
      if (!numero) {
        job.status = STATUS.CONCLUIDO;
        this.salvar(job);
        continue;
      }
      if (this.wa.estado !== ESTADOS.CONECTADO) {
        this.situacao = 'Aguardando o WhatsApp ser conectado';
        await this.dormir(5000);
        continue;
      }
      if (this.limiteAtingido()) {
        this.situacao = `Limite diário de ${this.limiteDiario} consultas atingido. Continua amanhã.`;
        await this.dormir(60_000);
        continue;
      }

      if (job.status !== STATUS.CHECANDO) {
        job.status = STATUS.CHECANDO;
        this.salvar(job);
      }
      this.situacao = `Checando "${job.nome}"`;
      try {
        await this.consultar(numero);
        erros = 0;
      } catch (e) {
        console.error(`Erro ao checar ${numero}: ${e.message}`);
        if (++erros >= 3) {
          erros = 0;
          job.status = STATUS.PAUSADO;
          job.erro = `Pausado após 3 erros seguidos (${e.message}). Clique em continuar para tentar de novo.`;
          this.salvar(job);
        }
      }
      // intervalo com variação aleatória de ±30% para não parecer robô
      await esperar(this.intervaloMs * (0.7 + Math.random() * 0.6));
    }
  }

  parar() {
    this.parado = true;
    this.acordar();
  }

  proximo() {
    return [...this.jobs.values()]
      .filter((j) => j.status === STATUS.NA_FILA || j.status === STATUS.CHECANDO)
      .sort((a, b) => a.criadoEm.localeCompare(b.criadoEm))[0];
  }

  /** Espera até alguém chamar acordar() ou o tempo passar. */
  dormir(ms) {
    return new Promise((resolve) => {
      const t = ms ? setTimeout(resolve, ms) : null;
      this.acordarFila = () => {
        clearTimeout(t);
        resolve();
      };
    });
  }

  acordar() {
    this.acordarFila?.();
    this.acordarFila = null;
  }

  salvar(job) {
    this.jobs.set(job.id, job);
    const dir = path.join(this.pastaJobs, job.id);
    if (fs.existsSync(dir)) fs.writeFileSync(path.join(dir, 'job.json'), JSON.stringify(job));
  }

  hoje() {
    return new Date().toLocaleDateString('sv-SE', { timeZone: this.fusoHorario });
  }
}

export class ErroUsuario extends Error {
  constructor(mensagem, status = 400) {
    super(mensagem);
    this.status = status;
  }
}
