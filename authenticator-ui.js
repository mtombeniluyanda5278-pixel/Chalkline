import { createLoader } from "./loading.js";
export function authenticatorCard({
  el,
  field,
  apiFetch,
  withReauth,
  confirmDialog,
  toast,
  loadSession,
}) {
  const content = el("div", {});
  const root = el("div", { class: "card authenticator-card" }, [
    el("h2", {}, "Authenticator app"),
    el(
      "p",
      { class: "card__hint" },
      "Sign in with a six-digit code from your preferred authenticator app. Email sign-in stays available if you lose access to the app.",
    ),
    content,
  ]);
  const button = (label, action) =>
    el(
      "button",
      {
        type: "button",
        class: "btn btn--ghost",
        onclick: async (e) => {
          const target = e.currentTarget;
          target.disabled = true;
          try {
            await action();
          } catch (error) {
            toast(error.message, "error");
          } finally {
            target.disabled = false;
          }
        },
      },
      label,
    );
  async function refresh() {
    content.replaceChildren(createLoader("Loading authenticator…"));
    try {
      const status = await apiFetch("/v1/auth/authenticator");
      content.replaceChildren(
        status.enabled
          ? el("p", { role: "status" }, "Authenticator connected")
          : el("p", {}, "No authenticator connected yet."),
      );
      if (status.enabled) {
        content.append(
          button("Remove authenticator", async () => {
            const answer = await confirmDialog({
              title: "Remove authenticator?",
              body: "Codes from this app will stop working. You can still sign in by email or passkey. Other sessions will be signed out.",
              confirmLabel: "Remove",
              danger: true,
            });
            if (!answer.confirmed) return;
            await withReauth(() =>
              apiFetch("/v1/auth/authenticator", { method: "DELETE" }),
            );
            await loadSession();
            await refresh();
          }),
        );
      } else content.append(button("Set up authenticator", setup));
    } catch (error) {
      content.replaceChildren(
        el("p", { role: "status" }, error.message),
        button("Retry", refresh),
      );
    }
  }
  async function setup() {
    const data = await withReauth(() =>
      apiFetch("/v1/auth/authenticator/setup", { method: "POST" }),
    );
    const code = field({
      label: "6-digit authenticator code",
      type: "text",
      required: true,
      autocomplete: "one-time-code",
      extraAttrs: { inputmode: "numeric", pattern: "[0-9]{6}", maxlength: 6 },
    });
    const key = el("input", {
      type: "text",
      readonly: true,
      value: data.secret,
      "aria-label": "Manual authenticator setup key",
      class: "authenticator-key",
      autocomplete: "off",
      spellcheck: "false",
    });
    const status = el("p", { role: "status" });
    const submit = el(
      "button",
      { type: "submit", class: "btn btn--primary" },
      "Connect authenticator",
    );
    const form = el("form", { class: "form" }, [code.wrapper, submit, status]);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (submit.disabled || !form.reportValidity()) return;
      submit.disabled = true;
      status.textContent = "Checking code…";
      try {
        await apiFetch("/v1/auth/authenticator/confirm", {
          method: "POST",
          body: { code: code.input.value.trim() },
        });
        key.value = "";
        content.replaceChildren();
        await loadSession();
        await refresh();
        toast("Authenticator connected.", "success");
      } catch (error) {
        status.textContent = error.message;
      } finally {
        submit.disabled = false;
      }
    });
    content.replaceChildren(
      el(
        "p",
        {},
        "Scan this QR code in your authenticator app, or enter the setup key manually. Setup expires in 10 minutes.",
      ),
      el("img", {
        src: data.qr,
        alt: "Authenticator setup QR code",
        width: 256,
        height: 256,
        class: "authenticator-qr",
      }),
      el("details", {}, [
        el("summary", {}, "Enter setup key manually"),
        el("p", {}, `Account: ${data.account} · Issuer: Chix`),
        key,
        el(
          "p",
          { class: "card__hint" },
          "Time-based (TOTP) · 6 digits · 30 seconds · SHA-1",
        ),
        button("Copy setup key", async () => {
          await navigator.clipboard.writeText(key.value);
          toast("Setup key copied.");
        }),
      ]),
      el(
        "p",
        { class: "card__hint" },
        "Keep this setup key private. Enter a code below to finish connecting the app.",
      ),
      form,
      button("Cancel setup", async () => {
        await apiFetch("/v1/auth/authenticator/setup", { method: "DELETE" });
        key.value = "";
        await refresh();
      }),
    );
    code.input.focus();
  }
  void refresh();
  return root;
}
