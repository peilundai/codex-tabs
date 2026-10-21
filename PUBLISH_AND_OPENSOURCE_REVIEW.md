# Publish and open-source review

Status: updated for the 0.2.5 release-readiness branch. Not a feature spec.
Do not publish, tag, or make the repository public until Peilun approves.

## Done in 0.2.5

- Original Marketplace and tab icons replace the OpenAI Codex app artwork in
  the current tree.
- Marketplace `displayName` and `description` say the extension is unofficial
  and not affiliated with OpenAI.
- Tracked `artifacts/*.zip` archives are removed from the branch and ignored.
- `PUBLISH_AND_OPENSOURCE_REVIEW.md` and `RESTORE_OPEN_CHATS_PLAN.md` stay in
  git and are excluded from the VSIX.
- `PRIVACY.md` is the text to use for the Marketplace privacy-policy URL.
- A missing absolute command, an unresolved Windows `loginShell` command, and
  an immediate Codex exit are reported in the editor. Sign-in itself stays
  inside Codex CLI.

## Still required before a listing

### Git history still contains the old artwork

Replacing the PNGs does not remove them from earlier commits, and the deleted
source zips are still in history. A public copy of this history would still
contain OpenAI's icon. If that matters, start the public repository from a
fresh root commit or rewrite history before the first public push. This branch
does not rewrite history.

### LICENSE detection

`package.json` declares MIT, and `LICENSE` is the MIT text plus one trademark
paragraph. GitHub can classify that file as "Other" because of the extra
paragraph. The license choice was left unchanged on purpose. `NOTICE` carries
the same trademark clarification.

### Publisher and repository

The repository `peilundai/codex-tabs` exists and is private. Marketplace
listing links, changelog compare URLs, and the privacy-policy URL below will
not work for the public until the repository is public. Do not flip that
visibility as part of packaging.

1. Create a Visual Studio Marketplace publisher whose ID is exactly
   `peilundai`.
2. Sign the Marketplace Publisher Agreement.
3. Publish with `vsce publish` (PAT with Marketplace **Manage** scope, or
   Entra ID). The first upload is virus-scanned and can lag.
4. In the listing, set the privacy policy to
   `https://github.com/peilundai/codex-tabs/blob/main/PRIVACY.md`
   and keep Support pointing at GitHub issues.
5. Optional: `ovsx publish` for Cursor and VSCodium users.
6. The verified-publisher badge is not available until the publisher has been
   on the Marketplace for the required period.

Restore-after-reload remains the plan in `RESTORE_OPEN_CHATS_PLAN.md`. It is
not a ship blocker.

## Suggested publish commands

Run these only after the repository is public, the publisher account exists,
and Peilun has approved the release. Do not tag or publish from this branch
automatically.

```bash
npm ci
npm run check
npm run package
npx vsce ls --no-dependencies
npx vsce publish
npx ovsx publish -p "$OVSX_PAT"
```

`vsce package` writes `codex-cli-tabs-<version>.vsix` and does not upload it.
`vsce publish` and `ovsx publish` do.
