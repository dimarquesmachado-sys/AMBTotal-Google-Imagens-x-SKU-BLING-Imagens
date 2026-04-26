const blingAuth = require('./blingAuth');

const BLING_API = 'https://api.bling.com.br/Api/v3';
const MAX_TENTATIVAS_5XX = 3;

// ------------------------------------------------------------
// WHITELIST de campos aceitos no PUT /produtos/{id}
// (baseado no schema oficial bling-erp-api-js v5.8 - IUpdateBody)
// Campos que o GET retorna mas o PUT NAO aceita estao removidos
// ------------------------------------------------------------
const CAMPOS_PUT_PERMITIDOS = [
  'nome', 'codigo', 'preco', 'tipo', 'situacao', 'formato',
  'descricaoCurta', 'dataValidade', 'unidade',
  'pesoLiquido', 'pesoBruto', 'volumes', 'itensPorCaixa',
  'gtin', 'gtinEmbalagem', 'tipoProducao', 'condicao',
  'freteGratis', 'marca', 'descricaoComplementar', 'linkExterno', 'observacoes',
  'categoria', 'estoque', 'actionEstoque', 'dimensoes', 'tributacao',
  'midia', 'linhaProduto', 'estrutura', 'camposCustomizados', 'variacoes'
];
// Campos que o GET retorna mas PUT NAO aceita (causam rejeicao silenciosa):
// - id, descricaoEmbalagemDiscreta, fornecedor, artigoPerigoso

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
    if (_tentativa < MAX_TENTATIVAS_5XX) {
      const espera = 1500 * _tentativa;
      console.log(`[Bling] Erro de rede em ${method} ${path}. Tentativa ${_tentativa}/${MAX_TENTATIVAS_5XX}, esperando ${espera}ms...`);
      await new Promise(r => setTimeout(r, espera));
      return chamarBling(method, path, body, _tentativa + 1);
    }
    throw err;
  }

  if (resp.status === 401) {
    await blingAuth.renovarToken();
    token = await blingAuth.getToken();
    opts.headers.Authorization = `Bearer ${token}`;
    resp = await fetch(`${BLING_API}${path}`, opts);
  }

  if (resp.status >= 500 && resp.status < 600 && _tentativa < MAX_TENTATIVAS_5XX) {
    const espera = 2000 * _tentativa;
    console.log(`[Bling] ${method} ${path} retornou ${resp.status}. Tentativa ${_tentativa}/${MAX_TENTATIVAS_5XX}, esperando ${espera}ms...`);
    await new Promise(r => setTimeout(r, espera));
    return chamarBling(method, path, body, _tentativa + 1);
  }

  if (!resp.ok) {
    const txt = await resp.text();
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
async function buscarProdutoCompleto(idProduto) {
  const data = await chamarBling('GET', `/produtos/${idProduto}`);
  return data && data.data ? data.data : null;
}

// ------------------------------------------------------------
// Atualiza imagens externas de um produto
// Estrutura correta no Bling V3 (schema oficial):
// midia.imagens.externas[{ link }]
// midia.video.url (opcional, mantem se existir)
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
  const videoAtual = midiaAtual.video || null;

  console.log(`[Bling] Produto: id=${produto.id}, nome="${produto.nome}", codigo="${produto.codigo}"`);
  console.log(`[Bling] Imagens ANTES: externas=${externasAntes.length}, internas=${internasAntes.length}`);
  console.log(`[Bling] Video atual:`, JSON.stringify(videoAtual));

  // 2) Monta novo midia (estrutura EXATA do schema oficial)
  const externasNovas = (urls || []).map(link => ({ link }));
  const novaMidia = {
    imagens: {
      externas: externasNovas
      // NAO inclui "internas" - schema PUT nao aceita
    }
  };
  // Se o produto ja tem video.url, mantem
  if (videoAtual && videoAtual.url) {
    novaMidia.video = { url: videoAtual.url };
  }

  // 3) Monta body usando WHITELIST (so campos aceitos pelo schema PUT)
  const novoBody = {};
  for (const campo of CAMPOS_PUT_PERMITIDOS) {
    if (produto[campo] !== undefined && produto[campo] !== null) {
      novoBody[campo] = produto[campo];
    }
  }
  // Sobrescreve midia com a nova estrutura
  novoBody.midia = novaMidia;
  // variacoes obrigatoria no schema - garante que existe (array vazio se nao tiver)
  if (!Array.isArray(novoBody.variacoes)) {
    novoBody.variacoes = [];
  }

  console.log(`[Bling] PUT body keys: ${Object.keys(novoBody).join(', ')}`);
  console.log(`[Bling] PUT body.midia:`, JSON.stringify(novaMidia).slice(0, 500));

  // 4) Faz PUT
  const resultadoPut = await chamarBling('PUT', `/produtos/${idProduto}`, novoBody);
  console.log(`[Bling] PUT retorno:`, resultadoPut === null ? 'null' : JSON.stringify(resultadoPut).slice(0, 300));

  // 5) Verifica pos-PUT
  const verif = await buscarProdutoCompleto(idProduto);
  const verifMidia = (verif && verif.midia) || {};
  const verifImagens = verifMidia.imagens || {};
  const externasDepois = verifImagens.externas || [];

  console.log(`[Bling] Imagens DEPOIS: externas=${externasDepois.length}`);
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
