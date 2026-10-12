// Contrat partagé par l'administration api-avatars et la création dans Thaleia.
// Ce module reste indépendant de Node et du navigateur.
export const CREATION_IMAGE_MODELS = ['ideogram-ai/ideogram-4-5', 'black-forest-labs/flux-2-pro'];
export const CREATION_PORTRAIT_OPTIONS = {aspect_ratio:'1:1', resolution:'1 MP', output_format:'png'};
export const CREATION_SHEET_OPTIONS = {aspect_ratio:'4:3', resolution:'3 MP', output_format:'png'};
export const CREATION_BG_MODEL = '851-labs/background-remover';
export const CREATION_BG_VERSION = 'a029dff38972b5fda4ec5d75d7d1cd25aeff621d2cf4946a41055d7db66b80bc';
export const CREATION_BG_INPUT = {format:'png', background_type:'rgba'};

// Le décor impose la lumière, même si le personnage vient d'une photo de studio.
export const AVATAR_SCENE_INTEGRATION_PROMPT = 'Scene integration requirements: the setting defines exposure, brightness, light direction, color temperature, contrast and shadow softness. Relight the character, including face, hair, clothing and equipment, to match that environment; do not retain the source portrait\'s studio lighting or independently brighten the face. Preserve recognizable identity, intrinsic clothing colors, anatomy and equipment while adapting their illuminated appearance. Match camera perspective, scale and spatial depth. Add plausible cast and contact shadows wherever the character meets visible surfaces, environmental color reflections and natural occlusion. Avoid cutout halos, glowing edges and a pasted-on appearance. Match local sharpness, texture and depth of field to the character\'s distance and the setting: use only subtle, physically plausible blur when needed, never blanket background blur or an artificially oversharpened subject. Keep existing facial features and the mouth readable for lip sync. Apply the chosen visual style consistently to both character and setting while preserving the setting\'s lighting relationships and depth. These integration requirements take precedence over incompatible lighting, exposure or focus instructions in the character description or style. Keep environmental lighting and focus consistent across expressions.';

export const AVATAR_ANATOMY_PROMPT = 'The avatar may be a human, an animal, a creature, a robot or an animated object. Preserve the subject type, species, body shape, proportions, surface materials shown in the references or explicitly requested. Keep the reference rendering style unless a different visual style is explicitly requested. Do not humanize a non-human subject or invent human anatomy, hands, fingers, lips, clothing or shoes. Human portrait, expression and gesture directions apply only where that anatomy exists; otherwise use the subject\'s own face, muzzle, beak, limbs or expressive features. Keep ears, horns, wings, antennae and tails intact. Use a natural posture for this subject, including a quadruped stance where appropriate; never force it to stand upright. For a subject without a human torso, adapt bust or waist-up framing to a recognizable close-up of its head and upper body, or its complete form if it has no distinct head.';
export const AVATAR_EQUIPMENT_PROMPT = 'Preserve all reference or explicitly requested worn, attached, carried and held items, including backpacks, straps, bags, tools and handheld objects. Keep their exact shape, colors, materials, attachment points and grip consistent across views wherever visible. These items belong to the character, not the background: never remove them when changing scenery or removing a backdrop. A portrait crop may hide part of an item; this does not mean it is absent from the complete character. Adapt gestures to available free limbs without dropping, replacing or relocating held items; if no limb is free, express emotion through posture or existing expressive features. Do not invent additional equipment.';

export function creationGuidancePrompt({creationBrief = '', description = '', speechPersonality = ''} = {}) {
  const fields = {};
  if (String(creationBrief).trim()) fields.creationBrief = String(creationBrief).trim().slice(0, 4000);
  if (String(description).trim()) fields.description = String(description).trim().slice(0, 500);
  if (String(speechPersonality).trim()) fields.speechPersonality = String(speechPersonality).trim().slice(0, 300);
  if (!Object.keys(fields).length) return '';
  return ` User-provided avatar guidance: ${JSON.stringify(fields)}. Use creationBrief as the character's authored personality and the overall creative direction for the images and all generated fields: short description, voice personality, detailed bust and full-body prompts, sheet description, poses and search tags. Capture temperament, emotional range, attitude, gesture style and speaking manner. Derive the intensity of facial expressions, posture and gestures for neutral, success and failure from this persona, with distinct but coherent reactions. When the subject naturally stands, create a believable standing pose that expresses this creationBrief through weight distribution, body inclination, head carriage and limb placement. A neutral expression does not require a rigid or characterless pose. Do not impose a fixed arm position; preserve held items and their grip while adapting the posture to the authored character. Adapt voice pace, warmth, energy and articulation accordingly. These are fictional editorial directions, not inferred real personality traits. Use the description as character context and any supplied voice personality as an explicit direction. Preserve any supplied description and voice direction, and complete missing fields consistently with the brief. Ground visual details in the reference images when present; keep their identity and outfit, the required neutral expression, framing and view layout. Search tags may reflect visible traits and the explicitly authored persona. Do not invent visual traits that contradict the references.`;
}

