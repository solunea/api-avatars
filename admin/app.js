const fields = ['photo', 'decor', 'preview', 'neutral', 'success', 'failure'];
const labels = {photo:'Photo de référence', decor:'Décor facultatif', preview:'Image de sélection', neutral:'Ton neutre', success:'Succès', failure:'Échec'};
const tones = ['neutral', 'success', 'failure'];
const $ = selector => document.querySelector(selector);
let catalog = [];
let current = emptyAvatar();

function emptyAvatar(){return {id:'',name:'',description:'',voiceKey:'gemini:Kore',speechPersonality:'',photo:'',decor:'',preview:'',tones:{neutral:'',success:'',failure:''},tonePrompts:{neutral:'',success:'',failure:''}};}
function message(value, ok=false){$('#message').textContent=value;$('#message').classList.toggle('ok',ok);}
async function api(path, options={}){const response=await fetch(path,options);const data=await response.json();if(!response.ok)throw new Error(data.error||`Erreur ${response.status}`);return data;}
function image(path){return path ? `/${path}` : '';}
function setMedia(field,path){if(tones.includes(field))current.tones[field]=path;else current[field]=path;const preview=$(`#image-${field}`);preview.src=image(path);preview.hidden=!path;}
function media(field){return tones.includes(field)?current.tones[field]:current[field];}
function renderForm(){
  $('#record-id').textContent=current.id||'Nouvel avatar';$('#delete').hidden=!current.id;
  for(const key of ['name','description','voiceKey','speechPersonality'])$(`[name="${key}"]`).value=current[key]||'';
  for(const field of fields)setMedia(field,media(field));
  for(const tone of tones)$(`[name="prompt-${tone}"]`).value=current.tonePrompts[tone]||'';
}
function renderList(){
  const query=$('#search').value.trim().toLowerCase();const target=$('#list');target.replaceChildren();
  for(const avatar of catalog.filter(item=>`${item.name} ${item.description||''}`.toLowerCase().includes(query))){
    const button=document.createElement('button');button.type='button';button.className='catalog-item';
    const img=document.createElement('img');img.src=image(avatar.preview);img.alt='';button.append(img);
    const body=document.createElement('span');const name=document.createElement('strong');name.textContent=avatar.name;const id=document.createElement('small');id.textContent=avatar.id;body.append(name,id);button.append(body);
    button.onclick=()=>{current=structuredClone(avatar);renderForm();};target.append(button);
  }
  $('#count').textContent=`(${catalog.length})`;
}
async function load(){catalog=await api('/api/avatars');renderList();}
for(const field of fields){
  const card=document.createElement('div');card.className='media';
  const imageElement=document.createElement('img');imageElement.id=`image-${field}`;imageElement.alt=`Aperçu ${labels[field]}`;imageElement.hidden=true;
  const label=document.createElement('label');label.textContent=labels[field];const input=document.createElement('input');input.type='file';input.accept='image/png,image/jpeg,image/webp';
  input.onchange=async()=>{const file=input.files[0];if(!file)return;try{message('Envoi en cours…');const body=new FormData();body.append('image',file);const result=await api('/api/upload',{method:'POST',body});setMedia(field,result.path);message('Image chargée',true);}catch(error){message(error.message);}finally{input.value='';}};
  label.append(input);card.append(imageElement,label);if(field==='decor'){const clear=document.createElement('button');clear.type='button';clear.textContent='Retirer le décor';clear.onclick=()=>setMedia('decor','');card.append(clear);}$('#media-fields').append(card);
}
for(const tone of tones){const label=document.createElement('label');label.textContent=labels[tone];const textarea=document.createElement('textarea');textarea.name=`prompt-${tone}`;textarea.rows=5;textarea.required=true;label.append(textarea);$('#prompt-fields').append(label);}
api('/api/voices').then(voices=>{for(const voice of voices){const option=document.createElement('option');option.value=voice;option.textContent=voice.replace('gemini:','');$('[name="voiceKey"]').append(option);}renderForm();}).catch(error=>message(error.message));
$('#new').onclick=()=>{current=emptyAvatar();renderForm();message('');};
$('#search').oninput=renderList;
$('#build').onclick=async()=>{try{const result=await api('/api/build',{method:'POST'});message(`API validée : ${result.count} avatar(s)`,true);}catch(error){message(error.message);}};
$('#publish').onclick=async()=>{try{message('Publication en cours…');const result=await api('/api/push',{method:'POST'});message(result.message,true);}catch(error){message(error.message);}};
$('#generate').onclick=async()=>{const button=$('#generate');try{
  current.name=$('[name="name"]').value.trim();if(!current.name||!current.photo)throw new Error('Indiquez un nom et chargez une photo.');
  button.disabled=true;message('Génération des trois portraits en cours…');const result=await api('/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:current.name,photo:current.photo,decor:current.decor})});
  setMedia('preview',result.preview);for(const tone of tones){setMedia(tone,result.tones[tone]);$(`[name="prompt-${tone}"]`).value=result.tonePrompts[tone];}message('Portraits prêts à vérifier',true);
}catch(error){message(error.message);}finally{button.disabled=false;}};
$('#editor').onsubmit=async event=>{event.preventDefault();try{
  current.name=$('[name="name"]').value.trim();current.description=$('[name="description"]').value.trim();current.voiceKey=$('[name="voiceKey"]').value;current.speechPersonality=$('[name="speechPersonality"]').value;
  for(const tone of tones)current.tonePrompts[tone]=$(`[name="prompt-${tone}"]`).value.trim();
  const saved=await api(current.id?`/api/avatars/${current.id}`:'/api/avatars',{method:current.id?'PUT':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(current)});
  current=saved;await load();renderForm();message('Avatar enregistré',true);
}catch(error){message(error.message);}};
$('#delete').onclick=async()=>{if(!current.id||!confirm(`Supprimer ${current.name} du catalogue ?`))return;try{await api(`/api/avatars/${current.id}`,{method:'DELETE'});current=emptyAvatar();await load();renderForm();message('Avatar supprimé',true);}catch(error){message(error.message);}};
load().catch(error=>message(error.message));
