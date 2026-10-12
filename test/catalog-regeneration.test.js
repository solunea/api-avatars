import test from 'node:test';
import assert from 'node:assert/strict';
import {regenerateCatalog} from '../admin/catalog-regeneration.js';

function avatar(id = 'preset-ada') {
  return {id, name: id, schemaVersion: 2, photo: 'images/source.png', decor: '', preview: 'images/old-preview.png',
    tones: {neutral: 'images/old-neutral.png'}, tonePrompts: {neutral: 'Neutral manually corrected.'},
    characterSheet: 'images/old-sheet.png', characterSheetPrompt: 'Old sheet.',
    framingPrompts: {bust: 'Bust manually corrected.', fullBody: 'Full-body manually corrected.'},
    creationBrief: 'Gestes mesurés.', speechPersonality: 'Voix douce.', description: 'Description corrigée.', tags: ['guide']};
}
function clients() {
  const calls = [];
  return {calls,
    generate: async (options, event) => {
      calls.push({type: 'generate', options});
      event({type: 'portrait', tone: options.only, path: `images/new-${options.only}.png`, sheetRegions: {front: {}, profile: {}, back: {}}});
    },
    request: async (path, options) => {
      const body = JSON.parse(options.body);
      calls.push({type: path === '/api/describe' ? 'describe' : 'save', path, body});
      return path === '/api/describe' ? {tonePrompts: {neutral: 'New neutral.'},
        characterSheetPrompt: 'New sheet.', framingPrompts: {bust: 'New bust.', fullBody: 'New full body.'}}
        : {...body, updatedAt: 'updated'};
    }};
}

for (const target of ['characterSheet', 'neutral']) test(`${target} régénère uniquement l’image et les descriptions correspondantes puis enregistre`, async () => {
  const original = avatar();
  const tasks = [{avatar: structuredClone(original), status: 'pending'}];
  const client = clients();
  await regenerateCatalog(tasks, {target, ...client});
  assert.equal(tasks[0].status, 'done');
  assert.deepEqual(client.calls.map(call => call.type), ['generate', 'describe', 'save']);
  const options = client.calls[0].options;
  assert.equal(options.only, target); assert.equal(options.describe, false);
  assert.equal(options.creationBrief, original.creationBrief);
  assert.equal(options.resume.photo, original.photo);
  assert.equal(options.resume.neutral, target === 'characterSheet' ? original.tones.neutral : undefined);
  const saved = tasks[0].saved;
  if (target === 'characterSheet') {
    assert.equal(saved.characterSheet, 'images/new-characterSheet.png');
    assert.equal(saved.characterSheetPrompt, 'New sheet.');
    assert.equal(saved.framingPrompts.fullBody, 'New full body.');
    assert.equal(saved.framingPrompts.bust, original.framingPrompts.bust);
    assert.deepEqual(saved.tonePrompts, original.tonePrompts);
    assert.deepEqual(saved.tones, original.tones);
  } else {
    assert.equal(saved.tones.neutral, 'images/new-neutral.png');
    assert.equal(saved.preview, saved.tones.neutral);
    assert.equal(saved.tonePrompts.neutral, 'New neutral.');
    assert.equal(saved.framingPrompts.bust, 'New bust.');
    assert.equal(saved.characterSheet, original.characterSheet);
    assert.equal(saved.characterSheetPrompt, original.characterSheetPrompt);
    assert.equal(saved.framingPrompts.fullBody, original.framingPrompts.fullBody);
  }
  assert.equal(saved.description, original.description);
  assert.equal(saved.creationBrief, original.creationBrief);
  assert.equal(client.calls[2].path, '/api/avatars/preset-ada');
  assert.deepEqual(tasks[0].avatar, original);
});

test('une description en échec laisse la fiche intacte, poursuit les autres et reprend sans repayer l’image', async () => {
  const tasks = ['ada', 'nox'].map(name => ({avatar: avatar(`preset-${name}`), status: 'pending'}));
  const client = clients();
  let fail = true;
  const request = async (path, options) => {
    if (path === '/api/describe' && fail) { fail = false; throw new Error('Temporary failure'); }
    return client.request(path, options);
  };
  await regenerateCatalog(tasks, {target: 'characterSheet', ...client, request});
  assert.deepEqual(tasks.map(task => task.status), ['error', 'done']);
  assert.equal(tasks[0].avatar.characterSheet, 'images/old-sheet.png');
  assert.equal(client.calls.filter(call => call.type === 'save').length, 1);
  await regenerateCatalog(tasks, {target: 'characterSheet', ...client, request});
  assert.deepEqual(tasks.map(task => task.status), ['done', 'done']);
  assert.equal(client.calls.filter(call => call.type === 'generate').length, 2);
  assert.equal(client.calls.filter(call => call.type === 'save').length, 2);
});

