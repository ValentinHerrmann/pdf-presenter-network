# pdf-presenter

<p align="center">
  <a href="https://www.npmjs.com/package/pdf-presenter"><img alt="npm version" src="https://img.shields.io/npm/v/pdf-presenter?color=cb3837&logo=npm&logoColor=white&label=npm"></a>
  <a href="https://www.npmjs.com/package/pdf-presenter"><img alt="npm downloads" src="https://img.shields.io/npm/dm/pdf-presenter?color=cb3837&logo=npm&logoColor=white"></a>
  <a href="https://github.com/htlin222/pdf-presenter/blob/main/LICENSE"><img alt="license" src="https://img.shields.io/npm/l/pdf-presenter?color=blue"></a>
  <a href="https://nodejs.org"><img alt="node" src="https://img.shields.io/node/v/pdf-presenter?color=5fa04e&logo=node.js&logoColor=white"></a>
</p>

<p align="center">
  <a href="https://github.com/htlin222/pdf-presenter/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/htlin222/pdf-presenter/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://github.com/htlin222/pdf-presenter/actions/workflows/publish.yml"><img alt="Publish" src="https://github.com/htlin222/pdf-presenter/actions/workflows/publish.yml/badge.svg"></a>
  <a href="https://github.com/htlin222/pdf-presenter/releases"><img alt="release" src="https://img.shields.io/github/v/release/htlin222/pdf-presenter?color=6f42c1&logo=github&logoColor=white"></a>
  <a href="https://www.npmjs.com/package/pdf-presenter"><img alt="provenance" src="https://img.shields.io/badge/npm-provenance%20verified-2ea44f?logo=npm&logoColor=white"></a>
</p>

<p align="center">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.x-3178c6?logo=typescript&logoColor=white">
  <img alt="pnpm" src="https://img.shields.io/badge/pnpm-10-f69220?logo=pnpm&logoColor=white">
  <img alt="tsup" src="https://img.shields.io/badge/bundler-tsup-ff4f64">
  <img alt="pdf.js" src="https://img.shields.io/badge/pdf.js-4.x-e31e24">
  <a href="https://github.com/htlin222/pdf-presenter/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/htlin222/pdf-presenter?style=social"></a>
</p>

> Lightweight CLI that serves a PDF as browser slides with a full presenter mode — speaker notes, next-slide preview, pause-able timer, audio recording with per-slide timeline metadata, and resizable panes. No markdown conversion, no native dependencies. Point it at a PDF and go.

<p align="center">
  <img src="assets/presenter-preview.png" alt="Presenter view — current slide, speaker notes, next slide preview, and timer" width="720" />
</p>

[繁體中文版 →](./README-zhtw.md)

```bash
npx pdf-presenter slides.pdf           # serve & open browser
npx pdf-presenter -gn slides.pdf       # generate a notes template
npx pdf-presenter slides.pdf -t 20     # 20-minute countdown
npx pdf-presenter ./slides/            # browse a directory of PDFs
npx pdf-presenter                      # open the audience view for the current directory
```

---

## Why

Presenting a PDF deck usually means either:

- Opening the PDF in a viewer and losing speaker notes / next-slide preview, or
- Converting slides to HTML (and fighting layout, fonts, and build tooling).

`pdf-presenter` takes a third path: keep the PDF as-is, render it with `pdf.js` in the browser, and layer a presenter window (current + next + notes + timer) on top. Slide state syncs through the local server over WebSockets, so audience devices on the same LAN can follow the presenter. Start it without an argument to open the audience view for the current directory; use `/list` to browse and open a PDF.

## Features

- **Zero config.** One argument: the PDF file.
- **Dual views.** Audience view (fullscreen slide) and presenter view (current, next, notes, timer, counter).
- **Speaker notes** from a simple JSON file. Generate a template from the PDF text with `-gn`, or **edit notes directly in the presenter view** — changes are saved back to `slides.notes.json` automatically (debounced).
- **Timer.** Count up by default, or count down with `--timer <minutes>`. Colour shifts yellow in the last 5 min, red in the last 1 min.
- **Keyboard-first.** Arrow keys, `Space`, `PageUp/Down`, `Home/End`, plus `F` freeze, `B` black, `R` reset timer.
- **LAN synchronization** via WebSockets — the presenter window drives audience windows on the same computer or other devices on the local network.
- **Annotations.** Draw persistent per-slide pen strokes, erase complete strokes, or show a hover laser pointer. Annotations scale with the rendered slide and are replicated live to every audience.
- **Timed slides.** Beamer PDFs using `\\transduration{seconds}` automatically advance from the presenter. The resulting slide changes are synchronized to every audience.
- **No native deps.** Pure JavaScript. `pdf.js` does the heavy lifting.

