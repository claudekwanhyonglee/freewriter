const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { test, expect } = require('@playwright/test');

const root = path.join(__dirname, '..');
const workflow = () => fs.readFileSync(path.join(root, '.github/workflows/build.yml'), 'utf8');

const installerFor = {
  win32: (f) => f.endsWith('.exe'),
  darwin: (f) => f.endsWith('.dmg'),
  linux: (f) => f.endsWith('.AppImage'),
};

test('#6 AC1: npm run dist produces an installer for the current OS @dist', async () => {
  test.setTimeout(15 * 60 * 1000);
  fs.rmSync(path.join(root, 'dist'), { recursive: true, force: true });
  execSync('npm run dist', { cwd: root, stdio: 'inherit' });
  const installers = fs.readdirSync(path.join(root, 'dist')).filter(installerFor[process.platform]);
  expect(installers).toHaveLength(1);
});

test('#6 AC2: the workflow builds on windows, macos and ubuntu runners and uploads installers', () => {
  const yml = workflow();
  for (const os of ['windows-latest', 'macos-latest', 'ubuntu-latest']) expect(yml).toContain(os);
  expect(yml).toContain('runs-on: ${{ matrix.os }}');
  expect(yml).toContain('npm run dist');
  expect(yml).toContain('actions/upload-artifact');
  for (const ext of ['*.exe', '*.dmg', '*.AppImage']) expect(yml).toContain(`dist/${ext}`);
});

test('CI minutes: one run per PR, installers only outside PRs, short-lived artifacts', () => {
  const yml = workflow();
  // Branch pushes are covered by their PR's run; only master pushes run on their own.
  expect(yml).toMatch(/on:\s+push:\s+branches: \[master\]\s+pull_request:/);
  expect(yml).toMatch(/concurrency:[\s\S]*cancel-in-progress: true/);
  const installerSteps = yml.split(/\n\s+- /).filter((step) => /npm run dist|name: freewriter-/.test(step));
  expect(installerSteps).toHaveLength(2);
  for (const step of installerSteps) expect(step).toContain("if: github.event_name != 'pull_request'");
  const uploads = yml.match(/actions\/upload-artifact[\s\S]*?(?=\n\s+- |\n*$)/g);
  for (const upload of uploads) expect(upload).toContain('retention-days: 7');
});

test('#6 AC3: the workflow runs the Playwright tests on every OS', () => {
  const yml = workflow();
  expect(yml).toMatch(/run: xvfb-run -a npm test/);
  expect(yml).toMatch(/if: runner\.os != 'Linux'\s+run: npm test/);
});
