import * as THREE from 'three';
import { Scene } from './scene.js';
import { World } from './world.js';
import { Params } from './params.js';

/* ════════════════════════════════════════════════════════════
   PLAYER — first-person controller with voxel collision.
   ════════════════════════════════════════════════════════════ */
export const Player=(()=>{
  const cam=Scene.camera;
  let yaw=0,pitch=0;
  const vel=new THREE.Vector3();
  const RADIUS=0.4, HEIGHT=0.9;
  let move={f:0,s:0};   // forward/strafe from -1..1

  function spawnAt(p){ cam.position.copy(p); yaw=Math.PI; pitch=0; applyLook(); }
  function applyLook(){
    const e=new THREE.Euler(pitch,yaw,0,'YXZ');
    cam.quaternion.setFromEuler(e);
  }
  function look(dx,dy){ yaw-=dx*0.0026; pitch-=dy*0.0026;
    const lim=Math.PI/2-0.05; pitch=Math.max(-lim,Math.min(lim,pitch)); applyLook(); }
  function setMove(f,s){ move.f=f; move.s=s; }

  // collide one axis at a time against voxels
  function tryMove(axis,amount){
    const p=cam.position.clone();
    p[axis]+=amount;
    // sample a small box around the player on the moved axis
    const pts=[
      [p.x-RADIUS,p.y,p.z-RADIUS],[p.x+RADIUS,p.y,p.z-RADIUS],
      [p.x-RADIUS,p.y,p.z+RADIUS],[p.x+RADIUS,p.y,p.z+RADIUS],
      [p.x,p.y-HEIGHT,p.z],[p.x,p.y+0.2,p.z],
    ];
    for(const [x,y,z] of pts) if(World.solidAt(x,y,z)) return; // blocked
    cam.position[axis]=p[axis];
  }

  function update(dt){
    const fwd=new THREE.Vector3(-Math.sin(yaw),0,-Math.cos(yaw));
    const right=new THREE.Vector3(Math.cos(yaw),0,-Math.sin(yaw));
    const dir=new THREE.Vector3();
    dir.addScaledVector(fwd,move.f); dir.addScaledVector(right,move.s);
    if(dir.lengthSq()>1) dir.normalize();
    const step=Params.player.SPEED*dt;
    tryMove('x',dir.x*step);
    tryMove('z',dir.z*step);
  }
  return {cam,spawnAt,look,setMove,update,get yaw(){return yaw;}};
})();
