import { mountReader } from "./readers.js";
import { createAutosave } from "./autosave.js";
let ui,
  editor = null,
  cleanup = () => {};
export function setupWorkspace(helpers) {
  ui = helpers;
}
const E = (...args) => ui.el(...args);
const api = (...args) => ui.apiFetch(...args);
const routeFor = (item) =>
  item.kind === "file"
    ? "/file?id=" + item.item_id
    : "/editor?id=" + (item.id || item.item_id);
const button = (text, action, variant = "ghost") =>
  E(
    "button",
    {
      type: "button",
      class: "btn btn--" + variant,
      onclick: async (e) => {
        const b = e.currentTarget;
        b.disabled = true;
        try {
          await action();
        } catch (err) {
          ui.toast(err.message || ui.friendlyError(err), "error");
        } finally {
          b.disabled = false;
        }
      },
    },
    text,
  );
const link = (text, path) =>
  E("a", { href: "#" + path, class: "btn btn--ghost" }, text);
const head = (title, subtitle) =>
  E("div", { class: "page-head" }, [
    E("p", { class: "eyebrow" }, "CHIX / YOUR WORKSPACE"),
    E("h1", {}, title),
    E("p", {}, subtitle),
  ]);
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const friendlyDate = (value) =>
  value
    ? new Date(value).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "Not scheduled";
