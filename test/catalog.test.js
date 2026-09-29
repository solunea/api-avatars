import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {PNG} from 'pngjs';
import sharp from 'sharp';
import {buildCatalog, saveCatalog, validateAvatar, defaultSheetRegions} from '../lib/catalog.js';
import {generateBundle, describeBundle, completeAvatarDescriptions, describePortrait, portraitDescriptionPrompt, portraitPrompt, removeCharacterSheetBackground} from '../lib/generation.js';
import {removeWhiteFringe} from '../lib/matte.js';
import {pushPublishedHead} from '../lib/git-publish.js';
import {providerErrorMessage} from '../lib/provider-error.js';

const png = PNG.sync.write(new PNG({width: 1, height: 1}));
const detailedDescription = Array(13).fill('An empathetic front-facing portrait with detailed facial features, clothing, lighting, and a transparent background.').join(' ');
const detailedBundle = JSON.stringify({description: 'Portrait de Ada.', speechPersonality: 'Voix chaleureuse, débit posé et articulation nette.',
  tonePrompts: {neutral: detailedDescription, success: detailedDescription, failure: detailedDescription}});
const detailedSheetBundle = JSON.stringify({description:'Portrait de Ada.', speechPersonality:'Voix chaleureuse, débit posé et articulation nette.',
  tonePrompts:{neutral:detailedDescription}, characterSheetPrompt:detailedDescription,
  framingPrompts:{bust:detailedDescription,fullBody:detailedDescription}});
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'api-avatars-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  for (const dir of ['data', 'images']) mkdirSync(join(root, dir));
  writeFileSync(join(root, 'data', 'avatars.json'), '[]\n');
  for (const name of ['photo', 'preview', 'neutral', 'success', 'failure', 'decor', 'sheet']) writeFileSync(join(root, 'images', `${name}.png`), png);
  return root;
}
function avatar() {
  return {id:'preset-ada', name:'Ada', description:'Guide', voiceKey:'gemini:Kore', speechPersonality:'Chaleureuse et posée', photo:'images/photo.png', decor:'', preview:'images/preview.png',
    tones:{neutral:'images/neutral.png', success:'images/success.png', failure:'images/failure.png'},
    tonePrompts:{neutral:'Ada looks attentive', success:'Ada looks pleased', failure:'Ada looks sympathetic'}, preset:true};
}
function avatarV2() {
  return {...avatar(), schemaVersion:2, characterSheet:'images/sheet.png', characterSheetPrompt:detailedDescription,
    sheetRegions:structuredClone(defaultSheetRegions), framingPrompts:{bust:detailedDescription,fullBody:detailedDescription},
    tones:{neutral:'images/neutral.png'}, tonePrompts:{neutral:detailedDescription}};
}

test('fiche v2 valide le neutre, la planche et les zones sans succès ni échec', t => {
  const root = fixture(t);
  const item = avatarV2();
  assert.deepEqual(validateAvatar(item,root),[]);
  saveCatalog(root,[item]);
  const index = JSON.parse(readFileSync(join(root,'api','avatars.json')));
  assert.equal(index[0].hasCharacterSheet,true);
  assert.equal(index[0].schemaVersion,2);
  const detail = JSON.parse(readFileSync(join(root,'api','avatars',`${item.id}.json`)));
  assert.equal(detail.schemaVersion,2);
  assert.equal(detail.characterSheet,item.characterSheet);
  assert.deepEqual(Object.keys(detail.tones),['neutral']);
  item.sheetRegions.front.width = 2;
  assert.ok(validateAvatar(item,root).includes('zone front invalide'));
  item.sheetRegions.front.width = 1/3;
  item.characterSheet = 'images/missing.png';
  assert.ok(validateAvatar(item,root).includes('planche manquante'));
});

test('les trois zones de la nouvelle planche couvrent toute la hauteur', t => {
  const root = fixture(t);
  const item = avatarV2();
  assert.deepEqual(Object.keys(item.sheetRegions), ['front', 'profile', 'back']);
  assert.ok(Object.values(item.sheetRegions).every(region => region.y === 0 && region.height === 1));
  assert.deepEqual(validateAvatar(item, root), []);
  item.sheetRegions.profile.width = 0;
  assert.ok(validateAvatar(item, root).includes('zone profile invalide'));
});

