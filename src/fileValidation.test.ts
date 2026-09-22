import { test } from "node:test";
import assert from "node:assert/strict";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { ZipFile } from "yazl";
import { privateTemp } from "./tempFiles.js";
import { inspectOffice } from "./fileValidation.js";
import { config } from "./config.js";

const relNs =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const packageNs =
  "http://schemas.openxmlformats.org/package/2006/relationships";
const sheetNs = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const presentationNs =
  "http://schemas.openxmlformats.org/presentationml/2006/main";
const types = (part: string, type: string) =>
  `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/${part}" ContentType="application/vnd.openxmlformats-officedocument.${type}.main+xml"/></Types>`;
async function office(parts: Record<string, string>, extension: string) {
  return privateTemp(async (path) => {
    const zip = new ZipFile();
    for (const [name, text] of Object.entries(parts))
      zip.addBuffer(Buffer.from(text), name, { compress: false });
    const written = pipeline(
      zip.outputStream,
      createWriteStream(path, { flags: "wx", mode: 0o600 }),
    );
    zip.end();
    await written;
    return inspectOffice(path, extension);
  });
}
function spreadsheet(cells: string) {
  return {
    "[Content_Types].xml": types("xl/workbook.xml", "spreadsheetml.sheet"),
    "xl/workbook.xml": `<workbook xmlns="${sheetNs}" xmlns:r="${relNs}"><sheets><sheet name="Teaching plan" sheetId="1" r:id="sheet1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships xmlns="${packageNs}"><Relationship Id="sheet1" Type="${relNs}/worksheet" Target="worksheets/sheet9.xml"/></Relationships>`,
    "xl/worksheets/sheet9.xml": `<worksheet xmlns="${sheetNs}"><sheetData><row>${cells}</row></sheetData></worksheet>`,
    "xl/sharedStrings.xml": `<sst xmlns="${sheetNs}"><si><r><t>Lesson </t></r><r><t>one</t></r></si></sst>`,
  };
}

test("spreadsheet reader resolves rich shared strings, sheet names and cached values without evaluating formulas", async () => {
  const result = await office(
    spreadsheet(
      '<c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>Inline</t></is></c><c r="C1" t="b"><v>1</v></c><c r="D1"><f>2+2</f><v>4</v></c>',
    ),
    "xlsx",
  );
  assert.deepEqual(result.sections, [
    {
      name: "Teaching plan",
      text: "A1: Lesson one\nB1: Inline\nC1: TRUE\nD1: 4",
    },
  ]);
});

test("spreadsheet rejects missing shared strings and bounds repeated-string expansion", async () => {
  await assert.rejects(
    office(spreadsheet('<c r="A1" t="s"><v>99</v></c>'), "xlsx"),
  );
  const old = config.OFFICE_MAX_EXTRACTED_TEXT_BYTES;
  config.OFFICE_MAX_EXTRACTED_TEXT_BYTES = 1024;
  try {
    const parts = spreadsheet(
      Array.from(
        { length: 30 },
        (_, n) => `<c r="A${n + 1}" t="s"><v>0</v></c>`,
      ).join(""),
    );
    parts["xl/sharedStrings.xml"] =
      `<sst xmlns="${sheetNs}"><si><t>${"x".repeat(100)}</t></si></sst>`;
    await assert.rejects(office(parts, "xlsx"));
  } finally {
    config.OFFICE_MAX_EXTRACTED_TEXT_BYTES = old;
  }
});

test("presentation follows relationship order rather than slide filenames", async () => {
  const slide = (text: string) =>
    `<p:sld xmlns:p="${presentationNs}" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><a:p><a:t>${text}</a:t></a:p></p:cSld></p:sld>`;
  const result = await office(
    {
      "[Content_Types].xml": types(
        "ppt/presentation.xml",
        "presentationml.presentation",
      ),
      "ppt/presentation.xml": `<p:presentation xmlns:p="${presentationNs}" xmlns:r="${relNs}"><p:sldIdLst><p:sldId id="256" r:id="first"/><p:sldId id="257" r:id="second"/></p:sldIdLst></p:presentation>`,
      "ppt/_rels/presentation.xml.rels": `<Relationships xmlns="${packageNs}"><Relationship Id="first" Type="${relNs}/slide" Target="slides/slide9.xml"/><Relationship Id="second" Type="${relNs}/slide" Target="slides/slide1.xml"/></Relationships>`,
      "ppt/slides/slide1.xml": slide("Second"),
      "ppt/slides/slide9.xml": slide("First"),
    },
    "pptx",
  );
  assert.deepEqual(result.sections, [
    { name: "Slide 1", text: "First" },
    { name: "Slide 2", text: "Second" },
  ]);
});

for (const [name, mutate] of [
  [
    "DTD",
    (p: Record<string, string>) => {
      p["xl/sharedStrings.xml"] =
        '<!DOCTYPE sst [<!ENTITY private SYSTEM "file:///etc/passwd">]><sst>&private;</sst>';
    },
  ],
  [
    "external relationship",
    (p: Record<string, string>) => {
      p["xl/_rels/workbook.xml.rels"] =
        `<Relationships xmlns="${packageNs}"><Relationship Id="sheet1" Type="${relNs}/worksheet" TargetMode="External" Target="https://example.com/sheet.xml"/></Relationships>`;
    },
  ],
  [
    "escaping relationship",
    (p: Record<string, string>) => {
      p["xl/_rels/workbook.xml.rels"] = p[
        "xl/_rels/workbook.xml.rels"
      ]!.replace("worksheets/sheet9.xml", "../../outside.xml");
    },
  ],
  [
    "embedded executable",
    (p: Record<string, string>) => {
      p["xl/embeddings/payload.exe"] = "MZ";
    },
  ],
  [
    "case-duplicate entry",
    (p: Record<string, string>) => {
      p["XL/workbook.xml"] = p["xl/workbook.xml"]!;
    },
  ],
  [
    "malformed XML",
    (p: Record<string, string>) => {
      p["xl/workbook.xml"] += "<unfinished>";
    },
  ],
] as const)
  test(`Office rejects ${name}`, async () => {
    const parts: Record<string, string> = spreadsheet(
      '<c r="A1" t="s"><v>0</v></c>',
    );
    mutate(parts);
    await assert.rejects(office(parts, "xlsx"));
  });
