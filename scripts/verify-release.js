const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const JSZip = require('../jszip.min.js');
const { verifyLocalizedManifestText } = require('./manifest-text');

const projectRoot = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(projectRoot, 'manifest.json'), 'utf8'));
const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
const releaseEntries = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'release-files.json'), 'utf8')
);

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function collectFiles(directory, baseDirectory = directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectFiles(absolutePath, baseDirectory));
    else files.push({
      absolutePath,
      relativePath: path.relative(baseDirectory, absolutePath).replaceAll(path.sep, '/'),
    });
  }
  return files;
}

function collectReleaseSourceFiles() {
  return releaseEntries.flatMap((entry) => {
    const absolutePath = path.join(projectRoot, entry);
    if (fs.statSync(absolutePath).isDirectory()) return collectFiles(absolutePath, projectRoot);
    return [{
      absolutePath,
      relativePath: path.relative(projectRoot, absolutePath).replaceAll(path.sep, '/'),
    }];
  });
}

function verifySourceMetadata() {
  const localeRoot = path.join(projectRoot, '_locales');
  const locales = Object.fromEntries(fs.readdirSync(localeRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => [entry.name, JSON.parse(fs.readFileSync(
      path.join(localeRoot, entry.name, 'messages.json'), 'utf8'
    ))]));
  verifyLocalizedManifestText(manifest, locales);
  if (!/^\d+(?:\.\d+){0,3}$/.test(manifest.version)) {
    throw new Error(`Manifest version is not Chrome-compatible: ${manifest.version}`);
  }
  if (manifest.version !== packageJson.version) {
    throw new Error(`Version mismatch: manifest=${manifest.version}, package=${packageJson.version}`);
  }
  const changelog = fs.readFileSync(path.join(projectRoot, 'CHANGELOG.md'), 'utf8');
  const escapedVersion = manifest.version.replaceAll('.', '\\.');
  const heading = new RegExp(
    `^## v${escapedVersion}(?: \\((?:Unreleased|\\d{4}-\\d{2}-\\d{2})\\))?\\s*$`,
    'm'
  );
  if (!heading.test(changelog)) {
    throw new Error(`CHANGELOG.md has no v${manifest.version} section`);
  }
  if (!Array.isArray(releaseEntries) || !releaseEntries.length) {
    throw new Error('Release whitelist is empty');
  }
  if (new Set(releaseEntries).size !== releaseEntries.length) {
    throw new Error('Release whitelist contains duplicate entries');
  }
  for (const entry of releaseEntries) {
    if (!fs.existsSync(path.join(projectRoot, entry))) {
      throw new Error(`Missing release entry: ${entry}`);
    }
  }
  return { manifest, packageJson, releaseEntries };
}

async function verifyArtifact(outputRoot) {
  const releaseName = `x-markdown-exporter-v${manifest.version}`;
  const releaseDir = path.join(outputRoot, releaseName);
  const zipPath = path.join(outputRoot, `${releaseName}.zip`);
  const hashPath = `${zipPath}.sha256`;
  for (const target of [releaseDir, zipPath, hashPath]) {
    if (!fs.existsSync(target)) throw new Error(`Missing release artifact: ${target}`);
  }

  const archiveBuffer = fs.readFileSync(zipPath);
  const expectedHash = sha256(archiveBuffer);
  const hashLine = fs.readFileSync(hashPath, 'utf8').trim();
  const [recordedHash, recordedName] = hashLine.split(/\s+/, 2);
  if (recordedHash !== expectedHash || recordedName !== path.basename(zipPath)) {
    throw new Error('SHA-256 sidecar does not match the ZIP artifact');
  }

  const sourceFiles = collectReleaseSourceFiles();
  const expectedPaths = sourceFiles.map((file) => file.relativePath).sort();
  const stagedPaths = collectFiles(releaseDir).map((file) => file.relativePath).sort();
  if (JSON.stringify(stagedPaths) !== JSON.stringify(expectedPaths)) {
    throw new Error('Release directory contents differ from the source whitelist');
  }
  const zip = await JSZip.loadAsync(archiveBuffer);
  const actualPaths = Object.values(zip.files)
    .filter((entry) => !entry.dir)
    .map((entry) => entry.name)
    .sort();
  if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) {
    throw new Error('ZIP contents differ from the source whitelist');
  }

  for (const file of sourceFiles) {
    const archived = await zip.file(file.relativePath).async('nodebuffer');
    const source = fs.readFileSync(file.absolutePath);
    const staged = fs.readFileSync(path.join(releaseDir, file.relativePath));
    if (!staged.equals(source)) throw new Error(`Release byte mismatch: ${file.relativePath}`);
    if (!archived.equals(source)) throw new Error(`ZIP byte mismatch: ${file.relativePath}`);
  }
  if (actualPaths.some((name) =>
    name.startsWith('tests/') || name.startsWith('.github/') || name.startsWith('node_modules/'))
  ) {
    throw new Error('ZIP contains development-only files');
  }

  console.log(`Verified ${releaseName}: ${actualPaths.length} files, sha256=${expectedHash}`);
}

async function main() {
  verifySourceMetadata();
  const args = process.argv.slice(2);
  const artifactIndex = args.indexOf('--artifact-dir');
  if (artifactIndex >= 0) {
    const value = args[artifactIndex + 1];
    if (!value || value.startsWith('--')) throw new Error('--artifact-dir requires a path');
    await verifyArtifact(path.resolve(value));
  } else {
    console.log(`Verified release metadata for v${manifest.version}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
