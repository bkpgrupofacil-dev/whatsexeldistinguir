// Conexão com o WhatsApp para a checagem real.
// Usa a biblioteca não oficial Baileys (conecta como WhatsApp Web via QR Code).
// ATENÇÃO: uso fora dos termos do WhatsApp. Muitas consultas podem banir o número conectado.

import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import makeWASocket, { DisconnectReason, fetchLatestBaileysVersion, useMultiFileAuthState } from 'baileys';
import pino from 'pino';

export const ESTADOS = {
  DESCONECTADO: 'desconectado',
  CONECTANDO: 'conectando',
  AGUARDANDO_QR: 'aguardando_qr',
  CONECTADO: 'conectado',
  BLOQUEADO: 'bloqueado',
};

/**
 * Eventos: 'estado' (estado), 'qr' (texto do QR Code), 'conectado'.
 */
export class WhatsApp extends EventEmitter {
  constructor(pastaLogin) {
    super();
    this.pastaLogin = pastaLogin;
    this.estado = ESTADOS.DESCONECTADO;
    this.qr = null;
    this.numero = null;
    this.erro = null;
    this.sock = null;
  }

  /** Já existe login salvo? */
  temLogin() {
    return fs.existsSync(`${this.pastaLogin}/creds.json`);
  }

  async conectar() {
    if (this.sock) return;
    this.erro = null;
    this.mudarEstado(ESTADOS.CONECTANDO);
    const { state, saveCreds } = await useMultiFileAuthState(this.pastaLogin);
    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));

    const sock = makeWASocket({
      auth: state,
      version,
      logger: pino({ level: 'silent' }),
      markOnlineOnConnect: false,
      syncFullHistory: false,
    });
    this.sock = sock;
    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
      if (this.sock !== sock) return; // socket antigo
      if (qr) {
        this.qr = qr;
        this.mudarEstado(ESTADOS.AGUARDANDO_QR);
        this.emit('qr', qr);
      }
      if (connection === 'open') {
        this.qr = null;
        this.numero = sock.user?.id?.split(/[:@]/)[0] ?? null;
        this.mudarEstado(ESTADOS.CONECTADO);
        this.emit('conectado');
      }
      if (connection === 'close') {
        this.sock = null;
        this.qr = null;
        const codigo = lastDisconnect?.error?.output?.statusCode;
        if (codigo === DisconnectReason.loggedOut) {
          this.apagarLogin();
          this.erro = 'A sessão foi encerrada pelo celular. Conecte de novo.';
          this.mudarEstado(ESTADOS.DESCONECTADO);
        } else if (codigo === DisconnectReason.forbidden) {
          this.erro = 'O WhatsApp bloqueou esta conta (403). Pare as checagens.';
          this.mudarEstado(ESTADOS.BLOQUEADO);
        } else if (codigo === DisconnectReason.timedOut && this.estado === ESTADOS.AGUARDANDO_QR) {
          this.erro = 'O QR Code expirou sem ser lido. Clique em conectar de novo.';
          this.mudarEstado(ESTADOS.DESCONECTADO);
        } else {
          // queda normal (ex.: logo após ler o QR Code): reconecta
          this.mudarEstado(ESTADOS.CONECTANDO);
          setTimeout(() => this.conectar().catch((e) => this.falhar(e)), 2000);
        }
      }
    });
  }

  /** Desconecta e apaga o login (será preciso ler o QR Code de novo). */
  async sair() {
    const sock = this.sock;
    this.sock = null;
    if (sock) {
      await sock.logout().catch(() => {});
      sock.end(undefined);
    }
    this.apagarLogin();
    this.numero = null;
    this.qr = null;
    this.erro = null;
    this.mudarEstado(ESTADOS.DESCONECTADO);
  }

  /** Fecha a conexão sem apagar o login. */
  fechar() {
    const sock = this.sock;
    this.sock = null;
    sock?.end(undefined);
  }

  /** true se o número (ex.: 5511987654321) tem WhatsApp, false se não tem. */
  async temWhatsApp(numero) {
    if (this.estado !== ESTADOS.CONECTADO || !this.sock) throw new Error('WhatsApp não está conectado');
    const res = await this.sock.onWhatsApp(numero);
    return Boolean(res?.some((r) => r.exists));
  }

  apagarLogin() {
    fs.rmSync(this.pastaLogin, { recursive: true, force: true });
  }

  falhar(e) {
    this.sock = null;
    this.erro = e.message;
    this.mudarEstado(ESTADOS.DESCONECTADO);
  }

  mudarEstado(estado) {
    this.estado = estado;
    this.emit('estado', estado);
  }
}
