# pin-actions

Pin every `uses: owner/repo@ref` in your GitHub Actions workflows to a
full commit SHA. Supply-chain-safe, in-place rewrite, comment-preserving.

```bash
$ npx pin-actions

pin-actions  2026-04-27T06:30:00Z

PIN    .github/workflows/ci.yml:7   actions/checkout@v4       ->  b3aab09b1b18  # v4
PIN    .github/workflows/ci.yml:8   actions/setup-node@v4     ->  39370e3970a6  # v4
PIN    .github/workflows/ci.yml:13  actions/upload-artifact@v4 -> ea165f8d6502  # v4
wrote  .github/workflows/ci.yml

summary: pin=3  already-pinned=0  skipped=0  errors=0
mode: write
```

## Why

GitHub's [hardening guide](https://docs.github.com/actions/security-guides/security-hardening-for-github-actions#using-third-party-actions)
says: pin third-party actions to a full commit SHA. The reason is real.
A compromised tag can ship malicious code under the same `@v4` you've
been trusting for a year. Tags are mutable. SHAs are not.

Pinning by hand is tedious. Renovate handles it but is heavy. Dependabot
handles it only after you opt in per repo and only for some ecosystems.
`pin-actions` does it in one shot, locally, with no service.

## Install

```bash
npx pin-actions                  # one-shot
npm install -g pin-actions       # if you'll run it often
```

## Usage

```bash
pin-actions                      # rewrite .github/workflows/*.yml in cwd
pin-actions path/to/repo         # specific repo
pin-actions --check              # do not write; exit 1 if pins are needed (CI)
pin-actions --json               # machine-readable report
pin-actions --token=ghp_xxx      # higher rate limit (or env GITHUB_TOKEN)
```

In CI, `--check` is the right mode:

```yaml
- name: Verify all actions are pinned
  uses: actions/checkout@v4
  with:
    fetch-depth: 1
- run: npx pin-actions --check
  env:
    GITHUB_TOKEN: ${{ github.token }}
```

## Behavior

- Pins by rewriting `uses: owner/repo@v4` to `uses: owner/repo@<sha>  # v4`.
  The trailing comment lets humans read what version is pinned.
- Existing trailing comments are preserved.
- Already-SHA pins are left alone.
- Local actions (`./actions/foo`) and Docker actions (`docker://...`)
  are skipped; SHA-pinning is for repository actions only.
- Annotated tags are dereferenced to the underlying commit SHA so the
  pin matches what `actions/checkout` would see.

## Rate limits

Anonymous: 60 GitHub API requests/hr. A medium repo with ~30 `uses:`
lines is well under that. Larger repos: pass `--token=$GITHUB_TOKEN`
or set `GITHUB_TOKEN` in the environment for 5,000/hr.

## Companion tools

- [`ci-doctor`](https://www.npmjs.com/package/ci-doctor) - audit
  workflows for waste, cost, and other security gaps. ci-doctor flags
  unpinned actions; pin-actions fixes them.
- [`gha-budget`](https://www.npmjs.com/package/gha-budget) - estimate
  the dollar cost of a workflow per runner.
- [`depmedic`](https://www.npmjs.com/package/depmedic) - surgical npm
  vulnerability triage.
- [`cursor-rules-init`](https://www.npmjs.com/package/cursor-rules-init)
  - opinionated `.cursorrules` starters.

## License

MIT.
