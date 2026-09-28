import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {buildCatalog, saveCatalog, validateAvatar} from '../lib/catalog.js';
import {generateBundle, describeBundle, describePortrait, portraitDescriptionPrompt} from '../lib/generation.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aLQAAAABJRU5ErkJggg==', 'base64');
const detailedDescription = Array(9).fill('An empathetic front-facing portrait with detailed facial features, clothing, lighting, and a transparent background.').join(' ');
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'api-avatars-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  for (const dir of ['data', 'images']) mkdirSync(join(root, dir));
  writeFileSync(join(root, 'data', 'avatars.json'), '[]\n');
  for (const name of ['photo', 'preview', 'neutral', 'success', 'failure', 'decor']) writeFileSync(join(root, 'images', `${name}.png`), png);
  return root;
}
function avatar() {
  return {id:'preset-ada', name:'Ada', description:'Guide', voiceKey:'gemini:Kore', speechPersonality:'Chaleureuse et posée', photo:'images/photo.png', decor:'', preview:'images/preview.png',
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
  assert.equal(index[0].speechPersonality, item.speechPersonality);
  const detail = JSON.parse(readFileSync(join(root, 'api', 'avatars', `${item.id}.json`)));
  assert.deepEqual(detail.tones, item.tones);
  assert.equal(detail.speechPersonality, item.speechPersonality);
  saveCatalog(root, []);
  assert.equal(existsSync(join(root, 'api', 'avatars', `${item.id}.json`)), false);
});

