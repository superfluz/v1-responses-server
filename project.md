Pecah backend menjadi beberapa function seperti:

1. `createSSESender(res)` → khusus kirim SSE ke frontend.
2. `parseSSEBlock(block)` → parse event SSE dari API.
3. `handleOllamaEvent(parsedEvent, sendSSE)` → mapping event API ke format frontend.
4. `streamOllamaToClient(upstreamResponse, res, sendSSE, controller)` → baca stream dari API.
5. Route `/api/responses` hanya fokus validasi request dan orchestration.

Berikut versi refactor-nya.

---

## Versi backend refactor

```js
app.post('/api/responses', async (req, res) => {
  const { prompt } = req.body || {};

  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({
      error: 'Prompt wajib diisi dan harus berupa string',
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
    const upstreamResponse = await requestOllama(prompt, controller.signal);

    if (!upstreamResponse.ok) {
      const errorText = await upstreamResponse.text().catch(() => '');

      return res.status(upstreamResponse.status).json({
        error: 'Request ke API gagal',
        status: upstreamResponse.status,
        detail: errorText,
      });
    }

    if (!upstreamResponse.body) {
      return res.status(500).json({
        error: 'Response body dari API kosong',
      });
    }

    prepareSSEHeaders(res);

    await streamOllamaToClient({
      upstreamResponse,
      res,
      sendSSE,
      controller,
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
        detail: error.message,
      });
    }

    sendSSE.error('Internal server error', error.message);

    if (!res.destroyed && !res.writableEnded) {
      res.end();
    }
  }
});
```

---

# 1. Function request ke Ollama

```js
function requestOllama(prompt, signal) {
  return fetch('http://localhost:11434/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    signal,
    body: JSON.stringify({
      model: 'gpt-oss:20b-cloud',
      input: prompt,
      stream: true,
      reasoning: {
        effort: 'medium',
        summary: 'auto',
      },
    }),
  });
}
```

---

# 2. Function set header SSE

```js
function prepareSSEHeaders(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }
}
```

---

# 3. Function sender SSE

Ini supaya tidak perlu menulis manual:

```js
res.write(`data: ${JSON.stringify(...)}\n\n`);
```

berulang-ulang.

```js
function createSSESender(res) {
  let doneSent = false;

  const send = (payload) => {
    if (res.destroyed || res.writableEnded) return;

    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  const done = () => {
    if (res.destroyed || res.writableEnded) return;
    if (doneSent) return;

    doneSent = true;
    res.write('data: [DONE]\n\n');
  };

  const error = (message, detail = null) => {
    send({
      type: 'error',
      error: message,
      detail,
    });

    done();
  };

  return {
    send,
    done,
    error,
  };
}
```

---

# 4. Function parsing SSE block dari Ollama

Ollama mengirim format kira-kira seperti ini:

```txt
event: response.output_text.delta
data: {"delta":"Halo"}
```

Maka kita parse jadi object.

```js
function parseSSEBlock(block) {
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
      data: '[DONE]',
    };
  }

  try {
    return {
      eventName,
      data: JSON.parse(rawData),
    };
  } catch {
    return null;
  }
}
```

---

# 5. Function handle event dari Ollama

Di sinilah kamu ubah event Ollama menjadi format frontend:

```js
function handleOllamaEvent(parsedEvent, sendSSE) {
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
        delta: data.delta || '',
      });
      break;
    }

    case 'response.output_text.delta': {
      sendSSE.send({
        type: 'content',
        delta: data.delta || '',
      });
      break;
    }

    case 'response.completed': {
      sendSSE.done();
      break;
    }

    case 'response.failed': {
      sendSSE.error('Ollama response failed', data.error || data);
      break;
    }

    case 'response.incomplete': {
      sendSSE.send({
        type: 'incomplete',
        detail: data,
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
```

---

# 6. Function stream dari Ollama ke client

Function ini fokus membaca stream dari Ollama, memecahnya berdasarkan blok SSE, lalu meneruskan ke handler.

