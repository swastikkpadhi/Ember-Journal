import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveSecrets, newSalt, encryptVault, decryptVault } from '../crypto.js';

test('the diary survives encryption, uses random nonces, and rejects another owner, key or altered ciphertext',async()=>{
  const password='a long private test passphrase',salt=newSalt(),secrets=await deriveSecrets(password,salt);
  const same=await deriveSecrets(password,salt),other=await deriveSecrets('another completely different passphrase',newSalt());
  assert.equal(secrets.credential,same.credential);assert.equal(secrets.key.extractable,false);
  const account=crypto.randomUUID(),diary={text:'This belongs only to me',answers:{people:'A close friend'}};
  const first=await encryptVault(diary,secrets.key,account),second=await encryptVault(diary,secrets.key,account);
  assert.notEqual(first.iv,second.iv);assert.notEqual(first.ciphertext,second.ciphertext);
  assert.deepEqual(await decryptVault(first,same.key,account),diary);
  assert.equal(JSON.stringify(first).includes(diary.text),false);
  await assert.rejects(()=>decryptVault(first,other.key,account));
  await assert.rejects(()=>decryptVault(first,secrets.key,crypto.randomUUID()));
  const bytes=Buffer.from(first.ciphertext,'base64');bytes[0]^=1;
  await assert.rejects(()=>decryptVault({...first,ciphertext:bytes.toString('base64')},secrets.key,account));
});