test('une planche v2 existante à cinq zones reste lisible', t => {
  const root = fixture(t);
  const item = avatarV2();
  item.sheetRegions = {
    front:{x:0,y:0,width:1/3,height:.75}, profile:{x:1/3,y:0,width:1/3,height:.75},
    back:{x:2/3,y:0,width:1/3,height:.75}, face:{x:0,y:.75,width:.5,height:.25},
    outfit:{x:.5,y:.75,width:.5,height:.25}
  };
  assert.deepEqual(validateAvatar(item, root), []);
});

test('import v2 sans descriptions les retrouve depuis le neutre et la planche', async t => {
  const root = fixture(t);
  const item = avatarV2();
  item.description = ''; item.speechPersonality = ''; item.tonePrompts.neutral = '';
  item.characterSheetPrompt = ''; item.framingPrompts = {bust:'',fullBody:''};
  let calls = 0;
  await completeAvatarDescriptions(root,item,async (model, options) => {
    calls += 1;
    assert.equal(model,'google/gemini-2.5-flash');
    assert.equal(options.input.images.length,2);
    return [detailedSheetBundle];
  });
  assert.equal(calls,1);
  assert.deepEqual(validateAvatar(item,root),[]);
});

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

test('avec décor, la scène est reconstruite autour du cadrage du portrait', () => {
  const neutral = portraitPrompt('Ada', 'neutral', true, true);
  const success = portraitPrompt('Ada', 'success', false, false, true);
  const failure = portraitPrompt('Ada', 'failure', false, false, true);
  assert.match(neutral, /Reference image 2 defines the location/);
  assert.match(neutral, /centered medium close-up/);
  assert.match(neutral, /Adapt the room to this close camera viewpoint instead of moving or shrinking the person/);
  assert.match(neutral, /vanishing lines/);
  assert.match(neutral, /softly receding background/);
  assert.match(success, /Preserve the camera viewpoint, horizontal person position, approximate scale/);
  for (const prompt of [neutral, success, failure]) {
    assert.match(prompt, /highest point of the complete head, crown, hairstyle or headwear at least 10%/);
    assert.match(prompt, /clearly visible band of background above it/);
    assert.match(prompt, /horizontally centered and in a medium close-up/);
  }
  assert.match(failure, /Adjust the vertical framing slightly and extend the scene above the person/);
  assert.doesNotMatch(success, /Reference image 2/);
});

test('génération IA prépare le neutre et une planche assemblée sans décor', async t => {
  const root = fixture(t);
  writeFileSync(join(root, 'images', 'photo.png'), Buffer.from('source photo'));
  const calls = [];
  const events = [];
  const run = async (model, options) => {calls.push({model, options});return model.startsWith('google/') ? [detailedSheetBundle] : `data:image/png;base64,${png.toString('base64')}`;};
  const result = await generateBundle(root, {name:'Ada', photo:'images/photo.png', decor:''}, run, event => events.push(event));
  assert.equal(calls.filter(call => call.model === 'black-forest-labs/flux-2-pro').length, 4);
  assert.equal(calls.filter(call => call.model.startsWith('851-labs/')).length, 2);
  assert.equal(calls.filter(call => call.model === 'google/gemini-2.5-flash').length, 1);
  assert.equal(calls.find(call => call.model === 'google/gemini-2.5-flash').options.input.images.length, 2);
  const eventNames = events.map(event => `${event.type}:${event.tone || ''}`);
  assert.deepEqual(eventNames.slice(0, 3), ['stage:neutral', 'portrait:neutral', 'stage:characterSheet']);
  assert.ok(eventNames.includes('portrait:characterSheet'));
  assert.deepEqual(eventNames.slice(-2), ['stage:descriptions', 'details:']);
  for (const event of events.filter(item => item.type === 'portrait')) assert.ok(existsSync(join(root, event.path)));
  for (const event of events.filter(item => item.type === 'sheetView')) {
    assert.match(event.path, /^uploads\/view-/);
    assert.equal(existsSync(join(root, event.path)), false);
  }
  assert.equal(result.speechPersonality, 'Voix chaleureuse, débit posé et articulation nette.');
  assert.equal(result.description, 'Portrait de Ada.');
  const fluxCalls = calls.filter(call => call.model === 'black-forest-labs/flux-2-pro');
  assert.deepEqual(fluxCalls[0].options.input.input_images[0], Buffer.from('source photo'));
  assert.deepEqual(fluxCalls[1].options.input.input_images[0], png);
  assert.equal(result.tones.neutral, result.preview);
  assert.equal(result.schemaVersion,2);
  assert.ok(result.characterSheet);
  const sheet = await sharp(join(root, result.characterSheet)).metadata();
  assert.equal(sheet.width, 2048);
  assert.equal(sheet.height, 1536);
  assert.equal((await sharp(join(root, result.characterSheet)).stats()).channels[3].min, 0);
  assert.deepEqual(Object.keys(result.tones),['neutral']);
  assert.ok(result.framingPrompts.fullBody.includes('empathetic'));
  assert.deepEqual(result.sheetRegions,defaultSheetRegions);
  for (const path of Object.values(result.tones)) assert.ok(existsSync(join(root, path)));
  saveCatalog(root, [{...avatarV2(), preview:result.preview, characterSheet:result.characterSheet,
    tones:result.tones, tonePrompts:result.tonePrompts, characterSheetPrompt:result.characterSheetPrompt,
    framingPrompts:result.framingPrompts}]);
});

