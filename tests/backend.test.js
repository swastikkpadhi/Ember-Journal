import test from 'node:test';
import http from 'node:http';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { once } from 'node:events';
import { createApp } from '../server.js';
import { deriveSecrets, newSalt, encryptVault, decryptVault } from '../crypto.js';
import { emptyState } from '../domain.js';

function removeTestDir(path) {
  const target = resolve(path);
  assert.equal(dirname(target), resolve(tmpdir()));
  assert.match(basename(target), /^ember-(tests|production|rate)-/);
  rmSync(target, { recursive: true, force: true });
}

function rawRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { ...options, headers: { ...options.headers, ...(options.body ? { 'Content-Length': Buffer.byteLength(options.body) } : {}) }, agent: false }, response => {
      const chunks = []; response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        const headers = new Headers();
        for (const [key, value] of Object.entries(response.headers)) for (const item of Array.isArray(value) ? value : [value]) if (item !== undefined) headers.append(key, item);
        const text = Buffer.concat(chunks).toString();
        let body; try { body = JSON.parse(text); } catch { body = null; }
        resolve({ status: response.statusCode, body, cookie: headers.get('set-cookie')?.split(';')[0], headers });
      });
    });
    req.on('error', reject); req.end(options.body);
  });
}

test('real HTTP account isolation, encrypted persistence, CSRF, conflicts, rotation and deletion',async(t)=>{
  const dataDir=mkdtempSync(join(tmpdir(),'ember-tests-'));
  let app,origin;
  async function start(port=0){
    // Reserve a port before constructing the strict expected origin.
    if(!port){const net=await import('node:net');const probe=net.createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');port=probe.address().port;await new Promise(r=>probe.close(r));}
    origin='http://127.0.0.1:'+port;app=createApp({origin,dataDir});app.server.listen(port,'127.0.0.1');await once(app.server,'listening');return port;
  }
  async function stop(){if(app?.server.listening)await new Promise(resolve=>app.server.close(resolve));}
  t.after(async()=>{await stop();removeTestDir(dataDir);});
  const port=await start();
  async function request(path,{method='GET',data,cookie='',csrf='',headers={}}={}){
    return rawRequest(origin+path,{method,headers:{Origin:origin,...(data?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{}),...(csrf?{'X-CSRF-Token':csrf}:{}),...headers},...(data?{body:JSON.stringify(data)}:{})});
  }
  async function register(email,text){const id=crypto.randomUUID(),salt=newSalt(),secrets=await deriveSecrets('a unique and private test passphrase',salt),state=emptyState();state.e=[{id:crypto.randomUUID(),d:'2026-10-10',t:text}];const vault=await encryptVault(state,secrets.key,id);const result=await request('/api/auth/register',{method:'POST',data:{id,email,salt,credential:secrets.credential,vault}});assert.equal(result.status,201);return {id,email,salt,secrets,state,...result};}
  const marker='PRIVATE_DIARY_SENTINEL_do_not_store_in_plaintext';
  const alice=await register('alice@example.test',marker),bob=await register('bob@example.test','Bob has his own private diary');
  assert.match(alice.headers.get('set-cookie'),/HttpOnly/);assert.match(alice.headers.get('set-cookie'),/SameSite=Strict/);
  assert.equal((await request('/api/vault')).status,401);
  const a=await request('/api/vault',{cookie:alice.cookie});assert.equal(a.status,200);assert.equal(a.body.revision,1);
  assert.equal((await decryptVault(a.body.vault,alice.secrets.key,alice.id)).e[0].t,marker);
  const b=await request('/api/vault?userId='+alice.id,{cookie:bob.cookie});
  assert.equal((await decryptVault(b.body.vault,bob.secrets.key,bob.id)).e[0].t,'Bob has his own private diary');
  await assert.rejects(()=>decryptVault(a.body.vault,bob.secrets.key,bob.id));
  const rows=JSON.stringify(app.db.prepare('SELECT * FROM vaults').all());assert.equal(rows.includes(marker),false);
  const payload={revision:1,vault:await encryptVault({...alice.state,private:'Saved again'},alice.secrets.key,alice.id)};
  assert.equal((await request('/api/vault',{method:'PUT',cookie:alice.cookie,data:payload})).status,403);
  assert.equal((await request('/api/vault',{method:'PUT',cookie:alice.cookie,csrf:alice.body.csrf,data:payload,headers:{Origin:'https://another-site.test'}})).status,403);
  assert.equal((await request('/api/vault',{method:'PUT',cookie:alice.cookie,csrf:alice.body.csrf,data:payload})).status,200);
  assert.equal((await request('/api/vault',{method:'PUT',cookie:alice.cookie,csrf:alice.body.csrf,data:payload})).status,409);
  assert.equal((await request('/api/vault',{method:'PUT',cookie:alice.cookie,csrf:alice.body.csrf,data:{revision:2,vault:{format:1,iv:'bad',ciphertext:'bad'}}})).status,400);
  for(const path of ['/.env','/data/ember.sqlite','/server.js','/api/users/'+alice.id])assert.equal((await request(path,{cookie:bob.cookie})).status,404);
  const challenge=await request('/api/auth/challenge',{method:'POST',data:{email:alice.email}});assert.equal(challenge.body.salt,alice.salt);
  const unknown=await request('/api/auth/challenge',{method:'POST',data:{email:'unknown@example.test'}});assert.equal(unknown.status,200);assert.equal(Buffer.from(unknown.body.salt,'base64').length,16);
  const wrong=await request('/api/auth/login',{method:'POST',data:{email:alice.email,credential:bob.secrets.credential}});assert.equal(wrong.status,401);
  const signed=await request('/api/auth/login',{method:'POST',data:{email:alice.email,credential:alice.secrets.credential}});assert.equal(signed.status,200);assert.notEqual(signed.cookie,alice.cookie);
  await stop();await start(port);
  const persisted=await request('/api/vault',{cookie:signed.cookie});assert.equal(persisted.body.revision,2);assert.equal((await decryptVault(persisted.body.vault,alice.secrets.key,alice.id)).private,'Saved again');
  const salt=newSalt(),updated=await deriveSecrets('a completely new private passphrase',salt),state=await decryptVault(persisted.body.vault,alice.secrets.key,alice.id),vault=await encryptVault(state,updated.key,alice.id);
  const changed=await request('/api/auth/password',{method:'POST',cookie:signed.cookie,csrf:signed.body.csrf,data:{credential:alice.secrets.credential,newCredential:updated.credential,salt,vault,revision:2}});assert.equal(changed.status,200);
  assert.equal((await request('/api/vault',{cookie:signed.cookie})).status,401);assert.equal((await request('/api/vault',{cookie:alice.cookie})).status,401);
  const changedVault=await request('/api/vault',{cookie:changed.cookie});assert.equal(changedVault.body.revision,3);
  assert.equal((await decryptVault(changedVault.body.vault,updated.key,alice.id)).private,'Saved again');await assert.rejects(()=>decryptVault(changedVault.body.vault,alice.secrets.key,alice.id));
  assert.equal((await request('/api/auth/account',{method:'DELETE',cookie:changed.cookie,csrf:changed.body.csrf,data:{credential:alice.secrets.credential}})).status,401);
  assert.equal((await request('/api/auth/account',{method:'DELETE',cookie:changed.cookie,csrf:changed.body.csrf,data:{credential:updated.credential}})).status,200);
  assert.equal(app.db.prepare('SELECT count(*) AS n FROM users WHERE id=?').get(alice.id).n,0);
  assert.equal(app.db.prepare('SELECT count(*) AS n FROM vaults WHERE user_id=?').get(alice.id).n,0);
  assert.equal((await request('/api/vault',{cookie:bob.cookie})).status,200);
  assert.equal((await request('/api/auth/logout',{method:'POST',cookie:bob.cookie,csrf:bob.body.csrf,data:{}})).status,200);
  assert.equal((await request('/api/vault',{cookie:bob.cookie})).status,401);
});

test('production requires TLS and emits secure session and browser headers',async(t)=>{
  const dataDir=mkdtempSync(join(tmpdir(),'ember-production-'));
  assert.throws(()=>createApp({dataDir,production:true,origin:'http://ember.example'}),/HTTPS/);
  const app=createApp({dataDir,production:true,origin:'https://ember.example'});app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
  t.after(async()=>{await new Promise(r=>app.server.close(r));removeTestDir(dataDir);});
  const url='http://127.0.0.1:'+app.server.address().port;
  const id=crypto.randomUUID(),salt=newSalt(),secrets=await deriveSecrets('secure production test passphrase',salt),vault=await encryptVault(emptyState(),secrets.key,id);
  const response=await rawRequest(url+'/api/auth/register',{method:'POST',headers:{Host:'ember.example',Origin:'https://ember.example','Content-Type':'application/json'},body:JSON.stringify({id,email:'prod@example.test',salt,credential:secrets.credential,vault})});
  assert.equal(response.status,201);assert.match(response.headers.get('set-cookie'),/^__Host-ember_session=/);assert.match(response.headers.get('set-cookie'),/; Secure/);
  assert.match(response.headers.get('content-security-policy'),/script-src 'self'/);assert.equal(response.headers.get('cache-control'),'no-store');assert.ok(response.headers.get('strict-transport-security'));
});

test('authentication challenges are limited and untrusted forwarding headers cannot bypass limits',async(t)=>{
  const dataDir=mkdtempSync(join(tmpdir(),'ember-rate-'));
  const app=createApp({dataDir,origin:'http://localhost:3000',trustProxy:false});
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
  t.after(async()=>{await new Promise(r=>app.server.close(r));removeTestDir(dataDir);});
  const url='http://127.0.0.1:'+app.server.address().port+'/api/auth/challenge';
  async function attempt(index){return rawRequest(url,{method:'POST',headers:{Host:'localhost:3000',Origin:'http://localhost:3000','Content-Type':'application/json','X-Forwarded-For':'192.0.2.'+index},body:JSON.stringify({email:'unknown@example.test'})});}
  for(let i=1;i<=40;i++)assert.equal((await attempt(i)).status,200);
  assert.equal((await attempt(41)).status,429);
});
