# CLAUDE.md

PDF Presenter Network: a fork of [htlin222/pdf-presenter](https://github.com/htlin222/pdf-presenter) that lets audience devices and projectors on a classroom LAN follow a presenter. It's a TypeScript Node CLI/server (`src/`) with a vanilla JS browser UI (`src/ui/`).

## Commands

```bash
pnpm install
pnpm build            # tsup → dist/pdf-presenter.js (deps stay external)
pnpm exec tsc --noEmit
pnpm test             # vitest (test/sync.test.ts)
make run              # build + serve test/fixtures/sample.pdf
```

## Architecture

- `src/cli.ts` dispatches to `startServer` (single PDF) or `startDirectoryServer` (no arg or a directory: audience root with a waiting screen, `/list`, and upload via **Open PDF**). Both live in `src/server.ts`, which only composes route handlers from `src/server/routes/*`. Each handler returns `"handled"` or `"skip"`.
- Sync: `src/server/sync.ts` keeps the authoritative state (slide, freeze, black, viewport, strokes) in memory. The transport is WebSocket first, with an HTTP long-poll fallback on `/api/sync` for restricted networks (`src/ui/modules/websocket.js`). The presenter is authoritative.
- UI modules are in `src/ui/modules/`: overlay (pen/eraser/laser), slide-viewport (zoom/pan), link-layer, slide-duration (Beamer `/Dur`, `\transduration`), timer (overall + per-slide), notes-editor, recording.
- Runtime path resolution (`src/server/paths.ts`): `dist/` → `../src/ui`, and pdfjs via `require.resolve`. Any packaged layout must keep `dist/` and `src/ui/` side by side, plus `node_modules`.

## Distribution (decided)

- **GitHub releases only, never npm.** The upstream `publish.yml` was removed. `npx pdf-presenter` installs upstream, not this fork.
- `.github/workflows/release.yml` runs when a `package.json` version bump is pushed to main, or when started by hand (which rebuilds the current version's assets). It:
  - creates tag `vX.Y.Z`;
  - builds `pdf-presenter-network.tar.gz` (dist, src/ui, scripts, prod `node_modules` installed with the hoisted linker, `@napi-rs/canvas` stripped because it is native and unused);
  - attaches the tarball plus `install.sh`, `update.sh` and `uninstall.sh`.
- Don't add `--no-optional` to the prod install: combined with the hoisted linker, pnpm reports a broken lockfile.
- **Release notes must always include the install, update and uninstall commands.** The workflow writes them, and GitHub's generated changelog is appended.
- To release: bump `version` in `package.json` and push to main. Patch bumps are the norm.

## Install scripts (`scripts/`)

- `install.sh`: the `curl … | sh` entry point. It downloads a release (`PDF_PRESENTER_VERSION` pins one) to `~/.local/share/pdf-presenter-network/app`, replaces the old copy, then runs `install-linux.sh`.
- `install-linux.sh`: shared by release and source installs.
  - It only builds when run from a git checkout.
  - It installs a systemd service on port 80 (`CAP_NET_BIND_SERVICE`, runs as the user), a desktop entry, a launcher (`launch-linux.sh`, Chrome app window with an isolated profile), and the `~/.local/bin/pdf-presenter` link.
  - It links `pdf-presenter-update` only for release installs, so a source checkout is never switched to a release.
  - It restarts the service on every run.
- **The PDF directory is always asked for** on `/dev/tty`, so it works with `curl | sh`. There is never a silent `$HOME` default. An existing service's `WorkingDirectory` is offered as the Enter default. A first argument skips the question. With no terminal and no argument, it errors out.
- `update.sh`: compares the installed version with the latest release (found via the redirect of `releases/latest`) and runs that release's `install.sh`. `--check` only reports.
- In-app update: `src/server/routes/update.ts` (`/api/update`, only for requests from the server's own machine) checks the latest release hourly. The presenter's Update button (`src/ui/modules/update-check.js`) POSTs, the server runs `update.sh` with `PDF_PRESENTER_APP_ONLY=1` (`install-linux.sh` then skips the directory question and all `sudo`/service steps), and exits with 75 so systemd (`Restart=on-failure`) restarts it. Only offered for release installs running under systemd (`INVOCATION_ID`).
- `uninstall.sh`: removes the service, the desktop entry, the `~/.local/bin` links (only if they point into our install) and the data dir.
- These are POSIX `sh` (dash). Avoid redirections on special builtins like `:` (dash exits on failure); use a subshell `(true </dev/tty)` instead.

## Decisions / boundaries

- **No casting code here.** AirPlay casting lives in a separate app (Doubletake UI). Keep the audience page title `Audience – PDF Presenter`, because that app picks the window by it.
- Commits are SSH-signed. Inside the Claude sandbox the SSH agent is unreachable, so commit/push needs the sandbox disabled.
- `README-zhtw.md` is upstream's text and is not maintained.
