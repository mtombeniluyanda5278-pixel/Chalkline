import { authenticatorCard } from "./authenticator-ui.js";
import { setupLegal, renderPrivacy, renderTerms } from "./legal.js";
import { createLoader } from "./loading.js";
import { renderLessons, renderTimetables } from "./lessons.js";
import {
  setupExtras,
  mountBot,
  humanProof,
  renderPreferences,
  appearanceSettings,
  renderOnboarding,
  renderRecoveryLink,
  renderDiscovery,
  renderFeedback,
  renderTrash,
  renderAdmin,
} from "./extras.js";
import {
  setupWorkspace,
  beforeLeave,
  hasUnsaved,
  renderHome,
  renderDashboard,
  renderDocuments,
  renderEditor,
  renderFiles,
  renderFile,
  renderDeviceApproval,
  renderDevices,
} from "./workspace.js";
const COUNTRIES = [
  ["AF", "Afghanistan"],
  ["AL", "Albania"],
  ["DZ", "Algeria"],
  ["AD", "Andorra"],
  ["AO", "Angola"],
  ["AG", "Antigua and Barbuda"],
  ["AR", "Argentina"],
  ["AM", "Armenia"],
  ["AU", "Australia"],
  ["AT", "Austria"],
  ["AZ", "Azerbaijan"],
  ["BS", "Bahamas"],
  ["BH", "Bahrain"],
  ["BD", "Bangladesh"],
  ["BB", "Barbados"],
  ["BY", "Belarus"],
  ["BE", "Belgium"],
  ["BZ", "Belize"],
  ["BJ", "Benin"],
  ["BT", "Bhutan"],
  ["BO", "Bolivia"],
  ["BA", "Bosnia and Herzegovina"],
  ["BW", "Botswana"],
  ["BR", "Brazil"],
  ["BN", "Brunei"],
  ["BG", "Bulgaria"],
  ["BF", "Burkina Faso"],
  ["BI", "Burundi"],
  ["CV", "Cabo Verde"],
  ["KH", "Cambodia"],
  ["CM", "Cameroon"],
  ["CA", "Canada"],
  ["CF", "Central African Republic"],
  ["TD", "Chad"],
  ["CL", "Chile"],
  ["CN", "China"],
  ["CO", "Colombia"],
  ["KM", "Comoros"],
  ["CG", "Congo"],
  ["CD", "Congo (DRC)"],
  ["CR", "Costa Rica"],
  ["CI", "Cote d'Ivoire"],
  ["HR", "Croatia"],
  ["CU", "Cuba"],
  ["CY", "Cyprus"],
  ["CZ", "Czechia"],
  ["DK", "Denmark"],
  ["DJ", "Djibouti"],
  ["DM", "Dominica"],
  ["DO", "Dominican Republic"],
  ["EC", "Ecuador"],
  ["EG", "Egypt"],
  ["SV", "El Salvador"],
  ["GQ", "Equatorial Guinea"],
  ["ER", "Eritrea"],
  ["EE", "Estonia"],
  ["SZ", "Eswatini"],
  ["ET", "Ethiopia"],
  ["FJ", "Fiji"],
  ["FI", "Finland"],
  ["FR", "France"],
  ["GA", "Gabon"],
  ["GM", "Gambia"],
  ["GE", "Georgia"],
  ["DE", "Germany"],
  ["GH", "Ghana"],
  ["GR", "Greece"],
  ["GD", "Grenada"],
  ["GT", "Guatemala"],
  ["GN", "Guinea"],
  ["GW", "Guinea-Bissau"],
  ["GY", "Guyana"],
  ["HT", "Haiti"],
  ["HN", "Honduras"],
  ["HU", "Hungary"],
  ["IS", "Iceland"],
  ["IN", "India"],
  ["ID", "Indonesia"],
  ["IR", "Iran"],
  ["IQ", "Iraq"],
  ["IE", "Ireland"],
  ["IL", "Israel"],
  ["IT", "Italy"],
  ["JM", "Jamaica"],
  ["JP", "Japan"],
  ["JO", "Jordan"],
  ["KZ", "Kazakhstan"],
  ["KE", "Kenya"],
  ["KI", "Kiribati"],
  ["KW", "Kuwait"],
  ["KG", "Kyrgyzstan"],
  ["LA", "Laos"],
  ["LV", "Latvia"],
  ["LB", "Lebanon"],
  ["LS", "Lesotho"],
  ["LR", "Liberia"],
  ["LY", "Libya"],
  ["LI", "Liechtenstein"],
  ["LT", "Lithuania"],
  ["LU", "Luxembourg"],
  ["MG", "Madagascar"],
  ["MW", "Malawi"],
  ["MY", "Malaysia"],
  ["MV", "Maldives"],
  ["ML", "Mali"],
  ["MT", "Malta"],
  ["MH", "Marshall Islands"],
  ["MR", "Mauritania"],
  ["MU", "Mauritius"],
  ["MX", "Mexico"],
  ["FM", "Micronesia"],
  ["MD", "Moldova"],
  ["MC", "Monaco"],
  ["MN", "Mongolia"],
  ["ME", "Montenegro"],
  ["MA", "Morocco"],
  ["MZ", "Mozambique"],
  ["MM", "Myanmar"],
  ["NA", "Namibia"],
  ["NR", "Nauru"],
  ["NP", "Nepal"],
  ["NL", "Netherlands"],
  ["NZ", "New Zealand"],
  ["NI", "Nicaragua"],
  ["NE", "Niger"],
  ["NG", "Nigeria"],
  ["KP", "North Korea"],
  ["MK", "North Macedonia"],
  ["NO", "Norway"],
  ["OM", "Oman"],
  ["PK", "Pakistan"],
  ["PW", "Palau"],
  ["PA", "Panama"],
  ["PG", "Papua New Guinea"],
  ["PY", "Paraguay"],
  ["PE", "Peru"],
  ["PH", "Philippines"],
  ["PL", "Poland"],
  ["PT", "Portugal"],
  ["QA", "Qatar"],
  ["RO", "Romania"],
  ["RU", "Russia"],
  ["RW", "Rwanda"],
  ["KN", "Saint Kitts and Nevis"],
  ["LC", "Saint Lucia"],
  ["VC", "Saint Vincent and the Grenadines"],
  ["WS", "Samoa"],
  ["SM", "San Marino"],
  ["ST", "Sao Tome and Principe"],
  ["SA", "Saudi Arabia"],
  ["SN", "Senegal"],
  ["RS", "Serbia"],
  ["SC", "Seychelles"],
  ["SL", "Sierra Leone"],
  ["SG", "Singapore"],
  ["SK", "Slovakia"],
  ["SI", "Slovenia"],
  ["SB", "Solomon Islands"],
  ["SO", "Somalia"],
  ["ZA", "South Africa"],
  ["KR", "South Korea"],
  ["SS", "South Sudan"],
  ["ES", "Spain"],
  ["LK", "Sri Lanka"],
  ["SD", "Sudan"],
  ["SR", "Suriname"],
  ["SE", "Sweden"],
  ["CH", "Switzerland"],
  ["SY", "Syria"],
  ["TW", "Taiwan"],
  ["TJ", "Tajikistan"],
  ["TZ", "Tanzania"],
  ["TH", "Thailand"],
  ["TL", "Timor-Leste"],
  ["TG", "Togo"],
  ["TO", "Tonga"],
  ["TT", "Trinidad and Tobago"],
  ["TN", "Tunisia"],
  ["TR", "Turkiye"],
  ["TM", "Turkmenistan"],
  ["TV", "Tuvalu"],
  ["UG", "Uganda"],
  ["UA", "Ukraine"],
  ["AE", "United Arab Emirates"],
  ["GB", "United Kingdom"],
  ["US", "United States"],
  ["UY", "Uruguay"],
  ["UZ", "Uzbekistan"],
  ["VU", "Vanuatu"],
  ["VA", "Vatican City"],
  ["VE", "Venezuela"],
  ["VN", "Vietnam"],
  ["YE", "Yemen"],
  ["ZM", "Zambia"],
  ["ZW", "Zimbabwe"],
];

/* ==========================================================================
   Chix — frontend logic
   Same-origin app: API_BASE is intentionally empty. `/v1/*` is reverse
   proxied to the backend at deployment. Do not point this at another origin.
   ========================================================================== */

const API_BASE = "";

/* ---------------------------------------------------------------------- */
/* DOM helpers — safe by construction: textContent/createElement/append   */
/* only. Nothing here ever parses a string as HTML.                       */
/* ---------------------------------------------------------------------- */

function el(tag, attrs, children) {
  const node = document.createElement(tag);
  attrs = attrs || {};
  for (const key of Object.keys(attrs)) {
    const value = attrs[key];
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key.indexOf("on") === 0 && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value === true) {
      node.setAttribute(key, "");
    } else {
      node.setAttribute(key, String(value));
    }
  }
  const kids =
    children === undefined
      ? []
      : Array.isArray(children)
        ? children
        : [children];
  for (const child of kids) {
    if (child === null || child === undefined || child === false) continue;
    node.append(
      child instanceof Node ? child : document.createTextNode(String(child)),
    );
  }
  return node;
}

