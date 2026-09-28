import {readFileSync, writeFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {mediaPath} from './catalog.js';
import {removeWhiteFringe} from './matte.js';

function imageBuffer(root, path) {
  const target = mediaPath(root, path);
  if (!target || !existsSync(target)) throw new Error(`Image introuvable : ${path}`);
  return readFileSync(target);
}

export function portraitPrompt(name, tone, hasDecor, selection) {
  const expression = selection || tone === 'neutral'
    ? 'a calm, attentive expression with relaxed eyebrows, relaxed cheeks and softly closed lips'
    : tone === 'success'
      ? 'a clearly pleased and encouraging expression: a natural medium smile with gently parted lips, lifted cheeks, soft smile lines around the eyes, and relaxed eyebrows'
      : 'a distinctly sympathetic and mildly disappointed expression: a gentle furrow between the eyebrows, eyes at their natural width with relaxed eyelids, and closed lips with slightly downturned corners; composed and reassuring';
  const expressionChange = selection || tone === 'neutral' ? ''
    : 'The reference portrait fixes identity and composition, but the facial expression must visibly change from it. Make the difference unmistakable even in a small thumbnail by changing the mouth, cheeks, eyes and eyebrows. ';
  return `Create one front-facing portrait of ${name || 'the character'}. Reference image 1 defines the exact facial identity, hair and clothing. ${hasDecor ? 'Reference image 2 provides the background. Place the same person in that setting and preserve its layout.' : 'Use a plain, uniform backdrop with clear edges around the person for a clean cutout. Do not preserve scenery from the source photo or invent a room.'} Centered medium close-up, head and shoulders, facing the camera with direct eye contact. Keep the full face and mouth unobstructed, with steady framing suitable for lip-sync animation. ${expressionChange}Give the person ${expression}. ${tone === 'success' ? 'Keep the same lighting direction and background, with a warmer and brighter mood.' : tone === 'failure' ? 'Keep the same lighting direction and background, with a cooler and more subdued mood.' : 'Keep natural, balanced lighting.'} One person only, no side profile, no hands over the face, no text, no watermark.`;
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

export async function describeBundle(root, {tones, decor, name, voiceKey}, run) {
  const paths = ['neutral', 'success', 'failure'].map(tone => tones?.[tone]);
  if (paths.some(path => !path)) throw new Error('Les trois portraits sont requis pour générer les descriptions.');
  if (decor) imageBuffer(root, decor);
  const voiceName = String(voiceKey || 'gemini:Kore').replace(/^gemini:/, '');
  const images = paths.map(path => imageBuffer(root, path));
  const output = await run('google/gemini-2.5-flash', {input: {
    images,
    prompt: `The three images show the same educational avatar named "${String(name || '').slice(0, 80)}": image 1 is neutral, image 2 is success, image 3 is failure. The selected Gemini TTS voice is "${voiceName}". Return only one valid JSON object with exactly these keys: {"description":"short French description","speechPersonality":"French voice direction","tonePrompts":{"neutral":"detailed English prompt","success":"detailed English prompt","failure":"detailed English prompt"}}. Write description from image 1's visible appearance in at most 180 characters. Propose speechPersonality in at most 240 French characters: a voice direction suited to this avatar's visual presentation and the selected voice, covering pace, warmth and articulation; this is an editorial choice, not a claim about the person's actual traits. Each tonePrompt must be a complete English text-to-image paragraph of at least 170 words, aiming for 170 to 220 words. Count the words in each paragraph before returning the JSON and expand any paragraph below 170 words. Use full, precise sentences to describe its corresponding image: face shape and texture, eyes, eyebrows, facial hair, hairstyle or headwear, glasses, clothing colors and materials, exact expression, frontal pose, framing and lighting. Keep the same character recognizable across all three descriptions. ${decor ? 'Describe the visible setting, colors and objects precisely, preserving the setting.' : 'The portraits have transparent backgrounds: explicitly request an isolated subject on transparency and no scenery or backdrop.'} Describe only what is visible; do not guess ethnicity, occupation or unseen details. Escape JSON strings correctly and add no markdown.`,
    thinking_budget: 0, dynamic_thinking: false, temperature: 0.2, max_output_tokens: 6000
  }});
  const raw = (Array.isArray(output) ? output.join('') : String(output || '')).trim();
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Les descriptions générées ne sont pas au format JSON.');
  let result;
  try { result = JSON.parse(match[0]); }
  catch { throw new Error('Les descriptions générées contiennent un JSON invalide. Réessayez.'); }
  const description = String(result.description || '').trim();
  const speechPersonality = String(result.speechPersonality || '').trim();
  if (!description || !speechPersonality || description.length > 500 || speechPersonality.length > 300) {
    throw new Error('Description ou personnalité vocale générée invalide.');
  }
  const tonePrompts = Object.fromEntries(['neutral', 'success', 'failure'].map(tone => [tone, String(result.tonePrompts?.[tone] || '').replace(/\s+/g, ' ').trim()]));
  if (Object.entries(tonePrompts).some(([, prompt]) => prompt.split(/\s+/).length < 170)) {
    throw new Error('Une description détaillée est trop courte. Réessayez ou complétez-la manuellement.');
  }
  return {description, speechPersonality, tonePrompts};
}

export async function generateBundle(root, {name, photo, decor, voiceKey}, run, onProgress = () => {}) {
  if (!String(name || '').trim()) throw new Error('Nom requis');
  const source = imageBuffer(root, photo);
  const background = decor ? imageBuffer(root, decor) : null;
  const generated = {};
  async function generate(key, tone, selection) {
    onProgress({type: 'stage', tone});
    const prompt = portraitPrompt(name, tone, !!background, selection);
    // Le portrait de sélection fixe l'identité et le cadrage des deux expressions.
    // C'est aussi la référence utilisée par l'éditeur Cannelle pour ses tons.
    const reference = selection ? source : generated.preview.buffer;
    const result = await run('black-forest-labs/flux-2-pro', {input: {
      prompt, input_images: background ? [reference, background] : [reference], aspect_ratio: '1:1', resolution: '1 MP', output_format: 'png'
    }});
    const raw = await outputBuffer(result);
    let buffer = raw;
    if (!background) {
      const cutout = await run('851-labs/background-remover:a029dff38972b5fda4ec5d75d7d1cd25aeff621d2cf4946a41055d7db66b80bc', {input: {image: buffer, format: 'png', background_type: 'rgba'}});
      buffer = removeWhiteFringe(raw, await outputBuffer(cutout));
    }
    const path = writeGenerated(root, buffer);
    generated[key] = {buffer, path};
    onProgress({type: 'portrait', tone, path});
  }
  await generate('preview', 'neutral', true);
  await Promise.all([generate('success', 'success', false), generate('failure', 'failure', false)]);
  onProgress({type: 'stage', tone: 'descriptions'});
  const details = await describeBundle(root, {name, voiceKey, decor, tones: {
    neutral: generated.preview.path, success: generated.success.path, failure: generated.failure.path
  }}, run);
  onProgress({type: 'details', ...details});
  return {...details, preview: generated.preview.path, tones: {
    neutral: generated.preview.path, success: generated.success.path, failure: generated.failure.path
  }};
}