test('arrêter termine et enregistre l’avatar en cours sans lancer le suivant', async () => {
  const tasks = ['ada', 'nox'].map(name => ({avatar: avatar(`preset-${name}`), status: 'pending'}));
  const client = clients();
  let stop = false;
  await regenerateCatalog(tasks, {target: 'neutral', ...client, shouldStop: () => stop,
    onProgress: task => { if (task.status === 'generating') stop = true; }});
  assert.deepEqual(tasks.map(task => task.status), ['done', 'pending']);
  assert.equal(client.calls.filter(call => call.type === 'generate').length, 1);
});

test('la conversion d’une fiche ancienne conserve le buste, l’ADN et la voix', async () => {
  const old = avatar(); old.schemaVersion = 1;
  delete old.framingPrompts; delete old.characterSheet;
  const tasks = [{avatar: old, status: 'pending'}];
  await regenerateCatalog(tasks, {target: 'characterSheet', ...clients()});
  assert.equal(tasks[0].status, 'done');
  assert.equal(tasks[0].saved.schemaVersion, 2);
  assert.equal(tasks[0].saved.framingPrompts.bust, old.tonePrompts.neutral);
  assert.equal(tasks[0].saved.speechPersonality, old.speechPersonality);
});

test('une sauvegarde en échec est reprise sans régénérer ni redécrire', async () => {
  const tasks = [{avatar: avatar(), status: 'pending'}];
  const client = clients(); let fail = true;
  const request = async (path, options) => {
    if (path.startsWith('/api/avatars/') && fail) { fail = false; throw new Error('Save failure'); }
    return client.request(path, options);
  };
  await regenerateCatalog(tasks, {target: 'neutral', ...client, request});
  assert.equal(tasks[0].status, 'error');
  await regenerateCatalog(tasks, {target: 'neutral', ...client, request});
  assert.equal(tasks[0].status, 'done');
  assert.equal(client.calls.filter(call => call.type === 'generate').length, 1);
  assert.equal(client.calls.filter(call => call.type === 'describe').length, 1);
});

for (const target of ['characterSheet', 'neutral']) test(`${target} redemande une description incomplète sans régénérer l’image`, async () => {
  const tasks = [{avatar: avatar(), status: 'pending'}];
  const client = clients();
  let attempts = 0;
  const request = async (path, options) => {
    if (path === '/api/describe' && ++attempts === 1) return {tonePrompts: {}, framingPrompts: {}};
    return client.request(path, options);
  };
  await regenerateCatalog(tasks, {target, ...client, request});
  assert.equal(tasks[0].status, 'error');
  assert.equal(tasks[0].details, undefined);
  assert.equal(client.calls.filter(call => call.type === 'save').length, 0);
  await regenerateCatalog(tasks, {target, ...client, request});
  assert.equal(tasks[0].status, 'done');
  assert.equal(attempts, 2);
  assert.equal(client.calls.filter(call => call.type === 'generate').length, 1);
});

test('seule la description correspondant à l’image régénérée cesse d’être signalée comme ancienne', async () => {
  const original = {...avatar(), descriptionsOutdated: true, outdatedDescriptions: ['bust', 'fullBody']};
  const tasks = [{avatar: original, status: 'pending'}];
  await regenerateCatalog(tasks, {target: 'characterSheet', ...clients()});
  assert.deepEqual(tasks[0].saved.outdatedDescriptions, ['bust']);
  assert.equal(tasks[0].saved.descriptionsOutdated, true);
  const next = [{avatar: tasks[0].saved, status: 'pending'}];
  await regenerateCatalog(next, {target: 'neutral', ...clients()});
  assert.deepEqual(next[0].saved.outdatedDescriptions, []);
  assert.equal(next[0].saved.descriptionsOutdated, false);
});
