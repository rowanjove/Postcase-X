const fs = require('node:fs');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const JSZip = require('../jszip.min.js');

const projectRoot = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(projectRoot, 'manifest.json'), 'utf8'));
const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
const releaseEntries = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'release-files.json'), 'utf8')
);
// JSZip serializes UTC date fields, so construct the fixed date in UTC to keep
// archive bytes stable across machine time zones.
const FIXED_ZIP_DATE = new Date(Date.UTC(2000, 0, 1, 0, 0, 0, 0));

execFileSync(process.execPath, [path.join(__dirname, 'verify-release.js')], {
  cwd: projectRoot,
  stdio: 'inherit',
});

if (manifest.version !== packageJson.version) {
  throw new Error(
    `Version mismatch: manifest=${manifest.version}, package=${packageJson.version}`
  );
}

const args = process.argv.slice(2);
const outputIndex = args.indexOf('--output-dir');
const outputValue = outputIndex >= 0 ? args[outputIndex + 1] : null;
if (outputIndex >= 0 && (!outputValue || outputValue.startsWith('--'))) {
  throw new Error('--output-dir requires a path');
}
const outputRoot = outputValue ? path.resolve(outputValue) : path.join(projectRoot, 'dist');
const force = args.includes('--force');
const releaseName = `x-markdown-exporter-v${manifest.version}`;
const releaseDir = path.join(outputRoot, releaseName);
const zipPath = path.join(outputRoot, `${releaseName}.zip`);
const hashPath = `${zipPath}.sha256`;

for (const target of [releaseDir, zipPath, hashPath]) {
  if (fs.existsSync(target) && !force) {
    throw new Error(`Refusing to overwrite existing release target: ${target}`);
  }
}

if (force) {
  fs.rmSync(releaseDir, { recursive: true, force: true });
  fs.rmSync(zipPath, { force: true });
  fs.rmSync(hashPath, { force: true });
}

fs.mkdirSync(releaseDir, { recursive: true });
for (const entry of releaseEntries) {
  const source = path.join(projectRoot, entry);
  if (!fs.existsSync(source)) throw new Error(`Missing release entry: ${entry}`);
  fs.cpSync(source, path.join(releaseDir, entry), { recursive: true });
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

async function buildZip() {
  const zip = new JSZip();
  for (const file of collectFiles(releaseDir)) {
    zip.file(file.relativePath, fs.readFileSync(file.absolutePath), {
      createFolders: false,
      date: FIXED_ZIP_DATE,
    });
  }
  const archive = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  });
  fs.mkdirSync(outputRoot, { recursive: true });
  fs.writeFileSync(zipPath, archive);
  const hash = crypto.createHash('sha256').update(archive).digest('hex');
  fs.writeFileSync(hashPath, `${hash}  ${path.basename(zipPath)}\n`, 'utf8');
  execFileSync(process.execPath, [
    path.join(__dirname, 'verify-release.js'),
    '--artifact-dir',
    outputRoot,
  ], { cwd: projectRoot, stdio: 'inherit' });
  console.log(`Packaged ${releaseName}`);
  console.log(releaseDir);
  console.log(zipPath);
  console.log(hashPath);
}

buildZip().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
