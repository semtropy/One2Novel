/**
 * Export Service — generates EPUB, TXT, Markdown, and JSON exports.
 *
 * EPUB 3.0 spec: container.xml + OPF manifest + NCX TOC + XHTML per chapter.
 * Uses raw string assembly (no heavy XML lib) for simplicity.
 */

import { getPrisma } from "../../../platform/db/client";

// ─── Types ─────────────────────────────────────────────

export type ExportFormat = "epub" | "txt" | "md" | "json";

export interface ExportResult {
  fileName: string;
  mimeType: string;
  content: string | Buffer;
}

export interface ExportPreview {
  title: string;
  genre: string | null;
  chapterCount: number;
  totalChars: number;
  completedChapters: number;
}

// ─── Data loading ──────────────────────────────────────

async function loadNovelData(novelId: string) {
  const prisma = getPrisma();
  const novel = await prisma.novel.findUnique({
    where: { id: novelId },
    include: {
      chapters: { orderBy: { order: "asc" } },
      characters: { take: 30 },
      volumes: { orderBy: { sortOrder: "asc" } },
    },
  });
  if (!novel) throw new Error("Novel not found");
  return novel;
}

// ─── TXT Export ────────────────────────────────────────

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function stripHtml(s: string | null): string {
  if (!s) return "";
  return s.replace(/<[^>]*>/g, "").trim();
}

function buildTxt(novel: Awaited<ReturnType<typeof loadNovelData>>): string {
  const lines: string[] = [];
  lines.push(`《${novel.title}》`);
  if (novel.genre) lines.push(`题材：${novel.genre}`);
  lines.push("");
  lines.push("=".repeat(50));
  lines.push("");

  for (const ch of novel.chapters) {
    lines.push(`第${ch.order}章 ${ch.title}`);
    lines.push("-".repeat(30));
    lines.push(stripHtml(ch.content));
    lines.push("");
    lines.push("");
  }
  return lines.join("\n");
}

// ─── Markdown Export ───────────────────────────────────

function buildMarkdown(novel: Awaited<ReturnType<typeof loadNovelData>>): string {
  const lines: string[] = [];
  lines.push("---");
  lines.push(`title: "${novel.title}"`);
  if (novel.genre) lines.push(`genre: "${novel.genre}"`);
  lines.push(`chapters: ${novel.chapters.length}`);
  lines.push(`created: "${novel.createdAt.toISOString()}"`);
  lines.push("---");
  lines.push("");
  lines.push(`# 《${novel.title}》`);
  lines.push("");
  lines.push("## 目录");
  lines.push("");

  for (const ch of novel.chapters) {
    lines.push(`- [第${ch.order}章 ${ch.title}](#chapter-${ch.order})`);
  }
  lines.push("");

  for (const ch of novel.chapters) {
    lines.push(`## 第${ch.order}章 ${ch.title} {#chapter-${ch.order}}`);
    lines.push("");
    lines.push(stripHtml(ch.content));
    lines.push("");
    lines.push("---");
    lines.push("");
  }
  return lines.join("\n");
}

// ─── JSON Export ───────────────────────────────────────

function buildJson(novel: Awaited<ReturnType<typeof loadNovelData>>) {
  return {
    title: novel.title,
    genre: novel.genre,
    description: novel.description,
    targetAudience: novel.targetAudience,
    bookSellingPoint: novel.bookSellingPoint,
    competingFeel: novel.competingFeel,
    chapters: novel.chapters.map(ch => ({
      order: ch.order,
      title: ch.title,
      content: stripHtml(ch.content),
      qualityScore: ch.qualityScore,
      hook: ch.hook,
    })),
    characters: novel.characters.map(c => ({
      name: c.name,
      role: c.role,
      personality: c.personality,
      currentGoal: c.currentGoal,
    })),
    volumes: novel.volumes.map(v => ({
      sortOrder: v.sortOrder,
      title: v.title,
      summary: v.summary,
    })),
    exportedAt: new Date().toISOString(),
  };
}

// ─── EPUB 3.0 Export ───────────────────────────────────

function buildEpubContainer(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;
}