```js
async function streamOllamaToClient({ upstreamResponse, res, sendSSE, controller }) {
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
      handleOllamaEvent(parsedEvent, sendSSE);
    }
  }

  buffer += decoder.decode();

  if (buffer.trim()) {
    const parsedEvent = parseSSEBlock(buffer);
    handleOllamaEvent(parsedEvent, sendSSE);
  }
}
```

---

# Full code versi rapi

Kalau digabung, jadinya seperti ini:

```js
app.post('/api/ollama', async (req, res) => {
  const { prompt } = req.body || {};

  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({
      error: 'Prompt wajib diisi dan harus berupa string',
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
    const upstreamResponse = await requestOllama(prompt, controller.signal);

    if (!upstreamResponse.ok) {
      const errorText = await upstreamResponse.text().catch(() => '');

      return res.status(upstreamResponse.status).json({
        error: 'Request ke Ollama gagal',
        status: upstreamResponse.status,
        detail: errorText,
      });
    }

    if (!upstreamResponse.body) {
      return res.status(500).json({
        error: 'Response body dari Ollama kosong',
      });
    }

    prepareSSEHeaders(res);

    await streamOllamaToClient({
      upstreamResponse,
      res,
      sendSSE,
      controller,
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
        detail: error.message,
      });
    }

    sendSSE.error('Internal server error', error.message);

    if (!res.destroyed && !res.writableEnded) {
      res.end();
    }
  }
});

function requestOllama(prompt, signal) {
  return fetch('http://localhost:11434/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    signal,
    body: JSON.stringify({
      model: 'gpt-oss:20b-cloud',
      input: prompt,
      stream: true,
      reasoning: {
        effort: 'medium',
        summary: 'auto',
      },
    }),
  });
}

function prepareSSEHeaders(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }
}

function createSSESender(res) {
  let doneSent = false;

  const send = (payload) => {
    if (res.destroyed || res.writableEnded) return;

    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  const done = () => {
    if (res.destroyed || res.writableEnded) return;
    if (doneSent) return;

    doneSent = true;
    res.write('data: [DONE]\n\n');
  };

  const error = (message, detail = null) => {
    send({
      type: 'error',
      error: message,
      detail,
    });

    done();
  };

  return {
    send,
    done,
    error,
  };
}

function parseSSEBlock(block) {
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
      data: '[DONE]',
    };
  }

  try {
    return {
      eventName,
      data: JSON.parse(rawData),
    };
  } catch {
    return null;
  }
}

function handleOllamaEvent(parsedEvent, sendSSE) {
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
        delta: data.delta || '',
      });
      break;
    }

    case 'response.output_text.delta': {
      sendSSE.send({
        type: 'content',
        delta: data.delta || '',
      });
      break;
    }

    case 'response.completed': {
      sendSSE.done();
      break;
    }

    case 'response.failed': {
      sendSSE.error('Ollama response failed', data.error || data);
      break;
    }

    case 'response.incomplete': {
      sendSSE.send({
        type: 'incomplete',
        detail: data,
      });

      sendSSE.done();
      break;
    }

    default: {
      break;
    }
  }
}

async function streamOllamaToClient({ upstreamResponse, res, sendSSE, controller }) {
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
      handleOllamaEvent(parsedEvent, sendSSE);
    }
  }

  buffer += decoder.decode();

  if (buffer.trim()) {
    const parsedEvent = parseSSEBlock(buffer);
    handleOllamaEvent(parsedEvent, sendSSE);
  }
}
```

---

## Struktur file yang lebih bagus

Kalau project makin besar, bisa dipisah seperti ini:

```txt
src/
├─ server.js
├─ routes/
│  └─ route.js
├─ services/
│  └─ service.js
└─ utils/
   └─ sse.js
```

Contoh pembagian:

```txt
routes/route.js
```

isi route `/api/responses`.

```txt
services/service.js
```

isi:

```js
requestOllama();
streamOllamaToClient();
handleOllamaEvent();
parseSSEBlock();
```

```txt
utils/sse.js
```

isi:

```js
prepareSSEHeaders();
createSSESender();
```

---

Bagian paling penting adalah route jangan terlalu penuh. Route cukup mengatur alur:

```js
validasi prompt
request ke Ollama
set header SSE
stream response
handle error
```

Detail parsing dan pengiriman SSE dipindahkan ke function terpisah.