export function creationSourcePrompt(target, description, guidance) {
  return (target === 'photo'
    ? `Create a reference image of one fictional educational avatar. Character description: ${description.trim()}. Use the requested visual style, or photorealistic rendering if none is specified. Show the complete character and all requested equipment in a centered front-facing full-body view with generous margins around every extremity and carried item. Use direct eye contact where applicable and a calm attentive expression. Human lips, when present, are softly closed. Keep the full head, hairstyle, headwear or equivalent upper silhouette visible with at least 10% headroom. Keep existing facial and speaking features unobstructed. Use a natural standing pose when appropriate to the subject, with believable balance and freely placed limbs; do not impose a fixed arm position. Natural balanced studio lighting, plain uniform background, no scenery, no text, no watermark. ${AVATAR_ANATOMY_PROMPT} ${AVATAR_EQUIPMENT_PROMPT}`
    : `Create a photorealistic location reference for an educational avatar portrait. Setting description: ${description.trim()}. Show the architecture, furniture and lighting from a credible eye-level viewpoint. No people, no foreground character; leave room for a centered head-and-shoulders portrait. No text, no watermark.`) + creationGuidancePrompt(guidance);
}

export function creationSheetPrompt(name, guidance) {
  return `Create one character reference sheet of ${name || 'the character'} with exactly THREE complete full-body views of the SAME character, arranged in three equal-width vertical columns on one uniform white background. Reference image 1 is the neutral portrait and reference image 2 is the source image. The source image defines the complete morphology and equipment, including anything outside the portrait crop; the portrait defines the neutral expression and recognizable identity. Preserve their exact identity, age presentation, visible body features, colors, clothing and accessories in all three views. ${AVATAR_ANATOMY_PROMPT} ${AVATAR_EQUIPMENT_PROMPT} LEFT column: direct frontal view, facing camera. CENTER column: exact left side profile, body turned ninety degrees, no three-quarter view. RIGHT column: exact rear view, back of the character and its equipment visible. Maintain the same worn and held items in their correct positions in every view, allowing natural occlusion. Each column contains exactly one complete figure, including every extremity and all its equipment. Center each figure in its own column, with matching scale and aligned vertical bounds, fitting within about 90% of both the column width and image height with balanced margins. Scale wide or long subjects down to keep their complete silhouette inside the column. Keep every body part and carried item fully inside its column with clear white gaps between figures. Use a natural standing pose when appropriate to the subject, with believable balance, weight distribution and limb placement shaped by the character creationBrief. A neutral expression does not require a rigid pose. Do not impose a fixed arm position. Preserve held objects and their grip while adapting the posture to the authored character. Keep the same natural pose across the three views. Studio reference images with consistent lighting and the reference rendering style. Only these three views of the same character: no extra character, no detail row, no close-up inset, no panels inside a column, no scenery, no unrelated props, no text, no labels, no watermark, no cut-off body parts or equipment.` + creationGuidancePrompt(guidance);
}

export function portraitPrompt(name, tone, hasDecor, selection, preserveSourceBackground = false, guidance) {
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
  return `Create one front-facing portrait of ${name || 'the character'}. Reference image 1 defines the exact facial identity, hair and clothing where present. ${headroom} ${scene} ${framing} ${expressionChange}For a human character, give the person ${expression}; otherwise convey the same emotion through existing expressive features. ${atmosphere} ${AVATAR_ANATOMY_PROMPT} ${AVATAR_EQUIPMENT_PROMPT} One character only, no side profile, no limbs or objects over existing facial features, no text, no watermark.` + creationGuidancePrompt(guidance)
    + (hasDecor || preserveSourceBackground ? ` ${AVATAR_SCENE_INTEGRATION_PROMPT}` : '');
}