function buildOpf(novel: Awaited<ReturnType<typeof loadNovelData>>, chapterIds: string[]): string {
  const now = new Date().toISOString().split("T")[0];
  const items = chapterIds.map((id, i) =>
    `    <item id="chapter${i + 1}" href="chapter${i + 1}.xhtml" media-type="application/xhtml+xml"/>`
  ).join("\n");
  const spineItems = chapterIds.map((_, i) =>
    `    <itemref idref="chapter${i + 1}"/>`
  ).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">${escapeXml(novel.id)}</dc:identifier>
    <dc:title>${escapeXml(novel.title)}</dc:title>
    <dc:creator>One2Novel</dc:creator>
    <dc:language>zh-CN</dc:language>
    <dc:date>${now}</dc:date>
    ${novel.genre ? `<dc:subject>${escapeXml(novel.genre)}</dc:subject>` : ""}
    <meta property="dcterms:modified">${now}</meta>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
${items}
  </manifest>
  <spine toc="ncx">
${spineItems}
  </spine>
</package>`;
}

function buildNcx(novel: Awaited<ReturnType<typeof loadNovelData>>): string {
  const navPoints = novel.chapters.map((ch, i) =>
    `    <navPoint id="navpoint-${i + 1}" playOrder="${i + 1}">
      <navLabel><text>第${ch.order}章 ${escapeXml(ch.title)}</text></navLabel>
      <content src="chapter${i + 1}.xhtml"/>
    </navPoint>`
  ).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="${escapeXml(novel.id)}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${escapeXml(novel.title)}</text></docTitle>
  <navMap>
${navPoints}
  </navMap>
</ncx>`;
}

function buildNavXhtml(novel: Awaited<ReturnType<typeof loadNovelData>>): string {
  const tocItems = novel.chapters.map((ch, i) =>
    `      <li><a href="chapter${i + 1}.xhtml">第${ch.order}章 ${escapeXml(ch.title)}</a></li>`
  ).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="zh-CN">
<head><title>目录</title></head>
<body>
  <nav epub:type="toc">
    <h1>目录</h1>
    <ol>
${tocItems}
    </ol>
  </nav>
</body>
</html>`;
}

function buildChapterXhtml(ch: { order: number; title: string; content: string | null }): string {
  const body = stripHtml(ch.content)
    .split("\n")
    .filter(line => line.trim())
    .map(line => `    <p>${escapeXml(line)}</p>`)
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh-CN">
<head>
  <title>第${ch.order}章 ${escapeXml(ch.title)}</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
  <h2>第${ch.order}章 ${escapeXml(ch.title)}</h2>
${body}
</body>
</html>`;
}

function buildEpubStyle(): string {
  return `
body { font-family: "Songti SC", "Noto Serif CJK SC", serif; line-height: 1.8; margin: 1.5em; }
h2 { text-align: center; margin: 1.5em 0; font-size: 1.4em; }
p { text-indent: 2em; margin: 0.5em 0; }
`;
}

