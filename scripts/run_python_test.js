const { spawnSync } = require('child_process');
const path = require('path');
const script = path.join(process.cwd(),'python','chroma_store.py');
const res = spawnSync('python', [script, '--action', 'count'], { encoding: 'utf8', cwd: process.cwd() });
console.log('STATUS', res.status);
console.log('STDOUT', String(res.stdout).slice(0,2000));
console.log('STDERR', String(res.stderr).slice(0,2000));