test('une planche déjà transparente ne consomme aucun appel de détourage', async () => {
  let calls = 0;
  const result = await removeCharacterSheetBackground(png, async () => { calls++; });
  assert.equal(calls, 0);
  assert.equal((await sharp(result).stats()).channels[3].min, 0);
});

test('régénérer le neutre ne relance ni la planche ni les descriptions', async t => {
  const root = fixture(t);
  const calls = [];
  const events = [];
  const run = async (model, options) => {
    calls.push({model, options});
    return `data:image/png;base64,${png.toString('base64')}`;
  };
  const result = await generateBundle(root, {name:'Ada',photo:'images/photo.png',only:'neutral',describe:false}, run,
    event => events.push(event));
  assert.equal(calls.filter(call => call.model === 'black-forest-labs/flux-2-pro').length, 1);
  assert.equal(calls.filter(call => call.model.startsWith('google/')).length, 0);
  assert.deepEqual(events.filter(event => event.type === 'portrait').map(event => event.tone), ['neutral']);
  assert.equal(result.tones.neutral, result.preview);
  assert.equal(result.characterSheet, undefined);
});

test('régénérer la planche réutilise le neutre sans analyser les descriptions', async t => {
  const root = fixture(t);
  const calls = [];
  const run = async (model, options) => {
    calls.push({model, options});
    return `data:image/png;base64,${png.toString('base64')}`;
  };
  const result = await generateBundle(root, {name:'Ada',photo:'images/photo.png',only:'characterSheet',describe:false,
    resume:{neutral:'images/neutral.png'}}, run);
  assert.equal(calls.filter(call => call.model === 'black-forest-labs/flux-2-pro').length, 3);
  assert.equal(calls.filter(call => call.model.startsWith('851-labs/')).length, 1);
  assert.equal(calls.filter(call => call.model.startsWith('google/')).length, 0);
  assert.equal(result.tones.neutral, 'images/neutral.png');
  assert.ok(existsSync(join(root,result.characterSheet)));
  assert.deepEqual(result.sheetRegions, defaultSheetRegions);
});

test('génération avec décor transmet les deux références au neutre puis les vues séparées', async t => {
  const root = fixture(t);
  writeFileSync(join(root, 'images', 'photo.png'), Buffer.from('source photo'));
  const calls = [];
  const run = async (model, options) => {calls.push({model, options});return model.startsWith('google/') ? [detailedSheetBundle] : `data:image/png;base64,${png.toString('base64')}`;};
  await generateBundle(root, {name:'Ada', photo:'images/photo.png', decor:'images/decor.png'}, run);
  assert.equal(calls.length, 6);
  const fluxCalls = calls.filter(call => call.model === 'black-forest-labs/flux-2-pro');
  assert.deepEqual(fluxCalls[0].options.input.input_images, [Buffer.from('source photo'), png]);
  assert.deepEqual(fluxCalls[1].options.input.input_images[0], png);
  assert.equal(fluxCalls[1].options.input.input_images.length, 2);
  assert.match(fluxCalls[1].options.input.prompt, /head-to-toe/);
  assert.match(fluxCalls[2].options.input.prompt, /side profile/);
  assert.match(fluxCalls[3].options.input.prompt, /rear view/);
});

