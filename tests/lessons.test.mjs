import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
  setupTeaching,
  renderLessons,
  renderTimetables,
  lessonPath,
  resourcePanel,
} from "../lessons.js";
import { setupWorkspace, renderEditor, beforeLeave } from "../workspace.js";
let dom;
afterEach(async () => {
  await beforeLeave();
  dom?.window.close();
});
const directory = () => ({
  subjects: [{ id: "s", name: "Mathematics", grades: [8, 10] }],
  classes: [
    { id: "a", name: "8A", grade: 8 },
    { id: "b", name: "8B", grade: 8 },
  ],
  workspaces: [
    { id: "wa", subject_id: "s", class_id: "a" },
    { id: "wb", subject_id: "s", class_id: "b" },
  ],
});
function setup(handler) {
  dom = new JSDOM("<main></main>", {
    url: "http://localhost/",
    pretendToBeVisual: true,
  });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  dom.window.scrollTo = () => {};
  const el = (tag, attrs = {}, children = []) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else if (v !== undefined && v !== null && v !== false)
        n.setAttribute(k, v === true ? "" : v);
    }
    for (const child of Array.isArray(children) ? children : [children])
      if (child !== undefined && child !== null) n.append(child);
    return n;
  };
  let id = 0;
  const helpers = {
    el,
    viewRoot: document.querySelector("main"),
    field: ({ label, type = "text", extraAttrs = {} }) => {
      const input = el("input", { type, id: "field-" + id++, ...extraAttrs });
      return { input, wrapper: el("label", {}, [label, input]) };
    },
    apiFetch: handler,
    navigate: (path) => {
      window.location.hash = path;
    },
    toast: (message) => {
      throw new Error(message);
    },
    friendlyError: (e) => e.message,
    confirmDialog: async () => ({ confirmed: true }),
  };
  setupWorkspace(helpers);
  setupTeaching(helpers);
  return helpers;
}
const click = async (text) => {
  const target = [...document.querySelectorAll("button")].find(
    (b) => b.textContent === text,
  );
  assert.ok(target, text);
  target.click();
  await new Promise((r) => setTimeout(r, 20));
};
function apiBase(data) {
  return async (path, options) => {
    if (path === "/v1/teaching") return data;
    if (path === "/v1/teaching/workspaces/wa")
      return {
        item: {
          id: "wa",
          subject_id: "s",
          subject: "Mathematics",
          class_id: "a",
          class: "8A",
          grade: 8,
        },
        last: { id: "l", title: "Fractions" },
        coverage: { taught: 1, total: 2 },
      };
    if (path.startsWith("/v1/documents?"))
      return {
        items: [
          {
            id: "l",
            title: "Fractions",
            topic: "Equivalence",
            term: 2,
            lesson_status: "Taught",
            planned_date: "2026-09-21",
          },
        ],
      };
    if (path.includes("/resources") || path.includes("/learners"))
      return { items: [] };
    throw new Error("Unexpected " + path);
  };
}
test("progressive directory, breadcrumbs, direct links and browser history restore the class location", async () => {
  const data = directory(),
    ui = setup(apiBase(data));
  const render = async () => {
    ui.viewRoot.replaceChildren();
    await renderLessons(
      new URLSearchParams(window.location.hash.split("?")[1] || ""),
    );
  };
  await render();
  assert.match(document.querySelector("h1").textContent, /Lesson Plans/);
  assert.ok(document.querySelector('datalist option[value="Life Sciences"]'));
  assert.ok(document.querySelector('a[href="#/templates"]'));
  window.location.hash = lessonPath("s");
  await render();
  assert.equal(document.querySelector("h1").textContent, "Mathematics");
  assert.ok(document.querySelector('a[href="#/lessons?subject=s&grade=10"]'));
  window.location.hash = lessonPath("s", 8);
  await render();
  assert.ok(
    document.querySelector('a[href="#/lessons?subject=s&grade=8&class=a"]'),
  );
  window.location.hash = lessonPath("s", 8, "a");
  await render();
  assert.equal(document.querySelector("h1").textContent, "8A · Mathematics");
  assert.equal(document.querySelector(".lesson-directory"), null);
  assert.deepEqual(
    [...document.querySelectorAll(".lesson-breadcrumbs a")].map(
      (a) => a.textContent,
    ),
    ["Lesson Plans", "Mathematics", "Grade 8", "8A"],
  );
  assert.match(document.body.textContent, /Continue where you left off/);
  assert.match(document.body.textContent, /1 of 2 lessons taught/);
  await render();
  assert.equal(
    document.querySelector("h1").textContent,
    "8A · Mathematics",
    "fresh render uses URL",
  );
  await new Promise((resolve) => setTimeout(resolve, 30));
  await new Promise((resolve) => {
    window.addEventListener("popstate", resolve, { once: true });
    window.history.back();
  });
  await render();
  assert.equal(document.querySelector("h1").textContent, "Mathematics");
  assert.ok(document.querySelector(".lesson-directory"));
  await new Promise((resolve) => {
    window.addEventListener("popstate", resolve, { once: true });
    window.history.forward();
  });
  await render();
  assert.equal(document.querySelector("h1").textContent, "8A · Mathematics");
});
test("class creation connects a reusable class; rename and archive preserve its workspace", async () => {
  const data = directory(),
    writes = [],
    base = apiBase(data);
  const ui = setup(async (path, options) => {
    if (options) {
      writes.push({ path, ...options });
      if (path === "/v1/teaching/classes") {
        const item = { id: "c", ...options.body };
        data.classes.push(item);
        return { item };
      }
      if (path === "/v1/teaching/workspaces") {
        const item = {
          id: "wc",
          class_id: options.body.classId,
          subject_id: options.body.subjectId,
        };
        data.workspaces.push(item);
        return { item };
      }
      if (path === "/v1/teaching/classes/a") {
        Object.assign(data.classes[0], options.body, {
          archived_at: options.body.archived ? "now" : null,
        });
        return { item: data.classes[0] };
      }
    }
    return base(path, options);
  });
  await renderLessons(new URLSearchParams({ subject: "s", grade: "8" }));
  const name = [...document.querySelectorAll("label")]
    .find((l) => l.textContent === "New class name")
    .querySelector("input");
  name.value = "8C";
  name
    .closest("form")
    .dispatchEvent(new window.Event("submit", { cancelable: true }));
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(window.location.hash, "#/lessons?subject=s&grade=8&class=c");
  assert.equal(data.workspaces.at(-1).class_id, "c");
  ui.viewRoot.replaceChildren();
  await renderLessons(new URLSearchParams({ subject: "s", grade: "8" }));
  const rename = document.querySelector("details input");
  rename.value = "8A North";
  await click("Save name");
  assert.ok(data.classes.some((c) => c.name === "8A North"));
  await click("Archive");
  assert.ok(data.classes[0].archived_at);
  assert.ok(data.workspaces.some((w) => w.class_id === "a"));
  assert.equal(
    document.querySelector('a[href="#/lessons?subject=s&grade=8&class=a"]'),
    null,
  );
});
test("unassigned lesson editor saves metadata with autosave and preserves old content on reopen", async () => {
  const data = directory();
  let stored = {
      id: "l",
      kind: "lesson",
      title: "Old lesson",
      revision: 1,
      content: {
        body: "Legacy content",
        topic: "Fractions",
        reflection: "Reflection",
      },
      workspace_id: null,
      term: null,
      week: null,
      lesson_status: "Draft",
    },
    writes = [];
  const ui = setup(async (path, options) => {
    if (path === "/v1/teaching") return data;
    if (path === "/v1/documents/l" && options?.method === "PATCH") {
      writes.push(options.body);
      const b = options.body;
      stored = {
        ...stored,
        title: b.title,
        content: b.content,
        planned_date: b.plannedDate,
        workspace_id: b.lesson.workspaceId,
        term: b.lesson.term,
        week: b.lesson.week,
        lesson_status: b.lesson.status,
        revision: stored.revision + 1,
      };
      return { item: stored };
    }
    if (path === "/v1/documents/l")
      return {
        item: stored,
        resume: { field: "reflection", cursor: 3 },
        resources: [],
        workspace: stored.workspace_id
          ? {
              subject_id: "s",
              subject: "Mathematics",
              class_id: "a",
              class: "8A",
              grade: 8,
            }
          : null,
      };
    if (path === "/v1/resume/l") return { ok: true };
    if (path.startsWith("/v1/resources")) return { items: [] };
    throw new Error(path);
  });
  await renderEditor(new URLSearchParams({ id: "l" }));
  await new Promise((r) => setTimeout(r, 20));
  for (const [label, value] of [
    ["Class workspace", "wa"],
    ["Term", "2"],
    ["Lesson status", "Planned"],
  ]) {
    const select = document.querySelector('[aria-label="' + label + '"]');
    select.value = value;
    select.dispatchEvent(new window.Event("input"));
  }
  await click("Save now / retry");
  assert.equal(writes.length, 1);
  assert.equal(stored.content.body, "Legacy content");
  assert.equal(stored.workspace_id, "wa");
  assert.equal(stored.term, 2);
  assert.equal(stored.lesson_status, "Planned");
  await beforeLeave();
  ui.viewRoot.replaceChildren();
  await renderEditor(new URLSearchParams({ id: "l" }));
  assert.equal(
    document.querySelector('[aria-label="Class workspace"]').value,
    "wa",
  );
  assert.equal(document.querySelector('[aria-label="Term"]').value, "2");
  assert.equal(
    document.getElementById("editor-reflection").value,
    "Reflection",
  );
});
test("resource links open safely and unlink only the selected relationship", async () => {
  let linked = true;
  const calls = [];
  const r = {
    id: "r",
    title: "Video example",
    category: "Videos",
    external_url: "https://example.com/watch",
    status: "ready",
  };
  const ui = setup(async (path, options) => {
    calls.push({ path, ...options });
    if (options?.method === "DELETE") {
      linked = false;
      return { ok: true };
    }
    if (options?.method === "PUT") {
      linked = true;
      return { ok: true };
    }
    return { items: path.includes("workspaces") ? (linked ? [r] : []) : [r] };
  });
  ui.viewRoot.append(
    await resourcePanel("/v1/teaching/workspaces/wa/resources"),
  );
  const anchor = document.querySelector('a[href="https://example.com/watch"]');
  assert.equal(anchor.target, "_blank");
  assert.equal(anchor.rel, "noopener noreferrer");
  await click("Remove link");
  assert.equal(linked, false);
  assert.equal(
    calls.filter((c) => c.method === "DELETE")[0].path,
    "/v1/teaching/workspaces/wa/resources/r",
  );
  document.querySelector('[aria-label="Library resource"]').value = "r";
  await click("Add from library");
  assert.equal(linked, true);
});

