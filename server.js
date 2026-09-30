import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import Replicate from 'replicate';
import sharp from 'sharp';
import {mkdirSync, copyFileSync, rmSync, readFileSync, writeFileSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {buildCatalog, readCatalog, saveCatalog, validateAvatar, mediaPath, voices, voiceGenders, normalizeSpeechPersonality, normalizeAvatarTags, normalizeAvatarPosePrompts, defaultSheetRegions} from './lib/catalog.js';
import {generateBundle, describeBundle, describeSheetBundle, completeAvatarDescriptions, describeAvatarTags, removeCharacterSheetBackground} from './lib/generation.js';
import {pushPublishedHead} from './lib/git-publish.js';
import {providerErrorMessage} from './lib/provider-error.js';

const projectDir = dirname(fileURLToPath(import.meta.url));
const root = process.env.API_AVATAR_ROOT || projectDir;
const imagesDir = join(root, 'images');
const uploadDir = join(root, 'uploads');
const port = Number(process.env.PORT) || 3005;
mkdirSync(imagesDir, {recursive: true});
mkdirSync(uploadDir, {recursive: true});
const app = express();
const upload = multer({dest: uploadDir, limits: {fileSize: 10 * 1024 * 1024}});
const runGit = promisify(execFile);
app.use(express.json({limit: '1mb'}));
app.use((request, response, next) => {
  const origin = request.get('origin');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && origin) {
    try {
      const source = new URL(origin);
      if (!['localhost', '127.0.0.1'].includes(source.hostname) || Number(source.port || 80) !== port) {
        return response.status(403).json({error: 'Origine non autorisée'});
      }
    } catch { return response.status(403).json({error: 'Origine non autorisée'}); }
  }
  next();
});
app.use(express.static(join(projectDir, 'admin')));
app.use('/images', express.static(imagesDir));
app.use('/api', express.static(join(root, 'api')));

function mediaResponse(response, error) {
  response.status(400).json({error: providerErrorMessage(error)});
}

function cleanAvatar(input, previous) {
  const id = previous?.id || `preset-${String(input.name || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}`;
  const schemaVersion = Number(input.schemaVersion || (input.characterSheet ? 2 : previous?.schemaVersion || 1));
  const toneNames = schemaVersion === 2 ? ['neutral'] : ['neutral', 'success', 'failure'];
  return {
    id, schemaVersion, name: String(input.name || '').trim(), description: String(input.description || '').trim(),
    tags: normalizeAvatarTags(input.tags === undefined ? previous?.tags : input.tags),
    voiceKey: String(input.voiceKey || ''), speechPersonality: normalizeSpeechPersonality(input.speechPersonality),
    posePrompts: input.posePrompts || previous?.posePrompts
      ? normalizeAvatarPosePrompts(input.posePrompts || previous.posePrompts) : undefined,
    photo: String(input.photo || ''), decor: String(input.decor || ''),
    preview: String(input.preview || ''), styleId: String(input.styleId || ''),
    tones: Object.fromEntries(toneNames.map(tone => [tone, String(input.tones?.[tone] || '')])),
    tonePrompts: Object.fromEntries(toneNames.map(tone => [tone, String(input.tonePrompts?.[tone] || '').trim()])),
    ...(schemaVersion === 2 ? {
      characterSheet: String(input.characterSheet || ''), characterSheetPrompt: String(input.characterSheetPrompt || '').trim(),
      sheetRegions: input.sheetRegions || defaultSheetRegions,
      framingPrompts: {bust: String(input.framingPrompts?.bust || '').trim(), fullBody: String(input.framingPrompts?.fullBody || '').trim()}
    } : {}),
    preset: true, createdAt: previous?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString()
  };
}
function avatarMedia(avatar) {
  return [avatar.photo, avatar.decor, avatar.preview, avatar.characterSheet, ...Object.values(avatar.tones || {})].filter(Boolean);
}
function removeUnusedMedia(previous, remaining) {
  const used = new Set(remaining.flatMap(avatarMedia));
  for (const path of new Set(avatarMedia(previous))) {
    if (used.has(path)) continue;
    const target = mediaPath(root, path);
    if (target) rmSync(target, {force: true});
  }
}