test('un neutre existant déclenche automatiquement la génération de la planche seule', async t => {
  const root = fixture(t);
  const calls = [];
  const events = [];
  const run = async (model, options) => {
    calls.push({model, options});
    return model.startsWith('google/') ? [detailedSheetBundle] : `data:image/png;base64,${png.toString('base64')}`;
  };
  const result = await generateBundle(root, {name:'Ada',photo:'images/photo.png',resume:{neutral:'images/neutral.png'}}, run,
    event => events.push(event));
  assert.equal(result.tones.neutral, 'images/neutral.png');
  assert.ok(result.characterSheet && existsSync(join(root, result.characterSheet)));
  assert.equal(calls.filter(call => call.model === 'black-forest-labs/flux-2-pro').length, 3);
  assert.equal(calls.filter(call => call.model.startsWith('851-labs/')).length, 1);
  assert.deepEqual(events.filter(event => event.type === 'portrait').map(event => event.tone), ['neutral', 'characterSheet']);
});

test('une erreur 502 reprend seulement la vue manquante et réutilise les images terminées', async t => {
  const root = fixture(t);
  let failProfile = true;
  const calls = [];
  const events = [];
  const run = async (model, options) => {
    calls.push({model, options});
    if (model.startsWith('google/')) return [detailedSheetBundle];
    if (model === 'black-forest-labs/flux-2-pro' && options.input.prompt.includes('left side profile') && failProfile) {
      failProfile = false;
      throw new Error('status 502 Bad Gateway');
    }
    return `data:image/png;base64,${png.toString('base64')}`;
  };
  await assert.rejects(generateBundle(root, {name:'Ada',photo:'images/photo.png'}, run, event => events.push(event)), /502/);
  const neutral = events.find(event => event.type === 'portrait' && event.tone === 'neutral')?.path;
  const sheetViews = Object.fromEntries(events.filter(event => event.type === 'sheetView').map(event => [event.view, event.path]));
  assert.ok(neutral && existsSync(join(root, neutral)));
  assert.deepEqual(Object.keys(sheetViews).sort(), ['back', 'front']);
  assert.ok(Object.values(sheetViews).every(path => existsSync(join(root, path))));
  const callsBeforeResume = calls.length;
  const result = await generateBundle(root, {name:'Ada',photo:'images/photo.png',resume:{neutral,sheetViews}}, run);
  assert.ok(result.characterSheet && existsSync(join(root, result.characterSheet)));
  assert.ok(Object.values(sheetViews).every(path => !existsSync(join(root, path))));
  assert.deepEqual(calls.slice(callsBeforeResume).map(call => call.model),
    ['black-forest-labs/flux-2-pro', '851-labs/background-remover:a029dff38972b5fda4ec5d75d7d1cd25aeff621d2cf4946a41055d7db66b80bc', 'google/gemini-2.5-flash']);
});

test('après une erreur de description, la reprise ne relance aucune image', async t => {
  const root = fixture(t);
  let failuresRemaining = 2;
  const calls = [];
  const events = [];
  const run = async (model) => {
    calls.push(model);
    if (model.startsWith('google/')) {
      if (failuresRemaining > 0) { failuresRemaining--; throw new Error('status 502 Bad Gateway'); }
      return [detailedSheetBundle];
    }
    return `data:image/png;base64,${png.toString('base64')}`;
  };
  await assert.rejects(generateBundle(root, {name:'Ada',photo:'images/photo.png'}, run, event => events.push(event)), /502/);
  const neutral = events.find(event => event.type === 'portrait' && event.tone === 'neutral').path;
  const characterSheet = events.find(event => event.type === 'portrait' && event.tone === 'characterSheet').path;
  const resumedEvents = [];
  const result = await generateBundle(root, {name:'Ada',photo:'images/photo.png',resume:{neutral,characterSheet}}, run,
    event => resumedEvents.push(event));
  assert.equal(result.characterSheet, characterSheet);
  assert.equal(calls.filter(model => model === 'black-forest-labs/flux-2-pro').length, 4);
  assert.equal(resumedEvents.find(event => event.tone === 'characterSheet').reused, true);
});

