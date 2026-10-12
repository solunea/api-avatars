/** Traitement séquentiel du catalogue ; les étapes réussies restent réutilisables. */
export async function regenerateCatalog(tasks, {target, generate, request, onProgress = () => {}, shouldStop = () => false}) {
  if (!['characterSheet', 'neutral'].includes(target)) throw new Error('Type de régénération invalide');
  for (const task of tasks) {
    if (task.status === 'done') continue;
    if (shouldStop()) break;
    const avatar = task.avatar;
    try {
      if (!avatar.photo || !avatar.tones?.neutral) throw new Error('Photo source et portrait neutre requis');
      task.error = '';
      if (!task.generated) {
        task.status = 'generating'; onProgress(task);
        const generated = {};
        await generate({...avatar, only: target, describe: false,
          resume: {photo: avatar.photo, decor: avatar.decor,
            ...(target === 'characterSheet' ? {neutral: avatar.tones.neutral} : {})}}, event => {
          if (event.type === 'portrait' && event.tone === target) {
            generated.path = event.path;
            generated.sheetRegions = event.sheetRegions;
          }
        });
        if (!generated.path) throw new Error('Le serveur n’a pas retourné l’image attendue');
        task.generated = generated;
      }
      const updated = structuredClone(avatar);
      if (target === 'characterSheet') {
        updated.schemaVersion = 2;
        updated.characterSheet = task.generated.path;
        updated.sheetRegions = task.generated.sheetRegions;
      } else {
        updated.tones.neutral = task.generated.path;
        updated.preview = task.generated.path;
        updated.clip = null;
      }
      if (!task.details) {
        task.status = 'describing'; onProgress(task);
        const details = await request('/api/describe', {method: 'POST', headers: {'Content-Type': 'application/json'},
          body: JSON.stringify(updated)});
        if (target === 'characterSheet') {
          if (!details.characterSheetPrompt || !details.framingPrompts?.fullBody) throw new Error('Description de la planche ou du plein pied absente');
        } else if (!details.tonePrompts?.neutral) throw new Error('Description du buste absente');
        task.details = details;
      }
      const details = task.details;
      if (target === 'characterSheet') {
        updated.characterSheetPrompt = details.characterSheetPrompt;
        updated.framingPrompts = {...updated.framingPrompts,
          bust: updated.framingPrompts?.bust || updated.tonePrompts?.neutral || details.framingPrompts.bust,
          fullBody: details.framingPrompts.fullBody};
      } else {
        const bust = details.framingPrompts?.bust || details.tonePrompts?.neutral;
        updated.tonePrompts = {...updated.tonePrompts, neutral: details.tonePrompts.neutral};
        if (Number(updated.schemaVersion) === 2) updated.framingPrompts = {...updated.framingPrompts, bust};
      }
      for (const key of ['description', 'speechPersonality', 'creationBrief', 'posePrompts']) updated[key] ||= details[key];
      if (!updated.tags?.length) updated.tags = details.tags || [];
      const outdated = updated.outdatedDescriptions || (updated.descriptionsOutdated ? ['bust', 'fullBody'] : []);
      updated.outdatedDescriptions = outdated.filter(key => key !== (target === 'neutral' ? 'bust' : 'fullBody'));
      updated.descriptionsOutdated = updated.outdatedDescriptions.length > 0;
      task.status = 'saving'; onProgress(task);
      task.saved = await request(`/api/avatars/${encodeURIComponent(avatar.id)}`, {
        method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(updated)});
      task.status = 'done';
    } catch (error) {
      task.status = 'error'; task.error = error.message || String(error);
    }
    onProgress(task);
  }
}