function clearNode(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function fragment(children) {
  const f = document.createDocumentFragment();
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    f.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return f;
}

/* ---------------------------------------------------------------------- */
/* Toast                                                                  */
/* ---------------------------------------------------------------------- */

let toastTimer = null;
function toast(message, variant) {
  const t = document.getElementById("toast");
  t.textContent = message;
  if (variant) t.dataset.variant = variant;
  else delete t.dataset.variant;
  t.hidden = false;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    t.hidden = true;
  }, 5000);
}

/* ---------------------------------------------------------------------- */
/* API                                                                    */
/* ---------------------------------------------------------------------- */

class ApiError extends Error {
  constructor(message, status, code, details, retryAfter) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.retryAfter = retryAfter;
  }
}

async function apiFetch(path, options) {
  options = options || {};
  const res = await fetch(API_BASE + path, {
    method: options.method || "GET",
    headers: Object.assign(
      options.body !== undefined ? { "Content-Type": "application/json" } : {},
      options.headers || {},
    ),
    credentials: "same-origin",
    cache: "no-store",
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  let data = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (err) {
      data = null;
    }
  }

  if (!res.ok) {
    if (data?.code === "CAPTCHA_REQUIRED" && !options.captchaRetried) {
      const action = {
        "/v1/auth/login": "login",
        "/v1/auth/register": "register",
        "/v1/auth/passwordless/register": "register",
        "/v1/auth/otp/request": "verification_resend",
        "/v1/auth/password-reset/request": "password_reset",
        "/v1/auth/account-discovery/request": "account_discovery",
        "/v1/auth/verify-email/resend": "verification_resend",
        "/v1/devices/recovery/request": "device_recovery",
      }[path];
      if (!action) throw new ApiError(data.error, res.status, data.code);
      const captchaToken = await humanProof(action);
      return apiFetch(path, {
        ...options,
        captchaRetried: true,
        body: { ...options.body, captchaToken },
      });
    }
    const message =
      (data && data.error) || "Something went wrong. Please try again.";
    throw new ApiError(
      message,
      res.status,
      data && data.code,
      data && data.details,
      res.headers.get("Retry-After"),
    );
  }

  return data;
}

function friendlyError(err) {
  if (err instanceof ApiError) {
    if (err.status === 429) {
      return "Too many attempts. Please wait a moment and try again.";
    }
    if (err.status === 0) {
      return "Could not reach the server. Check your connection and try again.";
    }
    return err.message;
  }
  return "Something went wrong. Please try again.";
}

/* ---------------------------------------------------------------------- */
/* Form field helper                                                      */
/* ---------------------------------------------------------------------- */

let fieldIdCounter = 0;

function field(config) {
  fieldIdCounter += 1;
  const id = config.id || "field-" + fieldIdCounter;
  const errorId = id + "-error";

  const inputAttrs = Object.assign(
    {
      id: id,
      name: config.name || id,
      type: config.type || "text",
      autocomplete: config.autocomplete,
      required: config.required || undefined,
      placeholder: config.placeholder,
    },
    config.extraAttrs || {},
  );

  const input =
    config.tag === "select"
      ? el(
          "select",
          Object.assign(
            {
              id: id,
              name: config.name || id,
              required: config.required || undefined,
            },
            config.extraAttrs || {},
          ),
        )
      : el("input", inputAttrs);

  const errorEl = el("p", { class: "field-error", id: errorId });
  errorEl.hidden = true;

  const labelChildren = [config.label];
  const label = el("label", { for: id }, labelChildren);

  const wrapperChildren = [label, input];
  if (config.hint) {
    wrapperChildren.push(el("p", { class: "field-hint", text: config.hint }));
  }
  wrapperChildren.push(errorEl);

  const wrapperClass = config.checkbox ? "field checkbox-field" : "field";
  const wrapper = el(
    "div",
    { class: wrapperClass },
    config.checkbox ? [input, label] : wrapperChildren,
  );

  return { wrapper: wrapper, input: input, errorEl: errorEl, id: id };
}

function setFieldError(f, message) {
  if (!f) return;
  if (message) {
    f.input.setAttribute("aria-invalid", "true");
    f.input.setAttribute("aria-describedby", f.errorEl.id);
    f.errorEl.textContent = message;
    f.errorEl.hidden = false;
  } else {
    f.input.removeAttribute("aria-invalid");
    f.errorEl.hidden = true;
    f.errorEl.textContent = "";
  }
}

function clearFieldErrors(fields) {
  Object.keys(fields).forEach((key) => setFieldError(fields[key], null));
}

function applyServerFieldErrors(fields, details) {
  if (!details || !details.fieldErrors) return false;
  let applied = false;
  Object.keys(details.fieldErrors).forEach((name) => {
    const msgs = details.fieldErrors[name];
    if (fields[name] && msgs && msgs[0]) {
      setFieldError(fields[name], msgs[0]);
      applied = true;
    }
  });
  return applied;
}

function populateCountrySelect(selectEl, selected) {
  clearNode(selectEl);
  selectEl.append(el("option", { value: "" }, "Select a country"));
  for (const pair of COUNTRIES) {
    const opt = el("option", { value: pair[0] }, pair[1]);
    if (selected && selected === pair[0]) opt.selected = true;
    selectEl.append(opt);
  }
}

/* ---------------------------------------------------------------------- */
/* Confirm / reauth dialog (native <dialog>, keyboard + focus handled by  */
/* the browser: Esc cancels, focus is trapped while modal is open).       */
/* ---------------------------------------------------------------------- */

function confirmDialog(opts) {
  opts = opts || {};
  return new Promise((resolve) => {
    const dialog = document.getElementById("confirm-dialog");
    const form = document.getElementById("confirm-dialog-form");
    const titleEl = document.getElementById("confirm-dialog-title");
    const bodyEl = document.getElementById("confirm-dialog-body");
    const extraEl = document.getElementById("confirm-dialog-extra");
    const errorEl = document.getElementById("confirm-dialog-error");
    const confirmBtn = document.getElementById("confirm-dialog-confirm");
    const cancelBtn = document.getElementById("confirm-dialog-cancel");

    titleEl.textContent = opts.title || "Are you sure?";
    bodyEl.textContent = opts.body || "";
    errorEl.hidden = true;
    errorEl.textContent = "";
    clearNode(extraEl);
    confirmBtn.className =
      "btn " + (opts.danger ? "btn--danger" : "btn--primary");
    confirmBtn.textContent = opts.confirmLabel || "Confirm";

    let passwordInput = null;
    if (opts.requirePassword) {
      const passField = field({
        id: "confirm-dialog-password",
        label: opts.passwordLabel || "Current password",
        type: opts.inputType || "password",
        autocomplete:
          opts.inputType === "text" ? "one-time-code" : "current-password",
        hint: opts.passwordHint,
        extraAttrs:
          opts.inputType === "text"
            ? { inputmode: "numeric", pattern: "[0-9]{6}", maxlength: 6 }
            : {},
      });
      passwordInput = passField.input;
      extraEl.append(passField.wrapper);
    }

    if (opts.alternativeLabel) {
      const alternative = el(
        "button",
        { type: "button", class: "btn btn--ghost" },
        opts.alternativeLabel,
      );
      alternative.addEventListener("click", () => {
        dialog.removeEventListener("close", onClose);
        dialog.close();
        settle({ confirmed: false, alternative: true });
      });
      extraEl.append(alternative);
    }

    function settle(result) {
      dialog.removeEventListener("close", onClose);
      cancelBtn.removeEventListener("click", onCancel);
      form.removeEventListener("submit", onSubmit);
      resolve(result);
    }
    function onCancel() {
      dialog.close();
    }
    function onClose() {
      settle({ confirmed: false });
    }
    function onSubmit(e) {
      e.preventDefault();
      if (
        opts.requirePassword &&
        opts.passwordRequired !== false &&
        !passwordInput.value
      ) {
        errorEl.textContent = "Enter your password to continue.";
        errorEl.hidden = false;
        return;
      }
      const password = passwordInput ? passwordInput.value : undefined;
      dialog.removeEventListener("close", onClose);
      dialog.close();
      settle({ confirmed: true, password: password });
    }

    dialog.addEventListener("close", onClose);
    cancelBtn.addEventListener("click", onCancel);
    form.addEventListener("submit", onSubmit);

    dialog.showModal();
    (passwordInput || confirmBtn).focus();
  });
}

/* Sensitive actions require recent authentication. Offer a session-bound
   email code, with password/passkey confirmation as an alternative, then
   retry the original request. */
async function reauthenticate(purpose) {
  const { user } = await apiFetch("/v1/me");
  const choice = await confirmDialog({
    title: "Confirm it's you",
    body:
      purpose === "email_change"
        ? "Send a one-time code to your current email to verify your email change."
        : "Send a one-time code to your account email.",
    confirmLabel: "Email me a code",
    alternativeLabel: user.hasAuthenticator
      ? "Use authenticator app"
      : user.hasPasskey
        ? "Use passkey"
        : undefined,
  });
  if (choice.alternative) return reauthenticateWithCredential(user);
  if (!choice.confirmed) return false;
  try {
    await apiFetch("/v1/auth/otp/reauth/request", {
      method: "POST",
      body: purpose ? { purpose } : {},
    });
    const proof = await confirmDialog({
      title: "Enter your email code",
      body:
        purpose === "email_change"
          ? "Enter the six-digit code sent to your current email to verify your email change. It expires in 10 minutes."
          : "Enter the six-digit code we emailed you. It expires in 10 minutes.",
      confirmLabel: "Confirm",
      requirePassword: true,
      passwordLabel: "6-digit code",
      inputType: "text",
    });
    if (!proof.confirmed) return false;
    await apiFetch("/v1/auth/otp/verify", {
      method: "POST",
      body: { code: proof.password, reauth: true },
    });
    return true;
  } catch (error) {
    toast(friendlyError(error), "error");
    return false;
  }
}

async function reauthenticateWithCredential(user) {
  try {
    if (user.hasAuthenticator) {
      const result = await confirmDialog({
        title: "Confirm it's you",
        body: "Enter the current six-digit code from your authenticator app.",
        confirmLabel: "Confirm",
        requirePassword: true,
        passwordLabel: "Authenticator code",
        inputType: "text",
      });
      if (!result.confirmed) return false;
      await apiFetch("/v1/auth/authenticator/step-up", {
        method: "POST",
        body: { code: result.password.trim() },
      });
      return true;
    }
    const options = await apiFetch("/v1/auth/passkeys/step-up/options", {
      method: "POST",
    });
    const credential = await navigator.credentials.get({
      publicKey: toRequestOptions(options),
    });
    if (!credential) return false;
    await apiFetch("/v1/auth/passkeys/step-up/verify", {
      method: "POST",
      body: authenticationCredentialToJSON(credential),
    });
    return true;
  } catch (err) {
    toast(friendlyError(err), "error");
    return false;
  }
}

async function withReauth(actionFn) {
  try {
    return await actionFn();
  } catch (err) {
    if (err instanceof ApiError && err.code === "REAUTH_REQUIRED") {
      const ok = await reauthenticate();
      if (ok) return await actionFn();
    }
    throw err;
  }
}

/* ---------------------------------------------------------------------- */
/* WebAuthn (passkeys) — implemented against the native browser API.      */
/* The server (@simplewebauthn/server) sends/expects base64url strings;   */
/* the browser API wants ArrayBuffers, so we convert both directions.     */
/* ---------------------------------------------------------------------- */

function webauthnSupported() {
  return Boolean(window.PublicKeyCredential) && Boolean(navigator.credentials);
}

function base64urlToBuffer(base64url) {
  const padLength = (4 - (base64url.length % 4)) % 4;
  const base64 = (base64url + "=".repeat(padLength))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes.buffer;
}

function bufferToBase64url(buffer) {
  const bytes = new Uint8Array(buffer);
  let str = "";
  for (let i = 0; i < bytes.byteLength; i++)
    str += String.fromCharCode(bytes[i]);
  const base64 = btoa(str);
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function toCreationOptions(json) {
  return Object.assign({}, json, {
    challenge: base64urlToBuffer(json.challenge),
    user: Object.assign({}, json.user, { id: base64urlToBuffer(json.user.id) }),
    excludeCredentials: (json.excludeCredentials || []).map((c) =>
      Object.assign({}, c, { id: base64urlToBuffer(c.id) }),
    ),
  });
}

function toRequestOptions(json) {
  return Object.assign({}, json, {
    challenge: base64urlToBuffer(json.challenge),
    allowCredentials: (json.allowCredentials || []).map((c) =>
      Object.assign({}, c, { id: base64urlToBuffer(c.id) }),
    ),
  });
}

function registrationCredentialToJSON(credential, deviceName) {
  const response = credential.response;
  const body = {
    id: credential.id,
    rawId: bufferToBase64url(credential.rawId),
    type: credential.type,
    response: {
      clientDataJSON: bufferToBase64url(response.clientDataJSON),
      attestationObject: bufferToBase64url(response.attestationObject),
    },
  };
  if (deviceName) body.deviceName = deviceName;
  return body;
}

function authenticationCredentialToJSON(credential) {
  const response = credential.response;
  const body = {
    id: credential.id,
    rawId: bufferToBase64url(credential.rawId),
    type: credential.type,
    response: {
      clientDataJSON: bufferToBase64url(response.clientDataJSON),
      authenticatorData: bufferToBase64url(response.authenticatorData),
      signature: bufferToBase64url(response.signature),
    },
  };
  if (response.userHandle)
    body.response.userHandle = bufferToBase64url(response.userHandle);
  return body;
}

async function registerPasskey(deviceName) {
  const options = await withReauth(() =>
    apiFetch("/v1/auth/passkeys/register/options", { method: "POST" }),
  );
  const publicKey = toCreationOptions(options);
  let credential;
  try {
    credential = await navigator.credentials.create({ publicKey: publicKey });
  } catch (err) {
    throw new Error(
      err && err.name === "NotAllowedError"
        ? "Passkey setup was cancelled."
        : "Your device could not create a passkey.",
    );
  }
  if (!credential) throw new Error("Passkey setup was cancelled.");
  const body = registrationCredentialToJSON(credential, deviceName);
  await withReauth(() =>
    apiFetch("/v1/auth/passkeys/register/verify", {
      method: "POST",
      body: body,
    }),
  );
}

async function loginWithPasskey(trustDevice = false) {
  const options = await apiFetch("/v1/auth/passkeys/login/options", {
    method: "POST",
  });
  const publicKey = toRequestOptions(options);
  let assertion;
  try {
    assertion = await navigator.credentials.get({ publicKey: publicKey });
  } catch (err) {
    throw new Error(
      err && err.name === "NotAllowedError"
        ? "Passkey sign-in was cancelled."
        : "Your device could not complete passkey sign-in.",
    );
  }
  if (!assertion) throw new Error("Passkey sign-in was cancelled.");
  const body = { ...authenticationCredentialToJSON(assertion), trustDevice };
  await apiFetch("/v1/auth/passkeys/login/verify", {
    method: "POST",
    body: body,
  });
}

function buildPasskeyOffer() {
  if (!state.user || state.user.hasPasskey || !webauthnSupported()) return null;
  const message = el("p", { class: "form-error", role: "status" });
  message.hidden = true;
  const create = el(
    "button",
    { type: "button", class: "btn btn--primary" },
    "Create a passkey",
  );
  const skip = el(
    "button",
    { type: "button", class: "btn btn--ghost" },
    "Not now",
  );
  const offer = el("section", { "aria-label": "Set up a passkey" }, [
    el("h2", {}, "Make your next sign-in easier"),
    el(
      "p",
      {},
      "Create a passkey to sign in with your fingerprint, face or device PIN instead of entering a code. Your device will guide you through saving it.",
    ),
    el(
      "p",
      { class: "card__hint" },
      "Optional — you can also add one later in Account → Security → Passkeys.",
    ),
    message,
    el("div", { class: "btn-row" }, [create, skip]),
  ]);
  skip.addEventListener("click", () => offer.remove());
  create.addEventListener("click", async () => {
    if (create.disabled) return;
    create.disabled = true;
    skip.disabled = true;
    create.textContent = "Follow your device's prompt…";
    message.hidden = true;
    try {
      await registerPasskey();
      state.user.hasPasskey = true;
      clearNode(offer);
      offer.append(
        el(
          "p",
          { class: "form-success", role: "status" },
          "Passkey created. Next time, choose Sign in with a passkey.",
        ),
      );
    } catch (error) {
      message.textContent = error.message || friendlyError(error);
      message.hidden = false;
    } finally {
      create.disabled = false;
      skip.disabled = false;
      create.textContent = "Create a passkey";
    }
  });
  return offer;
}

/* ---------------------------------------------------------------------- */
/* Formatting helpers                                                     */
/* ---------------------------------------------------------------------- */

function formatDateTime(value) {
  if (!value) return "Unknown";
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch (err) {
    return String(value);
  }
}

function describeUserAgent(ua) {
  if (!ua) return "Unknown device";
  let browser = "A browser";
  if (/Edg\//.test(ua)) browser = "Edge";
  else if (/Chrome\//.test(ua) && !/Chromium/.test(ua)) browser = "Chrome";
  else if (/Firefox\//.test(ua)) browser = "Firefox";
  else if (/Safari\//.test(ua) && !/Chrome/.test(ua)) browser = "Safari";

  let os = "an unknown device";
  if (/Windows/.test(ua)) os = "Windows";
  else if (/Mac OS X/.test(ua)) os = "macOS";
  else if (/Android/.test(ua)) os = "Android";
  else if (/iPhone|iPad|iPod/.test(ua)) os = "iOS";
  else if (/Linux/.test(ua)) os = "Linux";

  return browser + " on " + os;
}

function greetingForNow() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/* ---------------------------------------------------------------------- */
/* App state + router                                                     */
/* ---------------------------------------------------------------------- */

const state = {
  user: null,
  address: null,
};
let sessionGeneration = 0;
let signingOut = false;

const viewRoot = document.getElementById("view-root");
const siteNav = document.getElementById("site-nav");

async function loadSession() {
  if (signingOut) return false;
  const generation = ++sessionGeneration;
  try {
    const data = await apiFetch("/v1/me");
    if (generation !== sessionGeneration) return false;

    state.user = data.user;
    state.address = data.address;

    return true;
  } catch (err) {
    if (generation !== sessionGeneration) return false;
    // Only treat an actual authentication failure as "logged out".
    // A server error, rate limit, or network failure should not
    // wipe the current client state.
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
      state.user = null;
      state.address = null;
      renderNav();
      if (ROUTES[parseHash().path]?.authOnly) navigate("/");
      else if (parseHash().path === "/") renderRoute();
      return false;
    }

    throw err;
  }
}

function renderNav() {
  clearNode(siteNav);
  if (state.user) {
    siteNav.append(
      el("span", { class: "site-nav__greeting" }, "Your workspace"),
      el("a", { href: "#/dashboard" }, "Workspace"),
      el("a", { href: "#/account" }, "Account"),
      el("a", { href: "#/timetables" }, "Timetables"),
      ...(state.user.role === "admin"
        ? [el("a", { href: "#/admin" }, "Admin")]
        : []),
      el(
        "button",
        {
          type: "button",
          class: "btn btn--ghost btn--small",
          onclick: handleSignOut,
        },
        "Sign out",
      ),
    );
  } else {
    siteNav.append(
      el("a", { href: "#/login" }, "Sign in"),
      el("a", { href: "#/register" }, "Create account"),
    );
  }
}

async function handleSignOut() {
  if (!(await beforeLeave(false))) return;
  if (signingOut) return;
  signingOut = true;
  // Invalidate session reads already in flight before submitting logout.
  ++sessionGeneration;
  try {
    await apiFetch("/v1/auth/logout", { method: "POST" });
  } catch (err) {
    signingOut = false;
    toast(
      "Sign-out failed. Your session is still active. Please retry.",
      "error",
    );
    return;
  }
  state.user = null;
  state.address = null;
  signingOut = false;
  renderNav();
  navigate("/");
  toast("You've been signed out.");
}

export { state, loadSession };

const ROUTES = {
  "/": { render: renderHome },
  "/dashboard": { authOnly: true, render: () => renderDashboard() },
  "/notes": { authOnly: true, render: () => renderDocuments("note") },
  "/lessons": { authOnly: true, render: (params) => renderLessons(params) },
  "/timetables": { authOnly: true, render: renderTimetables },
  "/templates": { authOnly: true, render: () => renderDocuments("template") },
  "/schedule": { authOnly: true, render: () => renderDashboard(true) },
  "/editor": { authOnly: true, render: renderEditor },
  "/files": { authOnly: true, render: renderFiles },
  "/file": { authOnly: true, render: renderFile },
  "/device": { render: renderDeviceApproval },
  "/devices": { authOnly: true, render: renderDevices },
  "/login": { guestOnly: true, render: renderLogin },
  "/register": { guestOnly: true, render: renderRegister },
  "/email-code": { render: renderVerifyEmail },
  "/forgot-password": { guestOnly: true, render: renderLogin },
  "/reset-password": { render: renderLogin },
  "/verify-email": { render: renderVerifyEmail },
  "/preferences": { authOnly: true, render: renderPreferences },
  "/onboarding": { authOnly: true, render: renderOnboarding },
  "/feedback": { authOnly: true, render: renderFeedback },
  "/trash": { authOnly: true, render: renderTrash },
  "/admin": { authOnly: true, render: renderAdmin },
  "/forgot-email": { render: renderDiscovery },
  "/verify-recovery": { render: renderRecoveryLink },
  "/change-email": { render: renderRecoveryLink },
  "/discover-account": { render: renderRecoveryLink },
  "/account": { authOnly: true, render: renderAccount },
  "/privacy": { render: renderPrivacy },
  "/terms": { render: renderTerms },
};

function parseHash() {
  const raw = location.hash.slice(1) || "/";
  const qIndex = raw.indexOf("?");
  const path = qIndex === -1 ? raw : raw.slice(0, qIndex);
  const query = qIndex === -1 ? "" : raw.slice(qIndex + 1);
  return { path: path || "/", params: new URLSearchParams(query) };
}

function navigate(path) {
  const target = "#" + path;
  if (location.hash === target) {
    renderRoute();
  } else {
    location.hash = path;
  }
}

let pendingPasskeyOffer = null;
let currentHash = location.hash || "#/";
let rendering = Promise.resolve();
function renderRoute() {
  rendering = rendering.then(renderRouteNow, renderRouteNow);
  return rendering;
}
async function renderRouteNow() {
  if (!(await beforeLeave())) {
    history.replaceState(null, "", currentHash);
    return;
  }
  currentHash = location.hash || "#/";
  const parsed = parseHash();
  const route = ROUTES[parsed.path] || ROUTES["/"];

  if (route.authOnly && !state.user) {
    navigate("/login");
    return;
  }
  if (route.guestOnly && state.user) {
    navigate("/dashboard");
    return;
  }

  renderNav();
  clearNode(viewRoot);
  document.body.dataset.view =
    parsed.path === "/" ? "home" : route.authOnly ? "workspace" : "auth";
  if (route.authOnly) {
    const tabs = [
      ["/dashboard", "Home"],
      ["/files", "Files"],
      ["/notes", "Notes"],
      ["/lessons", "Lesson plans"],
      ["/schedule", "Schedule"],
      ["/account", "Account"],
      ["/timetables", "Timetables"],
      ...(state.user.role === "admin" ? [["/admin", "Admin"]] : []),
    ];
    viewRoot.append(
      el(
        "nav",
        { class: "workspace-nav", "aria-label": "Workspace" },
        tabs.map(([path, label]) =>
          el(
            "a",
            {
              href: "#" + path,
              "aria-current": parsed.path === path ? "page" : undefined,
            },
            label,
          ),
        ),
      ),
    );
  }
  const routeLoader = createLoader("Loading page…");
  const loaderTimer = setTimeout(() => {
    if (!viewRoot.querySelector(".app-loader")) viewRoot.append(routeLoader);
  }, 150);
  try {
    await route.render(parsed.params);
    if (route.authOnly && pendingPasskeyOffer === state.user?.id) {
      pendingPasskeyOffer = null;
      const offer = buildPasskeyOffer();
      if (offer) {
        offer.classList.add("card");
        viewRoot.insertBefore(
          offer,
          viewRoot.querySelector(".workspace-nav")?.nextSibling ||
            viewRoot.firstChild,
        );
      }
    }
  } catch (err) {
    if (hasUnsaved()) {
      toast(friendlyError(err), "error");
      return;
    }
    clearNode(viewRoot);
    viewRoot.append(
      el("div", { class: "page-head" }, [
        el("h1", {}, "Something went wrong"),
        el("p", {}, friendlyError(err)),
      ]),
    );
  } finally {
    clearTimeout(loaderTimer);
    routeLoader.remove();
  }

  const heading = viewRoot.querySelector("h1");
  if (heading && parsed.path !== "/editor") {
    heading.setAttribute("tabindex", "-1");
    heading.focus();
  }
}

window.addEventListener("hashchange", renderRoute);

setupLegal({ el, viewRoot });
setupExtras({
  el,
  apiFetch,
  viewRoot,
  state,
  navigate,
  toast,
  friendlyError,
  field,
  confirmDialog,
  withReauth,
});
setupWorkspace({
  el,
  apiFetch,
  viewRoot,
  state,
  navigate,
  toast,
  friendlyError,
  field,
  confirmDialog,
  withReauth,
  reauthenticate,
  loadSession,
  greetingForNow,
  formatDateTime,
  describeUserAgent,
});
window.addEventListener("beforeunload", (e) => {
  if (hasUnsaved()) {
    e.preventDefault();
    e.returnValue = "";
  }
});
document.addEventListener("DOMContentLoaded", async () => {
  document.querySelector(".skip-link").addEventListener("click", (event) => {
    event.preventDefault();
    const main = document.getElementById("main");
    main.setAttribute("tabindex", "-1");
    main.focus();
  });
  const startupLoader = createLoader("Opening your workspace…");
  viewRoot.append(startupLoader);
  try {
    await loadSession();
  } catch {
    toast("Account service unavailable. You can still explore Chix.", "error");
  }
  startupLoader.remove();
  await renderRoute();
});

/* ---------------------------------------------------------------------- */
/* View: Sign in                                                          */
/* ---------------------------------------------------------------------- */

// On the sign-up screen no account is named yet, so the button reveals itself
// from the global setting. The sign-in screen passes false and decides per
// account instead; letting both run would race, and the slower answer would win.
function buildGoogleSignInButton(autoReveal = true) {
  const button = el(
    "button",
    { type: "button", class: "btn btn--ghost btn--full", hidden: true },
    "Continue with Google",
  );
  if (autoReveal)
    apiFetch("/v1/auth/methods")
      .then((methods) => {
        button.hidden = !methods.google;
      })
      .catch(() => {});
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      const result = await apiFetch("/v1/auth/google/start", {
        method: "POST",
      });
      const url = new URL(result.url);
      if (url.origin !== "https://accounts.google.com")
        throw new Error("Google sign-in unavailable.");
      location.assign(url.href);
    } catch (error) {
      toast(friendlyError(error), "error");
      button.disabled = false;
    }
  });
  return button;
}

async function renderLogin() {
  const fields = {
    email: field({
      id: "login-email",
      label: "Email",
      type: "email",
      required: true,
      autocomplete: "email",
    }),
    code: field({
      id: "login-authenticator-code",
      label: "Authenticator code",
      type: "text",
      required: true,
      autocomplete: "one-time-code",
      extraAttrs: { inputmode: "numeric", pattern: "[0-9]{6}", maxlength: 6 },
    }),
  };

  const errorBanner = el("div", { class: "form-error" });
  errorBanner.hidden = true;

  const trust = el("input", { type: "checkbox" });
  const continueBtn = el(
    "button",
    { type: "button", class: "btn btn--ghost btn--full" },
    "Use an authenticator app",
  );
  const codeBtn = el(
    "button",
    { type: "button", class: "btn btn--primary btn--full" },
    "Email me a sign-in code",
  );
  const identifyBtn = el(
    "button",
    { type: "submit", class: "btn btn--primary btn--full" },
    "Continue",
  );
  const backBtn = el(
    "button",
    { type: "button", class: "btn btn--ghost btn--small" },
    "Change email",
  );
  const submitBtn = el(
    "button",
    { type: "submit", class: "btn btn--primary btn--full" },
    "Sign in",
  );

  const emailStep = el("form", { class: "form", novalidate: true }, [
    fields.email.wrapper,
    identifyBtn,
  ]);
  emailStep.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (identifyBtn.disabled || !fields.email.input.reportValidity()) return;
    identifyBtn.disabled = true;
    errorBanner.hidden = true;
    try {
      await offerMethods(fields.email.input.value.trim());
    } catch (error) {
      errorBanner.textContent = friendlyError(error);
      errorBanner.hidden = false;
    } finally {
      identifyBtn.disabled = false;
    }
  });

  codeBtn.addEventListener("click", async () => {
    if (codeBtn.disabled) return;
    codeBtn.disabled = true;
    errorBanner.hidden = true;
    try {
      await apiFetch("/v1/auth/otp/request", {
        method: "POST",
        body: { email: fields.email.input.value.trim() },
      });
      state.verificationEmail = fields.email.input.value.trim();
      navigate("/email-code");
    } catch (error) {
      errorBanner.textContent = friendlyError(error);
      errorBanner.hidden = false;
    } finally {
      codeBtn.disabled = false;
    }
  });
  if (parseHash().params.get("google") === "link") {
    try {
      const identity = await apiFetch("/v1/auth/google/pending");
      fields.email.input.value = identity.email || "";
      errorBanner.textContent =
        "Confirm your existing account with an emailed code to connect Google.";
      errorBanner.hidden = false;
    } catch {
      /* The email form remains available. */
    }
  } else if (parseHash().params.get("google") === "error") {
    errorBanner.textContent =
      "Google sign-in did not finish. Try again or use an email code.";
    errorBanner.hidden = false;
  }

  const emailSummary = el("p", { class: "login-email-summary" });
  const authenticatorStep = el("form", { class: "form", novalidate: true }, [
    emailSummary,
    backBtn,
    fields.code.wrapper,
    el(
      "p",
      { class: "card__hint" },
      "Enter the six-digit code from your connected authenticator app. You can also go back and sign in by email.",
    ),
    submitBtn,
  ]);
  authenticatorStep.hidden = true;

  continueBtn.addEventListener("click", () => {
    if (!fields.email.input.reportValidity()) return;
    emailSummary.textContent = fields.email.input.value.trim();
    methodStep.hidden = true;
    authenticatorStep.hidden = false;
    fields.code.input.focus();
  });

  backBtn.addEventListener("click", () => {
    authenticatorStep.hidden = true;
    methodStep.hidden = false;
  });

  authenticatorStep.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearFieldErrors(fields);
    errorBanner.hidden = true;
    if (submitBtn.disabled || !authenticatorStep.reportValidity()) return;
    submitBtn.disabled = true;
    submitBtn.textContent = "Signing in…";
    try {
      const loginResult = await apiFetch("/v1/auth/authenticator/login", {
        method: "POST",
        body: {
          email: fields.email.input.value.trim(),
          code: fields.code.input.value.trim(),
        },
      });
      if (loginResult.approvalRequired) {
        state.trustDevice = trust.checked;
        navigate("/device");
        return;
      }
      await loadSession();
      if (!state.user)
        throw new ApiError(
          "Sign-in could not be confirmed. Please allow cookies and try again.",
          401,
        );
      navigate("/dashboard");
      toast("Welcome back.", "success");
    } catch (err) {
      if (
        err instanceof ApiError &&
        err.code === "EMAIL_VERIFICATION_REQUIRED"
      ) {
        state.verificationEmail = fields.email.input.value.trim();
        navigate("/verify-email");
        return;
      }
      if (err instanceof ApiError && err.status === 400 && err.details) {
        applyServerFieldErrors(fields, err.details);
      }
      errorBanner.textContent = friendlyError(err);
      errorBanner.hidden = false;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Sign in";
    }
  });

  const googleBtn = buildGoogleSignInButton(false);
  const methodSummary = el("p", { class: "login-email-summary" });
  const changeEmailBtn = el(
    "button",
    { type: "button", class: "btn btn--ghost btn--small" },
    "Change email",
  );
  changeEmailBtn.addEventListener("click", () => {
    methodStep.hidden = true;
    emailStep.hidden = false;
    fields.email.input.focus();
  });

  let passkeyBtn = null;
  if (webauthnSupported()) {
    passkeyBtn = el(
      "button",
      { type: "button", class: "btn btn--ghost btn--full" },
      "Sign in with a passkey",
    );
    passkeyBtn.addEventListener("click", async () => {
      passkeyBtn.disabled = true;
      try {
        await loginWithPasskey(trust.checked);
        await loadSession();
        if (!state.user)
          throw new ApiError(
            "Sign-in could not be confirmed. Please allow cookies and try again.",
            401,
          );
        navigate("/dashboard");
        toast("Welcome back.", "success");
      } catch (err) {
        toast(err.message || friendlyError(err), "error");
      } finally {
        passkeyBtn.disabled = false;
      }
    });
  }

  // The account is named before any method is offered, so nobody is shown a
  // passkey prompt their device cannot answer, and the administrator keeps
  // Touch ID. The server decides; this only renders the answer.
  const methodStep = el(
    "div",
    { class: "form" },
    [
      methodSummary,
      changeEmailBtn,
      codeBtn,
      continueBtn,
      googleBtn,
      passkeyBtn && el("hr", { class: "divider-line" }),
      passkeyBtn,
    ].filter(Boolean),
  );
  methodStep.hidden = true;

  async function offerMethods(email) {
    const methods = await apiFetch("/v1/auth/methods", {
      method: "POST",
      body: { email },
    });
    continueBtn.hidden = !methods.authenticator;
    googleBtn.hidden = !methods.google;
    if (passkeyBtn) passkeyBtn.hidden = !methods.passkey;
    methodSummary.textContent = email;
    emailStep.hidden = true;
    methodStep.hidden = false;
    codeBtn.focus();
  }

  viewRoot.append(
    el("div", { class: "auth-shell" }, [
      el("div", { class: "page-head" }, [
        el("h1", {}, "Sign in"),
        el("p", {}, "Welcome back to Chix."),
      ]),
      el("div", { class: "card" }, [
        errorBanner,
        emailStep,
        methodStep,
        authenticatorStep,
      ]),
      el("div", { class: "link-row" }, [
        el("a", { href: "#/forgot-email" }, "Forgot your email?"),
        el("a", { href: "#/register" }, "Create an account"),
      ]),
    ]),
  );
}

