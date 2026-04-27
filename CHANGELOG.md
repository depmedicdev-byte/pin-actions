# Changelog

## 0.1.0 - 2026-04-27

Initial release.

- Pins `uses: owner/repo@ref` to full commit SHAs in
  `.github/workflows/*.yml`.
- In-place rewrite preserves comments and ordering.
- `--check` mode for CI (exit 1 if pins would be applied).
- `--json` output for machine consumers.
- Skips local actions (`./...`) and docker actions (`docker://...`).
- Annotated tags are dereferenced to the underlying commit.
- MIT licensed.
