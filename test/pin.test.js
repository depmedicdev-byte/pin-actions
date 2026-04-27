'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  pinLine,
  USES_RE,
  parseRepoFromTarget,
  looksLikeSha,
  isLocal,
  isDocker,
  processFile,
} = require('../src/index');

test('USES_RE: matches typical lines', () => {
  const cases = [
    '      - uses: actions/checkout@v4',
    '      - uses: actions/setup-node@v4.0.0',
    '  uses: org/action@main',
    '      - uses: actions/checkout@v4 # standard checkout',
  ];
  for (const c of cases) assert.ok(USES_RE.test(c), 'should match: ' + c);
});

test('USES_RE: does not match non-uses lines', () => {
  for (const c of ['name: ci', '      run: echo hi', '      with:', '# uses: not-this']) {
    assert.equal(USES_RE.test(c), false, 'should not match: ' + c);
  }
});

test('looksLikeSha', () => {
  assert.equal(looksLikeSha('abcd1234abcd1234abcd1234abcd1234abcd1234'), true);
  assert.equal(looksLikeSha('v4'), false);
  assert.equal(looksLikeSha('main'), false);
  assert.equal(looksLikeSha('abcd1234'), false);
});

test('isLocal / isDocker', () => {
  assert.equal(isLocal('./actions/foo'), true);
  assert.equal(isLocal('../foo'), true);
  assert.equal(isLocal('actions/checkout'), false);
  assert.equal(isDocker('docker://alpine:3'), true);
  assert.equal(isDocker('actions/checkout'), false);
});

test('parseRepoFromTarget', () => {
  assert.deepEqual(parseRepoFromTarget('actions/checkout'), { owner: 'actions', repo: 'checkout' });
  assert.deepEqual(parseRepoFromTarget('org/action/sub/path'), { owner: 'org', repo: 'action' });
  assert.equal(parseRepoFromTarget('badname'), null);
});

test('pinLine: rewrites preserving leading whitespace and adds comment', () => {
  const sha = '0'.repeat(40);
  const out = pinLine('      - uses: actions/checkout@v4', sha, 'v4');
  assert.equal(out, `      - uses: actions/checkout@${sha}  # v4`);
});

test('pinLine: keeps existing comment', () => {
  const sha = '0'.repeat(40);
  const out = pinLine('      - uses: actions/checkout@v4 # standard', sha, 'v4');
  assert.equal(out, `      - uses: actions/checkout@${sha} # standard`);
});

test('processFile: pins refs using a stub fetch (write=false)', async () => {
  const tmp = path.join(os.tmpdir(), 'pin-test-' + Date.now() + '.yml');
  fs.writeFileSync(tmp, [
    'name: ci',
    'on: push',
    'jobs:',
    '  build:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - uses: actions/checkout@v4',
    '      - uses: actions/setup-node@v4.0.0',
    '      - uses: ./local/action',
    '      - uses: docker://alpine:3',
    '      - uses: actions/checkout@' + 'a'.repeat(40),
  ].join('\n'));

  const stubFetch = async (url) => {
    if (url.includes('/git/ref/tags/v4') || url.includes('/git/ref/tags/v4.0.0')) {
      return {
        status: 200,
        json: async () => ({ object: { sha: 'b'.repeat(40), type: 'commit' } }),
      };
    }
    return { status: 404, json: async () => ({}) };
  };

  const r = await processFile(tmp, { write: false, fetchImpl: stubFetch });
  const actions = r.events.map((e) => e.action).sort();
  // local actions (./...) and docker:// have no @ref and so do not match the
  // uses-regex at all - they are silently ignored, not "skipped" with a reason.
  assert.deepEqual(actions, ['already-pinned', 'pin', 'pin'].sort());
  fs.unlinkSync(tmp);
});

test('processFile: explicit local-action with @ref is reported as skip', async () => {
  const tmp = path.join(os.tmpdir(), 'pin-test2-' + Date.now() + '.yml');
  fs.writeFileSync(tmp, [
    'jobs:',
    '  a:',
    '    steps:',
    // a local action with an @ref looks weird but is technically legal syntax.
    // We skip it because we cannot resolve a SHA for a local path.
    '      - uses: ./.github/actions/foo@main',
  ].join('\n'));
  const stubFetch = async () => ({ status: 404, json: async () => ({}) });
  const r = await processFile(tmp, { write: false, fetchImpl: stubFetch });
  assert.equal(r.events.length, 1);
  assert.equal(r.events[0].action, 'skip');
  assert.equal(r.events[0].reason, 'local');
  fs.unlinkSync(tmp);
});
