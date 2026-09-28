// Checagem real: pergunta ao WhatsApp se o número está cadastrado.
// Usa a biblioteca não oficial Baileys (conecta como WhatsApp Web via QR Code).
// ATENÇÃO: uso fora dos termos do WhatsApp. Muitas consultas podem banir o número conectado.

import makeWASocket, { DisconnectReason, fetchLatestBaileysVersion, useMultiFileAuthState } from 'baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';

const PASTA_LOGIN = '.login-whatsapp';

/** Conecta ao WhatsApp e devolve o socket quando a conexão estiver aberta. */
export async function conectar() {
  const { state, saveCreds } = await useMultiFileAuthState(PASTA_LOGIN);
  const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));

  return new Promise((resolve, reject) => {
    const iniciar = () => {
      const sock = makeWASocket({
        auth: state,
        version,
        logger: pino({ level: 'silent' }),
        markOnlineOnConnect: false,
        syncFullHistory: false,
      });
      sock.ev.on('creds.update', saveCreds);
      sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
        if (qr) {
          console.log('\nAbra o WhatsApp no celular > Aparelhos conectados > Conectar um aparelho, e leia o QR Code:\n');
          qrcode.generate(qr, { small: true });
        }
        if (connection === 'open') {
          console.log('Conectado ao WhatsApp.');
          resolve(sock);
        }
        if (connection === 'close') {
          const codigo = lastDisconnect?.error?.output?.statusCode;
          if (codigo === DisconnectReason.loggedOut) {
            reject(new Error(`Sessão encerrada no celular. Apague a pasta ${PASTA_LOGIN} e rode de novo para ler outro QR Code.`));
          } else if (codigo === DisconnectReason.forbidden) {
            reject(new Error('O WhatsApp bloqueou esta conta (403). Pare as checagens.'));
          } else {
            iniciar(); // reconexão normal (ex.: logo após ler o QR Code)
          }
        }
      });
    };
    iniciar();
  });
}

/** true se o número (ex.: 5511987654321) tem WhatsApp, false se não tem. */
export async function temWhatsApp(sock, numero) {
  const res = await sock.onWhatsApp(numero);
  return Boolean(res?.some((r) => r.exists));
}

export const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
