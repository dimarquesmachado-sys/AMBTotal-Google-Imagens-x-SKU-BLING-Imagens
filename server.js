const express = require('express');
const drive = require('./driveApi');
const blingAuth = require('./blingAuth');
const blingApi = require('./blingApi');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;

// ------------------------------------------------------------
// /api/status — status geral (Drive configurado? Bling autorizado?)
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
  try {
    const url = blingAuth.gerarUrlAutorizacao();
    res.redirect(url);
  } catch (e) {
    res.status(500).send(`<h2>Erro:</h2><pre>${e.message}</pre>`);
  }
});

app.get('/bling/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error) {
    return res.send(`<h2>Erro na autorização: ${error}</h2><a href="/">voltar</a>`);
  }
  try {
    await blingAuth.trocarCodigoPorToken(code);
    res.send(`
      <h2>✅ Bling autorizado com sucesso!</h2>
      <p>Os tokens foram salvos. Você já pode fechar esta aba ou voltar pra tela inicial.</p>
      <p><a href="/">← voltar para o sistema</a></p>
    `);
  } catch (e) {
    res.status(500).send(`<h2>Erro ao trocar code por token:</h2><pre>${e.message}</pre>`);
  }
});

// ------------------------------------------------------------
// /api/pastas — lista pastas do Drive + qtd de imagens (SEM Bling - rápido)
// ------------------------------------------------------------
app.get('/api/pastas', async (req, res) => {
  try {
    const pastaMae = process.env.DRIVE_FOLDER_ID;
    if (!pastaMae) {
      return res.status(500).json({ erro: 'DRIVE_FOLDER_ID nao configurado' });
    }

    const subpastas = await drive.listarSubpastas(pastaMae);

    // Paraleliza a contagem de imagens
    const resultados = await Promise.all(subpastas.map(async (sub) => {
      try {
        const arquivos = await drive.listarImagens(sub.id);
        return {
          sku: sub.name,
          pastaId: sub.id,
          qtdImagens: arquivos.length
        };
      } catch (e) {
        return {
          sku: sub.name,
          pastaId: sub.id,
          qtdImagens: 0,
          erro: e.message
        };
      }
    }));

    // Ordena por nome do SKU (case insensitive, numérico)
    resultados.sort((a, b) => a.sku.localeCompare(b.sku, 'pt-BR', { numeric: true, sensitivity: 'base' }));

    res.json({ total: resultados.length, pastas: resultados });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

// ------------------------------------------------------------
// /api/verificar-bling — verifica vários SKUs no Bling em paralelo controlado
// Body: { skus: ['ABC', 'DEF', ...] }
// Retorna: { resultados: { ABC: {...}, DEF: {...} } }
// ------------------------------------------------------------
app.post('/api/verificar-bling', async (req, res) => {
  try {
    const { skus } = req.body;
    if (!Array.isArray(skus) || skus.length === 0) {
      return res.status(400).json({ erro: 'Envie um array de SKUs' });
    }
    if (!blingAuth.estaAutorizado()) {
      return res.status(401).json({ erro: 'Bling nao autorizado' });
    }

    const resultados = {};
    const concorrencia = 5; // 5 chamadas Bling em paralelo

    for (let i = 0; i < skus.length; i += concorrencia) {
      const lote = skus.slice(i, i + concorrencia);
      await Promise.all(lote.map(async (sku) => {
        try {
          resultados[sku] = await blingApi.buscarPorCodigo(sku);
        } catch (e) {
          resultados[sku] = { erro: e.message };
        }
      }));
    }

    res.json({ resultados });
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