/* ---------------------------------------------------------------------- */
/* View: Register                                                         */
/* ---------------------------------------------------------------------- */

function birthDateValue(value) {
  const text = value.trim();
  const parts = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  const iso = parts
    ? `${parts[3]}-${parts[2].padStart(2, "0")}-${parts[1].padStart(2, "0")}`
    : text;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const date = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === iso
    ? iso
    : null;
}

async function renderRegister() {
  const fields = {
    firstName: field({
      id: "reg-first-name",
      label: "First name",
      required: true,
      autocomplete: "given-name",
    }),
    lastName: field({
      id: "reg-last-name",
      label: "Last name",
      required: true,
      autocomplete: "family-name",
    }),
    dateOfBirth: field({
      id: "reg-dob",
      label: "Date of birth",
      type: "text",
      required: true,
      autocomplete: "bday",
      placeholder: "DD/MM/YYYY",
      hint: "Day / month / year, for example 12/02/2000 for 12 February 2000.",
    }),
    email: field({
      id: "reg-email",
      label: "Email",
      type: "email",
      required: true,
      autocomplete: "email",
    }),
    username: field({
      id: "reg-username",
      label: "Username",
      required: true,
      autocomplete: "username",
      hint: "3–20 characters: lowercase letters, numbers, dots or underscores.",
      extraAttrs: { minlength: 3, maxlength: 20, pattern: "[a-z0-9._]{3,20}" },
    }),
    marketingAnnouncements: field({
      id: "reg-marketing-announcements",
      label: "Send me product announcements",
      type: "checkbox",
      checkbox: true,
    }),
    marketingApps: field({
      id: "reg-marketing-apps",
      label: "Send me updates about new features",
      type: "checkbox",
      checkbox: true,
    }),
  };

  // Shown before any information is sent, as POPIA section 18 requires, and
  // enforced by the server as well so it cannot be skipped.
  const acceptTerms = el("input", {
    type: "checkbox",
    id: "reg-accept-terms",
    required: true,
  });
  const acceptLabel = el("div", { class: "field checkbox-field" }, [
    acceptTerms,
    el("label", { for: "reg-accept-terms" }, [
      "I have read the ",
      el(
        "a",
        { href: "#/privacy", target: "_blank", rel: "noopener" },
        "Privacy notice",
      ),
      " and accept the ",
      el(
        "a",
        { href: "#/terms", target: "_blank", rel: "noopener" },
        "Terms of use",
      ),
      ".",
    ]),
  ]);

  if (parseHash().params.get("google") === "profile") {
    try {
      const identity = await apiFetch("/v1/auth/google/pending");
      if (identity.email) {
        fields.email.input.value = identity.email;
        fields.email.input.readOnly = true;
        fields.firstName.input.value = identity.firstName || "";
        fields.lastName.input.value = identity.lastName || "";
      }
    } catch {
      /* Email registration remains available. */
    }
  }
  const bot = el("div", {});
  let readBot = () => "";

  const errorBanner = el("div", { class: "form-error" });
  errorBanner.hidden = true;

  const submitBtn = el(
    "button",
    { type: "submit", class: "btn btn--primary btn--full" },
    "Create account",
  );

  const form = el("form", { class: "form", novalidate: true }, [
    errorBanner,
    el("div", { class: "form-row" }, [
      fields.firstName.wrapper,
      fields.lastName.wrapper,
    ]),
    fields.dateOfBirth.wrapper,
    fields.email.wrapper,
    fields.username.wrapper,

    bot,
    fields.marketingAnnouncements.wrapper,
    fields.marketingApps.wrapper,
    acceptLabel,
    submitBtn,
  ]);

  apiFetch("/v1/config")
    .then((c) => {
      if (c.bot.registrationRequired)
        return mountBot(bot, "register").then((r) => {
          readBot = r;
        });
    })
    .catch(() => {
      bot.textContent = "Human verification unavailable. Please retry later.";
    });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearFieldErrors(fields);
    errorBanner.hidden = true;

    const dateOfBirth = birthDateValue(fields.dateOfBirth.input.value);
    if (!dateOfBirth) {
      setFieldError(
        fields.dateOfBirth,
        "Enter a valid date of birth as DD/MM/YYYY, for example 12/02/2000.",
      );
      fields.dateOfBirth.input.focus();
      return;
    }
    if (!form.reportValidity()) return;

    submitBtn.disabled = true;
    submitBtn.textContent = "Creating account…";

    const body = {
      firstName: fields.firstName.input.value.trim(),
      lastName: fields.lastName.input.value.trim(),
      dateOfBirth,
      email: fields.email.input.value.trim(),
      username: fields.username.input.value.trim().toLowerCase(),
      marketingAnnouncements: fields.marketingAnnouncements.input.checked,
      marketingApps: fields.marketingApps.input.checked,
      acceptTerms: acceptTerms.checked,
      timezone:
        Intl.DateTimeFormat().resolvedOptions().timeZone ||
        "Africa/Johannesburg",
      captchaToken: readBot(),
    };

    try {
      const registration = await apiFetch("/v1/auth/passwordless/register", {
        method: "POST",
        body: body,
      });
      if (registration.verificationRequired || registration.signInRequired) {
        state.verificationEmail = body.email;
        navigate("/email-code");
        toast(registration.message || "Enter the code we emailed you.");
        return;
      }
      await loadSession();
      if (!state.user)
        throw new Error("Please sign in to confirm your new account.");
      navigate("/onboarding");
      toast("Account created.", "success");
    } catch (err) {
      if (err instanceof ApiError && err.status === 400 && err.details) {
        applyServerFieldErrors(fields, err.details);
      }
      errorBanner.textContent = friendlyError(err);
      errorBanner.hidden = false;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Create account";
    }
  });

  viewRoot.append(
    el("div", { class: "auth-shell" }, [
      el("div", { class: "page-head" }, [
        el("h1", {}, "Create your account"),
        el("p", {}, "A few details and you're set."),
      ]),
      el("div", { class: "card" }, [buildGoogleSignInButton(), form]),
      el("div", { class: "link-row" }, [
        el("span", {}, ""),
        el("a", { href: "#/login" }, "Already have an account? Sign in"),
      ]),
    ]),
  );
}

