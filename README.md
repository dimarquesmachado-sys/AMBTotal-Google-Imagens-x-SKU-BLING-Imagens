# AMB Imagens Auto

Aplicação web que sincroniza imagens do **Google Drive** com produtos no **Bling** (ERP), incluindo suporte a produtos simples, kits e produtos com variações.

🌐 **Produção:** https://ambtotal-google-imagens-x-sku-bling.onrender.com

---

## 📋 Sumário

- [Como funciona](#-como-funciona)
- [Estrutura de pastas no Drive](#-estrutura-de-pastas-no-drive)
- [Como usar a aplicação (passo a passo)](#-como-usar-a-aplicação-passo-a-passo)
- [Recursos](#-recursos)
- [Bugs do Bling descobertos e contornados](#-bugs-do-bling-descobertos-e-contornados)
- [Stack técnica](#-stack-técnica)
- [Arquivos do projeto](#-arquivos-do-projeto)
- [Configuração e deploy](#-configuração-e-deploy)
- [Variáveis de ambiente](#-variáveis-de-ambiente)
- [Como renovar token do Bling manualmente](#-como-renovar-token-do-bling-manualmente)
- [Troubleshooting](#-troubleshooting)

---

## 🎯 Como funciona

A aplicação automatiza o processo de subir imagens para produtos no Bling:

1. **Você organiza** as imagens em pastas no Google Drive (uma pasta por SKU)
2. **A aplicação lista** essas pastas e mostra quais batem com produtos no Bling
3. **Com um clique**, torna as imagens públicas no Drive e atualiza o produto no Bling com as URLs
4. **Suporta** produtos simples, kits (composição) e produtos com variações

### Fluxo completo

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  Google Drive    │     │   Aplicação      │     │      Bling       │
│  (pastas SKU)    │ ──> │  (Render)        │ ──> │   (produtos)     │
│                  │     │                  │     │                  │
│  E14-5W/         │     │  1. Lista pastas │     │  Atualiza        │
│  ├── 1.jpg       │     │  2. Torna público│     │  midia.imagens.  │
│  ├── 2.jpg       │     │  3. Gera URL LH3 │     │  externa[]       │
│  └── ...         │     │  4. PATCH Bling  │     │                  │
└──────────────────┘     └──────────────────┘     └──────────────────┘
```

---

## 📁 Estrutura de pastas no Drive

### 🔹 Produto simples

Apenas 1 pasta com até 12 imagens:

```
E14-5W-3000K-BIV/        ← nome = código exato do SKU no Bling
  ├── 1.jpg
  ├── 2.jpg
  ├── ...
  └── 12.jpg              ← máximo 12 imagens (limite do Bling)
```

### 🔹 Produto com variações (formato V no Bling)

Pasta-pai + subpastas com nome exato de cada variação:

```
TESTE-VAR/                    ← código do produto-pai
  ├── 1.jpg                   ← imagens da raiz (vão pro pai E pras variações sem subpasta)
  ├── 2.jpg
  ├── ...
  ├── TESTE-VAR-AZUL/         ← código exato da variação no Bling
  │   ├── 1.jpg
  │   └── ...
  └── TESTE-VAR-ROSA/
      ├── 1.jpg
      └── ...
```

**Lógica do envio:**

| Cenário | Comportamento |
|---|---|
| Pasta com imagens, **sem** subpastas | Replica imagens em pai + todas variações |
| Pasta com imagens **+** subpastas | Pai recebe imagens da raiz; cada variação recebe da sua subpasta |
| Variação **sem** subpasta correspondente | Replica as imagens do pai |
| Variação **com** subpasta | Usa apenas as imagens da subpasta |

### 🔹 Produto kit/composição (formato E no Bling)

Funciona igual produto simples — mesma estrutura de pasta, a aplicação detecta automaticamente que é kit e preserva os componentes.

```
2xE14-5W-3000K-BIV/      ← kit com 2 unidades do componente
  ├── 1.jpg
  └── ...
```

### ⚠️ Regras importantes

- **Nome da pasta = código exato do SKU no Bling** (case-insensitive)
- **Máximo 12 imagens** por produto (limite do Bling)
- Se passar de 12, **só as 12 primeiras** (ordenadas por nome) são enviadas
- A aplicação mostra ⚠️ laranja na coluna "Imgs" quando excede
- Imagens são ordenadas por **número no nome** primeiro (`1.jpg`, `2.jpg`...), depois alfabeticamente

---

## 🚀 Como usar a aplicação (passo a passo)

### 1. Acesse a aplicação

https://ambtotal-google-imagens-x-sku-bling.onrender.com

### 2. Verifique o status

No topo deve aparecer:
- **Drive: ✅ OK**
- **Bling: ✅ autorizado**

Se Bling estiver "não autorizado", clica no botão para autorizar (login OAuth).

### 3. Recarregar pastas do Drive

Clica em **"🔄 Recarregar pastas do Drive"** se você adicionou pastas novas. Por padrão, mostra as **mais novas primeiro**.

### 4. Para cada SKU, você tem 4 botões:

| Botão | O que faz |
|---|---|
| 🔵 **Verificar** | Confirma se o SKU existe no Bling |
| 🟢 **Processar** | Lista as imagens do Drive, torna públicas, gera URLs LH3 |
| 🟣 **Enviar p/ Bling** | Envia as URLs para o Bling (precisa Processar antes) |
| 🟠 **⚡ Enviar direto** | Faz tudo de uma vez (Processar + Enviar) |

### 5. Para enviar vários de uma vez

1. Marque os checkboxes dos SKUs desejados
2. Use os botões "Selecionados (N):" no topo da lista

### 6. Filtros e ordenação

- **🔎 Buscar SKU**: filtra por nome
- **Ordenação**: Mais novas / Mais antigas / A-Z / Modificadas

### 7. Status visual de cada SKU

#### Coluna "Imgs"
- `12` → tem 12 imagens na pasta
- `⚠️ 15` (laranja) → excede limite do Bling, só vão as 12 primeiras
- `12 + 🎨3` (roxo) → 12 imagens na raiz + 3 subpastas de variação

#### Coluna "URLs LH3" (depois de Processar)
- `✅ 12 [Ver]` → 12 URLs prontas
- `✅ 12 [Ver] 🎨 3 var (15 imgs)` → produto com 3 variações detectadas

#### Coluna "Status envio" (depois de Enviar)
- `✅ 12 imgs 26/04, 14:30` → enviado com sucesso
- `✅ 12 imgs 26/04, 14:30 🎨 3/3 var` → pai + 3 variações enviadas
- `❌ erro...` → falha (passa o mouse pra ver detalhes)

---

## ✨ Recursos

### Funcionalidades principais

- ✅ Listagem de pastas do Drive
- ✅ Verificação de SKU no Bling (busca exata por código)
- ✅ Geração de URLs públicas LH3 (`https://lh3.googleusercontent.com/d/{id}`)
- ✅ Atualização de imagens no Bling via PATCH
- ✅ Suporte a **produtos simples** (formato S)
- ✅ Suporte a **produtos kit/composição** (formato E)
- ✅ Suporte a **produtos com variação** (formato V)
- ✅ Limite automático de 12 imagens (limite do Bling)
- ✅ Substituição **real** de imagens (não merge)
- ✅ Auto-renovação de token Bling (a cada 1h)
- ✅ Retry automático em erros 5xx e 429 (rate limit)
- ✅ Tratamento de rate limit do Bling (3 req/s)

### Recursos da UI

- 🎨 Logo AMBTotal embedada (não depende de hospedagem externa)
- 🔍 Busca por SKU em tempo real
- 📅 Ordenação por data de criação/modificação
- ☑️ Seleção múltipla com ações em lote
- 🎨 Indicação visual de variações detectadas
- ⚠️ Aviso visual quando excede 12 imagens
- 🪟 Modal "Ver" mostra todas as URLs com nome do arquivo

---

## 🐛 Bugs do Bling descobertos e contornados

A API v3 do Bling tem **5 inconsistências não-documentadas** que essa aplicação contorna:

### 1. Campo `imagens.externas` (plural) é ignorado em PUT/PATCH

**O bug:** Documentação fala em `externas` (plural). API aceita o campo mas **silenciosamente ignora**.

**Workaround:** Usar `externa` (singular) no body do PATCH.

```js
// ❌ NÃO funciona (ignorado silenciosamente)
{ midia: { imagens: { externas: [...] } } }

// ✅ FUNCIONA
{ midia: { imagens: { externa: [...] } } }
```

### 2. `externa: []` não limpa imagens (silenciosamente ignorado)

**O bug:** Mandar array vazio não apaga as imagens existentes. O Bling faz **merge por posição** ao invés de substituição.

**Workaround:** Usar **padding com URLs vazias** até atingir o tamanho atual. O Bling sobrescreve por posição e descarta as inválidas.

```js
// Bling tem 12 imagens, queremos só 6
// Mandamos array de 12 itens: 6 reais + 6 com link vazio
const externas = [
  { link: 'url1' }, { link: 'url2' }, ..., { link: 'url6' },
  { link: '' }, { link: '' }, ..., { link: '' }  // padding
];
```

### 3. Componentes do kit usam nomes diferentes em GET vs PUT

**O bug:** GET retorna `componentes[].produto.id` mas PUT/PATCH exige `componentes[].componente.id`.

**Workaround:** Mapear na hora de enviar.

```js
componentes: produto.estrutura.componentes.map(c => ({
  componente: { id: c.produto.id || c.componente.id },  // mapeamento
  quantidade: c.quantidade
}))
```

### 4. `lancamentoEstoque` vazio quebra PATCH em kits

**O bug:** Se `lancamentoEstoque` vem vazio do GET, PATCH dá erro 400.

**Workaround:** Default para `'P'` se vazio.

```js
lancamentoEstoque: produto.estrutura.lancamentoEstoque || 'P'
```

### 5. Código da variação vem vazio no JSON do produto-pai

**O bug:** Quando você busca o produto-pai, as variações vêm com `codigo: ""`. Mas se você buscar a variação direto pelo código, retorna o código preenchido.

**Workaround:** Pra cada variação no array, fazer chamada extra `GET /produtos/{idVariacao}` para obter o código.

---

## 🛠️ Stack técnica

- **Backend:** Node.js + Express
- **Frontend:** HTML + JavaScript vanilla + CSS (sem framework)
- **APIs externas:**
  - Google Drive API v3 (Service Account)
  - Bling API v3 (OAuth2)
- **Hospedagem:** Render (plano Starter)
- **Persistência:** disco persistente em `/data` (tokens Bling)

---

## 📂 Arquivos do projeto

```
amb-imagens-auto/
├── package.json          # dependências do Node
├── server.js             # Express + endpoints REST
├── blingAuth.js          # OAuth Bling + auto-renovação de token
├── blingApi.js           # Funções de chamada ao Bling
├── driveApi.js           # Funções de chamada ao Google Drive
├── public/
│   └── index.html        # Frontend completo (HTML + CSS + JS inline)
└── README.md             # Este arquivo
```

### Endpoints da API

| Método | Endpoint | O que faz |
|---|---|---|
| GET | `/api/status` | Status de Drive e Bling |
| GET | `/api/pastas` | Lista pastas do Drive |
| POST | `/api/verificar-bling` | Verifica se SKUs existem no Bling |
| POST | `/api/processar` | Processa imagens (torna públicas + gera URLs) |
| POST | `/api/enviar-bling` | Envia URLs já processadas para o Bling |
| POST | `/api/processar-e-enviar` | Faz tudo de uma vez |
| GET | `/api/debug-produto/:codigo` | Retorna JSON cru de um produto (debug) |
| GET | `/api/sondar/:codigo` | Sonda rotas alternativas (debug) |
| GET | `/auth/bling` | Inicia OAuth Bling |
| GET | `/bling/callback` | Callback do OAuth Bling |

---

## 🚢 Configuração e deploy

### GitHub
**Repositório:** `dimarquesmachado-sys/AMBTotal-Google-Imagens-x-SKU-BLING-Imagens`

### Render
- **Service:** `srv-d7mn0el7vvec738mvqk0`
- **Plano:** Starter (com disco persistente em `/data`)
- **Auto-deploy:** Ativado (commits no `main` deployam automaticamente)
- **URL:** https://ambtotal-google-imagens-x-sku-bling.onrender.com

### Como atualizar a aplicação

1. **Edita** o arquivo desejado no GitHub (lápis ✏️)
2. **Cola** o novo conteúdo
3. **Commit** com mensagem descritiva
4. Render detecta o push e faz **deploy automático** (~1-2 minutos)
5. Aguarda **"Live 🎉"** verde

---

## 🔐 Variáveis de ambiente

Configuradas no Render → Settings → Environment:

### Google Drive
- `GOOGLE_SERVICE_ACCOUNT_KEY` — JSON da service account (string)
- `DRIVE_FOLDER_ID` — ID da pasta-mãe que contém todas as pastas SKU

### Bling OAuth
- `BLING_CLIENT_ID` — Client ID do app no Bling
- `BLING_CLIENT_SECRET` — Client Secret do app no Bling
- `BLING_REDIRECT_URI` — URI de callback (ex: `https://...onrender.com/bling/callback`)
- `BLING_ACCESS_TOKEN` — Token de acesso (renovado automaticamente)
- `BLING_REFRESH_TOKEN` — Token de renovação

### Render API (para auto-renovar tokens)
- `RENDER_API_KEY` — API key do Render
- `RENDER_SERVICE_ID` — ID do service (`srv-d7mn0el7vvec738mvqk0`)

---

## 🔄 Como renovar token do Bling manualmente

Se a auto-renovação falhar (raro), você pode reautorizar manualmente:

1. Acessa: https://ambtotal-google-imagens-x-sku-bling.onrender.com/auth/bling
2. Faz login na sua conta Bling
3. Autoriza o app
4. Token é atualizado automaticamente nas variáveis de ambiente do Render

---

## 🩺 Troubleshooting

### "Bling: não autorizado" no topo da página

Token expirou e auto-renovação falhou. Solução:
1. Acessa `/auth/bling` na URL da aplicação
2. Reautoriza

### SKU "não encontrado" mesmo existindo no Bling

- Verifica se o nome da pasta no Drive **bate exatamente** com o código no Bling
- A busca é case-insensitive, mas precisa ser idêntica em caracteres
- Espaços extras no nome da pasta atrapalham

### Imagens no Bling continuam as antigas

- Limpa cache do navegador da página do Bling
- Imagens externas demoram alguns segundos pra processar do lado do Bling
- Verifica logs no Render se aparece `[Bling] OK id=X: N externas confirmadas`

### Variação não recebeu imagens

- Verifica se a subpasta no Drive tem o **código exato** da variação
- Confirma com `GET /api/debug-produto/CODIGO-VARIACAO` se o código está cadastrado no Bling
- Logs mostram `[Variacoes] Erro buscando codigo da variacao id=X`

### Erro 429 (rate limit)

A aplicação retenta automaticamente. Bling permite 3 req/s. Se aparecer demais, o produto tem muitas variações.

### Aplicação retorna erro 503 do Bling

Bling está fora do ar. Aguarda alguns minutos e tenta de novo.

---

## 📝 Histórico de versões

### v1.0 (Abril 2026)
- Sincronização Drive → Bling para produtos simples
- OAuth Bling com auto-renovação
- UI completa com busca, ordenação e ações em lote

### v1.1
- Suporte a produtos kit (formato E)
- Descoberta dos bugs `externa` (singular) e `externas` (plural)
- Padding com URLs vazias para substituição real

### v1.2
- Logo AMBTotal embedada
- Filtro de ordenação por data (default: mais novas)
- Limite de 12 imagens com aviso visual

### v1.3 (atual)
- **Suporte a produtos com variação (formato V)**
- Lógica híbrida: replica do pai ou usa subpasta específica
- Indicação visual de variações na UI
- Logs enxutos em produção

---

## 📞 Contato e suporte

Aplicação desenvolvida para AMBTotal — Diego Machado
