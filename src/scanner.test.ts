import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Socket } from "node:net";
import { once } from "node:events";
import { writeFile } from "node:fs/promises";
import { createClamAvScanner } from "./scanner.js";
import { privateTemp } from "./tempFiles.js";

async function fixture(
  reply: string | null,
  run: (
    scanner: ReturnType<typeof createClamAvScanner>,
    bytes: Buffer[],
  ) => Promise<void>,
) {
  const sockets = new Set<Socket>(),
    received: Buffer[] = [];
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("error", () => {});
    socket.on("close", () => sockets.delete(socket));
    let buffered = Buffer.alloc(0),
      command = false;
    socket.on("data", (chunk) => {
      buffered = Buffer.concat([buffered, Buffer.from(chunk)]);
      if (!command) {
        const end = buffered.indexOf(0);
        if (end < 0) return;
        const text = buffered.subarray(0, end).toString();
        buffered = buffered.subarray(end + 1);
        command = true;
        if (text === "zPING") {
          socket.end("PONG\0");
          return;
        }
        if (text !== "zINSTREAM") {
          socket.destroy();
          return;
        }
      }
      while (buffered.length >= 4) {
        const size = buffered.readUInt32BE();
        if (buffered.length < 4 + size) return;
        if (!size) {
          if (reply !== null) socket.end(reply);
          return;
        }
        received.push(Buffer.from(buffered.subarray(4, 4 + size)));
        buffered = buffered.subarray(4 + size);
      }
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const scanner = createClamAvScanner({
    host: "127.0.0.1",
    port: address.port,
    timeoutMs: 250,
    healthTimeoutMs: 250,
    maxBytes: 200000,
  });
  try {
    await run(scanner, received);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("private scanner frames the entire file and validates health and clean replies", async () => {
  await fixture("stream: OK\0", async (scanner, received) => {
    assert.equal(await scanner.health(), true);
    await privateTemp(async (path) => {
      const bytes = Buffer.alloc(150000, 65);
      await writeFile(path, bytes);
      assert.deepEqual(await scanner.scan(path), {
        engine: "clamav",
        privacy: "PRIVATE",
        status: "CLEAN",
      });
      assert.deepEqual(Buffer.concat(received), bytes);
      assert.ok(received.every((chunk) => chunk.length <= 65536));
    });
  });
});

for (const [name, reply, status] of [
  ["infection", "stream: Test.Signature FOUND\0", "INFECTED"],
  ["unterminated clean reply", "stream: OK", "ERROR"],
  ["multiple records", "stream: OK\0stream: Evil FOUND\0", "ERROR"],
  ["unrecognised clean reply", "OK\0", "ERROR"],
  ["oversized reply", "x".repeat(5000) + "\0", "ERROR"],
  ["timeout", null, "ERROR"],
] as const)
  test(`private scanner fails closed for ${name}`, async () => {
    await fixture(reply, async (scanner) =>
      privateTemp(async (path) => {
        await writeFile(path, "Teacher document");
        const result = await scanner.scan(path);
        assert.equal(result.status, status);
        assert.equal(result.privacy, "PRIVATE");
      }),
    );
  });

test("scanner cancels a stalled request and rejects files beyond its limit", async () => {
  await fixture(null, async (scanner) =>
    privateTemp(async (path) => {
      await writeFile(path, "Teacher document");
      const controller = new AbortController();
      const pending = scanner.scan(path, controller.signal);
      controller.abort();
      assert.equal((await pending).status, "ERROR");
      await writeFile(path, Buffer.alloc(200001));
      assert.equal((await scanner.scan(path)).status, "ERROR");
    }),
  );
});
