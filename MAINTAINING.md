# Maintaining

Notes for maintainers: repository settings that cannot live in code, and how releases flow.

## One-time GitHub settings

**Settings → General**

- Pull requests: allow **squash merging** (default commit message: **Pull request title**) and **rebase merging** (only for release PRs from `next`). Disable merge commits.
- Enable **Automatically delete head branches** and **Allow auto-merge**.
- Features: enable **Discussions** (the issue forms send questions there).
- Default branch: `master` (the workflows, `.releaserc.json` and Dependabot assume it).

**Settings → Advanced Security**

- Enable **Private vulnerability reporting** (used by SECURITY.md and the Code of Conduct).
- Enable **Dependabot alerts** and **Dependabot security updates**.
- Leave **CodeQL default setup** off: `.github/workflows/codeql.yml` replaces it.

**Settings → Rules → Rulesets.** Use two rulesets:

| Ruleset          | Targets                   | Rules                                                                                                                                                          |
| ---------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| release branches | default branch and `next` | Require a pull request (0 approvals for a solo maintainer), require status checks, linear history, block force pushes and deletions. Bypass: Repository admin. |
| maintenance      | `*.x`                     | The same, **without required status checks** (old branches keep old workflows, so new check names never report there).                                         |

Required status checks: `Check (Node 22, NestJS 11)`, `Check (Node 24, NestJS 11)`, `Check (Node 26, NestJS 11)`, `Runtime compatibility (Node 22, NestJS 12)`, `Runtime compatibility (Node 24, NestJS 12)`, `Runtime compatibility (Node 26, NestJS 12)`, `Conventional Commits` and `Analyze`.

Pick the names that **a pull request** reports. Push runs of the release workflow report them with a `ci / ` prefix, which pull requests never produce; selecting those leaves every PR waiting for a check that never arrives.

## npm publishing

Releases are published by the release workflow through npm [trusted publishing](https://docs.npmjs.com/trusted-publishers) (OIDC) with provenance. No npm token is needed or wanted.

- Trusted publisher (npmjs.com → package → **Settings → Trusted Publisher** → GitHub Actions): user `pedrosodre`, repository `nestjs-business-engine`, workflow filename `release.yml`, environment empty.
- **Publishing access**: "Require two-factor authentication and disallow tokens".
- Keep `id-token: write` in the release job and `"provenance": true` in `publishConfig`. Provenance also requires the repository to be public.
- There must be no `NPM_TOKEN` secret. If OIDC fails, fix the trusted publisher instead of adding a token: npm restricts tokens that bypass 2FA for publishing, and such a token fails with `E403 You may not perform that action with these credentials`.

### If a release fails at the npm publish step

semantic-release creates and pushes the git tag (`vX.Y.Z`) and its note (`refs/notes/semantic-release-vX.Y.Z`) **before** it publishes. When the publish fails, the tag stays behind, and every later run treats that version as already released and publishes nothing. Before re-running:

1. Fix the cause (usually the trusted publisher configuration).
2. Delete the tag and its note: `git push origin :refs/tags/vX.Y.Z :refs/notes/semantic-release-vX.Y.Z`.
3. Delete the GitHub release for that tag, if one was created.
4. Re-run the Release workflow for that commit (re-runs use the current secrets and settings).

### How 1.0.0 was published

A trusted publisher can only be configured on a package that already exists, and npm rejected the 2FA-bypass token from CI. So `1.0.0` was published by hand from `e8fcb9e` (no provenance), after a placeholder `0.0.0-stage` created the package, and the `v1.0.0` tag was pushed manually so semantic-release continues from it. Every later version is released by CI with provenance.

## Branches

| Branch   | Releases                                       |
| -------- | ---------------------------------------------- |
| `master` | Stable versions on the `latest` npm dist-tag   |
| `next`   | Prereleases (`x.y.z-next.N`) on the `next` tag |
| `N.x`    | Maintenance releases of an older major         |

## The `next` branch

`next` stays idle until work on the next major starts. While it is idle, keep it level with `master` (`git push origin master:next`, a fast-forward), so it has nothing new to release and a future major starts from the current code.

## Releasing a new major

1. Create the `N.x` maintenance branch from the last release of the current major **before** the new major reaches `master`: `git push origin vN.M.P:refs/heads/N.x`.
2. Work on `next` and validate the prereleases.
3. Fast-forward `master` to `next` (or rebase-merge a PR).

Releases are never made by hand: no manual tags, no version bumps in `package.json` (1.0.0 was the only exception, see above).

## Maintenance

- `npm audit --omit=dev` shows what affects users. Dev-only findings never reach consumers.
- Fix what has a fix within range (`npm update <pkg>`); dismiss dev-only alerts without a fix as "Risk is tolerable" with a reason. Avoid forcing fixes with `overrides`.
- Current override: `minimatch` 11 for `@microsoft/api-extractor`, which pins a vulnerable 10.2.3 exactly. Remove it from `package.json` once api-extractor depends on `minimatch` >= 11.0.1.
- Copies of packages bundled inside other packages (for example the `npm` bundled with semantic-release) cannot be overridden. Dismiss their alerts as dev-only until upstream updates them.
- Dependabot security PRs sometimes use `fix(deps)` for dev dependencies, which publishes an unnecessary patch. Rename the PR to `build(deps-dev): …` before squashing.
- PRs to maintenance branches: change the base from `master` to `N.x` on the compare page. Never merge maintenance branches into `master`; cherry-pick fixes instead.
