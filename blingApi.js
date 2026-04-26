const blingAuth = require('./blingAuth');

const BLING_API = 'https://api.bling.com.br/Api/v3';
const MAX_TENTATIVAS_5XX = 3;

// ------------------------------------------------------------
// Helper: faz request ao Bling com auto-renovacao de token
// e retry em caso de instabilidade (5xx) do Bling
// ------------------------------------------------------------
async function chamarBling(method, path, body, _tentativa = 1) {
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

  let resp;
  try {
    resp = await fetch(`${BLING_API}${path}`, opts);
  } catch (err) {
    // erro de rede - tenta de novo
    if (_tentativa < MAX_TENTATIVAS_5XX) {
      const espera = 1500 * _tentativa;
      console.log(`[Bling] Erro de rede em ${method} ${path}. Tentativa ${_tentativa}/${MAX_TENTATIVAS_5XX}, esperando ${espera}ms...`);
      await new Promise(r => setTimeout(r, espera));
      return chamarBling(method, path, body, _tentativa + 1);
    }
    throw err;
  }

  // Token expirado: renova e tenta de novo
  if (resp.status === 401) {
    await blingAuth.renovarToken();
    token = await blingAuth.getToken();
    opts.headers.Authorization = `Bearer ${token}`;
    resp = await fetch(`${BLING_API}${path}`, opts);
  }

  // Bling instavel (5xx): tenta de novo com pausa
  if (resp.status >= 500 && resp.status < 600 && _tentativa < MAX_TENTATIVAS_5XX) {
    const espera = 2000 * _tentativa;
    console.log(`[Bling] ${method} ${path} retornou ${resp.status}. Tentativa ${_tentativa}/${MAX_TENTATIVAS_5XX}, esperando ${espera}ms...`);
    await new Promise(r => setTimeout(r, espera));
    return chamarBling(method, path, body, _tentativa + 1);
  }

  if (!resp.ok) {
    const txt = await resp.text();
    // mensagem mais amigavel para 503
    if (resp.status === 503) {
      throw new Error(`Bling fora do ar (503). Tente novamente em alguns minutos.`);
    }
    throw new Error(`Bling ${method} ${path} ${resp.status}: ${txt.slice(0, 300)}`);
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
// Estrutura correta no Bling V3: midia.imagens.externas
// ------------------------------------------------------------
async function atualizarImagens(idProduto, urls) {
  console.log(`[Bling] === atualizarImagens id=${idProduto}, ${urls.length} URLs ===`);

  // 1) Busca produto completo
  const produto = await buscarProdutoCompleto(idProduto);
  if (!produto) throw new Error(`Produto ${idProduto} nao encontrado no Bling`);

  const midiaAtual = produto.midia || {};
  const imagensAtual = midiaAtual.imagens || {};
  const externasAntes = imagensAtual.externas || [];
  const internasAntes = imagensAtual.internas || [];

  console.log(`[Bling] Produto: id=${produto.id}, nome="${produto.nome}", codigo="${produto.codigo}"`);
  console.log(`[Bling] Imagens ANTES (em midia.imagens): externas=${externasAntes.length}, internas=${internasAntes.length}`);
  console.log(`[Bling] Campos de midia atual: ${Object.keys(midiaAtual).join(', ') || '(vazio)'}`);
  if (externasAntes.length > 0) {
    console.log(`[Bling] Estrutura externa[0] atual:`, JSON.stringify(externasAntes[0]));
  }

  // 2) Monta novo body usando estrutura CORRETA: midia.imagens.externas
  const externasNovas = (urls || []).map(link => ({ link }));
  const novoBody = {
    ...produto,
    midia: {
      ...midiaAtual,             // preserva video e outros campos de midia
      imagens: {
        externas: externasNovas,
        internas: internasAntes  // preserva internas
      }
    }
  };

  // 3) Remove apenas o id (nao pode estar no body do PUT)
  delete novoBody.id;

  console.log(`[Bling] PUT body.midia keys: ${Object.keys(novoBody.midia).join(', ')}`);
  console.log(`[Bling] PUT body.midia.imagens.externas (primeiras 3):`, JSON.stringify(novoBody.midia.imagens.externas.slice(0, 3)));

  // 4) Faz PUT
  const resultadoPut = await chamarBling('PUT', `/produtos/${idProduto}`, novoBody);
  console.log(`[Bling] PUT retorno:`, resultadoPut === null ? 'null' : JSON.stringify(resultadoPut).slice(0, 300));

  // 5) VERIFICA pos-PUT
  const verif = await buscarProdutoCompleto(idProduto);
  const verifMidia = (verif && verif.midia) || {};
  const verifImagens = verifMidia.imagens || {};
  const externasDepois = verifImagens.externas || [];

  console.log(`[Bling] Imagens DEPOIS (em midia.imagens): externas=${externasDepois.length}`);
  if (externasDepois.length > 0) {
    console.log(`[Bling] Primeira externa apos PUT:`, JSON.stringify(externasDepois[0]));
  }

  if (externasDepois.length !== urls.length) {
    throw new Error(
      `Bling aceitou o PUT mas nao atualizou as imagens. ` +
      `Esperado: ${urls.length} externas, atual: ${externasDepois.length}.`
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
