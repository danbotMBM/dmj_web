import * as THREE from 'three';
import { World } from './world.js';

/* ════════════════════════════════════════════════════════════
   SCENE — perspective first-person renderer over the voxel world.
   ════════════════════════════════════════════════════════════ */
export const Scene = (()=>{
  const stageEl=document.getElementById('stage');
  const renderer=new THREE.WebGLRenderer({antialias:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.75));
  stageEl.appendChild(renderer.domElement);

  const scene=new THREE.Scene();
  scene.background=new THREE.Color(0x0a0e14);
  scene.fog=new THREE.Fog(0x0a0e14, 12, 60);

  const camera=new THREE.PerspectiveCamera(75, 1, 0.1, 200);

  // lights
  scene.add(new THREE.AmbientLight(0x8090a8, 0.6));
  const hemi=new THREE.HemisphereLight(0xbfd4ff, 0x141a22, 0.8); scene.add(hemi);
  const key=new THREE.DirectionalLight(0xffffff,0.5); key.position.set(20,40,10); scene.add(key);

  const rayGroup=new THREE.Group(); scene.add(rayGroup);
  const actorGroup=new THREE.Group(); scene.add(actorGroup);

  // ── build voxel meshes via instancing (one InstancedMesh for all solids) ──
  let voxelMesh=null;
  function buildVoxels(){
    if(voxelMesh){ voxelMesh.geometry.dispose(); voxelMesh.material.dispose(); scene.remove(voxelMesh); }
    const {CELL}=World.dims();
    const cells=[]; World.eachSolid((x,y,z)=>{
      // only render solids that touch empty space (skip fully buried) → fewer instances
      if(!touchesEmpty(x,y,z)) return;
      cells.push([x,y,z]);
    });
    const geo=new THREE.BoxGeometry(CELL,CELL,CELL);
    const mat=new THREE.MeshStandardMaterial({color:0x2a3646,roughness:.95,metalness:0,
      emissive:0x0a0f15, flatShading:true});
    voxelMesh=new THREE.InstancedMesh(geo,mat,cells.length);
    const m=new THREE.Matrix4();
    cells.forEach(([x,y,z],i)=>{
      m.setPosition((x+.5)*CELL,(y+.5)*CELL,(z+.5)*CELL);
      voxelMesh.setMatrixAt(i,m);
    });
    voxelMesh.instanceMatrix.needsUpdate=true;
    scene.add(voxelMesh);
  }
  function touchesEmpty(x,y,z){
    return !World.solid(x+1,y,z)||!World.solid(x-1,y,z)||!World.solid(x,y+1,z)||
           !World.solid(x,y-1,z)||!World.solid(x,y,z+1)||!World.solid(x,y,z-1);
  }

  // ── source markers (glowing spheres) ──
  function makeSource(color){
    const g=new THREE.Group();
    const core=new THREE.Mesh(new THREE.SphereGeometry(0.45,20,16),
      new THREE.MeshBasicMaterial({color}));
    const glow=new THREE.Mesh(new THREE.SphereGeometry(0.75,16,12),
      new THREE.MeshBasicMaterial({color,transparent:true,opacity:.18}));
    g.add(core,glow); return g;
  }
  const sourceA=makeSource(0x59d4ff);
  const sourceB=makeSource(0xc792ea);
  actorGroup.add(sourceA,sourceB);

  // ── ray drawing (disposed each frame) ──
  function clearRays(){
    for(const o of rayGroup.children){ o.geometry&&o.geometry.dispose(); o.material&&o.material.dispose(); }
    rayGroup.clear();
  }
  function drawPath(pts,colorHex,opacity=1){
    const v=pts.map(p=>new THREE.Vector3(p.x,p.y,p.z));
    const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(v),
      new THREE.LineBasicMaterial({color:colorHex,transparent:true,opacity}));
    rayGroup.add(line);
  }
  function setRayVisible(v){ rayGroup.visible=v; }

  // Size the renderer to the stage element (which fills the shell, or the
  // whole screen in fullscreen) rather than the window, so the canvas fits
  // correctly below the site navbar.
  function resize(){
    const w=stageEl.clientWidth, h=stageEl.clientHeight;
    if(w===0||h===0) return;
    renderer.setSize(w,h,false);
    camera.aspect=w/h; camera.updateProjectionMatrix();
  }
  resize();

  function render(){ renderer.render(scene,camera); }

  return { scene,camera,render,resize, buildVoxels, clearRays,drawPath,setRayVisible,
    sourceA,sourceB, domElement:renderer.domElement };
})();
