const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { projectRoot } = require('./helpers/load-extension-module');
const { verifyLocalizedManifestText } = require('../scripts/manifest-text');

test('store text limits apply to each resolved locale with default fallback', () => {
  const manifest = { default_locale: 'en', name: '__MSG_title__', description: '__MSG_description__' };
  const locales = { en: { title: { message: 'n'.repeat(75) }, description: { message: 'd'.repeat(132) } }, zh_CN: {} };
  assert.doesNotThrow(() => verifyLocalizedManifestText(manifest, locales));
  locales.zh_CN.description = { message: '字'.repeat(133) };
  assert.throws(() => verifyLocalizedManifestText(manifest, locales), /Locale zh_CN: manifest description is 133 characters; maximum 132/);
  locales.zh_CN.description.message = '字'.repeat(132);
  locales.en.title.message += 'n';
  assert.throws(() => verifyLocalizedManifestText(manifest, locales), /manifest name is 76 characters; maximum 75/);
});

test('every shipped locale fits the Chrome Web Store manifest text limits', () => {
  const manifest = require('../manifest.json');
  const locales = Object.fromEntries(fs.readdirSync(path.join(projectRoot, '_locales')).map((locale) => [
    locale, JSON.parse(fs.readFileSync(path.join(projectRoot, '_locales', locale, 'messages.json'), 'utf8')),
  ]));
  assert.doesNotThrow(() => verifyLocalizedManifestText(manifest, locales));
});

test('manifest and package versions stay synchronized', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(projectRoot, 'manifest.json'), 'utf8'));
  const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));

  assert.equal(manifest.version, packageJson.version);
});

test('manifest localization resources are complete and valid', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(projectRoot, 'manifest.json'), 'utf8'));
  assert.equal(manifest.default_locale, 'en');
  assert.equal(manifest.name, '__MSG_extension_name__');
  assert.equal(manifest.description, '__MSG_extension_description__');

  const localeNames = ['en', 'zh_CN'];
  const localeMessages = localeNames.map((locale) => JSON.parse(
    fs.readFileSync(path.join(projectRoot, '_locales', locale, 'messages.json'), 'utf8')
  ));
  const expectedKeys = Object.keys(localeMessages[0]).sort();
  assert.ok(expectedKeys.length > 0);
  for (const messages of localeMessages) {
    assert.deepEqual(Object.keys(messages).sort(), expectedKeys);
    for (const [key, value] of Object.entries(messages)) {
      assert.equal(typeof value.message, 'string', `${key} must contain a message`);
      assert.notEqual(value.message.trim(), '', `${key} must not be empty`);
    }
  }
});

test('runtime localization keys exist in the default locale', () => {
  const messages = JSON.parse(
    fs.readFileSync(path.join(projectRoot, '_locales', 'en', 'messages.json'), 'utf8')
  );
  const sources = [
    'content-core.js',
    'content-export.js',
    'content-ui.js',
    'content.js',
    'popup.js',
    'popup.html',
  ];
  const referencedKeys = new Set();

  for (const source of sources) {
    const text = fs.readFileSync(path.join(projectRoot, source), 'utf8');
    for (const match of text.matchAll(/\bt\(['"]([a-z0-9_]+)['"]/g)) {
      referencedKeys.add(match[1]);
    }
    for (const match of text.matchAll(/data-i18n(?:-[a-z-]+)?=["']([a-z0-9_]+)["']/g)) {
      referencedKeys.add(match[1]);
    }
  }

  for (const key of referencedKeys) {
    assert.ok(messages[key], `Missing default locale message: ${key}`);
  }
});

test('runtime export pipeline contains no legacy image placeholder markers', () => {
  for (const source of ['content-core.js', 'content-export.js', 'content.js']) {
    const text = fs.readFileSync(path.join(projectRoot, source), 'utf8');
    assert.equal(text.includes('__IMG_'), false, `${source} still contains image markers`);
  }
});

test('X DOM selector literals stay in the versioned adapter', () => {
  for (const source of ['content-core.js', 'content-ui.js', 'content.js']) {
    const text = fs.readFileSync(path.join(projectRoot, source), 'utf8');
    assert.equal(
      text.includes('[data-testid'),
      false,
      `${source} bypasses content-selectors.js`
    );
  }
});

test('manifest keeps the reviewed minimum permission set', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(projectRoot, 'manifest.json'), 'utf8'));

  assert.deepEqual(manifest.permissions, ['storage']);
  assert.deepEqual(manifest.host_permissions, [
    'https://x.com/*',
    'https://twitter.com/*',
    'https://pbs.twimg.com/*',
  ]);
});

test('all manifest runtime files exist', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(projectRoot, 'manifest.json'), 'utf8'));
  const files = [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...manifest.content_scripts.flatMap((entry) => [...entry.js, ...entry.css]),
  ];

  for (const file of files) {
    assert.equal(fs.existsSync(path.join(projectRoot, file)), true, `Missing ${file}`);
  }
});
