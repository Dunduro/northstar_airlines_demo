import { randomUUID } from 'node:crypto';

/** Inbound x-correlation-id is reused when it looks sane; otherwise a new one is minted. */
const VALID = /^[A-Za-z0-9._:-]{1,128}$/;

export function correlationId(header) {
  return typeof header === 'string' && VALID.test(header) ? header : randomUUID();
}
