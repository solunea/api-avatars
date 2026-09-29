const tones = ['neutral'];
const fields = ['photo', 'decor', 'preview', 'neutral', 'characterSheet'];
const promptKeys = ['bust', 'fullBody'];
const defaultRegions = {front:{x:0,y:0,width:1/3,height:1}, profile:{x:1/3,y:0,width:1/3,height:1},
  back:{x:2/3,y:0,width:1/3,height:1}};
const $ = selector => document.querySelector(selector);
let catalog = [];
let current = emptyAvatar();
let activeTone = 'bust';
let newMode = true;
let dirty = false;
let busy = false;
let generationState = null;
let generationResume = null;
let descriptionsOutdated = false;
let activeRegion = 'front';
let messageTimer;
let voicePreviewRequest = 0;

function emptyAvatar() {
  return {id: '', schemaVersion: 2, name: '', description: '', voiceKey: 'gemini:Kore', speechPersonality: '', photo: '', decor: '', preview: '',
    characterSheet: '', characterSheetPrompt: '', sheetRegions: structuredClone(defaultRegions), framingPrompts: {bust:'', fullBody:''},
    tones: {neutral: ''}, tonePrompts: {neutral: ''}};
}

function message(value, ok = false, persistent = false) {
  clearTimeout(messageTimer);
  const element = $('#message');
  element.textContent = value;
  element.dataset.state = ok ? (persistent ? 'progress' : 'ok') : 'error';
  element.hidden = !value;
  if (ok && value && !persistent) messageTimer = setTimeout(() => { element.hidden = true; }, 6500);
}

function friendlyError(value) {
  const raw = String(value || 'Erreur inconnue');
  const status = Number(raw.match(/\b(?:status |HTTP )(\d{3})\b/i)?.[1]);
  if (status === 429 || (status >= 500 && status < 600)) {
    return `Replicate est temporairement indisponible (${status}). Relancez la génération ; les images déjà prêtes seront réutilisées.`;
  }
  return /<(?:!doctype|html|head|body)\b/i.test(raw)
    ? 'Le service de génération a renvoyé une page d’erreur. Réessayez dans quelques instants.' : raw;
}

async function api(path, options = {}) {
  const response = await fetch(path, options);
  const body = await response.text();
  let data;
  try { data = JSON.parse(body); }
  catch { throw new Error('Le serveur a renvoyé une page au lieu de l’API. Redémarrez api-avatars et réessayez.'); }
  if (!response.ok) throw new Error(friendlyError(data.error || `Erreur ${response.status}`));
  return data;
}

