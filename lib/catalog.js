import {readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, rmSync} from 'node:fs';
import {join, resolve, extname} from 'node:path';
import {normalizeClipFeature} from './clip-features.js';

export const voices = ['Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir', 'Leda', 'Orus', 'Aoede', 'Callirrhoe', 'Autonoe', 'Enceladus', 'Iapetus', 'Umbriel', 'Algenib', 'Despina', 'Erinome', 'Laomedeia', 'Achernar', 'Algieba', 'Schedar', 'Gacrux', 'Pulcherrima', 'Achird', 'Zubenelgenubi', 'Vindemiatrix', 'Sadachbia', 'Sadaltager', 'Sulafat', 'Alnilam', 'Rasalgethi'];
// Aligné sur le genre des échantillons Chirp 3 HD utilisés pour l'écoute dans l'administration.
// https://docs.cloud.google.com/text-to-speech/docs/chirp3-hd#voice_options
export const voiceGenders = {
  Zephyr:'female', Puck:'male', Charon:'male', Kore:'female', Fenrir:'male', Leda:'female', Orus:'male', Aoede:'female', Callirrhoe:'female', Autonoe:'female',
  Enceladus:'male', Iapetus:'male', Umbriel:'male', Algenib:'male', Despina:'female', Erinome:'female', Laomedeia:'female', Achernar:'female', Algieba:'male',
  Schedar:'male', Gacrux:'female', Pulcherrima:'female', Achird:'male', Zubenelgenubi:'male', Vindemiatrix:'female', Sadachbia:'male', Sadaltager:'male',
  Sulafat:'female', Alnilam:'male', Rasalgethi:'male'
};
const requiredMedia = ['photo', 'preview'];
const tones = ['neutral', 'success', 'failure'];
export const sheetRegionNames = ['front', 'profile', 'back'];
export const defaultSheetRegions = {
  front: {x: 0, y: 0, width: 1 / 3, height: 1},
  profile: {x: 1 / 3, y: 0, width: 1 / 3, height: 1},
  back: {x: 2 / 3, y: 0, width: 1 / 3, height: 1}
};

export function normalizeSpeechPersonality(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 300);
}

// Même contrat que le manifeste Cannelle : trois consignes textuelles cachées.
const defaultPoses = {
  neutral: 'Stand naturally facing the camera, shoulders relaxed and hands resting comfortably, with a calm attentive expression.',
  success: 'Give one encouraging thumbs-up with a pleased smile; for a reserved character use a discreet thumbs-up near the torso, for an energetic character a more expressive celebratory thumbs-up.',
  failure: 'Offer one gentle open hand toward the learner with a sympathetic, reassuring expression; keep the gesture restrained or more expressive according to the character personality, inviting another attempt.'
};
export function normalizeAvatarPosePrompts(value) {
  return Object.fromEntries(Object.entries(defaultPoses).map(([tone, fallback]) => {
    const pose = typeof value?.[tone] === 'string' ? value[tone].replace(/\s+/g, ' ').trim().slice(0, 800) : '';
    return [tone, pose || fallback];
  }));
}

export function normalizeAvatarTags(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(tag => String(tag || '').toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(tag => tag.length >= 3 && tag.length <= 40))].slice(0, 20);
}

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
  if (avatar.speechPersonality !== undefined && (typeof avatar.speechPersonality !== 'string' || avatar.speechPersonality.length > 300)) errors.push('personnalité vocale invalide');
  if (avatar.posePrompts !== undefined && (!avatar.posePrompts || typeof avatar.posePrompts !== 'object'
    || Array.isArray(avatar.posePrompts) || tones.some(tone => typeof avatar.posePrompts[tone] !== 'string'
      || !avatar.posePrompts[tone].trim() || avatar.posePrompts[tone].length > 800))) errors.push('prompts de pose invalides');
  if (avatar.tags !== undefined && (!Array.isArray(avatar.tags) || avatar.tags.length > 20
    || avatar.tags.some(tag => typeof tag !== 'string' || tag.length < 3 || tag.length > 40))) errors.push('tags invalides');
  if (avatar.clip !== undefined && !normalizeClipFeature(avatar.clip)) errors.push('index CLIP invalide');
  for (const field of requiredMedia) {
    const path = mediaPath(root, avatar[field]);
    if (!path || !existsSync(path)) errors.push(`${field} manquant`);
  }
  if (avatar.decor) {
    const path = mediaPath(root, avatar.decor);
    if (!path || !existsSync(path)) errors.push('decor manquant');
  }
  const version = Number(avatar.schemaVersion || 1);
  if (![1, 2].includes(version)) errors.push('schemaVersion invalide');
  for (const tone of version === 2 ? ['neutral'] : tones) {
    const path = mediaPath(root, avatar.tones?.[tone]);
    if (!path || !existsSync(path)) errors.push(`ton ${tone} manquant`);
    if (!String(avatar.tonePrompts?.[tone] || '').trim()) errors.push(`description ${tone} manquante`);
  }
  if (version === 2) {
    const sheet = mediaPath(root, avatar.characterSheet);
    if (!sheet || !existsSync(sheet)) errors.push('planche manquante');
    if (!String(avatar.characterSheetPrompt || '').trim()) errors.push('description de planche manquante');
    for (const framing of ['bust', 'fullBody']) {
      if (!String(avatar.framingPrompts?.[framing] || '').trim()) errors.push(`description ${framing} manquante`);
    }
    for (const name of new Set([...sheetRegionNames, ...Object.keys(avatar.sheetRegions || {})])) {
      const r = avatar.sheetRegions?.[name];
      if (!r || ![r.x, r.y, r.width, r.height].every(value => typeof value === 'number' && Number.isFinite(value))
        || r.x < 0 || r.y < 0 || r.width <= 0 || r.height <= 0 || r.x + r.width > 1.000001 || r.y + r.height > 1.000001) {
        errors.push(`zone ${name} invalide`);
      }
    }
  } else {
    if (avatar.tones?.success && avatar.tones.success === avatar.tones?.neutral) errors.push('image success identique au ton neutral');
    if (avatar.tones?.failure && [avatar.tones?.neutral, avatar.tones?.success].includes(avatar.tones.failure)) errors.push('image failure identique à un autre ton');
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
  const index = avatars.map(({id, name, description, tags, clip, preview, decor, voiceKey, speechPersonality, updatedAt, schemaVersion, characterSheet, sheetRegions}) => ({
    id, name, description: description || '', tags: normalizeAvatarTags(tags), preview, decor: decor || '', voiceKey,
    clip:normalizeClipFeature(clip),
    speechPersonality: speechPersonality || '', updatedAt, schemaVersion: Number(schemaVersion || 1),
    hasCharacterSheet: Number(schemaVersion) >= 2 && !!characterSheet && !!sheetRegions
  }));
  writeFileSync(join(api, 'avatars.json'), JSON.stringify(index, null, 2) + '\n');
  for (const avatar of avatars) writeFileSync(join(detail, `${avatar.id}.json`), JSON.stringify(avatar, null, 2) + '\n');
  for (const file of readdirSync(detail)) {
    if (extname(file) === '.json' && !ids.has(file.slice(0, -5))) rmSync(join(detail, file));
  }
  return index;
}
