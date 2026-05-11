import { Router } from 'express';

import { requestModel, streamModelToClient } from '../services/service.js';
import { createSSESender, prepareSSEHeaders } from '../utils/sse.js';
import { normalizeInput } from '../validators/input.js';

const router = Router();

router.post('/', async (req, res) => {
  const { prompt, input, messages } = req.body || {};
  const normalizedInput = normalizeInput({ prompt, input, messages });

  if (!normalizedInput.ok) {
    return res.status(400).json({
      error: normalizedInput.error
    });
  }

  const controller = new AbortController();
  const sendSSE = createSSESender(res);

  let streamFinished = false;

  res.on('close', () => {
    if (!streamFinished) {
      controller.abort();
    }
  });

  try {
    const upstreamResponse = await requestModel(normalizedInput.value, controller.signal);

    if (!upstreamResponse.ok) {
      const errorText = await upstreamResponse.text().catch(() => '');

      return res.status(upstreamResponse.status).json({
        error: 'Request ke model gagal',
        status: upstreamResponse.status,
        detail: errorText
      });
    }

    if (!upstreamResponse.body) {
      return res.status(500).json({
        error: 'Response body dari model kosong'
      });
    }

    prepareSSEHeaders(res);

    await streamModelToClient({
      upstreamResponse,
      res,
      sendSSE,
      controller
    });

    streamFinished = true;
    sendSSE.done();

    if (!res.destroyed && !res.writableEnded) {
      res.end();
    }
  } catch (error) {
    streamFinished = true;

    if (error.name === 'AbortError') {
      console.log('Stream dibatalkan karena client disconnect');
      return;
    }

    console.error('Error /api/responses:', error);

    if (!res.headersSent) {
      return res.status(500).json({
        error: 'Internal server error',
        detail: error.message
      });
    }

    sendSSE.error('Internal server error', error.message);

    if (!res.destroyed && !res.writableEnded) {
      res.end();
    }
  }
});

export default router;
