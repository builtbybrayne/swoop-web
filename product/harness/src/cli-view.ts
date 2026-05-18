/**
 * cli-view.ts — operator-facing CLI that renders a per-scenario JSONL as
 * a self-contained HTML transcript.
 *
 * Usage:
 *   npm run -w @swoop/harness view -- <path-to-jsonl>
 *   npm run -w @swoop/harness view -- <path-to-jsonl> --open
 *   npm run -w @swoop/harness view -- <path-to-scenarios-dir>
 *
 * Output location:
 *   Writes <basename>.html into a `views/` directory at the same level as
 *   the .jsonl's parent directory. For the standard run layout this means:
 *
 *     runs/<rundir>/scenarios/<name>.jsonl  →  runs/<rundir>/views/<name>.html
 *
 *   For ad-hoc paths whose layout differs, `views/` is created next to the
 *   .jsonl's parent dir (i.e. `<dirname(parent)>/views/<basename>.html`).
 *
 * Per planning/03-exec-h-t8-transcript-view.md Task 3 (HITL-ratified
 * 2026-05-18). Markdown viewer was the initial proposal; HTML + collapsibles
 * was the ratified direction.
 */

import { execSync } from 'node:child_process';
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';

import { messageOf } from '@swoop/common';

import type { HarnessEvent } from './events.js';
import { viewTranscript } from './view-transcript.js';

interface CliArgs {
  readonly path: string | null;
  readonly open: boolean;
  readonly help: boolean;
}

function parseArgs(argv: readonly string[]): CliArgs {
  let path: string | null = null;
  let open = false;
  let help = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--open':
        open = true;
        break;
      case '-h':
      case '--help':
        help = true;
        break;
      default:
        if (arg.startsWith('--')) {
          console.warn(`[view] unknown flag: ${arg}`);
        } else if (path === null) {
          path = arg;
        } else {
          console.warn(`[view] ignoring extra positional argument: ${arg}`);
        }
        break;
    }
  }
  return { path, open, help };
}

function printHelp(): void {
  const help = [
    'Swoop harness — transcript viewer',
    '',
    'Renders a per-scenario JSONL event stream as a self-contained HTML',
    'document for human review. Output lands in a views/ sibling of the',
    "JSONL's parent directory.",
    '',
    'Usage:',
    '  npm run -w @swoop/harness view -- <path>',
    '  npm run -w @swoop/harness view -- <path> --open',
    '',
    'Args:',
    '  <path>     Path to a .jsonl file, OR a directory containing .jsonl',
    '             files (each is rendered to its own .html under views/).',
    '',
    'Flags:',
    '  --open     After writing, exec `open <path>` to launch the HTML in',
    '             the default macOS application. Off by default.',
    '  -h, --help Show this message.',
    '',
    'Exit code: 0 on success; 1 on usage / IO error.',
  ].join('\n');
  console.log(help);
}

function listJsonlFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => extname(name) === '.jsonl')
    .map((name) => join(dir, name))
    .sort();
}

/**
 * Compute the output HTML path for a given JSONL path.
 *
 * Standard run layout:
 *   .../runs/<rundir>/scenarios/<name>.jsonl  →  .../runs/<rundir>/views/<name>.html
 *
 * Ad-hoc layout (parent isn't named `scenarios`):
 *   .../whatever/dir/<name>.jsonl  →  .../whatever/views/<name>.html
 *
 * The `views/` directory is created if it doesn't exist.
 */
function computeHtmlPath(jsonlPath: string): string {
  const parent = dirname(resolve(jsonlPath));
  const grandparent = dirname(parent);
  const viewsDir = join(grandparent, 'views');
  mkdirSync(viewsDir, { recursive: true });
  const stem = basename(jsonlPath, '.jsonl');
  return join(viewsDir, `${stem}.html`);
}

function loadEvents(jsonlPath: string): HarnessEvent[] {
  const raw = readFileSync(jsonlPath, 'utf8');
  const lines = raw.split('\n').filter((l) => l.trim().length > 0);
  const events: HarnessEvent[] = [];
  let skipped = 0;
  for (const line of lines) {
    try {
      events.push(JSON.parse(line) as HarnessEvent);
    } catch (err) {
      skipped += 1;
      const reason = messageOf(err);
      console.warn(
        `[view] skipping unparseable line in ${jsonlPath}: ${reason}`,
      );
    }
  }
  if (skipped > 0) {
    console.warn(`[view] ${jsonlPath}: skipped ${skipped} unparseable line(s).`);
  }
  return events;
}

function renderOne(jsonlPath: string, open: boolean): string {
  const events = loadEvents(jsonlPath);
  const html = viewTranscript(events);
  const out = computeHtmlPath(jsonlPath);
  writeFileSync(out, html, 'utf8');
  console.log(out);
  if (open) {
    try {
      execSync(`open ${JSON.stringify(out)}`, { stdio: 'inherit' });
    } catch (err) {
      const reason = messageOf(err);
      console.warn(`[view] --open failed (macOS only): ${reason}`);
    }
  }
  return out;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }
  if (args.path === null) {
    console.error('[view] missing required <path> argument. Try --help.');
    process.exit(1);
  }
  let stat;
  try {
    stat = statSync(args.path);
  } catch (err) {
    console.error(`[view] cannot stat ${args.path}: ${messageOf(err)}`);
    process.exit(1);
  }
  if (stat.isDirectory()) {
    const jsonlFiles = listJsonlFiles(args.path);
    if (jsonlFiles.length === 0) {
      console.error(`[view] no .jsonl files found in ${args.path}`);
      process.exit(1);
    }
    for (const p of jsonlFiles) {
      renderOne(p, args.open);
    }
  } else {
    renderOne(args.path, args.open);
  }
}

try {
  main();
} catch (err) {
  console.error(`[view] fatal: ${messageOf(err)}`);
  process.exit(1);
}