/* ---------------------------------------------------------------------- */
/* View: Forgot password                                                  */
/* ---------------------------------------------------------------------- */

async function renderVerifyEmail() {
  const passwordless = parseHash().path === "/email-code";
  const emailField = field({
    id: "verify-email",
    label: "Email",
    type: "email",
    required: true,
    autocomplete: "email",
  });
  emailField.input.value = state.verificationEmail || state.user?.email || "";
  const card = el("div", { class: "card" });
  const errorBanner = el("div", { class: "form-error" });
  errorBanner.hidden = true;

  const codeField = field({
    id: "verify-code",
    label: "6-digit code",
    required: true,
    autocomplete: "one-time-code",
    extraAttrs: { inputmode: "numeric", pattern: "[0-9]{6}", maxlength: 6 },
  });

  const submitBtn = el(
    "button",
    { type: "submit", class: "btn btn--primary btn--full" },
    "Verify",
  );

  const form = el("form", { class: "form", novalidate: true }, [
    errorBanner,
    el("p", {}, "Enter the 6-digit code we emailed you."),
    emailField.wrapper,
    codeField.wrapper,
    submitBtn,
  ]);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorBanner.hidden = true;
    if (submitBtn.disabled || !form.reportValidity()) return;
    submitBtn.disabled = true;
    submitBtn.textContent = "Verifying…";
    try {
      const verification = await apiFetch(
        passwordless ? "/v1/auth/otp/verify" : "/v1/auth/verify-email",
        {
          method: "POST",
          body: {
            email: emailField.input.value.trim(),
            code: codeField.input.value.trim(),
          },
        },
      );
      if (verification.signInRequired) {
        state.user = null;
        state.address = null;
      }
      heading.textContent = "Signing you in…";
      clearNode(card);
      card.append(
        el(
          "div",
          { class: "sign-in-loading", role: "status", "aria-live": "polite" },
          [
            el("p", {}, "Getting your workspace ready…"),
            el("progress", { "aria-label": "Signing you in" }),
          ],
        ),
      );
      let sessionUnavailable = false;
      try {
        await loadSession();
      } catch {
        sessionUnavailable = true;
      }
      renderNav();
      const signInRequired = verification.signInRequired || !state.user;
      if (!signInRequired && !sessionUnavailable) {
        pendingPasskeyOffer = state.user.id;
        navigate(
          passwordless
            ? verification.newAccount
              ? "/onboarding"
              : "/dashboard"
            : "/account",
        );
        return;
      }
      heading.textContent = "Verify your email";
      clearNode(card);
      card.append(
        el("p", { class: "form-success" }, "Your email address is verified."),
        ...(sessionUnavailable
          ? [
              el(
                "p",
                {},
                "We couldn't refresh your session. " +
                  (signInRequired
                    ? "Please sign in to continue."
                    : "Continue to retry."),
              ),
            ]
          : signInRequired
            ? [el("p", {}, "Please sign in to continue.")]
            : []),
        el(
          "a",
          {
            class: "btn btn--primary",
            href: signInRequired
              ? "#/login"
              : passwordless
                ? verification.newAccount
                  ? "#/onboarding"
                  : "#/dashboard"
                : "#/account",
          },
          signInRequired ? "Sign in" : "Continue",
        ),
      );
    } catch (err) {
      errorBanner.textContent = friendlyError(err);
      errorBanner.hidden = false;
      submitBtn.disabled = false;
      submitBtn.textContent = "Verify";
    }
  });

  const actions = [
    el(
      "a",
      { class: "btn btn--ghost", href: state.user ? "#/account" : "#/login" },
      "Continue",
    ),
  ];
  {
    const resendBtn = el(
      "button",
      { type: "button", class: "btn btn--primary" },
      "Resend code",
    );
    resendBtn.addEventListener("click", async () => {
      if (!emailField.input.reportValidity()) return;
      resendBtn.disabled = true;
      try {
        await apiFetch(
          passwordless
            ? "/v1/auth/otp/request"
            : "/v1/auth/verify-email/resend",
          { method: "POST", body: { email: emailField.input.value.trim() } },
        );
        toast("Verification code sent.", "success");
      } catch (resendErr) {
        toast(friendlyError(resendErr), "error");
      } finally {
        resendBtn.disabled = false;
      }
    });
    actions.unshift(resendBtn);
  }

  card.append(form, el("div", { class: "btn-row" }, actions));
  const heading = el("h1", {}, "Verify your email");

  viewRoot.append(
    el("div", { class: "auth-shell" }, [
      el("div", { class: "page-head" }, [heading]),
      card,
    ]),
  );
}

