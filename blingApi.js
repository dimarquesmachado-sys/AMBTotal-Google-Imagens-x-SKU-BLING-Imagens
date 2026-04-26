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

  // 429 = rate limit (3 req/s do Bling). Espera e tenta de novo
  if (resp.status === 429 && _tentativa < MAX_TENTATIVAS_5XX) {
    const espera = 1500 * _tentativa;
    console.log(`[Bling] ${method} ${path} retornou 429 (rate limit). Tentativa ${_tentativa}/${MAX_TENTATIVAS_5XX}, esperando ${espera}ms...`);
    await new Promise(r => setTimeout(r, espera));
    return chamarBling(method, path, body, _tentativa + 1);
  }

  if (!resp.ok) {
    const txt = await resp.text();
    if (resp.status === 503) {
      throw new Error(`Bling fora do ar (503). Tente novamente em alguns minutos.`);
    }
    throw new Error(`Bling ${method} ${path} ${resp.status}: ${txt.slice(0, 600)}`);
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
// Atualiza imagens externas de um produto usando PATCH MINIMAL
// Estrategia sugerida pelo ChatGPT/comunidade:
// PATCH com APENAS nome+codigo+preco + midia enxuto
// (SEM video, SEM internas, SEM imagensURL)
// Se nem isso funcionar, eh limitacao real da API v3
// Bling tem limite de 3 req/s - usa delay entre chamadas
// ------------------------------------------------------------
async function atualizarImagens(idProduto, urls) {
  console.log(`[Bling] === atualizarImagens id=${idProduto}, ${urls.length} URLs (PATCH MINIMAL) ===`);

  // 1) Estado antes (so pra log e verificacao)
  const produtoAntes = await buscarProdutoCompleto(idProduto);
  if (!produtoAntes) throw new Error(`Produto ${idProduto} nao encontrado no Bling`);

  const externasAntes = ((produtoAntes.midia || {}).imagens || {}).externas || [];
  const internasAntes = ((produtoAntes.midia || {}).imagens || {}).internas || [];

  console.log(`[Bling] Produto: id=${produtoAntes.id}, nome="${produtoAntes.nome}", codigo="${produtoAntes.codigo}", preco=${produtoAntes.preco}`);
  console.log(`[Bling] Imagens ANTES: externas=${externasAntes.length}, internas=${internasAntes.length}`);

  // delay para nao estourar 3 req/s do Bling
  await new Promise(r => setTimeout(r, 400));

  // 2) Body MINIMAL - APENAS midia.imagens.externa
  // ATENCAO: Bling usa SINGULAR "externa" no PUT/PATCH (e nao "externas" plural!)
  // Descoberta via DevTools comparando com a request da UI do Bling.
  const externasNovas = (urls || []).map(link => ({ link }));
  const bodyPatch = {
    midia: {
      imagens: {
        externa: externasNovas  // SINGULAR - bug/inconsistencia da API do Bling
      }
    }
  };

  // 2.1) Produtos KIT/composicao (formato="E"): Bling revalida estrutura
  // mesmo em PATCH, e da erro 400 com tipoEstoque/componentes.
  // Solucao: preservar estrutura existente do produto (igual a UI faz).
  if (produtoAntes.formato === 'E' && produtoAntes.estrutura) {
    bodyPatch.estrutura = {
      tipoEstoque: produtoAntes.estrutura.tipoEstoque || 'V',
      lancamentoEstoque: produtoAntes.estrutura.lancamentoEstoque || 'P',
      componentes: (produtoAntes.estrutura.componentes || []).map(c => ({
        componente: { id: (c.produto && c.produto.id) || (c.componente && c.componente.id) },
        quantidade: c.quantidade
      })),
      excluir: false
    };
    console.log(`[Bling] Produto KIT detectado (formato=E). Preservando estrutura com ${bodyPatch.estrutura.componentes.length} componentes.`);
  }

  // 3) Faz PATCH em 2 etapas para garantir SUBSTITUICAO real
  // (Bling faz "merge" se mandar array com itens direto, entao primeiro
  // limpamos com array vazio, e depois adicionamos as novas URLs)

  // Etapa 3.1: PATCH com externa vazio (limpa tudo)
  const bodyLimpar = JSON.parse(JSON.stringify(bodyPatch));
  bodyLimpar.midia.imagens.externa = [];
  console.log(`[Bling] PATCH 1/2 (limpar): externa=[]`);
  const resLimpar = await chamarBling('PATCH', `/produtos/${idProduto}`, bodyLimpar);
  console.log(`[Bling] PATCH 1/2 retorno:`, resLimpar === null ? 'null' : JSON.stringify(resLimpar).slice(0, 200));

  // delay entre os 2 PATCH para nao estourar 3 req/s
  await new Promise(r => setTimeout(r, 400));

  // Etapa 3.2: PATCH com as URLs novas
  console.log(`[Bling] PATCH 2/2 (adicionar): externa=[${externasNovas.length} URLs]`);
  console.log(`[Bling] PATCH 2/2 body keys: ${Object.keys(bodyPatch).join(', ')}`);
  console.log(`[Bling] PATCH 2/2 body.midia:`, JSON.stringify(bodyPatch.midia).slice(0, 500));

  const resultadoPatch = await chamarBling('PATCH', `/produtos/${idProduto}`, bodyPatch);
  console.log(`[Bling] PATCH 2/2 retorno:`, resultadoPatch === null ? 'null' : JSON.stringify(resultadoPatch).slice(0, 300));

  // delay antes da verificacao
  await new Promise(r => setTimeout(r, 400));

  // 4) Verifica
  const verif = await buscarProdutoCompleto(idProduto);
  const verifMidia = (verif && verif.midia) || {};
  const verifImagens = verifMidia.imagens || {};
  const externasDepois = verifImagens.externas || [];

  console.log(`[Bling] Imagens DEPOIS: externas=${externasDepois.length}`);
  if (externasDepois.length > 0) {
    console.log(`[Bling] Primeira externa apos PATCH:`, JSON.stringify(externasDepois[0]));
  }

  if (externasDepois.length !== urls.length) {
    throw new Error(
      `Bling aceitou o PATCH MINIMAL mas nao atualizou as imagens. ` +
      `Esperado: ${urls.length} externas, atual: ${externasDepois.length}.`
    );
  }

  console.log(`[Bling] === SUCESSO id=${idProduto}: ${externasDepois.length} externas confirmadas ===`);

  return {
    ok: true,
    qtdExternas: externasNovas.length,
    qtdInternasMantidas: internasAntes.length,
    qtdExternasConfirmadas: externasDepois.length,
    retornoBling: resultadoPatch
  };
}

module.exports = {
  buscarPorCodigo,
  buscarProdutoCompleto,
  atualizarImagens
};
