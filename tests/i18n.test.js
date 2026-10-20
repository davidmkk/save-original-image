import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const dir = new URL('../_locales/', import.meta.url);
const load = (lang) => JSON.parse(readFileSync(new URL(`${lang}/messages.json`, dir), 'utf8'));
const en = load('en');
const slots = (s) => (s.match(/\{\d\}/g) || []).sort().join();

for (const lang of readdirSync(dir)) {
  test(`locale ${lang}: same keys and {n} slots as English`, () => {
    const m = load(lang);
    assert.deepEqual(Object.keys(m).sort(), Object.keys(en).sort());
    for (const k of Object.keys(en)) {
      assert.equal(slots(m[k].message), slots(en[k].message), `${lang}.${k}`);
      assert.ok(!m[k].message.includes('$'), `${lang}.${k} must not contain "$" (Chrome treats it as a placeholder)`);
    }
    assert.ok(m.extName.message.length <= 45, 'name: 45 characters max');
    assert.ok(m.extDesc.message.length <= 132, 'description: 132 characters max');
  });
}

test('every data-i18n key used in the pages exists', () => {
  for (const page of ['options.html', 'ask.html']) {
    const html = readFileSync(new URL(`../${page}`, import.meta.url), 'utf8');
    for (const [, key] of html.matchAll(/data-i18n(?:-placeholder)?="([^"]+)"/g)) assert.ok(en[key], `${page}: ${key}`);
  }
});