/* ---------------------------------------------------------------------- */
/* View: Account (the main dashboard)                                     */
/* ---------------------------------------------------------------------- */

async function renderAccount() {
  await loadSession();
  if (!state.user) return;
  const user = state.user;
  const panel = (title, content) =>
    el("details", { class: "account-panel" }, [
      el("summary", {}, title),
      content,
    ]);
  const section = (id, title, content) =>
    el("section", { class: "account-section", "aria-labelledby": id }, [
      el("h2", { id }, title),
      ...content,
    ]);
  viewRoot.append(
    el("div", { class: "page-head" }, [
      el("h1", {}, "Account"),
      el("p", {}, "Your profile, security and personal preferences."),
    ]),
    el(
      "nav",
      { class: "account-sections", "aria-label": "Account sections" },
      ["Profile", "Security", "Preferences", "Danger zone"].map((label) =>
        el(
          "a",
          {
            href: "#account-" + label.toLowerCase().replaceAll(" ", "-"),
            onclick: (e) => {
              e.preventDefault();
              document
                .getElementById(
                  "account-" + label.toLowerCase().replaceAll(" ", "-"),
                )
                .scrollIntoView({ behavior: "auto" });
            },
          },
          label,
        ),
      ),
    ),
    section("account-profile", "Profile", [
      el("p", {}, user.email),
      buildStatusCard(user),
      panel("Name and profile", buildProfileCard(user)),
      panel("Email address", buildEmailCard(user)),
      panel("Username", buildUsernameCard(user)),
    ]),
    section("account-security", "Security", [
      panel("Authenticator app", buildAuthenticatorCard()),
      panel("Passkeys", buildPasskeysCard()),
      panel("Active sessions", buildSessionsCard()),
      el("div", { class: "btn-row" }, [
        el(
          "a",
          { href: "#/preferences", class: "btn btn--ghost" },
          "Recovery email",
        ),
        el(
          "a",
          { href: "#/devices", class: "btn btn--ghost" },
          "Trusted devices & recovery codes",
        ),
      ]),
    ]),
    section("account-preferences", "Preferences", [
      appearanceSettings(),
      el(
        "p",
        {},
        "Manage your timezone, session duration and personal touches.",
      ),
      el(
        "a",
        { href: "#/preferences", class: "btn btn--ghost" },
        "Edit account preferences",
      ),
    ]),
    section("account-danger-zone", "Danger zone", [buildDataAccountCard(user)]),
  );
}

