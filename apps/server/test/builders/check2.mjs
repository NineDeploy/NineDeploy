import { readFileSync } from 'node:fs';
const s = readFileSync('D:/Codebox/PROJECTS/NineDeploy/apps/server/test/builders/docker.test.ts', 'utf8');
const matches = [];
let i = -1;
while ((i = s.indexOf("healthPath: '/health'", i + 1)) >= 0) {
  matches.push({ idx: i, next: s.slice(i, i + 80) });
}
console.log(matches);
