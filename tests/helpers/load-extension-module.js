const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const projectRoot = path.resolve(__dirname, '..', '..');

function createBaseContext(overrides = {}) {
  const document = overrides.document || {
    title: '',
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  const window = overrides.window || {
    _XPD: {},
    location: { href: 'https://x.com/home' },
  };

  const context = {
    window,
    document,
    URL,
    console,
    Error,
    Set,
    Array,
    String,
    Boolean,
    Blob,
    Element: overrides.Element || class Element {},
    Node: overrides.Node || { TEXT_NODE: 3, ELEMENT_NODE: 1 },
    ...overrides.globals,
  };
  vm.createContext(context);
  return context;
}

function loadScript(context, filename) {
  const source = fs.readFileSync(path.join(projectRoot, filename), 'utf8');
  vm.runInContext(source, context, { filename });
  return context;
}

module.exports = { createBaseContext, loadScript, projectRoot };
