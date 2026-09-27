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

module.exports = { Session, sessionsDir, sessionFileName };
