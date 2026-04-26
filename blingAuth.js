// Gerencia OAuth Bling — tokens em memória + persiste no Render via API
let accessTokenAtual = process.env.BLING_ACCESS_TOKEN || null;
let refreshTokenAtual = process.env.BLING_REFRESH_TOKEN || null;
let expiraEm = null; // timestamp ms

const BLING_API = 'https://api.bling.com.br/Api/v3';

function gerarUrlAutorizacao() {
  const clientId = process.env.BLING_CLIENT_ID;
  const redirect = process.env.BLING_REDIRECT_URI;
  if (!clientId || !redirect) {
    throw new Error('BLING_CLIENT_ID ou BLING_REDIRECT_URI nao configurados');
  }
  const state = Math.random().toString(36).slice(2);
  return `${BLING_API}/oauth/authorize?response_type=code&client_id=${clientId}&state=${state}&redirect_uri=${encodeURIComponent(redirect)}`;
}

async function trocarCodigoPorToken(code) {
  const clientId = process.env.BLING_CLIENT_ID;
  const clientSecret = process.env.BLING_CLIENT_SECRET;
  const redirect = process.env.BLING_REDIRECT_URI;

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirect
  });

  const resp = await fetch(`${BLING_API}/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': '1.0',
      'Authorization': `Basic ${auth}`
    },
    body: body.toString()
  });

  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`Erro ao obter token: ${resp.status} ${txt}`);
  }

  const data = await resp.json();
  accessTokenAtual = data.access_token;
  refreshTokenAtual = data.refresh_token;
  expiraEm = Date.now() + (data.expires_in * 1000) - 60000;

  await persistirTokensNoRender();
  return data;
}

async function renovarToken() {
  if (!refreshTokenAtual) {
    throw new Error('Sem refresh token — autorize o Bling primeiro');
  }

  const clientId = process.env.BLING_CLIENT_ID;
  const clientSecret = process.env.BLING_CLIENT_SECRET;
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshTokenAtual
  });

  const resp = await fetch(`${BLING_API}/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': '1.0',
      'Authorization': `Basic ${auth}`
    },
    body: body.toString()
  });

  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`Erro ao renovar token: ${resp.status} ${txt}`);
  }

  const data = await resp.json();
  accessTokenAtual = data.access_token;
  refreshTokenAtual = data.refresh_token;
  expiraEm = Date.now() + (data.expires_in * 1000) - 60000;

  await persistirTokensNoRender();
  return data;
}

async function getToken() {
  if (!accessTokenAtual) {
    throw new Error('Sem access token — autorize o Bling primeiro');
  }
  if (expiraEm && Date.now() > expiraEm) {
    await renovarToken();
  }
  return accessTokenAtual;
}

function estaAutorizado() {
  return !!accessTokenAtual;
}

async function persistirTokensNoRender() {
  const apiKey = process.env.RENDER_API_KEY;
  const serviceId = process.env.RENDER_SERVICE_ID;
  if (!apiKey || !serviceId) {
    console.log('Render API nao configurada — tokens so em memoria');
    return;
  }

  try {
    const r = await fetch(`https://api.render.com/v1/services/${serviceId}/env-vars`, {
      headers: { Authorization: `Bearer ${apiKey}` }
    });
    if (!r.ok) {
      console.error('Erro ao buscar env vars do Render:', r.status);
      return;
    }
    const env = await r.json();

    const novas = (env || []).map(e => ({
      key: e.envVar.key,
      value: e.envVar.value
    }));

    const setKV = (key, value) => {
      const idx = novas.findIndex(x => x.key === key);
      if (idx >= 0) novas[idx].value = value;
      else novas.push({ key, value });
    };

    setKV('BLING_ACCESS_TOKEN', accessTokenAtual);
    setKV('BLING_REFRESH_TOKEN', refreshTokenAtual);

    const upd = await fetch(`https://api.render.com/v1/services/${serviceId}/env-vars`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(novas)
    });
    if (!upd.ok) {
      console.error('Erro ao atualizar env vars do Render:', upd.status);
    } else {
      console.log('Tokens persistidos no Render com sucesso');
    }
  } catch (e) {
    console.error('Erro ao persistir tokens no Render:', e.message);
  }
}

module.exports = {
  gerarUrlAutorizacao,
  trocarCodigoPorToken,
  renovarToken,
  getToken,
  estaAutorizado
};
