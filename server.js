const express = require('express');
const drive = require('./driveApi');
const blingAuth = require('./blingAuth');
const blingApi = require('./blingApi');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------
function extrairNumero(nome) {
  // Remove extensao e pega ultimo numero do nome (1.jpg -> 1, foto_3.jpg -> 3)
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
// /api/pastas — lista pastas do Drive (rapido, sem Bling)
// ------------------------------------------------------------
app.get('/api/pastas', async (req, res) => {
  try {
    const pastaMae = process.env.DRIVE_FOLDER_ID;
    if (!pastaMae) {
      return res.status(500).json({ erro: 'DRIVE_FOLDER_ID nao configurado' });
    }

    const subpastas = await drive.listarSubpastas(pastaMae);

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

    resultados.sort((a, b) => a.sku.localeCompare(b.sku, 'pt-BR', { numeric: true, sensitivity: 'base' }));

    res.json({ total: resultados.length, pastas: resultados });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

// ------------------------------------------------------------
// /api/verificar-bling — verifica varios SKUs no Bling
// Body: { skus: ['ABC', ...] }
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
    const concorrencia = 5;

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
// /api/processar — torna imagens publicas + gera URLs LH3
// Body: { items: [{ sku, pastaId }, ...] }
// ------------------------------------------------------------
app.post('/api/processar', async (req, res) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ erro: 'Envie array items: [{sku, pastaId}]' });
    }
    if (!drive.estaConfigurado()) {
      return res.status(500).json({ erro: 'Drive nao configurado' });
    }

    const resultados = {};

    // Processa SKUs em serie (mas imagens dentro de cada SKU em paralelo)
    for (const item of items) {
      const { sku, pastaId } = item;
      if (!sku || !pastaId) {
        resultados[sku || '(sem nome)'] = { erro: 'sku ou pastaId faltando' };
        continue;
      }

      try {
        // 1) Lista imagens
        const imagens = await drive.listarImagens(pastaId);
        if (imagens.length === 0) {
          resultados[sku] = { qtd: 0, urls: [], aviso: 'pasta sem imagens' };
          continue;
        }

        // 2) Ordena por numero no nome (1, 2, 3...)
        imagens.sort((a, b) => {
          const na = extrairNumero(a.name);
          const nb = extrairNumero(b.name);
          if (na !== nb) return na - nb;
          return String(a.name).localeCompare(String(b.name), 'pt-BR');
        });

        // 3) Torna cada imagem publica (em paralelo, max 3 por vez)
        const concorrencia = 3;
        for (let i = 0; i < imagens.length; i += concorrencia) {
          const lote = imagens.slice(i, i + concorrencia);
          await Promise.all(lote.map(async (img) => {
            try {
              await drive.tornarPublico(img.id);
            } catch (e) {
              // Se ja for publico, alguns retornos podem dar erro - ignora
              console.log(`Aviso ao publicar ${img.name}: ${e.message}`);
            }
          }));
        }

        // 4) Monta URLs LH3 na ordem
        const urls = imagens.map(img => `https://lh3.googleusercontent.com/d/${img.id}`);
        const nomes = imagens.map(img => img.name);

        resultados[sku] = {
          qtd: imagens.length,
          urls,
          nomes,
          urlsConcatenadas: urls.join('|')
        };
      } catch (e) {
        resultados[sku] = { erro: e.message };
      }
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
