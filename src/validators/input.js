export function normalizeInput({ prompt, input, messages }) {
  if (input !== undefined) {
    return normalizeInputValue(input, 'Input');
  }

  if (messages !== undefined) {
    return normalizeInputValue(messages, 'Messages');
  }

  if (prompt && typeof prompt === 'string') {
    return {
      ok: true,
      value: prompt
    };
  }

  return {
    ok: false,
    error: 'Prompt wajib diisi sebagai string, atau gunakan input/messages string/array message'
  };
}

function normalizeInputValue(value, fieldName) {
  if (typeof value === 'string' && value.trim()) {
    return {
      ok: true,
      value
    };
  }

  if (Array.isArray(value) && value.length > 0) {
    const invalidMessage = value.find((message) => {
      return (
        !message ||
        typeof message !== 'object' ||
        typeof message.role !== 'string' ||
        typeof message.content !== 'string'
      );
    });

    if (!invalidMessage) {
      return {
        ok: true,
        value
      };
    }
  }

  return {
    ok: false,
    error: `${fieldName} wajib berupa string atau array message dengan role dan content string`
  };
}
