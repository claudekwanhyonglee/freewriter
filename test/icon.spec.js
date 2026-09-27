const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const root = path.join(__dirname, '..');

// SHA-256 of each file in the logo pack's export/ folder (Freewriter_Logo_Concepts_1.zip).
const LOGO_PACK = {
  'build/icon.icns': '2b193fe48557c7aef62d7e68481a66bb16ce41a13ea6633d799b2031a349b027',
  'build/icon.ico': '6b0b228f5f4b6d8bdbf097f049cb5707bd533650cca0947175522efa36175f5d',
  'build/icon.png': '18d14be5c432c6a6b0387e32c09458aa041daf34c9f395007d98b3474b466a04',
  'build/icons/16x16.png': 'd1dd052bcfc1285dc615f78dbae03fd77475a322ed57a53cd9952b1f1d763982',
  'build/icons/24x24.png': '37cef0561b4f597b483f26de637629db9972dd94e09e3b58cfb17faf852b3b89',
  'build/icons/32x32.png': '32048a522480cee38f3d7a556abb6c0d7c0565a2a591f9676aa588ecee3e2d38',
  'build/icons/48x48.png': 'c8deb490c8f9d1125659a6b362cf8272a83aa7a9940bdf179aa5ff3b1552bd06',
  'build/icons/64x64.png': 'ba547ccf8536286563b583fa7e79b495bc308745c90db1a8d2573df7d8b4cddd',
  'build/icons/128x128.png': '78165e5e6e9e268671073aec35aec59d9af5553722ea662c921cbdcbc81b5928',
  'build/icons/256x256.png': 'b6ff1ce8347ae4eaf08560a8c58cca143de1b15abfb2cb7414b9f495d421d98d',
  'build/icons/512x512.png': '57fb38b4a3b001fa63243fe842713d8f8e10e42a25b66d13bf3f2fe7498fff0d',
  'src/icon.png': '57fb38b4a3b001fa63243fe842713d8f8e10e42a25b66d13bf3f2fe7498fff0d',
};

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex');

test('#39 AC1: the icon files are byte-identical to the logo pack', () => {
  for (const [file, hash] of Object.entries(LOGO_PACK)) expect(sha256(file), file).toBe(hash);
});

test('#39 AC2: the build config points each OS at its icon', () => {
  const { build } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  expect(build.mac.icon).toBe('build/icon.icns');
  expect(build.win.icon).toBe('build/icon.ico');
  expect(build.linux.icon).toBe('build/icons');
});

// BrowserWindow can't report its icon back, so this reads createWindow()'s options.
test('#39 AC3: the window is created with src/icon.png as its icon (source check)', () => {
  const main = fs.readFileSync(path.join(root, 'src/main.js'), 'utf8');
  const createWindow = main.match(/function createWindow\(\) \{[\s\S]*?new BrowserWindow\(\{([\s\S]*?)\}\);/)[1];
  expect(createWindow).toContain("icon: path.join(__dirname, 'icon.png')");
});
