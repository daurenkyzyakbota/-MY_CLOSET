export async function socialRequest(action, input = {}, { userId, signal } = {}) {
  let response;
  try {
    response = await fetch('/api/social', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(userId ? { 'X-MyCloset-Account': userId } : {}),
      },
      body: JSON.stringify({ action, input }),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(30000)])
        : AbortSignal.timeout(30000),
    });
  } catch (cause) {
    if (signal?.aborted) throw cause;
    throw new Error(
      'Не удалось связаться с сообществом. Проверьте подключение и повторите попытку.',
    );
  }
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error('Сервер вернул неполный ответ. Повторите попытку.');
  }
  if (!response.ok) {
    const error = new Error(
      typeof result.error === 'string' ? result.error : 'Не удалось выполнить действие.',
    );
    error.status = response.status;
    error.code = result.code || '';
    const retryAfter = result.retryAfter ?? Number(response.headers.get('Retry-After'));
    if (Number.isInteger(retryAfter) && retryAfter > 0 && retryAfter <= 86400)
      error.retryAfter = retryAfter;
    throw error;
  }
  return result.data;
}
