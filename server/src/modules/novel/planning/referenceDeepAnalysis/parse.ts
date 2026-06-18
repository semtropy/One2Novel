import type { ParsedChapter } from "./index";

export function parseChapters(text: string): ParsedChapter[] {
  const patterns = [
    /(?:^|\n)\s*第\s*([一二三四五六七八九十百千\d]+)\s*[章節节回卷]\s*(.*?)(?:\n|$)/gm,
    /(?:^|\n)\s*Chapter\s+(\d+)\s*[:：]?\s*(.*?)(?:\n|$)/gim,
    /(?:^|\n)\s*(\d{1,4})\s*[\.、．]\s*(.{2,40})(?:\n|$)/gm,
    /(?:^|\n)\s*(?:第)?\s*([一二三四五六七八九十百千\d]+)\s*卷\s*(.*?)(?:\n|$)/gm,
  ];

  const hits: Array<{ index: number; start: number; title: string }> = [];
  for (const pattern of patterns) {
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text)) !== null) {
      const num = parseChineseNum(m[1]) || parseInt(m[1], 10) || (hits.length + 1);
      hits.push({ index: num, start: m.index, title: (m[2] || "").trim().slice(0, 50) });
    }
  }

  hits.sort((a, b) => a.start - b.start);
  const deduped: typeof hits = [];
  for (const h of hits) {
    if (deduped.length > 0 && h.start - deduped[deduped.length - 1].start < 50) continue;
    deduped.push(h);
  }

  return deduped.map((h, i) => {
    const end = i + 1 < deduped.length ? deduped[i + 1].start : text.length;
    return { index: i + 1, title: h.title || `第${i + 1}章`, startChar: h.start, endChar: end, wordCount: end - h.start };
  });
}

function parseChineseNum(s: string): number | null {
  const map: Record<string, number> = { 一:1,二:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9,十:10,百:100,千:1000 };
  if (!s) return null;
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  let result = 0, current = 0;
  for (const ch of s) {
    const v = map[ch];
    if (v === undefined) { if (/[零〇]/.test(ch)) continue; return null; }
    if (v >= 10) { current = (current || 1) * v; result += current; current = 0; } else { current = v; }
  }
  return result + current || null;
}
