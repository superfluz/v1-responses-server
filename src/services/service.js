export function requestModel(input, signal) {
  const apiKey = process.env.API_KEY;
  const modelBaseUrl = process.env.MODEL_BASE_URL?.trim().replace(/\/+$/, '');
  const modelName = process.env.MODEL_NAME?.trim();

  if (!apiKey) {
    throw new Error('API_KEY wajib diisi untuk akses model cloud');
  }

  if (!modelBaseUrl) {
    throw new Error('MODEL_BASE_URL wajib diisi');
  }

  if (!modelName) {
    throw new Error('MODEL_NAME wajib diisi');
  }

  return fetch(`${modelBaseUrl}/v1/responses`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    signal,
    body: JSON.stringify({
      model: modelName,
      input,
      stream: true,
      reasoning: {
        effort: 'medium',
        summary: 'auto'
      }
    })
  });
}

export function parseSSEBlock(block) {
  if (!block.trim()) return null;

  const lines = block.split(/\r?\n/);

  let eventName = '';
  const dataLines = [];

  for (const line of lines) {
    if (line.startsWith('event:')) {
      eventName = line.slice('event:'.length).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trim());
    }
  }

  if (dataLines.length === 0) return null;

  const rawData = dataLines.join('\n');

  if (rawData === '[DONE]') {
    return {
      eventName,
      data: '[DONE]'
    };
  }

  try {
    return {
      eventName,
      data: JSON.parse(rawData)
    };
  } catch {
    return null;
  }
}

export function handleModelEvent(parsedEvent, sendSSE) {
  if (!parsedEvent) return;

  const { eventName, data } = parsedEvent;

  if (data === '[DONE]') {
    sendSSE.done();
    return;
  }

  switch (eventName) {
    case 'response.reasoning_summary_text.delta': {
      sendSSE.send({
        type: 'reasoning',
        delta: data.delta || ''
      });
      break;
    }

    case 'response.output_text.delta': {
      sendSSE.send({
        type: 'content',
        delta: data.delta || ''
      });
      break;
    }

    case 'response.completed': {
      sendSSE.send({
        type: 'responses.completed' // This is the type of event
        // detail: data // This is the actual data payload
      });
      sendSSE.done();
      break;
    }

    case 'response.failed': {
      sendSSE.error('Model response failed', data.error || data);
      break;
    }

    case 'response.incomplete': {
      sendSSE.send({
        type: 'incomplete',
        detail: data
      });

      sendSSE.done();
      break;
    }

    default: {
      /**
       * Event lain diabaikan.
       *
       * Kalau mau debug, bisa aktifkan ini:
       *
       * sendSSE.send({
       *   type: 'debug',
       *   event: eventName,
       *   data
       * });
       */
      break;
    }
  }
}

export async function streamModelToClient({
  upstreamResponse,
  res,
  sendSSE,
  controller
}) {
  const reader = upstreamResponse.body.getReader();
  const decoder = new TextDecoder('utf-8');

  let buffer = '';

  while (true) {
    if (res.destroyed || res.writableEnded) {
      controller.abort();
      break;
    }

    const { done, value } = await reader.read();

    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() || '';

    for (const block of blocks) {
      const parsedEvent = parseSSEBlock(block);
      handleModelEvent(parsedEvent, sendSSE);
    }
  }

  buffer += decoder.decode();

  if (buffer.trim()) {
    const parsedEvent = parseSSEBlock(buffer);
    handleModelEvent(parsedEvent, sendSSE);
  }
}