async function streamApi(path, options, onEvent) {
  const response = await fetch(path, options);
  if (!response.ok) {
    const body = await response.text();
    let data;
    try { data = JSON.parse(body); } catch {}
    throw new Error(friendlyError(data?.error || `Erreur ${response.status} lors de la génération`));
  }
  if (!response.headers.get('content-type')?.includes('application/x-ndjson') || !response.body) {
    throw new Error('Le serveur api-avatars doit être redémarré pour afficher la génération en direct.');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let complete = false;
  function readLine(line) {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (event.type === 'error') throw new Error(friendlyError(event.error || 'Génération interrompue'));
    if (event.type === 'complete') complete = true;
    else onEvent(event);
  }
  while (true) {
    const {done, value} = await reader.read();
    if (done) break;
    pending += decoder.decode(value, {stream: true});
    let newline;
    while ((newline = pending.indexOf('\n')) !== -1) {
      readLine(pending.slice(0, newline));
      pending = pending.slice(newline + 1);
    }
  }
  pending += decoder.decode();
  readLine(pending);
  if (!complete) throw new Error('La connexion a été interrompue avant la fin de la génération.');
}

function media(field) { return tones.includes(field) ? current.tones[field] : current[field]; }
function mediaUrl(path) { return path ? `/${path}` : ''; }
function wordCount(value) { return String(value || '').trim().split(/\s+/).filter(Boolean).length; }
function selectedVoiceName() { return $('#avatar-voice').value.replace(/^gemini:/, ''); }
function voicePreviewUrl(name) {
  if (!/^[A-Za-z]+$/.test(name)) return '';
  const slug = name === 'Aoede' ? 'aoeda' : name.toLowerCase();
  return `https://docs.cloud.google.com/static/text-to-speech/docs/audio/chirp3-hd-${slug}.wav`;
}
function updateVoicePreviewButton(playing = false) {
  const action = playing ? 'Mettre en pause' : 'Écouter';
  const button = $('#voice-preview');
  button.setAttribute('aria-label', `${action} l’échantillon de ${selectedVoiceName()}`);
  button.title = `${action} l’échantillon de ${selectedVoiceName()}`;
  $('#voice-preview-icon').textContent = playing ? 'Ⅱ' : '▶';
}
function stopVoicePreview() {
  voicePreviewRequest += 1;
  const audio = $('#voice-preview-audio');
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  updateVoicePreviewButton();
}

function renderMedia(field) {
  const path = media(field);
  const image = $(`#image-${field}`);
  const status = $(`#status-${field}`);
  image.hidden = !path;
  if (path) image.src = mediaUrl(path);
  else image.removeAttribute('src');
  status.textContent = path ? (tones.includes(field) || field === 'characterSheet' ? 'Prêt' : path.split('/').at(-1)) : (field === 'decor' ? 'Facultatif' : 'À ajouter');
  status.classList.toggle('ready', !!path && (tones.includes(field) || field === 'characterSheet'));
  const progress = generationState?.[field];
  if (progress && progress !== 'ready') {
    status.textContent = progress === 'running' ? 'Génération…' : 'En attente';
    status.classList.remove('ready');
  }
  status.classList.toggle('working', progress === 'running');
  if (tones.includes(field) || field === 'characterSheet') {
    $(`#regenerate-${field}`).textContent = path ? 'Régénérer' : 'Générer';
    if (field === 'characterSheet' && !path) image.closest('.sheet-frame').style.removeProperty('aspect-ratio');
    $(`#empty-${field}`).hidden = !!path;
    $(`#empty-${field}`).textContent = progress === 'running' ? 'Portrait en cours de génération…'
      : progress === 'pending' ? 'En attente du portrait neutre…' : (field === 'characterSheet' ? 'Aucune planche' : 'Aucun portrait neutre');
    image.closest('.portrait-frame').classList.toggle('working', progress === 'running');
    $(`#details-${field}`).textContent = path ? path.split('/').at(-1) : 'PNG, JPEG ou WebP';
    if (path) image.onload = () => {
      if (media(field) !== path) return;
      $(`#details-${field}`).textContent = `${image.naturalWidth} × ${image.naturalHeight} · ${path.split('.').at(-1).toUpperCase()}`;
      if (field === 'characterSheet') image.closest('.sheet-frame').style.aspectRatio = `${image.naturalWidth} / ${image.naturalHeight}`;
    };
  }
  if (field === 'decor') $('#clear-decor').hidden = !path;
  image.onerror = () => {
    if (media(field) !== path) return;
    status.textContent = 'Image indisponible';
    status.classList.remove('ready');
  };
}

function setMedia(field, path) {
  const replacingSheet = field === 'characterSheet' && path && path !== current.characterSheet;
  if (tones.includes(field)) current.tones[field] = path;
  else current[field] = path;
  if (field === 'neutral' && path && !current.preview) { current.preview = path; renderMedia('preview'); }
  if (field === 'characterSheet' && path) {
    current.schemaVersion = 2;
    if (replacingSheet || !current.sheetRegions) current.sheetRegions = structuredClone(defaultRegions);
    renderRegions();
  }
  dirty = true;
  renderMedia(field);
  if (field === 'neutral' || field === 'characterSheet') renderGenerateAction();
  renderRecordStatus();
}

function renderGenerateAction() {
  $('#generate').textContent = current.tones?.neutral && !current.characterSheet
    ? 'Générer la planche' : 'Générer le neutre et la planche';
}

function renderRecordStatus() {
  const status = $('#record-status');
  status.textContent = generationState ? 'Génération…' : current.id ? (dirty ? 'À enregistrer' : 'Enregistré') : 'Brouillon';
  status.className = `status-badge ${current.id && !dirty && !generationState ? 'status-saved' : 'status-draft'}`;
}

function renderPrompts() {
  for (const key of promptKeys) {
    const value = promptValue(key);
    $(`#prompt-${key}`).value = value;
    $(`#words-${key}`).textContent = `${wordCount(value)} mots`;
  }
  selectTone(activeTone);
  renderDescriptionNotice();
}

function renderDescriptionNotice() {
  if (generationState) return;
  const notice = $('#prompts-progress');
  notice.hidden = !descriptionsOutdated;
  if (descriptionsOutdated) notice.textContent = 'Image modifiée : vérifiez les descriptions ou utilisez « Décrire les images ».';
}

function selectTone(tone) {
  activeTone = tone;
  for (const item of promptKeys) {
    const selected = item === tone;
    $(`#tab-${item}`).classList.toggle('active', selected);
    $(`#tab-${item}`).setAttribute('aria-selected', String(selected));
    $(`#tab-${item}`).tabIndex = selected ? 0 : -1;
    $(`#panel-${item}`).hidden = !selected;
  }
}

function renderList() {
  const query = $('#search').value.trim().toLocaleLowerCase('fr');
  const list = $('#list');
  list.replaceChildren();
  const matches = catalog.filter(avatar => `${avatar.name} ${avatar.description || ''}`.toLocaleLowerCase('fr').includes(query));
  for (const avatar of matches) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `catalog-item${avatar.id === current.id ? ' active' : ''}`;
    button.setAttribute('aria-pressed', String(avatar.id === current.id));
    const img = document.createElement('img');
    img.src = mediaUrl(avatar.preview);
    img.alt = '';
    img.loading = 'lazy';
    const copy = document.createElement('span');
    copy.className = 'catalog-item-copy';
    const name = document.createElement('strong');
    name.textContent = avatar.name;
    const subtitle = document.createElement('small');
    subtitle.textContent = avatar.schemaVersion === 2 ? 'Neutre + planche' : 'Ancien format · à mettre à jour';
    copy.append(name, subtitle);
    const dot = document.createElement('span');
    dot.className = 'catalog-dot';
    dot.setAttribute('aria-label', 'Fiche enregistrée');
    button.append(img, copy, dot);
    button.addEventListener('click', () => {
      if (busy || !canLeave()) return;
      current = structuredClone(avatar);
      generationResume = null;
      descriptionsOutdated = false;
      newMode = false;
      dirty = false;
      renderForm();
      message('');
    });
    list.append(button);
  }
  $('#count').textContent = catalog.length;
  $('#catalog-empty').hidden = matches.length > 0;
  $('#catalog-empty').textContent = catalog.length ? 'Aucun avatar ne correspond à cette recherche.' : 'Aucun avatar enregistré. Créez votre première fiche.';
}

