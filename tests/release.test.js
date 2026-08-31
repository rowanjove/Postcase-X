const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const assert = require('node:assert/strict');

const JSZip = require('../jszip.min.js');
const { projectRoot } = require('./helpers/load-extension-module');
const releaseEntries = require('../scripts/release-files.json');
const manifest = require('../manifest.json');

function createArtifactFixture(t, copySources = true) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xpd-release-test-'));
  const releaseName = `x-markdown-exporter-v${manifest.version}`;
  const releaseDir = path.join(root, releaseName);
  const zipPath = path.join(root, `${releaseName}.zip`);
  fs.mkdirSync(releaseDir);
  t.after(() => {
    const resolvedRoot = fs.realpathSync(root);
    if (path.dirname(resolvedRoot) !== fs.realpathSync(os.tmpdir()) ||
        !path.basename(resolvedRoot).startsWith('xpd-release-test-')) {
      throw new Error(`Refusing to remove unexpected test directory: ${resolvedRoot}`);
    }
    fs.rmSync(resolvedRoot, { recursive: true, force: true });
  });
  if (copySources) {
    for (const entry of releaseEntries) {
      fs.cpSync(path.join(projectRoot, entry), path.join(releaseDir, entry), { recursive: true });
    }
  }
  return { root, releaseDir, zipPath };
}

async function writeArchive(fixture, editZip) {
  const zip = new JSZip();
  function addDirectory(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) addDirectory(absolutePath);
      else zip.file(
        path.relative(fixture.releaseDir, absolutePath).replaceAll(path.sep, '/'),
        fs.readFileSync(absolutePath),
        { createFolders: false }
      );
    }
  }
  addDirectory(fixture.releaseDir);
  editZip?.(zip);
  const archive = await zip.generateAsync({ type: 'nodebuffer' });
  fs.writeFileSync(fixture.zipPath, archive);
  const hash = crypto.createHash('sha256').update(archive).digest('hex');
  fs.writeFileSync(`${fixture.zipPath}.sha256`, `${hash}  ${path.basename(fixture.zipPath)}\n`);
}

function verifyArtifact(fixture) {
  return spawnSync(process.execPath, [
    path.join(projectRoot, 'scripts', 'verify-release.js'), '--artifact-dir', fixture.root,
  ], { cwd: projectRoot, encoding: 'utf8' });
}

test('release verifier accepts an artifact matching the current source whitelist', async (t) => {
  const fixture = createArtifactFixture(t);
  await writeArchive(fixture);
  const result = verifyArtifact(fixture);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Verified x-markdown-exporter/);
});

test('release verifier rejects a self-consistent archive with no extension files', async (t) => {
  const fixture = createArtifactFixture(t, false);
  fs.writeFileSync(path.join(fixture.releaseDir, 'unrelated.txt'), 'not an extension');
  await writeArchive(fixture);
  const result = verifyArtifact(fixture);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Release directory contents differ from the source whitelist/);
});

test('release verifier rejects stale content even when ZIP, directory, and checksum agree', async (t) => {
  const fixture = createArtifactFixture(t);
  fs.appendFileSync(path.join(fixture.releaseDir, 'background.js'), '\n// Altered release fixture\n');
  await writeArchive(fixture);
  const result = verifyArtifact(fixture);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Release byte mismatch: background.js/);
});

test('release verifier compares archive bytes with source after a valid checksum', async (t) => {
  const fixture = createArtifactFixture(t);
  await writeArchive(fixture, (zip) => zip.file('background.js', '// Altered ZIP fixture'));
  const result = verifyArtifact(fixture);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /ZIP byte mismatch: background.js/);
});