## Install

Run without installing:

```bash
npx pdf-presenter slides.pdf
```

Or install globally:

```bash
npm i -g pdf-presenter
pdf-presenter slides.pdf
```

Requires Node.js ≥ 18.

### Install the Linux desktop app

On Linux, install the desktop launcher and a systemd service for a directory of
PDFs:

```bash
sh scripts/install-linux.sh
```

An optional directory argument can be supplied when you want a specific
collection to appear in the initial listing:

```bash
sh scripts/install-linux.sh /path/to/your/pdf-directory
```

The installer:

- serves the initial directory on HTTP port 80, so the audience view is at
  `http://<hostname>/` and the file browser is at `http://<hostname>/list`;
- installs **PDF Presenter Network** in the application menu;
- opens `/list` in a separate Chrome/Chromium app window using an isolated
  browser profile;
- starts the server automatically through systemd.

Binding port 80 requires administrator permission during installation. The
service itself runs as the installing user and only receives the
`CAP_NET_BIND_SERVICE` capability. The hostname defaults to the computer's
short hostname; set `PDF_PRESENTER_HOST=vh` when installing if needed.

The directory is only the starting point for `/list`. The **Open PDF** button
uses the browser's file picker and can upload a PDF from any location on the
computer; it does not need to be inside that directory.

The listing page includes a web app manifest, so Chrome or Chromium can also
install it directly from the browser's install icon.

### Present to another device on your LAN

The server listens on all network interfaces. Start the presentation on the host computer, then open the audience URL from another device using the host's LAN address:

```text
http://192.168.1.42:3000/
```

Use the printed `localhost` URL for the presenter window on the host. The audience device must be on the same network, and the host firewall must allow inbound TCP connections on the selected port. Audience navigation is presenter-authoritative.

The presenter toolbar provides **Pen**, **Eraser**, and **Laser** tools. Pen strokes are stored in memory per slide for the current session; switching slides clears the visible overlay and restores that slide's strokes when revisited.

For Beamer decks, a page containing `\\transduration{5}` advances after five seconds. Pages without a positive duration remain manual, and freeze/blackout pauses automatic advancement.

## Usage

### Serve a PDF or browse files

```bash
pdf-presenter [file-or-directory] [options]
```

When no file or directory is supplied, the current directory is served. The root URL is the audience view; before a presenter opens a PDF it shows a waiting screen. Use `/list` to browse and open a PDF.

| Flag | Alias | Default | Description |
|------|-------|---------|-------------|
| `--port <n>` | `-p` | `3000` (auto-increments if taken) | Server port |
| `--no-open` | | | Don't auto-open the browser |
| `--presenter` | | `false` | Open directly in presenter mode |
| `--notes <path>` | `-n` | `<file>.notes.json` | Path to notes JSON |
| `--timer <minutes>` | `-t` | none | Countdown timer in minutes |
| `--version` | `-v` | | Print version |
| `--help` | `-h` | | Print help |

On start you'll see:

```
🎯 pdf-presenter v1.0.0

   Audience:   http://localhost:3000
   Presenter:  http://localhost:3000/presenter

   PDF:   slides.pdf
   Notes: slides.notes.json (18/24 slides have notes)
   Timer: 20:00

   Press Ctrl+C to stop.
```

Share the **audience** URL (or window) with your viewers. Keep the **presenter** URL for yourself.

### Generate a notes template

```bash
pdf-presenter -gn slides.pdf
pdf-presenter --generate-presenter-note-template slides.pdf
pdf-presenter -gn slides.pdf --force    # overwrite existing
```

This reads the PDF, extracts the first line of text from each page as a `hint`, and writes `slides.notes.json` next to the PDF:

```json
{
  "meta": {
    "pdf": "slides.pdf",
    "totalSlides": 24,
    "generatedAt": "2026-04-10T12:00:00.000Z",
    "generator": "pdf-presenter"
  },
  "notes": {
    "1": { "hint": "Introduction — Welcome", "note": "" },
    "2": { "hint": "Agenda — Topics for Today", "note": "" }
  }
}
```

- `hint` is auto-extracted and shown in the presenter view when a slide has no `note`.
- `note` is what you write. It appears as the speaker notes in the presenter view.
- Keys are 1-indexed slide numbers.

If `slides.notes.json` already exists, `-gn` aborts with a warning — use `--force` to overwrite.

### Editing notes live

The presenter view doubles as an editor: click into the notes panel and type. Changes are saved back to `slides.notes.json` automatically (debounced ~600 ms after you stop typing). A small status indicator shows `Saving…` / `Saved` / `Save failed` next to the panel title.

- While the notes textarea is focused, keyboard shortcuts (arrow keys, `F`, `B`, `R`) are disabled so typing isn't hijacked. Press **`Esc`** to blur the editor and return to slide navigation.
- If `slides.notes.json` doesn't exist yet, the first save creates it.
- Existing `hint` fields are preserved. The panel title shows the hint for the current slide in a muted style.
- Writes are serialized server-side, so edits from multiple windows can't clobber each other mid-write.

## Keyboard shortcuts

Both views:

| Key | Action |
|-----|--------|
| `→` / `Space` / `PageDown` | Next slide |
| `←` / `PageUp` | Previous slide |
| `Home` / `End` | First / last slide (presenter) |

Audience view only:

| Key | Action |
|-----|--------|
| `P` | Open presenter view in a new window |

Presenter view only:

| Key | Action |
|-----|--------|
| `F` | Freeze / unfreeze the audience view |
| `B` | Black out the audience view |
| `R` | Reset the timer |

## Typical workflow

```bash
# 1. Generate the notes template
pdf-presenter -gn slides.pdf

# 2. Edit slides.notes.json in your editor, fill in "note" fields

# 3. Present
pdf-presenter slides.pdf --timer 20
```

Then:

1. The audience URL opens in your browser — share that window (or drag it to your projector / second display).
2. Open the presenter URL in a second window on your laptop screen.
3. Drive the deck from the presenter window. The audience window follows automatically.

## How it works

- `pdfjs-dist` (Mozilla `pdf.js`) renders each page to a `<canvas>` in the browser, scaled to fit the viewport at device-pixel-ratio resolution.
- The Node CLI ships a minimal `http` server (no Express, no middleware) that serves:
  - `/` → audience HTML
  - `/presenter` → presenter HTML
  - `/slides.pdf` → your PDF, streamed from disk
  - `/notes.json` → the notes file (or an empty stub if missing)
  - `/assets/*` → UI JS/CSS
  - `/assets/pdfjs/*` → the `pdfjs-dist` library and worker
- The presenter and audience connect to a WebSocket attached to the HTTP server. The presenter is authoritative for slide, freeze, blackout, cursor, and annotation events; the server keeps an in-memory snapshot for newly connected audiences.
- Overlay canvases sit above the PDF.js canvas. Coordinates are normalized to the rendered slide, so strokes and the laser pointer remain aligned across different device resolutions.
- Notes text extraction for `-gn` uses the legacy `pdfjs-dist` build, which runs in Node without a DOM or canvas.

## Development

```bash
make install    # pnpm install
make build      # tsup build → dist/
make check      # tsc --noEmit
make run        # build + run against test/fixtures/sample.pdf
make clean      # remove dist/ and node_modules/
```

Project layout:

```
pdf-presenter/
├── bin/pdf-presenter.ts       # CLI entry point
├── src/
│   ├── cli.ts                 # commander setup, command dispatch
│   ├── server.ts              # HTTP server + route map
│   ├── generate-notes.ts      # -gn command
│   ├── utils.ts               # path/port helpers
│   └── ui/                    # static frontend
│       ├── audience.html
│       ├── presenter.html
│       ├── presenter.css
│       └── presenter.js       # pdf.js rendering + WebSocket sync + overlays
└── test/fixtures/             # sample PDF for smoke tests
```

## License

MIT
