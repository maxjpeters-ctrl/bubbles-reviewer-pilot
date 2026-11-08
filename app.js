/* Offline manual review only. No model, answers, requests or persistent storage. */
'use strict';
(() => {
 try {
  const data = window.ReviewerPacket;
  if (!data || !data.packet || !data.templates) throw new Error('Paketdatei fehlt');
  const tasks = data.packet.tasks;
  const states = new Map(tasks.map(t => [t.taskId, {draft: {}, startedAt: null, exported: null, url: null}]));
  let active = tasks[0].taskId;
  const roles = ['occurrence','publishedAt','updatedAt','identity','claim','missing_evidence'];
  const judgments = ['same_incident','different_incident','insufficient_evidence'];
  const relations = ['update','correction','contradiction','none','insufficient_evidence'];
  const confidences = ['low','medium','high'];
  const codepoints = text => Array.from(text);
  function quote(text, start, end) {
    const chars = codepoints(text);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > chars.length)
      throw new Error('Beleg braucht gültigen Start und ein größeres Ende innerhalb des Textes.');
    return chars.slice(start,end).join('');
  }
  Object.defineProperty(window, 'ReviewerHelpers', {value: Object.freeze({codepoints, quote})});
  const utcNow = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const el = (tag, text, attrs = {}) => {
    const node = document.createElement(tag);
    if (text !== null) node.textContent = text;
    for (const [key,value] of Object.entries(attrs)) node.setAttribute(key,value);
    return node;
  };
  const add = (parent, ...children) => { children.forEach(c => parent.appendChild(c)); return parent; };
  const select = (id, values) => {
    const node = el('select',null,{id,required:''});
    add(node,el('option','Bitte manuell wählen',{value:''}));
    values.forEach(value => add(node,el('option',value,{value})));
    return node;
  };
  function field(parent, title, node) {
    const label = el('label',title,{for:node.id}); add(parent,label,node); return node;
  }
  function saveDraft() {
    const form = document.getElementById('review-form'); if (!form) return;
    const draft = states.get(active).draft;
    form.querySelectorAll('input,select,textarea').forEach(node => {
      if (node.id) draft[node.id] = node.type === 'checkbox' ? node.checked : node.value;
    });
  }
  function error(message) {
    const node = document.getElementById('form-error'); node.textContent = message; node.focus();
  }
  function preview(side, source) {
    const box = document.querySelector(`[data-citation-side="${side}"]`);
    const start = box.querySelector('[data-field="start"]').value;
    const end = box.querySelector('[data-field="end"]').value;
    let text = 'Noch kein Beleg gewählt.';
    if (start !== '' && end !== '') {
      try { text = quote(source.rawText, Number(start), Number(end)); }
      catch (e) { text = e.message; }
    }
    box.querySelector('[data-quote]').textContent = text;
  }
  function buildResponse(task, state) {
    const form = document.getElementById('review-form');
    const value = id => form.querySelector('#'+id).value;
    const require = (ok,message) => { if (!ok) throw new Error(message); };
    require(state.startedAt !== null,'Zuerst die Bearbeitung bewusst beginnen.');
    const reviewer = value('reviewer-id'), response = value('response-id');
    require(/^[a-z][a-z0-9-]{0,63}$/.test(reviewer),'Pseudonym: 1–64 Zeichen, kleiner Buchstabe am Anfang, danach a–z, 0–9 oder Bindestrich.');
    require(/^[a-z][a-z0-9-]{0,63}$/.test(response),'Antwortkennung: 1–64 Zeichen, kleiner Buchstabe am Anfang, danach a–z, 0–9 oder Bindestrich.');
    require(!Array.from(states.values()).some(s => s.exported && s.exported.responseId === response),'Antwortkennung wurde in diesem Tab bereits verwendet. Pro Aufgabe eine neue Kennung wählen.');
    require(judgments.includes(value('judgment')),'Ereignisidentität manuell wählen.');
    require(relations.includes(value('relation')),'Aussagebeziehung B relativ zu A separat wählen.');
    require(confidences.includes(value('confidence')),'Subjektive Sicherheit manuell wählen.');
    const explanation = value('explanation');
    require(codepoints(explanation.trim()).length >= 20 && codepoints(explanation).length <= 2000,'Erklärung: mindestens 20 nicht-leere Zeichen, maximal 2000 Codepoints.');
    require(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(explanation),'Steuerzeichen in der Erklärung sind nicht erlaubt.');
    require(['yes','no'].includes(value('independence')),'Unabhängigkeit ehrlich mit yes oder no erklären.');
    require(form.querySelector('#blind-confirm').checked,'Nur bei tatsächlicher Verblindung bestätigen; sonst Koordinator kontaktieren.');
    require(form.querySelector('#manual-confirm').checked,'Eigene manuelle Bewertung ausdrücklich bestätigen.');
    const citations = task.sides.map((side,index) => {
      const key = index === 0 ? 'A' : 'B'; const source = side.source;
      const box = form.querySelector(`[data-citation-side="${key}"]`);
      const startRaw = box.querySelector('[data-field="start"]').value;
      const endRaw = box.querySelector('[data-field="end"]').value;
      const role = box.querySelector('[data-field="field"]').value;
      require(startRaw !== '' && endRaw !== '',`Beleg für Text ${key} fehlt.`);
      const start = Number(startRaw), end = Number(endRaw);
      require(roles.includes(role),`Evidenzrolle für Text ${key} manuell wählen.`);
      return {documentId:source.documentId,sourceSha256:source.sha256,start,end,
              quote:quote(source.rawText,start,end),field:role};
    });
    const completedAt = utcNow();
    require(completedAt >= state.startedAt,'Geräteuhr wurde zurückgestellt. Pilot stoppen und Koordinator kontaktieren.');
    const answer = JSON.parse(JSON.stringify(data.templates[task.taskId]));
    Object.assign(answer,{kind:'human_response',reviewerId:reviewer,responseId:response,
      startedAt:state.startedAt,completedAt,judgment:value('judgment'),relationBtoA:value('relation'),
      judgmentConfidence:value('confidence'),explanation,citations,
      provenance:{method:'manual-human',independentFromCorpusAuthor:value('independence') === 'yes',
                  modelAndLabelsHidden:true,attestation:'I authored this judgment manually from the blinded packet.'}});
    return answer;
  }
  function render() {
    const task = tasks.find(t => t.taskId === active), state = states.get(active);
    const region = document.getElementById('task-region'); region.replaceChildren();
    const heading = el('h2','Aufgabe '+task.taskId,{id:'task-heading',tabindex:'-1'}); add(region,heading);
    const sides = el('div',null,{class:'sides'}); add(region,sides);
    task.sides.forEach((side,index) => {
      const key = index === 0 ? 'A' : 'B', source = side.source;
      const article = el('article');
      add(article,el('h3',`Text ${key} · ${source.documentId}`),
          el('p',`Eigene synthetische Quelle · Herkunft: ${source.originId} · Sprache: ${source.language}`),
          el('blockquote',source.rawText,{'data-source-side':key}),
          el('p',`Original-SHA-256: ${source.sha256}`),
          el('p',`Unicode-Codepoints: 0 bis ${codepoints(source.rawText).length} (Ende exklusiv).`));
      const details = el('details');
      add(details,el('summary','Zeitrollen und exakte Quellbelege anzeigen'),
          el('p','Quellenbehauptungen, keine bestätigten Tatsachen. Unbekannt bleibt unbekannt.'),
          el('pre',JSON.stringify(side.timeClaims,null,2))); add(article,details); add(sides,article);
    });
    const holder = document.getElementById('form-region'); holder.replaceChildren();
    const startButton = el('button','Bearbeitung jetzt beginnen',{id:'start-review',type:'button'});
    startButton.disabled = state.startedAt !== null;
    const times = el('p',state.startedAt ? 'Begonnen (UTC): '+state.startedAt : 'Noch nicht begonnen. Geräteuhr vor Beginn prüfen.',{id:'review-times'});
    startButton.addEventListener('click',() => {saveDraft();state.startedAt=utcNow();render();document.getElementById('reviewer-id').focus();});
    add(holder,startButton,times);
    const form = el('form',null,{id:'review-form',novalidate:'',autocomplete:'off'}); add(holder,form);
    field(form,'Eigenes Pseudonym (keine persönlichen Daten)',el('input',null,{id:'reviewer-id',type:'text',maxlength:'64',autocapitalize:'none',spellcheck:'false',required:''}));
    field(form,'Eindeutige Antwortkennung für diese Aufgabe',el('input',null,{id:'response-id',type:'text',maxlength:'64',autocapitalize:'none',spellcheck:'false',required:''}));
    field(form,'Ereignisidentität',select('judgment',judgments));
    field(form,'Aussagebeziehung B relativ zu A (getrennte Achse)',select('relation',relations));
    field(form,'Subjektive Sicherheit des Urteils',select('confidence',confidences));
    field(form,'Eigene Erklärung und konkrete Evidenzlücken (20–2000 Codepoints)',el('textarea',null,{id:'explanation',required:'',spellcheck:'false'}));
    task.sides.forEach((side,index) => {
      const key = index === 0 ? 'A' : 'B'; const source = side.source;
      const box = el('fieldset',null,{'data-citation-side':key}); add(box,el('legend',`Exakter Quellenbeleg · Text ${key}`));
      for (const [kind,title] of [['start','Start (inklusive)'],['end','Ende (exklusive)']]) {
        field(box,title,el('input',null,{id:`cite-${key}-${kind}`,type:'number',min:'0',max:String(codepoints(source.rawText).length),step:'1','data-field':kind,required:''}));
      }
      const useFull = el('button','Ganzen Text als Beleg wählen',{type:'button','data-use-full':key});
      useFull.addEventListener('click',() => {
        box.querySelector('[data-field=start]').value='0';
        box.querySelector('[data-field=end]').value=String(codepoints(source.rawText).length);
        preview(key,source);saveDraft();
      });
      add(box,useFull);
      const role = select(`cite-${key}-field`,roles);role.dataset.field='field'; field(box,'Evidenzrolle selbst wählen',role);
      add(box,el('p','Exakte Zitatvorschau:'),el('blockquote','Noch kein Beleg gewählt.',{'data-quote':''}));
      box.addEventListener('input',() => preview(key,source));add(form,box);
    });
    field(form,'Unabhängig vom Verfassen des Korpus? Ehrliche Selbstauskunft',select('independence',['yes','no']));
    for (const [id,title] of [['blind-confirm','Ich habe keine Modellentscheidungen, Labels oder fremden Antworten vor meiner Abgabe gesehen.'],
                               ['manual-confirm','Ich habe dieses Urteil wirklich selbst manuell aus dem verblindeten Paket verfasst.']]) {
      const label=el('label');add(label,el('input',null,{id,type:'checkbox',required:''}),document.createTextNode(title));add(form,label);
    }
    add(form,el('p','Selbstauskünfte authentifizieren keinen Menschen. Geräteuhr liefert UTC-Zeiten. Die Importprüfung beim Koordinator bleibt maßgeblich.'));
    const exportButton=el('button','JSON zum manuellen Speichern erzeugen',{id:'export-response',type:'submit'});add(form,exportButton);
    add(holder,el('p','',{id:'form-error',role:'alert',tabindex:'-1',class:'error'}));
    const output=el('section',null,{id:'export-region','aria-label':'Lokaler JSON-Export'});output.hidden=!state.exported;
    add(output,el('p','Antwort in diesem Tab fixiert. Jetzt Datei bewusst lokal speichern oder JSON manuell kopieren; anschließend separat an den Koordinator teilen. Keine automatische Abgabe.',{class:'status'}));
    const download=el('a','JSON-Datei lokal herunterladen',{id:'download-json'});
    const text=el('textarea',null,{id:'export-json',readonly:'','aria-label':'Exportiertes JSON zum manuellen Kopieren',spellcheck:'false'});
    if(state.exported){
      text.value=state.serialized;
      download.href=state.url;
      download.download=`${task.taskId}-${state.exported.reviewerId}-${state.exported.responseId}.json`;
      times.textContent += ' · Exportiert (UTC): '+state.exported.completedAt;
    }
    add(output,download,text);add(holder,output);
    for(const [id,value] of Object.entries(state.draft)) {
      const node=document.getElementById(id); if(!node)continue;
      if(node.type==='checkbox')node.checked=value===true;else node.value=value;
    }
    form.querySelectorAll('input,select,textarea,button').forEach(n => n.disabled=state.startedAt===null || state.exported!==null);
    form.addEventListener('input',saveDraft);form.addEventListener('change',saveDraft);
    form.addEventListener('submit',event => {
      event.preventDefault(); if(state.exported)return;
      try {
        saveDraft();const answer=buildResponse(task,state);
        const serialized=JSON.stringify(answer,null,2)+'\n';
        // Commit the immutable in-memory export only after Blob creation succeeds.
        const url=URL.createObjectURL(new Blob([serialized],{type:'application/json;charset=utf-8'}));
        state.exported=answer;state.serialized=serialized;state.url=url;
        render();document.getElementById('download-json').focus();
      }catch(e){error('Kein Export: '+e.message);}
    });
    task.sides.forEach((s,i)=>preview(i===0?'A':'B',s.source));
    document.querySelectorAll('[data-task-id]').forEach(n => {
      if(n.dataset.taskId===active)n.setAttribute('aria-current','step');else n.removeAttribute('aria-current');
    });
  }
  document.getElementById('rubric').textContent=data.rubric;
  document.getElementById('load-state').textContent='Formular lokal bereit. Keine Antwort vorausgefüllt. Pro Aufgabe bewusst beginnen.';
  tasks.forEach(task => {
    const button=el('button',task.taskId,{type:'button','data-task-id':task.taskId});
    button.addEventListener('click',()=>{saveDraft();active=task.taskId;render();document.getElementById('task-heading').focus();});
    add(document.getElementById('tasks'),button);
  });
  render();
  document.documentElement.dataset.reviewerState = 'ready';
  window.dispatchEvent(new Event('reviewer-state'));
 } catch (error) {
  document.documentElement.dataset.reviewerState = 'failed';
  document.getElementById('load-state').textContent = 'Formularinitialisierung fehlgeschlagen. Nicht bewerten. In Safari über HTTPS öffnen; Diagnose prüfen und Koordinator informieren.';
  window.dispatchEvent(new Event('reviewer-state'));
 }
})();