function renderForm() {
  document.body.classList.toggle('new-mode', newMode);
  const title = current.name || 'Nouvel avatar';
  $('#current-name').textContent = title;
  $('#breadcrumb-name').textContent = title;
  renderRecordStatus();
  $('#delete').hidden = !current.id;
  for (const key of ['name', 'description', 'voiceKey', 'speechPersonality']) $(`[name="${key}"]`).value = current[key] || '';
  stopVoicePreview();
  for (const field of fields) renderMedia(field);
  renderGenerateAction();
  renderRegions();
  renderPrompts();
  renderList();
}

function canLeave() {
  return !dirty || confirm('Des modifications ne sont pas enregistrées. Les abandonner ?');
}

async function refreshCatalog() {
  catalog = await api('/api/avatars');
  renderList();
}

async function run(button, progress, action) {
  if (busy) return;
  busy = true;
  button.disabled = true;
  message(progress, true, true);
  try { await action(); return true; }
  catch (error) { message(error.message || String(error)); return false; }
  finally { button.disabled = false; busy = false; }
}

for (const input of document.querySelectorAll('input[type="file"][data-field]')) {
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    const field = input.dataset.field;
    await run(input.closest('.button'), 'Envoi de l’image…', async () => {
      const body = new FormData();
      body.append('image', file);
      const result = await api('/api/upload', {method: 'POST', body});
      generationResume = null;
      setMedia(field, result.path);
      if (field === 'characterSheet') {
        message('Détourage de la planche…', true, true);
        const cutout = await api('/api/remove-sheet-background', {method:'POST',
          headers:{'Content-Type':'application/json'}, body:JSON.stringify({characterSheet:result.path})});
        setMedia(field, cutout.path);
      }
      if (field === 'neutral' || field === 'characterSheet') { descriptionsOutdated = true; renderDescriptionNotice(); }
      message('Image chargée', true);
    });
    input.value = '';
  });
}