export function poseDirectionsPrompt(speechPersonality = '') {
  const personality = String(speechPersonality || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  return ' Extend the requested JSON schema with "posePrompts", an object containing "neutral", "success" and "failure" English text-to-image pose directions of 30 to 60 words each. '
    + (personality ? `Preserve this user-provided personality direction: ${JSON.stringify(personality)}. ` : '')
    + 'Design poses as editorial choices consistent with the provided or suggested speechPersonality, never as inferred real personality traits. '
    + 'Neutral is a natural attentive stance appropriate to the subject, expressing the creationBrief through balance, body inclination, head carriage and limb placement without imposing a fixed arm position. For a human with a free hand, success uses one approving gesture such as a thumbs-up, a modest celebratory raised hand or a hand on the heart. Failure uses one compassionate reassuring gesture such as a gentle open palm or a hand on the heart inviting another attempt. For other subjects, use an anatomically possible change of posture, head, ears, tail or existing expressive features. '
    + 'Vary the choice and intensity across characters: reserved characters stay understated and enthusiastic characters are more expressive. Do not always assign the same gesture to every character. '
    + 'Each direction describes a distinct expression and one purposeful gesture or posture, in a waist-up composition for a human or an equivalent subject-appropriate crop. Only describe shoulders, arms, hands and fingers if they exist, keeping them anatomically plausible and below existing facial features. '
    + `${AVATAR_ANATOMY_PROMPT} ${AVATAR_EQUIPMENT_PROMPT} `
    + 'Preserve identity and outfit where present, invent no accessory or occupation, and use a supportive teaching attitude, never mockery, shame or a thumbs-down. Describe one still pose, not animation or multiple alternatives.';
}

export async function describeCreationImages({images, decor, name, voiceKey, creationBrief = '', description = '', speechPersonality:personalityDirection = ''}, run) {
  const voice = String(voiceKey || 'gemini:Kore').replace(/^gemini:/, '');
  const guidance = creationGuidancePrompt({creationBrief, description, speechPersonality: personalityDirection});
  const prompt = `Analyse both images of the same character ${String(name || '').slice(0, 80)}. Image 1 is a neutral head-and-shoulders portrait; image 2 is a character reference sheet with exactly three complete views: front, profile and back. The selected Gemini voice is ${voice}. Return ONLY valid JSON with exactly these keys: {"description":"French short visual description up to 180 characters","speechPersonality":"French voice direction up to 240 characters","tonePrompts":{"neutral":"English bust prompt"},"characterSheetPrompt":"English detailed sheet description","framingPrompts":{"bust":"English detailed bust image prompt","fullBody":"English detailed full-body image prompt"}}. Each English prompt must be a substantial 150 to 220 word paragraph describing visible identity, subject type, anatomy, expressive features, surface materials and colors, clothing if present, equipment, pose, composition and light. The fullBody prompt must explicitly require one complete character, every extremity and all equipment visible, generous margins and no cropping. For humans, both shoes must be visible if worn. The bust prompt must keep existing facial and speaking features large and unobstructed for talking video without adding a human mouth. The characterSheetPrompt must precisely describe the front/profile/back views and visible details. Preserve the same character, morphology and equipment, including outfit if present, in every prompt. ${decor ? 'The neutral portrait includes a location; describe its visible setting only where appropriate.' : 'The neutral portrait has no required scenery; request a plain backdrop unless a later scene is supplied.'} Describe what the images actually show; do not invent unseen traits, ethnicity or occupation. Write short description and voice direction in French. Escape JSON strings correctly, no markdown.`;
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
          + ` ${AVATAR_ANATOMY_PROMPT} ${AVATAR_EQUIPMENT_PROMPT} In all descriptions, describe species, morphology, fur, feathers, scales, shell or manufactured surfaces where applicable instead of inventing human features. The fullBody and sheet prompts must include the complete silhouette, all limbs, tail, wings, ears, horns and equipment as present. References to head-to-toe views, shoes, hair, eyebrows or lips apply only when those features exist. Describe the visible backpack, its straps and each held item, including which limb holds it, in the sheet and full-body prompts and wherever visible in bust prompts.`
          + (images.length > 2 ? ' Image 3 is the original source photograph: use its expression, posture and presentation as additional context for the character direction; images 1 and 2 remain the references for the generated asset descriptions.' : '')
          + ' Also return "creationBrief": a French character direction of 60 to 100 words capturing temperament, emotional range, attitudes, gestures and speaking manner. If the user supplied creationBrief, preserve it and use it throughout. Otherwise use the visible expression, posture, outfit and presentation to propose a coherent fictional persona, then apply that same persona to the voice, neutral/success/failure poses and every detailed prompt in this response. This is an editable creative proposal, not a claim about the real person’s personality. Keep the short description grounded in visible appearance; express persona through voice and pose directions without inventing unseen visual traits.'
          + ' Also return "tags": an array of 4 to 12 short French searchable keywords grounded in visible clothing, accessories, setting, presentation and any explicitly supplied persona. Avoid generic tags, ethnicity, inferred identity and unseen occupation.'
          + guidance + poseDirectionsPrompt(personalityDirection),
        thinking_budget: 0, dynamic_thinking: false, temperature: .2, max_output_tokens: 6000}}));
      break;
    } catch (error) { if (attempt) throw error; }
  }
  const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
  const fields = {
    creationBrief: String(creationBrief || '').trim().slice(0, 4000) || clean(result.creationBrief).slice(0, 4000),
    description: String(description || '').trim().slice(0, 500) || clean(result.description).slice(0, 500),
    tags: result.tags,
    speechPersonality: String(personalityDirection || '').trim().slice(0, 300) || clean(result.speechPersonality).slice(0, 300),
    posePrompts: result.posePrompts,
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
        prompt:`Write only a detailed 170 to 220 word English text-to-image prompt for this character, focused on ${key}. Describe visible anatomy, surface materials, clothing if present, equipment, colors, pose, light and exact framing. One character. Preserve identity. ${key === 'fullBody' ? 'Include the complete subject, every extremity and all carried equipment with generous margins.' : ''} ${AVATAR_ANATOMY_PROMPT} ${AVATAR_EQUIPMENT_PROMPT} No JSON or markdown.` + guidance,
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
  fields.creationBrief ||= `${fields.description} ${fields.speechPersonality}`;
  return fields;
}

