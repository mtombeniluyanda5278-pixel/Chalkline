import { test } from "node:test";
import assert from "node:assert/strict";
import { readTimetablePhoto, PHOTO_MAX_BYTES } from "./timetablePhoto.js";
const image =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
const settings = { key: "test-only", model: "test-vision" };
const result = {
  text: "Monday: Mathematics 08:00 [unreadable]",
  warnings: ["Monday end time is covered."],
  entries: [
    { day: 1, start: "08:00", end: "", title: "Mathematics", room: "" },
  ],
};
const respond =
  (payload: unknown): typeof fetch =>
  async () =>
    new Response(JSON.stringify(payload));
const envelope = (body: unknown) => ({
  status: "completed",
  output: [
    {
      type: "message",
      content: [{ type: "output_text", text: JSON.stringify(body) }],
    },
  ],
});
test("photo reader preserves unreadable fields and returns reviewable text without inventing times", async () => {
  const value = await readTimetablePhoto(
    image,
    "8A",
    settings,
    async (url, options) => {
      assert.equal(url, "https://api.openai.com/v1/responses");
      const request = JSON.parse(String(options?.body));
      assert.equal(request.store, false);
      assert.equal(request.text.format.strict, true);
      assert.equal(request.input[0].content[1].image_url, image);
      assert.match(request.instructions, /Do not assume 45 minutes/);
      return new Response(JSON.stringify(envelope(result)));
    },
  );
  assert.equal(value.entries[0]?.end, "");
  assert.match(value.warnings.join(" "), /covered/);
  assert.match(value.warnings.join(" "), /missing fields/);
});
test("photo reader rejects unsupported, disguised and oversized files before calling the provider", async () => {
  const never: typeof fetch = async () => {
    throw new Error("must not call provider");
  };
  for (const invalid of [
    "data:image/svg+xml;base64,PHN2Zz4=",
    "data:image/png;base64,aGVsbG8=",
    image.replace("image/png", "image/jpeg"),
  ])
    await assert.rejects(readTimetablePhoto(invalid, "8A", settings, never), {
      statusCode: 400,
    });
  await assert.rejects(
    readTimetablePhoto(
      "data:image/png;base64," +
        Buffer.alloc(PHOTO_MAX_BYTES + 1).toString("base64"),
      "8A",
      settings,
      never,
    ),
    { statusCode: 413 },
  );
  await assert.rejects(
    readTimetablePhoto(image, "8A", { ...settings, key: "" }, never),
    { statusCode: 503 },
  );
});
test("provider errors, refusals, incomplete and malformed output do not become timetable drafts", async () => {
  for (const payload of [
    { status: "incomplete", output: [] },
    {
      status: "completed",
      output: [{ type: "message", content: [{ type: "refusal" }] }],
    },
    envelope({ ...result, entries: [{ ...result.entries[0], day: 9 }] }),
  ])
    await assert.rejects(
      readTimetablePhoto(image, "8A", settings, respond(payload)),
      { statusCode: 422 },
    );
  await assert.rejects(
    readTimetablePhoto(
      image,
      "8A",
      settings,
      async () => new Response("no", { status: 429 }),
    ),
    { statusCode: 502 },
  );
});
