const express = require('express');
const drive = require('./driveApi');
const blingAuth = require('./blingAuth');
const blingApi = require('./blingApi');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;

// ------------------------------------------------------------
function extrairNumero(nome) {
  const base = String(nome || '').replace(/\.[^.]+$/, '');
  const matches = base.match(/\d+/g);
  if (!matches) return 999999;
  return parseInt(matches[matches.length - 1], 10);
}

// ------------------------------------------------------------
// /api/status
// ------------------------------------------------------------
app.get('/api/status', async (req, res) => {
  try {
    res.json({
      bling: blingAuth.estaAutorizado(),
      drive: drive.estaConfigurado(),
      pastaMae: process.env.DRIVE_FOLDER_ID || null
    });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

// ------------------------------------------------------------
// OAuth Bling
// ------------------------------------------------------------
app.get('/auth/bling', (req, res) => {
  try { res.redirect(blingAuth.gerarUrlAutorizacao()); }
  catch (e) { res.status(500).send(`<h2>Erro:</h2><pre>${e.message}</pre>`); }
});

app.get('/bling/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error) return res.send(`<h2>Erro: ${error}</h2><a href="/">voltar</a>`);
  try {
    await blingAuth.trocarCodigoPorToken(code);
    res.send(`
      <h2>✅ Bling autorizado com sucesso!</h2>
      <p>Os tokens foram salvos. <a href="/">← voltar para o sistema</a></p>
    `);
  } catch (e) {
    res.status(500).send(`<h2>Erro:</h2><pre>${e.message}</pre>`);
  }
});

// ------------------------------------------------------------
// /api/pastas
// ------------------------------------------------------------
app.get('/api/pastas', async (req, res) => {
  try {
    const pastaMae = process.env.DRIVE_FOLDER_ID;
    if (!pastaMae) return res.status(500).json({ erro: 'DRIVE_FOLDER_ID nao configurado' });

    const subpastas = await drive.listarSubpastas(pastaMae);
    const resultados = await Promise.all(subpastas.map(async (sub) => {
      try {
        const conteudo = await drive.listarConteudoCompleto(sub.id);
        return {
          sku: sub.name,
          pastaId: sub.id,
          qtdImagens: conteudo.imagens.length,
          qtdSubpastas: conteudo.subpastas.length,
          createdTime: sub.createdTime,
          modifiedTime: sub.modifiedTime
        };
      } catch (e) {
        return {
          sku: sub.name,
          pastaId: sub.id,
          qtdImagens: 0,
          qtdSubpastas: 0,
          erro: e.message,
          createdTime: sub.createdTime,
          modifiedTime: sub.modifiedTime
        };
      }
    }));
    resultados.sort((a, b) => a.sku.localeCompare(b.sku, 'pt-BR', { numeric: true, sensitivity: 'base' }));
    res.json({ total: resultados.length, pastas: resultados });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

// ------------------------------------------------------------
// /api/verificar-bling
// ------------------------------------------------------------
app.post('/api/verificar-bling', async (req, res) => {
  try {
    const { skus } = req.body;
    if (!Array.isArray(skus) || skus.length === 0) return res.status(400).json({ erro: 'Envie array de SKUs' });
    if (!blingAuth.estaAutorizado()) return res.status(401).json({ erro: 'Bling nao autorizado' });

    const resultados = {};
    for (let i = 0; i < skus.length; i += 5) {
      const lote = skus.slice(i, i + 5);
      await Promise.all(lote.map(async (sku) => {
        try { resultados[sku] = await blingApi.buscarPorCodigo(sku); }
        catch (e) { resultados[sku] = { erro: e.message }; }
      }));
    }
    res.json({ resultados });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

// ------------------------------------------------------------
// /api/processar
// ------------------------------------------------------------
app.post('/api/processar', async (req, res) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ erro: 'Envie array items: [{sku, pastaId}]' });
    }
    if (!drive.estaConfigurado()) return res.status(500).json({ erro: 'Drive nao configurado' });

    const resultados = {};
    for (const item of items) {
      resultados[item.sku || '(sem nome)'] = await processarUm(item);
    }
    res.json({ resultados });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

// Limite máximo de imagens externas suportado pelo Bling
const MAX_IMAGENS_BLING = 12;

// Helper: ordena imagens por numero no nome, depois alfabetica
function ordenarImagens(imagens) {
  imagens.sort((a, b) => {
    const na = extrairNumero(a.name);
    const nb = extrairNumero(b.name);
    if (na !== nb) return na - nb;
    return String(a.name).localeCompare(String(b.name), 'pt-BR');
  });
  return imagens;
}

// Helper: aplica limite de 12 e gera URLs LH3
async function processarImagensRaw(imagens, contextoLog) {
  if (!imagens || imagens.length === 0) return { qtd: 0, urls: [], nomes: [] };

  ordenarImagens(imagens);

  const qtdTotal = imagens.length;
  const limitadas = imagens.slice(0, MAX_IMAGENS_BLING);
  let aviso = null;
  if (qtdTotal > MAX_IMAGENS_BLING) {
    aviso = `${contextoLog} tem ${qtdTotal} imagens, limitado a ${MAX_IMAGENS_BLING}. Imagens 13+ ignoradas.`;
    console.log(`[AVISO] ${aviso}`);
  }

  // Tornar publicas em paralelo (de 3 em 3 para nao estourar rate limit)
  for (let i = 0; i < limitadas.length; i += 3) {
    const lote = limitadas.slice(i, i + 3);
    await Promise.all(lote.map(async (img) => {
      try { await drive.tornarPublico(img.id); }
      catch (e) { console.log(`Aviso publicar ${img.name}: ${e.message}`); }
    }));
  }

  const urls = limitadas.map(img => `https://lh3.googleusercontent.com/d/${img.id}`);
  const nomes = limitadas.map(img => img.name);
  const ret = { qtd: limitadas.length, qtdTotal, urls, nomes, urlsConcatenadas: urls.join('|') };
  if (aviso) ret.aviso = aviso;
  return ret;
}

async function processarUm({ sku, pastaId }) {
  if (!sku || !pastaId) return { erro: 'sku ou pastaId faltando' };
  try {
    // 1) Lista TUDO da pasta-pai (imagens + subpastas)
    const { imagens: imagensPai, subpastas } = await drive.listarConteudoCompleto(pastaId);

    // 2) Processa imagens da raiz (= imagens do produto-pai)
    const resultadoPai = await processarImagensRaw(imagensPai, `SKU ${sku}`);

    // 3) Se NAO tem subpastas, retorna so o pai (estrutura igual a antiga)
    if (!subpastas || subpastas.length === 0) {
      if (resultadoPai.qtd === 0) {
        return { qtd: 0, urls: [], aviso: 'pasta sem imagens' };
      }
      return resultadoPai;
    }

    // 4) Tem subpastas - processa cada uma como variacao
    console.log(`[Variacoes] SKU ${sku} tem ${subpastas.length} subpasta(s) de variacao`);
    const variacoes = {};
    for (const sub of subpastas) {
      const codigoVar = sub.name;
      try {
        const { imagens: imagensVar } = await drive.listarConteudoCompleto(sub.id);
        const resultadoVar = await processarImagensRaw(imagensVar, `Variacao ${codigoVar}`);
        variacoes[codigoVar] = resultadoVar;
      } catch (e) {
        variacoes[codigoVar] = { erro: e.message };
      }
    }

    return {
      ...resultadoPai,
      temVariacoes: true,
      variacoes
    };
  } catch (e) {
    return { erro: e.message };
  }
}

// ------------------------------------------------------------
// /api/enviar-bling
// ------------------------------------------------------------
app.post('/api/enviar-bling', async (req, res) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ erro: 'Envie array items: [{sku, urls}]' });
    }
    if (!blingAuth.estaAutorizado()) return res.status(401).json({ erro: 'Bling nao autorizado' });

    const resultados = {};
    for (const it of items) {
      resultados[it.sku] = await enviarUm(it);
    }
    res.json({ resultados });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

async function enviarUm({ sku, urls, variacoesUrls }) {
  if (!sku) return { erro: 'sku faltando' };
  if (!Array.isArray(urls) || urls.length === 0) return { erro: 'urls vazias - processe primeiro' };
  try {
    console.log(`[enviarUm] === INICIO sku=${sku}, urls=${urls.length}, variacoesUrls=${variacoesUrls ? Object.keys(variacoesUrls).join(',') : 'nenhum'} ===`);

    const produto = await blingApi.buscarPorCodigo(sku);
    if (!produto.encontrado) return { erro: 'produto nao encontrado no Bling' };
    console.log(`[enviarUm] Produto encontrado: id=${produto.id}, codigo=${produto.codigo}`);

    // Busca completo para saber se tem variacoes (formato='V')
    const completo = await blingApi.buscarProdutoCompleto(produto.id);
    console.log(`[enviarUm] Produto completo: formato=${completo && completo.formato}, variacoes=${completo && completo.variacoes ? completo.variacoes.length : 'nao tem array'}`);

    const temVariacoes = completo && completo.formato === 'V' && Array.isArray(completo.variacoes) && completo.variacoes.length > 0;
    console.log(`[enviarUm] temVariacoes=${temVariacoes}`);

    // 1) Envia imagens do produto-pai (sempre)
    const r = await blingApi.atualizarImagens(produto.id, urls);
    const resultadoPai = {
      ok: true,
      idProduto: produto.id,
      nomeProduto: produto.nome,
      qtdEnviadas: r.qtdExternas,
      qtdConfirmadas: r.qtdExternasConfirmadas,
      qtdInternasMantidas: r.qtdInternasMantidas
    };

    // 2) Se NAO tem variacoes, retorna so o resultado do pai
    if (!temVariacoes) {
      console.log(`[enviarUm] Sem variacoes - finalizando com pai apenas`);
      return {
        ...resultadoPai,
        enviadoEm: new Date().toISOString()
      };
    }

    // 3) Tem variacoes - itera por cada uma
    console.log(`[Variacoes] === Produto ${sku} tem ${completo.variacoes.length} variacao(oes), processando ===`);
    const resultadosVariacoes = {};
    variacoesUrls = variacoesUrls || {};
    console.log(`[Variacoes] variacoesUrls disponivel para codigos: [${Object.keys(variacoesUrls).join(', ')}]`);

    for (const variacao of completo.variacoes) {
      console.log(`[Variacoes] --- Processando variacao id=${variacao.id}, nome="${variacao.nome}", codigo_no_pai="${variacao.codigo || '(vazio)'}" ---`);

      // O codigo da variacao vem vazio no JSON do pai. Precisa buscar individualmente.
      let codigoVar = variacao.codigo;
      if (!codigoVar) {
        try {
          console.log(`[Variacoes] Buscando codigo via /produtos/${variacao.id}...`);
          const varCompleta = await blingApi.buscarProdutoCompleto(variacao.id);
          codigoVar = varCompleta && varCompleta.codigo ? varCompleta.codigo : null;
          console.log(`[Variacoes] Codigo obtido: "${codigoVar}"`);
          // delay para nao estourar rate limit
          await new Promise(r => setTimeout(r, 400));
        } catch (e) {
          console.log(`[Variacoes] ERRO buscando codigo da variacao id=${variacao.id}: ${e.message}`);
        }
      }

      if (!codigoVar) {
        console.log(`[Variacoes] PULANDO variacao id=${variacao.id} - sem codigo definido`);
        resultadosVariacoes[`(id ${variacao.id})`] = { erro: 'variacao sem codigo definido no Bling' };
        continue;
      }

      // Decide quais URLs usar
      const temSubpastaPropria = !!(variacoesUrls[codigoVar] && variacoesUrls[codigoVar].length > 0);
      const urlsVar = temSubpastaPropria ? variacoesUrls[codigoVar] : urls;
      const fonte = temSubpastaPropria ? 'subpasta-propria' : 'replicado-pai';
      console.log(`[Variacoes] Enviando ${urlsVar.length} URLs para ${codigoVar} (id=${variacao.id}, fonte=${fonte})`);

      try {
        const rVar = await blingApi.atualizarImagens(variacao.id, urlsVar);
        console.log(`[Variacoes] SUCESSO ${codigoVar}: ${rVar.qtdExternasConfirmadas} confirmadas`);
        resultadosVariacoes[codigoVar] = {
          ok: true,
          idVariacao: variacao.id,
          fonte,
          qtdEnviadas: rVar.qtdExternas,
          qtdConfirmadas: rVar.qtdExternasConfirmadas
        };
      } catch (e) {
        console.log(`[Variacoes] ERRO ${codigoVar}: ${e.message}`);
        resultadosVariacoes[codigoVar] = {
          erro: e.message,
          idVariacao: variacao.id,
          fonte
        };
      }
    }

    console.log(`[enviarUm] === FIM ${sku}: ${Object.keys(resultadosVariacoes).length} variacoes processadas ===`);

    return {
      ...resultadoPai,
      temVariacoes: true,
      variacoes: resultadosVariacoes,
      enviadoEm: new Date().toISOString()
    };
  } catch (e) {
    console.log(`[enviarUm] ERRO GERAL: ${e.message}`);
    return { erro: e.message };
  }
}

// ------------------------------------------------------------
// /api/processar-e-enviar (Tudo direto)
// ------------------------------------------------------------
app.post('/api/processar-e-enviar', async (req, res) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ erro: 'Envie array items: [{sku, pastaId}]' });
    }
    if (!drive.estaConfigurado()) return res.status(500).json({ erro: 'Drive nao configurado' });
    if (!blingAuth.estaAutorizado()) return res.status(401).json({ erro: 'Bling nao autorizado' });

    const resultados = {};
    for (const item of items) {
      try {
        const proc = await processarUm(item);
        if (proc.erro) {
          resultados[item.sku] = { etapa: 'processar', erro: proc.erro };
          continue;
        }
        if (!proc.urls || proc.urls.length === 0) {
          resultados[item.sku] = { etapa: 'processar', erro: proc.aviso || 'sem URLs geradas' };
          continue;
        }

        // Se tem variacoes, monta mapa { codigoVariacao: [urls] }
        let variacoesUrls = null;
        if (proc.temVariacoes && proc.variacoes) {
          variacoesUrls = {};
          for (const codVar of Object.keys(proc.variacoes)) {
            const v = proc.variacoes[codVar];
            if (v && Array.isArray(v.urls) && v.urls.length > 0) {
              variacoesUrls[codVar] = v.urls;
            }
          }
        }

        const env = await enviarUm({ sku: item.sku, urls: proc.urls, variacoesUrls });
        resultados[item.sku] = {
          processamento: {
            qtd: proc.qtd,
            urls: proc.urls,
            nomes: proc.nomes,
            urlsConcatenadas: proc.urlsConcatenadas,
            temVariacoes: !!proc.temVariacoes,
            variacoes: proc.variacoes || null
          },
          envio: env
        };
      } catch (e) {
        resultados[item.sku] = { erro: e.message };
      }
    }
    res.json({ resultados });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

// ------------------------------------------------------------
// /api/debug-produto/:codigo - retorna produto COMPLETO
// ------------------------------------------------------------
app.get('/api/debug-produto/:codigo', async (req, res) => {
  try {
    if (!blingAuth.estaAutorizado()) return res.status(401).json({ erro: 'Bling nao autorizado' });
    const codigo = req.params.codigo;
    const resumo = await blingApi.buscarPorCodigo(codigo);
    if (!resumo.encontrado) return res.json({ encontrado: false });
    const completo = await blingApi.buscarProdutoCompleto(resumo.id);
    res.json({
      encontrado: true,
      id: resumo.id,
      codigo: resumo.codigo,
      nome: resumo.nome,
      produtoCompleto: completo,
      camposDoProduto: completo ? Object.keys(completo) : []
    });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

// ------------------------------------------------------------
// /api/sondar/:codigo - sondagem de rotas (so GET, nao altera nada)
// Tenta varias rotas potenciais para descobrir se existe endpoint
// especifico de midia/imagens
// ------------------------------------------------------------
app.get('/api/sondar/:codigo', async (req, res) => {
  try {
    if (!blingAuth.estaAutorizado()) return res.status(401).json({ erro: 'Bling nao autorizado' });

    const resumo = await blingApi.buscarPorCodigo(req.params.codigo);
    if (!resumo.encontrado) return res.json({ encontrado: false });
    const id = resumo.id;

    const rotas = [
      `/produtos/${id}/midia`,
      `/produtos/${id}/midias`,
      `/produtos/${id}/imagens`,
      `/produtos/${id}/imagens/externas`,
      `/produtos/midia/${id}`,
      `/produtos/imagens/${id}`,
      `/produtos/${id}/anexos`
    ];

    const token = await blingAuth.getToken();
    const resultados = [];

    for (const rota of rotas) {
      // Espera entre cada call para nao estourar rate limit (3 req/s)
      await new Promise(r => setTimeout(r, 400));
      try {
        const resp = await fetch(`https://api.bling.com.br/Api/v3${rota}`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}` }
        });
        const txt = await resp.text();
        resultados.push({
          rota,
          status: resp.status,
          tipo: resp.status === 404 ? 'NAO EXISTE' : (resp.status >= 200 && resp.status < 300 ? 'EXISTE!' : 'outro'),
          body: txt.slice(0, 200)
        });
      } catch (e) {
        resultados.push({ rota, erro: e.message });
      }
    }

    res.json({ id, codigo: resumo.codigo, resultados });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

// ------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  console.log(`Drive configurado: ${drive.estaConfigurado()}`);
  console.log(`Bling autorizado: ${blingAuth.estaAutorizado()}`);
});
