import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseWranglerJson} from './wrangler-json.mjs';
const result=[{results:[{created:1}],success:true}];
test('reads normal Wrangler JSON',()=>assert.deepEqual(parseWranglerJson(JSON.stringify(result)),result));
test('reads remote upload progress followed by JSON',()=>assert.deepEqual(parseWranglerJson('├ Checking if file needs uploading\n│ Uploading\n'+JSON.stringify(result,null,2)),result));
test('rejects malformed or missing result without disclosing output',()=>{
  for(const output of ['private details','progress\n[\ninvalid secret','progress\n'+JSON.stringify(result,null,2)+'\ntrailing error']) {
    assert.throws(()=>parseWranglerJson(output),{message:'Wrangler did not return valid JSON; database operation may have completed.'});
  }
});
