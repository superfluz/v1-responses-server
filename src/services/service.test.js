import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSSEBlock, handleModelEvent } from './service.js';

describe('parseSSEBlock', () => {
  it('returns null for empty block', () => {
    assert.equal(parseSSEBlock(''), null);
    assert.equal(parseSSEBlock('   '), null);
  });

  it('parses event name and JSON data', () => {
    const block = 'event: response.output_text.delta\ndata: {"delta":"hello"}';
    const result = parseSSEBlock(block);
    assert.deepStrictEqual(result, {
      eventName: 'response.output_text.delta',
      data: { delta: 'hello' }
    });
  });

  it('parses [DONE] data', () => {
    const block = 'event: done\ndata: [DONE]';
    const result = parseSSEBlock(block);
    assert.deepStrictEqual(result, {
      eventName: 'done',
      data: '[DONE]'
    });
  });

  it('returns null for block with no data lines', () => {
    const block = 'event: something\n: comment';
    assert.equal(parseSSEBlock(block), null);
  });

  it('returns null for invalid JSON data', () => {
    const block = 'event: test\ndata: {broken json';
    assert.equal(parseSSEBlock(block), null);
  });

  it('joins multiple data lines', () => {
    const block = 'event: test\ndata: {"a":\ndata: 1}';
    const result = parseSSEBlock(block);
    assert.deepStrictEqual(result, {
      eventName: 'test',
      data: { a: 1 }
    });
  });

  it('works without event line', () => {
    const block = 'data: {"x":true}';
    const result = parseSSEBlock(block);
    assert.deepStrictEqual(result, {
      eventName: '',
      data: { x: true }
    });
  });
});

describe('handleModelEvent', () => {
  function createMockSSE() {
    const sent = [];
    let doneCalled = false;
    let errorPayload = null;

    return {
      send: (payload) => sent.push(payload),
      done: () => {
        doneCalled = true;
      },
      error: (msg, detail) => {
        errorPayload = { msg, detail };
      },
      get sent() {
        return sent;
      },
      get doneCalled() {
        return doneCalled;
      },
      get errorPayload() {
        return errorPayload;
      }
    };
  }

  it('does nothing for null event', () => {
    const sse = createMockSSE();
    handleModelEvent(null, sse);
    assert.equal(sse.sent.length, 0);
    assert.equal(sse.doneCalled, false);
  });

  it('returns early for [DONE] data without calling done', () => {
    const sse = createMockSSE();
    handleModelEvent({ eventName: 'done', data: '[DONE]' }, sse);
    assert.equal(sse.sent.length, 0);
    assert.equal(sse.doneCalled, false);
  });

  it('sends reasoning delta', () => {
    const sse = createMockSSE();
    handleModelEvent(
      { eventName: 'response.reasoning_summary_text.delta', data: { delta: 'thinking...' } },
      sse
    );
    assert.deepStrictEqual(sse.sent[0], { type: 'reasoning', delta: 'thinking...' });
  });

  it('sends content delta', () => {
    const sse = createMockSSE();
    handleModelEvent({ eventName: 'response.output_text.delta', data: { delta: 'hello' } }, sse);
    assert.deepStrictEqual(sse.sent[0], { type: 'content', delta: 'hello' });
  });

  it('sends completed event without calling done', () => {
    const sse = createMockSSE();
    handleModelEvent({ eventName: 'response.completed', data: {} }, sse);
    assert.deepStrictEqual(sse.sent[0], { type: 'responses.completed' });
    assert.equal(sse.doneCalled, false);
  });

  it('sends error on response.failed', () => {
    const sse = createMockSSE();
    handleModelEvent({ eventName: 'response.failed', data: { error: 'bad request' } }, sse);
    assert.deepStrictEqual(sse.errorPayload, {
      msg: 'Model response failed',
      detail: 'bad request'
    });
  });

  it('sends incomplete and calls done', () => {
    const sse = createMockSSE();
    handleModelEvent({ eventName: 'response.incomplete', data: { reason: 'timeout' } }, sse);
    assert.deepStrictEqual(sse.sent[0], { type: 'incomplete', detail: { reason: 'timeout' } });
    assert.equal(sse.doneCalled, true);
  });

  it('ignores unknown events', () => {
    const sse = createMockSSE();
    handleModelEvent({ eventName: 'response.unknown', data: {} }, sse);
    assert.equal(sse.sent.length, 0);
    assert.equal(sse.doneCalled, false);
  });
});
