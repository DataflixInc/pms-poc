export type ServerErrorEventDetail = {
  title: string;
  message: string;
};

const SERVER_ERROR_EVENT = 'pms:server-error';
const serverErrorTarget = new EventTarget();

export function emitServerError(detail: ServerErrorEventDetail): void {
  serverErrorTarget.dispatchEvent(
    new CustomEvent(SERVER_ERROR_EVENT, { detail })
  );
}

export function onServerError(
  handler: (detail: ServerErrorEventDetail) => void
): () => void {
  const listener = (e: Event) => {
    const ce = e as CustomEvent<ServerErrorEventDetail>;
    handler(ce.detail);
  };
  serverErrorTarget.addEventListener(SERVER_ERROR_EVENT, listener);
  return () => serverErrorTarget.removeEventListener(SERVER_ERROR_EVENT, listener);
}

