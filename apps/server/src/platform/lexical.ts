export function tokens(s: string) {
  const result: string[] = [];
  for (const match of s.toLowerCase().matchAll(/[\p{Script=Han}]+|[a-z0-9]+/gu)) {
    const chars = [...match[0]];
    if (/^[a-z0-9]/.test(match[0]) || chars.length === 1) result.push(match[0]);
    else for (let i = 0; i < chars.length - 1; i++) result.push(chars[i] + chars[i + 1]);
  }
  return result;
}
export function bm25(query: string, documents: string[]) {
  const docs = documents.map(tokens), avg = docs.reduce((n, d) => n + d.length, 0) / (docs.length || 1);
  const queryTokens = new Set(tokens(query));
  const dfs = new Map([...queryTokens].map((q) => [q, docs.filter((d) => d.includes(q)).length]));
  return docs.map((doc) => {
    const tf = new Map<string, number>(); for (const t of doc) tf.set(t, (tf.get(t) || 0) + 1);
    let score = 0;
    for (const q of queryTokens) {
      const count = tf.get(q) || 0; if (!count) continue;
      const df = dfs.get(q)!;
      score += Math.log(1 + (docs.length - df + 0.5) / (df + 0.5)) * count * 2.2 / (count + 1.2 * (0.25 + 0.75 * doc.length / (avg || 1)));
    }
    return score;
  });
}