test("A–D shortcuts reuse existing classes and create missing classes for the selected grade", async () => {
  const data = directory(),
    writes = [];
  const base = apiBase(data);
  const ui = setup(async (path, options) => {
    if (options) {
      writes.push({ path, ...options });
      if (path === "/v1/teaching/classes")
        return { item: { id: "new-class", ...options.body } };
      if (path === "/v1/teaching/workspaces")
        return { item: { class_id: options.body.classId } };
    }
    return base(path, options);
  });
  await renderLessons(new URLSearchParams({ subject: "s", grade: "8" }));
  for (const letter of ["A", "B", "C", "D"])
    assert.ok(
      [...document.querySelectorAll("button")].some(
        (b) => b.textContent === "Open 8" + letter,
      ),
    );
  await click("Open 8A");
  assert.equal(writes.length, 1);
  assert.equal(writes[0].body.classId, "a");
  await click("Open 8D");
  assert.deepEqual(writes[1].body, { name: "8D", grade: 8 });
  assert.equal(writes[2].body.classId, "new-class");
  assert.equal(
    window.location.hash,
    "#/lessons?subject=s&grade=8&class=new-class",
  );
});

test("class timetable builds 35 custom periods, rejects overlap and saves only its own class", async () => {
  const data = directory(),
    writes = [];
  data.classes[1].timetable = [
    { day: 1, start: "09:00", end: "09:45", title: "Other class", room: "" },
  ];
  const untouched = structuredClone(data.classes[1]);
  const base = apiBase(data);
  const ui = setup(async (path, options) => {
    if (options?.method === "PUT") {
      writes.push({ path, body: structuredClone(options.body) });
      return { entries: structuredClone(options.body.entries) };
    }
    return base(path, options);
  });
  await renderLessons(
    new URLSearchParams({ subject: "s", grade: "8", class: "a" }),
  );
  const subject = [...document.querySelectorAll("label")]
    .find((l) => l.textContent === "Subject 1")
    .querySelector("input");
  subject.value = "Computer Studies";
  await click("Fill starter week");
  assert.equal(document.querySelectorAll(".timetable-period").length, 35);
  const form = document.querySelector(".timetable-form");
  const starts = form.querySelectorAll('input[type="time"]');
  starts[2].value = "08:15";
  starts[2].dispatchEvent(new window.Event("input"));
  await click("Save timetable");
  assert.equal(writes.length, 0);
  assert.match(
    form.querySelector('[role="status"]').textContent,
    /cannot overlap/,
  );
  starts[2].value = "08:45";
  starts[2].dispatchEvent(new window.Event("input"));
  await click("Save timetable");
  assert.equal(writes[0].path, "/v1/teaching/classes/a/timetable");
  assert.equal(writes[0].body.entries.length, 35);
  const entries = writes[0].body.entries;
  assert.equal(entries.filter((e) => e.title === "Computer Studies").length, 5);
  for (const entry of entries) {
    const minutes = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
    assert.equal(minutes(entry.end) - minutes(entry.start), 45);
  }
  assert.deepEqual(data.classes[1], untouched);
  ui.viewRoot.replaceChildren();
  await renderLessons(
    new URLSearchParams({ subject: "s", grade: "8", class: "a" }),
  );
  assert.equal(document.querySelectorAll(".timetable-period").length, 35);
  await click("Remove period");
  await click("Save timetable");
  assert.equal(writes[1].body.entries.length, 34);
});

