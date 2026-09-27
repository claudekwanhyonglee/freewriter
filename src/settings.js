const fs = require('fs');
const path = require('path');

/** A small JSON settings file; a missing or corrupt file just means defaults. */
function settingsStore(dir) {
  const file = path.join(dir, 'settings.json');
  let settings = {};
  try {
    settings = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {}

  return {
    get: (key) => settings[key],
    set(key, value) {
      settings = { ...settings, [key]: value };
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(settings, null, 2));
    },
  };
}

module.exports = { settingsStore };
