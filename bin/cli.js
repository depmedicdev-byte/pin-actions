#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const { processPaths } = require('../src/index');
const pkg = require('../package.json');

const HELP = `pin-actions - pin every uses: owner/repo@ref to a full commit SHA.

Usage:
  pin-actions [paths...]            default: . (scans .github/workflows)
  pin-actions --check               do not write; exit 1 if any pins are needed
  pin-actions --json                machine-readable report
  pin-actions --token=ghp_xxx       GitHub token (or env GITHUB_TOKEN). Higher rate limit.
  pin-actions --version | --help

Behavior:
  - Skips local actions (./...) and docker:// actions.
  - Already-SHA pins are left alone.
  - Comments are preserved. Each pinned line gets a trailing comment with
    the original ref so humans can still read what version it is.
  - Uses GitHub's git/refs API to resolve tags and branches.
`;

function parseArgs(argv) {
  const a = { positional: [], format: 'text', write: true };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === '--help' || x === '-h') a.help = true;
    else if (x === '--version' || x === '-V') a.version = true;
    else if (x === '--check') a.write = false;
    else if (x === '--json') a.format = 'json';
    else if (x === '--token') a.token = argv[++i];
    else if (x.startsWith('--token=')) a.token = x.slice(8);
    else if (x.startsWith('--')) { console.error('unknown flag: ' + x); process.exit(2); }
    else a.positional.push(x);
  }
  if (!a.token) a.token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
  if (a.positional.length === 0) a.positional.push('.');
  return a;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { process.stdout.write(HELP); return 0; }
  if (args.version) { process.stdout.write(pkg.version + '\n'); return 0; }

  for (const p of args.positional) {
    if (!fs.existsSync(p)) { console.error('not found: ' + p); return 2; }
  }

  const results = await processPaths(args.positional, { token: args.token, write: args.write });
  const all = results.flatMap((r) => r.events);
  const pins = all.filter((e) => e.action === 'pin');
  const already = all.filter((e) => e.action === 'already-pinned');
  const skipped = all.filter((e) => e.action === 'skip');
  const errors = all.filter((e) => e.action === 'error');

  if (args.format === 'json') {
    process.stdout.write(JSON.stringify({
      generatedAt: new Date().toISOString(),
      mode: args.write ? 'write' : 'check',
      summary: { pin: pins.length, alreadyPinned: already.length, skipped: skipped.length, errors: errors.length },
      events: all,
    }, null, 2) + '\n');
  } else {
    process.stdout.write(`pin-actions  ${new Date().toISOString()}\n\n`);
    if (results.length === 0) {
      process.stdout.write('No workflow files found under .github/workflows.\n');
      return 0;
    }
    for (const e of pins) process.stdout.write(`PIN    ${e.file}:${e.line}  ${e.target}@${e.ref}  ->  ${e.sha.slice(0, 12)}  # ${e.ref}\n`);
    for (const e of errors) process.stdout.write(`ERR    ${e.file}:${e.line}  ${e.target}@${e.ref}  ${e.error}\n`);
    if (args.write) {
      for (const r of results) if (r.changed) process.stdout.write(`wrote  ${r.file}\n`);
    }
    process.stdout.write(`\nsummary: pin=${pins.length}  already-pinned=${already.length}  skipped=${skipped.length}  errors=${errors.length}\n`);
    process.stdout.write(`mode: ${args.write ? 'write' : 'check'}\n`);
    process.stdout.write('\nfree CLIs from depmedic: depmedic, ci-doctor, gha-budget, cursor-rules-init.\n');
  }

  if (errors.length > 0) return 2;
  if (!args.write && pins.length > 0) return 1;
  return 0;
}

main().then((c) => process.exit(c)).catch((e) => { console.error(e && e.stack ? e.stack : String(e)); process.exit(2); });
