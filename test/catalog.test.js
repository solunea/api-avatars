import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {PNG} from 'pngjs';
import {buildCatalog, saveCatalog, validateAvatar} from '../lib/catalog.js';
import {generateBundle, describeBundle, describePortrait, portraitDescriptionPrompt, portraitPrompt} from '../lib/generation.js';
import {removeWhiteFringe} from '../lib/matte.js';

const png = PNG.sync.write(new PNG({width: 1, height: 1}));
const detailedDescription = Array(13).fill('An empathetic front-facing portrait with detailed facial features, clothing, lighting, and a transparent background.').join(' ');
const detailedBundle = JSON.stringify({description: 'Portrait de Ada.', speechPersonality: 'Voix chaleureuse, débit posé et articulation nette.',
  tonePrompts: {neutral: detailedDescription, success: detailedDescription, failure: detailedDescription}});
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

test('les tons demandent des expressions faciales visibles et distinctes du neutre', () => {
  const neutral = portraitPrompt('Ada', 'neutral', false, true);
  const success = portraitPrompt('Ada', 'success', false, false);
  const failure = portraitPrompt('Ada', 'failure', false, false);
  assert.match(neutral, /relaxed eyebrows/);
  assert.doesNotMatch(neutral, /must visibly change/);
  assert.match(success, /natural medium smile/);
  assert.match(success, /lifted cheeks/);
  assert.match(failure, /gentle furrow between the eyebrows/);
  assert.match(failure, /downturned corners/);
  for (const prompt of [success, failure]) {
    assert.match(prompt, /unmistakable even in a small thumbnail/);
    assert.match(prompt, /exact facial identity, hair and clothing/);
    assert.match(prompt, /mouth unobstructed/);
  }
});

test('génération IA prépare les trois tons et le détourage sans décor', async t => {
  const root = fixture(t);
  writeFileSync(join(root, 'images', 'photo.png'), Buffer.from('source photo'));
  const calls = [];
  const events = [];
  const run = async (model, options) => {calls.push({model, options});return model.startsWith('google/') ? [detailedBundle] : `data:image/png;base64,${png.toString('base64')}`;};
  const result = await generateBundle(root, {name:'Ada', photo:'images/photo.png', decor:''}, run, event => events.push(event));
  assert.equal(calls.filter(call => call.model === 'black-forest-labs/flux-2-pro').length, 3);
  assert.equal(calls.filter(call => call.model.startsWith('851-labs/')).length, 3);
  assert.equal(calls.filter(call => call.model === 'google/gemini-2.5-flash').length, 1);
  assert.ok(calls.some(call => call.options.input.prompt?.includes('at least 170 words')));
  assert.equal(calls.find(call => call.model === 'google/gemini-2.5-flash').options.input.images.length, 3);
  const eventNames = events.map(event => `${event.type}:${event.tone || ''}`);
  assert.deepEqual(eventNames.slice(0, 4), ['stage:neutral', 'portrait:neutral', 'stage:success', 'stage:failure']);
  assert.deepEqual(eventNames.slice(4, 6).sort(), ['portrait:failure', 'portrait:success']);
  assert.deepEqual(eventNames.slice(6), ['stage:descriptions', 'details:']);
  for (const event of events.filter(item => item.type === 'portrait')) assert.ok(existsSync(join(root, event.path)));
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
  const run = async (model, options) => {calls.push({model, options});return model.startsWith('google/') ? [detailedBundle] : `data:image/png;base64,${png.toString('base64')}`;};
  await generateBundle(root, {name:'Ada', photo:'images/photo.png', decor:'images/decor.png'}, run);
  assert.equal(calls.length, 4);
  const fluxCalls = calls.filter(call => call.model === 'black-forest-labs/flux-2-pro');
  assert.deepEqual(fluxCalls[1].options.input.input_images[0], png);
  assert.deepEqual(fluxCalls[1].options.input.input_images[1], png);
});

test('les descriptions et métadonnées sont régénérées en un seul appel sans recréer les portraits', async t => {
  const root = fixture(t);
  const calls = [];
  const result = await describeBundle(root, {tones: avatar().tones}, async (model, options) => {
    calls.push({model, options});
    return [detailedBundle];
  });
  assert.deepEqual(Object.keys(result.tonePrompts), ['neutral', 'success', 'failure']);
  assert.equal(result.description, 'Portrait de Ada.');
  assert.equal(calls.length, 1);
  assert.ok(calls.every(call => call.model === 'google/gemini-2.5-flash'));
  assert.equal(calls[0].options.input.images.length, 3);
  assert.ok(calls[0].options.input.images.every(image => image.equals(png)));
  assert.ok(calls[0].options.input.prompt.includes('transparent backgrounds'));
});

test('une description trop courte ne passe pas silencieusement dans le catalogue', async () => {
  assert.match(portraitDescriptionPrompt(), /text-to-image/);
  assert.match(portraitDescriptionPrompt(true), /visible setting/);
  await assert.rejects(describePortrait(async () => ['Generic portrait.'], png), /trop courte/);
});

test('une réponse groupée incomplète demande une correction', async t => {
  const root = fixture(t);
  const tones = avatar().tones;
  await assert.rejects(describeBundle(root, {tones}, async () => ['<html>Erreur</html>']), /format JSON/);
  await assert.rejects(describeBundle(root, {tones}, async () => [JSON.stringify({...JSON.parse(detailedBundle), tonePrompts: {...JSON.parse(detailedBundle).tonePrompts, failure: 'Too short.'}})]), /trop courte/);
});

test('le détourage retire un halo blanc inventé sans effacer une barbe blanche réelle', () => {
  const source = new PNG({width: 7, height: 7});
  const cutout = new PNG({width: 7, height: 7});
  for (let pixel = 0; pixel < 49; pixel++) {
    const at = pixel * 4;
    source.data.set([90, 70, 55, 255], at);
    cutout.data.set([90, 70, 55, 0], at);
  }
  const halo = (3 * 7 + 2) * 4;
  const beard = (3 * 7 + 3) * 4;
  cutout.data.set([248, 247, 242, 255], halo);
  source.data.set([245, 243, 237, 255], beard);
  cutout.data.set([245, 243, 237, 255], beard);
  const cleaned = PNG.sync.read(removeWhiteFringe(PNG.sync.write(source), PNG.sync.write(cutout)));
  assert.equal(cleaned.data[halo + 3], 0);
  assert.equal(cleaned.data[beard + 3], 255);
});

test('administration locale accepte la création puis la suppression', async t => {
  const root = fixture(t);
  const port = 32000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, ['server.js'], {cwd:join(import.meta.dirname, '..'), env:{...process.env, API_AVATAR_ROOT:root, PORT:String(port), REPLICATE_API_TOKEN:'test-only-token'}, stdio:'ignore'});
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
  const streamedError = await fetch(`${base}/api/generate`, {method:'POST', headers:{'Content-Type':'application/json', Accept:'application/x-ndjson'},
    body:JSON.stringify({name:'Ada', photo:'images/absent.png'})});
  assert.equal(streamedError.status, 200);
  assert.match(streamedError.headers.get('content-type'), /application\/x-ndjson/);
  assert.deepEqual(JSON.parse((await streamedError.text()).trim()), {type:'error', error:'Image introuvable : images/absent.png'});
  const describedError = await fetch(`${base}/api/describe`, {method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({tones:{neutral:'images/absent.png'}})});
  assert.equal(describedError.status, 502);
  assert.match(describedError.headers.get('content-type'), /application\/json/);
  assert.match((await describedError.json()).error, /trois portraits sont requis/);
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
