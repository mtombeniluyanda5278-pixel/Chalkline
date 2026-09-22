import { createLoader } from "./loading.js";
// Lesson directory uses hash URLs; durable records and editor state live on the API.
let ui;
export const SUBJECT_CHOICES = [
  "History",
  "Geography",
  "Mathematics",
  "Mathematical Literacy",
  "English",
  "Afrikaans",
  "Life Orientation",
  "Business Studies",
  "Physical Sciences",
  "Tourism",
  "Life Sciences",
];
export const CATEGORIES = [
  "Videos",
  "Pictures",
  "Documents",
  "Activities",
  "Assignments",
  "Presentations",
  "Worksheets",
];
export const STATUSES = ["Draft", "Planned", "Taught", "Needs review"];
export function setupTeaching(helpers) {
  ui = helpers;
}
const E = (...args) => ui.el(...args);
const api = (...args) => ui.apiFetch(...args);
const link = (text, path) =>
  E("a", { href: "#" + path, class: "btn btn--ghost" }, text);
const button = (text, action) =>
  E(
    "button",
    {
      type: "button",
      class: "btn btn--ghost",
      onclick: async (e) => {
        const b = e.currentTarget;
        b.disabled = true;
        try {
          await action();
        } catch (err) {
          ui.toast(err.message, "error");
        } finally {
          b.disabled = false;
        }
      },
    },
    text,
  );
export function lessonPath(subject, grade, classId) {
  const q = new URLSearchParams();
  if (subject) q.set("subject", subject);
  if (grade) q.set("grade", grade);
  if (classId) q.set("class", classId);
  return "/lessons" + (q.size ? "?" + q : "");
}
export function lessonBreadcrumbs(workspace) {
  const parts = [link("Lesson Plans", "/lessons")];
  if (workspace) {
    parts.push(
      link(workspace.subject, lessonPath(workspace.subject_id)),
      link(
        "Grade " + workspace.grade,
        lessonPath(workspace.subject_id, workspace.grade),
      ),
      link(
        workspace.class,
        lessonPath(workspace.subject_id, workspace.grade, workspace.class_id),
      ),
    );
  }
  return E(
    "nav",
    { class: "lesson-breadcrumbs", "aria-label": "Lesson plan breadcrumbs" },
    parts,
  );
}
const section = (title, ...body) =>
  E("section", { class: "card lesson-section" }, [E("h2", {}, title), ...body]);