test("failed timetable saves keep the teacher's draft available for retry", async () => {
  const data = directory(),
    base = apiBase(data);
  let attempts = 0;
  setup(async (path, options) => {
    if (options?.method === "PUT") {
      if (++attempts === 1)
        throw new Error("Connection interrupted. Try again.");
      return { entries: structuredClone(options.body.entries) };
    }
    return base(path, options);
  });
  await renderLessons(
    new URLSearchParams({ subject: "s", grade: "8", class: "a" }),
  );
  await click("Fill starter week");
  await click("Save timetable");
  assert.match(
    document.querySelector('.timetable-form [role="status"]').textContent,
    /Connection interrupted/,
  );
  assert.equal(document.querySelectorAll(".timetable-period").length, 35);
  assert.equal(document.querySelector(".timetable-controls").disabled, false);
  await click("Save timetable");
  assert.match(
    document.querySelector('.timetable-form [role="status"]').textContent,
    /Timetable saved for 8A/,
  );
});

test("timetables directory opens existing classes and sets up A–D without a subject workspace", async () => {
  const data = directory();
  const writes = [];
  const ui = setup(async (path, options) => {
    if (path === "/v1/teaching") return data;
    writes.push({ path, ...options });
    assert.equal(path, "/v1/teaching/classes");
    const item = { id: "new-d", ...options.body };
    data.classes.push(item);
    return { item };
  });
  await renderTimetables();
  assert.equal(document.querySelector("h1").textContent, "Timetables");
  assert.ok(document.querySelector('a[href="#/timetables?class=a"]'));
  assert.equal(document.querySelectorAll(".lesson-section").length, 5);
  await click("Set up 8D");
  assert.deepEqual(writes[0].body, { name: "8D", grade: 8 });
  assert.equal(window.location.hash, "#/timetables?class=new-d");
  ui.viewRoot.replaceChildren();
  await renderTimetables(new URLSearchParams({ class: "new-d" }));
  assert.ok(document.querySelector(".timetable-form"));
  assert.match(document.querySelector("h2").textContent, /8D/);
  assert.equal(writes.length, 1);
});