function buildResendVerificationButton() {
  const btn = el(
    "button",
    { type: "button", class: "btn btn--ghost btn--small" },
    "Resend verification email",
  );
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    try {
      const data = await apiFetch("/v1/auth/verify-email/resend", {
        method: "POST",
      });
      toast(
        data.alreadyVerified
          ? "Your email is already verified."
          : "Verification email sent.",
        "success",
      );
    } catch (err) {
      toast(friendlyError(err), "error");
    } finally {
      btn.disabled = false;
    }
  });
  return btn;
}

function buildStatusCard(user) {
  const body = el("div", { class: "status-card__body" }, [
    el("p", {}, "Account status"),
    el(
      "h2",
      {},
      user.emailVerified ? "Your email is verified" : "Verify your email",
    ),
    el(
      "p",
      { class: "card__hint" },
      user.emailVerified
        ? "You're all set."
        : "Check " +
            user.email +
            " for a verification link, or resend it below.",
    ),
  ]);

  const action = user.emailVerified
    ? el("span", { class: "badge badge--verified" }, "Verified")
    : buildResendVerificationButton();

  return el("div", { class: "card card--accent status-card" }, [body, action]);
}

/* ---- Profile ---- */

function buildProfileCard(user) {
  const countryName = (COUNTRIES.find((c) => c[0] === user.country) || [
    null,
    user.country,
  ])[1];

  const fields = {
    firstName: field({
      id: "profile-first-name",
      label: "First name",
      required: true,
      autocomplete: "given-name",
    }),
    lastName: field({
      id: "profile-last-name",
      label: "Last name",
      required: true,
      autocomplete: "family-name",
    }),
  };

  fields.firstName.input.value = user.firstName;
  fields.lastName.input.value = user.lastName;
  const errorBanner = el("div", { class: "form-error" });
  errorBanner.hidden = true;
  const submitBtn = el(
    "button",
    { type: "submit", class: "btn btn--primary" },
    "Save profile",
  );

  const form = el("form", { class: "form", novalidate: true }, [
    errorBanner,
    el("div", { class: "form-row" }, [
      fields.firstName.wrapper,
      fields.lastName.wrapper,
    ]),
    submitBtn,
  ]);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearFieldErrors(fields);
    errorBanner.hidden = true;
    if (!form.reportValidity()) return;

    submitBtn.disabled = true;
    submitBtn.textContent = "Saving…";
    try {
      await apiFetch("/v1/me", {
        method: "PATCH",
        body: {
          firstName: fields.firstName.input.value.trim(),
          lastName: fields.lastName.input.value.trim(),
        },
      });
      await loadSession();
      toast("Profile updated.", "success");
    } catch (err) {
      if (err instanceof ApiError && err.status === 400 && err.details) {
        applyServerFieldErrors(fields, err.details);
      }
      errorBanner.textContent = friendlyError(err);
      errorBanner.hidden = false;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Save profile";
    }
  });

  return el("div", { class: "card" }, [
    el("div", { class: "card__head" }, [el("h2", {}, "Profile")]),
    el(
      "p",
      { class: "card__hint" },
      "Username @" + user.username + " · " + countryName,
    ),
    form,
  ]);
}

