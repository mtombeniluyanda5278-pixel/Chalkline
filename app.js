const COUNTRIES = [
  ['AF', 'Afghanistan'],
  ['AL', 'Albania'],
  ['DZ', 'Algeria'],
  ['AD', 'Andorra'],
  ['AO', 'Angola'],
  ['AG', 'Antigua and Barbuda'],
  ['AR', 'Argentina'],
  ['AM', 'Armenia'],
  ['AU', 'Australia'],
  ['AT', 'Austria'],
  ['AZ', 'Azerbaijan'],
  ['BS', 'Bahamas'],
  ['BH', 'Bahrain'],
  ['BD', 'Bangladesh'],
  ['BB', 'Barbados'],
  ['BY', 'Belarus'],
  ['BE', 'Belgium'],
  ['BZ', 'Belize'],
  ['BJ', 'Benin'],
  ['BT', 'Bhutan'],
  ['BO', 'Bolivia'],
  ['BA', 'Bosnia and Herzegovina'],
  ['BW', 'Botswana'],
  ['BR', 'Brazil'],
  ['BN', 'Brunei'],
  ['BG', 'Bulgaria'],
  ['BF', 'Burkina Faso'],
  ['BI', 'Burundi'],
  ['CV', 'Cabo Verde'],
  ['KH', 'Cambodia'],
  ['CM', 'Cameroon'],
  ['CA', 'Canada'],
  ['CF', 'Central African Republic'],
  ['TD', 'Chad'],
  ['CL', 'Chile'],
  ['CN', 'China'],
  ['CO', 'Colombia'],
  ['KM', 'Comoros'],
  ['CG', 'Congo'],
  ['CD', 'Congo (DRC)'],
  ['CR', 'Costa Rica'],
  ['CI', "Cote d'Ivoire"],
  ['HR', 'Croatia'],
  ['CU', 'Cuba'],
  ['CY', 'Cyprus'],
  ['CZ', 'Czechia'],
  ['DK', 'Denmark'],
  ['DJ', 'Djibouti'],
  ['DM', 'Dominica'],
  ['DO', 'Dominican Republic'],
  ['EC', 'Ecuador'],
  ['EG', 'Egypt'],
  ['SV', 'El Salvador'],
  ['GQ', 'Equatorial Guinea'],
  ['ER', 'Eritrea'],
  ['EE', 'Estonia'],
  ['SZ', 'Eswatini'],
  ['ET', 'Ethiopia'],
  ['FJ', 'Fiji'],
  ['FI', 'Finland'],
  ['FR', 'France'],
  ['GA', 'Gabon'],
  ['GM', 'Gambia'],
  ['GE', 'Georgia'],
  ['DE', 'Germany'],
  ['GH', 'Ghana'],
  ['GR', 'Greece'],
  ['GD', 'Grenada'],
  ['GT', 'Guatemala'],
  ['GN', 'Guinea'],
  ['GW', 'Guinea-Bissau'],
  ['GY', 'Guyana'],
  ['HT', 'Haiti'],
  ['HN', 'Honduras'],
  ['HU', 'Hungary'],
  ['IS', 'Iceland'],
  ['IN', 'India'],
  ['ID', 'Indonesia'],
  ['IR', 'Iran'],
  ['IQ', 'Iraq'],
  ['IE', 'Ireland'],
  ['IL', 'Israel'],
  ['IT', 'Italy'],
  ['JM', 'Jamaica'],
  ['JP', 'Japan'],
  ['JO', 'Jordan'],
  ['KZ', 'Kazakhstan'],
  ['KE', 'Kenya'],
  ['KI', 'Kiribati'],
  ['KW', 'Kuwait'],
  ['KG', 'Kyrgyzstan'],
  ['LA', 'Laos'],
  ['LV', 'Latvia'],
  ['LB', 'Lebanon'],
  ['LS', 'Lesotho'],
  ['LR', 'Liberia'],
  ['LY', 'Libya'],
  ['LI', 'Liechtenstein'],
  ['LT', 'Lithuania'],
  ['LU', 'Luxembourg'],
  ['MG', 'Madagascar'],
  ['MW', 'Malawi'],
  ['MY', 'Malaysia'],
  ['MV', 'Maldives'],
  ['ML', 'Mali'],
  ['MT', 'Malta'],
  ['MH', 'Marshall Islands'],
  ['MR', 'Mauritania'],
  ['MU', 'Mauritius'],
  ['MX', 'Mexico'],
  ['FM', 'Micronesia'],
  ['MD', 'Moldova'],
  ['MC', 'Monaco'],
  ['MN', 'Mongolia'],
  ['ME', 'Montenegro'],
  ['MA', 'Morocco'],
  ['MZ', 'Mozambique'],
  ['MM', 'Myanmar'],
  ['NA', 'Namibia'],
  ['NR', 'Nauru'],
  ['NP', 'Nepal'],
  ['NL', 'Netherlands'],
  ['NZ', 'New Zealand'],
  ['NI', 'Nicaragua'],
  ['NE', 'Niger'],
  ['NG', 'Nigeria'],
  ['KP', 'North Korea'],
  ['MK', 'North Macedonia'],
  ['NO', 'Norway'],
  ['OM', 'Oman'],
  ['PK', 'Pakistan'],
  ['PW', 'Palau'],
  ['PA', 'Panama'],
  ['PG', 'Papua New Guinea'],
  ['PY', 'Paraguay'],
  ['PE', 'Peru'],
  ['PH', 'Philippines'],
  ['PL', 'Poland'],
  ['PT', 'Portugal'],
  ['QA', 'Qatar'],
  ['RO', 'Romania'],
  ['RU', 'Russia'],
  ['RW', 'Rwanda'],
  ['KN', 'Saint Kitts and Nevis'],
  ['LC', 'Saint Lucia'],
  ['VC', 'Saint Vincent and the Grenadines'],
  ['WS', 'Samoa'],
  ['SM', 'San Marino'],
  ['ST', 'Sao Tome and Principe'],
  ['SA', 'Saudi Arabia'],
  ['SN', 'Senegal'],
  ['RS', 'Serbia'],
  ['SC', 'Seychelles'],
  ['SL', 'Sierra Leone'],
  ['SG', 'Singapore'],
  ['SK', 'Slovakia'],
  ['SI', 'Slovenia'],
  ['SB', 'Solomon Islands'],
  ['SO', 'Somalia'],
  ['ZA', 'South Africa'],
  ['KR', 'South Korea'],
  ['SS', 'South Sudan'],
  ['ES', 'Spain'],
  ['LK', 'Sri Lanka'],
  ['SD', 'Sudan'],
  ['SR', 'Suriname'],
  ['SE', 'Sweden'],
  ['CH', 'Switzerland'],
  ['SY', 'Syria'],
  ['TW', 'Taiwan'],
  ['TJ', 'Tajikistan'],
  ['TZ', 'Tanzania'],
  ['TH', 'Thailand'],
  ['TL', 'Timor-Leste'],
  ['TG', 'Togo'],
  ['TO', 'Tonga'],
  ['TT', 'Trinidad and Tobago'],
  ['TN', 'Tunisia'],
  ['TR', 'Turkiye'],
  ['TM', 'Turkmenistan'],
  ['TV', 'Tuvalu'],
  ['UG', 'Uganda'],
  ['UA', 'Ukraine'],
  ['AE', 'United Arab Emirates'],
  ['GB', 'United Kingdom'],
  ['US', 'United States'],
  ['UY', 'Uruguay'],
  ['UZ', 'Uzbekistan'],
  ['VU', 'Vanuatu'],
  ['VA', 'Vatican City'],
  ['VE', 'Venezuela'],
  ['VN', 'Vietnam'],
  ['YE', 'Yemen'],
  ['ZM', 'Zambia'],
  ['ZW', 'Zimbabwe'],
];

