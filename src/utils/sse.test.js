import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createSSESender } from './sse.js';

function createMockRes() {
  const chunks = [];
  return {
    destroyed: false,
    writableEnded: false,
    write(data) {
      chunks.push(data);
    },
    get chunks() {
      return chunks;
    }
  };
}

describe('createSSESender', () => {
  it('sends JSON payload as SSE data line', () => {
    const res = createMockRes();
    const sse = createSSESender(res);
    sse.send({ type: 'content', delta: 'hi' });
    assert.equal(res.chunks.length, 1);
    assert.equal(res.chunks[0], 'data: {"type":"content","delta":"hi"}\n\n');
  });

  it('sends [DONE] on done()', () => {
    const res = createMockRes();
    const sse = createSSESender(res);
    sse.done();
    assert.equal(res.chunks.length, 1);
    assert.equal(res.chunks[0], 'data: [DONE]\n\n');
  });

  it('only sends [DONE] once', () => {
    const res = createMockRes();
    const sse = createSSESender(res);
    sse.done();
    sse.done();
    assert.equal(res.chunks.length, 1);
  });

  it('does not write if res is destroyed', () => {
    const res = createMockRes();
    res.destroyed = true;
    const sse = createSSESender(res);
    sse.send({ type: 'test' });
    sse.done();
    assert.equal(res.chunks.length, 0);
  });

  it('does not write if res.writableEnded', () => {
    const res = createMockRes();
    res.writableEnded = true;
    const sse = createSSESender(res);
    sse.send({ type: 'test' });
    assert.equal(res.chunks.length, 0);
  });

  it('error() sends error payload then done', () => {
    const res = createMockRes();
    const sse = createSSESender(res);
    sse.error('something broke', 'stack trace');
    assert.equal(res.chunks.length, 2);
    const errorPayload = JSON.parse(res.chunks[0].replace('data: ', '').trim());
    assert.deepStrictEqual(errorPayload, {
      type: 'error',
      error: 'something broke',
      detail: 'stack trace'
    });
    assert.equal(res.chunks[1], 'data: [DONE]\n\n');
  });
});
