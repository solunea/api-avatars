import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import Replicate from 'replicate';
import {mkdirSync, copyFileSync, rmSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {buildCatalog, readCatalog, saveCatalog, validateAvatar, mediaPath, voices, normalizeSpeechPersonality} from './lib/catalog.js';
import {generateBundle} from './lib/generation.js';

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
  response.status(400).json({error: error.message || String(error)});
}

function cleanAvatar(input, previous) {
  const id = previous?.id || `preset-${String(input.name || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}`;
  return {
    id, name: String(input.name || '').trim(), description: String(input.description || '').trim(),
    voiceKey: String(input.voiceKey || ''), speechPersonality: normalizeSpeechPersonality(input.speechPersonality),
    photo: String(input.photo || ''), decor: String(input.decor || ''),
    preview: String(input.preview || ''), styleId: String(input.styleId || ''),
    tones: Object.fromEntries(['neutral', 'success', 'failure'].map(tone => [tone, String(input.tones?.[tone] || '')])),
    tonePrompts: Object.fromEntries(['neutral', 'success', 'failure'].map(tone => [tone, String(input.tonePrompts?.[tone] || '').trim()])),
    preset: true, createdAt: previous?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString()
  };
}
function avatarMedia(avatar) {
  return [avatar.photo, avatar.decor, avatar.preview, ...Object.values(avatar.tones || {})].filter(Boolean);
}
function removeUnusedMedia(previous, remaining) {
  const used = new Set(remaining.flatMap(avatarMedia));
  for (const path of new Set(avatarMedia(previous))) {
    if (used.has(path)) continue;
    const target = mediaPath(root, path);
    if (target) rmSync(target, {force: true});
  }
}

app.get('/api/voices', (_request, response) => response.json(voices.map(name => `gemini:${name}`)));
app.get('/api/avatars', (_request, response) => response.json(readCatalog(root)));
app.get('/api/avatars/:id', (request, response) => {
  const avatar = readCatalog(root).find(item => item.id === request.params.id);
  response.status(avatar ? 200 : 404).json(avatar || {error: 'Avatar introuvable'});
});
app.post('/api/avatars', (request, response) => {
  try {
    const avatars = readCatalog(root);
    const avatar = cleanAvatar(request.body);
    if (avatars.some(item => item.id === avatar.id)) return response.status(409).json({error: 'Cet identifiant existe déjà'});
    const errors = validateAvatar(avatar, root);
    if (errors.length) return response.status(400).json({error: errors.join(', ')});
    saveCatalog(root, avatars.concat(avatar));
    response.status(201).json(avatar);
  } catch (error) { mediaResponse(response, error); }
});
app.put('/api/avatars/:id', (request, response) => {
  try {
    const avatars = readCatalog(root);
    const index = avatars.findIndex(item => item.id === request.params.id);
    if (index === -1) return response.status(404).json({error: 'Avatar introuvable'});
    const previous = avatars[index];
    const avatar = cleanAvatar(request.body, previous);
    const errors = validateAvatar(avatar, root);
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

app.post('/api/generate', async (request, response) => {
  try {
    if (!process.env.REPLICATE_API_TOKEN) return response.status(503).json({error: 'REPLICATE_API_TOKEN non configuré'});
    const replicate = new Replicate({auth: process.env.REPLICATE_API_TOKEN});
    response.json(await generateBundle(root, request.body, (...args) => replicate.run(...args)));
  } catch (error) { response.status(502).json({error: error.message || String(error)}); }
});

app.post('/api/build', (_request, response) => {
  try { response.json({count: buildCatalog(root).length}); }
  catch (error) { mediaResponse(response, error); }
});
app.post('/api/push', async (_request, response) => {
  try {
    buildCatalog(root);
    const options = {cwd: root, timeout: 120000, env: {...process.env, GIT_TERMINAL_PROMPT: '0'}};
    const remote = (await runGit('git', ['remote', 'get-url', 'origin'], options)).stdout.trim();
    if (!/github\.com[:/]solunea\/api-avatars(?:\.git)?$/i.test(remote)) throw new Error('Configurez origin vers solunea/api-avatars avant de publier');
    await runGit('git', ['add', 'data', 'api', 'images'], options);
    const status = (await runGit('git', ['diff', '--cached', '--name-only'], options)).stdout.trim();
    if (!status) return response.json({message: 'Aucun changement à publier'});
    await runGit('git', ['commit', '-m', `Update avatars ${new Date().toISOString()}`], options);
    await runGit('git', ['push', 'origin', 'HEAD:main'], options);
    response.json({message: 'Catalogue publié'});
  } catch (error) { response.status(500).json({error: error.stderr || error.message || String(error)}); }
});

app.use((error, _request, response, _next) => response.status(400).json({error: error.message || String(error)}));
app.listen(port, '127.0.0.1', () => console.log(`Avatar admin: http://127.0.0.1:${port}`));
