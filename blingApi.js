const blingAuth = require('./blingAuth');

const BLING_API = 'https://api.bling.com.br/Api/v3';

// ------------------------------------------------------------
// Helper: faz request ao Bling com auto-renovacao de token
// ------------------------------------------------------------
async function chamarBling(method, path, body) {
  let token = await blingAuth.getToken();
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  };
  if (body !== undefined && body !== null) {
    opts.body = JSON.stringify(body);
  }

  let resp = await fetch(`${BLING_API}${path}`, opts);

  if (resp.status === 401) {
    // Token expirou — renova e tenta de novo
    await blingAuth.renovarToken();
    token = await blingAuth.getToken();
    opts.headers.Authorization = `Bearer ${token}`;
    resp = await fetch(`${BLING_API}${path}`, opts);
  }

  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`Bling ${method} ${path} ${resp.status}: ${txt}`);
  }

  // Alguns endpoints PUT do Bling devolvem corpo vazio
  const txt = await resp.text();
  if (!txt) return null;
  try { return JSON.parse(txt); } catch (e) { return txt; }
}

// ------------------------------------------------------------
// Busca produto pelo codigo (SKU) — usa endpoint de listagem
// Retorna info resumida (id, codigo, nome) — sem imagens
// ------------------------------------------------------------
async function buscarPorCodigo(codigo) {
  const path = `/produtos?codigo=${encodeURIComponent(codigo)}&limite=10&pagina=1`;
  const data = await chamarBling('GET', path);
  return interpretarBusca(data, codigo);
}

function interpretarBusca(data, codigo) {
  const arr = (data && data.data) || [];
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

// ------------------------------------------------------------
// Busca produto completo (todos os campos) pelo ID
// Necessario antes do PUT pra preservar campos existentes
// ------------------------------------------------------------
async function buscarProdutoCompleto(idProduto) {
  const data = await chamarBling('GET', `/produtos/${idProduto}`);
  return data && data.data ? data.data : null;
}

// ------------------------------------------------------------
// Atualiza imagens externas de um produto (SUBSTITUIR)
// idProduto: ID numerico do produto no Bling
// urls: array de strings com as URLs LH3
//
// Estrategia: GET completo -> substitui imagens.externas -> PUT
// Mantem imagens.internas intactas (mais seguro)
// ------------------------------------------------------------
async function atualizarImagens(idProduto, urls) {
  // 1) Busca produto completo
  const produto = await buscarProdutoCompleto(idProduto);
  if (!produto) throw new Error(`Produto ${idProduto} nao encontrado no Bling`);

  // 2) Monta novo objeto de imagens
  const externasNovas = (urls || []).map(link => ({ link }));
  const internasAntigas = (produto.imagens && produto.imagens.internas) || [];

  const novoBody = {
    ...produto,
    imagens: {
      externas: externasNovas,
      internas: internasAntigas
    }
  };

  // 3) Remove campos que podem causar problema no PUT
  delete novoBody.id; // o ID vai na URL
  // Bling alguns campos retornados que nao aceita no PUT — removemos os mais comuns
  delete novoBody.midia;

  // 4) PUT
  const resultado = await chamarBling('PUT', `/produtos/${idProduto}`, novoBody);
  return {
    ok: true,
    qtdExternas: externasNovas.length,
    qtdInternasMantidas: internasAntigas.length,
    retornoBling: resultado
  };
}

module.exports = {
  buscarPorCodigo,
  buscarProdutoCompleto,
  atualizarImagens
};
