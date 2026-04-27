'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Match a workflow `uses:` line. Captures:
//   1: leading whitespace
//   2: owner/repo or owner/repo/path
//   3: ref (tag, branch, or sha)
//   4: trailing comment (incl. leading whitespace) or empty
const USES_RE = /^(\s*-?\s*uses:\s*)([\w.-]+\/[\w./-]+)@([^\s#]+)([ \t]*#.*)?$/;

function looksLikeSha(s) { return /^[0-9a-f]{40}$/.test(s); }
function isLocal(target) { return target.startsWith('./') || target.startsWith('../'); }
function isDocker(target) { return target.startsWith('docker://'); }

function listWorkflowFiles(dir) {
  const wf = path.join(dir, '.github', 'workflows');
  if (!fs.existsSync(wf)) {
    if (path.basename(dir) === 'workflows' && fs.existsSync(dir)) return readDir(dir);
    return [];
  }
  return readDir(wf);
}

function readDir(d) {
  const out = [];
  for (const e of fs.readdirSync(d)) {
    const f = path.join(d, e);
    if (fs.statSync(f).isFile() && /\.ya?ml$/i.test(e)) out.push(f);
  }
  return out;
}

function parseRepoFromTarget(target) {
  // owner/repo or owner/repo/sub/path -> { owner, repo }
  const parts = target.split('/');
  if (parts.length < 2) return null;
  return { owner: parts[0], repo: parts[1] };
}

async function resolveRef({ owner, repo, ref, token, fetchImpl = fetch }) {
  // GitHub's git/refs API resolves tags and branches to commit SHAs.
  // For an annotated tag, /git/refs/tags/<tag> returns an object SHA;
  // we deref via /git/tags/<sha> if the object is a tag. For lightweight
  // tags or branches the ref already points at the commit.
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'pin-actions' };
  if (token) headers.Authorization = 'token ' + token;

  // Try as tag first (most common pin target).
  for (const kind of ['tags', 'heads']) {
    const r = await fetchImpl(`https://api.github.com/repos/${owner}/${repo}/git/ref/${kind}/${encodeURIComponent(ref)}`, { headers });
    if (r.status === 200) {
      const j = await r.json();
      if (j.object && j.object.sha) {
        if (j.object.type === 'tag') {
          const t = await fetchImpl(`https://api.github.com/repos/${owner}/${repo}/git/tags/${j.object.sha}`, { headers });
          if (t.status === 200) {
            const tj = await t.json();
            if (tj.object && tj.object.sha) return { sha: tj.object.sha, kind };
          }
        }
        return { sha: j.object.sha, kind };
      }
    }
  }
  // Fallback: ref might already be a commit SHA (full or short).
  const r = await fetchImpl(`https://api.github.com/repos/${owner}/${repo}/commits/${encodeURIComponent(ref)}`, { headers });
  if (r.status === 200) {
    const j = await r.json();
    if (j.sha) return { sha: j.sha, kind: 'commit' };
  }
  return null;
}

function pinLine(line, sha, originalRef) {
  return line.replace(USES_RE, (m, lead, target, ref, comment) => {
    const note = comment && comment.trim().length > 1 ? comment : `  # ${originalRef}`;
    return `${lead}${target}@${sha}${note}`;
  });
}

async function processFile(file, opts) {
  const src = fs.readFileSync(file, 'utf8');
  const eol = src.includes('\r\n') ? '\r\n' : '\n';
  const lines = src.split(/\r?\n/);
  const events = [];
  let changed = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = USES_RE.exec(line);
    if (!m) continue;
    const target = m[2];
    const ref = m[3];

    if (isLocal(target) || isDocker(target)) {
      events.push({ file, line: i + 1, target, ref, action: 'skip', reason: isLocal(target) ? 'local' : 'docker' });
      continue;
    }
    if (looksLikeSha(ref)) {
      events.push({ file, line: i + 1, target, ref, action: 'already-pinned' });
      continue;
    }
    const parsed = parseRepoFromTarget(target);
    if (!parsed) {
      events.push({ file, line: i + 1, target, ref, action: 'skip', reason: 'parse' });
      continue;
    }
    let resolved;
    try {
      resolved = await resolveRef({ owner: parsed.owner, repo: parsed.repo, ref, token: opts.token, fetchImpl: opts.fetchImpl });
    } catch (err) {
      events.push({ file, line: i + 1, target, ref, action: 'error', error: err.message });
      continue;
    }
    if (!resolved) {
      events.push({ file, line: i + 1, target, ref, action: 'error', error: 'unresolvable ref' });
      continue;
    }
    const newLine = pinLine(line, resolved.sha, ref);
    if (newLine !== line) {
      lines[i] = newLine;
      changed = true;
      events.push({ file, line: i + 1, target, ref, sha: resolved.sha, action: 'pin' });
    }
  }
  if (changed && opts.write) fs.writeFileSync(file, lines.join(eol));
  return { file, changed, events };
}

async function processPaths(paths, opts) {
  const results = [];
  for (const p of paths) {
    const stat = fs.statSync(p);
    const files = stat.isDirectory() ? listWorkflowFiles(p) : [p];
    for (const f of files) results.push(await processFile(f, opts));
  }
  return results;
}

module.exports = {
  processPaths,
  processFile,
  pinLine,
  resolveRef,
  USES_RE,
  parseRepoFromTarget,
  looksLikeSha,
  isLocal,
  isDocker,
};