/* ==========================================================================
   Chalkline — frontend logic
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
  const kids = children === undefined ? [] : Array.isArray(children) ? children : [children];
  for (const child of kids) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
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
    headers: Object.assign({ "Content-Type": "application/json" }, options.headers || {}),
    credentials: "same-origin",
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
    const message = (data && data.error) || "Something went wrong. Please try again.";
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
      ? el("select", Object.assign({ id: id, name: config.name || id, required: config.required || undefined }, config.extraAttrs || {}))
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
  const wrapper = el("div", { class: wrapperClass }, config.checkbox ? [input, label] : wrapperChildren);

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
    confirmBtn.className = "btn " + (opts.danger ? "btn--danger" : "btn--primary");
    confirmBtn.textContent = opts.confirmLabel || "Confirm";

    let passwordInput = null;
    if (opts.requirePassword) {
      const passField = field({
        id: "confirm-dialog-password",
        label: opts.passwordLabel || "Current password",
        type: "password",
        autocomplete: "current-password",
        hint: opts.passwordHint,
      });
      passwordInput = passField.input;
      extraEl.append(passField.wrapper);
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
      if (opts.requirePassword && opts.passwordRequired !== false && !passwordInput.value) {
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

/* Re-authentication: some actions (export, revoke session, remove passkey,
   delete account, add passkey) require a session authenticated within the
   last 15 minutes. When the API reports REAUTH_REQUIRED we ask for the
   current password once and retry the original request. */
