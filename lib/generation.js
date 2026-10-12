import {readFileSync, writeFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {mediaPath, normalizeAvatarTags, normalizeAvatarPosePrompts, defaultSheetRegions} from './catalog.js';
import {removeWhiteFringe} from './matte.js';
import sharp from 'sharp';
import {generateAvatarImage} from './image-generation.js';
import {fitCharacterSheet} from './sheet-layout.js';
import {portraitPrompt, creationSourcePrompt, creationSheetPrompt, describeCreationImages, poseDirectionsPrompt,
  CREATION_PORTRAIT_OPTIONS, CREATION_SHEET_OPTIONS, CREATION_BG_MODEL, CREATION_BG_VERSION, CREATION_BG_INPUT,
  AVATAR_ANATOMY_PROMPT, AVATAR_EQUIPMENT_PROMPT} from './creation-contract.js';
export {portraitPrompt} from './creation-contract.js';

function imageBuffer(root, path) {
  const target = mediaPath(root, path);
  if (!target || !existsSync(target)) throw new Error(`Image introuvable : ${path}`);
  return readFileSync(target);
}

async function outputBuffer(output) {
  const item = Array.isArray(output) ? output[0] : output;
  const url = typeof item?.url === 'function' ? item.url() : item;
  const result = await fetch(String(url));
  if (!result.ok) throw new Error('Le média généré est inaccessible');
  return Buffer.from(await result.arrayBuffer());
}

function writeGenerated(root, buffer) {
  const path = `images/${randomUUID()}.png`;
  writeFileSync(join(root, path), buffer);
  return path;
}

export function portraitDescriptionPrompt(hasDecor = false) {
  return 'Write a 170 to 220 word English text-to-image prompt describing this avatar portrait. '
    + 'Include the visible face, eyes, eyebrows, facial hair, hairstyle or headwear, glasses, clothing colors and materials, exact facial expression, frontal pose, framing, and lighting. '
    + 'Describe only what you can see; avoid guessing ethnicity, occupation, or unseen details. Keep the same character recognizable. '
    + `${AVATAR_ANATOMY_PROMPT} ${AVATAR_EQUIPMENT_PROMPT} Describe visible non-human features and carried equipment precisely; human features in the requested list apply only if present. `
    + (hasDecor
      ? 'Describe the visible setting and its colors and objects precisely, and preserve it. '
      : 'This image has a transparent background: explicitly request an isolated subject on transparency and no scenery or backdrop. ')
    + 'Write one complete paragraph.';
}

export async function describePortrait(run, buffer, hasDecor = false) {
  const output = await run('google/gemini-2.5-flash', {input: {
    images: [buffer], prompt: portraitDescriptionPrompt(hasDecor), thinking_budget: 0, max_output_tokens: 3000
  }});
  const text = (Array.isArray(output) ? output.join('') : String(output || '')).replace(/\s+/g, ' ').trim();
  if (text.split(/\s+/).length < 120) throw new Error('Description IA trop courte pour servir de référence text-to-image ; réessayez ou renseignez-la manuellement.');
  return text;
}

/** Les poses sont proposées dans le même appel que la description et la voix. */
export async function describeBundle(root, {tones, decor, name, voiceKey, speechPersonality:personalityDirection = ''}, run) {
  const paths = ['neutral', 'success', 'failure'].map(tone => tones?.[tone]);
  if (paths.some(path => !path)) throw new Error('Les trois portraits sont requis pour générer les descriptions.');
  if (decor) imageBuffer(root, decor);
  const voiceName = String(voiceKey || 'gemini:Kore').replace(/^gemini:/, '');
  const images = paths.map(path => imageBuffer(root, path));
  const request = {input: {
    images,
    prompt: `The three images show the same educational avatar named "${String(name || '').slice(0, 80)}": image 1 is neutral, image 2 is success, image 3 is failure. The selected Gemini TTS voice is "${voiceName}". Return only one valid JSON object with exactly these keys: {"description":"short French description","speechPersonality":"French voice direction","tonePrompts":{"neutral":"detailed English prompt","success":"detailed English prompt","failure":"detailed English prompt"}}. Write description from image 1's visible appearance in at most 180 characters. Propose speechPersonality in at most 240 French characters: a voice direction suited to this avatar's visual presentation and the selected voice, covering pace, warmth and articulation; this is an editorial choice, not a claim about the person's actual traits. Each tonePrompt must be a complete English text-to-image paragraph of at least 170 words, aiming for 170 to 220 words. Count the words in each paragraph before returning the JSON and expand any paragraph below 170 words. Use full, precise sentences to describe its corresponding image: face shape and texture, eyes, eyebrows, facial hair, hairstyle or headwear, glasses, clothing colors and materials, exact expression, frontal pose, framing and lighting. Keep the same character recognizable across all three descriptions. ${decor ? 'Describe the visible setting, colors and objects precisely, preserving the setting.' : 'The portraits have transparent backgrounds: explicitly request an isolated subject on transparency and no scenery or backdrop.'} Describe only what is visible; do not guess ethnicity, occupation or unseen details. Escape JSON strings correctly and add no markdown.`,
    thinking_budget: 0, dynamic_thinking: false, temperature: 0.2, max_output_tokens: 6000
  }};
  request.input.prompt += poseDirectionsPrompt(personalityDirection);
  const output = await run('google/gemini-2.5-flash', request);
  function parseResult(value) {
    const raw = (Array.isArray(value) ? value.join('') : String(value || '')).trim();
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Les descriptions générées ne sont pas au format JSON.');
    try { return JSON.parse(match[0]); }
    catch { throw new Error('Les descriptions générées contiennent un JSON invalide. Réessayez.'); }
  }
  const result = parseResult(output);
  const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
  const wordCount = value => normalize(value).split(/\s+/).filter(Boolean).length;
  const tonePrompts = Object.fromEntries(['neutral', 'success', 'failure'].map(tone => [tone, normalize(result.tonePrompts?.[tone])]));
  let description = normalize(result.description);
  let speechPersonality = normalize(result.speechPersonality);
  let posePrompts = result.posePrompts;
  const shortTones = () => ['neutral', 'success', 'failure'].filter(tone => wordCount(tonePrompts[tone]) < 170);

  // Gemini raccourcit parfois un des trois paragraphes malgré la consigne. Réparer
  // tous les textes insuffisants ensemble, puis ne relancer que les images restantes.
  if (shortTones().length || !description || !speechPersonality) {
    try {
      const retry = await run('google/gemini-2.5-flash', {input: {
        images,
        prompt: `Look again at the same three avatar images: neutral, success, failure. The previous answer was incomplete. Return only valid JSON with keys description, speechPersonality and tonePrompts (neutral, success, failure). Write at least 170 English words for each portrait description, directly from the corresponding image, including visible facial details, exact expression, clothes, pose, framing, lighting and ${decor ? 'setting' : 'transparent background'}. The descriptions must be useful as text-to-image prompts. Write a short French visual description and a short French voice direction too. Previous answer for context: ${JSON.stringify(result).slice(0, 9000)}`,
        thinking_budget: 0, dynamic_thinking: false, temperature: 0.2, max_output_tokens: 8000
      }});
      const repaired = parseResult(retry);
      for (const tone of ['neutral', 'success', 'failure']) {
        const candidate = normalize(repaired.tonePrompts?.[tone]);
        if (wordCount(candidate) > wordCount(tonePrompts[tone])) tonePrompts[tone] = candidate;
      }
      description ||= normalize(repaired.description);
      speechPersonality ||= normalize(repaired.speechPersonality);
      posePrompts ||= repaired.posePrompts;
    } catch { /* Un texte initial utilisable reste disponible. */ }
  }
  for (const tone of shortTones()) {
    const index = ['neutral', 'success', 'failure'].indexOf(tone);
    try {
      const candidateOutput = await run('google/gemini-2.5-flash', {input: {
        images: [images[index]], prompt: portraitDescriptionPrompt(!!decor),
        thinking_budget: 0, max_output_tokens: 3000
      }});
      let candidate = normalize(Array.isArray(candidateOutput) ? candidateOutput.join('') : candidateOutput);
      if (candidate.startsWith('{')) {
        try { candidate = normalize(JSON.parse(candidate).tonePrompts?.[tone]); } catch { candidate = ''; }
      }
      if (wordCount(candidate) > wordCount(tonePrompts[tone])) tonePrompts[tone] = candidate;
    } catch { /* Garder la description obtenue depuis l'image lors du premier appel. */ }
  }
  if (Object.values(tonePrompts).some(prompt => !prompt)) {
    throw new Error('Impossible de décrire les portraits à partir des images.');
  }
  return {description: description.slice(0, 500), speechPersonality: speechPersonality.slice(0, 300), tonePrompts,
    posePrompts:normalizeAvatarPosePrompts(posePrompts)};
}

export async function completeAvatarDescriptions(root, avatar, run) {
  const missingPoses = ['neutral', 'success', 'failure'].some(tone => !String(avatar.posePrompts?.[tone] || '').trim());
  if (Number(avatar.schemaVersion) === 2) {
    const missing = !avatar.tonePrompts?.neutral || !avatar.characterSheetPrompt
      || !avatar.framingPrompts?.bust || !avatar.framingPrompts?.fullBody
      || !avatar.description || !avatar.speechPersonality || missingPoses;
    if (missing) {
      const details = await describeSheetBundle(root, avatar, run);
      avatar.tonePrompts ||= {};
      avatar.framingPrompts ||= {};
      avatar.tonePrompts.neutral ||= details.tonePrompts.neutral;
      avatar.characterSheetPrompt ||= details.characterSheetPrompt;
      avatar.framingPrompts.bust ||= details.framingPrompts.bust;
      avatar.framingPrompts.fullBody ||= details.framingPrompts.fullBody;
      avatar.description ||= details.description;
      avatar.speechPersonality ||= details.speechPersonality;
      avatar.creationBrief ||= details.creationBrief;
      avatar.posePrompts ||= {};
      for (const tone of ['neutral', 'success', 'failure']) avatar.posePrompts[tone] ||= details.posePrompts[tone];
      if (!avatar.tags?.length) avatar.tags = details.tags;
    }
    return avatar;
  }
  const missing = ['neutral', 'success', 'failure'].filter(tone => !String(avatar.tonePrompts?.[tone] || '').trim());
  if (!missing.length && !missingPoses) return avatar;
  const details = await describeBundle(root, avatar, run);
  avatar.tonePrompts ||= {};
  for (const tone of missing) avatar.tonePrompts[tone] = details.tonePrompts[tone];
  avatar.description ||= details.description;
  avatar.speechPersonality ||= details.speechPersonality;
  avatar.posePrompts ||= {};
  for (const tone of ['neutral', 'success', 'failure']) avatar.posePrompts[tone] ||= details.posePrompts[tone];
  return avatar;
}

export async function generateBundle(root, {name, photo, decor, sourceMode = 'photo', sourcePrompt = '', decorMode = 'image', decorPrompt = '', voiceKey, creationBrief = '', description = '', speechPersonality = '', resume = {}, describe = true, only = ''}, run, onProgress = () => {}) {
  if (!String(name || '').trim()) throw new Error('Nom requis');
  if (typeof creationBrief !== 'string' || creationBrief.length > 4000) throw new Error('Consignes de création invalides (4000 caractères maximum)');
  const guidance = {creationBrief, description, speechPersonality};
  if (!['photo', 'prompt'].includes(sourceMode)) throw new Error('Source de génération invalide');
  if (sourceMode === 'prompt' && (typeof sourcePrompt !== 'string' || !sourcePrompt.trim() || sourcePrompt.length > 4000)) {
    throw new Error('Décrivez votre avatar en 4000 caractères maximum');
  }
  if (!['image', 'prompt'].includes(decorMode)) throw new Error('Source du décor invalide');
  if (decorMode === 'prompt' && (typeof decorPrompt !== 'string' || !decorPrompt.trim() || decorPrompt.length > 4000)) {
    throw new Error('Décrivez votre décor en 4000 caractères maximum');
  }
  if (!['', 'neutral', 'characterSheet'].includes(only)) throw new Error('Type de génération invalide');
  if (only === 'characterSheet' && !resume.neutral) throw new Error('Portrait neutre requis pour régénérer la planche');
  if (sourceMode === 'photo') imageBuffer(root, photo);
  if (decorMode === 'image' && decor) imageBuffer(root, decor);
  if (sourceMode === 'prompt') {
    photo = resume.photo || ((only || resume.neutral) ? photo : '');
    if (!photo) {
      onProgress({type: 'stage', tone: 'photo'});
      const result = await generateAvatarImage(run, {
        prompt:creationSourcePrompt('photo', sourcePrompt, guidance),
        ...CREATION_PORTRAIT_OPTIONS
      });
      photo = writeGenerated(root, result.buffer);
      onProgress({type: 'portrait', tone: 'photo', path: photo,
        generation: {model: result.model, cost: result.cost, attempts: result.attempts}});
    } else {
      imageBuffer(root, photo);
      onProgress({type: 'portrait', tone: 'photo', path: photo, reused: true});
    }
  }
  const source = imageBuffer(root, photo);
  if (decorMode === 'prompt') {
    decor = resume.decor || ((only || resume.neutral) ? decor : '');
    if (!decor) {
      onProgress({type: 'stage', tone: 'decor'});
      const result = await generateAvatarImage(run, {
        prompt:creationSourcePrompt('decor', decorPrompt, guidance),
        ...CREATION_PORTRAIT_OPTIONS
      });
      decor = writeGenerated(root, result.buffer);
      onProgress({type: 'portrait', tone: 'decor', path: decor,
        generation: {model: result.model, cost: result.cost, attempts: result.attempts}});
    } else {
      imageBuffer(root, decor);
      onProgress({type: 'portrait', tone: 'decor', path: decor, reused: true});
    }
  }
  const background = decor ? imageBuffer(root, decor) : null;
  let neutral;
  if (resume.neutral) {
    neutral = {buffer: imageBuffer(root, resume.neutral), path: resume.neutral};
    onProgress({type: 'portrait', tone: 'neutral', path: resume.neutral});
  } else {
    onProgress({type: 'stage', tone: 'neutral'});
    const result = await generateAvatarImage(run, {
      prompt: portraitPrompt(name, 'neutral', !!background, true, false, guidance),
      input_images: background ? [source, background] : [source],
      ...CREATION_PORTRAIT_OPTIONS
    });
    const raw = result.buffer;
    let buffer = raw;
    if (!background) {
      const cutout = await run(`${CREATION_BG_MODEL}:${CREATION_BG_VERSION}`, {input: {image: buffer, ...CREATION_BG_INPUT}});
      buffer = removeWhiteFringe(raw, await outputBuffer(cutout));
    }
    const path = writeGenerated(root, buffer);
    neutral = {buffer, path};
    onProgress({type: 'portrait', tone: 'neutral', path,
      generation: {model: result.model, cost: result.cost, attempts: result.attempts}});
  }
  if (only === 'neutral') return {photo, decor: decor || '', preview: neutral.path, tones: {neutral: neutral.path}};
  if (!resume.characterSheet) onProgress({type: 'stage', tone: 'characterSheet'});
  let sheetPath = resume.characterSheet, sheetGeneration;
  if (!sheetPath) {
    const sheet = await generateCharacterSheet(run, {name, source, neutral:neutral.buffer, ...guidance});
    sheetGeneration = {model:sheet.model, cost:sheet.cost, attempts:sheet.attempts};
    sheetPath = writeGenerated(root, await fitCharacterSheet(await removeCharacterSheetBackground(sheet.buffer, run)));
  }
  if (resume.characterSheet) imageBuffer(root, sheetPath);
  onProgress({type: 'portrait', tone: 'characterSheet', path: sheetPath, sheetRegions: defaultSheetRegions,
    reused: !!resume.characterSheet, ...(sheetGeneration ? {generation:sheetGeneration} : {})});
  let details = {};
  if (describe) {
    onProgress({type: 'stage', tone: 'descriptions'});
    details = await describeSheetBundle(root, {name, voiceKey, ...guidance, photo, decor, tones: {neutral: neutral.path}, characterSheet: sheetPath}, run);
    onProgress({type: 'details', ...details});
  }
  return {schemaVersion: 2, photo, decor: decor || '', ...details, preview: neutral.path, characterSheet: sheetPath,
    sheetRegions: defaultSheetRegions, tones: {neutral: neutral.path}};
}

export async function generateCharacterSheet(run, {name, source, neutral, ...guidance}) {
  return generateAvatarImage(run, {
    prompt:creationSheetPrompt(name, guidance), input_images:[neutral, source], ...CREATION_SHEET_OPTIONS
  });
}

export async function removeCharacterSheetBackground(source, run) {
  const original = await sharp(source).toColourspace('srgb').ensureAlpha().png().toBuffer();
  const {width, height} = await sharp(original).metadata();
  const alpha = (await sharp(original).stats()).channels[3];
  if (alpha.min === 0 && alpha.mean < 250) return original;
  const result = await run(`${CREATION_BG_MODEL}:${CREATION_BG_VERSION}`,
    {input: {image: original, ...CREATION_BG_INPUT}});
  let cutout = await outputBuffer(result);
  const size = await sharp(cutout).metadata();
  if (size.width !== width || size.height !== height) cutout = await sharp(cutout).resize(width, height, {fit: 'fill'}).png().toBuffer();
  else cutout = await sharp(cutout).png().toBuffer();
  if ((await sharp(cutout).ensureAlpha().stats()).channels[3].min === 255) {
    throw new Error('Le fond de la planche n’a pas pu être retiré');
  }
  return removeWhiteFringe(original, cutout);
}

export async function describeSheetBundle(root, {tones, characterSheet, photo, ...options}, run) {
  if (!tones?.neutral || !characterSheet) throw new Error('Le neutre et la planche sont requis pour les descriptions.');
  const images = [imageBuffer(root, tones.neutral), imageBuffer(root, characterSheet)];
  if (!String(options.creationBrief || '').trim() && photo) images.push(imageBuffer(root, photo));
  const details = await describeCreationImages({...options, images}, run);
  return {...details, tags:normalizeAvatarTags(details.tags), posePrompts:normalizeAvatarPosePrompts(details.posePrompts)};
}

export async function describeAvatarTags(root, avatar, run) {
  const image = imageBuffer(root, avatar.tones?.neutral || avatar.preview || avatar.photo);
  const output = await run('google/gemini-2.5-flash', {input:{images:[image],
    prompt:'Return only JSON {"tags":[...]}. Write 4 to 12 short French search tags grounded in visible clothing, accessories, setting and presentation. These tags help match an educational prompt to this avatar. Avoid generic words, ethnicity, inferred identity or unseen occupation. No markdown.',
    thinking_budget:0, dynamic_thinking:false, temperature:0.2, max_output_tokens:350}});
  const raw = (Array.isArray(output) ? output.join('') : String(output || '')).trim();
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Tags : réponse JSON absente');
  let parsed;
  try { parsed = JSON.parse(match[0]); } catch { throw new Error('Tags : réponse JSON invalide'); }
  const tags = normalizeAvatarTags(parsed.tags);
  if (!tags.length) throw new Error('Tags : aucun mot-clé généré');
  return tags;
}
