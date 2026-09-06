import yauzl from 'yauzl';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { parse } from 'parse5';
import { posix } from 'node:path';
import { createHash } from 'node:crypto';
import { AppError, normalize, requireThat, uuid } from '../platform/core.js';
import { splitSchema } from '@one2novel/contracts';

export const UPLOAD_LIMIT = 20 * 1048576;
export function decodeText(buffer: Uint8Array, encoding: 'UTF8' | 'GB18030') {
  try {
    return normalize(
      new TextDecoder(encoding === 'UTF8' ? 'utf-8' : 'gb18030', { fatal: true }).decode(buffer),
    );
  } catch {
    throw new AppError('INVALID_ENCODING', '无法按所选编码读取，请选择正确编码后重新导入');
  }
}
export function validateSplit(payload: unknown, length: number) {
  const chapters = splitSchema.parse(payload);
  let end = 0;
  const ids = new Set<string>();
  for (const c of chapters) {
    requireThat(
      c.order === ids.size + 1 &&
        !ids.has(c.id) &&
        c.start === end &&
        c.end > c.start &&
        c.end <= length,
      'INVALID_SPLIT',
      '切分必须按顺序完整覆盖原文，不能重叠或遗漏',
    );
    ids.add(c.id);
    end = c.end;
  }
  requireThat(end === length, 'INVALID_SPLIT', '切分未覆盖完整原文');
  return chapters;
}
export function splitText(text: string) {
  const headings: { start: number; title: string }[] = [];
  let offset = 0;
  for (const line of text.split('\n')) {
    if (/^\s*第[零〇一二三四五六七八九十百千万两0-9]+[章节回]\s*.*$/u.test(line))
      headings.push({ start: offset, title: line.trim().slice(0, 200) });
    offset += [...line].length + 1;
  }
  if (!headings.length || headings[0].start > 0)
    headings.unshift({ start: 0, title: headings.length ? '序章' : '全文（未识别到章节标题）' });
  return headings.map((h, i) => ({
    id: uuid(),
    order: i + 1,
    title: h.title,
    start: h.start,
    end: headings[i + 1]?.start ?? [...text].length,
  }));
}
function safePath(path: string) {
  requireThat(
    path.length > 0 &&
      !path.includes('\\') &&
      !path.includes('\0') &&
      !path.startsWith('/') &&
      !/^[a-z][a-z0-9+.-]*:/i.test(path) &&
      !path.split('/').includes('..'),
    'INVALID_EPUB',
    'EPUB包含越界或非法路径',
  );
  return path;
}
async function unzip(buffer: Buffer) {
  return new Promise<Map<string, Buffer>>((resolve, reject) => {
    yauzl.fromBuffer(
      buffer,
      { lazyEntries: true, strictFileNames: true, validateEntrySizes: true },
      (err, zip) => {
        if (err || !zip) return reject(new AppError('INVALID_EPUB', '不是有效的EPUB压缩文件'));
        let total = 0,
          entries = 0,
          failed = false;
        const files = new Map<string, Buffer>();
        const fail = (e: unknown) => {
          failed = true;
          zip.close();
          reject(e instanceof AppError ? e : new AppError('INVALID_EPUB', 'EPUB条目损坏'));
        };
        zip.on('error', fail);
        zip.on('end', () => {
          if (!failed) resolve(files);
        });
        zip.on('entry', (entry: yauzl.Entry) => {
          void (async () => {
            safePath(entry.fileName);
            requireThat(
              ++entries <= 5000 &&
                entry.uncompressedSize <= UPLOAD_LIMIT &&
                total + entry.uncompressedSize <= 100 * 1048576,
              'IMPORT_LIMIT',
              'EPUB解压资源超过限制',
            );
            requireThat(
              !(entry.generalPurposeBitFlag & 1) &&
                ((entry.externalFileAttributes >>> 16) & 0xf000) !== 0xa000,
              'INVALID_EPUB',
              '不支持加密或符号链接条目',
            );
            requireThat(!files.has(entry.fileName), 'INVALID_EPUB', 'EPUB存在重复路径');
            if (entry.fileName.endsWith('/')) {
              zip.readEntry();
              return;
            }
            const stream = await new Promise<NodeJS.ReadableStream>((r, fail) =>
              zip.openReadStream(entry, (e, s) => (e || !s ? fail(e) : r(s))),
            );
            const chunks: Buffer[] = [];
            let size = 0;
            for await (const chunk of stream) {
              const b = Buffer.from(chunk);
              size += b.length;
              total += b.length;
              requireThat(
                size <= UPLOAD_LIMIT && total <= 100 * 1048576,
                'IMPORT_LIMIT',
                'EPUB实际解压体积超过限制',
              );
              chunks.push(b);
            }
            requireThat(size === entry.uncompressedSize, 'INVALID_EPUB', 'EPUB条目长度错误');
            files.set(entry.fileName, Buffer.concat(chunks));
            zip.readEntry();
          })().catch(fail);
        });
        zip.readEntry();
      },
    );
  });
}
function epubUtf8(buffer: Buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw new AppError('INVALID_EPUB', 'EPUB正文或目录不是有效UTF-8文本');
  }
}
function xml(buffer: Buffer | undefined) {
  requireThat(buffer, 'INVALID_EPUB', 'EPUB缺少必要文件');
  const text = epubUtf8(buffer);
  requireThat(
    !/<!DOCTYPE|<!ENTITY/i.test(text) && XMLValidator.validate(text) === true,
    'INVALID_EPUB',
    'EPUB XML无效或包含外部实体声明',
  );
  return new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true,
    processEntities: false,
  }).parse(text);
}
function htmlText(buffer: Buffer) {
  const document = parse(epubUtf8(buffer));
  let title = '';
  const walk = (node: any): string => {
    if (['script', 'style', 'noscript', 'head'].includes(node.tagName)) return '';
    if (node.nodeName === '#text') return node.value;
    const inside = (node.childNodes || []).map(walk).join('');
    if (/^h[1-6]$/.test(node.tagName || '') && !title) title = inside.trim();
    return (
      inside + (/^(p|div|section|article|h[1-6]|br|li|tr)$/.test(node.tagName || '') ? '\n' : '')
    );
  };
  return { text: normalize(walk(document)), title };
}
export async function parseImport(buffer: Buffer, filename: string, encoding: 'UTF8' | 'GB18030') {
  requireThat(
    buffer.length > 0 && buffer.length <= UPLOAD_LIMIT,
    'IMPORT_LIMIT',
    '文件须在20MiB以内且非空',
    413,
  );
  const format = filename.toLowerCase().endsWith('.epub')
    ? 'EPUB'
    : filename.toLowerCase().endsWith('.txt')
      ? 'TXT'
      : null;
  requireThat(format, 'INVALID_FORMAT', '只支持TXT和EPUB');
  let text: string, chapters: ReturnType<typeof splitText>;
  if (format === 'TXT') {
    text = decodeText(buffer, encoding);
    chapters = splitText(text);
  } else {
    const files = await unzip(buffer);
    requireThat(!files.has('META-INF/encryption.xml'), 'INVALID_EPUB', '不支持带加密资源的EPUB');
    const container = xml(files.get('META-INF/container.xml'));
    const root = [container.container?.rootfiles?.rootfile].flat().find(Boolean);
    const opfPath = safePath(root?.['@_full-path'] || '');
    const opf = xml(files.get(opfPath));
    const manifest = [opf.package?.manifest?.item || []].flat();
    const spine = [opf.package?.spine?.itemref || []].flat();
    requireThat(spine.length > 0, 'INVALID_EPUB', 'EPUB没有阅读顺序');
    const parts: { text: string; title: string }[] = [];
    for (const ref of spine) {
      const item = manifest.find((x: any) => x['@_id'] === ref['@_idref']);
      requireThat(
        item && ['application/xhtml+xml', 'text/html'].includes(item['@_media-type']),
        'INVALID_EPUB',
        'EPUB正文类型不支持',
      );
      let href: string;
      try {
        href = decodeURIComponent(String(item['@_href']).split('#')[0]);
      } catch {
        throw new AppError('INVALID_EPUB', 'EPUB正文路径编码无效');
      }
      safePath(href);
      const filePath = safePath(posix.join(posix.dirname(opfPath), href));
      const bytes = files.get(filePath);
      requireThat(bytes, 'INVALID_EPUB', 'EPUB阅读顺序引用缺失正文');
      const part = htmlText(bytes);
      if (part.text) parts.push({ ...part, title: part.title || posix.basename(filePath) });
    }
    text = parts.map((p) => p.text).join('\n\n');
    let offset = 0;
    chapters = parts.map((p, i) => {
      const start = offset;
      offset += [...p.text].length + (i < parts.length - 1 ? 2 : 0);
      return { id: uuid(), order: i + 1, title: p.title.slice(0, 200), start, end: offset };
    });
  }
  requireThat(text.trim(), 'EMPTY_REFERENCE', '文件没有可分析正文');
  validateSplit(chapters, [...text].length);
  return {
    format,
    encoding: format === 'EPUB' ? 'UTF8' : encoding,
    text,
    chapters,
    originalHash: createHash('sha256').update(buffer).digest('hex'),
  };
}
