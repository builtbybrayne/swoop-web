/**
 * MariaDB / MySQL SQL-dump parser — minimal, streaming, sufficient for the
 * Sequel Ace dump shape that Swoop's Patagonia DB exports as.
 *
 * Tier 3 plan: planning/03-exec-c-t3.md §"Tooling pick" Option B.
 * HITL ratification 2026-05-01: Option B confirmed (Node CLI translator).
 *
 * What we parse:
 *   - `INSERT INTO \`table\` (\`col1\`, \`col2\`, …) VALUES (...), (...), ...;`
 *     statements — multi-row, possibly spanning many MB.
 *   - Each row's values: NULL keyword (unquoted), unquoted numbers, single-quoted
 *     strings with backslash escapes (`\'`, `\\`, `\n`, `\r`, `\t`, `\0`, `\"`).
 *
 * What we DO NOT parse:
 *   - DDL (`CREATE TABLE`, `ALTER TABLE`, `DROP TABLE`, `LOCK TABLES`, etc.).
 *     We strictly look for INSERT statements; everything else is skipped.
 *   - MySQL-specific `/*!40000 …*\/` conditional comments — silently skipped.
 *   - Triggers, views, procedures, anything not an INSERT.
 *
 * The dump is a trusted input from Swoop's authoritative database (per the
 * tier-3 plan §"Out of scope" — no SQL injection / sandboxing concerns). Edge
 * cases we DO handle: backtick identifiers, embedded apostrophes via `\'`,
 * embedded backslashes via `\\`, embedded newlines inside quoted strings,
 * NULL as a keyword, integer / float / negative numbers.
 *
 * Streaming model:
 *   - Reads the file as a Node read stream, decoded as utf8.
 *   - Buffers chunks until a complete INSERT statement (terminated by `;`
 *     followed by a newline AT TOP LEVEL, i.e. outside any quoted string)
 *     is available, then yields parsed rows.
 *   - Memory footprint = a single INSERT statement. The largest single
 *     INSERT in this dump (`image`, ~13K rows; `ntags_lookup`, ~157K) is on
 *     the order of MBs, well within budget.
 *
 * Tests at `__tests__/parser.test.ts`.
 */

import { createReadStream } from 'node:fs';

/** A single parsed row from one INSERT statement. */
export interface DumpRow {
  table: string;
  values: Record<string, string | number | null>;
}

/**
 * Stream a MariaDB-format SQL dump and yield one DumpRow per row in every
 * INSERT statement.
 */
export async function* streamDump(path: string): AsyncIterable<DumpRow> {
  const stream = createReadStream(path, { encoding: 'utf8', highWaterMark: 1 << 20 });
  let buffer = '';

  for await (const chunk of stream) {
    buffer += chunk;
    let consumed = 0;

    // Walk the buffer looking for INSERT statements. Any non-INSERT content
    // (DDL, comments, blank lines) is skipped to the start of the next
    // candidate INSERT.
    while (consumed < buffer.length) {
      const insertStart = findNextInsertStart(buffer, consumed);
      if (insertStart === -1) {
        // No INSERT in the rest of the buffer — keep just the trailing
        // partial line and discard everything before; the next chunk may
        // contain the start of an INSERT.
        const lastNewline = buffer.lastIndexOf('\n');
        if (lastNewline === -1) break;
        buffer = buffer.slice(lastNewline + 1);
        consumed = 0;
        break;
      }

      // Find the end of this INSERT (the top-level `;` after the values list).
      const stmtEnd = findStatementEnd(buffer, insertStart);
      if (stmtEnd === -1) {
        // Statement spans into more chunks — drop everything before this
        // INSERT and wait for more data.
        buffer = buffer.slice(insertStart);
        consumed = 0;
        break;
      }

      const stmt = buffer.slice(insertStart, stmtEnd + 1);
      yield* parseInsertStatement(stmt);
      consumed = stmtEnd + 1;
    }

    if (consumed > 0) buffer = buffer.slice(consumed);
  }

  // End-of-file: if there's a final INSERT that wasn't terminated, that's
  // a malformed dump. We don't try to recover.
  buffer = buffer.trim();
  if (buffer.length > 0 && buffer.toUpperCase().startsWith('INSERT')) {
    throw new Error('SQL dump ended mid-INSERT statement; possible truncation.');
  }
}

/**
 * Find the next `INSERT INTO` substring at the start of a logical line.
 * Returns -1 if none found.
 */