function promptValue(key) {
  return current.framingPrompts?.[key] || (key === 'bust' ? current.tonePrompts?.neutral : current.characterSheetPrompt) || '';
}
function setPrompt(key, value) {
  current.framingPrompts ||= {};
  current.framingPrompts[key] = value;
}
function renderRegions() {
  const overlay = $('#sheet-overlay');
  overlay.replaceChildren();
  overlay.hidden = !current.characterSheet;
  const regions = current.sheetRegions || defaultRegions;
  $('.sheet-frame').classList.toggle('legacy', Object.keys(regions).length > 3);
  if (Object.keys(regions).length === 3 && ['front','profile','back'].every(name => regions[name])) {
    renderSheetSliders(overlay, regions);
    return;
  }
  for (const [name, region] of Object.entries(regions)) {
    const box = document.createElement('div'); box.className = 'sheet-region'; box.dataset.name = name; box.tabIndex = 0;
    const caption = document.createElement('span'); caption.className = 'sheet-region-label';
    caption.textContent = {front:'Face',profile:'Profil',back:'Dos',face:'Visage',outfit:'Tenue'}[name] || name;
    box.setAttribute('role', 'button');
    box.setAttribute('aria-label', `Zone ${caption.textContent} : flèches pour déplacer, Maj + flèches pour redimensionner`);
    box.append(caption);
    for (const corner of ['nw','ne','sw','se']) {
      const handle = document.createElement('span'); handle.className = `sheet-handle sheet-handle-${corner}`;
      handle.dataset.handle = corner; handle.setAttribute('aria-hidden','true'); box.append(handle);
    }
    attachRegionDrag(box, name, region);
    overlay.append(box);
    drawRegion(name, region);
  }
  selectRegion(activeRegion);
}
function renderSheetSliders(overlay, regions) {
  const labels = {front:'Face',profile:'Profil',back:'Dos'};
  const panels = Object.fromEntries(Object.keys(labels).map(name => {
    const panel = document.createElement('div');
    panel.className = 'sheet-panel';
    panel.dataset.name = name;
    const caption = document.createElement('span');
    caption.className = 'sheet-region-label';
    caption.textContent = labels[name];
    panel.append(caption);
    overlay.append(panel);
    return [name,panel];
  }));
  const dividers = ['front','profile'].map((name, index) => {
    const divider = document.createElement('div');
    divider.className = 'sheet-divider';
    divider.tabIndex = 0;
    divider.setAttribute('role','slider');
    divider.setAttribute('aria-label', index ? 'Séparation profil et dos' : 'Séparation face et profil');
    divider.setAttribute('aria-valuemin','15');
    divider.setAttribute('aria-valuemax','85');
    divider.setAttribute('aria-orientation','horizontal');
    const grip = document.createElement('span');
    grip.className = 'sheet-divider-grip';
    grip.setAttribute('aria-hidden','true');
    grip.textContent = '⋮⋮';
    divider.append(grip);
    overlay.append(divider);
    return divider;
  });
  function draw() {
    for (const [name,panel] of Object.entries(panels)) {
      panel.style.left = `${regions[name].x*100}%`;
      panel.style.width = `${regions[name].width*100}%`;
    }
    const boundaries = [regions.profile.x,regions.back.x];
    dividers.forEach((divider,index) => {
      divider.style.left = `${boundaries[index]*100}%`;
      divider.setAttribute('aria-valuenow',String(Math.round(boundaries[index]*100)));
      divider.setAttribute('aria-valuemin',String(Math.round((index ? regions.profile.x+.15 : .15)*100)));
      divider.setAttribute('aria-valuemax',String(Math.round((index ? .85 : regions.back.x-.15)*100)));
    });
  }
  function move(index, value) {
    const other = index ? regions.profile.x : regions.back.x;
    const boundary = index ? Math.max(other+.15,Math.min(.85,value)) : Math.max(.15,Math.min(other-.15,value));
    if (index) {
      regions.profile.width = boundary-regions.profile.x;
      regions.back.x = boundary;
      regions.back.width = 1-boundary;
    } else {
      regions.front.width = boundary;
      regions.profile.x = boundary;
      regions.profile.width = regions.back.x-boundary;
    }
    draw();
    dirty = true;
    renderRecordStatus();
  }
  dividers.forEach((divider,index) => {
    divider.addEventListener('pointerdown',event => {
      if (event.button !== 0 && event.pointerType === 'mouse') return;
      event.preventDefault();
      divider.setPointerCapture(event.pointerId);
    });
    divider.addEventListener('pointermove',event => {
      if (!divider.hasPointerCapture(event.pointerId)) return;
      const bounds = overlay.getBoundingClientRect();
      move(index,(event.clientX-bounds.left)/bounds.width);
    });
    divider.addEventListener('keydown',event => {
      if (!['ArrowLeft','ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      move(index,(index ? regions.back.x : regions.profile.x) + (event.key === 'ArrowLeft' ? -.01 : .01));
    });
  });
  draw();
}
function selectRegion(name) {
  activeRegion = name;
  for (const box of document.querySelectorAll('#sheet-overlay .sheet-region')) box.classList.toggle('selected', box.dataset.name === name);
}
function drawRegion(name, r) {
  const box = $(`#sheet-overlay [data-name="${name}"]`);
  if (!box) return;
  Object.assign(box.style, {left:`${r.x*100}%`,top:`${r.y*100}%`,width:`${r.width*100}%`,height:`${r.height*100}%`});
}
function attachRegionDrag(box, name, region) {
  let drag = null;
  box.addEventListener('pointerdown', event => {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    event.preventDefault();
    selectRegion(name);
    const bounds = $('#sheet-overlay').getBoundingClientRect();
    const handle = event.target.closest('[data-handle]')?.dataset.handle || '';
    drag = {pointerId:event.pointerId, x:event.clientX, y:event.clientY, original:{...region},
      width:bounds.width, height:bounds.height, handle};
    box.setPointerCapture(event.pointerId);
  });
  box.addEventListener('pointermove', event => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = (event.clientX - drag.x) / drag.width;
    const dy = (event.clientY - drag.y) / drag.height;
    const original = drag.original;
    let left = original.x, top = original.y, right = original.x + original.width, bottom = original.y + original.height;
    if (!drag.handle) {
      left = Math.max(0, Math.min(1 - original.width, original.x + dx));
      top = Math.max(0, Math.min(1 - original.height, original.y + dy));
      right = left + original.width; bottom = top + original.height;
    } else {
      if (drag.handle.includes('w')) left = Math.max(0, Math.min(right - .03, original.x + dx));
      if (drag.handle.includes('e')) right = Math.min(1, Math.max(left + .03, original.x + original.width + dx));
      if (drag.handle.includes('n')) top = Math.max(0, Math.min(bottom - .03, original.y + dy));
      if (drag.handle.includes('s')) bottom = Math.min(1, Math.max(top + .03, original.y + original.height + dy));
    }
    Object.assign(region, {x:left,y:top,width:right-left,height:bottom-top});
    drawRegion(name, region);
    dirty = true; renderRecordStatus();
  });
  box.addEventListener('focus', () => selectRegion(name));
  box.addEventListener('keydown', event => {
    const steps = {ArrowLeft:[-.01,0], ArrowRight:[.01,0], ArrowUp:[0,-.01], ArrowDown:[0,.01]};
    if (!steps[event.key]) return;
    event.preventDefault();
    const [dx, dy] = steps[event.key];
    if (event.shiftKey) {
      region.width = Math.max(.03, Math.min(1 - region.x, region.width + dx));
      region.height = Math.max(.03, Math.min(1 - region.y, region.height + dy));
    } else {
      region.x = Math.max(0, Math.min(1 - region.width, region.x + dx));
      region.y = Math.max(0, Math.min(1 - region.height, region.y + dy));
    }
    drawRegion(name, region);
    dirty = true; renderRecordStatus();
  });
  const finish = event => { if (drag?.pointerId === event.pointerId) drag = null; };
  box.addEventListener('pointerup', finish);
  box.addEventListener('pointercancel', finish);
}
for (const key of promptKeys) {
  $(`#tab-${key}`).addEventListener('click', () => selectTone(key));
  $(`#prompt-${key}`).addEventListener('input', event => {
    setPrompt(key, event.target.value);
    $(`#words-${key}`).textContent = `${wordCount(event.target.value)} mots`;
    dirty = true;
    renderRecordStatus();
  });
}

for (const key of ['name', 'description', 'voiceKey', 'speechPersonality']) {
  $(`[name="${key}"]`).addEventListener('input', event => {
    current[key] = event.target.value;
    dirty = true;
    renderRecordStatus();
    if (key === 'name') {
      $('#current-name').textContent = current.name || 'Nouvel avatar';
      $('#breadcrumb-name').textContent = current.name || 'Nouvel avatar';
    }
  });
}

$('#new').addEventListener('click', () => {
  if (busy || !canLeave()) return;
  current = emptyAvatar();
  generationResume = null;
  descriptionsOutdated = false;
  newMode = true;
  activeTone = 'bust';
  dirty = false;
  renderForm();
  $('#avatar-name').focus();
  message('');
});
$('#search').addEventListener('input', renderList);
$('#avatar-voice').addEventListener('change', stopVoicePreview);
$('#voice-preview-audio').addEventListener('play', () => updateVoicePreviewButton(true));
$('#voice-preview-audio').addEventListener('pause', () => updateVoicePreviewButton());
$('#voice-preview-audio').addEventListener('ended', () => updateVoicePreviewButton());
$('#voice-preview-audio').addEventListener('error', () => {
  if ($('#voice-preview-audio').src) {
    updateVoicePreviewButton();
    message('Échantillon de voix indisponible. Réessayez plus tard.');
  }
});
$('#voice-preview').addEventListener('click', async () => {
  const audio = $('#voice-preview-audio');
  if (!audio.paused) { audio.pause(); return; }
  const url = voicePreviewUrl(selectedVoiceName());
  if (!url) return message('Aucun échantillon disponible pour cette voix.');
  const request = ++voicePreviewRequest;
  if (audio.src !== url) audio.src = url;
  try { await audio.play(); }
  catch (error) {
    if (request === voicePreviewRequest) message('Lecture de l’échantillon impossible. Réessayez plus tard.');
  }
});
$('#clear-decor').addEventListener('click', () => { generationResume = null; setMedia('decor', ''); });
$('#manual-mode').addEventListener('click', () => {
  newMode = false;
  renderForm();
  $('#upload-neutral').focus();
});

function setGenerationControls(disabled) {
  for (const element of document.querySelectorAll('#editor input, #editor textarea, #editor select, #editor button, #generate, #describe, #new, #regenerate-neutral, #regenerate-characterSheet, #upload-neutral, #upload-characterSheet')) {
    element.disabled = disabled;
  }
}

function applyGeneratedDetails(result, {preserveNeutral = false} = {}) {
  const neutralPrompt = preserveNeutral ? current.tonePrompts?.neutral : '';
  current.tonePrompts = {...current.tonePrompts, ...result.tonePrompts};
  if (neutralPrompt) current.tonePrompts.neutral = neutralPrompt;
  current.characterSheetPrompt = result.characterSheetPrompt || current.characterSheetPrompt;
  current.framingPrompts = {...current.framingPrompts, ...result.framingPrompts};
  if (!current.description && result.description) current.description = result.description;
  if (!current.speechPersonality && result.speechPersonality) current.speechPersonality = result.speechPersonality;
  $('#avatar-description').value = current.description;
  $('#avatar-personality').value = current.speechPersonality;
  descriptionsOutdated = false;
  dirty = true;
  renderRecordStatus();
  renderPrompts();
}

async function generateFromReferences(button) {
  if (busy) return;
  current.name = $('#avatar-name').value.trim();
  if (!current.name || !current.photo) return message('Indiquez un nom et chargez une photo de référence.');
  const key = JSON.stringify([current.name, current.photo, current.decor]);
  if (generationResume?.key !== key) generationResume = {key,
    neutral: current.tones?.neutral && !current.characterSheet ? current.tones.neutral : '', characterSheet: '', sheetViews: {}};
  const request = {name: current.name, photo: current.photo, decor: current.decor, voiceKey: $('#avatar-voice').value,
    resume: {neutral: generationResume.neutral, characterSheet: generationResume.characterSheet, sheetViews: generationResume.sheetViews}};
  generationState = {preview: generationResume.neutral ? 'ready' : 'running', neutral: generationResume.neutral ? 'ready' : 'running',
    characterSheet: generationResume.characterSheet ? 'ready' : 'pending'};
  newMode = false;
  renderForm();
  setGenerationControls(true);
  $('#prompts-progress').hidden = false;
  $('#prompts-progress').textContent = 'En attente des portraits';
  $('.studio-panel').scrollIntoView({block: 'start'});
  const completed = await run(button, generationResume.neutral ? 'Reprise de la génération…' : 'Génération du portrait neutre…', async () => {
    await streamApi('/api/generate', {method: 'POST', headers: {'Content-Type': 'application/json', Accept: 'application/x-ndjson'},
      body: JSON.stringify(request)}, event => {
      if (event.type === 'stage' && event.tone === 'descriptions') {
        $('#prompts-progress').textContent = 'Rédaction des descriptions…';
        message('Rédaction des descriptions et de la personnalité vocale…', true, true);
      } else if (event.type === 'stage' && fields.includes(event.tone)) {
        generationState[event.tone] = 'running';
        renderMedia(event.tone);
        message(event.tone === 'characterSheet' ? 'Génération des vues de la planche…' : 'Génération du portrait neutre…', true, true);
      } else if (event.type === 'sheetView') {
        generationResume.sheetViews[event.view] = event.path;
        message(`Vue ${event.view} prête. Assemblage de la planche…`, true, true);
      } else if (event.type === 'portrait' && fields.includes(event.tone)) {
        generationState[event.tone] = 'ready';
        if (event.tone === 'neutral') {
          generationResume.neutral = event.path;
          generationState.preview = 'ready';
          setMedia('preview', event.path);
        }
        if (event.tone === 'characterSheet') generationResume.characterSheet = event.path;
        setMedia(event.tone, event.path);
        if (event.tone === 'characterSheet' && !event.reused) { current.sheetRegions = event.sheetRegions; renderRegions(); }
        if (event.tone === 'neutral') $('#prompts-progress').textContent = 'Planche en cours de génération';
      } else if (event.type === 'details') {
        applyGeneratedDetails(event, {preserveNeutral: !!request.resume.neutral});
        $('#prompts-progress').hidden = true;
      }
    });
    message('Portrait, planche et descriptions prêts à vérifier', true);
  });
  if (completed) generationResume = null;
  generationState = null;
  setGenerationControls(false);
  renderRecordStatus();
  $('#prompts-progress').hidden = true;
  for (const field of ['preview', 'neutral', 'characterSheet']) renderMedia(field);
}
$('#generate').addEventListener('click', () => generateFromReferences($('#generate')));
$('#generate-all').addEventListener('click', () => generateFromReferences($('#generate-all')));

async function regenerateOne(field) {
  if (busy) return;
  const button = $(`#regenerate-${field}`);
  const name = $('#avatar-name').value.trim();
  if (!name || !current.photo) return message('Indiquez un nom et chargez une photo de référence.');
  const neutral = current.tones?.neutral || '';
  if (field === 'characterSheet' && !neutral) return message('Générez ou importez le portrait neutre avant la planche.');
  const key = JSON.stringify(['single', field, name, current.photo, current.decor, field === 'characterSheet' ? neutral : '']);
  if (generationResume?.key !== key) generationResume = {key, neutral: field === 'characterSheet' ? neutral : '', sheetViews: {}};
  const previousNeutral = neutral;
  const previewFollowedNeutral = !current.preview || current.preview === previousNeutral;
  const request = {name, photo:current.photo, decor:current.decor, voiceKey:$('#avatar-voice').value,
    only:field, describe:false, resume:{neutral:generationResume.neutral, sheetViews:generationResume.sheetViews}};
  current.name = name;
  generationState = {[field]:'running'};
  newMode = false;
  renderForm();
  setGenerationControls(true);
  const label = field === 'neutral' ? 'du portrait neutre' : 'de la planche';
  const completed = await run(button, `Régénération ${label}…`, async () => {
    await streamApi('/api/generate', {method:'POST', headers:{'Content-Type':'application/json', Accept:'application/x-ndjson'},
      body:JSON.stringify(request)}, event => {
      if (event.type === 'sheetView') generationResume.sheetViews[event.view] = event.path;
      if (event.type === 'portrait' && event.tone === field) {
        descriptionsOutdated = true;
        if (field === 'neutral') {
          generationResume.neutral = event.path;
          setMedia('neutral', event.path);
          if (previewFollowedNeutral) setMedia('preview', event.path);
        } else {
          setMedia('characterSheet', event.path);
          current.sheetRegions = structuredClone(event.sheetRegions || defaultRegions);
          renderRegions();
        }
        generationState[field] = 'ready';
        renderMedia(field);
      }
    });
    descriptionsOutdated = true;
    message(field === 'neutral'
      ? 'Neutre régénéré. Vérifiez sa cohérence avec la planche et les descriptions avant d’enregistrer.'
      : 'Planche régénérée. Vérifiez les découpes et les descriptions avant d’enregistrer.', true);
  });
  if (completed) generationResume = null;
  generationState = null;
  setGenerationControls(false);
  renderRecordStatus();
  renderMedia(field);
  renderDescriptionNotice();
}
$('#regenerate-neutral').addEventListener('click', () => regenerateOne('neutral'));
$('#regenerate-characterSheet').addEventListener('click', () => regenerateOne('characterSheet'));
$('#remove-sheet-background').addEventListener('click', () => {
  if (!current.characterSheet) return message('Importez ou générez une planche avant de retirer son fond.');
  run($('#remove-sheet-background'), 'Détourage de la planche…', async () => {
    const result = await api('/api/remove-sheet-background', {method:'POST',
      headers:{'Content-Type':'application/json'}, body:JSON.stringify({characterSheet:current.characterSheet})});
    if (result.path !== current.characterSheet) {
      setMedia('characterSheet', result.path);
      descriptionsOutdated = true;
      renderDescriptionNotice();
    }
    message('Fond retiré. Vérifiez la planche avant d’enregistrer.', true);
  });
});

$('#describe').addEventListener('click', async () => {
  const paths = {neutral: current.tones.neutral || current.preview};
  if (!paths.neutral || !current.characterSheet) return message('Chargez le neutre et la planche avant de générer leurs descriptions.');
  await run($('#describe'), 'Description détaillée des images…', async () => {
    const result = await api('/api/describe', {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({schemaVersion: 2, tones: paths, characterSheet: current.characterSheet, decor: current.decor, name: current.name, voiceKey: current.voiceKey})});
    applyGeneratedDetails(result);
    message('Descriptions et champs manquants prêts à relire', true);
  });
});

$('#editor').addEventListener('submit', async event => {
  event.preventDefault();
  for (const key of ['name', 'description', 'voiceKey', 'speechPersonality']) current[key] = $(`[name="${key}"]`).value.trim();
  for (const key of promptKeys) setPrompt(key, $(`#prompt-${key}`).value.trim());
  if (!current.characterSheet) return message('Générez ou importez la planche avant d’enregistrer cette fiche.');
  current.schemaVersion = 2;
  current.tones = {neutral: current.tones.neutral || current.preview};
  const missingDescriptions = promptKeys.some(key => !promptValue(key)) || !current.tonePrompts?.neutral || !current.characterSheetPrompt;
  await run($('#save'), missingDescriptions ? 'Description des portraits à partir des images…' : 'Enregistrement de l’avatar…', async () => {
    const saved = await api(current.id ? `/api/avatars/${encodeURIComponent(current.id)}` : '/api/avatars', {
      method: current.id ? 'PUT' : 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(current)
    });
    current = saved;
    dirty = false;
    await refreshCatalog();
    renderForm();
    message('Avatar enregistré. Utilisez Publier pour le diffuser.', true);
  });
});

$('#delete').addEventListener('click', async () => {
  if (!current.id || !confirm(`Supprimer ${current.name} du catalogue ?`)) return;
  await run($('#delete'), 'Suppression de l’avatar…', async () => {
    await api(`/api/avatars/${encodeURIComponent(current.id)}`, {method: 'DELETE'});
    current = emptyAvatar();
    dirty = false;
    await refreshCatalog();
    renderForm();
    message('Avatar supprimé', true);
  });
});

$('#build').addEventListener('click', () => run($('#build'), 'Validation de l’API…', async () => {
  const result = await api('/api/build', {method: 'POST'});
  message(`API validée : ${result.count} avatar(s)`, true);
}));

$('#publish').addEventListener('click', () => {
  if (dirty) return message('Enregistrez les modifications avant de publier.');
  return run($('#publish'), 'Publication en cours…', async () => {
    const result = await api('/api/push', {method: 'POST'});
    message(result.message, true);
  });
});

async function init() {
  try {
    const [voices] = await Promise.all([api('/api/voices'), refreshCatalog()]);
    const select = $('#avatar-voice');
    const sortedVoices = voices.map(voice => {
      const key = typeof voice === 'string' ? voice : voice.key;
      const name = typeof voice === 'string' ? voice.replace(/^gemini:/, '') : voice.name;
      const gender = typeof voice === 'string' ? '' : voice.gender;
      return {key, name, gender};
    }).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    const options = sortedVoices.map(voice => {
      const option = document.createElement('option');
      option.value = voice.key;
      const genderLabel = voice.gender === 'female' ? 'féminine' : voice.gender === 'male' ? 'masculine' : '';
      option.textContent = genderLabel ? `${voice.name} · ${genderLabel}` : voice.name;
      return option;
    });
    select.replaceChildren(...options);
    $('#voice-preview').disabled = options.length === 0;
    renderForm();
  } catch (error) { message(error.message || String(error)); }
}

init();
