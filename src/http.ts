import { z } from "zod";
import type { FastifyRequest } from "fastify";
import { consumeRateLimit, type buckets } from "./rateLimit.js";
export function failure(statusCode: number, message: string) {
  return Object.assign(new Error(message), { statusCode });
}
export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw failure(400, "Invalid request. Check the supplied fields.");
  return result.data;
}
export function itemId(req: FastifyRequest) {
  return parse(z.object({ id: z.uuid() }), req.params).id;
}
export async function limit(name: keyof typeof buckets, identity: string) {
  const result = await consumeRateLimit(name, identity);
  if (!result.allowed)
    throw Object.assign(failure(429, "Too many requests. Try again later."), {
      retryAfter: result.retryAfterSec,
    });
}
