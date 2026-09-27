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
  const expression = selection ? 'calm and welcoming' : tone === 'success' ? 'warm and encouraging' : tone === 'failure' ? 'empathetic and reassuring' : 'attentive and natural';
  return `Create one front-facing portrait of ${name || 'the character'}. Reference image 1 defines the exact facial identity, hair and clothing. ${hasDecor ? 'Reference image 2 provides the background. Place the same person in that setting and preserve its layout.' : 'Use a plain, uniform backdrop with clear edges around the person for a clean cutout. Do not preserve scenery from the source photo or invent a room.'} Centered medium close-up, head and shoulders, facing the camera with direct eye contact. Keep the full face and mouth unobstructed, with steady framing suitable for lip-sync animation. Use a ${expression} expression. ${tone === 'success' ? 'Use subtly warmer, brighter light.' : tone === 'failure' ? 'Use subtly cooler light.' : 'Keep natural, balanced lighting.'} One person only, no side profile, no hands over the face, no text, no watermark.`;
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

async function describePortrait(run, buffer, name, tone, hasDecor) {
  const instruction = 'Describe this exact avatar portrait for recreating it in another visual style. Describe the visible face, hair, clothes, framing, expression, background and lighting. Keep the person facing the camera with the mouth unobstructed. Do not invent unseen details, mention image quality, or name an art style. Write one concise English paragraph of at most 120 words.';
  try {
    const output = await run('google/gemini-3.1-pro', {input: {images: [buffer], prompt: instruction, max_output_tokens: 300}});
    const text = (Array.isArray(output) ? output.join('') : String(output || '')).trim();
    if (text) return text;
  } catch (error) {
    console.warn('Avatar description unavailable:', error.message || error);
  }
  const expression = tone === 'success' ? 'encouraging' : tone === 'failure' ? 'empathetic' : 'attentive';
  return `Front-facing head-and-shoulders portrait of ${name}, with an ${expression} expression and an unobstructed face and mouth. ${hasDecor ? 'The saved setting is visible behind the person.' : 'The person is isolated on a transparent background.'}`;
}

export async function generateBundle(root, {name, photo, decor}, run) {
  if (!String(name || '').trim()) throw new Error('Nom requis');
  const source = imageBuffer(root, photo);
  const background = decor ? imageBuffer(root, decor) : null;
  const generated = {};
  for (const [key, tone, selection] of [['preview', 'neutral', true], ['success', 'success', false], ['failure', 'failure', false]]) {
    const prompt = portraitPrompt(name, tone, !!background, selection);
    const result = await run('black-forest-labs/flux-2-pro', {input: {
      prompt, input_images: background ? [source, background] : [source], aspect_ratio: '1:1', resolution: '1 MP', output_format: 'png'
    }});
    let buffer = await outputBuffer(result);
    if (!background) {
      const cutout = await run('851-labs/background-remover:a029dff38972b5fda4ec5d75d7d1cd25aeff621d2cf4946a41055d7db66b80bc', {input: {image: buffer, format: 'png', background_type: 'rgba'}});
      buffer = await outputBuffer(cutout);
    }
    generated[key] = {path: writeGenerated(root, buffer), prompt: await describePortrait(run, buffer, name, tone, !!background)};
  }
  return {preview: generated.preview.path, tones: {
    neutral: generated.preview.path, success: generated.success.path, failure: generated.failure.path
  }, tonePrompts: {neutral: generated.preview.prompt, success: generated.success.prompt, failure: generated.failure.prompt}};
}
