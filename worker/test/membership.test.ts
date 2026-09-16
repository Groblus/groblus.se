import { beforeAll, it, expect } from 'vitest';
import { env } from 'cloudflare:workers';
import worker from '../src/index';
import { accessBindings, accessToken, setupAccess } from './access-fixture';
import { membershipYear } from '../src/membership';
beforeAll(setupAccess);
const origin = 'http://localhost:8787';
async function call(email: string, path: string, data?: unknown, requestOrigin = origin) {
  return worker.fetch(new Request(origin + '/api' + path, { method: data ? 'POST' : 'GET', headers: { Origin: requestOrigin, 'Content-Type': 'application/json', 'Cf-Access-Jwt-Assertion': await accessToken(email) }, body: data ? JSON.stringify(data) : undefined }), {...env, ...accessBindings, ADMIN_EMAILS: 'admin@example.se, second@example.se'});
}
it('restricts every admin route to configured verified identities and checks origin', async () => {
  for (const path of ['/admin/members', '/admin/members/preview', '/admin/members/import']) {
    expect((await call('member@example.se', path, path.endsWith('members') ? undefined : {emails:'member@example.se',year:2026})).status).toBe(403);
  }
  expect((await call('second@example.se', '/admin/members')).status).toBe(200);
  expect((await call('admin@example.se', '/admin/members/import', {emails:'a@example.se',year:2026}, 'https://evil.example')).status).toBe(403);
});
it('previews without writes, rejects invalid imports, normalizes and preserves links and later years', async () => {
  const input = {emails:' MEMBER@EXAMPLE.SE\nmember@example.se\nbad',year:2026};
  expect(await (await call('admin@example.se','/admin/members/preview',input)).json()).toMatchObject({emails:['member@example.se'], invalid:['bad'], duplicates:1});
  expect((await env.DB.prepare('SELECT * FROM memberships').all()).results).toHaveLength(0);
  expect((await call('admin@example.se','/admin/members/import',input)).status).toBe(400);
  await env.DB.prepare("INSERT INTO users(id,email,display_name,discord_id,created_at) VALUES('m','member@example.se','Member','123','test')").run();
  for (const year of [membershipYear()+1, 2026]) expect((await call('admin@example.se','/admin/members/import',{emails:'MEMBER@example.se',year})).status).toBe(200);
  expect(await env.DB.prepare("SELECT paid_through_year FROM memberships WHERE email='member@example.se'").first()).toEqual({paid_through_year:membershipYear()+1});
  expect(await env.DB.prepare("SELECT discord_id FROM users WHERE id='m'").first()).toEqual({discord_id:'123'});
});
it('enforces paid status on every request despite an existing valid Access login', async () => {
  expect((await call('member@example.se','/games')).status).toBe(403);
  expect((await call('member@example.se','/discord/link-code',{})).status).toBe(403);
  await call('admin@example.se','/admin/members/import',{emails:'member@example.se',year:membershipYear()});
  expect((await call('member@example.se','/games')).status).toBe(200);
  await env.DB.prepare('UPDATE memberships SET paid_through_year=?').bind(membershipYear()-1).run();
  expect((await call('member@example.se','/games')).status).toBe(403);
  expect((await call('admin@example.se','/games')).status).toBe(403);
});
