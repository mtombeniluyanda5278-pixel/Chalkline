import { fileTypeFromFile } from 'file-type';
import { readFile, stat, writeFile } from 'node:fs/promises';
import type { Readable } from 'node:stream';
import { posix } from 'node:path';
import yauzl from 'yauzl';
import { SaxesParser } from 'saxes';
import { failure } from './http.js';
import { config } from './config.js';
import { privateTemp } from './tempFiles.js';
const formats: Record<string, string> = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', txt: 'text/plain' };
export function safeFilename(name: string) {
  const value = name.normalize('NFKC').replace(/[\x00-\x1f\x7f-\x9f/\\<>:"|?*\u202a-\u202e\u2066-\u2069]/g, '_').trim();
  if (!value || value.length > 200) throw failure(400, 'Filename must contain 1–200 characters.');
  return value;
}
export function validateFileMetadata(name: string, claimedMime: string) {
  const ext = name.split('.').pop()?.toLowerCase() ?? '', mime = formats[ext];
  if (!mime) throw failure(415, 'Supported files: PDF, DOCX, PPTX, XLSX, TXT, PNG, JPEG and WebP.');
  if (claimedMime && claimedMime !== 'application/octet-stream' && claimedMime !== mime) throw failure(415, 'File type does not match the upload.');
  const max = ext === 'pdf' ? config.FILE_MAX_PDF_BYTES : ['docx', 'pptx', 'xlsx'].includes(ext) ? config.FILE_MAX_OFFICE_BYTES : ext === 'txt' ? config.FILE_MAX_TEXT_BYTES : config.FILE_MAX_IMAGE_BYTES;
  return { ext, mime, max: Math.min(max, config.UPLOAD_MAX_BYTES) };
}
export type ReaderContent = { sections: { name: string; text: string }[] };
type Cell = { ref: string; type: string; value: string; inline: string };
type Part = { root: string; uri: string; text: string; cells: Cell[] };
const mainParts = { docx: 'word/document.xml', pptx: 'ppt/presentation.xml', xlsx: 'xl/workbook.xml' };
const mainTypes = { docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml' };
const officeNs = (uri: string, kind: string) => uri === `http://schemas.openxmlformats.org/${kind}/2006/main` || uri === `http://purl.oclc.org/ooxml/${kind}/main`;
const relationshipNs = (uri: string) => uri === 'http://schemas.openxmlformats.org/officeDocument/2006/relationships' || uri === 'http://purl.oclc.org/ooxml/officeDocument/relationships';
function targetPart(source: string, target: string) {
  const decoded = decodeURIComponent(target);
  if (!decoded || /[\\\x00-\x20:#?]/.test(decoded) || decoded.startsWith('//')) throw new Error('Invalid relationship');
  const resolved = posix.normalize(decoded.startsWith('/') ? decoded.slice(1) : posix.join(posix.dirname(source), decoded));
  if (resolved === '..' || resolved.startsWith('../')) throw new Error('Relationship escapes package');
  return resolved;
}
export async function inspectOffice(path: string, extension: string): Promise<ReaderContent> {
  const kind = extension as keyof typeof mainParts, mainName = mainParts[kind];
  if (!mainName) throw failure(415, 'Invalid Office format.');
  return new Promise((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (error, zip) => {
      if (error || !zip) return reject(failure(400, 'Invalid Office document.'));
      let count = 0, total = 0, actualTotal = 0, textBytes = 0, manifest = false, mainContentType = false, stopped = false;
      let active: Readable | undefined;
      const seen = new Set<string>(), parts = new Map<string, Part>(), shared: string[] = [];
      const order: { id: string; name: string }[] = [], rels = new Map<string, { target: string; type: string }>();
      const fail = () => { if (stopped) return; stopped = true; active?.destroy(); zip.close(); reject(failure(400, 'Unsafe, malformed or oversized Office document.')); };
      zip.on('error', fail);
      zip.on('entry', entry => {
        if (stopped) return;
        const name = entry.fileName.normalize('NFKC'); count++; total += entry.uncompressedSize;
        const mode = (entry.externalFileAttributes >>> 16) & 0xf000;
        if (count > config.OFFICE_MAX_ENTRIES || total > config.OFFICE_MAX_UNCOMPRESSED_BYTES || entry.uncompressedSize > config.OFFICE_MAX_ENTRY_BYTES || entry.uncompressedSize / Math.max(1, entry.compressedSize) > config.OFFICE_MAX_COMPRESSION_RATIO || entry.generalPurposeBitFlag & 1 || (mode && mode !== 0x8000 && mode !== 0x4000) || seen.has(name.toLowerCase()) || /(^|\/)\.{1,2}(\/|$)|\\|^\/|:|[\x00-\x1f\x7f]|vba|activeX|embeddings|\.(?:bin|exe|dll|js|html?|svg|zip|rar|7z|jar|ole)$/i.test(name)) return fail();
        seen.add(name.toLowerCase());
        zip.openReadStream(entry, (err, stream) => {
          if (err || !stream) return fail();
          active = stream;
          const xml = /\.(xml|rels)$/i.test(name);
          let bytes = 0, root = '', uri = '', depth = 0, text = '', current = '', capture = '', sharedText = '', cell: Cell | undefined;
          const cells: Cell[] = [], decoder = new TextDecoder('utf-8', { fatal: true }), parser = new SaxesParser({ xmlns: true });
          const mainRels = `${posix.dirname(mainName)}/_rels/${posix.basename(mainName)}.rels`;
          parser.on('error', fail); parser.on('doctype', fail);
          parser.on('opentag', tag => {
            depth++; if (depth > 200) return fail(); if (!root) { root = tag.local; uri = tag.uri; }
            const attrs = Object.values(tag.attributes), attr = (local: string) => attrs.find(a => a.local === local)?.value ?? '';
            for (const a of attrs) if (/macroEnabled|vbaProject|activeX|oleObject/i.test(a.value) || (a.local === 'TargetMode' && a.value !== 'Internal')) return fail();
            if (/^(?:oleObject|control|altChunk|externalLink)$/i.test(tag.local)) return fail();
            if (name === '[Content_Types].xml' && tag.local === 'Override' && attr('PartName') === '/' + mainName) mainContentType = attr('ContentType') === mainTypes[kind];
            if (name === mainRels && tag.local === 'Relationship') {
              const id = attr('Id'); if (!id || rels.has(id)) return fail();
              try { rels.set(id, { target: targetPart(mainName, attr('Target')), type: attr('Type') }); } catch { return fail(); }
            }
            if (name === mainName && ((kind === 'pptx' && tag.local === 'sldId') || (kind === 'xlsx' && tag.local === 'sheet'))) {
              const id = attrs.find(a => a.local === 'id' && relationshipNs(a.uri))?.value;
              if (!id || order.some(item => item.id === id)) return fail();
              order.push({ id, name: kind === 'xlsx' ? attr('name') : `Slide ${order.length + 1}` });
            }
            if (tag.local === 'si') sharedText = '';
            if (tag.local === 'c') cell = { ref: attr('r'), type: attr('t'), value: '', inline: '' };
            if (tag.local === 't' || tag.local === 'v') { capture = tag.local; current = ''; }
          });
          const append = (value: string) => { textBytes += Buffer.byteLength(value); if (textBytes > config.OFFICE_MAX_EXTRACTED_TEXT_BYTES) return fail(); if (capture) current += value; };
          parser.on('text', append); parser.on('cdata', append);
          parser.on('closetag', tag => {
            depth--;
            if (tag.local === capture) {
              if (capture === 't') { text += current; sharedText += current; if (cell) cell.inline += current; }
              else if (cell) cell.value += current;
              capture = ''; current = '';
            }
            if (name === 'xl/sharedStrings.xml' && tag.local === 'si') shared.push(sharedText);
            if (tag.local === 'c' && cell) { cells.push(cell); cell = undefined; }
            if (tag.local === 'p') text += '\n';
            if (tag.local === 'tab') text += '\t';
            if (tag.local === 'br') text += '\n';
          });
          stream.on('data', chunk => {
            if (stopped) return;
            bytes += chunk.length; actualTotal += chunk.length;
            if (bytes > config.OFFICE_MAX_ENTRY_BYTES || actualTotal > config.OFFICE_MAX_UNCOMPRESSED_BYTES) return fail();
            if (xml) try { parser.write(decoder.decode(chunk, { stream: true })); } catch { fail(); }
          });
          stream.on('error', fail);
          stream.on('end', () => {
            if (stopped) return;
            if (bytes !== entry.uncompressedSize) return fail();
            if (xml) {
              try { parser.write(decoder.decode()).close(); } catch { return fail(); }
              if (stopped) return;
              if (name === '[Content_Types].xml') { if (root !== 'Types' || uri !== 'http://schemas.openxmlformats.org/package/2006/content-types') return fail(); manifest = true; }
              if (name === mainName || /^ppt\/slides\/[^/]+\.xml$/.test(name) || /^xl\/worksheets\/[^/]+\.xml$/.test(name)) parts.set(name, { root, uri, text: text.trim(), cells });
            }
            zip.readEntry();
          });
        });
      });
      zip.on('end', () => {
        if (stopped) return;
        const main = parts.get(mainName), root = { docx: 'document', pptx: 'presentation', xlsx: 'workbook' }[kind], ns = { docx: 'wordprocessingml', pptx: 'presentationml', xlsx: 'spreadsheetml' }[kind];
        if (!manifest || !mainContentType || !main || main.root !== root || !officeNs(main.uri, ns)) return fail();
        const sections: ReaderContent['sections'] = [];
        if (kind === 'docx') sections.push({ name: 'Document', text: main.text });
        else for (const item of order) {
          const rel = rels.get(item.id), type = kind === 'pptx' ? 'slide' : 'worksheet';
          if (!rel || !relationshipNs(rel.type.slice(0, -(type.length + 1))) || !rel.type.endsWith('/' + type)) return fail();
          const part = parts.get(rel.target);
          if (!part || part.root !== (kind === 'pptx' ? 'sld' : 'worksheet') || !officeNs(part.uri, ns)) return fail();
          let value = part.text;
          if (kind === 'xlsx') {
            const rows: string[] = [];
            for (const cell of part.cells) {
              let display = cell.value;
              if (cell.type === 's') { if (!/^\d+$/.test(display) || !Number.isSafeInteger(Number(display)) || shared[Number(display)] === undefined) return fail(); display = shared[Number(display)]!; }
              else if (cell.type === 'inlineStr') display = cell.inline;
              else if (cell.type === 'b') display = display === '1' ? 'TRUE' : display === '0' ? 'FALSE' : display;
              // Formula source is never evaluated or rendered; only a stored cached value is used.
              if (display) rows.push(`${cell.ref ? cell.ref + ': ' : ''}${display}`);
            }
            value = rows.join('\n');
          }
          sections.push({ name: item.name, text: value });
        }
        // Shared strings can expand many times across cells. Bound the final representation too.
        if (sections.reduce((size, section) => size + Buffer.byteLength(section.name) + Buffer.byteLength(section.text), 0) > config.OFFICE_MAX_EXTRACTED_TEXT_BYTES) return fail();
        stopped = true; resolve({ sections });
      });
      zip.readEntry();
    });
  });
}
export async function validateFilePath(path: string, name: string, claimedMime: string) {
  const { ext, mime, max } = validateFileMetadata(name, claimedMime), size = (await stat(path)).size;
  if (!size || size > max) throw failure(413, 'File exceeds the format size limit.');
  let reader: ReaderContent | undefined;
  if (ext === 'txt') {
    const body = await readFile(path); let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(body); } catch { throw failure(415, 'Text files must be UTF-8.'); }
    if (body.includes(0) || /<\s*(?:!doctype\s+html|html|script|svg)\b/i.test(text)) throw failure(415, 'Executable and HTML content is not accepted.');
    reader = { sections: [{ name: 'Text', text }] };
  } else {
    if (['docx', 'pptx', 'xlsx'].includes(ext)) reader = await inspectOffice(path, ext);
    else if ((await fileTypeFromFile(path))?.mime !== mime) throw failure(415, 'File content does not match its extension.');
    if (ext === 'pdf') {
      // This is a bounded structural prefilter. PDF.js renders with scripting disabled.
      const body = await readFile(path), text = body.toString('latin1');
      const decodedNames = text.replace(/#([\da-f]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
      if (!/^(?:%PDF-1\.[0-7]|%PDF-2\.0)/.test(text) || !text.slice(-2048).includes('%%EOF') || !/\d+\s+\d+\s+obj\b/.test(text) || /\/(JavaScript|JS|Launch|EmbeddedFile|RichMedia|XFA)\b/.test(decodedNames)) throw failure(415, 'Invalid or active-content PDF.');
    }
  }
  return { mime, reader };
}
export async function validateFile(buffer: Buffer, name: string, mime: string) { return privateTemp(async path => { await writeFile(path, buffer, { mode: 0o600 }); return (await validateFilePath(path, name, mime)).mime; }); }
