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

Publishing uses npm [trusted publishing](https://docs.npmjs.com/trusted-publishers) (OIDC) with provenance, so no long-lived npm token is needed. A trusted publisher can only be configured on a package that already exists, so the **first** release needs a token:

1. Create a granular npm access token with publish rights (short expiry) and add it as the `NPM_TOKEN` Actions secret.
2. Push `next` (recommended) to publish `1.0.0-next.1` on the `next` dist-tag, or push `master` to publish `1.0.0` directly.
3. On npmjs.com, open the package → **Settings → Trusted Publisher** → GitHub Actions. User: `pedrosodre`, repository: `nestjs-business-engine`, workflow filename: `release.yml`, environment: empty.
4. After the next successful OIDC release, set **Publishing access** to "Require two-factor authentication and disallow tokens", delete the `NPM_TOKEN` secret and revoke the token on npm.

Keep `id-token: write` in the release job and `"provenance": true` in `publishConfig`.

## Branches

| Branch   | Releases                                       |
| -------- | ---------------------------------------------- |
| `master` | Stable versions on the `latest` npm dist-tag   |
| `next`   | Prereleases (`x.y.z-next.N`) on the `next` tag |
| `N.x`    | Maintenance releases of an older major         |

## First release (1.0.0)

1. Push `master` and `next` with the current history. Each push to `next` publishes a prerelease (`1.0.0-next.1`, `1.0.0-next.2`, ...) that can be installed with `npm install nestjs-business-engine@next`.
2. Install the prerelease in a scratch application for NestJS 11 and NestJS 12 and exercise it (rules from JSON, `forRootAsync`, errors, timeouts, ESM and CommonJS).
3. When it is ready, fast-forward `master` to `next` (`git push origin next:master`) or open a pull request and **rebase-merge** it. Never squash a release PR: release notes are generated from the individual commits.

## Releasing a new major

1. Create the `N.x` maintenance branch from the last release of the current major **before** the new major reaches `master`: `git push origin vN.M.P:refs/heads/N.x`.
2. Work on `next` and validate the prereleases.
3. Fast-forward `master` to `next` (or rebase-merge a PR).

Releases are never made by hand: no manual tags, no version bumps in `package.json`.

## Maintenance

- `npm audit --omit=dev` shows what affects users. Dev-only findings never reach consumers.
- Fix what has a fix within range (`npm update <pkg>`); dismiss dev-only alerts without a fix as "Risk is tolerable" with a reason. Don't force fixes with `overrides`.
- Dependabot security PRs sometimes use `fix(deps)` for dev dependencies, which publishes an unnecessary patch. Rename the PR to `build(deps-dev): …` before squashing.
- PRs to maintenance branches: change the base from `master` to `N.x` on the compare page. Never merge maintenance branches into `master`; cherry-pick fixes instead.