test('la personnalité vocale reste facultative et limitée à 300 caractères', t => {
  const root = fixture(t);
  const item = avatar();
  delete item.speechPersonality;
  assert.deepEqual(validateAvatar(item, root), []);
  item.speechPersonality = 'a'.repeat(301);
  assert.ok(validateAvatar(item, root).includes('personnalité vocale invalide'));
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

test('succès et échec doivent avoir chacun leur propre image', t => {
  const root = fixture(t);
  const item = avatar();
  item.tones.success = item.tones.neutral;
  item.tones.failure = item.tones.neutral;
  const errors = validateAvatar(item, root);
  assert.ok(errors.includes('image success identique au ton neutral'));
  assert.ok(errors.includes('image failure identique à un autre ton'));
});

test('génération IA prépare les trois tons et le détourage sans décor', async t => {
  const root = fixture(t);
  writeFileSync(join(root, 'images', 'photo.png'), Buffer.from('source photo'));
  const calls = [];
  const run = async (model, options) => {calls.push({model, options});return model.startsWith('google/') ? [options.input.prompt.includes('JSON object') ? '{"description":"Portrait de Ada.","speechPersonality":"Voix chaleureuse, débit posé et articulation nette."}' : detailedDescription] : `data:image/png;base64,${png.toString('base64')}`;};
  const result = await generateBundle(root, {name:'Ada', photo:'images/photo.png', decor:''}, run);
  assert.equal(calls.filter(call => call.model === 'black-forest-labs/flux-2-pro').length, 3);
  assert.equal(calls.filter(call => call.model.startsWith('851-labs/')).length, 3);
  assert.equal(calls.filter(call => call.model === 'google/gemini-2.5-flash').length, 4);
  assert.ok(calls.some(call => call.options.input.prompt?.includes('170 to 220 word')));
  assert.equal(result.speechPersonality, 'Voix chaleureuse, débit posé et articulation nette.');
  assert.equal(result.description, 'Portrait de Ada.');
  const fluxCalls = calls.filter(call => call.model === 'black-forest-labs/flux-2-pro');
  assert.deepEqual(fluxCalls[0].options.input.input_images[0], Buffer.from('source photo'));
  assert.deepEqual(fluxCalls[1].options.input.input_images[0], png);
  assert.deepEqual(fluxCalls[2].options.input.input_images[0], png);
  assert.equal(result.tones.neutral, result.preview);
  assert.notEqual(result.tones.success, result.tones.neutral);
  assert.notEqual(result.tones.failure, result.tones.success);
  assert.ok(result.tonePrompts.failure.includes('empathetic'));
  for (const path of Object.values(result.tones)) assert.ok(existsSync(join(root, path)));
  saveCatalog(root, [{...avatar(), preview:result.preview, tones:result.tones, tonePrompts:result.tonePrompts}]);
});

test('génération avec décor transmet les deux références sans détourage', async t => {
  const root = fixture(t);
  writeFileSync(join(root, 'images', 'photo.png'), Buffer.from('source photo'));
  const calls = [];
  const run = async (model, options) => {calls.push({model, options});return model.startsWith('google/') ? [options.input.prompt.includes('JSON object') ? '{"description":"Portrait de Ada.","speechPersonality":"Voix chaleureuse, débit posé et articulation nette."}' : detailedDescription] : `data:image/png;base64,${png.toString('base64')}`;};
  await generateBundle(root, {name:'Ada', photo:'images/photo.png', decor:'images/decor.png'}, run);
  assert.equal(calls.length, 7);
  const fluxCalls = calls.filter(call => call.model === 'black-forest-labs/flux-2-pro');
  assert.deepEqual(fluxCalls[1].options.input.input_images[0], png);
  assert.deepEqual(fluxCalls[1].options.input.input_images[1], png);
});

test('les descriptions peuvent être régénérées depuis les trois images sans recréer les portraits', async t => {
  const root = fixture(t);
  const calls = [];
  const result = await describeBundle(root, {tones: avatar().tones}, async (model, options) => {
    calls.push({model, options});
    return [detailedDescription];
  });
  assert.deepEqual(Object.keys(result.tonePrompts), ['neutral', 'success', 'failure']);
  assert.equal(calls.length, 3);
  assert.ok(calls.every(call => call.model === 'google/gemini-2.5-flash'));
  assert.ok(calls.every(call => call.options.input.images[0].equals(png)));
  assert.ok(calls.every(call => call.options.input.prompt.includes('transparent background')));
});

test('une description trop courte ne passe pas silencieusement dans le catalogue', async () => {
  assert.match(portraitDescriptionPrompt(), /text-to-image/);
  assert.match(portraitDescriptionPrompt(true), /visible setting/);
  await assert.rejects(describePortrait(async () => ['Generic portrait.'], png), /trop courte/);
});

test('administration locale accepte la création puis la suppression', async t => {
  const root = fixture(t);
  const port = 32000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, ['server.js'], {cwd:join(import.meta.dirname, '..'), env:{...process.env, API_AVATAR_ROOT:root, PORT:String(port)}, stdio:'ignore'});
  t.after(() => child.kill());
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i=0;i<100;i++) {
    try {const response=await fetch(`${base}/api/avatars`);if(response.ok){ready=true;break;}} catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, 'serveur local démarré');
  const availableVoices = await (await fetch(`${base}/api/voices`)).json();
  assert.equal(availableVoices.length, 30);
  assert.ok(availableVoices.every(voice => voice.key === `gemini:${voice.name}` && ['male', 'female'].includes(voice.gender)));
  assert.deepEqual(availableVoices.find(voice => voice.key === 'gemini:Kore'), {key:'gemini:Kore', name:'Kore', gender:'female'});
  const foreignOrigin = await fetch(`${base}/api/build`, {method:'POST',headers:{Origin:'https://example.org'}});
  assert.equal(foreignOrigin.status, 403);
  const created = await fetch(`${base}/api/avatars`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...avatar(),speechPersonality:'  Calme \n et   posée  '})});
  assert.equal(created.status, 201);
  const detail = await (await fetch(`${base}/api/avatars/preset-ada`)).json();
  assert.equal(detail.speechPersonality, 'Calme et posée');
  const index = await (await fetch(`${base}/api/avatars.json`)).json();
  assert.equal(index[0].speechPersonality, 'Calme et posée');
  const updated = await fetch(`${base}/api/avatars/preset-ada`, {method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({...avatar(),name:'Ada Renommée',speechPersonality:'  Rassurante  '})});
  const updatedAvatar = await updated.json();
  assert.equal(updatedAvatar.id, 'preset-ada');
  assert.equal(updatedAvatar.speechPersonality, 'Rassurante');
  assert.equal((await fetch(`${base}/api/avatars/preset-ada`, {method:'DELETE'})).status, 200);
  assert.deepEqual(await (await fetch(`${base}/api/avatars`)).json(), []);
  assert.equal(existsSync(join(root, 'images', 'photo.png')), false);
});
