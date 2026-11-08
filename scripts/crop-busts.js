import {randomUUID} from 'node:crypto';
import {readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {readCatalog, saveCatalog, mediaPath, validateAvatar} from '../lib/catalog.js';
import {cropBust} from '../lib/bust-crop.js';

const root = process.env.API_AVATAR_ROOT || fileURLToPath(new URL('..', import.meta.url));
const catalogFile = join(root, 'data', 'avatars.json');
const snapshot = readFileSync(catalogFile, 'utf8');
const avatars = readCatalog(root);
const replacements = new Map();
const outputs = new Map();
const changed = [];

for (const avatar of avatars) {
  const errors = validateAvatar(avatar, root);
  if (errors.length) throw new Error(`${avatar.id} : ${errors.join(', ')}`);
  if (avatar.decor) continue;

  const busts = new Set([avatar.preview, ...Object.values(avatar.tones || {})].filter(Boolean));
  for (const path of busts) {
    if (replacements.has(path)) continue;
    const target = mediaPath(root, path);
    if (!target) throw new Error(`${avatar.id} : buste invalide (${path})`);
    const source = readFileSync(target);
    const cropped = await cropBust(source);
    const replacement = cropped === source ? path : `images/${randomUUID()}.png`;
    replacements.set(path, replacement);
    if (replacement !== path) outputs.set(replacement, cropped);
  }

  if ([...busts].every(path => replacements.get(path) === path)) continue;
  avatar.preview = replacements.get(avatar.preview);
  for (const [tone, path] of Object.entries(avatar.tones || {})) {
    if (replacements.has(path)) avatar.tones[tone] = replacements.get(path);
  }
  // Garder le dernier index CLIP avec son empreinte réelle jusqu'à sa prochaine indexation.
  avatar.updatedAt = new Date().toISOString();
  changed.push(avatar.name);
}

if (changed.length) {
  if (readFileSync(catalogFile, 'utf8') !== snapshot) throw new Error('Le catalogue a changé pendant le recadrage. Relancez la commande.');
  for (const [path, buffer] of outputs) writeFileSync(join(root, path), buffer, {flag: 'wx'});
  saveCatalog(root, avatars);
  console.log(changed.join(', '));
}
console.log(`${outputs.size} buste(s) recadré(s) sur ${changed.length} fiche(s).`);
