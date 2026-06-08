import { Params, DEFAULTS } from './params.js';
import { rebuildSpheres } from './rays.js';

/* ════════════════════════════════════════════════════════════
   ADMIN — a client-side tuning panel. Every slider is bound to a
   field in Params; the sim reads Params live, so changes take
   effect on the next frame. "Copy values" serialises the current
   Params as JSON so a tuned set can be handed back. No server,
   no persistence — purely a local experimentation surface.
   ════════════════════════════════════════════════════════════ */

// schema: group → [{ key, label, min, max, step, rebuild? }]
const SCHEMA = {
  direct: {
    title: 'Direct',
    fields: [
      { key:'RAY_COUNT',   label:'Ray count',        min:32,  max:600,  step:4,    rebuild:true },
      { key:'MAX_BOUNCE',  label:'Max bounces',      min:0,   max:8,    step:1 },
      { key:'MAX_DIST',    label:'Max distance (m)', min:10,  max:150,  step:1 },
      { key:'CAPTURE_R',   label:'Capture radius',   min:0.3, max:4,    step:0.1 },
      { key:'REF_DIST',    label:'Reference dist',   min:1,   max:30,   step:0.5 },
      { key:'ENERGY_NORM', label:'Loudness scale',   min:0.01,max:0.2,  step:0.005 },
      { key:'SMOOTH',      label:'Smoothing',        min:0,   max:0.98, step:0.01 },
    ],
  },
  echo: {
    title: 'Echo',
    fields: [
      { key:'RAY_COUNT',    label:'Ray count',        min:32,  max:600,  step:4,    rebuild:true },
      { key:'MAX_BOUNCE',   label:'Max bounces',      min:1,   max:10,   step:1 },
      { key:'MAX_DIST',     label:'Max distance (m)', min:20,  max:200,  step:1 },
      { key:'RETURN_R',     label:'Return radius',    min:0.3, max:4,    step:0.1 },
      { key:'MIN_PATH',     label:'Min path (m)',     min:0,   max:20,   step:0.5 },
      { key:'REF_DIST',     label:'Reference dist',   min:1,   max:40,   step:0.5 },
      { key:'SPEED',        label:'Sound speed',      min:100, max:700,  step:1 },
      { key:'ENERGY_NORM',  label:'Loudness scale',   min:0.01,max:0.3,  step:0.005 },
      { key:'SMOOTH',       label:'Smoothing',        min:0,   max:0.98, step:0.01 },
      { key:'GAIN',         label:'Echo gain',        min:0,   max:1.5,  step:0.05 },
      { key:'FEEDBACK_MAX', label:'Feedback / tail',  min:0,   max:0.85, step:0.01 },
    ],
  },
  permeate: {
    title: 'Permeate',
    fields: [
      { key:'RAY_COUNT',          label:'Ray count (fan)',   min:1,    max:81,    step:1 },
      { key:'SPREAD',             label:'Fan spread (rad)',  min:0.05, max:1.2,   step:0.01 },
      { key:'REF_THICK',          label:'Wall ref thick',    min:0.2,  max:8,     step:0.1 },
      { key:'THROUGH_THICK_MULT', label:'Through falloff',   min:0.3,  max:4,     step:0.05 },
      { key:'SMOOTH',             label:'Smoothing',         min:0,    max:0.98,  step:0.01 },
      { key:'GAIN',               label:'Through gain',      min:0,    max:1.5,   step:0.05 },
      { key:'LP_MAX_HZ',          label:'Filter max Hz',     min:2000, max:20000, step:100 },
      { key:'LP_MIN_HZ',          label:'Filter min Hz',     min:80,   max:4000,  step:10 },
    ],
  },
  audio: {
    title: 'Audio',
    fields: [
      { key:'MASTER',  label:'Master gain',    min:0,   max:1.5, step:0.01 },
      { key:'PLACE_R', label:'Panner radius',  min:0.5, max:10,  step:0.1 },
    ],
  },
  player: {
    title: 'Player',
    fields: [
      { key:'SPEED', label:'Move speed (m/s)', min:1, max:15, step:0.5 },
    ],
  },
};

