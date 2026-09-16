import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';

test('remote admin executes SQL as query and checks returned row before disclosing code',()=>{
  const dir=mkdtempSync(join(tmpdir(),'groblus-admin-test-'));
  try {
    const capture=join(dir,'args.json');
    writeFileSync(join(dir,'npx'),`#!/usr/bin/env node\nrequire('node:fs').writeFileSync(process.env.ADMIN_TEST_CAPTURE,JSON.stringify(process.argv.slice(2)));\nconsole.log(JSON.stringify([{results:[{created:1}],success:true}]));\n`,{mode:0o700});
    const result=spawnSync(process.execPath,[fileURLToPath(new URL('./admin.mjs',import.meta.url)),'invite','1','--remote','--config',join(dir,'wrangler.json')],{encoding:'utf8',env:{...process.env,PATH:dir+':'+process.env.PATH,ADMIN_TEST_CAPTURE:capture}});
    assert.equal(result.status,0,result.stderr);
    const args=JSON.parse(readFileSync(capture,'utf8'));
    assert.ok(args.includes('--command'));
    assert.ok(!args.includes('--file'));
    const code=result.stdout.match(/privately\): ([a-f0-9]+)/)[1];
    const sql=args[args.indexOf('--command')+1];
    assert.ok(!sql.includes(code));
    assert.ok(sql.includes(createHash('sha256').update(code).digest('hex')));
  } finally {rmSync(dir,{recursive:true,force:true})}
});

// Removed password recovery must fail before any database command runs.
test('admin refuses legacy password recovery',()=>{
  const result=spawnSync(process.execPath,[fileURLToPath(new URL('./admin.mjs',import.meta.url)),'recover','member@example.invalid'],{encoding:'utf8'});
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/Discord invitations only/);
});
