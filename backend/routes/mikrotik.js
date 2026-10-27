const express = require('express');
const { normalizeCredentials, validHost } = require('../mikrotikMonitor');
const { classifyConnectError, probeConnection } = require('../mikrotik_connect');
const { loadCredentials, publicSession, saveCredentials } = require('../mikrotik_store');
const { beginStreaming } = require('../mikrotik_socket');

const router = express.Router();

function validationMessage(error) {
  return error?.message || 'Data koneksi tidak valid';
}

router.get('/session', async (req, res) => {
  try {
    const saved = await loadCredentials();
    return res.json(publicSession(saved));
  } catch (error) {
    console.error('mikrotik session:', error.code || error.message);
    return res.status(500).json({
      success: false,
      message: 'Gagal membaca kredensial MikroTik',
    });
  }
});

router.post('/connect', async (req, res) => {
  try {
    const useSaved = req.body?.useSaved === true && (req.body?.password == null || req.body?.password === '');
    let target;
    if (useSaved) {
      target = await loadCredentials();
      if (!target) {
        return res.status(400).json({
          success: false,
          message: 'Belum ada kredensial MikroTik tersimpan.',
        });
      }
    } else {
      const host = typeof req.body?.host === 'string' ? req.body.host.trim() : '';
      if (!validHost(host)) {
        return res.status(400).json({
          success: false,
          message: 'IP MikroTik tidak valid.',
        });
      }
      const creds = normalizeCredentials(req.body || {});
      target = {
        routerId: null,
        routerName: host,
        host,
        ...creds,
      };
    }

    await probeConnection(target);
    if (!useSaved) {
      await saveCredentials(target);
    }
    beginStreaming(target);
    return res.json({
      success: true,
      message: `Terhubung ke ${target.host}. Streaming dimulai.`,
      host: target.host,
      port: target.port,
      username: target.user,
      interface: target.iface,
    });
  } catch (error) {
    if (!error.errno && !error.code && error.message && /wajib|tidak valid|interface/i.test(error.message)) {
      return res.status(400).json({
        success: false,
        message: validationMessage(error),
      });
    }
    if (error.code && String(error.code).startsWith('ER_')) {
      console.error('mikrotik connect:', error.code);
      return res.status(500).json({
        success: false,
        message: 'Gagal menyimpan kredensial MikroTik',
      });
    }
    const mapped = classifyConnectError(error, req.body?.password);
    return res.status(mapped.status).json({
      success: false,
      message: mapped.message,
    });
  }
});

module.exports = router;
