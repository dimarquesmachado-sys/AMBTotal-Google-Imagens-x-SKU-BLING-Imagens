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
// OAuth Bling — Autorizar
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
// /api/pastas — lista pastas do Drive + status no Bling
// ------------------------------------------------------------
app.get('/api/pastas', async (req, res) => {
  try {
    const pastaMae = process.env.DRIVE_FOLDER_ID;
    if (!pastaMae) {
      return res.status(500).json({ erro: 'DRIVE_FOLDER_ID nao configurado' });
    }

    // 1) Lista subpastas da pasta-mãe (cada subpasta = um SKU)
    const subpastas = await drive.listarSubpastas(pastaMae);

    // 2) Pra cada subpasta, conta arquivos e busca no Bling
    const resultados = [];
    for (const sub of subpastas) {
      const arquivos = await drive.listarImagens(sub.id);
      let produtoBling = null;
      try {
        if (blingAuth.estaAutorizado()) {
          produtoBling = await blingApi.buscarPorCodigo(sub.name);
        } else {
          produtoBling = { erro: 'Bling nao autorizado' };
        }
      } catch (e) {
        produtoBling = { erro: e.message };
      }
      resultados.push({
        sku: sub.name,
        pastaId: sub.id,
        qtdImagens: arquivos.length,
        bling: produtoBling
      });
    }

    res.json({ total: resultados.length, pastas: resultados });
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
