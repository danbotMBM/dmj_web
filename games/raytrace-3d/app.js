import * as THREE from 'three';
import { World } from './world.js';
import { Scene } from './scene.js';
import { RayModules } from './rays.js';
import { Audio } from './audio.js';
import { Player } from './player.js';

/* ════════════════════════════════════════════════════════════
   APP — input, loop, UI.
   ════════════════════════════════════════════════════════════ */
(()=>{
  const active={direct:false,echo:false,permeate:false};
  let raysVisible=true;
  let moveMode='off';   // 'off' | 'a' | 'b' — source follows the crosshair
  const rayState={a:{direct:{color:0x59d4ff},permeate:{color:0x59d4ff}},
                  b:{direct:{color:0xc792ea},permeate:{color:0xc792ea}}};

  // place sources in the big room & tall room
  function placeSources(){
    const {CELL}=World.dims();
    Scene.sourceA.position.set(21*CELL,3*CELL,12*CELL);   // big room centre
    Scene.sourceB.position.set(36*CELL,8*CELL,6.5*CELL);  // up high in tall room
  }

  const el={
    shell:document.querySelector('.rt3-shell'),
    toggles:[...document.querySelectorAll('.toggle')],
    audioBtn:document.getElementById('audioBtn'),
    moveBtn:document.getElementById('moveBtn'),
    raysBtn:document.getElementById('raysBtn'),
    resetBtn:document.getElementById('resetBtn'),
    fsBtn:document.getElementById('fsBtn'),
    hint:document.getElementById('hint'),
    stick:document.getElementById('stick'),
    nub:document.querySelector('#stick .nub'),
    gate:document.getElementById('startgate'),
    enter:document.getElementById('enterBtn'),
    ctrlhint:document.getElementById('ctrlhint'),
    ro:{direct:document.getElementById('ro-direct'),echo:document.getElementById('ro-echo'),permeate:document.getElementById('ro-permeate')},
  };

  const isTouch=matchMedia('(pointer:coarse)').matches||'ontouchstart'in window;
  if(!isTouch){ el.stick.style.display='none'; el.hint.textContent='WASD / arrows to move · move mouse to look'; }
  else { el.ctrlhint.textContent='Left stick to move · drag right side to look · tap to begin'; }

  // ── size the shell to fill the viewport below the site navbar (the navbar
  //    scrolls with the page). In fullscreen the browser fills the screen, so
  //    we drop the inline sizing and let the :fullscreen rule take over. ──
  function fullscreenEl(){ return document.fullscreenElement||document.webkitFullscreenElement||null; }
  function fitShell(){
    if(fullscreenEl()===el.shell){ el.shell.style.height=''; el.shell.style.width=''; }
    else {
      const header=document.querySelector('.site-header');
      const top=header?header.getBoundingClientRect().bottom:0;
      el.shell.style.height=Math.max(360, window.innerHeight-top)+'px';
      el.shell.style.width='';
    }
    Scene.resize();
  }
  addEventListener('resize',fitShell);

  // ── build world ──
  World.build();
  Scene.buildVoxels();
  placeSources();
  Player.spawnAt(World.spawn);
  fitShell();

  // ── fullscreen toggle ──
  function toggleFullscreen(){
    if(fullscreenEl()){
      (document.exitFullscreen||document.webkitExitFullscreen||(()=>{})).call(document);
    } else {
      const req=el.shell.requestFullscreen||el.shell.webkitRequestFullscreen;
      if(req) req.call(el.shell);
    }
  }
  function onFsChange(){
    el.fsBtn.textContent='Fullscreen: '+(fullscreenEl()===el.shell?'On':'Off');
    el.fsBtn.classList.toggle('primary', fullscreenEl()===el.shell);
    fitShell();
  }
  el.fsBtn.addEventListener('click',toggleFullscreen);
  document.addEventListener('fullscreenchange',onFsChange);
  document.addEventListener('webkitfullscreenchange',onFsChange);

  // ── start gate (needed for pointer lock + audio gesture) ──
  el.enter.addEventListener('click',()=>{
    el.gate.style.display='none';
    Audio.ensure();
    if(!isTouch) Scene.domElement.requestPointerLock();
    setTimeout(()=>{el.hint.style.opacity='0';},3500);
  });

  // ── look input ──
  if(!isTouch){
    document.addEventListener('pointerlockchange',()=>{});
    addEventListener('mousemove',e=>{ if(document.pointerLockElement===Scene.domElement) Player.look(e.movementX,e.movementY); });
    Scene.domElement.addEventListener('click',()=>{ if(document.pointerLockElement!==Scene.domElement) Scene.domElement.requestPointerLock(); });
    // keyboard
    const keys={};
    addEventListener('keydown',e=>{keys[e.code]=true;updateKeys();});
    addEventListener('keyup',e=>{keys[e.code]=false;updateKeys();});
    function updateKeys(){
      let f=0,s=0;
      if(keys.KeyW||keys.ArrowUp)f+=1; if(keys.KeyS||keys.ArrowDown)f-=1;
      if(keys.KeyD||keys.ArrowRight)s+=1; if(keys.KeyA||keys.ArrowLeft)s-=1;
      Player.setMove(f,s);
    }
  } else {
    // touch look: drag on the right half of the simulation (not the navbar)
    let lookId=null,lx=0,ly=0;
    el.shell.addEventListener('touchstart',e=>{
      for(const t of e.changedTouches){
        if(t.clientX>innerWidth*0.45 && lookId===null && !insideStick(t)){ lookId=t.identifier;lx=t.clientX;ly=t.clientY; }
      }
    },{passive:false});
    addEventListener('touchmove',e=>{
      for(const t of e.changedTouches){ if(t.identifier===lookId){ Player.look(t.clientX-lx,t.clientY-ly); lx=t.clientX;ly=t.clientY; } }
    },{passive:false});
    addEventListener('touchend',e=>{ for(const t of e.changedTouches) if(t.identifier===lookId) lookId=null; });
    function insideStick(t){ const r=el.stick.getBoundingClientRect();
      return t.clientX>=r.left&&t.clientX<=r.right&&t.clientY>=r.top&&t.clientY<=r.bottom; }

    // touch move stick
    let stickId=null; const SR=60;
    el.stick.addEventListener('touchstart',e=>{e.preventDefault();const t=e.changedTouches[0];stickId=t.identifier;moveStick(t);},{passive:false});
    el.stick.addEventListener('touchmove',e=>{e.preventDefault();for(const t of e.changedTouches)if(t.identifier===stickId)moveStick(t);},{passive:false});
    el.stick.addEventListener('touchend',e=>{for(const t of e.changedTouches)if(t.identifier===stickId){stickId=null;el.nub.style.transform='translate(-50%,-50%)';Player.setMove(0,0);}},{passive:false});
    function moveStick(t){ const r=el.stick.getBoundingClientRect();
      let dx=t.clientX-(r.left+r.width/2), dy=t.clientY-(r.top+r.height/2);
      const len=Math.hypot(dx,dy); if(len>SR){dx=dx/len*SR;dy=dy/len*SR;}
      el.nub.style.transform=`translate(calc(-50% + ${dx}px),calc(-50% + ${dy}px))`;
      Player.setMove(-dy/SR, dx/SR);
    }
  }

  // ── UI buttons ──
  el.toggles.forEach(b=>b.addEventListener('click',()=>{
    const k=b.dataset.ray; active[k]=!active[k]; b.classList.toggle('on',active[k]);
    if(active[k]){ Audio.play(); el.audioBtn.textContent='Sound: On'; }
    else {
      if(k==='direct'){Audio.silenceDirect('a');Audio.silenceDirect('b');}
      if(k==='echo')Audio.silenceEcho();
      if(k==='permeate'){Audio.silencePermeate('a');Audio.silencePermeate('b');}
      el.ro[k].textContent='—'; el.ro[k].classList.add('muted');
    }
  }));
  el.audioBtn.addEventListener('click',()=>{ if(!Audio.isPlaying()){Audio.play();el.audioBtn.textContent='Sound: On';} });
  el.moveBtn.addEventListener('click',()=>{
    moveMode = moveMode==='off' ? 'a' : moveMode==='a' ? 'b' : 'off';
    el.moveBtn.textContent = 'Move Src: ' + (moveMode==='off'?'Off':moveMode==='a'?'A':'B');
    el.moveBtn.classList.toggle('primary', moveMode!=='off');
  });
  el.raysBtn.addEventListener('click',()=>{ raysVisible=!raysVisible; Scene.setRayVisible(raysVisible); el.raysBtn.textContent='Rays: '+(raysVisible?'Hide':'Show'); });
  el.resetBtn.addEventListener('click',()=>{ Player.spawnAt(World.spawn); });

  // ── main loop ──
  let last=performance.now();
  function frame(now){
    const dt=Math.min(0.05,(now-last)/1000); last=now;
    Player.update(dt);
    Audio.updateListener(Player.cam);

    // ── source-move mode: float the targeted source ahead of the crosshair ──
    if(moveMode!=='off'){
      const cam=Player.cam;
      const fwd=new THREE.Vector3(); cam.getWorldDirection(fwd);
      let reach=4.5;
      // don't push the source into/through a wall: shorten reach if blocked
      for(let d=0.6; d<=reach; d+=0.4){
        if(World.solidAt(cam.position.x+fwd.x*d, cam.position.y+fwd.y*d, cam.position.z+fwd.z*d)){ reach=Math.max(0.8,d-0.4); break; }
      }
      const tgt=(moveMode==='a')?Scene.sourceA:Scene.sourceB;
      tgt.position.set(cam.position.x+fwd.x*reach, cam.position.y+fwd.y*reach, cam.position.z+fwd.z*reach);
    }

    Scene.clearRays();
    const origin={x:Player.cam.position.x,y:Player.cam.position.y,z:Player.cam.position.z};
    const sA={x:Scene.sourceA.position.x,y:Scene.sourceA.position.y,z:Scene.sourceA.position.z};
    const sB={x:Scene.sourceB.position.x,y:Scene.sourceB.position.y,z:Scene.sourceB.position.z};
    const drawScene = raysVisible?Scene:null;

    if(active.direct){
      const ra=RayModules.direct.cast(origin,sA,drawScene,rayState.a.direct);
      const rb=RayModules.direct.cast(origin,sB,drawScene,rayState.b.direct);
      Audio.applyDirect('a',ra);Audio.applyDirect('b',rb);
      el.ro.direct.classList.remove('muted');
      el.ro.direct.textContent='A '+Math.round(ra.volume*100)+'% · B '+Math.round(rb.volume*100)+'%';
    }
    if(active.permeate){
      const pa=RayModules.permeate.cast(origin,sA,drawScene,rayState.a.permeate);
      const pb=RayModules.permeate.cast(origin,sB,drawScene,rayState.b.permeate);
      Audio.applyPermeate('a',pa);Audio.applyPermeate('b',pb);
      el.ro.permeate.classList.remove('muted');
      el.ro.permeate.textContent='A '+Math.round(pa.muffle*100)+'% · B '+Math.round(pb.muffle*100)+'%';
    }
    if(active.echo){
      const re=RayModules.echo.cast(origin,drawScene,RayModules.echo);
      el.ro.echo.classList.remove('muted');
      if(!active.direct){ el.ro.echo.textContent='needs Direct'; el.ro.echo.classList.add('muted'); }
      else el.ro.echo.textContent=Math.round(re.magnitude*100)+'%·'+Math.round(re.delay*1000)+'ms';
      Audio.applyEcho(re);
    }

    Scene.render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
