import { readFileSync, writeFileSync } from 'node:fs';
const f = 'D:/Codebox/PROJECTS/NineDeploy/apps/server/test/builders/docker.test.ts';
let s = readFileSync(f, 'utf8');
// Mojibake the file's editor introduced: 'â†'' (UTF-8 bytes for the right-arrow).
// Replace with the proper '→' character.
const before = s;
s = s.replace(/â†’/g, '→');
if (s === before) { console.error('NO CHANGE'); process.exit(1); }
writeFileSync(f, s);
console.log('OK');