/* ---- Email ---- */

function buildEmailCard(user) {
  const fields = {
    email: field({
      id: "email-new",
      label: "New email address",
      type: "email",
      required: true,
      autocomplete: "email",
    }),
  };

  const errorBanner = el("div", { class: "form-error" });
  errorBanner.hidden = true;
  const submitBtn = el(
    "button",
    { type: "submit", class: "btn btn--primary" },
    "Update email",
  );

  const form = el("form", { class: "form", novalidate: true }, [
    errorBanner,
    fields.email.wrapper,
    submitBtn,
  ]);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearFieldErrors(fields);
    errorBanner.hidden = true;
    submitBtn.disabled = true;
    submitBtn.textContent = "Updating…";
    try {
      if (!(await reauthenticate("email_change"))) return;
      const data = await apiFetch("/v1/me/email", {
        method: "POST",
        body: {
          email: fields.email.input.value.trim(),
        },
      });
      if (data.unchanged) {
        toast("That's already your email address.");
      } else if (data.emailVerificationRequired) {
        toast(
          "Check your new inbox to confirm the change. Your current email remains active until then.",
          "success",
        );
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 400 && err.details) {
        applyServerFieldErrors(fields, err.details);
      }
      errorBanner.textContent = friendlyError(err);
      errorBanner.hidden = false;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Update email";
    }
  });

  return el("div", { class: "card" }, [
    el("div", { class: "card__head" }, [
      el("h2", {}, "Email address"),
      user.emailVerified
        ? el("span", { class: "badge badge--verified" }, "Verified")
        : el("span", { class: "badge badge--pending" }, "Unverified"),
    ]),
    el("p", { class: "card__hint" }, "Current: " + user.email),
    form,
  ]);
}

/* ---- Username ---- */

function buildUsernameCard(user) {
  const fields = {
    username: field({
      id: "username-new",
      label: "New username",
      required: true,
      autocomplete: "username",
      hint: "3–20 characters: lowercase letters, numbers, dots or underscores.",
      extraAttrs: { minlength: 3, maxlength: 20, pattern: "[a-z0-9._]{3,20}" },
    }),
  };

  const errorBanner = el("div", { class: "form-error" });
  errorBanner.hidden = true;
  const submitBtn = el(
    "button",
    { type: "submit", class: "btn btn--primary" },
    "Update username",
  );

  const form = el("form", { class: "form", novalidate: true }, [
    errorBanner,
    fields.username.wrapper,
    submitBtn,
  ]);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearFieldErrors(fields);
    errorBanner.hidden = true;
    submitBtn.disabled = true;
    submitBtn.textContent = "Updating…";
    try {
      if (!(await reauthenticate())) return;
      const data = await apiFetch("/v1/me/username", {
        method: "POST",
        body: {
          username: fields.username.input.value.trim().toLowerCase(),
        },
      });
      if (data.unchanged) {
        toast("That's already your username.");
      } else {
        state.user = null;
        state.address = null;
        navigate("/login");
        toast("Username updated. Please sign in again.", "success");
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 400 && err.details) {
        applyServerFieldErrors(fields, err.details);
      }
      errorBanner.textContent = friendlyError(err);
      errorBanner.hidden = false;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Update username";
    }
  });

  return el("div", { class: "card" }, [
    el("div", { class: "card__head" }, [el("h2", {}, "Username")]),
    el("p", { class: "card__hint" }, "Current: @" + user.username),
    form,
  ]);
}

