import { createConnection, type Socket } from 'node:net';
import { createReadStream } from 'node:fs';
import { once } from 'node:events';
import { config } from './config.js';
export type ScanResult = { status: 'CLEAN' | 'INFECTED' | 'SUSPICIOUS' | 'ERROR'; engine: string; privacy: 'PRIVATE'; detection?: string };
export interface PrivateScanner { privacy: 'PRIVATE'; scan(path: string, signal?: AbortSignal): Promise<ScanResult>; health(): Promise<boolean> }
export function createClamAvScanner(options: { host: string; port: number; timeoutMs: number; healthTimeoutMs: number; maxBytes: number }): PrivateScanner {
  async function request(command: string, timeout: number, send?: (socket: Socket, signal: AbortSignal) => Promise<void>, signal?: AbortSignal) {
    if (signal?.aborted) return null;
    return new Promise<string | null>(resolve => {
      const socket = createConnection({ host: options.host, port: options.port }), cancel = new AbortController();
      let response = '', finished = false, sent = !send;
      const finish = (value: string | null) => {
        if (finished) return;
        finished = true; clearTimeout(deadline); signal?.removeEventListener('abort', abort);
        cancel.abort(); socket.destroy(); resolve(value);
      };
      const abort = () => finish(null), deadline = setTimeout(abort, timeout);
      signal?.addEventListener('abort', abort, { once: true });
      socket.on('error', abort);
      socket.on('data', chunk => {
        // INSTREAM has one reply. Require its terminator and EOF, and reject unsolicited/extra records.
        if (!sent || response.length + chunk.length > 4096) return finish(null);
        response += chunk.toString('utf8');
      });
      socket.on('end', () => finish(sent && /^[^\0\r\n]+\0$/.test(response) ? response.slice(0, -1) : null));
      socket.on('close', () => { if (!finished) finish(null); });
      socket.on('connect', () => {
        void (async () => {
          if (finished) return;
          socket.write(command);
          if (send) { await send(socket, cancel.signal); sent = true; }
        })().catch(abort);
      });
    });
  }
  return {
    privacy: 'PRIVATE',
    async health() { return await request('zPING\0', options.healthTimeoutMs) === 'PONG'; },
    async scan(path, signal) {
      const result = await request('zINSTREAM\0', options.timeoutMs, async (socket, cancel) => {
        const input = createReadStream(path, { highWaterMark: 65536, signal: cancel });
        let bytes = 0;
        try {
          for await (const chunk of input) {
            bytes += chunk.length;
            if (bytes > options.maxBytes) throw new Error('Scan size limit');
            const header = Buffer.alloc(4); header.writeUInt32BE(chunk.length);
            if (!socket.write(Buffer.concat([header, chunk]))) await once(socket, 'drain', { signal: cancel });
          }
          if (cancel.aborted) throw new Error('Scan cancelled');
          socket.write(Buffer.alloc(4));
        } finally { input.destroy(); }
      }, signal);
      const base = { engine: 'clamav', privacy: 'PRIVATE' as const };
      if (result === 'stream: OK') return { ...base, status: 'CLEAN' };
      if (result && /^stream: .+ FOUND$/.test(result)) return { ...base, status: 'INFECTED', detection: result.slice(8, -6).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100) };
      return { ...base, status: 'ERROR' };
    },
  };
}
export function scanner(): PrivateScanner {
  if (config.MALWARE_SCANNER_MODE === 'clamav') return createClamAvScanner({ host: config.CLAMAV_HOST!, port: config.CLAMAV_PORT, timeoutMs: config.SCANNER_TIMEOUT_MS, healthTimeoutMs: config.SCANNER_HEALTH_TIMEOUT_MS, maxBytes: config.UPLOAD_MAX_BYTES });
  return {
    privacy: 'PRIVATE',
    async health() { return config.MALWARE_SCANNER_MODE === 'mock'; },
    async scan(path, signal) {
      if (config.MALWARE_SCANNER_MODE !== 'mock') return { status: 'ERROR', engine: 'disabled', privacy: 'PRIVATE' };
      let carry = '', infected = false, error = false, bytes = 0;
      try {
        for await (const b of createReadStream(path, { signal })) {
          bytes += b.length; if (bytes > config.UPLOAD_MAX_BYTES) throw new Error('Size limit');
          carry = (carry + b.toString()).slice(-100000); infected ||= carry.includes('EICAR-STANDARD-ANTIVIRUS-TEST-FILE'); error ||= carry.includes('CHIX_TEST_SCANNER_ERROR');
        }
      } catch { error = true; }
      return { status: error ? 'ERROR' : infected ? 'INFECTED' : 'CLEAN', engine: 'mock-test-only', privacy: 'PRIVATE', ...(infected ? { detection: 'test-signature' } : {}) };
    },
  };
}