function findNextInsertStart(buf: string, from: number): number {
  let pos = from;
  while (pos < buf.length) {
    // Skip whitespace and any leading newline.
    while (pos < buf.length && /[ \t\r\n]/.test(buf[pos]!)) pos++;
    if (pos >= buf.length) return -1;

    // Possible candidates from this position:
    //   - `INSERT` (case-sensitive in Sequel Ace dumps; we accept both)
    //   - `#` comment line — skip to newline
    //   - `--` comment line — skip to newline
    //   - `/*` C-style comment — skip past `*/`
    //   - other DDL — skip to terminating `;`
    const ch = buf[pos];

    if (ch === '#' || (ch === '-' && buf[pos + 1] === '-')) {
      const nl = buf.indexOf('\n', pos);
      if (nl === -1) return -1;
      pos = nl + 1;
      continue;
    }

    if (ch === '/' && buf[pos + 1] === '*') {
      const close = buf.indexOf('*/', pos + 2);
      if (close === -1) return -1;
      pos = close + 2;
      continue;
    }

    // Match `INSERT` literally (case-insensitive).
    if (
      buf.length - pos >= 6 &&
      buf.slice(pos, pos + 6).toUpperCase() === 'INSERT'
    ) {
      return pos;
    }

    // Other DDL / SET / LOCK / UNLOCK / CREATE / DROP / ALTER — skip to the
    // next `;` outside any quoted string, then continue.
    const stmtEnd = findStatementEnd(buf, pos);
    if (stmtEnd === -1) return -1;
    pos = stmtEnd + 1;
  }
  return -1;
}

/**
 * Given a position where a SQL statement begins, find the index of the
 * top-level `;` that terminates it. `;` inside quoted strings, backtick
 * identifiers, or comments doesn't count.
 *
 * Returns -1 if no terminator is found in the available buffer.
 */
function findStatementEnd(buf: string, from: number): number {
  let pos = from;
  let inSingle = false;
  let inBacktick = false;

  while (pos < buf.length) {
    const ch = buf[pos]!;

    if (inSingle) {
      if (ch === '\\') {
        // Skip the next char (it's escaped). Sequel Ace dumps use `\'`,
        // `\\`, `\n`, `\r`, `\0`, `\"` etc.
        pos += 2;
        continue;
      }
      if (ch === "'") {
        inSingle = false;
      }
      pos++;
      continue;
    }

    if (inBacktick) {
      if (ch === '`') {
        inBacktick = false;
      }
      pos++;
      continue;
    }

    if (ch === "'") {
      inSingle = true;
      pos++;
      continue;
    }

    if (ch === '`') {
      inBacktick = true;
      pos++;
      continue;
    }

    // C-style comments inside SQL — possible but rare in this dump.
    if (ch === '/' && buf[pos + 1] === '*') {
      const close = buf.indexOf('*/', pos + 2);
      if (close === -1) return -1;
      pos = close + 2;
      continue;
    }

    if (ch === ';') {
      return pos;
    }

    pos++;
  }

  return -1;
}

/**
 * Parse a complete `INSERT INTO \`tbl\` (\`col1\`, \`col2\`, …) VALUES (…), (…), …;`
 * statement and yield one DumpRow per VALUES tuple.
 *
 * The implementation is a small hand-rolled tokeniser; we don't need a full
 * SQL parser because the Sequel Ace dump shape is regular: backtick-quoted
 * identifiers, `(…)` tuples in the VALUES list, single-quoted strings with
 * `\`-escapes for special chars.
 */
