"use strict";
const $ = s => document.querySelector(s);
let pending = null;
async function api(path, data) {
  const response = await fetch('/api/admin/members' + path, { method: data ? 'POST' : 'GET', redirect: 'manual', headers: data ? {'Content-Type':'application/json'} : {}, body: data ? JSON.stringify(data) : undefined });
  if (response.status === 401 || response.type === 'opaqueredirect' || response.headers.get('content-type')?.includes('text/html')) throw new Error('Logga in igen via Spelhyllan.');
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Kunde inte läsa medlemslistan.');
  return result;
}
function invalidate() { pending = null; $('#preview').hidden = true; }
$('#import').addEventListener('input', invalidate);
$('#import').addEventListener('submit', async event => {
  event.preventDefault(); invalidate();
  const input = { emails: $('#emails').value, year: Number($('#year').value) };
  try {
    const result = await api('/preview', input);
    if (input.emails !== $('#emails').value || input.year !== Number($('#year').value)) return;
    pending = input;
    $('#addresses').replaceChildren(...[...result.emails, ...result.invalid.map(email => 'Ogiltig: ' + email)].map(email => { const li = document.createElement('li'); li.textContent = email; return li; }));
    $('#summary').textContent = `${result.emails.length} adresser för ${result.year}. ${result.duplicates} dubbletter borttagna. ${result.invalid.length} ogiltiga adresser.`;
    $('#save').disabled = result.invalid.length > 0;
    $('#preview').hidden = false;
  } catch (error) { $('#message').textContent = error.message; }
});
$('#save').addEventListener('click', async () => {
  if (!pending) return;
  $('#save').disabled = true;
  try {
    const result = await api('/import', pending);
    invalidate(); $('#emails').value = '';
    $('#message').textContent = `${result.count} medlemskap uppdaterade.`;
    await load();
  } catch (error) { $('#message').textContent = error.message; $('#save').disabled = false; }
});
async function load() {
  const result = await api('');
  $('#admin').hidden = false;
  if (!$('#year').value) $('#year').value = result.year;
  $('#year').max = result.year + 1;
  $('#members').replaceChildren(...result.members.map(member => {
    const li = document.createElement('li');
    li.textContent = `${member.email} · betalt t.o.m. ${member.paidThroughYear} · ${member.paidThroughYear >= result.year ? 'aktiv' : 'utgånget'} · ${member.discordId ? 'Discord kopplat' : 'ingen Discord-koppling'}`;
    if (member.paidThroughYear >= result.year) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Återkalla åtkomst';
      button.addEventListener('click', async () => {
        if (!window.confirm(`Återkalla åtkomsten för ${member.email}? Medlemsåret sätts till föregående år. Profil och Discord-koppling bevaras.`)) return;
        button.disabled = true;
        try { await api('/revoke', {email: member.email}); await load(); $('#message').textContent = 'Åtkomsten är återkallad.'; }
        catch (error) { $('#message').textContent = error.message; button.disabled = false; }
      });
      li.append(' ', button);
    }
    return li;
  }));
}
load().then(() => { $('#message').textContent = 'Endast administratörer kan se och ändra medlemslistan.'; }).catch(error => { $('#message').textContent = error.message; });
