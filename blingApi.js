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
    await blingAuth.renovarToken();
    token = await blingAuth.getToken();
    opts.headers.Authorization = `Bearer ${token}`;
    resp = await fetch(`${BLING_API}${path}`, opts);
  }

  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`Bling ${method} ${path} ${resp.status}: ${txt}`);
  }

  const txt = await resp.text();
  if (!txt) return null;
  try { return JSON.parse(txt); } catch (e) { return txt; }
}

// ------------------------------------------------------------
// Busca produto pelo codigo (SKU) via listagem
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
// Busca produto completo pelo ID
// ------------------------------------------------------------
async function buscarProdutoCompleto(idProduto) {
  const data = await chamarBling('GET', `/produtos/${idProduto}`);
  return data && data.data ? data.data : null;
}

// ------------------------------------------------------------
// Atualiza imagens externas de um produto (SUBSTITUIR)
// ------------------------------------------------------------
async function atualizarImagens(idProduto, urls) {
  console.log(`[Bling] === atualizarImagens id=${idProduto}, ${urls.length} URLs ===`);

  // 1) Busca produto completo
  const produto = await buscarProdutoCompleto(idProduto);
  if (!produto) throw new Error(`Produto ${idProduto} nao encontrado no Bling`);

  const externasAntes = (produto.imagens && produto.imagens.externas) || [];
  const internasAntes = (produto.imagens && produto.imagens.internas) || [];
  console.log(`[Bling] Produto: id=${produto.id}, nome="${produto.nome}", codigo="${produto.codigo}"`);
  console.log(`[Bling] Imagens ANTES: externas=${externasAntes.length}, internas=${internasAntes.length}`);
  console.log(`[Bling] Campos do produto: ${Object.keys(produto).join(', ')}`);

  if (produto.imagens) {
    console.log(`[Bling] Estrutura imagens.externas exemplo:`, JSON.stringify((produto.imagens.externas || [])[0] || null));
  }

  // 2) Monta novo body com imagens substituidas
  const externasNovas = (urls || []).map(link => ({ link }));
  const novoBody = {
    ...produto,
    imagens: {
      externas: externasNovas,
      internas: internasAntes  // mantem internas intactas
    }
  };

  // 3) Remove campos que costumam dar problema no PUT
  delete novoBody.id;
  delete novoBody.midia;

  console.log(`[Bling] PUT body keys: ${Object.keys(novoBody).join(', ')}`);
  console.log(`[Bling] PUT body.imagens.externas (primeiras 3):`, JSON.stringify(novoBody.imagens.externas.slice(0, 3)));

  // 4) Faz PUT
  const resultadoPut = await chamarBling('PUT', `/produtos/${idProduto}`, novoBody);
  console.log(`[Bling] PUT retorno:`, resultadoPut === null ? 'null (corpo vazio)' : JSON.stringify(resultadoPut).slice(0, 300));

  // 5) VERIFICA pos-PUT que realmente atualizou (faz GET de novo)
  const verif = await buscarProdutoCompleto(idProduto);
  const externasDepois = (verif && verif.imagens && verif.imagens.externas) || [];
  console.log(`[Bling] Imagens DEPOIS: externas=${externasDepois.length}`);
  if (externasDepois.length > 0) {
    console.log(`[Bling] Primeira imagem externa apos PUT:`, JSON.stringify(externasDepois[0]));
  }

  if (externasDepois.length !== urls.length) {
    // PUT retornou OK mas Bling nao atualizou - bug silencioso
    throw new Error(
      `Bling aceitou o PUT mas nao atualizou as imagens. ` +
      `Esperado: ${urls.length} externas, atual: ${externasDepois.length}. ` +
      `Pode ser config do Bling (Imagens Internas vs Externas) ou problema no body.`
    );
  }

  console.log(`[Bling] === SUCESSO id=${idProduto}: ${externasDepois.length} externas confirmadas ===`);

  return {
    ok: true,
    qtdExternas: externasNovas.length,
    qtdInternasMantidas: internasAntes.length,
    qtdExternasConfirmadas: externasDepois.length,
    retornoBling: resultadoPut
  };
}

module.exports = {
  buscarPorCodigo,
  buscarProdutoCompleto,
  atualizarImagens
};