export function selectField(label, values, value = "") {
  const input = E(
    "select",
    { "aria-label": label },
    values.map((v) =>
      E(
        "option",
        { value: Array.isArray(v) ? v[0] : v },
        Array.isArray(v) ? v[1] : v,
      ),
    ),
  );
  input.value = value;
  return {
    input,
    wrapper: E("label", { class: "field" }, [E("span", {}, label), input]),
  };
}
function submitForm(fields, label, submit) {
  const status = E("p", { role: "status" });
  const form = E("form", { class: "lesson-form" }, [
    ...fields.map((f) => f.wrapper),
    E("button", { type: "submit", class: "btn btn--primary" }, label),
    status,
  ]);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const b = form.querySelector("button");
    b.disabled = true;
    status.textContent = "Saving…";
    try {
      await submit();
      status.textContent = "Saved";
    } catch (err) {
      status.textContent = err.message;
    } finally {
      b.disabled = false;
    }
  });
  return form;
}
async function confirm(title, body) {
  return (
    await ui.confirmDialog({
      title,
      body,
      confirmLabel: "Confirm",
      danger: true,
    })
  ).confirmed;
}
function management(kind, item, reload) {
  const name = ui.field({
    label: "Rename " + (kind === "subjects" ? "subject" : "class"),
    extraAttrs: { maxlength: 100, required: true },
  });
  name.input.value = item.name;
  return E("details", {}, [
    E("summary", {}, "Manage " + item.name),
    submitForm([name], "Save name", async () => {
      await api("/v1/teaching/" + kind + "/" + item.id, {
        method: "PATCH",
        body: { name: name.input.value },
      });
      await reload();
    }),
    button(item.archived_at ? "Restore" : "Archive", async () => {
      if (
        !(await confirm(
          (item.archived_at ? "Restore " : "Archive ") + item.name + "?",
          "Linked lessons, resources and class lists are preserved.",
        ))
      )
        return;
      await api("/v1/teaching/" + kind + "/" + item.id, {
        method: "PATCH",
        body: { archived: !item.archived_at },
      });
      await reload();
    }),
  ]);
}
export async function renderLessons(params = new URLSearchParams()) {
  const root = E("div", { class: "lesson-page" });
  ui.viewRoot.append(root);
  root.append(createLoader("Loading lesson plans…"));
  const data = await api("/v1/teaching");
  root.replaceChildren();
  const subjectId = params.get("subject"),
    grade = Number(params.get("grade")),
    classId = params.get("class"),
    archived = params.get("view") === "archived";
  const subject = data.subjects.find((s) => s.id === subjectId);
  const cls = data.classes.find((c) => c.id === classId);
  const workspace = data.workspaces.find(
    (w) => w.subject_id === subjectId && w.class_id === classId,
  );
  const reload = async () => {
    root.remove();
    await renderLessons(params);
  };
  root.append(
    lessonBreadcrumbs(
      subject
        ? {
            subject_id: subject.id,
            subject: subject.name,
            grade: grade || "",
            class: cls?.name || "",
            class_id: cls?.id || "",
          }
        : null,
    ),
  );
  const crumbs = root.querySelector("nav");
  if (subject && !grade) {
    while (crumbs.children.length > 2) crumbs.lastChild.remove();
  } else if (subject && !classId) {
    while (crumbs.children.length > 3) crumbs.lastChild.remove();
  }
  if (
    (subjectId && !subject) ||
    (params.has("grade") && (!subject || !subject.grades.includes(grade))) ||
    (classId && (!cls || cls.grade !== grade || !workspace))
  ) {
    root.append(
      section(
        "Location unavailable",
        E(
          "p",
          {},
          "This subject, grade or class is no longer available at this address.",
        ),
        link("Return to Lesson Plans", "/lessons"),
      ),
    );
    return;
  }
  if (params.get("view") === "unassigned") {
    root.append(
      E("h1", {}, "Unassigned lessons"),
      E(
        "p",
        {},
        "Your existing lesson content is preserved. Open a lesson and choose its class workspace.",
      ),
    );
    await lessonList(root, null);
    return;
  }
  if (workspace) {
    await renderClass(root, workspace.id, data, reload);
    return;
  }
  if (!subject) {
    root.append(
      E("header", { class: "lesson-intro" }, [
        E("p", { class: "lesson-eyebrow" }, "Your teaching workspace"),
        E("h1", {}, archived ? "Archived directory" : "Lesson Plans"),
        E(
          "p",
          { class: "lesson-description" },
          "A little space to plan what comes next. Choose a subject, then a grade and class.",
        ),
      ]),
      E("div", { class: "btn-row lesson-tools" }, [
        link("Unassigned lessons", "/lessons?view=unassigned"),
        link("Legacy templates", "/templates"),
        link(
          archived ? "Active subjects" : "Archived subjects and classes",
          archived ? "/lessons" : "/lessons?view=archived",
        ),
      ]),
    );
    const subjects = data.subjects.filter(
      (s) => Boolean(s.archived_at) === archived,
    );
    root.append(
      E(
        "div",
        { class: "lesson-directory" },
        subjects.map((s) =>
          E("section", { class: "card lesson-section lesson-subject" }, [
            E(
              "a",
              {
                class: "lesson-subject-link",
                href: "#" + lessonPath(s.id),
                "aria-label": "Open " + s.name,
              },
              [
                E("span", { class: "lesson-eyebrow" }, "Subject"),
                E("h2", {}, s.name),
                E(
                  "span",
                  { class: "lesson-subject-arrow", "aria-hidden": "true" },
                  "↗",
                ),
                E(
                  "span",
                  { class: "lesson-grades" },
                  s.grades.map((g) => E("span", {}, "Grade " + g)),
                ),
              ],
            ),
            management("subjects", s, reload),
          ]),
        ),
      ),
    );
    if (!subjects.length)
      root.append(
        E(
          "p",
          { class: "empty-note" },
          archived
            ? "No archived subjects."
            : "Add your first teaching subject below.",
        ),
      );
    if (archived) {
      for (const c of data.classes.filter((c) => c.archived_at))
        root.append(
          section(
            c.name,
            E("p", {}, "Grade " + c.grade),
            ...data.workspaces
              .filter((w) => w.class_id === c.id)
              .map((w) =>
                link(
                  "Open " +
                    data.subjects.find((s) => s.id === w.subject_id).name,
                  lessonPath(w.subject_id, c.grade, c.id),
                ),
              ),
            management("classes", c, reload),
          ),
        );
      return;
    }
    const name = ui.field({
      label: "Subject name",
      extraAttrs: { list: "subject-choices", maxlength: 100, required: true },
    });
    const choices = E(
      "datalist",
      { id: "subject-choices" },
      SUBJECT_CHOICES.map((v) => E("option", { value: v })),
    );
    const checks = [8, 9, 10, 11, 12].map((g) =>
      E("label", {}, [
        E("input", { type: "checkbox", value: g }),
        "Grade " + g,
      ]),
    );
    const grades = {
      wrapper: E("fieldset", { class: "grade-choices subject-grade-bars" }, [
        E("legend", {}, "Applicable grades"),
        ...checks,
      ]),
    };
    root.append(
      section(
        "Add a subject",
        choices,
        submitForm([grades, name], "Add subject", async () => {
          const grades = checks
            .filter((c) => c.querySelector("input").checked)
            .map((c) => Number(c.querySelector("input").value));
          if (!grades.length) throw new Error("Choose at least one grade.");
          await api("/v1/teaching/subjects", {
            method: "POST",
            body: { name: name.input.value, grades },
          });
          await reload();
        }),
      ),
    );
    return;
  }
  root.append(E("h1", {}, subject.name));
  if (!grade) {
    root.append(
      E("p", {}, "Choose a grade."),
      E(
        "div",
        { class: "lesson-directory" },
        subject.grades.map((g) =>
          link("Grade " + g, lessonPath(subject.id, g)),
        ),
      ),
      management("subjects", subject, reload),
    );
    const checks = [8, 9, 10, 11, 12].map((g) => {
      const i = E("input", { type: "checkbox", value: g });
      i.checked = subject.grades.includes(g);
      return E("label", {}, [i, "Grade " + g]);
    });
    root.append(
      E("details", {}, [
        E("summary", {}, "Edit applicable grades"),
        submitForm(
          [
            {
              wrapper: E("fieldset", { class: "grade-choices" }, [
                E("legend", {}, "Grades"),
                ...checks,
              ]),
            },
          ],
          "Save grades",
          async () => {
            await api("/v1/teaching/subjects/" + subject.id, {
              method: "PATCH",
              body: {
                grades: checks
                  .filter((c) => c.querySelector("input").checked)
                  .map((c) => Number(c.querySelector("input").value)),
              },
            });
            await reload();
          },
        ),
      ]),
    );
    return;
  }
  const linked = data.workspaces
    .filter((w) => w.subject_id === subject.id)
    .map((w) => w.class_id);
  const classes = data.classes.filter(
    (c) => c.grade === grade && linked.includes(c.id),
  );
  root.append(
    E("h2", {}, "Grade " + grade),
    E(
      "div",
      { class: "lesson-directory" },
      classes
        .filter((c) => !c.archived_at || subject.archived_at)
        .map((c) =>
          section(
            c.name,
            link("Open " + c.name, lessonPath(subject.id, grade, c.id)),
            management("classes", c, reload),
          ),
        ),
    ),
  );
  if (subject.archived_at) {
    root.append(
      E("p", {}, "Archived subject. Restore it to add classes."),
      management("subjects", subject, reload),
    );
    return;
  }
  if (!classes.filter((c) => !c.archived_at).length)
    root.append(
      E("p", { class: "empty-note" }, "Add a class for this subject."),
    );
  const existing = selectField("Use an existing class", [
    ["", "Choose class"],
    ...data.classes
      .filter(
        (c) => c.grade === grade && !c.archived_at && !linked.includes(c.id),
      )
      .map((c) => [c.id, c.name]),
  ]);
  const connect = async (classId) => {
    const r = await api("/v1/teaching/workspaces", {
      method: "POST",
      body: { subjectId: subject.id, classId },
    });
    ui.navigate(lessonPath(subject.id, grade, r.item.class_id));
  };
  root.append(
    section(
      "Classes A–D",
      E(
        "p",
        {},
        "Choose a class to set up its own timetable. Existing classes are reused across subjects.",
      ),
      E(
        "div",
        { class: "btn-row" },
        ["A", "B", "C", "D"].map((letter) =>
          button("Open " + grade + letter, async () => {
            const className = grade + letter;
            let cls = data.classes.find(
              (c) => c.grade === grade && c.name.toUpperCase() === className,
            );
            if (cls?.archived_at)
              throw new Error(
                "Restore " +
                  className +
                  " from Archived subjects and classes first.",
              );
            if (!cls) {
              cls = (
                await api("/v1/teaching/classes", {
                  method: "POST",
                  body: { name: className, grade },
                })
              ).item;
              data.classes.push(cls);
            }
            await connect(cls.id);
          }),
        ),
      ),
    ),
  );
  root.append(
    section(
      "Add a class",
      submitForm([existing], "Use this class", async () => {
        if (!existing.input.value) throw new Error("Choose a class.");
        await connect(existing.input.value);
      }),
    ),
  );
  const name = ui.field({
    label: "New class name",
    extraAttrs: { placeholder: grade + "A", maxlength: 100, required: true },
  });
  root.append(
    submitForm([name], "Create class", async () => {
      const r = await api("/v1/teaching/classes", {
        method: "POST",
        body: { name: name.input.value, grade },
      });
      await connect(r.item.id);
    }),
  );
}
export async function renderTimetables(params = new URLSearchParams()) {
  const root = E("div", { class: "lesson-page" });
  ui.viewRoot.append(root);
  root.append(createLoader("Loading timetables…"));
  const directory = await api("/v1/teaching");
  root.replaceChildren(E("h1", {}, "Timetables"));
  const classId = params.get("class");
  if (classId) {
    root.append(link("All class timetables", "/timetables"));
    const cls = directory.classes.find((c) => c.id === classId);
    if (!cls) {
      root.append(
        E("p", { role: "status" }, "This class is no longer available."),
      );
      return;
    }
    root.append(E("p", {}, "Grade " + cls.grade + " · " + cls.name));
    if (cls.archived_at)
      root.append(
        E(
          "p",
          {},
          "Archived class. Restore it in Lesson Plans to edit its timetable.",
        ),
      );
    root.append(
      classTimetable(
        cls,
        Boolean(cls.archived_at),
        directory.photoImportAvailable,
      ),
    );
    return;
  }
  root.append(
    E(
      "p",
      {},
      "Choose a grade and class to create or edit its weekly timetable.",
    ),
  );
  const path = (id) => "/timetables?" + new URLSearchParams({ class: id });
  for (const grade of [8, 9, 10, 11, 12]) {
    const classes = directory.classes.filter((c) => c.grade === grade);
    const standardNames = ["A", "B", "C", "D"].map((letter) => grade + letter);
    const choices = standardNames.map((name) => {
      const cls = classes.find((c) => c.name.toUpperCase() === name);
      if (cls)
        return link(
          name + (cls.archived_at ? " (archived)" : ""),
          path(cls.id),
        );
      return button("Set up " + name, async () => {
        const item = (
          await api("/v1/teaching/classes", {
            method: "POST",
            body: { name, grade },
          })
        ).item;
        ui.navigate(path(item.id));
      });
    });
    for (const cls of classes.filter(
      (c) => !standardNames.includes(c.name.toUpperCase()),
    ))
      choices.push(
        link(cls.name + (cls.archived_at ? " (archived)" : ""), path(cls.id)),
      );
    root.append(
      section("Grade " + grade, E("div", { class: "btn-row" }, choices)),
    );
  }
}
function classTimetable(cls, readOnly, photoImportAvailable = true) {
  const days = [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
  ];
  let entries = (cls.timetable || []).map((entry) => ({ ...entry }));
  const status = E("p", { role: "status", "aria-live": "polite" });
  const rows = E("div", { class: "timetable-days" });
  const controls = E("fieldset", {
    class: "timetable-controls",
    disabled: readOnly,
  });
  const manual = E("details", { open: entries.length > 0 || readOnly }, [
    E("summary", {}, "Edit timetable or enter it manually"),
  ]);
  if (!readOnly) {
    const photo = ui.field({
      label: "Upload a timetable photo",
      type: "file",
      extraAttrs: {
        accept: "image/jpeg,image/png,image/webp",
        disabled: !photoImportAvailable,
      },
    });
    const preview = E("div", { class: "timetable-photo-preview" });
    const review = E("div", {
      class: "timetable-photo-review",
      "aria-live": "polite",
    });
    controls.append(
      E("section", { class: "timetable-photo" }, [
        E("h3", {}, "Add your timetable from a photo"),
        E(
          "p",
          {},
          "Upload a clear photo or screenshot and we’ll convert it into editable text and class periods.",
        ),
        E(
          "p",
          { class: "timetable-photo-warning" },
          "Blurry, low-resolution, cropped or covered sections may produce an incomplete or incorrect timetable. Include the full timetable, with all days, subjects and times visible. Always check the result before saving.",
        ),
        E(
          "p",
          {},
          "JPG, PNG or WebP, up to 4 MB. Your photo is sent to OpenAI to read it; Chix does not save the photo.",
        ),
        ...(!photoImportAvailable
          ? [
              E(
                "p",
                { role: "status" },
                "Photo conversion is not set up yet. Ask your administrator to enable it, or enter your timetable manually below.",
              ),
            ]
          : []),
        photo.wrapper,
        preview,
        review,
      ]),
    );
    photo.input.addEventListener("change", async () => {
      const file = photo.input.files?.[0];
      if (!file) return;
      review.replaceChildren();
      preview.replaceChildren();
      if (
        !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
        file.size > 4 * 1024 * 1024 ||
        !file.size
      ) {
        review.append(
          E(
            "p",
            { role: "alert" },
            "Choose a JPG, PNG or WebP photo smaller than 4 MB.",
          ),
        );
        return;
      }
      controls.disabled = true;
      review.append(createLoader("Reading your timetable photo…"));
      try {
        const image = await new Promise((resolve, reject) => {
          const reader = new window.FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () =>
            reject(
              new Error("This photo could not be opened. Choose it again."),
            );
          reader.readAsDataURL(file);
        });
        preview.append(
          E("img", {
            src: image,
            alt: "Your uploaded timetable for comparison",
          }),
        );
        const result = await api(
          "/v1/teaching/classes/" + cls.id + "/timetable/photo",
          { method: "POST", body: { image } },
        );
        review.replaceChildren(
          E("h3", {}, "Review the extracted text"),
          E(
            "p",
            {},
            "Compare this result with your photo. Nothing has been saved yet.",
          ),
          E(
            "pre",
            { class: "timetable-transcription" },
            result.text || "No readable text found.",
          ),
          ...result.warnings.map((warning) =>
            E("p", { class: "timetable-photo-warning" }, warning),
          ),
        );
        if (!result.entries.length) {
          review.append(
            E(
              "p",
              {},
              "No class periods could be read. Try a clearer, uncovered photo or enter the timetable manually.",
            ),
          );
          return;
        }
        review.append(
          button("Use extracted timetable", async () => {
            if (
              entries.length &&
              !(await confirm(
                "Replace this timetable draft?",
                "The extracted periods will replace the draft below. Your saved timetable changes only after you review it and select Save timetable.",
              ))
            )
              return;
            entries = result.entries.map((entry) => ({ ...entry }));
            draw();
            manual.open = true;
            status.textContent =
              "Review every subject, day and time, fill any gaps, then select Save timetable.";
          }),
        );
      } catch (error) {
        review.replaceChildren(
          E(
            "p",
            { role: "alert" },
            error.message +
              " Your existing timetable has not changed. Choose the photo again to retry.",
          ),
        );
      } finally {
        controls.disabled = false;
        photo.input.value = "";
      }
    });
  }
  const endTime = (start) => {
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(start)) return "";
    const [hour, minute] = start.split(":").map(Number);
    const end = hour * 60 + minute + 45;
    return end < 1440
      ? String(Math.floor(end / 60)).padStart(2, "0") +
          ":" +
          String(end % 60).padStart(2, "0")
      : "";
  };
  const changed = () => {
    status.textContent = "Unsaved changes";
  };
  function draw() {
    rows.replaceChildren();
    days.forEach((day, index) => {
      const daily = entries.filter((entry) => entry.day === index + 1);
      if (index > 4 && !daily.length) return;
      const group = E("section", { class: "timetable-day" }, E("h3", {}, day));
      daily
        .sort((a, b) => a.start.localeCompare(b.start))
        .forEach((entry) => {
          const start = ui.field({
            label: day + " start",
            type: "time",
            extraAttrs: { required: true },
          });
          const title = ui.field({
            label: day + " subject",
            extraAttrs: { required: true, maxlength: 100 },
          });
          const room = ui.field({
            label: day + " room (optional)",
            extraAttrs: { maxlength: 100 },
          });
          start.input.value = entry.start;
          title.input.value = entry.title;
          room.input.value = entry.room || "";
          const end = ui.field({
            label: day + " end",
            type: "time",
            extraAttrs: { required: true },
          });
          end.input.value = entry.end;
          end.input.addEventListener("input", () => {
            entry.end = end.input.value;
            changed();
          });
          start.input.addEventListener("input", () => {
            entry.start = start.input.value;
            entry.end = endTime(entry.start);
            end.input.value = entry.end;
            changed();
          });
          title.input.addEventListener("input", () => {
            entry.title = title.input.value;
            changed();
          });
          room.input.addEventListener("input", () => {
            entry.room = room.input.value;
            changed();
          });
          group.append(
            E("div", { class: "timetable-period" }, [
              start.wrapper,
              end.wrapper,
              title.wrapper,
              room.wrapper,
              button("Remove period", () => {
                entries = entries.filter((e) => e !== entry);
                draw();
                changed();
              }),
            ]),
          );
        });
      if (!readOnly)
        group.append(
          button("Add period to " + day, () => {
            if (entries.length >= 100) {
              status.textContent = "A timetable can contain up to 100 periods.";
              return;
            }
            const start = daily.at(-1)?.end || "08:00";
            entries.push({
              day: index + 1,
              start,
              end: endTime(start),
              title: "",
              room: "",
            });
            draw();
            changed();
          }),
        );
      rows.append(group);
    });
  }
  const subjects = [
    "Mathematics",
    "English",
    "Science",
    "History",
    "Geography",
    "Art",
    "Physical Education",
  ].map((value, index) => {
    const field = ui.field({
      label: "Subject " + (index + 1),
      extraAttrs: { maxlength: 100 },
    });
    field.input.value = value;
    return field;
  });
  if (!readOnly)
    manual.append(
      E("details", { class: "timetable-starter" }, [
        E("summary", {}, "Start with a seven-subject week"),
        E(
          "p",
          {},
          "Enter your subjects. Seven 45-minute periods each day, 08:00–14:00, with a break at 10:15–10:30 and lunch at 12:00–12:30. You can edit every period afterwards.",
        ),
        E(
          "div",
          { class: "timetable-subjects" },
          subjects.map((field) => field.wrapper),
        ),
        button("Fill starter week", async () => {
          if (subjects.some((field) => !field.input.value.trim())) {
            status.textContent = "Enter all seven subject names.";
            return;
          }
          if (
            entries.length &&
            !(await confirm(
              "Replace this timetable draft?",
              "This replaces the periods on this screen. Your saved timetable changes only when you select Save timetable.",
            ))
          )
            return;
          const starts = [
            "08:00",
            "08:45",
            "09:30",
            "10:30",
            "11:15",
            "12:30",
            "13:15",
          ];
          entries = Array.from({ length: 5 }, (_, day) =>
            starts.map((start, period) => ({
              day: day + 1,
              start,
              end: endTime(start),
              title: subjects[(period + day * 2) % 7].input.value.trim(),
              room: "",
            })),
          ).flat();
          draw();
          changed();
        }),
      ]),
    );
  manual.append(rows);
  controls.append(manual);
  const form = E("form", { class: "timetable-form" }, [controls, status]);
  if (!readOnly)
    manual.append(
      E(
        "button",
        { type: "submit", class: "btn btn--primary" },
        "Save timetable",
      ),
    );
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (readOnly || controls.disabled) return;
    if (
      entries.some(
        (entry) =>
          !entry.title.trim() ||
          !entry.start ||
          !entry.end ||
          entry.end <= entry.start,
      )
    ) {
      status.textContent =
        "Give every period a subject and a valid start time with room for 45 minutes.";
      return;
    }
    if (
      entries.some((entry, index) =>
        entries
          .slice(0, index)
          .some(
            (other) =>
              other.day === entry.day &&
              other.start < entry.end &&
              entry.start < other.end,
          ),
      )
    ) {
      status.textContent =
        "Periods on the same day cannot overlap. Adjust their start times.";
      return;
    }
    controls.disabled = true;
    status.textContent = "Saving…";
    try {
      const saved = await api("/v1/teaching/classes/" + cls.id + "/timetable", {
        method: "PUT",
        body: { entries },
      });
      cls.timetable = saved.entries;
      entries = saved.entries.map((entry) => ({ ...entry }));
      draw();
      status.textContent = "Timetable saved for " + cls.name + ".";
    } catch (error) {
      status.textContent = error.message;
    } finally {
      controls.disabled = false;
    }
  });
  draw();
  return section(
    "Weekly timetable · " + cls.name,
    E(
      "p",
      {},
      "Each new period is 45 minutes. This timetable belongs to " +
        cls.name +
        " and is shared across your subjects for this class. Other classes have their own timetables.",
    ),
    form,
  );
}
async function lessonList(root, workspaceId) {
  const search = ui.field({
      label: "Search lesson title or topic",
      type: "search",
    }),
    term = selectField("Term", [
      ["", "All terms"],
      ...[1, 2, 3, 4].map((t) => [t, "Term " + t]),
    ]),
    status = selectField("Status", [["", "All statuses"], ...STATUSES]);
  const results = E("div", { class: "work-list" }),
    message = E("div", { role: "status" });
  let offset = 0;
  const more = button("Load more", async () => {
    offset += 20;
    await load(true);
  });
  async function load(append = false) {
    message.replaceChildren(createLoader("Loading lessons…"));
    const q = new URLSearchParams(
      workspaceId
        ? { kind: "lesson", workspaceId }
        : { kind: "lesson", unassigned: "true" },
    );
    q.set("search", search.input.value);
    q.set("offset", offset);
    if (term.input.value) q.set("term", term.input.value);
    if (status.input.value) q.set("status", status.input.value);
    try {
      const r = await api("/v1/documents?" + q);
      if (!append) results.replaceChildren();
      for (const l of r.items)
        results.append(
          E("a", { class: "work-row", href: "#/editor?id=" + l.id }, [
            E("strong", {}, l.title),
            E(
              "span",
              {},
              [
                l.term ? "Term " + l.term : "No term",
                l.topic || "No topic",
                l.planned_date
                  ? String(l.planned_date).slice(0, 10)
                  : "Not scheduled",
                l.lesson_status,
              ].join(" · "),
            ),
          ]),
        );
      more.hidden = r.items.length < 20;
      message.textContent = results.children.length
        ? ""
        : "No lessons match. Create a lesson or adjust the filters.";
    } catch (err) {
      message.textContent = err.message;
    }
  }
  root.append(
    section(
      "Lessons",
      submitForm([search, term, status], "Find lessons", async () => {
        offset = 0;
        await load();
      }),
      message,
      results,
      more,
    ),
  );
  await load();
}
async function renderClass(root, id, directory, reload) {
  const data = await api("/v1/teaching/workspaces/" + id),
    w = data.item,
    archived = w.subject_archived || w.class_archived;
  root.append(
    E("h1", {}, w.class + " · " + w.subject),
    E(
      "p",
      {},
      "Grade " +
        w.grade +
        " · " +
        data.coverage.taught +
        " of " +
        data.coverage.total +
        " lessons taught",
    ),
    ...(archived
      ? [
          E(
            "p",
            {},
            "Archived workspace. Your linked content remains available.",
          ),
        ]
      : [
          button("New lesson plan", async () => {
            const r = await api("/v1/documents", {
              method: "POST",
              body: {
                kind: "lesson",
                title: "Untitled lesson",
                content: {},
                lesson: {
                  workspaceId: id,
                  term: null,
                  week: null,
                  status: "Draft",
                },
              },
            });
            ui.navigate("/editor?id=" + r.item.id);
          }),
        ]),
  );
  if (data.last)
    root.append(
      section(
        "Continue where you left off",
        link(data.last.title, "/editor?id=" + data.last.id),
      ),
    );
  const timetableClass = directory.classes.find((c) => c.id === w.class_id);
  if (timetableClass)
    root.append(
      classTimetable(
        timetableClass,
        Boolean(archived),
        directory.photoImportAvailable,
      ),
    );
  await lessonList(root, id);
  try {
    root.append(
      await resourcePanel("/v1/teaching/workspaces/" + id + "/resources"),
    );
  } catch (err) {
    root.append(
      E("p", { role: "alert" }, "Resources could not load: " + err.message),
    );
  }
  const roster = section(
    "Class list",
    E("p", {}, "Private to you. Shared by subjects using this class."),
  );
  const learners = (
    await api("/v1/teaching/classes/" + w.class_id + "/learners")
  ).items;
  for (const l of learners) {
    const name = ui.field({
        label: "Learner name",
        extraAttrs: { required: true, maxlength: 200 },
      }),
      identifier = ui.field({
        label: "Optional identifier",
        extraAttrs: { maxlength: 100 },
      });
    name.input.value = l.name;
    identifier.input.value = l.identifier;
    roster.append(
      E("details", {}, [
        E("summary", {}, l.name + (l.identifier ? " · " + l.identifier : "")),
        submitForm([name, identifier], "Save learner", async () => {
          await api("/v1/teaching/learners/" + l.id, {
            method: "PATCH",
            body: {
              name: name.input.value,
              identifier: identifier.input.value,
            },
          });
          await reload();
        }),
        button("Remove learner", async () => {
          if (
            await confirm(
              "Remove " + l.name + "?",
              "This removes the learner from this private class list.",
            )
          ) {
            await api("/v1/teaching/learners/" + l.id, { method: "DELETE" });
            await reload();
          }
        }),
      ]),
    );
  }
  if (!learners.length)
    roster.append(
      E(
        "p",
        { class: "empty-note" },
        "Add a learner to start your class list.",
      ),
    );
  if (!archived) {
    const name = ui.field({
        label: "Learner name",
        extraAttrs: { required: true, maxlength: 200 },
      }),
      identifier = ui.field({
        label: "Optional identifier",
        extraAttrs: { maxlength: 100 },
      });
    roster.append(
      submitForm([name, identifier], "Add learner", async () => {
        await api("/v1/teaching/classes/" + w.class_id + "/learners", {
          method: "POST",
          body: { name: name.input.value, identifier: identifier.input.value },
        });
        await reload();
      }),
    );
  }
  root.append(
    roster,
    management(
      "classes",
      directory.classes.find((c) => c.id === w.class_id),
      reload,
    ),
  );
}
export function resourceAnchor(r) {
  return r.external_url
    ? E(
        "a",
        { href: r.external_url, target: "_blank", rel: "noopener noreferrer" },
        r.title + " · Video link ↗",
      )
    : E("a", { href: "#/file?id=" + r.id }, r.title);
}
export async function resourcePanel(endpoint, documentId) {
  const attached = E("div", {}),
    search = ui.field({ label: "Search library", type: "search" }),
    category = selectField("Resource category", [
      ["", "All categories"],
      ...CATEGORIES,
    ]),
    choice = selectField("Library resource", [["", "Choose resource"]]);
  let offset = 0;
  const more = button("More library resources", async () => {
    offset += 20;
    await find(true);
  });
  async function refresh() {
    const r = await api(documentId ? "/v1/documents/" + documentId : endpoint);
    const items = documentId ? r.resources : r.items;
    attached.replaceChildren(
      ...items.map((r) =>
        E("div", { class: "entity-row" }, [
          resourceAnchor(r),
          E("small", {}, r.category || "Documents"),
          button("Remove link", async () => {
            await api(endpoint + "/" + r.id, { method: "DELETE" });
            await refresh();
          }),
        ]),
      ),
    );
    if (!items.length)
      attached.append(
        E(
          "p",
          { class: "empty-note" },
          "No resources linked. Add one from your library.",
        ),
      );
  }
  async function find(append = false) {
    const q = new URLSearchParams({ search: search.input.value, offset });
    if (category.input.value) q.set("category", category.input.value);
    const r = await api("/v1/resources?" + q);
    if (!append)
      choice.input.replaceChildren(
        E("option", { value: "" }, "Choose resource"),
      );
    choice.input.append(
      ...r.items
        .filter((r) => r.status === "ready")
        .map((r) => E("option", { value: r.id }, r.title + " · " + r.category)),
    );
    more.hidden = r.items.length < 20;
  }
  const panel = section(
    "Teaching resources",
    attached,
    E(
      "p",
      {},
      "Removing a link keeps the library resource and its other links.",
    ),
    submitForm([search, category], "Search library", async () => {
      offset = 0;
      await find();
    }),
    choice.wrapper,
    more,
    button("Add from library", async () => {
      if (!choice.input.value) throw new Error("Choose a library resource.");
      await api(endpoint + "/" + choice.input.value, { method: "PUT" });
      await refresh();
    }),
    link("Upload to library", "/files"),
    link("Manage library / video links", "/files"),
  );
  await Promise.all([refresh(), find()]);
  return panel;
}
export async function lessonControls(item, workspace) {
  const data = await api("/v1/teaching");
  const options = data.workspaces
    .map((w) => {
      const s = data.subjects.find((s) => s.id === w.subject_id),
        c = data.classes.find((c) => c.id === w.class_id);
      return { ...w, s, c };
    })
    .filter(
      (w) =>
        w.id === item.workspace_id || (!w.s.archived_at && !w.c.archived_at),
    );
  const destinations = options.map((w) => [
    w.id,
    w.s.name + " / Grade " + w.c.grade + " / " + w.c.name,
  ]);
  const assignment = selectField(
    "Class workspace",
    [["", "Unassigned"], ...destinations],
    item.workspace_id || "",
  );
  const term = selectField(
    "Term",
    [["", "Not set"], ...[1, 2, 3, 4].map((t) => [t, "Term " + t])],
    item.term || "",
  );
  const week = ui.field({
    label: "Week (optional)",
    type: "number",
    extraAttrs: { min: 1, max: 53 },
  });
  week.input.value = item.week || "";
  const status = selectField(
    "Lesson status",
    STATUSES,
    item.lesson_status || "Draft",
  );
  const destination = selectField("Duplicate into class", [
    ["", "Choose destination"],
    ...destinations.filter(([id]) => id !== item.workspace_id),
  ]);
  return {
    wrapper: E("div", { class: "lesson-metadata" }, [
      assignment.wrapper,
      term.wrapper,
      week.wrapper,
      status.wrapper,
    ]),
    destination,
    inputs: [assignment.input, term.input, week.input, status.input],
    read: () => ({
      workspaceId: assignment.input.value || null,
      term: Number(term.input.value) || null,
      week: Number(week.input.value) || null,
      status: status.input.value,
    }),
    breadcrumbs: lessonBreadcrumbs(workspace),
  };
}
export function videoLinkForm(onSaved) {
  const title = ui.field({
      label: "Video title",
      extraAttrs: { required: true, maxlength: 200 },
    }),
    url = ui.field({
      label: "HTTPS video link",
      type: "url",
      extraAttrs: { required: true, maxlength: 2000, placeholder: "https://" },
    });
  return section(
    "Add a video link",
    E(
      "p",
      {},
      "Videos open on the linked website. Video files cannot be uploaded.",
    ),
    submitForm([title, url], "Save video link", async () => {
      await api("/v1/resources/video-links", {
        method: "POST",
        body: { title: title.input.value, url: url.input.value },
      });
      title.input.value = "";
      url.input.value = "";
      await onSaved();
    }),
  );
}
