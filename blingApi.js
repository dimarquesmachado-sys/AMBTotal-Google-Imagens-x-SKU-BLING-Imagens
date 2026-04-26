const blingAuth = require('./blingAuth');

const BLING_API = 'https://api.bling.com.br/Api/v3';

async function buscarPorCodigo(codigo) {
  const url = `${BLING_API}/produtos?codigo=${encodeURIComponent(codigo)}&limite=10&pagina=1`;

  let token = await blingAuth.getToken();
  let resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` }
  });

  if (resp.status === 401) {
    // Token expirou — renova e tenta de novo
    await blingAuth.renovarToken();
    token = await blingAuth.getToken();
    resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  }

  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`Bling ${resp.status}: ${txt}`);
  }

  const data = await resp.json();
  return interpretar(data, codigo);
}

function interpretar(data, codigo) {
  const arr = data.data || [];
  const exato = arr.find(p => (p.codigo || '').toUpperCase() === codigo.toUpperCase());
  const escolhido = exato || arr[0];
  if (!escolhido) return { encontrado: false };

  return {
    encontrado: true,
    id: escolhido.id,
    codigo: escolhido.codigo,
    nome: escolhido.nome
  };
}

module.exports = { buscarPorCodigo };
