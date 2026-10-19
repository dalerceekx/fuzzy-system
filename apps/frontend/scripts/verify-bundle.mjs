#!/usr/bin/env node
// Fails when a production bundle (dist/) contains development-only code or
// demo credentials. Run after `npm run build`.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'dist');

const markers = new Set([
  'createMockServer', // in-browser mock backend
  'mf-mock-db',
  'Namuna rejimi yoqilgan',
  'Dev SMS inbox',
  '/dev/sms-inbox',
  'Demo akkauntlar',
  'DemoAdmin123',
  'DemoFarmer123',
  'DemoStaff123',
]);

// Demo values configured locally must never be inlined either.
for (const file of ['.env', '.env.local', '.env.development', '.env.development.local']) {
  const path = join(root, file);
  if (!existsSync(path)) continue;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = /^\s*(VITE_DEMO_[A-Z_]+)\s*=\s*(.+?)\s*$/.exec(line);
    if (match?.[2] && match[2].length >= 6) markers.add(match[2].replace(/^['"]|['"]$/g, ''));
  }
}

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else if (/\.(js|mjs|html|css|map)$/.test(name)) yield path;
  }
}

if (!existsSync(dist)) {
  console.error('dist/ topilmadi — avval `npm run build` ni ishga tushiring.');
  process.exit(1);
}

const findings = [];
for (const path of files(dist)) {
  const content = readFileSync(path, 'utf8');
  for (const marker of markers) {
    if (content.includes(marker)) findings.push(`${path.slice(root.length)}: "${marker}"`);
  }
}

if (findings.length > 0) {
  console.error('Production bundle’da faqat development uchun bo‘lgan qiymatlar topildi:');
  for (const finding of findings) console.error(`  - ${finding}`);
  process.exit(1);
}
console.log(`OK: ${markers.size} ta belgi tekshirildi, dist/ toza.`);
