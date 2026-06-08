import * as THREE from 'three';

/* ════════════════════════════════════════════════════════════
   AUDIO — two voices (A,B), each direct + permeate; one echo on
   the combined SCALED direct output. Listener tracks the player.
   ════════════════════════════════════════════════════════════ */
export const Audio=(()=>{
  let ctx=null,master=null,drySum=null,started=false;
  const A3=220;
  const SONGS={
    a:{notes:[0,3,7,10,7,3,5,null, 0,3,7,12,10,7,3,null, -2,3,5,7,5,3,0,null, -5,0,3,7,3,0,-2,null],bpm:96,wave:'triangle'},
    b:{notes:[-5,null,-2,0,null,3,-2,null, -7,null,-5,-2,0,null,-2,null, 2,null,0,-2,-5,null,-7,null, -10,null,-7,-5,null,-2,-5,null],bpm:72,wave:'sawtooth'},
  };
  const hz=s=>A3*Math.pow(2,s/12);
  function mkPanner(){const p=ctx.createPanner();p.panningModel='HRTF';p.distanceModel='inverse';
    p.refDistance=2;p.maxDistance=60;p.rolloffFactor=1;return p;}

  const voices={};
  function makeVoice(key){
    const song=SONGS[key]; const step=60/song.bpm/2;
    const v={key,song,step,nextNoteTime:0,idx:0};
    v.build=()=>{
      v.noteBus=ctx.createGain();
      v.directGain=ctx.createGain();v.directGain.gain.value=0;
      v.panner=mkPanner();
      v.noteBus.connect(v.directGain);v.directGain.connect(v.panner);v.panner.connect(master);
      v.permGain=ctx.createGain();v.permGain.gain.value=0;
      v.permLP=ctx.createBiquadFilter();v.permLP.type='lowpass';v.permLP.frequency.value=20000;v.permLP.Q.value=0.7;
      v.permPan=mkPanner();
      v.noteBus.connect(v.permGain);v.permGain.connect(v.permLP);v.permLP.connect(v.permPan);v.permPan.connect(master);
      v.directGain.connect(drySum); // echo taps SCALED direct
    };
    v.note=(s,t)=>{ if(s==null)return;
      const o=ctx.createOscillator(),g=ctx.createGain();o.type=song.wave;o.frequency.value=hz(s);
      const dur=step*1.6;g.gain.setValueAtTime(0.0001,t);g.gain.exponentialRampToValueAtTime(0.2,t+0.012);
      g.gain.exponentialRampToValueAtTime(0.0001,t+dur);
      const sub=ctx.createOscillator();sub.type='sine';sub.frequency.value=hz(s-12);
      const sg=ctx.createGain();sg.gain.value=0.45;sub.connect(sg);sg.connect(g);
      o.connect(g);g.connect(v.noteBus);o.start(t);sub.start(t);o.stop(t+dur+0.05);sub.stop(t+dur+0.05);
    };
    v.pump=()=>{ while(v.nextNoteTime<ctx.currentTime+0.12){ v.note(song.notes[v.idx%song.notes.length],v.nextNoteTime); v.nextNoteTime+=step; v.idx++; } };
    v.start=()=>{v.nextNoteTime=ctx.currentTime+0.05;v.idx=0;};
    return v;
  }

  // listener-relative placement: given a WORLD position + listener transform,
  // we just set the panner to the world position; listener handles the rest.
  function setPanner(p,worldPos){
    const t=ctx.currentTime;
    if(p.positionX){p.positionX.setTargetAtTime(worldPos.x,t,0.04);p.positionY.setTargetAtTime(worldPos.y,t,0.04);p.positionZ.setTargetAtTime(worldPos.z,t,0.04);}
    else p.setPosition(worldPos.x,worldPos.y,worldPos.z);
  }
  // For direct/echo we place by DIRECTION (the perceived arrival), at a fixed
  // radius around the listener position, transformed into world space.
  let listenerPos={x:0,y:0,z:0};
  const PLACE_R=3;
  function placeByDir(p,dir){ setPanner(p,{x:listenerPos.x+dir.x*PLACE_R,y:listenerPos.y+dir.y*PLACE_R,z:listenerPos.z+dir.z*PLACE_R}); }

  let echoDelay,echoFB,echoGain,echoPan,_echoT=0.18; const ESTEP=0.04,EDEAD=0.05;

  function ensure(){
    if(!ctx){
      ctx=new (window.AudioContext||window.webkitAudioContext)();
      master=ctx.createGain();master.gain.value=0.82;
      drySum=ctx.createGain();
      voices.a=makeVoice('a');voices.a.build();
      voices.b=makeVoice('b');voices.b.build();
      echoDelay=ctx.createDelay(2);echoDelay.delayTime.value=0.18;
      echoFB=ctx.createGain();echoFB.gain.value=0;
      echoGain=ctx.createGain();echoGain.gain.value=0;
      echoPan=mkPanner();
      drySum.connect(echoDelay);echoDelay.connect(echoFB);echoFB.connect(echoDelay);
      echoDelay.connect(echoGain);echoGain.connect(echoPan);echoPan.connect(master);
      master.connect(ctx.destination);
    }
    if(ctx.state==='suspended')ctx.resume();
    return ctx;
  }
  let timer=null;
  function play(){ ensure(); if(started)return; started=true; voices.a.start();voices.b.start();
    timer=setInterval(()=>{voices.a.pump();voices.b.pump();},25); }
  function isPlaying(){return started;}

  // update listener from camera each frame
  function updateListener(cam){
    if(!ctx)return;
    listenerPos={x:cam.position.x,y:cam.position.y,z:cam.position.z};
    const L=ctx.listener; const t=ctx.currentTime;
    const fwd=new THREE.Vector3();cam.getWorldDirection(fwd);
    if(L.positionX){
      L.positionX.setTargetAtTime(cam.position.x,t,0.02);
      L.positionY.setTargetAtTime(cam.position.y,t,0.02);
      L.positionZ.setTargetAtTime(cam.position.z,t,0.02);
      L.forwardX.setTargetAtTime(fwd.x,t,0.02);L.forwardY.setTargetAtTime(fwd.y,t,0.02);L.forwardZ.setTargetAtTime(fwd.z,t,0.02);
      L.upX.value=0;L.upY.value=1;L.upZ.value=0;
    } else { L.setPosition(cam.position.x,cam.position.y,cam.position.z); L.setOrientation(fwd.x,fwd.y,fwd.z,0,1,0); }
  }

  // dir vectors from ray modules are in WORLD axes already (player-relative
  // arrival direction). Place panners around listener using world dir.
  function applyDirect(key,r){ const v=voices[key]; if(!v)return;
    v.directGain.gain.setTargetAtTime(r.volume,ctx.currentTime,0.04); placeByDir(v.panner,r.dir); }
  function silenceDirect(key){ voices[key]&&voices[key].directGain.gain.setTargetAtTime(0,ctx.currentTime,0.08); }
  function applyPermeate(key,r){ const v=voices[key]; if(!v)return; const t=ctx.currentTime;
    v.permGain.gain.setTargetAtTime(r.through*0.85,t,0.06);
    v.permLP.frequency.setTargetAtTime(18000*Math.pow(350/18000,r.muffle),t,0.06);
    placeByDir(v.permPan,r.dir); }
  function silencePermeate(key){ voices[key]&&voices[key].permGain.gain.setTargetAtTime(0,ctx.currentTime,0.08); }
  function applyEcho(r){ if(!echoGain)return; const t=ctx.currentTime;
    const want=Math.max(0.06,Math.min(0.9,r.delay)); const snap=Math.round(want/ESTEP)*ESTEP;
    if(Math.abs(snap-_echoT)>EDEAD){ _echoT=snap; echoGain.gain.setTargetAtTime(0.0001,t,0.02);
      echoDelay.delayTime.setValueAtTime(_echoT,t+0.04); echoGain.gain.setTargetAtTime(r.magnitude*0.5,t+0.07,0.08); }
    else echoGain.gain.setTargetAtTime(r.magnitude*0.5,t,0.1);
    echoFB.gain.setTargetAtTime(Math.min(0.42,r.magnitude*0.5),t,0.12);
    placeByDir(echoPan,r.dir); }
  function silenceEcho(){ if(echoGain){const t=ctx.currentTime;echoGain.gain.setTargetAtTime(0,t,0.1);echoFB.gain.setTargetAtTime(0,t,0.1);} }

  return {ensure,play,isPlaying,updateListener,applyDirect,silenceDirect,applyPermeate,silencePermeate,applyEcho,silenceEcho};
})();
