# AMBTotal — Google Imagens x SKU BLING

Sincroniza imagens do Google Drive para produtos do Bling AMB Total.

## Como funciona

1. Você sobe uma subpasta no Drive com o nome do SKU (ex: `SKU123/`)
2. Coloca as imagens dentro com nomes numéricos (`1.jpg`, `2.jpg`, ..., `12.jpg`)
3. O serviço:
   - Torna as imagens públicas no Drive
   - Monta as URLs `https://lh3.googleusercontent.com/d/<id>`
   - Acha o produto no Bling pelo código do SKU
   - Atualiza as imagens do produto via API

## Stack

- Node.js + Express
- Google Drive API (Service Account)
- Bling API v3 (OAuth)
- Deploy: Render

## Variáveis de ambiente

| Variável | Descrição |
|---|---|
| `PORT` | Porta do servidor (Render preenche automático) |
| `DRIVE_FOLDER_ID` | ID da pasta-mãe no Drive |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | JSON da Service Account (texto colado inteiro) |
| `BLING_CLIENT_ID` | Client ID do app no Bling |
| `BLING_CLIENT_SECRET` | Client Secret do app no Bling |
| `BLING_REDIRECT_URI` | URL pública de callback (ex: `https://amb-imagens-auto.onrender.com/bling/callback`) |
| `BLING_ACCESS_TOKEN` | Token Bling (preenchido após primeiro OAuth) |
| `BLING_REFRESH_TOKEN` | Refresh token Bling (idem) |
| `RENDER_API_KEY` | API key do Render (pra atualizar tokens) |
| `RENDER_SERVICE_ID` | ID do serviço no Render |
| `TZ` | `America/Sao_Paulo` |

## Endpoints

- `GET /` — interface web
- `GET /api/status` — status do Drive e Bling
- `GET /api/pastas` — lista pastas do Drive + status no Bling
- `GET /auth/bling` — inicia OAuth Bling
- `GET /bling/callback` — callback do OAuth
