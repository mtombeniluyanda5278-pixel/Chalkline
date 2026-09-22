import { addAbortSignal, Readable } from "node:stream";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectVersionsCommand,
} from "@aws-sdk/client-s3";
import { config } from "./config.js";
import { failure } from "./http.js";
export interface ObjectStore {
  put(
    key: string,
    body: Buffer | Readable,
    size?: number,
    signal?: AbortSignal,
  ): Promise<void>;
  stream(key: string, signal?: AbortSignal): Promise<Readable>;
  get(key: string, signal?: AbortSignal): Promise<Buffer>;
  delete(key: string): Promise<void>;
}
export function storageConfigured() {
  return Boolean(
    config.STORAGE_ENDPOINT &&
    config.STORAGE_BUCKET &&
    config.STORAGE_ACCESS_KEY_ID &&
    config.STORAGE_SECRET_ACCESS_KEY,
  );
}
let instance: ObjectStore | undefined;
export function objectStore(): ObjectStore {
  if (instance) return instance;
  if (!storageConfigured())
    throw failure(503, "File storage is not configured.");
  const client = new S3Client({
    endpoint: config.STORAGE_ENDPOINT,
    region: config.STORAGE_REGION,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.STORAGE_ACCESS_KEY_ID!,
      secretAccessKey: config.STORAGE_SECRET_ACCESS_KEY!,
    },
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    maxAttempts: 3,
  });
  const Bucket = config.STORAGE_BUCKET!;
  instance = {
    async put(Key, Body, size, signal) {
      const cancellation = AbortSignal.any([
        AbortSignal.timeout(60000),
        ...(signal ? [signal] : []),
      ]);
      cancellation.throwIfAborted();
      if (Body instanceof Readable) addAbortSignal(cancellation, Body);
      await client.send(
        new PutObjectCommand({
          Bucket,
          Key,
          Body,
          ContentLength:
            size ?? (Buffer.isBuffer(Body) ? Body.length : undefined),
          ContentType: "application/octet-stream",
        }),
        { abortSignal: cancellation },
      );
      cancellation.throwIfAborted();
    },
    async stream(Key, signal) {
      const cancellation = AbortSignal.any([
        AbortSignal.timeout(60000),
        ...(signal ? [signal] : []),
      ]);
      cancellation.throwIfAborted();
      const r = await client.send(new GetObjectCommand({ Bucket, Key }), {
        abortSignal: cancellation,
      });
      if (!r.Body) throw failure(404, "File unavailable.");
      if (Number(r.ContentLength) > config.UPLOAD_MAX_BYTES) {
        (r.Body as Readable).destroy();
        throw failure(413, "File too large.");
      }
      return addAbortSignal(cancellation, r.Body as Readable);
    },
    async get(Key, signal) {
      const chunks: Buffer[] = [];
      let size = 0;
      const stream = await this.stream(Key, signal);
      for await (const chunk of stream) {
        size += chunk.length;
        if (size > config.UPLOAD_MAX_BYTES) {
          stream.destroy();
          throw failure(413, "File too large.");
        }
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    },
    async delete(Key) {
      // B2 and versioned S3 buckets retain old versions after a simple DELETE.
      // Purge exact-key versions and delete markers; never delete prefix neighbours.

      for (let page = 0; page < 100; page++) {
        const listed = await client.send(
          new ListObjectVersionsCommand({ Bucket, Prefix: Key, MaxKeys: 1000 }),
          { abortSignal: AbortSignal.timeout(60000) },
        );
        const versions = [
          ...(listed.Versions ?? []),
          ...(listed.DeleteMarkers ?? []),
        ].filter((v) => v.Key === Key && v.VersionId);
        if (!versions.length) return;
        for (const version of versions)
          await client.send(
            new DeleteObjectCommand({
              Bucket,
              Key,
              VersionId: version.VersionId,
            }),
            { abortSignal: AbortSignal.timeout(60000) },
          );
      }
      throw new Error(
        "Object version cleanup will resume on the next maintenance pass.",
      );
    },
  };
  return instance;
}
