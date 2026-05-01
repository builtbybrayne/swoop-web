/**
 * Parser tests — exercise the MariaDB dump parser against a synthetic dump
 * that hits every edge case we need to handle in the real Swoop dump:
 *   - Multi-row INSERT
 *   - NULL values
 *   - Quoted strings with `\'`, `\\`, `\n`, `\r` escapes
 *   - Backtick-quoted column names
 *   - Mixed numeric + string types
 *   - DDL noise (CREATE TABLE, LOCK TABLES, etc.) skipped between INSERTs
 */

import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseInsertStatement, parseValue, streamDump } from '../parser.js';

describe('parseValue', () => {
  it('parses NULL', () => {
    const [v, p] = parseValue('NULL,', 0);
    expect(v).toBe(null);
    expect(p).toBe(4);
  });

  it('parses NULL at end-of-string', () => {
    const [v, p] = parseValue('NULL)', 0);
    expect(v).toBe(null);
    expect(p).toBe(4);
  });

  it('parses unquoted numbers', () => {
    expect(parseValue('123,', 0)).toEqual([123, 3]);
    expect(parseValue('-45,', 0)).toEqual([-45, 3]);
    expect(parseValue('3.14)', 0)).toEqual([3.14, 4]);
  });

  it('parses simple quoted string', () => {
    const [v] = parseValue("'hello',", 0);
    expect(v).toBe('hello');
  });

  it('parses quoted string with escaped quote', () => {
    const [v] = parseValue("'it\\'s good',", 0);
    expect(v).toBe("it's good");
  });

  it('parses quoted string with escaped backslash', () => {
    const [v] = parseValue("'a\\\\b',", 0);
    expect(v).toBe('a\\b');
  });

  it('parses newline and other escapes', () => {
    const [v] = parseValue("'line1\\nline2\\ttab',", 0);
    expect(v).toBe('line1\nline2\ttab');
  });

  it('parses doubled-single-quote escape', () => {
    const [v] = parseValue("'it''s fine',", 0);
    expect(v).toBe("it's fine");
  });
});

describe('parseInsertStatement', () => {
  it('parses single-row insert', () => {
    const stmt = "INSERT INTO `tbl` (`id`, `name`) VALUES (1, 'foo');";
    const rows = Array.from(parseInsertStatement(stmt));
    expect(rows).toEqual([
      { table: 'tbl', values: { id: 1, name: 'foo' } },
    ]);
  });

  it('parses multi-row insert', () => {
    const stmt = `INSERT INTO \`tbl\` (\`id\`, \`name\`, \`flag\`) VALUES
\t(1, 'a', NULL),
\t(2, 'b', 1),
\t(3, NULL, 0);`;
    const rows = Array.from(parseInsertStatement(stmt));
    expect(rows).toEqual([
      { table: 'tbl', values: { id: 1, name: 'a', flag: null } },
      { table: 'tbl', values: { id: 2, name: 'b', flag: 1 } },
      { table: 'tbl', values: { id: 3, name: null, flag: 0 } },
    ]);
  });

  it('handles strings with embedded commas, parens, semicolons', () => {
    const stmt = "INSERT INTO `tbl` (`id`, `text`) VALUES (1, 'hello, (world); ok');";
    const rows = Array.from(parseInsertStatement(stmt));
    expect(rows).toEqual([{ table: 'tbl', values: { id: 1, text: 'hello, (world); ok' } }]);
  });

  it('handles negative + float numbers', () => {
    const stmt = "INSERT INTO `t` (`a`, `b`, `c`) VALUES (-12, 3.14, -0.5);";
    const rows = Array.from(parseInsertStatement(stmt));
    expect(rows).toEqual([{ table: 't', values: { a: -12, b: 3.14, c: -0.5 } }]);
  });

  it('handles INSERT IGNORE INTO', () => {
    const stmt = "INSERT IGNORE INTO `tbl` (`id`) VALUES (1);";
    const rows = Array.from(parseInsertStatement(stmt));
    expect(rows).toEqual([{ table: 'tbl', values: { id: 1 } }]);
  });
});

describe('streamDump', () => {
  function writeTemp(content: string): string {
    const dir = mkdtempSync(path.join(tmpdir(), 'sql-transform-test-'));
    const file = path.join(dir, 'fixture.sql');
    writeFileSync(file, content, 'utf8');
    return file;
  }

  it('skips DDL and yields rows from INSERTs', async () => {
    const content = `# Sequel Ace SQL dump
SET NAMES utf8mb4;

DROP TABLE IF EXISTS \`tbl\`;
CREATE TABLE \`tbl\` (
  \`id\` int(11) NOT NULL,
  \`name\` varchar(255) DEFAULT NULL,
  PRIMARY KEY (\`id\`)
);

LOCK TABLES \`tbl\` WRITE;
/*!40000 ALTER TABLE \`tbl\` DISABLE KEYS */;
INSERT INTO \`tbl\` (\`id\`, \`name\`) VALUES
\t(1, 'one'),
\t(2, 'two'),
\t(3, 'three');
/*!40000 ALTER TABLE \`tbl\` ENABLE KEYS */;
UNLOCK TABLES;
`;
    const file = writeTemp(content);
    const rows: { table: string; values: Record<string, unknown> }[] = [];
    for await (const row of streamDump(file)) rows.push(row);
    expect(rows).toEqual([
      { table: 'tbl', values: { id: 1, name: 'one' } },
      { table: 'tbl', values: { id: 2, name: 'two' } },
      { table: 'tbl', values: { id: 3, name: 'three' } },
    ]);
  });

  it('handles multiple tables in one file', async () => {
    const content = `INSERT INTO \`a\` (\`id\`) VALUES (1);

INSERT INTO \`b\` (\`id\`, \`text\`) VALUES (2, 'foo');
`;
    const file = writeTemp(content);
    const rows: { table: string; values: Record<string, unknown> }[] = [];
    for await (const row of streamDump(file)) rows.push(row);
    expect(rows).toEqual([
      { table: 'a', values: { id: 1 } },
      { table: 'b', values: { id: 2, text: 'foo' } },
    ]);
  });

  it('handles strings spanning embedded newlines', async () => {
    const content = `INSERT INTO \`t\` (\`id\`, \`prose\`) VALUES (1, 'line one\\nline two\\nline three');\n`;
    const file = writeTemp(content);
    const rows: { table: string; values: Record<string, unknown> }[] = [];
    for await (const row of streamDump(file)) rows.push(row);
    expect(rows[0]!.values.prose).toBe('line one\nline two\nline three');
  });
});
