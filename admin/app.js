const tones = ['neutral', 'success', 'failure'];
const fields = ['photo', 'decor', 'preview', ...tones];
const feminineVoices = new Set(['Kore', 'Leda', 'Aoede', 'Callirrhoe', 'Autonoe', 'Despina', 'Erinome', 'Laomedeia', 'Algieba', 'Pulcherrima', 'Zubenelgenubi', 'Vindemiatrix', 'Sulafat']);
const $ = selector => document.querySelector(selector);
let catalog = [];
let current = emptyAvatar();
let activeTone = 'neutral';
let newMode = true;
let dirty = false;
let busy = false;
let generationState = null;
let messageTimer;
let voicePreviewRequest = 0;

function emptyAvatar() {
  return {id: '', name: '', description: '', voiceKey: 'gemini:Kore', speechPersonality: '', photo: '', decor: '', preview: '',
    tones: {neutral: '', success: '', failure: ''}, tonePrompts: {neutral: '', success: '', failure: ''}};
}

function message(value, ok = false, persistent = false) {
  clearTimeout(messageTimer);
  const element = $('#message');
  element.textContent = value;
  element.dataset.state = ok ? (persistent ? 'progress' : 'ok') : 'error';
  element.hidden = !value;
  if (ok && value && !persistent) messageTimer = setTimeout(() => { element.hidden = true; }, 6500);
}

async function api(path, options = {}) {
  const response = await fetch(path, options);
  const body = await response.text();
  let data;
  try { data = JSON.parse(body); }
  catch { throw new Error('Le serveur a renvoyé une page au lieu de l’API. Redémarrez api-avatars et réessayez.'); }
  if (!response.ok) throw new Error(data.error || `Erreur ${response.status}`);
  return data;
}