test('une page HTML 502 de Replicate devient un message court sans HTML', () => {
  const error = new Error('Request failed with status 502 Bad Gateway: <!DOCTYPE html><html>...</html>');
  const message = providerErrorMessage(error);
  assert.match(message, /temporairement indisponible \(502\)/);
  assert.doesNotMatch(message, /DOCTYPE|<html>/);
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

test('une réponse groupée trop courte est réparée à partir des images', async t => {
  const root = fixture(t);
  const tones = avatar().tones;
  await assert.rejects(describeBundle(root, {tones}, async () => ['<html>Erreur</html>']), /format JSON/);
  let calls = 0;
  const short = JSON.stringify({...JSON.parse(detailedBundle), tonePrompts: {...JSON.parse(detailedBundle).tonePrompts, failure: 'Too short.'}});
  const result = await describeBundle(root, {tones}, async () => [++calls === 1 ? short : detailedBundle]);
  assert.equal(calls, 2);
  assert.equal(result.tonePrompts.failure, detailedDescription);
});

test('un texte visuel court reste utilisable si son approfondissement échoue', async t => {
  const root = fixture(t);
  const short = JSON.stringify({...JSON.parse(detailedBundle), tonePrompts: {...JSON.parse(detailedBundle).tonePrompts, failure: 'A front-facing portrait with a sympathetic expression.'}});
  let calls = 0;
  const result = await describeBundle(root, {tones: avatar().tones}, async () => {
    if (++calls === 1) return [short];
    throw new Error('Service indisponible');
  });
  assert.equal(calls, 3);
  assert.match(result.tonePrompts.failure, /sympathetic expression/);
});

test('enregistrer sans descriptions les retrouve depuis les portraits', async t => {
  const root = fixture(t);
  const item = avatar();
  item.tonePrompts = {neutral: 'Texte renseigné manuellement', success: '', failure: ''};
  item.description = '';
  item.speechPersonality = '';
  let calls = 0;
  await completeAvatarDescriptions(root, item, async () => { calls++; return [detailedBundle]; });
  assert.equal(calls, 1);
  assert.equal(item.tonePrompts.neutral, 'Texte renseigné manuellement');
  assert.equal(item.tonePrompts.success, detailedDescription);
  assert.equal(item.description, 'Portrait de Ada.');
  assert.equal(item.speechPersonality, 'Voix chaleureuse, débit posé et articulation nette.');
  assert.deepEqual(validateAvatar(item, root), []);
});

test('publication simultanée déjà présente sur GitHub est un succès', async () => {
  const calls = [];
  await pushPublishedHead(async (_command, args) => {
    calls.push(args[0]);
    if (args[0] === 'push') throw new Error('cannot lock ref');
    return {stdout: args[0] === 'rev-parse' ? 'abc\n' : 'abc\trefs/heads/main\n'};
  }, {});
  assert.deepEqual(calls, ['push', 'rev-parse', 'ls-remote']);
});

test('publication retente si le distant reste un ancêtre du commit local', async () => {
  const calls = [];
  await pushPublishedHead(async (_command, args) => {
    calls.push(args[0]);
    if (args[0] === 'push' && calls.filter(value => value === 'push').length === 1) throw new Error('cannot lock ref');
    return {stdout: args[0] === 'rev-parse' ? 'new\n' : 'old\trefs/heads/main\n'};
  }, {});
  assert.deepEqual(calls, ['push', 'rev-parse', 'ls-remote', 'fetch', 'merge-base', 'push']);
});

test('publication refuse de remplacer un historique distant divergent', async () => {
  const calls = [];
  await assert.rejects(pushPublishedHead(async (_command, args) => {
    calls.push(args[0]);
    if (args[0] === 'push' || args[0] === 'merge-base') throw new Error('diverged');
    return {stdout: args[0] === 'rev-parse' ? 'new\n' : 'other\trefs/heads/main\n'};
  }, {}), /Synchronisez le catalogue/);
  assert.equal(calls.filter(value => value === 'push').length, 1);
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
  for (const [name, gender] of Object.entries({Zephyr:'female', Achernar:'female', Algieba:'male', Gacrux:'female', Zubenelgenubi:'male'})) {
    assert.equal(availableVoices.find(voice => voice.name === name)?.gender, gender, `genre de ${name}`);
  }
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
