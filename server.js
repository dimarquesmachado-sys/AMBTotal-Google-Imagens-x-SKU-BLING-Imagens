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
        const arquivos = await drive.listarImagens(sub.id);
        return {
          sku: sub.name,
          pastaId: sub.id,
          qtdImagens: arquivos.length,
          createdTime: sub.createdTime,
          modifiedTime: sub.modifiedTime
        };
      } catch (e) {
        return {
          sku: sub.name,
          pastaId: sub.id,
          qtdImagens: 0,
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

async function processarUm({ sku, pastaId }) {
  if (!sku || !pastaId) return { erro: 'sku ou pastaId faltando' };
  try {
    const imagensTodas = await drive.listarImagens(pastaId);
    if (imagensTodas.length === 0) return { qtd: 0, urls: [], aviso: 'pasta sem imagens' };

    imagensTodas.sort((a, b) => {
      const na = extrairNumero(a.name);
      const nb = extrairNumero(b.name);
      if (na !== nb) return na - nb;
      return String(a.name).localeCompare(String(b.name), 'pt-BR');
    });

    // Aplica limite de 12 imagens (Bling so aceita ate 12 imagens externas)
    const qtdTotal = imagensTodas.length;
    const imagens = imagensTodas.slice(0, MAX_IMAGENS_BLING);
    let aviso = null;
    if (qtdTotal > MAX_IMAGENS_BLING) {
      aviso = `Pasta tem ${qtdTotal} imagens, limitado a ${MAX_IMAGENS_BLING} (Bling so aceita ate ${MAX_IMAGENS_BLING}). Imagens 13+ ignoradas.`;
      console.log(`[AVISO] SKU ${sku}: ${aviso}`);
    }

    for (let i = 0; i < imagens.length; i += 3) {
      const lote = imagens.slice(i, i + 3);
      await Promise.all(lote.map(async (img) => {
        try { await drive.tornarPublico(img.id); }
        catch (e) { console.log(`Aviso publicar ${img.name}: ${e.message}`); }
      }));
    }

    const urls = imagens.map(img => `https://lh3.googleusercontent.com/d/${img.id}`);
    const nomes = imagens.map(img => img.name);
    const ret = { qtd: imagens.length, qtdTotal, urls, nomes, urlsConcatenadas: urls.join('|') };
    if (aviso) ret.aviso = aviso;
    return ret;
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

async function enviarUm({ sku, urls }) {
  if (!sku) return { erro: 'sku faltando' };
  if (!Array.isArray(urls) || urls.length === 0) return { erro: 'urls vazias - processe primeiro' };
  try {
    const produto = await blingApi.buscarPorCodigo(sku);
    if (!produto.encontrado) return { erro: 'produto nao encontrado no Bling' };

    const r = await blingApi.atualizarImagens(produto.id, urls);
    return {
      ok: true,
      idProduto: produto.id,
      nomeProduto: produto.nome,
      qtdEnviadas: r.qtdExternas,
      qtdConfirmadas: r.qtdExternasConfirmadas,
      qtdInternasMantidas: r.qtdInternasMantidas,
      enviadoEm: new Date().toISOString()
    };
  } catch (e) {
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
        const env = await enviarUm({ sku: item.sku, urls: proc.urls });
        resultados[item.sku] = {
          processamento: { qtd: proc.qtd, urls: proc.urls, nomes: proc.nomes, urlsConcatenadas: proc.urlsConcatenadas },
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
