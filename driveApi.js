const { google } = require('googleapis');

let driveClient = null;

function getCliente() {
  if (driveClient) return driveClient;

  const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!json) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON nao configurado');
  }

  let credentials;
  try {
    credentials = JSON.parse(json);
  } catch (e) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON com JSON invalido: ' + e.message);
  }

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive']
  });

  driveClient = google.drive({ version: 'v3', auth });
  return driveClient;
}

function estaConfigurado() {
  return !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON && !!process.env.DRIVE_FOLDER_ID;
}

async function listarSubpastas(folderId) {
  const drive = getCliente();
  const resp = await drive.files.list({
    q: `'${folderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id, name, createdTime, modifiedTime)',
    pageSize: 1000,
    orderBy: 'name'
  });
  return resp.data.files || [];
}

async function listarImagens(folderId) {
  const drive = getCliente();
  const resp = await drive.files.list({
    q: `'${folderId}' in parents and mimeType contains 'image/' and trashed = false`,
    fields: 'files(id, name, mimeType)',
    pageSize: 100,
    orderBy: 'name'
  });
  return resp.data.files || [];
}

async function tornarPublico(fileId) {
  const drive = getCliente();
  await drive.permissions.create({
    fileId,
    requestBody: {
      role: 'reader',
      type: 'anyone'
    }
  });
  return true;
}

module.exports = {
  estaConfigurado,
  listarSubpastas,
  listarImagens,
  tornarPublico
};