export function* parseInsertStatement(stmt: string): IterableIterator<DumpRow> {
  // 1. Strip leading/trailing whitespace + a trailing semicolon.
  const trimmed = stmt.trim();
  if (!trimmed) return;

  // 2. Match the prefix: `INSERT INTO \`<table>\` (\`col1\`, …) VALUES`.
  // We do this by hand because the inner parens of the column list have
  // backticks, and we want to be robust to whitespace + newlines.
  const insertMatch = /^INSERT\s+(?:IGNORE\s+)?INTO\s+`([^`]+)`\s*\(/i.exec(trimmed);
  if (!insertMatch) {
    throw new Error(
      `parseInsertStatement: expected INSERT INTO \`tbl\` (...) VALUES …; got: ${trimmed.slice(0, 100)}…`,
    );
  }
  const table = insertMatch[1]!;
  let pos = insertMatch[0].length;

  // 3. Parse the column list — backtick-quoted identifiers separated by commas.
  const columns: string[] = [];
  while (pos < trimmed.length) {
    pos = skipSpaces(trimmed, pos);
    if (trimmed[pos] === ')') {
      pos++;
      break;
    }
    if (trimmed[pos] !== '`') {
      throw new Error(
        `parseInsertStatement: expected backtick-quoted column at pos ${pos}: ${trimmed.slice(pos, pos + 60)}`,
      );
    }
    pos++;
    const close = trimmed.indexOf('`', pos);
    if (close === -1) {
      throw new Error('parseInsertStatement: unterminated backtick identifier');
    }
    columns.push(trimmed.slice(pos, close));
    pos = close + 1;
    pos = skipSpaces(trimmed, pos);
    if (trimmed[pos] === ',') {
      pos++;
    } else if (trimmed[pos] === ')') {
      pos++;
      break;
    } else {
      throw new Error(
        `parseInsertStatement: expected , or ) after column at pos ${pos}: ${trimmed.slice(pos, pos + 60)}`,
      );
    }
  }

  // 4. Expect `VALUES`.
  pos = skipSpaces(trimmed, pos);
  if (trimmed.slice(pos, pos + 6).toUpperCase() !== 'VALUES') {
    throw new Error(
      `parseInsertStatement: expected VALUES at pos ${pos}: ${trimmed.slice(pos, pos + 60)}`,
    );
  }
  pos += 6;

  // 5. Loop over `(…), (…), …` tuples.
  while (pos < trimmed.length) {
    pos = skipSpaces(trimmed, pos);
    if (trimmed[pos] === ';') break;
    if (trimmed[pos] === ',') {
      pos++;
      continue;
    }
    if (trimmed[pos] !== '(') {
      throw new Error(
        `parseInsertStatement: expected ( at pos ${pos}: ${trimmed.slice(pos, pos + 60)}`,
      );
    }
    pos++;
    const tupleValues: (string | number | null)[] = [];
    while (pos < trimmed.length) {
      pos = skipSpaces(trimmed, pos);
      const [value, next] = parseValue(trimmed, pos);
      tupleValues.push(value);
      pos = next;
      pos = skipSpaces(trimmed, pos);
      if (trimmed[pos] === ',') {
        pos++;
        continue;
      }
      if (trimmed[pos] === ')') {
        pos++;
        break;
      }
      throw new Error(
        `parseInsertStatement: expected , or ) inside tuple at pos ${pos}: ${trimmed.slice(pos, pos + 60)}`,
      );
    }

    if (tupleValues.length !== columns.length) {
      throw new Error(
        `parseInsertStatement: tuple has ${tupleValues.length} values, expected ${columns.length} (table=${table})`,
      );
    }

    const row: Record<string, string | number | null> = {};
    for (let i = 0; i < columns.length; i++) {
      row[columns[i]!] = tupleValues[i]!;
    }
    yield { table, values: row };
  }
}

function skipSpaces(s: string, pos: number): number {
  while (pos < s.length && /[ \t\r\n]/.test(s[pos]!)) pos++;
  return pos;
}

/**
 * Parse a single value at position `pos`. Returns the value plus the index
 * one past its end.
 *
 * Forms:
 *   - `NULL` (case-insensitive) → null
 *   - quoted string `'…'` (with backslash escapes) → string
 *   - number (signed integer or float) → number (when finite) or string fallback
 */
export function parseValue(s: string, pos: number): [string | number | null, number] {
  const ch = s[pos]!;

  if (ch === "'") {
    // Quoted string. Walk forward, handling backslash escapes.
    pos++;
    let out = '';
    while (pos < s.length) {
      const c = s[pos]!;
      if (c === '\\') {
        const next = s[pos + 1];
        switch (next) {
          case 'n':
            out += '\n';
            break;
          case 'r':
            out += '\r';
            break;
          case 't':
            out += '\t';
            break;
          case '0':
            out += '\0';
            break;
          case 'b':
            out += '\b';
            break;
          case 'Z':
            out += '\x1a';
            break;
          case "'":
            out += "'";
            break;
          case '"':
            out += '"';
            break;
          case '\\':
            out += '\\';
            break;
          default:
            // Unknown escape — pass the char through literally (MariaDB
            // semantics: drops the backslash, keeps the next char).
            out += next ?? '';
        }
        pos += 2;
        continue;
      }
      if (c === "'") {
        // MySQL also allows `''` as a single-quote escape. Detect that.
        if (s[pos + 1] === "'") {
          out += "'";
          pos += 2;
          continue;
        }
        pos++;
        return [out, pos];
      }
      out += c;
      pos++;
    }
    throw new Error('parseValue: unterminated quoted string');
  }

  // NULL keyword.
  if (s.length - pos >= 4 && s.slice(pos, pos + 4).toUpperCase() === 'NULL') {
    const after = s[pos + 4];
    if (after === undefined || /[\s,)]/.test(after)) {
      return [null, pos + 4];
    }
  }

  // Number (or other unquoted token).
  const start = pos;
  // Accept signs, digits, dots, exponent. Anything else terminates.
  while (
    pos < s.length &&
    /[0-9.\-+eE]/.test(s[pos]!)
  ) {
    pos++;
  }
  const tok = s.slice(start, pos);
  if (tok.length === 0) {
    throw new Error(
      `parseValue: unexpected token at pos ${start}: ${s.slice(start, start + 30)}`,
    );
  }
  const n = Number(tok);
  if (!Number.isFinite(n)) {
    // Fall back to string. Unlikely in this dump shape — surfaces if a
    // future field type needs a different parse.
    return [tok, pos];
  }
  return [n, pos];
}
