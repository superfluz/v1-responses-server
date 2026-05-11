export function prepareSSEHeaders(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }
}

export function createSSESender(res) {
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
      detail
    });

    done();
  };

  return {
    send,
    done,
    error
  };
}