/* ---- Password ---- */

function buildSessionsCard() {
  const listContainer = el("div", { class: "entity-list" }, [
    createLoader("Loading sessions…"),
  ]);

  const revokeOthersBtn = el(
    "button",
    { type: "button", class: "btn btn--ghost btn--small" },
    "Sign out of other devices",
  );

  async function refreshSessions() {
    clearNode(listContainer);
    listContainer.append(createLoader("Loading sessions…"));
    try {
      const data = await apiFetch("/v1/me/sessions");
      clearNode(listContainer);
      if (!data.sessions.length) {
        listContainer.append(
          el("p", { class: "empty-note" }, "No active sessions."),
        );
        return;
      }
      data.sessions.forEach((s) => {
        const titleChildren = [describeUserAgent(s.userAgent)];
        if (s.isCurrent)
          titleChildren.push(
            el("span", { class: "badge badge--current" }, "This device"),
          );

        const row = el("div", { class: "entity-row" }, [
          el("div", { class: "entity-row__meta" }, [
            el("div", { class: "entity-row__title" }, titleChildren),
            el(
              "div",
              { class: "entity-row__sub" },
              "Signed in " + formatDateTime(s.createdAt),
            ),
          ]),
        ]);

        if (!s.isCurrent) {
          const revokeBtn = el(
            "button",
            { type: "button", class: "btn btn--ghost btn--small" },
            "Sign out",
          );
          revokeBtn.addEventListener("click", async () => {
            const result = await confirmDialog({
              title: "Sign out this session?",
              body: "This device will be signed out immediately.",
              confirmLabel: "Sign out",
              danger: true,
            });
            if (!result.confirmed) return;
            revokeBtn.disabled = true;
            try {
              await withReauth(() =>
                apiFetch("/v1/me/sessions/" + encodeURIComponent(s.id), {
                  method: "DELETE",
                }),
              );
              toast("Session signed out.", "success");
              await refreshSessions();
            } catch (err) {
              toast(friendlyError(err), "error");
            } finally {
              revokeBtn.disabled = false;
            }
          });
          row.append(revokeBtn);
        }

        listContainer.append(row);
      });
    } catch (err) {
      clearNode(listContainer);
      listContainer.append(
        el("p", { class: "form-error" }, friendlyError(err)),
      );
    }
  }

  revokeOthersBtn.addEventListener("click", async () => {
    const result = await confirmDialog({
      title: "Sign out of other devices?",
      body: "Every session except this one will be signed out immediately.",
      confirmLabel: "Sign out others",
      danger: true,
    });
    if (!result.confirmed) return;
    revokeOthersBtn.disabled = true;
    try {
      const data = await withReauth(() =>
        apiFetch("/v1/me/sessions/revoke-others", { method: "POST" }),
      );
      toast("Signed out of " + data.revoked + " other session(s).", "success");
      await refreshSessions();
    } catch (err) {
      toast(friendlyError(err), "error");
    } finally {
      revokeOthersBtn.disabled = false;
    }
  });

  refreshSessions();

  return el("div", { class: "card" }, [
    el("div", { class: "card__head" }, [
      el("h2", {}, "Sessions"),
      revokeOthersBtn,
    ]),
    el(
      "p",
      { class: "card__hint" },
      "Devices currently signed in to your account.",
    ),
    listContainer,
  ]);
}

/* ---- Passkeys ---- */

function buildAuthenticatorCard() {
  return authenticatorCard({
    el,
    field,
    apiFetch,
    withReauth,
    confirmDialog,
    toast,
    loadSession,
  });
}

function buildPasskeysCard() {
  const listContainer = el("div", { class: "entity-list" }, [
    createLoader("Loading passkeys…"),
  ]);

  async function refreshPasskeys() {
    clearNode(listContainer);
    listContainer.append(createLoader("Loading passkeys…"));
    try {
      const data = await apiFetch("/v1/auth/passkeys");
      clearNode(listContainer);
      if (!data.passkeys.length) {
        listContainer.append(
          el(
            "p",
            { class: "empty-note" },
            "No passkeys yet. Create one below, then choose Sign in with a passkey next time.",
          ),
        );
        return;
      }
      data.passkeys.forEach((p) => {
        const row = el("div", { class: "entity-row" }, [
          el("div", { class: "entity-row__meta" }, [
            el(
              "div",
              { class: "entity-row__title" },
              p.deviceName || "Passkey",
            ),
            el(
              "div",
              { class: "entity-row__sub" },
              "Added " + formatDateTime(p.createdAt),
            ),
          ]),
        ]);
        const removeBtn = el(
          "button",
          { type: "button", class: "btn btn--ghost btn--small" },
          "Remove",
        );
        removeBtn.addEventListener("click", async () => {
          const result = await confirmDialog({
            title: "Remove this passkey?",
            body: "You won't be able to use it to sign in anymore.",
            confirmLabel: "Remove",
            danger: true,
          });
          if (!result.confirmed) return;
          removeBtn.disabled = true;
          try {
            await withReauth(() =>
              apiFetch("/v1/auth/passkeys/" + encodeURIComponent(p.id), {
                method: "DELETE",
              }),
            );
            toast("Passkey removed.", "success");
            await refreshPasskeys();
          } catch (err) {
            toast(friendlyError(err), "error");
          } finally {
            removeBtn.disabled = false;
          }
        });
        row.append(removeBtn);
        listContainer.append(row);
      });
    } catch (err) {
      clearNode(listContainer);
      listContainer.append(
        el("p", { class: "form-error" }, friendlyError(err)),
      );
    }
  }

  let addSection = null;
  if (webauthnSupported()) {
    const nameField = field({
      id: "passkey-device-name",
      label: "Name this passkey (optional)",
      placeholder: "e.g. Work laptop",
    });
    const addBtn = el(
      "button",
      { type: "button", class: "btn btn--ghost btn--small" },
      "Add a passkey",
    );
    addBtn.addEventListener("click", async () => {
      addBtn.disabled = true;
      addBtn.textContent = "Follow your device's prompt…";
      try {
        await registerPasskey(nameField.input.value.trim() || undefined);
        state.user.hasPasskey = true;
        nameField.input.value = "";
        toast("Passkey added.", "success");
        await refreshPasskeys();
      } catch (err) {
        toast(err.message || friendlyError(err), "error");
      } finally {
        addBtn.disabled = false;
        addBtn.textContent = "Add a passkey";
      }
    });
    addSection = el("div", { class: "form" }, [nameField.wrapper, addBtn]);
  } else {
    addSection = el(
      "p",
      { class: "card__hint" },
      "Passkeys aren't supported in this browser.",
    );
  }

  refreshPasskeys();

  return el("div", { class: "card" }, [
    el("div", { class: "card__head" }, [el("h2", {}, "Passkeys")]),
    el(
      "p",
      { class: "card__hint" },
      "Sign in with your fingerprint, face or device PIN instead of a code. Choose Add a passkey and follow your device's prompts to save it.",
    ),
    listContainer,
    el("hr", { class: "card__divider" }),
    addSection,
  ]);
}

/* ---- Data & account (export, delete) ---- */

function buildDataAccountCard(user) {
  const exportBtn = el(
    "button",
    { type: "button", class: "btn btn--ghost" },
    "Download your data",
  );
  exportBtn.addEventListener("click", async () => {
    exportBtn.disabled = true;
    exportBtn.textContent = "Preparing download…";
    try {
      const data = await withReauth(() => apiFetch("/v1/me/export"));
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const link = el("a", {
        href: url,
        download: "chalkline-account-data.json",
      });
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast("Your data export has started downloading.", "success");
    } catch (err) {
      toast(friendlyError(err), "error");
    } finally {
      exportBtn.disabled = false;
      exportBtn.textContent = "Download your data";
    }
  });

  const deleteBtn = el(
    "button",
    { type: "button", class: "btn btn--danger" },
    "Delete account",
  );
  deleteBtn.addEventListener("click", async () => {
    const result = await confirmDialog({
      title: "Delete your account?",
      body: "This permanently deletes your account and everything tied to it. This cannot be undone.",
      confirmLabel: "Delete account",
      danger: true,
    });
    if (!result.confirmed) return;

    deleteBtn.disabled = true;
    try {
      await withReauth(() =>
        apiFetch("/v1/me", {
          method: "DELETE",
        }),
      );
      state.user = null;
      state.address = null;
      navigate("/login");
      toast("Your account has been deleted.", "success");
    } catch (err) {
      toast(friendlyError(err), "error");
    } finally {
      deleteBtn.disabled = false;
    }
  });

  return el("div", { class: "card card--danger" }, [
    el("div", { class: "card__head" }, [el("h2", {}, "Your data")]),
    el(
      "p",
      { class: "card__hint" },
      "Download everything tied to your account, or permanently delete it.",
    ),
    el("div", { class: "btn-row" }, [deleteBtn]),
  ]);
}
