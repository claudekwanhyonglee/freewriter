<p align="center"><img src="build/icons/128x128.png" width="96" alt=""></p>

<h1 align="center">Freewriter</h1>

<p align="center">A calm, distraction-free desktop app for freewriting.</p>

Open it and write. There's no menu bar, no toolbar and nothing to save: each session is saved automatically as a plain Markdown file in `~/Documents/Freewriter`, so your writing is always yours, in a format any editor can open.

## Download

Get the latest installer from [Releases](https://github.com/claudekwanhyonglee/freewriter/releases/latest):

- **Windows:** the `.exe` installer
- **macOS (Apple silicon):** the `arm64.dmg`
- **Linux:** the `.AppImage` (make it executable with `chmod +x`, then run it)

The installers aren't code-signed, so your OS warns you the first time. On Windows, click *More info* → *Run anyway*. On macOS, right-click the app → *Open* → *Open*.

## Writing

- **Live Markdown.** Type `# ` for a heading, `- ` for a list, `[ ] ` for a checklist, `**bold**` and so on; it turns into formatting as you type.
- **`/` menu.** Type `/` at the start of a line to insert a table, heading, list, checklist, quote, divider or code block.
- **A gentle start.** A blank page suggests *Today I ...*; press Tab to begin from there.
- **Out of the way.** The cursor, controls and scrollbar hide while you type and come back when you move the mouse.
- **Sessions.** Browse, search and delete past sessions in the sidebar. Search finds partial words and forgives typos.
- **Your look.** Six bundled fonts, adjustable text size, and light and dark themes.

## Shortcuts

Cmd instead of Ctrl on macOS.

| | |
|---|---|
| Ctrl+O | Sessions sidebar |
| Ctrl+N | New session |
| Ctrl+= / Ctrl+- / Ctrl+0 | Text bigger / smaller / reset (or Ctrl+scroll) |
| F11 (Ctrl+Cmd+F on macOS) | Fullscreen; Esc to leave |
| Ctrl+click | Open a link in your browser |

## Development

Needs Node.js 24.

```sh
npm ci
npm start          # run the app
npm test           # Playwright tests (on Linux without a display: xvfb-run -a npm test)
npm run dist       # build an installer for the current OS into dist/
```

Set `FREEWRITER_DIR` to keep sessions somewhere other than `~/Documents/Freewriter`.

## License

[MIT](LICENSE)