async function reauthenticate() {
  const result = await confirmDialog({
    title: "Confirm it's you",
    body: "For your security, please re-enter your password to continue.",
    confirmLabel: "Continue",
    requirePassword: true,
    passwordLabel: "Password",
  });
  if (!result.confirmed) return false;
  try {
    await apiFetch("/v1/auth/login", {
      method: "POST",
      body: { email: state.user.email, password: result.password },
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
  const base64 = (base64url + "=".repeat(padLength)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes.buffer;
}

function bufferToBase64url(buffer) {
  const bytes = new Uint8Array(buffer);
  let str = "";
  for (let i = 0; i < bytes.byteLength; i++) str += String.fromCharCode(bytes[i]);
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
  if (response.userHandle) body.response.userHandle = bufferToBase64url(response.userHandle);
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
  await withReauth(() => apiFetch("/v1/auth/passkeys/register/verify", { method: "POST", body: body }));
}

async function loginWithPasskey() {
  const options = await apiFetch("/v1/auth/passkeys/login/options", { method: "POST" });
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
  const body = authenticationCredentialToJSON(assertion);
  await apiFetch("/v1/auth/passkeys/login/verify", { method: "POST", body: body });
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

const viewRoot = document.getElementById("view-root");
const siteNav = document.getElementById("site-nav");

async function loadSession() {
  try {
    const data = await apiFetch("/v1/me");

    state.user = data.user;
    state.address = data.address;

    return true;
  } catch (err) {
    // Only treat an actual authentication failure as "logged out".
    // A server error, rate limit, or network failure should not
    // wipe the current client state.
    if (
      err instanceof ApiError &&
      (err.status === 401 || err.status === 403)
    ) {
      if (err.status === 401 || err.status === 403) {
  state.user = null;
  state.address = null;
}
      return false;
    }

    throw err;
  }
}

function renderNav() {
  clearNode(siteNav);
  if (state.user) {
    siteNav.append(
      el("span", { class: "site-nav__greeting" }, "Signed in as " + state.user.username),
      el("a", { href: "#/account" }, "Account"),
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
  try {
    await apiFetch("/v1/auth/logout", { method: "POST" });
  } catch (err) {
    /* Even if this fails, clear local state so the UI reflects "signed out". */
  }
  state.user = null;
  state.address = null;
  renderNav();
  navigate("/login");
  toast("You've been signed out.");
}

const ROUTES = {
  "/": { render: async () => navigate(state.user ? "/account" : "/login") },
  "/login": { guestOnly: true, render: renderLogin },
  "/register": { guestOnly: true, render: renderRegister },
  "/forgot-password": { guestOnly: true, render: renderForgotPassword },
  "/reset-password": { guestOnly: true, render: renderResetPassword },
  "/verify-email": { render: renderVerifyEmail },
  "/account": { authOnly: true, render: renderAccount },
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

async function renderRoute() {
  const parsed = parseHash();
  const route = ROUTES[parsed.path] || ROUTES["/"];

  if (route.authOnly && !state.user) {
    navigate("/login");
    return;
  }
  if (route.guestOnly && state.user) {
    navigate("/account");
    return;
  }

  renderNav();
  clearNode(viewRoot);

  try {
    await route.render(parsed.params);
  } catch (err) {
    clearNode(viewRoot);
    viewRoot.append(
      el("div", { class: "page-head" }, [
        el("h1", {}, "Something went wrong"),
        el("p", {}, friendlyError(err)),
      ]),
    );
  }

  const heading = viewRoot.querySelector("h1");
  if (heading) {
    heading.setAttribute("tabindex", "-1");
    heading.focus();
  }
}

window.addEventListener("hashchange", renderRoute);

document.addEventListener("DOMContentLoaded", async () => {
  await loadSession();
  if (!location.hash) {
    location.hash = state.user ? "/account" : "/login";
  }
  await renderRoute();
});

/* ---------------------------------------------------------------------- */
/* View: Sign in                                                          */
/* ---------------------------------------------------------------------- */

async function renderLogin() {
  const fields = {
    email: field({ id: "login-email", label: "Email", type: "email", required: true, autocomplete: "email" }),
    password: field({
      id: "login-password",
      label: "Password",
      type: "password",
      required: true,
      autocomplete: "current-password",
    }),
  };

  const errorBanner = el("div", { class: "form-error" });
  errorBanner.hidden = true;

  const submitBtn = el("button", { type: "submit", class: "btn btn--primary btn--full" }, "Sign in");

  const form = el(
    "form",
    { class: "form", novalidate: true },
    [errorBanner, fields.email.wrapper, fields.password.wrapper, submitBtn],
  );

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearFieldErrors(fields);
    errorBanner.hidden = true;
    submitBtn.disabled = true;
    submitBtn.textContent = "Signing in…";
    try {
      await apiFetch("/v1/auth/login", {
        method: "POST",
        body: { email: fields.email.input.value.trim(), password: fields.password.input.value },
      });
      await loadSession();
      navigate("/account");
      toast("Welcome back.", "success");
    } catch (err) {
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

  const passkeyRow = [];
  if (webauthnSupported()) {
    const passkeyBtn = el(
      "button",
      { type: "button", class: "btn btn--ghost btn--full" },
      "Sign in with a passkey",
    );
    passkeyBtn.addEventListener("click", async () => {
      passkeyBtn.disabled = true;
      try {
        await loginWithPasskey();
        await loadSession();
        navigate("/account");
        toast("Welcome back.", "success");
      } catch (err) {
        toast(err.message || friendlyError(err), "error");
      } finally {
        passkeyBtn.disabled = false;
      }
    });
    passkeyRow.push(el("hr", { class: "divider-line" }), passkeyBtn);
  }

  viewRoot.append(
    el("div", { class: "auth-shell" }, [
      el("div", { class: "page-head" }, [
        el("h1", {}, "Sign in"),
        el("p", {}, "Welcome back to Chalkline."),
      ]),
      el("div", { class: "card" }, [form].concat(passkeyRow)),
      el("div", { class: "link-row" }, [
        el("a", { href: "#/forgot-password" }, "Forgot your password?"),
        el("a", { href: "#/register" }, "Create an account"),
      ]),
    ]),
  );
}

/* ---------------------------------------------------------------------- */
/* View: Register                                                         */
/* ---------------------------------------------------------------------- */

async function renderRegister() {
  const fields = {
    firstName: field({ id: "reg-first-name", label: "First name", required: true, autocomplete: "given-name" }),
    lastName: field({ id: "reg-last-name", label: "Last name", required: true, autocomplete: "family-name" }),
    country: field({
      id: "reg-country",
      label: "Country",
      tag: "select",
      required: true,
    }),
    dateOfBirth: field({
      id: "reg-dob",
      label: "Date of birth",
      type: "date",
      required: true,
      autocomplete: "bday",
    }),
    email: field({ id: "reg-email", label: "Email", type: "email", required: true, autocomplete: "email" }),
    username: field({
      id: "reg-username",
      label: "Username",
      required: true,
      autocomplete: "username",
      hint: "3–20 characters: lowercase letters, numbers, dots or underscores.",
      extraAttrs: { minlength: 3, maxlength: 20, pattern: "[a-z0-9._]{3,20}" },
    }),
    phone: field({
      id: "reg-phone",
      label: "Phone",
      type: "tel",
      required: true,
      autocomplete: "tel",
      hint: "Include the country code, e.g. +27821234567.",
      extraAttrs: { pattern: "\\+[1-9]\\d{7,14}" },
    }),
    password: field({
      id: "reg-password",
      label: "Password",
      type: "password",
      required: true,
      autocomplete: "new-password",
      hint: "At least 12 characters.",
      extraAttrs: { minlength: 12, maxlength: 72 },
    }),
    confirmPassword: field({
      id: "reg-confirm-password",
      label: "Confirm password",
      type: "password",
      required: true,
      autocomplete: "new-password",
    }),
    addressLine1: field({ id: "reg-address-line1", label: "Address line 1", required: true, autocomplete: "address-line1" }),
    addressLine2: field({ id: "reg-address-line2", label: "Address line 2 (optional)", autocomplete: "address-line2" }),
    addressCity: field({ id: "reg-address-city", label: "City", required: true, autocomplete: "address-level2" }),
    addressRegion: field({ id: "reg-address-region", label: "State / region (optional)", autocomplete: "address-level1" }),
    addressPostalCode: field({ id: "reg-address-postal", label: "Postal code", required: true, autocomplete: "postal-code" }),
    addressCountry: field({ id: "reg-address-country", label: "Country", tag: "select", required: true }),
  };

  populateCountrySelect(fields.country.input);
  populateCountrySelect(fields.addressCountry.input);

  marketingAnnouncements.input.type = "checkbox";

  marketingApps.input.type = "checkbox";

  const errorBanner = el("div", { class: "form-error" });
  errorBanner.hidden = true;

  const submitBtn = el("button", { type: "submit", class: "btn btn--primary btn--full" }, "Create account");

  const form = el("form", { class: "form", novalidate: true }, [
    errorBanner,
    el("div", { class: "form-row" }, [fields.firstName.wrapper, fields.lastName.wrapper]),
    el("div", { class: "form-row" }, [fields.country.wrapper, fields.dateOfBirth.wrapper]),
    fields.email.wrapper,
    fields.username.wrapper,
    fields.phone.wrapper,
    el("div", { class: "form-row" }, [fields.password.wrapper, fields.confirmPassword.wrapper]),
    el("fieldset", {}, [
      el("legend", {}, "Address"),
      fields.addressLine1.wrapper,
      fields.addressLine2.wrapper,
      el("div", { class: "form-row" }, [fields.addressCity.wrapper, fields.addressRegion.wrapper]),
      el("div", { class: "form-row" }, [fields.addressPostalCode.wrapper, fields.addressCountry.wrapper]),
    ]),
    marketingAnnouncements.wrapper,
    marketingApps.wrapper,
    submitBtn,
  ]);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearFieldErrors(fields);
    errorBanner.hidden = true;

    if (!form.reportValidity()) return;

    submitBtn.disabled = true;
    submitBtn.textContent = "Creating account…";

    const body = {
      firstName: fields.firstName.input.value.trim(),
      lastName: fields.lastName.input.value.trim(),
      country: fields.country.input.value,
      dateOfBirth: fields.dateOfBirth.input.value,
      email: fields.email.input.value.trim(),
      password: fields.password.input.value,
      confirmPassword: fields.confirmPassword.input.value,
      username: fields.username.input.value.trim().toLowerCase(),
      phone: fields.phone.input.value.trim(),
      address: {
        line1: fields.addressLine1.input.value.trim(),
        line2: fields.addressLine2.input.value.trim() || undefined,
        city: fields.addressCity.input.value.trim(),
        region: fields.addressRegion.input.value.trim() || undefined,
        postalCode: fields.addressPostalCode.input.value.trim(),
        country: fields.addressCountry.input.value,
      },
    };

    try {
      await apiFetch("/v1/auth/register", { method: "POST", body: body });
      await loadSession();
      navigate("/account");
      toast("Account created. Check your email to verify your address.", "success");
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
      el("div", { class: "card" }, [form]),
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

async function renderForgotPassword() {
  const fields = {
    email: field({ id: "forgot-email", label: "Email", type: "email", required: true, autocomplete: "email" }),
  };

  const errorBanner = el("div", { class: "form-error" });
  errorBanner.hidden = true;
  const successBanner = el("div", { class: "form-success" });
  successBanner.hidden = true;

  const submitBtn = el("button", { type: "submit", class: "btn btn--primary btn--full" }, "Send reset link");

  const form = el("form", { class: "form", novalidate: true }, [errorBanner, successBanner, fields.email.wrapper, submitBtn]);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearFieldErrors(fields);
    errorBanner.hidden = true;
    submitBtn.disabled = true;
    submitBtn.textContent = "Sending…";
    try {
      const data = await apiFetch("/v1/auth/password-reset/request", {
        method: "POST",
        body: { email: fields.email.input.value.trim() },
      });
      successBanner.textContent =
        data.message || "If an account exists for that email, we've sent a reset link.";
      successBanner.hidden = false;
      fields.email.input.value = "";
    } catch (err) {
      errorBanner.textContent = friendlyError(err);
      errorBanner.hidden = false;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Send reset link";
    }
  });

  viewRoot.append(
    el("div", { class: "auth-shell" }, [
      el("div", { class: "page-head" }, [
        el("h1", {}, "Reset your password"),
        el("p", {}, "We'll email you a link to choose a new one."),
      ]),
      el("div", { class: "card" }, [form]),
      el("div", { class: "link-row" }, [el("a", { href: "#/login" }, "Back to sign in")]),
    ]),
  );
}

/* ---------------------------------------------------------------------- */
/* View: Reset password (from emailed link, ?token=...)                   */
/* ---------------------------------------------------------------------- */

async function renderResetPassword(params) {
  const token = params.get("token");

  if (!token) {
    viewRoot.append(
      el("div", { class: "auth-shell" }, [
        el("div", { class: "page-head" }, [el("h1", {}, "Reset link invalid")]),
        el("div", { class: "card" }, [
          el("p", {}, "This link is missing its reset token. Request a new one below."),
          el("a", { class: "btn btn--primary", href: "#/forgot-password" }, "Request a new link"),
        ]),
      ]),
    );
    return;
  }

  const fields = {
    password: field({
      id: "reset-password",
      label: "New password",
      type: "password",
      required: true,
      autocomplete: "new-password",
      hint: "At least 12 characters.",
      extraAttrs: { minlength: 12, maxlength: 72 },
    }),
    confirmPassword: field({
      id: "reset-confirm-password",
      label: "Confirm new password",
      type: "password",
      required: true,
      autocomplete: "new-password",
    }),
  };

  const errorBanner = el("div", { class: "form-error" });
  errorBanner.hidden = true;

  const submitBtn = el("button", { type: "submit", class: "btn btn--primary btn--full" }, "Set new password");

  const form = el("form", { class: "form", novalidate: true }, [
    errorBanner,
    fields.password.wrapper,
    fields.confirmPassword.wrapper,
    submitBtn,
  ]);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearFieldErrors(fields);
    errorBanner.hidden = true;

    if (fields.password.input.value !== fields.confirmPassword.input.value) {
      setFieldError(fields.confirmPassword, "Passwords do not match");
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Updating…";
    try {
      await apiFetch("/v1/auth/password-reset/confirm", {
        method: "POST",
        body: {
          token: token,
          password: fields.password.input.value,
          confirmPassword: fields.confirmPassword.input.value,
        },
      });
      navigate("/login");
      toast("Password updated. Please sign in.", "success");
    } catch (err) {
      if (err instanceof ApiError && err.status === 400 && err.details) {
        applyServerFieldErrors(fields, err.details);
      }
      errorBanner.textContent = friendlyError(err);
      errorBanner.hidden = false;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Set new password";
    }
  });

  viewRoot.append(
    el("div", { class: "auth-shell" }, [
      el("div", { class: "page-head" }, [el("h1", {}, "Choose a new password")]),
      el("div", { class: "card" }, [form]),
    ]),
  );
}

/* ---------------------------------------------------------------------- */
/* View: Verify email (from emailed link, ?token=...)                     */
/* ---------------------------------------------------------------------- */

async function renderVerifyEmail(params) {
  const token = params.get("token");
  const card = el("div", { class: "card" }, [el("p", {}, "Checking your link…")]);

  viewRoot.append(
    el("div", { class: "auth-shell" }, [el("div", { class: "page-head" }, [el("h1", {}, "Verify your email")]), card]),
  );

  clearNode(card);

  if (!token) {
    card.append(
      el("p", {}, "This verification link is missing a token."),
      el("a", { class: "btn btn--primary", href: state.user ? "#/account" : "#/login" }, "Continue"),
    );
    return;
  }

  try {
    await apiFetch("/v1/auth/verify-email", { method: "POST", body: { token: token } });
    if (state.user) await loadSession();
    card.append(
      el("p", { class: "form-success" }, "Your email address is verified."),
      el("a", { class: "btn btn--primary", href: state.user ? "#/account" : "#/login" }, "Continue"),
    );
  } catch (err) {
    const actions = [el("a", { class: "btn btn--ghost", href: state.user ? "#/account" : "#/login" }, "Continue")];
    if (state.user) {
      const resendBtn = el("button", { type: "button", class: "btn btn--primary" }, "Resend verification email");
      resendBtn.addEventListener("click", async () => {
        resendBtn.disabled = true;
        try {
          await apiFetch("/v1/auth/verify-email/resend", { method: "POST" });
          toast("Verification email sent.", "success");
        } catch (resendErr) {
          toast(friendlyError(resendErr), "error");
        } finally {
          resendBtn.disabled = false;
        }
      });
      actions.unshift(resendBtn);
    }
    card.append(el("p", { class: "form-error" }, friendlyError(err)), el("div", { class: "btn-row" }, actions));
  }
}

/* ---------------------------------------------------------------------- */
/* View: Account (the main dashboard)                                     */
/* ---------------------------------------------------------------------- */

async function renderAccount() {
  await loadSession();
  if (!state.user) {
    navigate("/login");
    return;
  }
  const user = state.user;
  const address = state.address;

  const dataCard = buildDataAccountCard(user);

  viewRoot.append(
    el("div", { class: "page-head" }, [
      el("h1", {}, greetingForNow() + ", " + user.firstName + "."),
      el("p", {}, "Here's where things stand."),
    ]),
    buildStatusCard(user),
    el("div", { class: "section-grid" }, [
      buildProfileCard(user, address),
      buildEmailCard(user),
      buildUsernameCard(user),
      buildPhoneCard(user),
      buildPasswordCard(),
      buildSessionsCard(),
      buildPasskeysCard(),
    ]),
    dataCard,
  );
}

function buildResendVerificationButton() {
  const btn = el("button", { type: "button", class: "btn btn--ghost btn--small" }, "Resend verification email");
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    try {
      const data = await apiFetch("/v1/auth/verify-email/resend", { method: "POST" });
      toast(data.alreadyVerified ? "Your email is already verified." : "Verification email sent.", "success");
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
    el("h2", {}, user.emailVerified ? "Your email is verified" : "Verify your email"),
    el(
      "p",
      { class: "card__hint" },
      user.emailVerified
        ? "You're all set."
        : "Check " + user.email + " for a verification link, or resend it below.",
    ),
  ]);

  const action = user.emailVerified
    ? el("span", { class: "badge badge--verified" }, "Verified")
    : buildResendVerificationButton();

  return el("div", { class: "card card--accent status-card" }, [body, action]);
}

/* ---- Profile (name + address) ---- */

function buildProfileCard(user, address) {
  const countryName =
    (COUNTRIES.find((c) => c[0] === user.country) || [null, user.country])[1];

  const fields = {
    firstName: field({ id: "profile-first-name", label: "First name", required: true, autocomplete: "given-name" }),
    lastName: field({ id: "profile-last-name", label: "Last name", required: true, autocomplete: "family-name" }),
    addressLine1: field({ id: "profile-address-line1", label: "Address line 1", required: true, autocomplete: "address-line1" }),
    addressLine2: field({ id: "profile-address-line2", label: "Address line 2 (optional)", autocomplete: "address-line2" }),
    addressCity: field({ id: "profile-address-city", label: "City", required: true, autocomplete: "address-level2" }),
    addressRegion: field({ id: "profile-address-region", label: "State / region (optional)", autocomplete: "address-level1" }),
    addressPostalCode: field({ id: "profile-address-postal", label: "Postal code", required: true, autocomplete: "postal-code" }),
    addressCountry: field({ id: "profile-address-country", label: "Country", tag: "select", required: true }),
  };

  fields.firstName.input.value = user.firstName;
  fields.lastName.input.value = user.lastName;
  populateCountrySelect(fields.addressCountry.input, address ? address.country : null);
  if (address) {
    fields.addressLine1.input.value = address.line1 || "";
    fields.addressLine2.input.value = address.line2 || "";
    fields.addressCity.input.value = address.city || "";
    fields.addressRegion.input.value = address.region || "";
    fields.addressPostalCode.input.value = address.postalCode || "";
  }

  const errorBanner = el("div", { class: "form-error" });
  errorBanner.hidden = true;
  const submitBtn = el("button", { type: "submit", class: "btn btn--primary" }, "Save profile");

  const form = el("form", { class: "form", novalidate: true }, [
    errorBanner,
    el("div", { class: "form-row" }, [fields.firstName.wrapper, fields.lastName.wrapper]),
    el("fieldset", {}, [
      el("legend", {}, "Address"),
      fields.addressLine1.wrapper,
      fields.addressLine2.wrapper,
      el("div", { class: "form-row" }, [fields.addressCity.wrapper, fields.addressRegion.wrapper]),
      el("div", { class: "form-row" }, [fields.addressPostalCode.wrapper, fields.addressCountry.wrapper]),
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
          address: {
            line1: fields.addressLine1.input.value.trim(),
            line2: fields.addressLine2.input.value.trim() || undefined,
            city: fields.addressCity.input.value.trim(),
            region: fields.addressRegion.input.value.trim() || undefined,
            postalCode: fields.addressPostalCode.input.value.trim(),
            country: fields.addressCountry.input.value,
          },
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
    el("p", { class: "card__hint" }, "Username @" + user.username + " · " + countryName),
    form,
  ]);
}

/* ---- Email ---- */

function buildEmailCard(user) {
  const fields = {
    email: field({ id: "email-new", label: "New email address", type: "email", required: true, autocomplete: "email" }),
    currentPassword: field({
      id: "email-current-password",
      label: "Current password",
      type: "password",
      required: true,
      autocomplete: "current-password",
    }),
  };

  const errorBanner = el("div", { class: "form-error" });
  errorBanner.hidden = true;
  const submitBtn = el("button", { type: "submit", class: "btn btn--primary" }, "Update email");

  const form = el("form", { class: "form", novalidate: true }, [
    errorBanner,
    fields.email.wrapper,
    fields.currentPassword.wrapper,
    submitBtn,
  ]);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearFieldErrors(fields);
    errorBanner.hidden = true;
    submitBtn.disabled = true;
    submitBtn.textContent = "Updating…";
    try {
      const data = await apiFetch("/v1/me/email", {
        method: "POST",
        body: {
          email: fields.email.input.value.trim(),
          currentPassword: fields.currentPassword.input.value,
        },
      });
      if (data.unchanged) {
        toast("That's already your email address.");
      } else if (data.emailVerificationRequired) {
        state.user = null;
        state.address = null;
        navigate("/login");
        toast("Email updated. Check your inbox to verify it, then sign in again.", "success");
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
    currentPassword: field({
      id: "username-current-password",
      label: "Current password",
      type: "password",
      required: true,
      autocomplete: "current-password",
    }),
  };

  const errorBanner = el("div", { class: "form-error" });
  errorBanner.hidden = true;
  const submitBtn = el("button", { type: "submit", class: "btn btn--primary" }, "Update username");

  const form = el("form", { class: "form", novalidate: true }, [
    errorBanner,
    fields.username.wrapper,
    fields.currentPassword.wrapper,
    submitBtn,
  ]);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearFieldErrors(fields);
    errorBanner.hidden = true;
    submitBtn.disabled = true;
    submitBtn.textContent = "Updating…";
    try {
      const data = await apiFetch("/v1/me/username", {
        method: "POST",
        body: {
          username: fields.username.input.value.trim().toLowerCase(),
          currentPassword: fields.currentPassword.input.value,
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

/* ---- Phone ---- */

function buildPhoneCard(user) {
  const fields = {
    phone: field({
      id: "phone-new",
      label: "New phone number",
      type: "tel",
      required: true,
      autocomplete: "tel",
      hint: "Include the country code, e.g. +27821234567.",
      extraAttrs: { pattern: "\\+[1-9]\\d{7,14}" },
    }),
    currentPassword: field({
      id: "phone-current-password",
      label: "Current password",
      type: "password",
      required: true,
      autocomplete: "current-password",
    }),
  };

  const errorBanner = el("div", { class: "form-error" });
  errorBanner.hidden = true;
  const submitBtn = el("button", { type: "submit", class: "btn btn--primary" }, "Update phone");

  const form = el("form", { class: "form", novalidate: true }, [
    errorBanner,
    fields.phone.wrapper,
    fields.currentPassword.wrapper,
    submitBtn,
  ]);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearFieldErrors(fields);
    errorBanner.hidden = true;
    submitBtn.disabled = true;
    submitBtn.textContent = "Updating…";
    try {
      const data = await apiFetch("/v1/me/phone", {
        method: "POST",
        body: {
          phone: fields.phone.input.value.trim(),
          currentPassword: fields.currentPassword.input.value,
        },
      });
      await loadSession();
      toast(data.unchanged ? "That's already your phone number." : "Phone number updated.", "success");
      fields.currentPassword.input.value = "";
    } catch (err) {
      if (err instanceof ApiError && err.status === 400 && err.details) {
        applyServerFieldErrors(fields, err.details);
      }
      errorBanner.textContent = friendlyError(err);
      errorBanner.hidden = false;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Update phone";
    }
  });

  return el("div", { class: "card" }, [
    el("div", { class: "card__head" }, [
      el("h2", {}, "Phone number"),
    ]),
    el("p", { class: "card__hint" }, user.phoneVerified === false ? "Phone verification isn't available yet." : ""),
    form,
  ]);
}

/* ---- Password ---- */

function buildPasswordCard() {
  const fields = {
    currentPassword: field({
      id: "password-current",
      label: "Current password",
      type: "password",
      required: true,
      autocomplete: "current-password",
    }),
    newPassword: field({
      id: "password-new",
      label: "New password",
      type: "password",
      required: true,
      autocomplete: "new-password",
      hint: "At least 12 characters.",
      extraAttrs: { minlength: 12, maxlength: 72 },
    }),
    confirmPassword: field({
      id: "password-confirm",
      label: "Confirm new password",
      type: "password",
      required: true,
      autocomplete: "new-password",
    }),
  };

  const errorBanner = el("div", { class: "form-error" });
  errorBanner.hidden = true;
  const submitBtn = el("button", { type: "submit", class: "btn btn--primary" }, "Update password");

  const form = el("form", { class: "form", novalidate: true }, [
    errorBanner,
    fields.currentPassword.wrapper,
    fields.newPassword.wrapper,
    fields.confirmPassword.wrapper,
    submitBtn,
  ]);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearFieldErrors(fields);
    errorBanner.hidden = true;

    if (fields.newPassword.input.value !== fields.confirmPassword.input.value) {
      setFieldError(fields.confirmPassword, "Passwords do not match");
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Updating…";
    try {
      await apiFetch("/v1/me/password", {
        method: "POST",
        body: {
          currentPassword: fields.currentPassword.input.value,
          newPassword: fields.newPassword.input.value,
          confirmPassword: fields.confirmPassword.input.value,
        },
      });
      form.reset();
      toast("Password updated. You've been signed out of other devices.", "success");
    } catch (err) {
      if (err instanceof ApiError && err.status === 400 && err.details) {
        applyServerFieldErrors(fields, err.details);
      }
      errorBanner.textContent = friendlyError(err);
      errorBanner.hidden = false;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Update password";
    }
  });

  return el("div", { class: "card" }, [el("div", { class: "card__head" }, [el("h2", {}, "Password")]), form]);
}

/* ---- Sessions ---- */

function buildSessionsCard() {
  const listContainer = el("div", { class: "entity-list" }, [el("p", { class: "loading-note" }, "Loading sessions…")]);

  const revokeOthersBtn = el("button", { type: "button", class: "btn btn--ghost btn--small" }, "Sign out of other devices");

  async function refreshSessions() {
    clearNode(listContainer);
    listContainer.append(el("p", { class: "loading-note" }, "Loading sessions…"));
    try {
      const data = await apiFetch("/v1/me/sessions");
      clearNode(listContainer);
      if (!data.sessions.length) {
        listContainer.append(el("p", { class: "empty-note" }, "No active sessions."));
        return;
      }
      data.sessions.forEach((s) => {
        const titleChildren = [describeUserAgent(s.userAgent)];
        if (s.isCurrent) titleChildren.push(el("span", { class: "badge badge--current" }, "This device"));

        const row = el("div", { class: "entity-row" }, [
          el("div", { class: "entity-row__meta" }, [
            el("div", { class: "entity-row__title" }, titleChildren),
            el(
              "div",
              { class: "entity-row__sub" },
              (s.ip ? s.ip + " · " : "") + "Signed in " + formatDateTime(s.createdAt),
            ),
          ]),
        ]);

        if (!s.isCurrent) {
          const revokeBtn = el("button", { type: "button", class: "btn btn--ghost btn--small" }, "Sign out");
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
              await withReauth(() => apiFetch("/v1/me/sessions/" + encodeURIComponent(s.id), { method: "DELETE" }));
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
      listContainer.append(el("p", { class: "form-error" }, friendlyError(err)));
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
      const data = await withReauth(() => apiFetch("/v1/me/sessions/revoke-others", { method: "POST" }));
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
    el("div", { class: "card__head" }, [el("h2", {}, "Sessions"), revokeOthersBtn]),
    el("p", { class: "card__hint" }, "Devices currently signed in to your account."),
    listContainer,
  ]);
}

/* ---- Passkeys ---- */

function buildPasskeysCard() {
  const listContainer = el("div", { class: "entity-list" }, [el("p", { class: "loading-note" }, "Loading passkeys…")]);

  async function refreshPasskeys() {
    clearNode(listContainer);
    listContainer.append(el("p", { class: "loading-note" }, "Loading passkeys…"));
    try {
      const data = await apiFetch("/v1/auth/passkeys");
      clearNode(listContainer);
      if (!data.passkeys.length) {
        listContainer.append(el("p", { class: "empty-note" }, "No passkeys yet. Add one to sign in without a password."));
        return;
      }
      data.passkeys.forEach((p) => {
        const row = el("div", { class: "entity-row" }, [
          el("div", { class: "entity-row__meta" }, [
            el("div", { class: "entity-row__title" }, p.deviceName || "Passkey"),
            el("div", { class: "entity-row__sub" }, "Added " + formatDateTime(p.createdAt)),
          ]),
        ]);
        const removeBtn = el("button", { type: "button", class: "btn btn--ghost btn--small" }, "Remove");
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
            await withReauth(() => apiFetch("/v1/auth/passkeys/" + encodeURIComponent(p.id), { method: "DELETE" }));
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
      listContainer.append(el("p", { class: "form-error" }, friendlyError(err)));
    }
  }

  let addSection = null;
  if (webauthnSupported()) {
    const nameField = field({
      id: "passkey-device-name",
      label: "Name this passkey (optional)",
      placeholder: "e.g. Work laptop",
    });
    const addBtn = el("button", { type: "button", class: "btn btn--ghost btn--small" }, "Add a passkey");
    addBtn.addEventListener("click", async () => {
      addBtn.disabled = true;
      addBtn.textContent = "Follow your device's prompt…";
      try {
        await registerPasskey(nameField.input.value.trim() || undefined);
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
    addSection = el("p", { class: "card__hint" }, "Passkeys aren't supported in this browser.");
  }

  refreshPasskeys();

  return el("div", { class: "card" }, [
    el("div", { class: "card__head" }, [el("h2", {}, "Passkeys")]),
    el("p", { class: "card__hint" }, "Sign in without typing a password."),
    listContainer,
    el("hr", { class: "card__divider" }),
    addSection,
  ]);
}

/* ---- Data & account (export, delete) ---- */

function buildDataAccountCard(user) {
  const exportBtn = el("button", { type: "button", class: "btn btn--ghost" }, "Download your data");
  exportBtn.addEventListener("click", async () => {
    exportBtn.disabled = true;
    exportBtn.textContent = "Preparing download…";
    try {
      const data = await withReauth(() => apiFetch("/v1/me/export"));
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = el("a", { href: url, download: "chalkline-account-data.json" });
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

  const deleteBtn = el("button", { type: "button", class: "btn btn--danger" }, "Delete account");
  deleteBtn.addEventListener("click", async () => {
    const result = await confirmDialog({
      title: "Delete your account?",
      body: "This permanently deletes your account and everything tied to it. This cannot be undone.",
      confirmLabel: "Delete account",
      danger: true,
      requirePassword: true,
      passwordLabel: "Current password",
      passwordHint: "Leave blank if you only sign in with a passkey.",
      passwordRequired: false,
    });
    if (!result.confirmed) return;

    deleteBtn.disabled = true;
    try {
      await withReauth(() =>
        apiFetch("/v1/me", {
          method: "DELETE",
          body: result.password ? { password: result.password } : undefined,
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
    el("p", { class: "card__hint" }, "Download everything tied to your account, or permanently delete it."),
    el("div", { class: "btn-row" }, [exportBtn, deleteBtn]),
  ]);
}
