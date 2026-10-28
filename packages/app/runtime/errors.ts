export function reportHostError(error: unknown): void {
  if (typeof globalThis.reportError === 'function') globalThis.reportError(error);
  else
    queueMicrotask(() => {
      throw error;
    });
}

/** A failing observer is reported once to the host, never recursively to itself. */
export function reportApplicationError(error: unknown, handler?: (error: unknown) => void): void {
  if (!handler) {
    reportHostError(error);
    return;
  }
  try {
    const result = handler(error) as unknown;
    if (result && typeof (result as PromiseLike<unknown>).then === 'function')
      void Promise.resolve(result).catch((observerError) => {
        reportHostError(
          new AggregateError([error, observerError], 'Application error observer failed'),
        );
      });
  } catch (observerError) {
    reportHostError(
      new AggregateError([error, observerError], 'Application error observer failed'),
    );
  }
}
