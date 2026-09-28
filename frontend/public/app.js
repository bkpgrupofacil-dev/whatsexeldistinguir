const $ = (id) => document.getElementById(id);

const NOMES_ESTADO = {
  desconectado: ['Desconectado', 'ruim'],
  conectando: ['Conectando…', 'espera'],
  aguardando_qr: ['Aguardando leitura do QR Code', 'espera'],
  conectado: ['Conectado', 'ok'],
  bloqueado: ['Conta bloqueada pelo WhatsApp', 'ruim'],
};
const NOMES_STATUS = {
  na_fila: 'Na fila',
  checando: 'Checando…',
  pausado: 'Pausado',
  concluido: 'Concluído',
};

async function api(caminho, opcoes = {}) {
  const res = await fetch(`/api${caminho}`, opcoes);
  if (res.status === 204) return null;
  const dados = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(dados.erro || `Erro ${res.status}`);
  return dados;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// ---------- WhatsApp ----------
async function atualizarStatus() {
  try {
    const s = await api('/status');
    const wa = s.whatsapp;
    const [nome, classe] = NOMES_ESTADO[wa.estado] || [wa.estado, ''];
    $('wa-estado').textContent = nome;
    $('wa-estado').className = `selo ${classe}`;
    $('wa-numero').textContent = wa.numero ? `+${wa.numero}` : '';
    $('wa-erro').hidden = !wa.erro;
    $('wa-erro').textContent = wa.erro || '';
    $('wa-qr').hidden = !wa.qr;
    if (wa.qr && $('wa-qr-img').src !== wa.qr) $('wa-qr-img').src = wa.qr;
    $('bt-conectar').hidden = wa.estado === 'conectado';
    $('bt-conectar').disabled = wa.estado === 'conectando' || wa.estado === 'aguardando_qr';
    $('bt-sair').hidden = wa.estado === 'desconectado';
    $('uso').textContent = `Consultas hoje: ${s.uso.hoje} de ${s.uso.limite} · intervalo de ~${s.intervaloSegundos}s entre consultas`;
    $('situacao').textContent = s.situacao;
  } catch (e) {
    $('wa-estado').textContent = 'Sem resposta do servidor';
    $('wa-estado').className = 'selo ruim';
  }
}

$('bt-conectar').onclick = async () => {
  $('bt-conectar').disabled = true;
  await api('/whatsapp/conectar', { method: 'POST' }).catch((e) => alert(e.message));
  atualizarStatus();
};
$('bt-sair').onclick = async () => {
  if (!confirm('Desconectar este WhatsApp? Para usar de novo será preciso ler outro QR Code.')) return;
  await api('/whatsapp/sair', { method: 'POST' }).catch((e) => alert(e.message));
  atualizarStatus();
};

// ---------- Um número ----------
$('form-numero').onsubmit = async (ev) => {
  ev.preventDefault();
  const div = $('resultado-numero');
  const botao = ev.target.querySelector('button');
  botao.disabled = true;
  div.innerHTML = '<p class="discreto">Consultando…</p>';
  try {
    const r = await api('/checar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ numero: $('numero').value }),
    });
    const classe = r.temWhatsApp === 'Sim' ? 'sim' : r.temWhatsApp === 'Não' ? 'nao' : '';
    const titulo = r.temWhatsApp === 'Sim' ? '✅ Tem WhatsApp'
      : r.temWhatsApp === 'Não' ? '❌ Não tem WhatsApp'
      : '⚠️ Não dá para checar';
    div.innerHTML = `<div class="resposta ${classe}"><b>${titulo}</b><br>
      ${esc(r.formatado || r.numero)} · ${esc(r.tipo)} · ${esc(r.motivo)}</div>`;
  } catch (e) {
    div.innerHTML = `<p class="erro">${esc(e.message)}</p>`;
  }
  botao.disabled = false;
};

// ---------- Envio de planilha ----------
$('arquivo').onchange = () => {
  const f = $('arquivo').files[0];
  $('arquivo-nome').textContent = f ? f.name : 'Escolher arquivo .xlsx ou .csv';
};

