import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {buildCatalog, saveCatalog, validateAvatar} from '../lib/catalog.js';
import {generateBundle} from '../lib/generation.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aLQAAAABJRU5ErkJggg==', 'base64');
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'api-avatars-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  for (const dir of ['data', 'images']) mkdirSync(join(root, dir));
  writeFileSync(join(root, 'data', 'avatars.json'), '[]\n');
  for (const name of ['photo', 'preview', 'neutral', 'success', 'failure', 'decor']) writeFileSync(join(root, 'images', `${name}.png`), png);
  return root;
}
function avatar() {
  return {id:'preset-ada', name:'Ada', description:'Guide', voiceKey:'gemini:Kore', photo:'images/photo.png', decor:'', preview:'images/preview.png',
    tones:{neutral:'images/neutral.png', success:'images/success.png', failure:'images/failure.png'},
    tonePrompts:{neutral:'Ada looks attentive', success:'Ada looks pleased', failure:'Ada looks sympathetic'}, preset:true};
}

test('catalogue vide et fiche importée produisent les endpoints statiques', t => {
  const root = fixture(t);
  assert.deepEqual(buildCatalog(root), []);
  const item = avatar();
  saveCatalog(root, [item]);
  const index = JSON.parse(readFileSync(join(root, 'api', 'avatars.json')));
  assert.equal(index[0].id, item.id);
  assert.equal(index[0].preview, item.preview);
  const detail = JSON.parse(readFileSync(join(root, 'api', 'avatars', `${item.id}.json`)));
  assert.deepEqual(detail.tones, item.tones);
  saveCatalog(root, []);
  assert.equal(existsSync(join(root, 'api', 'avatars', `${item.id}.json`)), false);
});

test('validation bloque les médias absents, chemins dangereux et voix non partagées', t => {
  const root = fixture(t);
  const item = avatar();
  item.photo = 'images/../outside.png';
  item.voiceKey = 'qwen3-custom:secret';
  item.tones.failure = 'images/missing.png';
  const errors = validateAvatar(item, root);
  assert.ok(errors.includes('photo manquant'));
  assert.ok(errors.includes('voix Gemini invalide'));
  assert.ok(errors.includes('ton failure manquant'));
});

test('génération IA prépare les trois tons et le détourage sans décor', async t => {
  const root = fixture(t);
  const calls = [];
  const run = async (model, options) => {calls.push({model, options});return model.startsWith('google/') ? ['An empathetic front-facing portrait of Ada.'] : `data:image/png;base64,${png.toString('base64')}`;};
  const result = await generateBundle(root, {name:'Ada', photo:'images/photo.png', decor:''}, run);
  assert.equal(calls.filter(call => call.model === 'black-forest-labs/flux-2-pro').length, 3);
  assert.equal(calls.filter(call => call.model.startsWith('851-labs/')).length, 3);
  assert.equal(calls.filter(call => call.model === 'google/gemini-3.1-pro').length, 3);
  assert.equal(calls[0].options.input.input_images.length, 1);
  assert.equal(result.tones.neutral, result.preview);
  assert.ok(result.tonePrompts.failure.includes('empathetic'));
  for (const path of Object.values(result.tones)) assert.ok(existsSync(join(root, path)));
  saveCatalog(root, [{...avatar(), preview:result.preview, tones:result.tones, tonePrompts:result.tonePrompts}]);
});

test('génération avec décor transmet les deux références sans détourage', async t => {
  const root = fixture(t);
  const calls = [];
  const run = async (model, options) => {calls.push({model, options});return model.startsWith('google/') ? ['A front-facing portrait of Ada.'] : `data:image/png;base64,${png.toString('base64')}`;};
  await generateBundle(root, {name:'Ada', photo:'images/photo.png', decor:'images/decor.png'}, run);
  assert.equal(calls.length, 6);
  assert.equal(calls[0].options.input.input_images.length, 2);
});

test('administration locale accepte la création puis la suppression', async t => {
  const root = fixture(t);
  const port = 32000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, ['server.js'], {cwd:join(import.meta.dirname, '..'), env:{...process.env, API_AVATAR_ROOT:root, PORT:String(port)}, stdio:'ignore'});
  t.after(() => child.kill());
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i=0;i<50;i++) {
    try {const response=await fetch(`${base}/api/avatars`);if(response.ok){ready=true;break;}} catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, 'serveur local démarré');
  const created = await fetch(`${base}/api/avatars`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(avatar())});
  assert.equal(created.status, 201);
  assert.equal((await (await fetch(`${base}/api/avatars/preset-ada`)).json()).name, 'Ada');
  assert.equal((await (await fetch(`${base}/api/avatars.json`)).json()).length, 1);
  assert.equal((await fetch(`${base}/api/avatars/preset-ada`, {method:'DELETE'})).status, 200);
  assert.deepEqual(await (await fetch(`${base}/api/avatars`)).json(), []);
});
