// Privacy and terms pages. The content describes what this system actually
// does; anything stated here is traceable to the code or to configuration, so
// that the notice does not drift from behaviour as both change.
let ui;
const E = (...args) => ui.el(...args);
export function setupLegal(helpers) {
  ui = helpers;
}

export const LAST_UPDATED = "23 September 2026";

// Filled in before launch; POPIA section 18 requires the responsible party to
// be identifiable, so these are not optional.
const OPERATOR = {
  name: "LessonBench",
  contact: "privacy@lessonbench.co.za",
};

const PRIVACY = [
  {
    heading: "Who is responsible for your information",
    body: [
      `${OPERATOR.name} operates this service and decides how your personal information is used. In the Protection of Personal Information Act (POPIA) that makes us the responsible party.`,
      `You can reach us about anything on this page at ${OPERATOR.contact}.`,
    ],
  },
  {
    heading: "What we collect, and whether you have to give it",
    body: [
      "When you create an account we ask for your first and last name, email address, a username and your date of birth. These are required: without them we cannot create an account, verify that you are old enough to use the service, or send you a sign-in code.",
      "Your country, phone number and address are optional. Leaving them out changes nothing about how the service works.",
      "You must be at least 13 years old. We use your date of birth only to check that, and to wish you well on your birthday if you have that turned on.",
    ],
    list: [
      "Identity: name, username, email address, date of birth",
      "Optional: country, phone number, postal address",
      "Preferences: timezone, appearance, teaching profile, marketing choices",
      "Your work: lesson plans, notes, templates, timetables and their revision history",
      "Files you upload: documents and images, and the text extracted from them so that search works",
      "Technical records: IP address, browser description, and a log of security events on your account",
    ],
  },
  {
    heading: "Why we hold it",
    body: [
      "Your identity details exist so that you can sign in without a password and so that we can prove an account belongs to you before letting anyone back into it. Your work and files exist because storing and returning them is the service.",
      "The technical records exist to keep your account safe. When a new browser signs in, we record it and tell you, so that you can revoke it if it was not you. Rate limiting uses your IP address to stop bulk guessing. We do not use any of this to profile you or to advertise to you.",
      "We send marketing email only if you asked for it during sign-up, and you can withdraw that at any time in your account settings without affecting anything else.",
    ],
  },
  {
    heading: "Who else sees it",
    body: [
      "We do not sell your information and we do not share it for anyone else's marketing. A small number of providers process it on our behalf so that the service can run:",
    ],
    list: [
      "Oracle Cloud, in Johannesburg, hosts the service and stores the database and your uploaded files",
      "Brevo, in the European Union, delivers your sign-in codes and account emails, and therefore receives your email address",
      "Cloudflare answers the domain and runs the human-verification check shown when you register",
      "Google, only if you choose to sign in with Google, confirms your email address to us",
      "OpenAI, only if you upload a photograph of a timetable, reads that image so that we can turn it into a timetable for you",
    ],
  },
  {
    heading: "Information that leaves South Africa",
    body: [
      "The service itself runs in Johannesburg, so your account and your work are stored in South Africa.",
      "Three things cross the border. Your email address reaches Brevo in the European Union whenever we send you a message. Signing in with Google involves Google. Uploading a timetable photograph sends that image to OpenAI, and nothing else is sent with it.",
      "POPIA allows these transfers where the recipient is bound by agreements offering comparable protection, which is the basis we rely on. If you would rather no timetable image ever left the country, do not use the photograph import; you can enter a timetable by hand instead.",
    ],
  },
  {
    heading: "How long we keep it",
    body: [
      "Your account and your work stay until you delete them. Everything else expires on a schedule:",
    ],
    list: [
      "Deleted items sit in Trash for 30 days, then are removed permanently",
      "Security events are kept for 180 days",
      "A trusted browser stays trusted for 90 days, then has to prove itself again",
      "A sign-in session lasts at most 30 days, and ends sooner after 14 days unused",
      "A file that fails a malware scan is quarantined and destroyed within 24 hours",
      "An email we could not deliver is discarded after a day rather than retried forever",
    ],
  },
  {
    heading: "Deleting your account",
    body: [
      "You can delete your account from your account settings. That removes your profile, your lesson plans, notes, templates, timetables, uploaded files, trusted devices, recovery codes and security history.",
      "Your files are removed from storage shortly afterwards rather than instantly, because deletion is queued and retried until the storage provider confirms it. All versions of a file are removed, not only the most recent one.",
      "Deletion cannot be undone, and we cannot recover work afterwards.",
    ],
  },
  {
    heading: "How it is protected",
    body: [
      "The service is served only over HTTPS. We no longer use passwords at all, so there is no password of yours for anyone to steal from us. Sign-in codes, recovery codes and session tokens are stored hashed, never in a form we could read back.",
      "Queued email bodies are encrypted while they wait to be sent. Uploaded files are scanned for malware before they are stored, and a file that fails is quarantined rather than kept. The database is reached by a restricted account that cannot alter its own structure.",
      "No system is perfectly secure. If a breach affects your personal information, POPIA requires us to notify you and the Information Regulator, and we will.",
    ],
  },
  {
    heading: "Your rights",
    body: [
      "POPIA gives you the right to ask what we hold about you, to have it corrected if it is wrong, to have it deleted, and to object to how we use it. Most of this you can do yourself in your account settings without asking us.",
      `For anything you cannot do there, write to ${OPERATOR.contact} and we will respond.`,
      "If you are unhappy with how we have handled your information you may complain to the Information Regulator of South Africa, at inforegulator.org.za. You do not need our permission to do that.",
    ],
  },
  {
    heading: "Changes to this notice",
    body: [
      `This notice was last updated on ${LAST_UPDATED}. If we change how your information is used in a way that affects you, we will tell you rather than quietly editing this page.`,
    ],
  },
];

