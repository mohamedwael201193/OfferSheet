// Receipts: every claim traces to an exact call.
// A receipt carries: operation, requestHash (SHA-256 of method + URL, or of the
// MCP tool + JSON args), response requestId (when the upstream returns one — null
// when it does not, never invented), resultCount, status, and timestamp.
// Keys are NEVER part of a hashed URL: the REST client sends the key only as an
// X-Api-Key header, and MCP args never contain keys.
import { createHash } from 'node:crypto';

export function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

export function requestHashFor(method, url) {
  return sha256(`${method} ${url}`);
}

export function argsHashFor(tool, args) {
  return sha256(`${tool} ${JSON.stringify(args)}`);
}

// Per-request receipt store. The live server keeps receipts in memory per verdict
// request and returns them in the verdict response; the repo manifest (bench +
// receipts.json) is updated only from recorded real runs by the operator — the
// server never writes to the repo.
export class ReceiptStore {
  constructor() {
    this.receipts = [];
  }

  add(entry) {
    const rec = {
      id: sha256(JSON.stringify(entry) + Date.now() + Math.random()).slice(0, 16),
      ...entry,
      recordedAt: new Date().toISOString(),
    };
    this.receipts.push(rec);
    return rec;
  }

  all() {
    return this.receipts;
  }

  // Machine-readable manifest shape (S3): claim -> requestHash -> requestId -> resultCount.
  toManifest() {
    return this.receipts.map((r) => ({
      claim: r.claim,
      operation: r.operation,
      requestHash: r.requestHash,
      requestId: r.requestId ?? null,
      resultCount: r.resultCount ?? null,
    }));
  }
}
