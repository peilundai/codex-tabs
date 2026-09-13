# Publish and open-source review

Status: snapshot of remaining work before Marketplace/Open VSX
publication and a public source repository. Not a feature spec.

The extension is already in publishable *shape* (MIT license, README,
CHANGELOG, CI, packaging, no telemetry). What is still missing is
mostly **legal rights to the Codex artwork**, a **public GitHub repo**,
and **Marketplace/Open VSX publisher setup**. Restore-after-reload is a
later feature, not a ship blocker.

## What will actually stop you

### 1. Official Codex artwork (highest risk for both)

`NOTICE` says the Marketplace and tab icons come from the official
Codex app. Those files are in `media/` and would go out under MIT.

That is the one issue that can get a listing rejected, taken down, or
make an MIT repo legally inconsistent:

- You cannot grant MIT rights to artwork you do not own.
- OpenAI’s brand rules disallow using their marks as your product
  branding.
- The Marketplace publisher agreement forbids listing icons/trademarks
  you are not allowed to use.

The name **Codex CLI Tabs** plus the unaffiliated disclaimer is
ordinary compatibility naming. Shipping OpenAI’s cloud mark as *your*
extension icon is a different problem.

**Before publish or a public repo:** replace those PNGs with original
artwork, and keep Codex/OpenAI names as text only. Keep the disclaimer
in README/`NOTICE`.

This is not legal advice. The icon/trademark point is the one not to
ship around.

### 2. The GitHub repo does not exist yet

`package.json` already points at
`https://github.com/peilundai/codex-tabs`, but:

- there is no git remote
- `peilundai/codex-tabs` 404s
- Marketplace listing `peilundai.codex-cli-tabs` does not exist
- `vsce` has no local publisher login

README, CHANGELOG version links, issue tracker, and `SECURITY.md`
(private advisories) all assume that repo is live.

Create the public repo first, then publish, so Marketplace
“Repository / Issues / License” links work on day one.

### 3. Repo hygiene before it goes public

Do this before the first push:

- **Remove `artifacts/` from git.** Two source/VSIX zips are tracked.
  They are build products, and the 0.2.0 source zip still contains
  `docs/superpowers/` that is not in the current tree.
- **Keep `RESTORE_OPEN_CHATS_PLAN.md` out of the VSIX.** It is
  untracked, but `vsce ls` currently includes it. Add it to
  `.gitignore` / `.vscodeignore` (or delete it) before packaging.
- **Ignore `artifacts/` and `*.vsix` in git** (VSIX at the repo root is
  already ignored).
- Decide whether to keep any uncommitted PTY-bridge work; do not
  publish a dirty or accidental planning-doc package.

Git history is only two commits, which is a good time to go public.

## Open-sourcing checklist

Already in good shape: MIT `LICENSE`, `NOTICE`, README, CONTRIBUTING,
SECURITY, SUPPORT, architecture doc, tests, GitHub Actions CI.

Still to do:

| Item | Why |
| --- | --- |
| Create `peilundai/codex-tabs` and `git remote add origin` | Manifest/docs already assume it |
| Push, then tag `v0.2.4` (and earlier versions if you want the CHANGELOG links to resolve) | CHANGELOG compare URLs 404 today |
| Enable private vulnerability reporting | `SECURITY.md` tells people to use it |
| Add a short `PRIVACY.md` | “No telemetry; Codex CLI has its own terms” |
| Optional: `CODE_OF_CONDUCT.md`, issue templates | GitHub community defaults, not required |
| Accept that `peilun.dai@gmail.com` is in commit history | It becomes public with the repo |
| Fix LICENSE/SPDX mismatch if you care about GitHub’s MIT badge | Extra paragraph after the MIT text can keep GitHub from auto-detecting MIT; the trademark clarification belongs in `NOTICE` |

You do **not** need restore-open-chats, a CLA, or extra runtime
dependencies.

## Marketplace / Open VSX checklist

Product/docs for a 0.2.x listing are largely ready: unique
`publisher`/`name`, icon size (1024² PNG), categories including
`Chat`, trust/virtual-workspace flags, no network/telemetry in this
extension.

Still to do:

1. Create a Visual Studio Marketplace publisher whose ID is exactly
   `peilundai`.
2. Sign the Marketplace Publisher Agreement.
3. Publish with `vsce publish` (PAT with Marketplace **Manage**, or
   Entra ID). First upload is virus-scanned and can lag.
4. In listing metadata, set **Privacy policy** (even a “we collect
   nothing” page), and keep Support pointing at GitHub issues.
5. Optional: Open VSX (`ovsx publish`) if you want Cursor / VSCodium
   users without sideloading a VSIX.
6. Optional README screenshots — listing quality, not a hard gate.
7. Verified publisher badge is **not** available yet (needs ~6 months
   on Marketplace).

## Suggested order

1. Swap in original icons; keep the unofficial disclaimer.
2. Drop `artifacts/` from git; stop packaging the restore plan.
3. Create the public GitHub repo, push, tag `v0.2.4`, turn on private
   security advisories.
4. Add `PRIVACY.md`.
5. Run:

   ```bash
   npm ci
   npm run check
   npm run package
   npx vsce ls --no-dependencies
   ```

6. `vsce publish` (then Open VSX if you want it).