test("photo import shows warnings and text, then requires review before saving to the selected class", async () => {
  const data = directory();
  data.classes[0].timetable = [
    { day: 2, start: "10:00", end: "10:45", title: "Original", room: "" },
  ];
  const writes = [],
    base = apiBase(data);
  setup(async (path, options) => {
    if (path.endsWith("/timetable/photo")) {
      assert.match(options.body.image, /^data:image\/png;base64,/);
      return {
        text: "Monday: English 08:00 [unreadable]",
        warnings: ["The end time is covered."],
        entries: [
          { day: 1, start: "08:00", end: "", title: "English", room: "" },
        ],
      };
    }
    if (options?.method === "PUT") {
      writes.push({ path, ...options });
      return { entries: structuredClone(options.body.entries) };
    }
    return base(path, options);
  });
  await renderTimetables(new URLSearchParams({ class: "a" }));
  assert.match(
    document.querySelector(".timetable-photo-warning").textContent,
    /low-resolution.*covered/,
  );
  const input = document.querySelector('input[type="file"]');
  Object.defineProperty(input, "files", {
    value: [
      new window.File(["picture"], "timetable.png", { type: "image/png" }),
    ],
  });
  input.dispatchEvent(new window.Event("change"));
  for (
    let i = 0;
    i < 100 && !document.querySelector(".timetable-transcription");
    i++
  )
    await new Promise((r) => setTimeout(r, 10));
  assert.match(
    document.querySelector(".timetable-transcription").textContent,
    /English/,
  );
  assert.match(
    document.querySelector(".timetable-photo-review").textContent,
    /end time is covered/,
  );
  assert.equal(data.classes[0].timetable[0].title, "Original");
  await click("Use extracted timetable");
  assert.equal(writes.length, 0);
  const end = [...document.querySelectorAll("label")]
    .find((l) => l.textContent === "Monday end")
    .querySelector("input");
  assert.equal(end.value, "");
  end.value = "08:45";
  end.dispatchEvent(new window.Event("input"));
  await click("Save timetable");
  assert.equal(writes.length, 1);
  assert.equal(writes[0].path, "/v1/teaching/classes/a/timetable");
  assert.equal(writes[0].body.entries[0].title, "English");
});

test("photo import clearly reports unavailable setup and keeps manual entry available", async () => {
  const data = { ...directory(), photoImportAvailable: false };
  setup(apiBase(data));
  await renderTimetables(new URLSearchParams({ class: "a" }));
  assert.equal(document.querySelector('input[type="file"]').disabled, true);
  assert.match(
    document.querySelector(".timetable-photo").textContent,
    /not set up yet/,
  );
  assert.ok(
    [...document.querySelectorAll("summary")].some((s) =>
      /enter it manually/.test(s.textContent),
    ),
  );
});
