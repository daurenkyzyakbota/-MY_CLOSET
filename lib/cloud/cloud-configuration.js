/** Configuration failures are temporary; later checks may recover without reload. */
export function createCloudConfigurationReader({ fetchStatus, onResult, onError, timeoutMs = 15000 }) {
  let sequence = 0;
  let closed = false;
  let active = null;
  return {
    async check() {
      if (closed) return null;
      const ticket = ++sequence;
      active?.abort();
      const controller = new AbortController();
      active = controller;
      const timer = setTimeout(() => {
        controller.abort(new DOMException('Проверка подключения заняла слишком много времени.', 'TimeoutError'));
      }, timeoutMs);
      try {
        const result = await fetchStatus({ signal: controller.signal });
        if (closed || ticket !== sequence) return null;
        onResult(result);
        return result;
      } catch (error) {
        if (!closed && ticket === sequence) onError(error);
        return null;
      } finally {
        clearTimeout(timer);
        if (active === controller) active = null;
      }
    },
    close() {
      closed = true;
      sequence++;
      active?.abort();
      active = null;
    },
  };
}
