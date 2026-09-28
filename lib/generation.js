import {readFileSync, writeFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {mediaPath} from './catalog.js';

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

export async function describeBundle(root, {tones, decor}, run) {
  const paths = ['neutral', 'success', 'failure'].map(tone => tones?.[tone]);
  if (paths.some(path => !path)) throw new Error('Les trois portraits sont requis pour générer les descriptions.');
  if (decor) imageBuffer(root, decor);
  const descriptions = await Promise.all(paths.map(path => describePortrait(run, imageBuffer(root, path), !!decor)));
  return {tonePrompts: Object.fromEntries(['neutral', 'success', 'failure'].map((tone, index) => [tone, descriptions[index]]))};
}

export async function generateAvatarMetadata(run, source, name, voiceKey) {
  const voiceName = String(voiceKey || 'gemini:Kore').replace(/^gemini:/, '');
  const output = await run('google/gemini-2.5-flash', {input: {
    images: [source],
    prompt: `Create metadata for an educational avatar named "${String(name || '').slice(0, 80)}" with the Gemini TTS voice "${voiceName}". Return only a complete JSON object in French: {"description":"brief visible appearance, maximum 180 characters","speechPersonality":"voice direction covering pace, warmth and articulation, maximum 240 characters"}. Base the description on visible details only. The voice direction is an editorial choice, not a deduction from appearance. Do not infer identity or personal traits.`,
    thinking_budget: 0, dynamic_thinking: false, temperature: 0.2, max_output_tokens: 3000
  }});
  const raw = (Array.isArray(output) ? output.join('') : String(output || '')).trim();
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Les métadonnées générées ne sont pas au format JSON.');
  const result = JSON.parse(match[0]);
  const description = String(result.description || '').trim();
  const speechPersonality = String(result.speechPersonality || '').trim();
  if (!description || !speechPersonality || description.length > 500 || speechPersonality.length > 300) {
    throw new Error('Description ou personnalité vocale générée invalide.');
  }
  return {description, speechPersonality};
}

export async function generateBundle(root, {name, photo, decor, voiceKey}, run) {
  if (!String(name || '').trim()) throw new Error('Nom requis');
  const source = imageBuffer(root, photo);
  const background = decor ? imageBuffer(root, decor) : null;
  const metadata = await generateAvatarMetadata(run, source, name, voiceKey);
  const generated = {};
  for (const [key, tone, selection] of [['preview', 'neutral', true], ['success', 'success', false], ['failure', 'failure', false]]) {
    const prompt = portraitPrompt(name, tone, !!background, selection);
    // Le portrait de sélection fixe l'identité et le cadrage des deux expressions.
    // C'est aussi la référence utilisée par l'éditeur Cannelle pour ses tons.
    const reference = selection ? source : generated.preview.buffer;
    const result = await run('black-forest-labs/flux-2-pro', {input: {
      prompt, input_images: background ? [reference, background] : [reference], aspect_ratio: '1:1', resolution: '1 MP', output_format: 'png'
    }});
    let buffer = await outputBuffer(result);
    if (!background) {
      const cutout = await run('851-labs/background-remover:a029dff38972b5fda4ec5d75d7d1cd25aeff621d2cf4946a41055d7db66b80bc', {input: {image: buffer, format: 'png', background_type: 'rgba'}});
      buffer = await outputBuffer(cutout);
    }
    generated[key] = {buffer, prompt: await describePortrait(run, buffer, !!background)};
  }
  for (const key of ['preview', 'success', 'failure']) generated[key].path = writeGenerated(root, generated[key].buffer);
  return {...metadata, preview: generated.preview.path, tones: {
    neutral: generated.preview.path, success: generated.success.path, failure: generated.failure.path
  }, tonePrompts: {neutral: generated.preview.prompt, success: generated.success.prompt, failure: generated.failure.prompt}};
}