function buildEpub(novel: Awaited<ReturnType<typeof loadNovelData>>): Buffer {
  // Simple ZIP-based EPUB assembly
  // Using raw Buffer for EPUB — the client will save as .epub
  const chunks: Array<{ name: string; content: string | Buffer }> = [];

  chunks.push({ name: "mimetype", content: "application/epub+zip" });
  chunks.push({ name: "META-INF/container.xml", content: buildEpubContainer() });

  const chapterIds = novel.chapters.map(ch => ch.id);

  chunks.push({ name: "OEBPS/content.opf", content: buildOpf(novel, chapterIds) });
  chunks.push({ name: "OEBPS/toc.ncx", content: buildNcx(novel) });
  chunks.push({ name: "OEBPS/nav.xhtml", content: buildNavXhtml(novel) });
  chunks.push({ name: "OEBPS/style.css", content: buildEpubStyle() });

  for (let i = 0; i < novel.chapters.length; i++) {
    chunks.push({
      name: `OEBPS/chapter${i + 1}.xhtml`,
      content: buildChapterXhtml(novel.chapters[i]),
    });
  }

  // Build ZIP manually using stored (uncompressed) entries
  // EPUB requires mimetype to be first and uncompressed
  const fileRecords: Array<{ name: string; crc: number; offset: number; size: number }> = [];
  const centralDir: Buffer[] = [];
  let offset = 0;
  const dataChunks: Buffer[] = [];

  for (const chunk of chunks) {
    const content = typeof chunk.content === "string" ? Buffer.from(chunk.content, "utf-8") : chunk.content;
    const nameBuf = Buffer.from(chunk.name, "utf-8");

    // Local file header
    const localHeader = Buffer.alloc(30 + nameBuf.length);
    localHeader.writeUInt32LE(0x04034b50, 0); // Signature
    localHeader.writeUInt16LE(20, 4);          // Version (2.0)
    localHeader.writeUInt16LE(0, 6);           // Flags
    localHeader.writeUInt16LE(0, 8);           // Compression: stored
    localHeader.writeUInt16LE(0, 10);          // Mod time
    localHeader.writeUInt16LE(0, 12);          // Mod date
    const crc = crc32(content);
    localHeader.writeUInt32LE(crc, 14);        // CRC-32
    localHeader.writeUInt32LE(content.length, 18); // Compressed size
    localHeader.writeUInt32LE(content.length, 22); // Uncompressed size
    localHeader.writeUInt16LE(nameBuf.length, 26);  // Filename length
    localHeader.writeUInt16LE(0, 28);               // Extra field length
    nameBuf.copy(localHeader, 30);

    dataChunks.push(localHeader);
    dataChunks.push(content);

    fileRecords.push({ name: chunk.name, crc, offset, size: content.length });
    offset += localHeader.length + content.length;
  }

  const centralDirOffset = offset;
  for (const rec of fileRecords) {
    const nameBuf = Buffer.from(rec.name, "utf-8");
    const cdEntry = Buffer.alloc(46 + nameBuf.length);
    cdEntry.writeUInt32LE(0x02014b50, 0);
    cdEntry.writeUInt16LE(20, 4);
    cdEntry.writeUInt16LE(20, 6);
    cdEntry.writeUInt16LE(0, 8);
    cdEntry.writeUInt16LE(0, 10);  // Compression: stored
    cdEntry.writeUInt16LE(0, 12);
    cdEntry.writeUInt16LE(0, 14);
    cdEntry.writeUInt32LE(rec.crc, 16);
    cdEntry.writeUInt32LE(rec.size, 20);
    cdEntry.writeUInt32LE(rec.size, 24);
    cdEntry.writeUInt16LE(nameBuf.length, 28);
    cdEntry.writeUInt16LE(0, 30);
    cdEntry.writeUInt16LE(0, 32);
    cdEntry.writeUInt32LE(0, 34);
    cdEntry.writeUInt32LE(rec.offset, 42);
    nameBuf.copy(cdEntry, 46);
    centralDir.push(cdEntry);
  }

  const cdBuffer = Buffer.concat(centralDir);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(fileRecords.length, 8);
  eocd.writeUInt16LE(fileRecords.length, 10);
  eocd.writeUInt32LE(cdBuffer.length, 12);
  eocd.writeUInt32LE(centralDirOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...dataChunks, cdBuffer, eocd]);
}

/** CRC-32 for ZIP entries */
function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ─── Main API ──────────────────────────────────────────

export async function exportNovel(novelId: string, format: ExportFormat): Promise<ExportResult> {
  const novel = await loadNovelData(novelId);
  const safeName = novel.title.replace(/[<>:"/\\|?*]/g, "_");

  switch (format) {
    case "txt":
      return {
        fileName: `${safeName}.txt`,
        mimeType: "text/plain; charset=utf-8",
        content: buildTxt(novel),
      };
    case "md":
      return {
        fileName: `${safeName}.md`,
        mimeType: "text/markdown; charset=utf-8",
        content: buildMarkdown(novel),
      };
    case "json":
      return {
        fileName: `${safeName}.json`,
        mimeType: "application/json; charset=utf-8",
        content: JSON.stringify(buildJson(novel), null, 2),
      };
    case "epub":
      return {
        fileName: `${safeName}.epub`,
        mimeType: "application/epub+zip",
        content: buildEpub(novel),
      };
  }
}

export async function exportPreview(novelId: string): Promise<ExportPreview> {
  const novel = await loadNovelData(novelId);
  let totalChars = 0;
  let completedChapters = 0;
  for (const ch of novel.chapters) {
    totalChars += stripHtml(ch.content).length;
    if (ch.chapterStatus === "completed") completedChapters++;
  }
  return {
    title: novel.title,
    genre: novel.genre,
    chapterCount: novel.chapters.length,
    totalChars,
    completedChapters,
  };
}
