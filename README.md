# whatsexeldistinguir

Lê uma planilha (Excel `.xlsx` ou `.csv`) com telefones e separa quem tem WhatsApp de quem não tem.

Faz duas coisas:

1. **Triagem pelo formato** (sem internet, sem risco): diz se o número é celular, fixo, sem DDD, inválido, de serviço (0800) ou de outro país.
2. **Checagem real**: conecta no seu WhatsApp (QR Code, como o WhatsApp Web) e pergunta, número por número, se ele está cadastrado.

> ⚠️ **Atenção:** a checagem real usa uma biblioteca **não oficial** (Baileys). Isso vai contra os termos de uso do WhatsApp e **o número conectado pode ser banido**, principalmente se você checar muitos números de uma vez. Use um chip secundário, não o seu número principal.

## Instalação

Precisa do [Node.js](https://nodejs.org) 20 ou mais novo.

```bash
npm install
```

## Como usar

Só a triagem (rápido, sem conectar no WhatsApp):

```bash
node src/index.js contatos.xlsx --so-triagem
```

Triagem + checagem real:

```bash
node src/index.js contatos.xlsx
```

Na primeira vez aparece um QR Code no terminal. No celular: **WhatsApp > Aparelhos conectados > Conectar um aparelho** e leia o código. O login fica salvo na pasta `.login-whatsapp/`.

O resultado sai em `contatos-resultado.xlsx`, com a planilha original e 5 colunas novas:

| Coluna | O que é |
|---|---|
| Número normalizado | Ex.: `5511987654321` |
| Tipo | Celular, Fixo, Sem DDD, Inválido, Serviço, Internacional |
| Observação | Motivo (ex.: "DDD 20 não existe", "Celular antigo, 9 acrescentado") |
| WhatsApp pelo formato | Palpite: Provável / Improvável / Não |
| Tem WhatsApp? (checado) | **Sim** (verde) / **Não** (vermelho), resposta do próprio WhatsApp |

### Opções

| Opção | Para quê |
|---|---|
| `--coluna Telefone` | Nome ou letra (ex.: `C`) da coluna dos telefones. Sem isso, o programa procura sozinho |
| `--aba "Plan1"` | Qual aba ler (padrão: a primeira) |
| `--ddd 11` | DDD para números que vieram sem DDD |
| `--intervalo 5` | Segundos entre cada consulta (padrão 5, com variação aleatória) |
| `--limite 200` | Máximo de consultas por execução (padrão 200) |
| `--saida arquivo.xlsx` | Nome do arquivo de resultado |

### Listas grandes

As respostas ficam guardadas em `cache-checagem.json`. Se a lista tiver mais números que o `--limite`, rode o mesmo comando de novo mais tarde: ele continua de onde parou e não consulta de novo o que já foi checado. Números repetidos são consultados uma vez só.

Para diminuir o risco de banimento: mantenha o intervalo alto (5 s ou mais), não passe de algumas centenas por dia e use um número que já tenha algum tempo de uso.

## Testes

```bash
npm test
```
