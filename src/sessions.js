const fs = require('fs');
const path = require('path');

const SAVE_DELAY_MS = 300;

const pad = (n) => String(n).padStart(2, '0');

function sessionFileName(date) {
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
  return `${day} ${time}.md`;
}

function sessionsDir(documentsDir) {
  return process.env.FREEWRITER_DIR || path.join(documentsDir, 'Freewriter');
}

function newSessionPath(dir, now = new Date()) {
  fs.mkdirSync(dir, { recursive: true });
  const date = new Date(now);
  // Two sessions started in the same second must not share a file.
  while (fs.existsSync(path.join(dir, sessionFileName(date)))) date.setSeconds(date.getSeconds() + 1);
  return path.join(dir, sessionFileName(date));
}

/** The session being written: gets a file on its first non-blank text, then saves with a short debounce. */
class Session {
  constructor(dir, file = null) {
    this.dir = dir;
    this.file = file;
    this.text = null;
    this.timer = null;
  }

  update(text) {
    this.text = text;
    if (!this.file && !text.trim()) return;
    if (!this.file) this.file = newSessionPath(this.dir);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), SAVE_DELAY_MS);
  }

  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    if (this.file && this.text !== null) fs.writeFileSync(this.file, this.text);
  }
}

const SESSION_NAME = /^(\d{4}-\d{2}-\d{2}) (\d{2})-(\d{2})-\d{2}\.md$/;

function sessionLabel(name) {
  const m = name.match(SESSION_NAME);
  return m ? `${m[1]} ${m[2]}:${m[3]}` : name.replace(/\.md$/, '');
}

const firstLine = (text) => text.split('\n').map((line) => line.trim()).find(Boolean) ?? '';

// ponytail: reads every file on each open; fine for years of daily sessions, cache first lines if it ever lags.
function listSessions(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .sort()
    .reverse()
    .map((name) => ({
      name,
      label: sessionLabel(name),
      firstLine: firstLine(fs.readFileSync(path.join(dir, name), 'utf8')),
    }));
}

/** Resolves a session name from the renderer to a file in dir, refusing anything outside it. */
function sessionPath(dir, name) {
  if (path.basename(name) !== name || !name.endsWith('.md')) throw new Error(`Not a session: ${name}`);
  return path.join(dir, name);
}

module.exports = { Session, sessionsDir, sessionFileName, listSessions, sessionPath };