app.get('/api/voices', (_request, response) => response.json(voices.map(name => ({key:`gemini:${name}`, name, gender:voiceGenders[name]}))));
app.get('/api/avatars', (_request, response) => response.json(readCatalog(root)));
app.get('/api/avatars/:id', (request, response) => {
  const avatar = readCatalog(root).find(item => item.id === request.params.id);
  response.status(avatar ? 200 : 404).json(avatar || {error: 'Avatar introuvable'});
});
async function prepareAvatar(avatar) {
  const errors = validateAvatar(avatar, root).filter(error => !/^description (neutral|success|failure|bust|fullBody|de planche) manquante$/.test(error));
  if (errors.length) return errors;
  const missingDescriptions = Object.values(avatar.tonePrompts).some(prompt => !prompt) || (avatar.schemaVersion === 2 &&
    (!avatar.characterSheetPrompt || !avatar.framingPrompts.bust || !avatar.framingPrompts.fullBody || !avatar.description || !avatar.speechPersonality));
  if (missingDescriptions || !avatar.tags.length) {
    if (!process.env.REPLICATE_API_TOKEN) return ['REPLICATE_API_TOKEN requis pour décrire les portraits et générer leurs tags'];
    const replicate = new Replicate({auth: process.env.REPLICATE_API_TOKEN});
    const run = (...args) => replicate.run(...args);
    if (missingDescriptions) await completeAvatarDescriptions(root, avatar, run);
    if (!avatar.tags.length) avatar.tags = await describeAvatarTags(root, avatar, run);
  }
  // Un import entièrement décrit reste possible sans jeton ; les créations IA
  // fournissent leurs poses personnalisées, les anciens fichiers un repli.
  avatar.posePrompts = normalizeAvatarPosePrompts(avatar.posePrompts);
  return validateAvatar(avatar, root);
}

app.post('/api/avatars', async (request, response) => {
  try {
    const avatars = readCatalog(root);
    const avatar = cleanAvatar(request.body);
    if (avatars.some(item => item.id === avatar.id)) return response.status(409).json({error: 'Cet identifiant existe déjà'});
    const errors = await prepareAvatar(avatar);
    if (errors.length) return response.status(400).json({error: errors.join(', ')});
    saveCatalog(root, avatars.concat(avatar));
    response.status(201).json(avatar);
  } catch (error) { mediaResponse(response, error); }
});
app.put('/api/avatars/:id', async (request, response) => {
  try {
    const avatars = readCatalog(root);
    const index = avatars.findIndex(item => item.id === request.params.id);
    if (index === -1) return response.status(404).json({error: 'Avatar introuvable'});
    const previous = avatars[index];
    const avatar = cleanAvatar(request.body, previous);
    const errors = await prepareAvatar(avatar);
    if (errors.length) return response.status(400).json({error: errors.join(', ')});
    avatars[index] = avatar;
    saveCatalog(root, avatars);
    removeUnusedMedia(previous, avatars);
    response.json(avatar);
  } catch (error) { mediaResponse(response, error); }
});
app.delete('/api/avatars/:id', (request, response) => {
  const avatars = readCatalog(root);
  const deleted = avatars.find(item => item.id === request.params.id);
  if (!deleted) return response.status(404).json({error: 'Avatar introuvable'});
  const remaining = avatars.filter(item => item.id !== request.params.id);
  saveCatalog(root, remaining);
  removeUnusedMedia(deleted, remaining);
  response.json({ok: true});
});
app.post('/api/upload', upload.single('image'), (request, response) => {
  if (!request.file) return response.status(400).json({error: 'Image manquante'});
  const extension = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' }[request.file.mimetype];
  if (!extension) {
    rmSync(request.file.path);
    return response.status(400).json({error: 'Utilisez une image PNG, JPEG ou WebP'});
  }
  const path = `images/${randomUUID()}${extension}`;
  copyFileSync(request.file.path, join(root, path));
  rmSync(request.file.path);
  response.json({path});
});

