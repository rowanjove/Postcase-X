// Chrome validates the resolved translation, not the __MSG_*__ token.
// Limits: https://developer.chrome.com/docs/extensions/reference/manifest/description
//         https://developer.chrome.com/docs/extensions/reference/manifest/name
function verifyLocalizedManifestText(manifest, locales) {
  const fallback = locales[manifest.default_locale];
  if (!fallback) throw new Error('Manifest default locale is missing');
  const results = [];
  for (const [locale, messages] of Object.entries(locales)) {
    for (const [field, limit] of Object.entries({ name: 75, description: 132 })) {
      const value = manifest[field];
      const key = typeof value === 'string' && value.match(/^__MSG_(.+)__$/)?.[1];
      const text = key ? (messages[key] || fallback[key])?.message : value;
      if (typeof text !== 'string' || !text.trim()) {
        throw new Error(`Locale ${locale}: manifest ${field} is missing`);
      }
      if (text.length > limit) {
        throw new Error(`Locale ${locale}: manifest ${field} is ${text.length} characters; maximum ${limit}`);
      }
      results.push({ locale, field, length: text.length, limit });
    }
  }
  return results;
}

module.exports = { verifyLocalizedManifestText };
