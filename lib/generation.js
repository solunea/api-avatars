import {readFileSync, writeFileSync, existsSync, mkdirSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {mediaPath, normalizeAvatarTags, normalizeAvatarPosePrompts, normalizeSpeechPersonality} from './catalog.js';
import {removeWhiteFringe} from './matte.js';
import sharp from 'sharp';
import {defaultSheetRegions} from './catalog.js';
import {generateAvatarImage} from './image-generation.js';

function imageBuffer(root, path) {
  const target = mediaPath(root, path);
  if (!target || !existsSync(target)) throw new Error(`Image introuvable : ${path}`);
  return readFileSync(target);
}

export function portraitPrompt(name, tone, hasDecor, selection, preserveSourceBackground = false) {
  const expression = selection || tone === 'neutral'
    ? 'a calm, attentive expression with relaxed eyebrows, relaxed cheeks and softly closed lips'
    : tone === 'success'
      ? 'a clearly pleased and encouraging expression: a natural medium smile with gently parted lips, lifted cheeks, soft smile lines around the eyes, and relaxed eyebrows'
      : 'a distinctly sympathetic and mildly disappointed expression: a gentle furrow between the eyebrows, eyes at their natural width with relaxed eyelids, and closed lips with slightly downturned corners; composed and reassuring';
  const expressionChange = selection || tone === 'neutral' ? ''
    : 'The reference portrait fixes identity and composition, but the facial expression must visibly change from it. Make the difference unmistakable even in a small thumbnail by changing the mouth, cheeks, eyes and eyebrows. ';
  const scene = hasDecor
    ? 'Reference image 2 defines the location, architecture and objects. Keep the person from image 1 in a centered medium close-up at the front of the frame, with the same horizontal position, pose and upper-body placement as a portrait. Adapt the room to this close camera viewpoint instead of moving or shrinking the person: choose a credible camera position inside the location, recrop and reconstruct its visible walls, furniture and vanishing lines around the portrait. Let the person naturally occlude the room, with nearby scene elements at the sides and a softly receding background behind them. Match the location’s light direction, color temperature, contrast, shadow softness and depth of field on the face, hair and clothing so the result reads as one photograph.'
    : preserveSourceBackground
      ? 'Reference image 1 is already a photograph of the person integrated into a location. Preserve the camera viewpoint, horizontal person position, approximate scale, perspective, surrounding architecture, depth, and direction of light. Adjust the vertical framing slightly and extend the scene above the person wherever needed to reveal the complete hairstyle. Change the facial expression in place while retaining a coherent single photograph.'
      : 'Use a plain, uniform backdrop with clear edges around the person for a clean cutout. Do not preserve scenery from the source photo or invent a room.';
  const framing = hasDecor || preserveSourceBackground
    ? 'Maintain a front-facing medium close-up with the face and mouth clearly visible for lip-sync animation.'
    : 'Centered medium close-up, head and shoulders, facing the camera with direct eye contact. Keep the full face and mouth unobstructed, with steady framing suitable for lip-sync animation.';
  const headroom = 'Composition requirement: place the highest point of the complete head, crown, hairstyle or headwear at least 10% of the image height below the top edge, leaving a clearly visible band of background above it. Keep the person horizontally centered and in a medium close-up with shoulders visible; slightly lower the portrait or widen the vertical framing if the reference is cropped tightly. The hair must be fully contained within the image.';
  const atmosphere = hasDecor || preserveSourceBackground
    ? 'Keep camera placement, person scale and environmental lighting consistent across all expressions.'
    : tone === 'success' ? 'Keep the same lighting direction and background, with a warmer and brighter mood.'
      : tone === 'failure' ? 'Keep the same lighting direction and background, with a cooler and more subdued mood.'
        : 'Keep natural, balanced lighting.';
  return `Create one front-facing portrait of ${name || 'the character'}. Reference image 1 defines the exact facial identity, hair and clothing. ${headroom} ${scene} ${framing} ${expressionChange}Give the person ${expression}. ${atmosphere} One person only, no side profile, no hands over the face, no text, no watermark.`;
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

function draftViewPath(root, path) {
  if (!/^uploads\/view-[0-9a-f-]{36}\.png$/.test(String(path || ''))) throw new Error('Vue temporaire invalide');
  const file = join(root, path);
  if (!existsSync(file)) throw new Error('Vue temporaire introuvable');
  return file;
}

function writeDraftView(root, buffer) {
  mkdirSync(join(root, 'uploads'), {recursive: true});
  const path = `uploads/view-${randomUUID()}.png`;
  writeFileSync(join(root, path), buffer);
  return path;
}

export function portraitDescriptionPrompt(hasDecor = false) {
  return 'Write a 170 to 220 word English text-to-image prompt describing this avatar portrait. '
    + 'Include the visible face, eyes, eyebrows, facial hair, hairstyle or headwear, glasses, clothing colors and materials, exact facial expression, frontal pose, framing, and lighting. '
    + 'Describe only what you can see; avoid guessing ethnicity, occupation, or unseen details. Keep the same character recognizable. '
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
function poseDirectionsPrompt(speechPersonality = '') {
  const personality = normalizeSpeechPersonality(speechPersonality);
  return ' Extend the requested JSON schema with "posePrompts", an object containing "neutral", "success" and "failure" English text-to-image pose directions of 30 to 60 words each. '
    + (personality ? `Preserve this user-provided personality direction: ${JSON.stringify(personality)}. ` : '')
    + 'Design poses as editorial choices consistent with the provided or suggested speechPersonality, never as inferred real personality traits. '
    + 'Neutral is a relaxed attentive stance. Success uses one approving gesture such as a thumbs-up, a modest celebratory raised hand or a hand on the heart. Failure uses one compassionate reassuring gesture such as a gentle open palm or a hand on the heart inviting another attempt. '
    + 'Vary the choice and intensity across characters: reserved characters stay understated and enthusiastic characters are more expressive. Do not always assign the same gesture to every character. '
    + 'Each direction describes a distinct facial expression, shoulders, arms and one purposeful gesture, with visible hands below the unobstructed face, anatomically plausible fingers and a waist-up composition. '
    + 'Preserve identity, hair and outfit, invent no accessory or occupation, and use a supportive teaching attitude, never mockery, shame or a thumbs-down. Describe one still pose, not animation or multiple alternatives.';
}

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

export async function generateBundle(root, {name, photo, decor, sourceMode = 'photo', sourcePrompt = '', decorMode = 'image', decorPrompt = '', voiceKey, speechPersonality = '', resume = {}, describe = true, only = ''}, run, onProgress = () => {}) {
  if (!String(name || '').trim()) throw new Error('Nom requis');
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
        prompt: `Create a photorealistic reference photograph of one fictional educational avatar. Character description: ${sourcePrompt.trim()}. Centered front-facing medium close-up with shoulders visible, direct eye contact, calm attentive expression and softly closed lips. Keep the full hairstyle or headwear visible with at least 10% headroom. Face and mouth unobstructed for lip-sync. Natural balanced studio lighting, plain uniform background, no scenery, no text, no watermark.`,
        aspect_ratio: '1:1', resolution: '1 MP', output_format: 'png'
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
        prompt: `Create a photorealistic location reference for an educational avatar portrait. Setting description: ${decorPrompt.trim()}. Show the architecture, furniture and lighting from a credible eye-level viewpoint. No people, no foreground character; leave room for a centered head-and-shoulders portrait. No text, no watermark.`,
        aspect_ratio: '1:1', resolution: '1 MP', output_format: 'png'
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
  const generated = {};
  async function generate(key, tone, selection) {
    onProgress({type: 'stage', tone});
    const prompt = portraitPrompt(name, tone, !!background && selection, selection, !!background && !selection);
    // Le portrait de sélection fixe l'identité et le cadrage des deux expressions.
    // C'est aussi la référence utilisée par l'éditeur Cannelle pour ses tons.
    const reference = selection ? source : generated.preview.buffer;
    const result = await generateAvatarImage(run, {
      prompt, input_images: background && selection ? [reference, background] : [reference], aspect_ratio: '1:1', resolution: '1 MP', output_format: 'png'
    });
    const raw = result.buffer;
    let buffer = raw;
    if (!background) {
      const cutout = await run('851-labs/background-remover:a029dff38972b5fda4ec5d75d7d1cd25aeff621d2cf4946a41055d7db66b80bc', {input: {image: buffer, format: 'png', background_type: 'rgba'}});
      buffer = removeWhiteFringe(raw, await outputBuffer(cutout));
    }
    const path = writeGenerated(root, buffer);
    generated[key] = {buffer, path, generation: {model: result.model, cost: result.cost, attempts: result.attempts}};
    onProgress({type: 'portrait', tone, path, generation: generated[key].generation});
  }
  if (resume.neutral) {
    generated.preview = {buffer: imageBuffer(root, resume.neutral), path: resume.neutral};
    onProgress({type: 'portrait', tone: 'neutral', path: resume.neutral});
  } else await generate('preview', 'neutral', true);
  if (only === 'neutral') return {photo, decor: decor || '', preview: generated.preview.path, tones: {neutral: generated.preview.path}};
  if (!resume.characterSheet) onProgress({type: 'stage', tone: 'characterSheet'});
  const existingViews = resume.characterSheet ? {} : Object.fromEntries(['front', 'profile', 'back'].filter(view => resume.sheetViews?.[view])
    .map(view => [view, readFileSync(draftViewPath(root, resume.sheetViews[view]))]));
  const sheetPath = resume.characterSheet || writeGenerated(root, await removeCharacterSheetBackground(await generateCharacterSheet(run,
    {name, source, neutral: generated.preview.buffer, existingViews}, (view, buffer, reused, generation) => {
      const path = reused ? resume.sheetViews[view] : writeDraftView(root, buffer);
      generated.sheetViews ||= {};
      generated.sheetViews[view] = path;
      onProgress({type: 'sheetView', view, path, ...(generation ? {generation} : {})});
    }), run));
  if (resume.characterSheet) imageBuffer(root, sheetPath);
  onProgress({type: 'portrait', tone: 'characterSheet', path: sheetPath, sheetRegions: defaultSheetRegions,
    reused: !!resume.characterSheet});
  let details = {};
  if (describe) {
    onProgress({type: 'stage', tone: 'descriptions'});
    details = await describeSheetBundle(root, {name, voiceKey, speechPersonality, decor, tones: {neutral: generated.preview.path}, characterSheet: sheetPath}, run);
    onProgress({type: 'details', ...details});
  }
  for (const path of new Set(Object.values(resume.sheetViews || {}).concat(
    // Les vues générées pendant cet appel sont annoncées ci-dessus et retirées après succès.
    Object.values(generated.sheetViews || {})))) {
    if (/^uploads\/view-[0-9a-f-]{36}\.png$/.test(path)) rmSync(join(root, path), {force: true});
  }
  return {schemaVersion: 2, photo, decor: decor || '', ...details, preview: generated.preview.path, characterSheet: sheetPath,
    sheetRegions: defaultSheetRegions, tones: {neutral: generated.preview.path}};
}

export async function generateCharacterSheet(run, {name, source, neutral, existingViews = {}}, onView = () => {}) {
  const identity = `Character ${name || ''}. Preserve the exact facial identity, age presentation, hair, headwear, glasses, skin features, clothing, colors and accessories from the reference images. One person only. Photorealistic studio reference photograph on a uniform white background. Entire person from the highest hair to the soles of both feet must fit inside the image with generous space above and below. Arms relaxed at sides, hands visible. Neutral standing pose, no props, no text, no collage, no cut-off body parts.`;
  async function view(label, reference, angle) {
    if (existingViews[label]) {
      onView(label, existingViews[label], true);
      return existingViews[label];
    }
    const output = await generateAvatarImage(run, {
      prompt: `${identity} ${angle}. Full-length head-to-toe framing.`, input_images: reference,
      aspect_ratio: '2:3', resolution: '2 MP', output_format: 'png'
    });
    const buffer = output.buffer;
    onView(label, buffer, false, {model: output.model, cost: output.cost, attempts: output.attempts});
    return buffer;
  }
  const front = await view('front', [neutral, source], 'Direct frontal view, facing camera');
  const viewResults = await Promise.allSettled([
    view('profile', [front, neutral], 'Exact left side profile, face and body turned ninety degrees, no three-quarter view'),
    view('back', [front, neutral], 'Exact rear view of the same person and outfit, back of head and clothing visible, face turned away')
  ]);
  const failedView = viewResults.find(result => result.status === 'rejected');
  if (failedView) throw failedView.reason;
  const [profile, back] = viewResults.map(result => result.value);
  const canvas = sharp({create: {width: 2048, height: 1536, channels: 4, background: '#ffffff'}});
  const panels = [
    {buffer: front, left: 0, top: 0, width: 682, height: 1536, position: 'centre'},
    {buffer: profile, left: 683, top: 0, width: 682, height: 1536, position: 'centre'},
    {buffer: back, left: 1366, top: 0, width: 682, height: 1536, position: 'centre'}
  ];
  const layers = await Promise.all(panels.map(async p => ({
    input: await sharp(p.buffer).flatten({background: '#ffffff'}).resize(p.width, p.height, {
      fit: p.position ? 'cover' : 'contain', position: p.position || 'centre', background: '#ffffff'
    }).png().toBuffer(), left: p.left, top: p.top
  })));
  return canvas.composite(layers).png().toBuffer();
}

export async function removeCharacterSheetBackground(source, run) {
  const original = await sharp(source).png().toBuffer();
  const {width, height} = await sharp(original).metadata();
  const alpha = (await sharp(original).ensureAlpha().stats()).channels[3];
  if (alpha.min === 0 && alpha.mean < 250) return original;
  const result = await run('851-labs/background-remover:a029dff38972b5fda4ec5d75d7d1cd25aeff621d2cf4946a41055d7db66b80bc',
    {input: {image: original, format: 'png', background_type: 'rgba'}});
  let cutout = await outputBuffer(result);
  const size = await sharp(cutout).metadata();
  if (size.width !== width || size.height !== height) cutout = await sharp(cutout).resize(width, height, {fit: 'fill'}).png().toBuffer();
  else cutout = await sharp(cutout).png().toBuffer();
  if ((await sharp(cutout).ensureAlpha().stats()).channels[3].min === 255) {
    throw new Error('Le fond de la planche n’a pas pu être retiré');
  }
  return removeWhiteFringe(original, cutout);
}

export async function describeSheetBundle(root, {tones, characterSheet, decor, name, voiceKey, speechPersonality:personalityDirection = ''}, run) {
  if (!tones?.neutral || !characterSheet) throw new Error('Le neutre et la planche sont requis pour les descriptions.');
  const images = [imageBuffer(root, tones.neutral), imageBuffer(root, characterSheet)];
  const voice = String(voiceKey || 'gemini:Kore').replace(/^gemini:/, '');
  const prompt = `Analyse both images of the same character ${String(name || '').slice(0, 80)}. Image 1 is a neutral head-and-shoulders portrait; image 2 is a character reference sheet with exactly three head-to-toe views: front, profile and back. The selected Gemini voice is ${voice}. Return ONLY valid JSON with exactly these keys: {"description":"French short visual description up to 180 characters","speechPersonality":"French voice direction up to 240 characters","tonePrompts":{"neutral":"English bust prompt"},"characterSheetPrompt":"English detailed sheet description","framingPrompts":{"bust":"English detailed bust image prompt","fullBody":"English detailed full-body image prompt"}}. Each English prompt must be a substantial 150 to 220 word paragraph describing visible identity, face shape, eyes, eyebrows, hair, glasses or headwear, exact clothing materials and colors, pose, composition and light. The fullBody prompt must explicitly require one complete person, both shoes visible, generous headroom and no cropping. The bust prompt must keep the face and lips large and unobstructed for talking video. The characterSheetPrompt must precisely describe the front/profile/back views and visible details. Preserve the same person and outfit in every prompt. ${decor ? 'The neutral portrait includes a location; describe its visible setting only where appropriate.' : 'The neutral portrait has no required scenery; request a plain backdrop unless a later scene is supplied.'} Describe what the images actually show; do not invent unseen traits, ethnicity or occupation. Write short description and voice direction in French. Escape JSON strings correctly, no markdown.`;
  function parse(output) {
    const raw = (Array.isArray(output) ? output.join('') : String(output || '')).trim();
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Descriptions : réponse JSON absente');
    try { return JSON.parse(match[0]); } catch { throw new Error('Descriptions : réponse JSON invalide'); }
  }
  let result;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      result = parse(await run('google/gemini-2.5-flash', {input: {images,
        prompt:prompt.replace('with exactly these keys:', 'with these keys and a tags array:')
          + ' Also return "tags": an array of 4 to 12 short French searchable keywords grounded in visible clothing, accessories, setting and presentation. Avoid generic tags, ethnicity, inferred identity and unseen occupation.'
          + poseDirectionsPrompt(personalityDirection),
        thinking_budget: 0, dynamic_thinking: false, temperature: .2, max_output_tokens: 6000}}));
      break;
    } catch (error) { if (attempt) throw error; }
  }
  const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
  const fields = {
    description: clean(result.description).slice(0, 500),
    tags: normalizeAvatarTags(result.tags),
    speechPersonality: clean(result.speechPersonality).slice(0, 300),
    posePrompts: normalizeAvatarPosePrompts(result.posePrompts),
    tonePrompts: {neutral: clean(result.tonePrompts?.neutral)},
    characterSheetPrompt: clean(result.characterSheetPrompt),
    framingPrompts: {bust: clean(result.framingPrompts?.bust), fullBody: clean(result.framingPrompts?.fullBody)}
  };
  for (const key of ['neutral', 'sheet', 'bust', 'fullBody']) {
    const value = key === 'neutral' ? fields.tonePrompts.neutral : key === 'sheet' ? fields.characterSheetPrompt : fields.framingPrompts[key];
    if (value.split(/\s+/).length >= 150) continue;
    try {
      const image = key === 'sheet' || key === 'fullBody' ? images[1] : images[0];
      const retry = await run('google/gemini-2.5-flash', {input: {images:[image],
        prompt:`Write only a detailed 170 to 220 word English text-to-image prompt for this character, focused on ${key}. Describe visible face, hair, clothing, colors, pose, light and exact framing. One person. Preserve identity. ${key === 'fullBody' ? 'Include the complete person from crown to both shoes with generous margins.' : ''} No JSON or markdown.`,
        thinking_budget:0,max_output_tokens:3000}});
      const expanded = clean(Array.isArray(retry) ? retry.join('') : retry);
      if (expanded.split(/\s+/).length > value.split(/\s+/).length) {
        if (key === 'neutral') fields.tonePrompts.neutral = expanded;
        else if (key === 'sheet') fields.characterSheetPrompt = expanded;
        else fields.framingPrompts[key] = expanded;
      }
    } catch { /* Keep the image-grounded first description for manual review. */ }
  }
  if (!fields.description || !fields.speechPersonality) throw new Error('La description courte ou la personnalité vocale est absente.');
  return fields;
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