const dateOnly = (value) => (value ? String(value).slice(0, 10) : "");
function list(items, kind) {
  return E(
    "div",
    { class: "work-list" },
    items.length
      ? items.map((item) =>
          E(
            "a",
            {
              class: "work-row",
              href:
                "#" +
                (kind === "file"
                  ? "/file?id=" + item.id
                  : "/editor?id=" + item.id),
            },
            [
              E(
                "span",
                { class: "work-icon", "aria-hidden": "true" },
                kind === "file" ? "↗" : "≡",
              ),
              E("span", {}, [
                E("strong", {}, item.title),
                ...(item.status && item.status !== "ready"
                  ? [
                      E(
                        "small",
                        { role: "status" },
                        item.status.replaceAll("_", " "),
                      ),
                    ]
                  : []),
                E(
                  "small",
                  {},
                  item.planned_date
                    ? friendlyDate(item.planned_date)
                    : "Updated " +
                        friendlyDate(item.updated_at || item.created_at),
                ),
              ]),
              E("span", { "aria-hidden": "true" }, "→"),
            ],
          ),
        )
      : [
          E(
            "p",
            { class: "empty-note" },
            "A little room for your next idea. Create something to get started.",
          ),
        ],
  );
}
function section(title, body, action) {
  return E("section", { class: "card" }, [
    E("div", { class: "card__head" }, [E("h2", {}, title), action]),
    body,
  ]);
}
async function create(kind) {
  const r = await api("/v1/documents", {
    method: "POST",
    body: {
      kind,
      title:
        kind === "note"
          ? "Untitled note"
          : kind === "template"
            ? "Untitled template"
            : "Untitled lesson",
      content: {},
    },
  });
  ui.navigate("/editor?id=" + r.item.id);
}
export async function beforeLeave(commit = true) {
  if (editor) {
    try {
      await editor.save.flush();
    } catch {
      const result = await ui.confirmDialog({
        title: "Your changes are not saved",
        body: "Stay here to retry, download your draft, or save it as a copy. Leaving will discard the unsaved draft.",
        confirmLabel: "Discard and leave",
        danger: true,
      });
      if (!result.confirmed) return false;
    }
    if (!commit) return true;
    editor.save.dispose();
    editor = null;
  }
  if (!commit) return true;
  cleanup();
  cleanup = () => {};
  return true;
}
export function hasUnsaved() {
  return Boolean(editor?.save.dirty());
}
export async function renderHome() {
  if (ui.state.user) return renderDashboard();
  const { viewRoot: root } = ui;
  const share = E("div", { class: "share-panel", hidden: true });
  const url = location.origin + location.pathname;
  const urlInput = E("input", {
    value: url,
    readonly: true,
    "aria-label": "Chix address",
  });
  share.append(
    E("p", {}, "Good teaching deserves a little company."),
    urlInput,
    button("Copy link", async () => {
      try {
        await navigator.clipboard.writeText(url);
        ui.toast("Chix link copied.", "success");
      } catch {
        urlInput.focus();
        urlInput.select();
        ui.toast("Select and copy the address above.");
      }
    }),
  );
  if (navigator.share)
    share.append(
      button("Share with…", async () => {
        try {
          await navigator.share({
            title: "Chix",
            text: "A calmer space for your teaching day.",
            url,
          });
        } catch (err) {
          if (err.name !== "AbortError") {
            urlInput.focus();
            urlInput.select();
            ui.toast("Sharing unavailable. Copy the address above.");
          }
        }
      }),
    );
  const toggle = button("Share Chix ↗", () => {
    share.hidden = !share.hidden;
    toggle.setAttribute("aria-expanded", String(!share.hidden));
    if (!share.hidden) urlInput.focus();
  });
  toggle.setAttribute("aria-expanded", "false");
  root.append(
    E("section", { class: "home-hero" }, [
      E("p", { class: "eyebrow" }, "A LITTLE STRUCTURE. MORE ROOM TO TEACH."),
      E("h1", {}, ["Make space for ", E("em", {}, "good teaching.")]),
      E(
        "p",
        { class: "hero-intro" },
        "Your lessons, notes and teaching resources, together in one thoughtful workspace. Pick up exactly where your day left off.",
      ),
      E("div", { class: "hero-rule" }),
      E("div", { class: "home-features" }, [
        E("article", {}, [
          E("span", { class: "feature-number" }, "01 / PLAN"),
          E("h2", {}, "Start with an idea."),
          E(
            "p",
            {},
            "Shape a lesson, reuse a favourite structure, and see what’s coming next.",
          ),
        ]),
        E("article", {}, [
          E("span", { class: "feature-number" }, "02 / GATHER"),
          E("h2", {}, "Keep it together."),
          E(
            "p",
            {},
            "Give your notes and classroom resources a place to belong.",
          ),
        ]),
        E("article", {}, [
          E("span", { class: "feature-number" }, "03 / RETURN"),
          E("h2", {}, "Find your place."),
          E(
            "p",
            {},
            "Come back to your last note, lesson section, or saved reading bookmark.",
          ),
        ]),
      ]),
    ]),
    E("section", { class: "home-bottom" }, [
      E("div", {}, [
        E("p", { class: "eyebrow" }, "READY FOR YOUR NEXT CHAPTER?"),
        E("h2", {}, "A calmer teaching day starts here."),
      ]),
      E("div", { class: "btn-row" }, [
        ...(ui.state.user
          ? [
              E(
                "a",
                { href: "#/dashboard", class: "btn btn--primary" },
                "Open your workspace",
              ),
            ]
          : [
              link("Sign in", "/login"),
              E(
                "a",
                { href: "#/register", class: "btn btn--primary" },
                "Create account",
              ),
            ]),
        toggle,
      ]),
      share,
    ]),
    E(
      "footer",
      { class: "home-footer" },
      "Chix · Thoughtfully organised. Ready for tomorrow.",
    ),
  );
}
export async function renderDashboard(scheduleOnly = false) {
  const root = ui.viewRoot;
  const data = await api("/v1/workspace?today=" + today());
  if (scheduleOnly) root.append(head("Your teaching schedule", "A clear view of what’s coming next."));
  if (scheduleOnly) {
    const f = ui.field({ label: "View lessons on a date", type: "date" });
    f.input.value = today();
    const target = E("div", {});
    const load = async () => {
      const r = await api(
        "/v1/documents?kind=lesson&date=" + encodeURIComponent(f.input.value),
      );
      target.replaceChildren(list(r.items, "lesson"));
    };
    f.input.addEventListener("change", () =>
      load().catch((err) => ui.toast(ui.friendlyError(err), "error")),
    );
    root.append(
      section(
        "Lessons by date",
        E("div", { class: "form" }, [f.wrapper, target]),
      ),
      section("Upcoming lessons", list(data.lessons, "lesson")),
      section(
        "Recent plans",
        list(
          data.activity.filter((i) => i.kind === "lesson"),
          "lesson",
        ),
      ),
    );
    await load();
    return;
  }

  const home = E("div", {class:"workspace-home"});
  root.append(home);
  home.append(E("header", {class:"workspace-home__greeting"}, [
    E("p", {class:"eyebrow"}, "YOUR WORKSPACE"),
    E("h1", {}, ui.state.user.firstName ? "Welcome back, " + ui.state.user.firstName : "Welcome back"),
    E("p", {}, "A little space for your next idea."),
  ]), E("div", {class:"btn-row", "aria-label":"Create something new"}, [
    button("New note", () => create("note"), "primary"),
    button("New lesson plan", () => create("lesson")),
    link("Upload file", "/files"),
  ]));
  const type = item => ({note:"Note",lesson:"Lesson plan",template:"Template",file:"File"})[item.kind] ?? "Document";
  const route = item => (item.kind === "file" ? "/file?id=" : "/editor?id=") + encodeURIComponent(item.item_id ?? item.id);
  const stamp = item => item.opened_at ?? item.updated_at ?? item.created_at;
  const metadata = item => type(item) + (stamp(item) ? " · " + ui.formatDateTime(stamp(item)) : "");
  const last = data.resume?.[0];
  home.append(E("section", {class:"workspace-home__continue", "aria-labelledby":"continue-heading"}, [
    E("div", {}, [E("h2", {id:"continue-heading"}, "Continue where you left off"),
      ...(last ? [E("h3", {}, last.title), E("p", {}, metadata(last))]
        : [E("p", {}, "Start something new or open an existing item.")]),
    ]), ...(last ? [link("Continue", route(last))] : []),
  ]));
  try {
    const templates = (await api("/v1/documents?kind=template")).items.slice(0,4);
    if (templates.length) home.append(E("section", {"aria-labelledby":"templates-heading"}, [
      E("div", {class:"workspace-home__section-head"}, [E("h2", {id:"templates-heading"}, "Templates"),link("View all templates","/templates")]),
      E("div", {class:"workspace-home__templates"}, templates.map(item => E("a", {class:"workspace-home__template",href:"#"+route(item)}, [E("span", {}, item.title),E("small", {}, "Open template")]))),
    ]));
  } catch { home.append(E("p",{class:"card__hint"},"Templates are unavailable right now.")); }
  const seen = new Set();
  const recent = [...(data.resume??[]),...(data.activity??[]),...(data.files??[]).map(item=>({...item,kind:"file"}))]
    .sort((a,b)=>(Date.parse(stamp(b))||0)-(Date.parse(stamp(a))||0))
    .filter(item=>{const key=route(item);if(seen.has(key))return false;seen.add(key);return true;}).slice(0,8);
  home.append(E("section", {"aria-labelledby":"recent-heading"}, [
    E("div", {class:"workspace-home__section-head"}, [E("h2", {id:"recent-heading"}, "Recent"),E("nav",{"aria-label":"Browse your work"},[link("All notes","/notes"),link("All lesson plans","/lessons"),link("All files","/files")])]),
    recent.length ? E("ul", {class:"workspace-home__recent"}, recent.map(item=>E("li",{},E("a",{href:"#"+route(item)},[E("span",{},item.title),E("small",{},metadata(item))]))))
      : E("p", {class:"card__hint"}, "Your recent work will appear here."),
  ]));
}
export async function renderDocuments(kind) {
  const root = ui.viewRoot,
    title = { note: "Notes", lesson: "Lesson plans", template: "Templates" }[
      kind
    ];
  root.append(
    head(
      title,
      kind === "template"
        ? "Keep the structures that work. Make them your own."
        : "Your ideas, ready for the classroom.",
    ),
  );
  const search = ui.field({
      label: "Search " + title.toLowerCase(),
      type: "search",
    }),
    date = ui.field({ label: "Planned date", type: "date" }),
    subject = ui.field({ label: "Subject filter" });
  const results = E("div", {});
  let offset = 0,
    generation = 0;
  const load = async (append = false) => {
    const g = ++generation;
    const q = new URLSearchParams({
      kind,
      search: search.input.value,
      offset: String(offset),
    });
    if (kind === "lesson" && date.input.value) q.set("date", date.input.value);
    if (kind === "lesson" && subject.input.value)
      q.set("subject", subject.input.value);
    const r = await api("/v1/documents?" + q);
    if (g !== generation) return;
    if (!append) results.replaceChildren();
    results.append(list(r.items, kind));
    more.hidden = r.items.length < 20;
  };
  const more = button("Load more", async () => {
    offset += 20;
    await load(true);
  });
  const form = E("form", { class: "toolbar" }, [
    search.wrapper,
    ...(kind === "lesson" ? [subject.wrapper, date.wrapper] : []),
    E("button", { type: "submit", class: "btn btn--ghost" }, "Search"),
    button(
      "+ Create " + (kind === "template" ? "template" : kind),
      () => create(kind),
      "primary",
    ),
  ]);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    offset = 0;
    load().catch((err) => ui.toast(ui.friendlyError(err), "error"));
  });
  root.append(form, results, more);
  await load();
}
const labels = {
  subject: "Subject",
  grade: "Grade / class",
  topic: "Topic",
  duration: "Duration",
  objectives: "Learning objectives",
  priorKnowledge: "Prior knowledge",
  resources: "Resources",
  introduction: "Introduction",
  teachingActivities: "Teaching activities",
  learnerActivities: "Learner activities",
  assessment: "Assessment",
  differentiation: "Differentiation / learner support",
  homework: "Homework",
  reflection: "Reflection",
  notes: "Notes",
};
function downloadDraft(value) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const a = E("a", { href: url, download: "chalkline-draft.json" });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function renderEditor(params) {
  const id = params.get("id"),
    data = await api("/v1/documents/" + encodeURIComponent(id)),
    item = data.item,
    root = ui.viewRoot;
  const title = ui.field({
    label: "Document title",
    extraAttrs: { maxlength: 200 },
  });
  title.input.value = item.title;
  const planned = ui.field({ label: "Planned date", type: "date" });
  planned.input.value = dateOnly(item.planned_date);
  const form = E("div", { class: "editor-fields" }),
    inputs = {};
  const keys = item.kind === "note" ? { body: "Your note" } : labels;
  for (const [key, label] of Object.entries(keys)) {
    const input = E("textarea", {
      id: "editor-" + key,
      rows:
        item.kind === "note"
          ? 22
          : ["subject", "grade", "topic", "duration"].includes(key)
            ? 2
            : 5,
      maxlength: item.kind === "note" ? 300000 : 20000,
      spellcheck: true,
    });
    input.value = item.content[key] || "";
    inputs[key] = input;
    form.append(
      E("div", { class: "field editor-field" }, [
        E("label", { for: input.id }, label),
        input,
      ]),
    );
  }
  if (item.kind !== "note") {
    const groups = {
      Overview: ["subject", "grade", "topic", "date", "duration"],
      Planning: ["objectives", "priorKnowledge", "resources"],
      "Lesson flow": [
        "introduction",
        "teachingActivities",
        "learnerActivities",
      ],
      "Assessment & support": ["assessment", "differentiation", "homework"],
      "After lesson": ["reflection", "notes"],
    };
    for (const [name, keys] of Object.entries(groups)) {
      const details = E("details", { class: "lesson-group", open: true }, [
        E("summary", {}, name),
      ]);
      for (const key of keys)
        if (inputs[key]) details.append(inputs[key].parentElement);
      form.append(details);
    }
  }
  const status = E(
      "p",
      { class: "save-status", role: "status", "aria-live": "polite" },
      "Saved",
    ),
    error = E("p", { class: "form-error", role: "alert", hidden: true });
  const read = () => ({
    title: title.input.value.trim() || "Untitled",
    content: Object.fromEntries(
      Object.entries(inputs).map(([key, input]) => [key, input.value]),
    ),
    plannedDate: item.kind === "lesson" ? planned.input.value || null : null,
  });
  const save = createAutosave({
    read,
    revision: item.revision,
    write: async (body) => {
      try {
        return await api("/v1/documents/" + id, { method: "PATCH", body });
      } catch (error) {
        if (error.status === 401) {
          if (!(await ui.reauthenticate())) throw error;
          return api("/v1/documents/" + id, { method: "PATCH", body });
        }
        throw error;
      }
    },
    onStatus: (message, err) => {
      status.textContent = message;
      error.hidden = !err;
      if (err) error.textContent = ui.friendlyError(err);
    },
  });
  editor = { save };
  for (const input of [title.input, planned.input, ...Object.values(inputs)])
    input.addEventListener("input", () => save.changed());
  let resume = { ...data.resume },
    stateTimer,
    restoring = true;
  const persist = () =>
    api("/v1/resume/" + id, {
      method: "PUT",
      body: { kind: "document", state: resume },
    }).catch(() => ui.toast("Reading position could not be saved.", "error"));
  const update = () => {
    if (restoring) return;
    resume.windowScroll = window.scrollY;
    const active = document.activeElement;
    const entry = Object.entries(inputs).find(([, input]) => input === active);
    if (entry)
      resume = {
        ...resume,
        field: entry[0],
        cursor: active.selectionStart,
        selectionEnd: active.selectionEnd,
        scroll: active.scrollTop,
      };
    clearTimeout(stateTimer);
    stateTimer = setTimeout(persist, 1500);
  };
  for (const input of Object.values(inputs))
    for (const event of ["keyup", "click", "select", "scroll", "focus"])
      input.addEventListener(event, update);
  window.addEventListener("scroll", update, { passive: true });
  cleanup = () => {
    clearTimeout(stateTimer);
    window.removeEventListener("scroll", update);
    void persist();
    save.dispose();
  };

  const retry = button("Save now / retry", () => save.flush(), "primary");
  const copy = button("Save draft as a copy", async () => {
    const snapshot = read();
    const r = await api("/v1/documents", {
      method: "POST",
      body: {
        ...snapshot,
        kind: item.kind,
        title: (snapshot.title + " (copy)").slice(0, 200),
      },
    });
    if (JSON.stringify(read()) !== JSON.stringify(snapshot)) {
      ui.toast("Copy saved. Your newer edits are still here.");
      root.append(link("Open saved copy", "/editor?id=" + r.item.id));
      return;
    }
    save.dispose();
    editor = null;
    ui.navigate("/editor?id=" + r.item.id);
  });
  const duplicate = button(
    item.kind === "template" ? "Create lesson from template" : "Duplicate",
    async () => {
      await save.flush();
      const r = await api("/v1/documents/" + id + "/copy", {
        method: "POST",
        body: {
          kind: item.kind === "template" ? "lesson" : item.kind,
          title: (read().title + " (copy)").slice(0, 200),
        },
      });
      ui.navigate("/editor?id=" + r.item.id);
    },
  );
  const remove = button(
    "Delete",
    async () => {
      await save.flush();
      const result = await ui.confirmDialog({
        title: "Delete this " + item.kind + "?",
        body: "This removes the document and its saved revisions.",
        danger: true,
        confirmLabel: "Delete",
      });
      if (!result.confirmed) return;
      await api("/v1/documents/" + id, {
        method: "DELETE",
        body: { revision: save.revision },
      });
      save.dispose();
      editor = null;
      ui.navigate(
        item.kind === "note"
          ? "/notes"
          : item.kind === "template"
            ? "/templates"
            : "/lessons",
      );
    },
    "danger",
  );
  const actions = E("div", { class: "btn-row" }, [
    retry,
    duplicate,
    copy,
    button("Download draft", () => downloadDraft(read())),
    button("Review latest version", async () => {
      const r = await api("/v1/documents/" + id);
      const d = E(
        "dialog",
        { class: "revision-dialog", "aria-label": "Latest saved version" },
        [
          E("h2", {}, r.item.title),
          E("pre", {}, JSON.stringify(r.item.content, null, 2)),
          button("Close", () => {
            d.close();
            d.remove();
          }),
        ],
      );
      document.body.append(d);
      d.showModal();
    }),
    remove,
  ]);
  if (item.kind === "lesson")
    actions.append(
      button("Save as template", async () => {
        await save.flush();
        const r = await api("/v1/documents/" + id + "/copy", {
          method: "POST",
          body: { kind: "template", title: read().title },
        });
        ui.navigate("/editor?id=" + r.item.id);
      }),
    );
  root.append(
    head(
      item.kind === "note"
        ? "Room for your thoughts"
        : item.kind === "template"
          ? "A structure worth keeping"
          : "Shape your next lesson",
      "Changes save automatically. Your place is remembered across devices.",
    ),
    E("section", { class: "card editor-card" }, [
      title.wrapper,
      ...(item.kind === "lesson" ? [planned.wrapper] : []),
      E("div", { class: "editor-actions" }, [status, actions]),
      error,
      form,
    ]),
  );
  if (item.kind === "lesson") {
    try {
      const files = await api("/v1/resources"),
        select = E("select", { "aria-label": "Choose resource to attach" }, [
          E("option", { value: "" }, "Choose a resource"),
          ...files.items
            .filter((r) => r.status === undefined || r.status === "ready")
            .map((r) => E("option", { value: r.id }, r.title)),
        ]);
      const attached = E("div", {});
      const refresh = async () => {
        const r = await api("/v1/documents/" + id);
        attached.replaceChildren(
          ...r.resources.map((f) =>
            E("div", { class: "entity-row" }, [
              E("a", { href: "#/file?id=" + f.id }, f.title),
              button("Detach", async () => {
                await api("/v1/documents/" + id + "/resources/" + f.id, {
                  method: "DELETE",
                });
                await refresh();
              }),
            ]),
          ),
        );
      };
      const search = ui.field({
        label: "Search resources to attach",
        type: "search",
      });
      root.append(
        section(
          "Attached resources",
          E("div", { class: "form" }, [
            attached,
            search.wrapper,
            button("Find resources", async () => {
              const r = await api(
                "/v1/resources?search=" +
                  encodeURIComponent(search.input.value),
              );
              select.replaceChildren(
                E("option", { value: "" }, "Choose a resource"),
                ...r.items.map((f) => E("option", { value: f.id }, f.title)),
              );
            }),
            select,
            button("Attach resource", async () => {
              if (!select.value) return;
              await api("/v1/documents/" + id + "/resources/" + select.value, {
                method: "PUT",
              });
              await refresh();
            }),
          ]),
        ),
      );
      await refresh();
    } catch (error) {
      root.append(
        E(
          "p",
          { class: "form-error", role: "alert" },
          "Attachments could not load. Your lesson editor is still available. " +
            ui.friendlyError(error),
        ),
      );
    }
  }
  const active = inputs[resume.field] || Object.values(inputs)[0];
  requestAnimationFrame(() => {
    if (!active.isConnected) return;
    active.focus({ preventScroll: true });
    active.setSelectionRange(
      resume.cursor || 0,
      resume.selectionEnd ?? resume.cursor ?? 0,
    );
    active.scrollTop = resume.scroll || 0;
    window.scrollTo(0, resume.windowScroll || 0);
    requestAnimationFrame(() => {
      restoring = false;
    });
  });
  await persist();
}
export async function renderFiles() {
  const root = ui.viewRoot;
  root.append(
    head(
      "Your teaching resources",
      "A private library for the things you bring to class.",
    ),
  );
  const search = ui.field({ label: "Search files", type: "search" }),
    input = E("input", {
      type: "file",
      accept: ".pdf,.docx,.pptx,.xlsx,.txt,.png,.jpg,.jpeg,.webp",
      id: "resource-upload",
    }),
    status = E("p", { role: "status" }),
    results = E("div", {});
  const sort = E(
      "select",
      { "aria-label": "Sort files" },
      ["recent", "name", "size"].map((v) => E("option", { value: v }, v)),
    ),
    type = E(
      "select",
      { "aria-label": "Filter file type" },
      ["all", "image", "document", "text"].map((v) =>
        E("option", { value: v }, v),
      ),
    );
  let offset = 0,
    maxBytes = 20 * 1024 * 1024;
  const more = button("Load more", async () => {
    offset += 20;
    await load(true);
  });
  async function load(append = false) {
    const r = await api(
      "/v1/resources?" +
        new URLSearchParams({
          search: search.input.value,
          sort: sort.value,
          type: type.value,
          offset: String(offset),
        }),
    );
    maxBytes = r.uploadMaxBytes;
    if (r.usage) {
      input.disabled = !r.usage.verified;
      upload.disabled = !r.usage.verified;
      status.textContent = r.usage.verified
        ? `Storage: ${Math.ceil(Number(r.usage.storage_used_bytes) / 1048576)} / ${Math.floor(Number(r.usage.storage_quota_bytes) / 1048576)} MiB used.`
        : "Verify your email to upload files. Notes and lessons are available now.";
    }
    if (!append) results.replaceChildren();
    results.append(list(r.items, "file"));
    more.hidden = r.items.length < 20;
  }
  const upload = button(
    "Upload resource",
    async () => {
      const file = input.files[0];
      if (!file) {
        status.textContent = "Choose a file first.";
        return;
      }
      if (file.size > maxBytes) {
        status.textContent =
          "File exceeds the " +
          Math.floor(maxBytes / 1024 / 1024) +
          " MB limit.";
        return;
      }
      status.textContent = "Uploading and checking your file…";
      const body = new FormData();
      body.append("file", file);
      try {
        const response = await fetch("/v1/resources", {
          method: "POST",
          credentials: "same-origin",
          headers: { "X-File-Size": String(file.size) },
          body,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Upload failed.");
        status.textContent = "Uploaded. Private scanning is in progress.";
        input.value = "";
        offset = 0;
        await load();
      } catch (err) {
        status.textContent = "Upload failed. " + err.message;
      }
    },
    "primary",
  );
  root.append(
    section(
      "Add to your library",
      E("div", { class: "upload-area" }, [
        E(
          "label",
          { for: "resource-upload" },
          "PDF, Office documents, text, and common images",
        ),
        input,
        upload,
        status,
      ]),
    ),
  );
  const form = E("form", { class: "toolbar" }, [
    search.wrapper,
    sort,
    type,
    E("button", { type: "submit", class: "btn btn--ghost" }, "Find files"),
  ]);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    offset = 0;
    load().catch((err) => ui.toast(ui.friendlyError(err), "error"));
  });
  root.append(form, results, more);
  await load();
}
export async function renderFile(params) {
  const id = params.get("id"),
    data = await api("/v1/resources/" + id),
    item = data.item,
    root = ui.viewRoot;
  root.append(
    head(
      item.title,
      Math.ceil(Number(item.size_bytes) / 1024) + " KB · " + item.mime,
    ),
  );
  if (item.status && item.status !== "ready") {
    const status = E(
      "p",
      { role: "status" },
      ["scan_failed", "quarantined"].includes(item.status)
        ? "This file is blocked. Scanning failed or the file was rejected. You can remove it and upload a safe replacement."
        : "Your file is being checked privately. It will open here once scanning succeeds.",
    );
    root.append(
      E("section", { class: "card" }, [
        status,
        link("Back to files", "/files"),
        ...(["scan_failed", "quarantined"].includes(item.status)
          ? [
              button("Move to Trash", async () => {
                await api("/v1/resources/" + id, { method: "DELETE" });
                ui.navigate("/files");
              }),
            ]
          : []),
      ]),
    );
    let stopped = false,
      timer;
    const started = Date.now();
    const poll = async () => {
      if (stopped || Date.now() - started > 300000) return;
      try {
        const r = await api("/v1/resources/" + id);
        if (r.item.status === "ready") {
          root.replaceChildren();
          await renderFile(params);
          return;
        }
        if (["scan_failed", "quarantined"].includes(r.item.status)) {
          status.textContent =
            "This file could not pass scanning. Return to Files to remove it or retry later.";
          return;
        }
      } catch {
        status.textContent =
          "Unable to check scan progress. Return to Files and try again.";
        return;
      }
      timer = setTimeout(poll, 2000);
    };
    if (!["scan_failed", "quarantined"].includes(item.status))
      timer = setTimeout(poll, 2000);
    cleanup = () => {
      stopped = true;
      clearTimeout(timer);
    };
    return;
  }
  const title = ui.field({
    label: "Display name",
    extraAttrs: { maxlength: 200 },
  });
  title.input.value = item.title;
  const page = ui.field({
    label: "Reading bookmark — page",
    type: "number",
    extraAttrs: { min: 1, max: 100000 },
  });
  page.input.value = data.resume.page || 1;
  const sectionField = ui.field({ label: "Bookmark description" });
  sectionField.input.value = data.resume.section || "";
  let resume = { ...data.resume };
  const persist = async () => {
    resume.page = Number(page.input.value) || 1;
    resume.section = sectionField.input.value.slice(0, 200);
    await api("/v1/resume/" + id, {
      method: "PUT",
      body: { kind: "resource", state: resume },
    });
  };
  const preview = E("section", { class: "card file-preview" }, [
    E("p", {}, "Loading preview…"),
  ]);
  root.append(
    E("div", { class: "btn-row" }, [
      E(
        "a",
        {
          class: "btn btn--ghost",
          href: "/v1/resources/" + id + "/download",
          download: item.title,
        },
        "Download",
      ),
      button(
        "Delete file",
        async () => {
          const result = await ui.confirmDialog({
            title: "Delete this file?",
            body: "It will move to Trash for 30 days. Storage remains counted until permanent purge.",
            danger: true,
            confirmLabel: "Delete",
          });
          if (!result.confirmed) return;
          await api("/v1/resources/" + id, { method: "DELETE" });
          cleanup = () => {
            stopReader();
          };
          ui.navigate("/files");
        },
        "danger",
      ),
    ]),
    section(
      "File details",
      E("div", { class: "form" }, [
        title.wrapper,
        button("Rename", async () => {
          await api("/v1/resources/" + id, {
            method: "PATCH",
            body: { title: title.input.value },
          });
          ui.toast("Display name updated.", "success");
        }),
        page.wrapper,
        sectionField.wrapper,
        button("Save reading bookmark", async () => {
          await persist();
          ui.toast("Bookmark saved.", "success");
        }),
      ]),
    ),
    preview,
  );
  const stopReader = await mountReader({
    root: preview,
    item,
    resume,
    el: E,
    api,
    onPage: (value) => {
      page.input.value = value;
      void persist().catch(() => {});
    },
  });
  preview.scrollTop = resume.scroll || 0;
  let timer;
  preview.addEventListener("scroll", () => {
    resume.scroll = preview.scrollTop;
    clearTimeout(timer);
    timer = setTimeout(() => persist().catch(() => {}), 1500);
  });
  cleanup = () => {
    clearTimeout(timer);
    void persist().catch(() => {});
  };
  await persist();
}
export async function renderDeviceApproval(params) {
  const root = ui.viewRoot,
    pending = await api("/v1/devices/pending");
  root.append(
    head(
      "Confirm your new browser",
      "Open Chix on a trusted signed-in device, then go to Account / Security → Devices.",
    ),
  );
  const status = E("p", { role: "status" }, "Waiting for approval…");
  const recovery = ui.field({
    label: "Recovery code or emailed approval token",
    autocomplete: "off",
  });
  root.append(
    E("section", { class: "card approval-card" }, [
      E("p", {}, "Match this number on your trusted device"),
      E("strong", { class: "matching-number" }, pending.number),
      E("p", {}, "Expires " + ui.formatDateTime(pending.expiresAt)),
      status,
      button("Check approval", complete, "primary"),
    ]),
    section(
      "Lost access to your trusted device?",
      E("div", { class: "form" }, [
        E(
          "p",
          {},
          "Sign in with a passkey, use a saved recovery code, or request approval at your verified email address. Recovery signs out your previous devices.",
        ),
        link("Sign in with a passkey", "/login"),
        recovery.wrapper,
        button("Use recovery token", async () => {
          await api("/v1/devices/recovery/confirm", {
            method: "POST",
            body: { token: recovery.input.value.trim() },
          });
          await complete();
        }),
        button("Email a recovery link", async () => {
          await api("/v1/devices/recovery/request", { method: "POST" });
          ui.toast("Recovery notification queued. Check your verified email.");
        }),
      ]),
    ),
  );
  async function complete() {
    const current = await api("/v1/devices/pending");
    if (current.status === "approved") {
      await api("/v1/devices/complete", {
        method: "POST",
        body: { trustDevice: ui.state.trustDevice === true },
      });
      await ui.loadSession();
      ui.navigate("/dashboard");
    } else
      status.textContent =
        current.status === "denied"
          ? "Request denied. Start sign-in again."
          : "Still waiting for approval.";
  }
  if (params.get("token")) {
    recovery.input.value = params.get("token");
    history.replaceState(null, "", "#/device");
  }
  const interval = setInterval(() => {
    if (document.visibilityState === "visible")
      complete().catch((err) => {
        status.textContent = ui.friendlyError(err);
        clearInterval(interval);
      });
  }, 10000);
  cleanup = () => clearInterval(interval);
}
export async function renderDevices() {
  const root = ui.viewRoot,
    data = await api("/v1/me/devices");
  root.append(
    head(
      "Devices & security",
      "Approve browsers you recognise. Keep recovery codes somewhere safe.",
    ),
  );
  const requests = E("div", {});
  for (const p of data.pending) {
    const number = ui.field({
      label: "Number shown on the requesting browser",
      type: "number",
      extraAttrs: { min: 10, max: 99 },
    });
    requests.append(
      section(
        "New browser sign-in",
        E("div", { class: "form" }, [
          E("p", {}, ui.describeUserAgent(p.label) + " · " + p.ip),
          E("p", {}, ui.formatDateTime(p.created_at)),
          number.wrapper,
          button(
            "Approve matching number",
            async () => {
              await ui.withReauth(() =>
                api("/v1/me/devices/requests/" + p.id, {
                  method: "POST",
                  body: {
                    decision: "approve",
                    number: Number(number.input.value),
                  },
                }),
              );
              ui.navigate("/devices");
            },
            "primary",
          ),
          button(
            "Deny",
            async () => {
              await ui.withReauth(() =>
                api("/v1/me/devices/requests/" + p.id, {
                  method: "POST",
                  body: { decision: "deny" },
                }),
              );
              ui.navigate("/devices");
            },
            "danger",
          ),
        ]),
      ),
    );
  }
  if (!data.pending.length)
    requests.append(
      E("p", { class: "empty-note" }, "No pending sign-in requests."),
    );
  root.append(
    section(
      "Sign-in requests",
      requests,
      button("Refresh", () => ui.navigate("/devices")),
    ),
    section(
      "Trusted devices",
      E(
        "div",
        {},
        data.devices.map((d) =>
          E("div", { class: "entity-row" }, [
            E("div", {}, [
              E(
                "strong",
                {},
                ui.describeUserAgent(d.label) +
                  (d.id === data.currentDeviceId ? " · This browser" : ""),
              ),
              E(
                "p",
                {},
                d.revoked_at
                  ? "Revoked"
                  : "Trust expires " + friendlyDate(d.expires_at),
              ),
            ]),
            !d.revoked_at
              ? button("Revoke", async () => {
                  const c = await ui.confirmDialog({
                    title: "Revoke this browser?",
                    body: "Its sessions will be signed out and it will need approval next time.",
                    danger: true,
                    confirmLabel: "Revoke",
                  });
                  if (!c.confirmed) return;
                  await ui.withReauth(() =>
                    api("/v1/me/devices/" + d.id, { method: "DELETE" }),
                  );
                  await ui.loadSession();
                  ui.navigate(ui.state.user ? "/devices" : "/login");
                })
              : null,
          ]),
        ),
      ),
    ),
  );
  const codes = E("div", {});
  root.append(
    section(
      "Recovery codes",
      E("div", { class: "form" }, [
        E(
          "p",
          {},
          "Generate eight single-use codes. New codes replace all previous codes. Save them outside Chix.",
        ),
        button("Generate recovery codes", async () => {
          const c = await ui.confirmDialog({
            title: "Replace recovery codes?",
            body: "Previously generated codes will stop working.",
            confirmLabel: "Generate",
          });
          if (!c.confirmed) return;
          const r = await ui.withReauth(() =>
            api("/v1/me/recovery-codes", { method: "POST" }),
          );
          codes.replaceChildren(
            E("pre", { class: "recovery-codes" }, r.codes.join("\n")),
            button("Download codes", () =>
              downloadDraft({ recoveryCodes: r.codes }),
            ),
          );
        }),
        codes,
      ]),
    ),
    section(
      "Recent security activity",
      E(
        "div",
        {},
        data.events.map((e) =>
          E("div", { class: "entity-row" }, [
            E("span", {}, e.event.replaceAll("_", " ")),
            E("small", {}, ui.formatDateTime(e.created_at)),
          ]),
        ),
      ),
    ),
  );
}
