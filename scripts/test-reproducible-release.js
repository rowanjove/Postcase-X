const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(projectRoot, 'manifest.json'), 'utf8'));
const releaseName = `x-markdown-exporter-v${manifest.version}`;
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xpd-reproducible-'));
const builds = [
  { output: path.join(tempRoot, 'utc'), timeZone: 'UTC' },
  { output: path.join(tempRoot, 'hong-kong'), timeZone: 'Asia/Hong_Kong' },
];

try {
  for (const { output, timeZone } of builds) {
    execFileSync(process.execPath, [
      path.join(__dirname, 'package-release.js'),
      '--output-dir',
      output,
    ], {
      cwd: projectRoot,
      stdio: 'pipe',
      env: { ...process.env, TZ: timeZone },
    });
  }

  const archives = builds.map(({ output }) =>
    fs.readFileSync(path.join(output, `${releaseName}.zip`))
  );
  const hashes = builds.map(({ output }) =>
    fs.readFileSync(path.join(output, `${releaseName}.zip.sha256`), 'utf8').trim()
  );
  if (!archives[0].equals(archives[1]) || hashes[0] !== hashes[1]) {
    throw new Error('Release archives are not reproducible');
  }
  console.log(`Verified reproducible release: ${hashes[0]}`);
} finally {
  const resolvedTemp = fs.realpathSync(os.tmpdir());
  const resolvedRoot = fs.realpathSync(tempRoot);
  if (path.dirname(resolvedRoot) !== resolvedTemp || !path.basename(resolvedRoot).startsWith('xpd-reproducible-')) {
    throw new Error(`Refusing to remove unexpected temporary path: ${resolvedRoot}`);
  }
  fs.rmSync(resolvedRoot, { recursive: true, force: true });
}
