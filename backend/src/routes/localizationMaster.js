const express = require('express');
const config = require('../config');
const {
  cancelIndexTtsRuntimeInstall,
  inspectIndexTtsRuntime,
  inspectIndexTtsJob,
  muxLocalizedVideo,
  runIndexTtsDialogue,
  startIndexTtsRuntimeInstall,
  writeLocalizationSubtitle,
} = require('../services/localizationMaster');

const router = express.Router();

router.use((req, res, next) => {
  const controller = new AbortController();
  const abort = () => {
    if (!controller.signal.aborted) controller.abort(Object.assign(new Error('client_disconnected'), { code: 'request_aborted' }));
  };
  const cleanup = () => {
    req.off('aborted', abort);
    res.off('close', onClose);
    res.off('finish', cleanup);
  };
  const onClose = () => {
    if (!res.writableEnded) abort();
    cleanup();
  };
  req.t8AbortSignal = controller.signal;
  req.on('aborted', abort);
  res.on('close', onClose);
  res.on('finish', cleanup);
  next();
});

function t8BaseUrl(req) {
  return `${req.protocol}://${req.get('host') || `127.0.0.1:${config.PORT}`}`;
}

router.get('/runtime', async (req, res) => {
  try {
    const data = await inspectIndexTtsRuntime();
    return res.json({ success: true, data });
  } catch (error) {
    return res.status(400).json({ success: false, code: error?.code || 'LOCALIZATION_RUNTIME_FAILED', error: error?.message || String(error) });
  }
});

router.post('/runtime/install', async (req, res) => {
  try {
    if (req.body?.modelLicenseConfirmed !== true) {
      return res.status(409).json({ success: false, code: 'INDEXTTS25_LICENSE_NOT_CONFIRMED', error: '必须先阅读并确认 IndexTTS 2.5 模型许可。' });
    }
    const data = startIndexTtsRuntimeInstall(req.body || {});
    return res.status(202).json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, code: error?.code || 'LOCALIZATION_INSTALL_FAILED', error: error?.message || String(error) });
  }
});

router.post('/runtime/cancel', async (_req, res) => {
  try {
    return res.json({ success: true, data: cancelIndexTtsRuntimeInstall() });
  } catch (error) {
    return res.status(500).json({ success: false, code: error?.code || 'LOCALIZATION_INSTALL_CANCEL_FAILED', error: error?.message || String(error) });
  }
});

router.post('/tts', async (req, res) => {
  try {
    if (req.body?.modelLicenseConfirmed !== true) {
      return res.status(409).json({ success: false, code: 'INDEXTTS25_LICENSE_NOT_CONFIRMED', error: '必须先确认 IndexTTS 2.5 模型许可，才会启动本地推理。' });
    }
    const data = await runIndexTtsDialogue(req.body || {}, {
      t8BaseUrl: t8BaseUrl(req),
      signal: req.t8AbortSignal,
      onProgress: (progress) => {
        // Durable progress is owned by the Canvas Run ledger. This callback keeps
        // the direct Worker API extensible without opening a ComfyUI/WebSocket path.
        req.localizationProgress = progress;
      },
    });
    return res.json({ success: true, data });
  } catch (error) {
    return res.status(Number(error?.status) || 500).json({ success: false, code: error?.code || 'LOCALIZATION_TTS_FAILED', error: error?.message || String(error) });
  }
});

router.get('/tts/jobs/:jobId', async (req, res) => {
  try {
    const data = await inspectIndexTtsJob(req.params.jobId);
    return res.json({ success: true, data });
  } catch (error) {
    return res.status(Number(error?.status) || 500).json({ success: false, code: error?.code || 'LOCALIZATION_TTS_JOB_FAILED', error: error?.message || String(error) });
  }
});

router.post('/mux', async (req, res) => {
  try {
    const data = await muxLocalizedVideo(req.body || {}, { t8BaseUrl: t8BaseUrl(req), signal: req.t8AbortSignal });
    return res.json({ success: true, data });
  } catch (error) {
    return res.status(Number(error?.status) || 500).json({ success: false, code: error?.code || 'LOCALIZATION_MUX_FAILED', error: error?.message || String(error) });
  }
});

router.post('/subtitle', async (req, res) => {
  try {
    const data = await writeLocalizationSubtitle(req.body || {});
    return res.json({ success: true, data });
  } catch (error) {
    return res.status(Number(error?.status) || 400).json({ success: false, code: error?.code || 'LOCALIZATION_SUBTITLE_FAILED', error: error?.message || String(error) });
  }
});

module.exports = router;