function decimals(step){ const s=String(step); const i=s.indexOf('.'); return i<0?0:s.length-i-1; }
function fmt(v, step){ return step>=1 ? String(Math.round(v)) : v.toFixed(decimals(step)); }

export function initAdmin(){
  const shell = document.querySelector('.rt3-shell');
  const btn = document.getElementById('adminBtn');
  if(!shell || !btn) return;

  // ── build panel DOM ──
  const panel = document.createElement('div');
  panel.className = 'admin-panel';
  panel.innerHTML = `
    <div class="admin-head">
      <span>Admin · Tuning</span>
      <button class="admin-x" id="adminClose" aria-label="Close">✕</button>
    </div>
    <div class="admin-body" id="adminBody"></div>
    <div class="admin-foot">
      <textarea class="admin-out" id="adminOut" readonly spellcheck="false"></textarea>
      <div class="admin-actions">
        <button class="btn primary" id="adminCopy">Copy values</button>
        <button class="btn" id="adminReset">Reset defaults</button>
      </div>
    </div>`;
  shell.appendChild(panel);

  const body = panel.querySelector('#adminBody');
  const out  = panel.querySelector('#adminOut');
  const valEls = [];   // {el, group, key, step} for refreshing on reset
  const sliders = [];  // {input, group, key}

  for(const group of Object.keys(SCHEMA)){
    const sec = document.createElement('div'); sec.className='admin-sec';
    const h = document.createElement('div'); h.className='admin-sec-title'; h.textContent=SCHEMA[group].title;
    sec.appendChild(h);
    for(const f of SCHEMA[group].fields){
      const row = document.createElement('div'); row.className='admin-row';
      const lab = document.createElement('label');
      const name = document.createElement('span'); name.textContent=f.label;
      const val = document.createElement('span'); val.className='admin-val';
      val.textContent = fmt(Params[group][f.key], f.step);
      lab.appendChild(name); lab.appendChild(val);
      const input = document.createElement('input');
      input.type='range'; input.min=f.min; input.max=f.max; input.step=f.step;
      input.value = Params[group][f.key];
      input.addEventListener('input', ()=>{
        const v = parseFloat(input.value);
        Params[group][f.key] = v;
        val.textContent = fmt(v, f.step);
        if(f.rebuild) rebuildSpheres();
        refreshOut();
      });
      row.appendChild(lab); row.appendChild(input);
      sec.appendChild(row);
      valEls.push({ el:val, group, key:f.key, step:f.step });
      sliders.push({ input, group, key:f.key });
    }
    body.appendChild(sec);
  }

  function refreshOut(){ out.value = JSON.stringify(Params, null, 2); }
  refreshOut();

  // ── open / close ──
  function open(){
    panel.classList.add('open');
    btn.classList.add('primary');
    // free the cursor so sliders are usable while pointer-lock play is active
    if(document.pointerLockElement) document.exitPointerLock();
  }
  function close(){ panel.classList.remove('open'); btn.classList.remove('primary'); }
  btn.addEventListener('click', ()=> panel.classList.contains('open') ? close() : open());
  panel.querySelector('#adminClose').addEventListener('click', close);

  // ── copy ──
  const copyBtn = panel.querySelector('#adminCopy');
  copyBtn.addEventListener('click', async ()=>{
    const text = out.value;
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; }
    catch { out.select(); try { ok = document.execCommand('copy'); } catch {} }
    copyBtn.textContent = ok ? 'Copied!' : 'Copy failed';
    setTimeout(()=>{ copyBtn.textContent = 'Copy values'; }, 1400);
  });

  // ── reset ──
  panel.querySelector('#adminReset').addEventListener('click', ()=>{
    for(const group of Object.keys(DEFAULTS))
      for(const key of Object.keys(DEFAULTS[group]))
        Params[group][key] = DEFAULTS[group][key];
    rebuildSpheres();
    for(const s of sliders) s.input.value = Params[s.group][s.key];
    for(const v of valEls) v.el.textContent = fmt(Params[v.group][v.key], v.step);
    refreshOut();
  });
}
