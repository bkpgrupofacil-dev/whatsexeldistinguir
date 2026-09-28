// API HTTP usada pelo frontend.

import path from 'node:path';
import express from 'express';
import multer from 'multer';
import QRCode from 'qrcode';
import { WhatsApp } from './whatsapp.js';
import { Cache } from './cache.js';
import { Fila, ErroUsuario } from './fila.js';
import { triar, palpite } from './triagem.js';

const PORTA = Number(process.env.PORTA || 3000);
const DADOS = process.env.DADOS || './dados';
const INTERVALO_SEGUNDOS = Number(process.env.INTERVALO_SEGUNDOS || 5);
const LIMITE_DIARIO = Number(process.env.LIMITE_DIARIO || 300);
const FUSO_HORARIO = process.env.TZ || 'America/Sao_Paulo';

const wa = new WhatsApp(path.join(DADOS, 'login-whatsapp'));
const cache = new Cache(path.join(DADOS, 'cache-checagem.json'));
const fila = new Fila({
  pasta: DADOS,
  wa,
  cache,
  intervaloMs: INTERVALO_SEGUNDOS * 1000,
  limiteDiario: LIMITE_DIARIO,
  fusoHorario: FUSO_HORARIO,
});

const app = express();
app.use(express.json());
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const rota = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

app.get('/api/saude', (req, res) => res.json({ ok: true }));

app.get('/api/status', rota(async (req, res) => {
  res.json({
    whatsapp: {
      estado: wa.estado,
      numero: wa.numero,
      erro: wa.erro,
      qr: wa.qr ? await QRCode.toDataURL(wa.qr, { margin: 1, width: 280 }) : null,
    },
    uso: { hoje: fila.usoHoje(), limite: LIMITE_DIARIO },
    intervaloSegundos: INTERVALO_SEGUNDOS,
    situacao: fila.situacao,
  });
}));

app.post('/api/whatsapp/conectar', rota(async (req, res) => {
  await wa.conectar();
  res.json({ estado: wa.estado });
}));

app.post('/api/whatsapp/sair', rota(async (req, res) => {
  await wa.sair();
  res.json({ estado: wa.estado });
}));

app.post('/api/checar', rota(async (req, res) => {
  const r = triar(req.body?.numero, { dddPadrao: req.body?.ddd || undefined });
  const resposta = { ...r, palpite: palpite(r.tipo), temWhatsApp: null };
  if (r.numero) resposta.temWhatsApp = await fila.consultar(r.numero);
  res.json(resposta);
}));

app.get('/api/planilhas', (req, res) => res.json(fila.listar()));

app.post('/api/planilhas', upload.single('arquivo'), rota(async (req, res) => {
  if (!req.file) throw new ErroUsuario('Nenhum arquivo enviado');
  const b = req.body || {};
  const job = await fila.criar({
    buffer: req.file.buffer,
    // o nome vem num campo separado porque o multer não decodifica acentos do nome do arquivo
    nome: b.nome || req.file.originalname,
    opcoes: {
      coluna: b.coluna?.trim() || undefined,
      aba: b.aba?.trim() || undefined,
      ddd: b.ddd?.trim() || undefined,
      soTriagem: b.soTriagem === 'true',
      ignorarFixos: b.ignorarFixos === 'true',
      apagarFixos: b.apagarFixos === 'true',
    },
  });
  res.status(201).json(job);
}));

app.get('/api/planilhas/:id/resultado', rota(async (req, res) => {
  const { buffer, nome } = await fila.resultado(req.params.id);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="resultado.xlsx"; filename*=UTF-8''${encodeURIComponent(nome)}`);
  res.send(Buffer.from(buffer));
}));

app.post('/api/planilhas/:id/pausar', (req, res) => res.json(fila.pausar(req.params.id)));
app.post('/api/planilhas/:id/continuar', (req, res) => res.json(fila.retomar(req.params.id)));
app.delete('/api/planilhas/:id', (req, res) => {
  fila.excluir(req.params.id);
  res.status(204).end();
});

app.use((err, req, res, next) => {
  const status = err instanceof ErroUsuario ? err.status : err.code === 'LIMIT_FILE_SIZE' ? 413 : 500;
  if (status === 500) console.error(err);
  res.status(status).json({ erro: err.code === 'LIMIT_FILE_SIZE' ? 'Arquivo maior que 20 MB' : err.message });
});

const servidor = app.listen(PORTA, () => {
  console.log(`Backend ouvindo na porta ${PORTA} (dados em ${DADOS})`);
  if (wa.temLogin()) wa.conectar().catch((e) => console.error('Falha ao reconectar o WhatsApp:', e.message));
  fila.rodar();
});

for (const sinal of ['SIGINT', 'SIGTERM']) {
  process.on(sinal, () => {
    wa.fechar();
    servidor.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
