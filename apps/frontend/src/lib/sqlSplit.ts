export type Stmt = { text: string; start: number; end: number };

// Splits a script on ";" while ignoring quotes and comments.
// SQL comments start with "--", MongoDB scripts use "//".
// Limitation: PostgreSQL $$ ... $$ bodies are not recognised.
export function splitStatements(src: string, mongo = false): Stmt[] {
  const out: Stmt[] = [];
  let start = 0;
  let hasCode = false;
  let quote: string | null = null;

  const flush = (end: number) => {
    if (hasCode) out.push({ text: src.slice(start, end).trim(), start, end });
    start = end;
    hasCode = false;
  };

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const n = src[i + 1];
    if (quote) {
      if (c === quote) {
        if (n === quote) i++;
        else quote = null;
      }
      continue;
    }
    if (mongo ? c === "/" && n === "/" : c === "-" && n === "-") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && n === "*") {
      const e = src.indexOf("*/", i + 2);
      i = e === -1 ? src.length : e + 1;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      quote = c;
      hasCode = true;
      continue;
    }
    if (c === ";") {
      flush(i + 1);
      continue;
    }
    if (!/\s/.test(c)) hasCode = true;
  }
  flush(src.length);
  return out;
}

export function statementAt(src: string, offset: number, mongo = false): Stmt | null {
  const stmts = splitStatements(src, mongo);
  if (stmts.length === 0) return null;
  return stmts.find((s) => offset >= s.start && offset <= s.end) ?? stmts[stmts.length - 1];
}