const TERMS = [
  {
    heading: "What this is",
    body: [
      "LessonBench is a tool for planning lessons. You keep your work here, and we keep it available to you.",
      "Using the service means accepting what follows. If you do not accept it, do not use the service.",
    ],
  },
  {
    heading: "Your account",
    body: [
      "You must be at least 13 years old, and the details you give us when registering must be true.",
      "Your account is yours alone. Anyone who can read your email can request a sign-in code, so protect that mailbox as carefully as you would a password.",
      "Tell us promptly if you believe someone else has reached your account. Your account settings list every browser currently trusted, and you can revoke any of them yourself.",
    ],
  },
  {
    heading: "Your work belongs to you",
    body: [
      "Everything you write and upload remains yours. We claim no ownership of it.",
      "You grant us only the permission needed to run the service: to store your work, to show it back to you, and to share it with people you explicitly share it with. Nothing more.",
      "You are responsible for having the right to upload what you upload. Do not upload material you have no permission to use.",
    ],
  },
  {
    heading: "What you may not do",
    body: ["Do not use the service to:"],
    list: [
      "Upload malware, or anything unlawful",
      "Attempt to reach another teacher's account or work",
      "Probe, scan or overload the service, or work around its limits",
      "Resell access, or use the service to build a competing product",
    ],
  },
  {
    heading: "Limits",
    body: [
      "Accounts have storage and upload limits, which your account settings show. We may adjust them, and will tell you before reducing anything that affects work you have already stored.",
      "Uploads are capped in size and scanned before being stored. A file that fails the scan is rejected.",
    ],
  },
  {
    heading: "Availability",
    body: [
      "We will try to keep the service running and your work safe, but we do not promise uninterrupted availability. Maintenance, outages and failures happen.",
      "Keep your own copies of anything you cannot afford to lose. You can export your work at any time.",
    ],
  },
  {
    heading: "Ending it",
    body: [
      "You can delete your account whenever you like, from your account settings.",
      "We may suspend or close an account that breaks these terms or puts other teachers at risk. Where we reasonably can, we will tell you first and give you a chance to retrieve your work.",
    ],
  },
  {
    heading: "Liability",
    body: [
      "The service is provided as it is. To the extent the law allows, we are not liable for indirect or consequential loss, or for work you lost and had no copy of.",
      "Nothing here limits liability that South African law does not permit us to limit.",
    ],
  },
  {
    heading: "Governing law",
    body: [
      "These terms are governed by the law of the Republic of South Africa, and disputes fall to South African courts.",
      `Last updated ${LAST_UPDATED}. We will tell you before a material change takes effect.`,
    ],
  },
];

function renderSections(title, intro, sections) {
  const { viewRoot: root } = ui;
  root.append(
    E("div", { class: "legal-shell" }, [
      E("div", { class: "page-head" }, [E("h1", {}, title), E("p", {}, intro)]),
      ...sections.map((section) =>
        E("section", { class: "card legal-section" }, [
          E("h2", {}, section.heading),
          ...section.body.map((text) => E("p", {}, text)),
          ...(section.list
            ? [
                E(
                  "ul",
                  { class: "legal-list" },
                  section.list.map((item) => E("li", {}, item)),
                ),
              ]
            : []),
        ]),
      ),
      E("div", { class: "link-row" }, [
        E("a", { href: "#/", class: "btn btn--ghost" }, "Back"),
      ]),
    ]),
  );
}

export async function renderPrivacy() {
  renderSections(
    "Privacy",
    `What we collect, why, and what you can do about it. Last updated ${LAST_UPDATED}.`,
    PRIVACY,
  );
}

export async function renderTerms() {
  renderSections(
    "Terms of use",
    `The agreement between you and us. Last updated ${LAST_UPDATED}.`,
    TERMS,
  );
}