app.post('/api/remove-sheet-background', async (request, response) => {
  try {
    const source = mediaPath(root, request.body?.characterSheet);
    if (!source) return response.status(400).json({error: 'Planche invalide'});
    const original = readFileSync(source);
    const alpha = (await sharp(original).ensureAlpha().stats()).channels[3];
    if (alpha.min === 0 && alpha.mean < 250) {
      return response.json({path: request.body.characterSheet});
    }
    if (!process.env.REPLICATE_API_TOKEN) return response.status(503).json({error: 'REPLICATE_API_TOKEN non configuré'});
    const replicate = new Replicate({auth: process.env.REPLICATE_API_TOKEN});
    const buffer = await removeCharacterSheetBackground(original, (...args) => replicate.run(...args));
    const path = `images/${randomUUID()}.png`;
    writeFileSync(join(root, path), buffer);
    response.json({path});
  } catch (error) { mediaResponse(response, error); }
});

app.post('/api/generate', async (request, response) => {
  const streaming = request.accepts(['application/x-ndjson', 'json']) === 'application/x-ndjson';
  try {
    if (!process.env.REPLICATE_API_TOKEN) return response.status(503).json({error: 'REPLICATE_API_TOKEN non configuré'});
    const replicate = new Replicate({auth: process.env.REPLICATE_API_TOKEN});
    if (streaming) {
      response.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
      response.setHeader('Cache-Control', 'no-cache, no-transform');
      response.flushHeaders();
    }
    const result = await generateBundle(root, request.body, (...args) => replicate.run(...args), event => {
      if (streaming && !response.destroyed) response.write(`${JSON.stringify(event)}\n`);
    });
    if (streaming) response.end(`${JSON.stringify({type: 'complete'})}\n`);
    else response.json(result);
  } catch (error) {
    if (streaming && response.headersSent) response.end(`${JSON.stringify({type: 'error', error: providerErrorMessage(error)})}\n`);
    else response.status(502).json({error: providerErrorMessage(error)});
  }
});

app.post('/api/describe', async (request, response) => {
  try {
    if (!process.env.REPLICATE_API_TOKEN) return response.status(503).json({error: 'REPLICATE_API_TOKEN non configuré'});
    const replicate = new Replicate({auth: process.env.REPLICATE_API_TOKEN});
    response.json(await (Number(request.body.schemaVersion) === 2 || request.body.characterSheet ? describeSheetBundle : describeBundle)
      (root, request.body, (...args) => replicate.run(...args)));
  } catch (error) { response.status(502).json({error: providerErrorMessage(error)}); }
});

app.post('/api/build', (_request, response) => {
  try { response.json({count: buildCatalog(root).length}); }
  catch (error) { mediaResponse(response, error); }
});
app.post('/api/push', async (_request, response) => {
  try {
    buildCatalog(root);
    if (readCatalog(root).some(avatar => Number(avatar.schemaVersion) === 2)
        && process.env.ALLOW_V2_PUBLISH !== 'true') {
      throw new Error('Publication v2 en attente du déploiement de Cannelle. Définissez ALLOW_V2_PUBLISH=true après ce déploiement.');
    }
    const options = {cwd: root, timeout: 120000, env: {...process.env, GIT_TERMINAL_PROMPT: '0'}};
    const remote = (await runGit('git', ['remote', 'get-url', 'origin'], options)).stdout.trim();
    if (!/github\.com[:/]solunea\/api-avatars(?:\.git)?$/i.test(remote)) throw new Error('Configurez origin vers solunea/api-avatars avant de publier');
    const publishedMedia = [...new Set(readCatalog(root).flatMap(avatarMedia))];
    await runGit('git', ['add', 'data', 'api'], options);
    await runGit('git', ['add', '-u', 'images'], options);
    if (publishedMedia.length) await runGit('git', ['add', '--', ...publishedMedia], options);
    const status = (await runGit('git', ['diff', '--cached', '--name-only'], options)).stdout.trim();
    if (!status) return response.json({message: 'Aucun changement à publier'});
    await runGit('git', ['commit', '-m', `Update avatars ${new Date().toISOString()}`], options);
    await pushPublishedHead(runGit, options);
    response.json({message: 'Catalogue publié'});
  } catch (error) { response.status(500).json({error: error.stderr || error.message || String(error)}); }
});

app.use((error, _request, response, _next) => response.status(400).json({error: error.message || String(error)}));
app.listen(port, '127.0.0.1', () => console.log(`Avatar admin: http://127.0.0.1:${port}`));