$('form-planilha').onsubmit = async (ev) => {
  ev.preventDefault();
  const form = ev.target;
  const arquivo = $('arquivo').files[0];
  if (!arquivo) return;
  const dados = new FormData();
  dados.append('arquivo', arquivo);
  dados.append('nome', arquivo.name);
  for (const campo of ['coluna', 'aba', 'ddd']) dados.append(campo, form[campo].value);
  dados.append('soTriagem', form.soTriagem.checked);

  $('bt-enviar').disabled = true;
  $('envio-erro').hidden = true;
  try {
    await api('/planilhas', { method: 'POST', body: dados });
    form.reset();
    $('arquivo-nome').textContent = 'Escolher arquivo .xlsx ou .csv';
    atualizarLista();
  } catch (e) {
    $('envio-erro').textContent = e.message;
    $('envio-erro').hidden = false;
  }
  $('bt-enviar').disabled = false;
};

// ---------- Lista ----------
async function atualizarLista() {
  let jobs;
  try {
    jobs = await api('/planilhas');
  } catch {
    return;
  }
  if (!jobs.length) {
    $('lista').innerHTML = '<p class="discreto">Nenhuma planilha enviada ainda.</p>';
    return;
  }
  $('lista').innerHTML = jobs.map(renderJob).join('');
}

function renderJob(j) {
  const p = j.progresso;
  const pct = p.aChecar ? Math.round((p.checados / p.aChecar) * 100) : 100;
  const soTriagem = j.opcoes.soTriagem;
  const tipos = Object.entries(j.porTipo).map(([t, n]) => `${esc(t)}: ${n}`).join(' · ');
  const quando = new Date(j.criadoEm).toLocaleString('pt-BR');
  const podePausar = j.status === 'na_fila' || j.status === 'checando';
  const podeContinuar = j.status === 'pausado' || (soTriagem && p.aChecar > 0);
  return `<div class="job">
    <div class="job-topo">
      <span class="job-nome">${esc(j.nome)}</span>
      <span class="selo ${j.status === 'concluido' ? 'ok' : j.status === 'pausado' ? 'ruim' : 'espera'}">${soTriagem ? 'Só triagem' : NOMES_STATUS[j.status]}</span>
    </div>
    <div class="discreto">${quando} · coluna "${esc(j.coluna)}" · ${j.total} linhas</div>
    ${soTriagem ? '' : `<div class="barra"><div style="width:${pct}%"></div></div>`}
    <div class="numeros">
      ${soTriagem ? '' : `<span>Checados: ${p.checados} de ${p.aChecar} (${pct}%)</span>
      <span><b class="sim">${p.sim}</b> com WhatsApp</span>
      <span><b class="nao">${p.nao}</b> sem WhatsApp</span>`}
    </div>
    <div class="tipos">${tipos}</div>
    ${j.erro ? `<p class="erro">${esc(j.erro)}</p>` : ''}
    <div class="botoes">
      <a class="botao pequeno" href="/api/planilhas/${j.id}/resultado">Baixar resultado</a>
      ${podePausar ? `<button class="pequeno secundario" onclick="acao('${j.id}','pausar')">Pausar</button>` : ''}
      ${podeContinuar ? `<button class="pequeno secundario" onclick="acao('${j.id}','continuar')">${soTriagem ? 'Checar no WhatsApp' : 'Continuar'}</button>` : ''}
      <button class="pequeno perigo" onclick="excluir('${j.id}')">Excluir</button>
    </div>
  </div>`;
}

async function acao(id, qual) {
  await api(`/planilhas/${id}/${qual}`, { method: 'POST' }).catch((e) => alert(e.message));
  atualizarLista();
}

async function excluir(id) {
  if (!confirm('Excluir esta planilha e o resultado?')) return;
  await api(`/planilhas/${id}`, { method: 'DELETE' }).catch((e) => alert(e.message));
  atualizarLista();
}

atualizarStatus();
atualizarLista();
setInterval(atualizarStatus, 2000);
setInterval(atualizarLista, 3000);
