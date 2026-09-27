import {readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, rmSync} from 'node:fs';
import {join, resolve, extname} from 'node:path';

export const voices = ['Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir', 'Leda', 'Orus', 'Aoede', 'Callirrhoe', 'Autonoe', 'Enceladus', 'Iapetus', 'Umbriel', 'Algenib', 'Despina', 'Erinome', 'Laomedeia', 'Achernar', 'Algieba', 'Schedar', 'Gacrux', 'Pulcherrima', 'Achird', 'Zubenelgenubi', 'Vindemiatrix', 'Sadachbia', 'Sadaltager', 'Sulafat', 'Alnilam', 'Rasalgethi'];
const requiredMedia = ['photo', 'preview'];
const tones = ['neutral', 'success', 'failure'];

export function mediaPath(root, value) {
  if (typeof value !== 'string' || !/^images\/[a-zA-Z0-9][a-zA-Z0-9._/-]*\.(png|jpe?g|webp)$/.test(value) || value.includes('..')) return null;
  const target = resolve(root, value);
  return target.startsWith(resolve(root, 'images') + '\\') || target.startsWith(resolve(root, 'images') + '/') ? target : null;
}

export function validateAvatar(avatar, root) {
  const errors = [];
  if (!avatar || typeof avatar !== 'object') return ['Avatar invalide'];
  if (!/^preset-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(avatar.id || '')) errors.push('id invalide');
  if (!String(avatar.name || '').trim()) errors.push('nom requis');
  if (!voices.includes(String(avatar.voiceKey || '').replace(/^gemini:/, '')) || !String(avatar.voiceKey || '').startsWith('gemini:')) errors.push('voix Gemini invalide');
  for (const field of requiredMedia) {
    const path = mediaPath(root, avatar[field]);
    if (!path || !existsSync(path)) errors.push(`${field} manquant`);
  }
  if (avatar.decor) {
    const path = mediaPath(root, avatar.decor);
    if (!path || !existsSync(path)) errors.push('decor manquant');
  }
  for (const tone of tones) {
    const path = mediaPath(root, avatar.tones?.[tone]);
    if (!path || !existsSync(path)) errors.push(`ton ${tone} manquant`);
    if (!String(avatar.tonePrompts?.[tone] || '').trim()) errors.push(`description ${tone} manquante`);
  }
  return errors;
}

export function readCatalog(root) {
  const data = JSON.parse(readFileSync(join(root, 'data', 'avatars.json'), 'utf8'));
  if (!Array.isArray(data)) throw new Error('data/avatars.json doit contenir un tableau');
  return data;
}

export function saveCatalog(root, avatars) {
  writeFileSync(join(root, 'data', 'avatars.json'), JSON.stringify(avatars, null, 2) + '\n');
  buildCatalog(root, avatars);
}

export function buildCatalog(root, avatars = readCatalog(root)) {
  const ids = new Set();
  for (const avatar of avatars) {
    const errors = validateAvatar(avatar, root);
    if (ids.has(avatar.id)) errors.push('id dupliqué');
    ids.add(avatar.id);
    if (errors.length) throw new Error(`${avatar.id || 'avatar'} : ${errors.join(', ')}`);
  }
  const api = join(root, 'api');
  const detail = join(api, 'avatars');
  mkdirSync(detail, {recursive: true});
  const index = avatars.map(({id, name, description, preview, decor, voiceKey, updatedAt}) => ({id, name, description: description || '', preview, decor: decor || '', voiceKey, updatedAt}));
  writeFileSync(join(api, 'avatars.json'), JSON.stringify(index, null, 2) + '\n');
  for (const avatar of avatars) writeFileSync(join(detail, `${avatar.id}.json`), JSON.stringify(avatar, null, 2) + '\n');
  for (const file of readdirSync(detail)) {
    if (extname(file) === '.json' && !ids.has(file.slice(0, -5))) rmSync(join(detail, file));
  }
  return index;
}
