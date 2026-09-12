import { test } from "node:test";
import assert from "node:assert/strict";
import { createAutosave } from "../autosave.js";

test("autosave serializes edits made while a save is in flight", async () => {
  let text = "initial",
    release;
  const calls = [];
  const save = createAutosave({
    read: () => ({ text }),
    revision: 1,
    onStatus: () => {},
    write: async (b) => {
      calls.push(b);
      if (calls.length === 1) await new Promise((r) => (release = r));
      return { item: { revision: b.revision + 1 } };
    },
  });
  text = "first";
  const pending = save.flush();
  await Promise.resolve();
  text = "second";
  release();
  await pending;
  assert.deepEqual(calls, [
    { text: "first", revision: 1 },
    { text: "second", revision: 2 },
  ]);
  assert.equal(save.dirty(), false);
  save.dispose();
});
test("conflict freezes automatic writes and preserves the user draft", async () => {
  let text = "initial",
    calls = 0;
  const states = [];
  const save = createAutosave({
    read: () => ({ text }),
    revision: 1,
    onStatus: (s) => states.push(s),
    write: async () => {
      calls++;
      throw Object.assign(new Error("conflict"), { status: 409 });
    },
  });
  text = "my unsaved work";
  await assert.rejects(save.flush());
  await assert.rejects(save.flush());
  assert.equal(calls, 1);
  assert.equal(text, "my unsaved work");
  assert.equal(save.dirty(), true);
  assert.equal(save.conflicted, true);
  save.dispose();
});
test("network failure retains dirty state and retry uses the original revision", async () => {
  let text = "a",
    calls = 0;
  const save = createAutosave({
    read: () => ({ text }),
    revision: 3,
    onStatus: () => {},
    write: async (b) => {
      calls++;
      assert.equal(b.revision, 3);
      if (calls === 1) throw new Error("offline");
      return { item: { revision: 4 } };
    },
  });
  text = "b";
  await assert.rejects(save.flush());
  assert.equal(save.dirty(), true);
  await save.flush();
  assert.equal(save.dirty(), false);
  save.dispose();
});
test("debounced autosave coalesces rapid typing and disposal cancels timers", async () => {
  let text = "a",
    calls = 0;
  const save = createAutosave({
    read: () => ({ text }),
    revision: 1,
    onStatus: () => {},
    delay: 10,
    write: async () => {
      calls++;
      return { item: { revision: 2 } };
    },
  });
  text = "b";
  save.changed();
  text = "c";
  save.changed();
  await new Promise((r) => setTimeout(r, 25));
  assert.equal(calls, 1);
  text = "d";
  save.changed();
  save.dispose();
  await new Promise((r) => setTimeout(r, 25));
  assert.equal(calls, 1);
});