async function streamApi(path, options, onEvent) {
  const response = await fetch(path, options);
  if (!response.ok) {
    const body = await response.text();
    let data;
    try { data = JSON.parse(body); } catch {}
    throw new Error(data?.error || `Erreur ${response.status} lors de la génération`);
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
    if (event.type === 'error') throw new Error(event.error || 'Génération interrompue');
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
  status.textContent = path ? (tones.includes(field) ? 'Prêt' : path.split('/').at(-1)) : (field === 'decor' ? 'Facultatif' : 'À ajouter');
  status.classList.toggle('ready', !!path && tones.includes(field));
  const progress = generationState?.[field];
  if (progress && progress !== 'ready') {
    status.textContent = progress === 'running' ? 'Génération…' : 'En attente';
    status.classList.remove('ready');
  }
  status.classList.toggle('working', progress === 'running');
  if (tones.includes(field)) {
    $(`#empty-${field}`).hidden = !!path;
    $(`#empty-${field}`).textContent = progress === 'running' ? 'Portrait en cours de génération…'
      : progress === 'pending' ? 'En attente du portrait neutre…' : `Aucun portrait ${field === 'neutral' ? 'neutre' : field === 'success' ? 'de succès' : 'd’échec'}`;
    image.closest('.portrait-frame').classList.toggle('working', progress === 'running');
    $(`#details-${field}`).textContent = path ? path.split('/').at(-1) : 'PNG, JPEG ou WebP';
    if (path) image.onload = () => {
      if (media(field) === path) $(`#details-${field}`).textContent = `${image.naturalWidth} × ${image.naturalHeight} · ${path.split('.').at(-1).toUpperCase()}`;
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
  if (tones.includes(field)) current.tones[field] = path;
  else current[field] = path;
  dirty = true;
  renderMedia(field);
  renderRecordStatus();
}

function renderRecordStatus() {
  const status = $('#record-status');
  status.textContent = generationState ? 'Génération…' : current.id ? (dirty ? 'À enregistrer' : 'Enregistré') : 'Brouillon';
  status.className = `status-badge ${current.id && !dirty && !generationState ? 'status-saved' : 'status-draft'}`;
}

function renderPrompts() {
  for (const tone of tones) {
    $(`#prompt-${tone}`).value = current.tonePrompts[tone] || '';
    $(`#words-${tone}`).textContent = `${wordCount(current.tonePrompts[tone])} mots`;
  }
  selectTone(activeTone);
}

function selectTone(tone) {
  activeTone = tone;
  for (const item of tones) {
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
    subtitle.textContent = '3 expressions';
    copy.append(name, subtitle);
    const dot = document.createElement('span');
    dot.className = 'catalog-dot';
    dot.setAttribute('aria-label', 'Fiche enregistrée');
    button.append(img, copy, dot);
    button.addEventListener('click', () => {
      if (busy || !canLeave()) return;
      current = structuredClone(avatar);
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
  try { await action(); }
  catch (error) { message(error.message || String(error)); }
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
      setMedia(field, result.path);
      message('Image chargée', true);
    });
    input.value = '';
  });
}

for (const tone of tones) {
  $(`#tab-${tone}`).addEventListener('click', () => selectTone(tone));
  $(`#prompt-${tone}`).addEventListener('input', event => {
    current.tonePrompts[tone] = event.target.value;
    $(`#words-${tone}`).textContent = `${wordCount(event.target.value)} mots`;
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
  newMode = true;
  activeTone = 'neutral';
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
$('#clear-decor').addEventListener('click', () => setMedia('decor', ''));
$('#manual-mode').addEventListener('click', () => {
  newMode = false;
  renderForm();
  $('#upload-neutral').focus();
});

function setGenerationControls(disabled) {
  for (const element of document.querySelectorAll('#editor input, #editor textarea, #editor select, #editor button, #generate, #describe, #new')) {
    element.disabled = disabled;
  }
}

function applyGeneratedDetails(result) {
  current.tonePrompts = {...current.tonePrompts, ...result.tonePrompts};
  if (!current.description && result.description) current.description = result.description;
  if (!current.speechPersonality && result.speechPersonality) current.speechPersonality = result.speechPersonality;
  $('#avatar-description').value = current.description;
  $('#avatar-personality').value = current.speechPersonality;
  dirty = true;
  renderRecordStatus();
  renderPrompts();
}

async function generateFromReferences(button) {
  if (busy) return;
  current.name = $('#avatar-name').value.trim();
  if (!current.name || !current.photo) return message('Indiquez un nom et chargez une photo de référence.');
  const request = {name: current.name, photo: current.photo, decor: current.decor, voiceKey: $('#avatar-voice').value};
  generationState = {preview: 'running', neutral: 'running', success: 'pending', failure: 'pending'};
  newMode = false;
  renderForm();
  setGenerationControls(true);
  $('#prompts-progress').hidden = false;
  $('#prompts-progress').textContent = 'En attente des portraits';
  $('.studio-panel').scrollIntoView({block: 'start'});
  await run(button, 'Génération du portrait neutre…', async () => {
    await streamApi('/api/generate', {method: 'POST', headers: {'Content-Type': 'application/json', Accept: 'application/x-ndjson'},
      body: JSON.stringify(request)}, event => {
      if (event.type === 'stage' && event.tone === 'descriptions') {
        $('#prompts-progress').textContent = 'Rédaction des descriptions…';
        message('Rédaction des descriptions et de la personnalité vocale…', true, true);
      } else if (event.type === 'stage' && tones.includes(event.tone)) {
        generationState[event.tone] = 'running';
        renderMedia(event.tone);
        message(`Génération du portrait ${event.tone === 'neutral' ? 'neutre' : event.tone === 'success' ? 'de succès' : 'd’échec'}…`, true, true);
      } else if (event.type === 'portrait' && tones.includes(event.tone)) {
        generationState[event.tone] = 'ready';
        if (event.tone === 'neutral') {
          generationState.preview = 'ready';
          setMedia('preview', event.path);
        }
        setMedia(event.tone, event.path);
        if (event.tone === 'neutral') $('#prompts-progress').textContent = 'Deux expressions en cours de génération';
      } else if (event.type === 'details') {
        applyGeneratedDetails(event);
        $('#prompts-progress').hidden = true;
      }
    });
    message('Portraits et descriptions prêts à vérifier', true);
  });
  generationState = null;
  setGenerationControls(false);
  renderRecordStatus();
  $('#prompts-progress').hidden = true;
  for (const field of ['preview', ...tones]) renderMedia(field);
}
$('#generate').addEventListener('click', () => generateFromReferences($('#generate')));
$('#generate-all').addEventListener('click', () => generateFromReferences($('#generate-all')));

$('#describe').addEventListener('click', async () => {
  const paths = {neutral: current.tones.neutral || current.preview, success: current.tones.success, failure: current.tones.failure};
  if (tones.some(tone => !paths[tone])) return message('Chargez les trois portraits avant de générer leurs descriptions.');
  await run($('#describe'), 'Description détaillée des trois portraits…', async () => {
    const result = await api('/api/describe', {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({tones: paths, decor: current.decor, name: current.name, voiceKey: current.voiceKey})});
    applyGeneratedDetails(result);
    message('Descriptions et champs manquants prêts à relire', true);
  });
});

$('#editor').addEventListener('submit', async event => {
  event.preventDefault();
  for (const key of ['name', 'description', 'voiceKey', 'speechPersonality']) current[key] = $(`[name="${key}"]`).value.trim();
  for (const tone of tones) current.tonePrompts[tone] = $(`#prompt-${tone}`).value.trim();
  await run($('#save'), 'Enregistrement de l’avatar…', async () => {
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
      const gender = typeof voice === 'string' ? (feminineVoices.has(name) ? 'female' : 'male') : voice.gender;
      return {key, name, gender};
    }).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    const options = sortedVoices.map(voice => {
      const option = document.createElement('option');
      option.value = voice.key;
      option.textContent = `${voice.name} · ${voice.gender === 'female' ? 'féminine' : 'masculine'}`;
      return option;
    });
    select.replaceChildren(...options);
    $('#voice-preview').disabled = options.length === 0;
    renderForm();
  } catch (error) { message(error.message || String(error)); }
}

init();
