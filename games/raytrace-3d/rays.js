import { World } from './world.js';
import { Params } from './params.js';

/* ════════════════════════════════════════════════════════════
   RAY MODULES — 3D, voxel-based. Directions over a sphere.
   All tunable constants are read live from Params so the admin
   panel can adjust behaviour without a reload.
   ════════════════════════════════════════════════════════════ */
function fibSphere(n){
  const pts=[]; const gr=Math.PI*(3-Math.sqrt(5));
  for(let i=0;i<n;i++){ const y=1-(i/(n-1))*2; const r=Math.sqrt(1-y*y); const th=gr*i;
    pts.push({x:Math.cos(th)*r,y,z:Math.sin(th)*r}); }
  return pts;
}
// One sphere direction set drives the directional rays. The echo voice now
// piggy-backs on these same rays, so there is no separate echo sphere.
let SPHERE_DIRS_DIRECT = fibSphere(Params.direct.RAY_COUNT);
export function rebuildSpheres(){
  SPHERE_DIRS_DIRECT = fibSphere(Math.max(8, Math.round(Params.direct.RAY_COUNT)));
}

function reflectFace(d,face){
  if(face==='x') return {x:-d.x,y:d.y,z:d.z};
  if(face==='y') return {x:d.x,y:-d.y,z:d.z};
  return {x:d.x,y:d.y,z:-d.z};
}
function cross(a,b){return {x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x};}
function norm(a){const l=Math.hypot(a.x,a.y,a.z)||1;return{x:a.x/l,y:a.y/l,z:a.z/l};}

// Exact line-of-sight test: is the straight segment a→p clear of solids? The
// target p sits on a wall surface (it is a reflection point), so we stop a hair
// short of it — otherwise the wall the point lives on would always block itself.
function losClear(a,p){
  const dx=p.x-a.x, dy=p.y-a.y, dz=p.z-a.z;
  const dist=Math.hypot(dx,dy,dz);
  if(dist<1e-4) return true;
  const ux=dx/dist, uy=dy/dist, uz=dz/dist;
  const hit=World.dda(a.x,a.y,a.z,ux,uy,uz, dist-1e-2,
    (cx,cy,cz)=>World.solid(cx,cy,cz)?{stop:true}:null);
  return !hit;
}

export const RayModules={
  direct:{
    color:0xffb454,
    echoColor:0xff5e87,
    cast(origin, srcPos, scene, st){
      st=st||this;
      const P=Params.direct, E=Params.echo;
      const reached=[];
      for(const d0 of SPHERE_DIRS_DIRECT){
        let dx=d0.x,dy=d0.y,dz=d0.z;
        let ox=origin.x,oy=origin.y,oz=origin.z;
        let travelled=0, hitSource=false;
        const path=[{x:ox,y:oy,z:oz}];   // path[0]=player, …bounces…, last=source capture
        const cum=[0];                    // cumulative path length to each path point
        for(let b=0;b<=P.MAX_BOUNCE;b++){
          // capture test: does segment pass within CAPTURE_R of source before a wall?
          const hit=World.dda(ox,oy,oz,dx,dy,dz,P.MAX_DIST-travelled,(cx,cy,cz)=>{
            return World.solid(cx,cy,cz)?{stop:true}:null;
          });
          const segLen=hit?hit.t:(P.MAX_DIST-travelled);
          // closest approach to source along this segment
          const wx=srcPos.x-ox, wy=srcPos.y-oy, wz=srcPos.z-oz;
          const proj=Math.max(0,Math.min(segLen, wx*dx+wy*dy+wz*dz));
          const ccx=ox+dx*proj, ccy=oy+dy*proj, ccz=oz+dz*proj;
          if(Math.hypot(srcPos.x-ccx,srcPos.y-ccy,srcPos.z-ccz)<=P.CAPTURE_R){
            travelled+=proj; path.push({x:ccx,y:ccy,z:ccz}); cum.push(travelled); hitSource=true; break;
          }
          if(!hit) break;
          travelled+=hit.t;
          const hx=ox+dx*hit.t, hy=oy+dy*hit.t, hz=oz+dz*hit.t;
          path.push({x:hx,y:hy,z:hz}); cum.push(travelled);
          const r=reflectFace({x:dx,y:dy,z:dz},hit.face); dx=r.x;dy=r.y;dz=r.z;
          ox=hx+dx*1e-3; oy=hy+dy*1e-3; oz=hz+dz*1e-3;
        }
        if(!hitSource) continue;
        // ── echo ray: the deepest reflection point (nearest the source) that
        //    still has exact line of sight back to the player. The bounce points
        //    are path[1 … len-2]; path[len-1] is the source-capture point. The
        //    first bounce always sees the player (it is the launch segment), so
        //    a bounced ray always yields one. The straight player→reflection
        //    line is the "echo" ray — the direction the sound is perceived from. ──
        let li=-1;
        for(let i=1;i<=path.length-2;i++){ if(losClear(origin,path[i])) li=i; }
        let echoPt, finalReflDist, echoDist, bounced;
        if(li>=0){
          echoPt=path[li];
          finalReflDist=travelled-cum[li];   // bounced path from last-LOS reflection → source
          echoDist=Math.hypot(echoPt.x-origin.x,echoPt.y-origin.y,echoPt.z-origin.z);
          bounced=true;
        } else {
          echoPt=path[path.length-1];        // no bounces: straight line of sight to source
          finalReflDist=0;
          echoDist=travelled;
          bounced=false;
        }
        // distance that matters = final-reflection leg + the straight echo ray
        const effDist=finalReflDist+echoDist;
        let ex=echoPt.x-origin.x, ey=echoPt.y-origin.y, ez=echoPt.z-origin.z;
        const el=Math.hypot(ex,ey,ez)||1; ex/=el; ey/=el; ez/=el;
        reached.push({echoDir:{x:ex,y:ey,z:ez}, effDist, bounced, echoPt, path});
      }
      // ── direct: direction & distance come ONLY from the echo rays (player →
      //    last reflection with line of sight). Loudness depends only on the
      //    representative effective distance, so more rays sharpen dir/dist
      //    without raising volume. ──
      let vx=0,vy=0,vz=0, wSum=0, distW=0;
      for(const r of reached){
        const w=P.REF_DIST/Math.max(P.REF_DIST,r.effDist);   // per-ray proximity 0..1
        vx+=r.echoDir.x*w; vy+=r.echoDir.y*w; vz+=r.echoDir.z*w;
        wSum+=w; distW+=r.effDist*w;
      }
      const repDist = wSum>1e-6 ? distW/wSum : Infinity;   // representative effective length
      const volRaw = reached.length>0
        ? Math.min(1, Math.pow(P.REF_DIST/Math.max(P.REF_DIST,repDist), P.FALLOFF))
        : 0;
      const L=Math.hypot(vx,vy,vz)||1;
      const dirRaw={x:vx/L,y:vy/L,z:vz/L};
      const S=P.SMOOTH;
      st._v=(st._v||0)*S+volRaw*(1-S);
      st._dx=(st._dx||0)*S+dirRaw.x*volRaw*(1-S);
      st._dy=(st._dy||0)*S+dirRaw.y*volRaw*(1-S);
      st._dz=(st._dz||0)*S+dirRaw.z*volRaw*(1-S);
      const dl=Math.hypot(st._dx,st._dy,st._dz)||1;
      const dir={x:st._dx/dl,y:st._dy/dl,z:st._dz/dl};

      // ── echo: built from the bounced echo rays only (a clear line of sight to
      //    the source is "direct", not an echo). Same effective distance feeds
      //    both delay (distance/speed) and magnitude (proximity energy). ──
      let evx=0,evy=0,evz=0, energy=0, wDelay=0;
      for(const r of reached){ if(!r.bounced) continue;
        const w=E.REF_DIST/Math.max(E.REF_DIST,r.effDist);
        energy+=w; evx+=r.echoDir.x*w; evy+=r.echoDir.y*w; evz+=r.echoDir.z*w;
        wDelay+=(r.effDist/E.SPEED)*w;
      }
      const magRaw=Math.min(1, energy/(SPHERE_DIRS_DIRECT.length*E.ENERGY_NORM));
      const edelayRaw=energy>1e-6?wDelay/energy:0;
      const eL=Math.hypot(evx,evy,evz)||1; const edirRaw={x:evx/eL,y:evy/eL,z:evz/eL};
      const ES=E.SMOOTH;
      st._em=(st._em||0)*ES+magRaw*(1-ES);
      st._edelay=(st._edelay||0)*ES+edelayRaw*(1-ES);
      st._edx=(st._edx||0)*ES+edirRaw.x*magRaw*(1-ES);
      st._edy=(st._edy||0)*ES+edirRaw.y*magRaw*(1-ES);
      st._edz=(st._edz||0)*ES+edirRaw.z*magRaw*(1-ES);
      const edl=Math.hypot(st._edx,st._edy,st._edz)||1;
      const echoDir={x:st._edx/edl,y:st._edy/edl,z:st._edz/edl};

      if(scene){ const col=st.color||this.color;
        const stride=Math.max(1,Math.ceil(reached.length/24));
        for(let i=0;i<reached.length;i+=stride){ const r=reached[i];
          if(r.path.length>1) scene.drawPath(r.path,col,0.16);                 // bounced path, faint
          if(r.bounced) scene.drawPath([origin,r.echoPt],this.echoColor,0.5);  // echo ray (player→last LOS reflection)
        }
      }
      return {volume:st._v, dir, reachedCount:reached.length,
              echo:{magnitude:st._em, delay:st._edelay, dir:echoDir}};
    },
  },

  permeate:{
    color:0x7ee787,
    cast(origin, srcPos, scene, st){
      st=st||this;
      const P=Params.permeate;
      const to={x:srcPos.x-origin.x,y:srcPos.y-origin.y,z:srcPos.z-origin.z};
      const dist=Math.hypot(to.x,to.y,to.z)||1;
      const fwd={x:to.x/dist,y:to.y/dist,z:to.z/dist};
      // build a small basis around fwd for the fan
      const up=Math.abs(fwd.y)<0.9?{x:0,y:1,z:0}:{x:1,y:0,z:0};
      const right=norm(cross(fwd,up)); const realUp=cross(right,fwd);
      let sumInside=0,n=0; const rays=[];
      const side=Math.max(1,Math.round(Math.sqrt(P.RAY_COUNT)));
      for(let iy=0;iy<side;iy++)for(let ix=0;ix<side;ix++){
        const fx=(ix/(side-1)*2-1)*P.SPREAD, fy=(iy/(side-1)*2-1)*P.SPREAD;
        let dx=fwd.x+right.x*fx+realUp.x*fy, dy=fwd.y+right.y*fx+realUp.y*fy, dz=fwd.z+right.z*fx+realUp.z*fy;
        const dl=Math.hypot(dx,dy,dz)||1; dx/=dl;dy/=dl;dz/=dl;
        // in-voxel distance: for each solid cell the ray passes through, add the
        // length of ray inside it = (exit t) − (entry t). DDA gives the entry t
        // of each newly-entered cell, so a cell's exit = next cell's entry.
        let inside=0; const segs=[]; let prevT=0, prevSolid=false;
        World.dda(origin.x,origin.y,origin.z,dx,dy,dz,dist,(cx,cy,cz,t)=>{
          if(prevSolid){ const seg=Math.min(t,dist)-prevT; if(seg>0){ inside+=seg; segs.push([prevT,Math.min(t,dist)]); } }
          prevT=t; prevSolid=World.solid(cx,cy,cz);
          return null;
        });
        if(prevSolid && prevT<dist){ inside+=dist-prevT; segs.push([prevT,dist]); }
        sumInside+=inside; n++;
        rays.push({dx,dy,dz,segs});
      }
      const avgInside=sumInside/n;
      const muffleRaw=1-Math.exp(-avgInside/P.REF_THICK);
      const throughRaw=Math.exp(-avgInside/(P.REF_THICK*P.THROUGH_THICK_MULT));
      const S=P.SMOOTH;
      st._muffle=(st._muffle||0)*S+muffleRaw*(1-S);
      st._through=(st._through==null?1:st._through)*S+throughRaw*(1-S);
      const dir=fwd;
      if(scene){ const col=st.color||this.color;
        for(let i=0;i<rays.length;i+=2){ const r=rays[i];
          scene.drawPath([origin,{x:origin.x+r.dx*dist,y:origin.y+r.dy*dist,z:origin.z+r.dz*dist}],col,0.08);
          for(const [t0,t1] of r.segs) scene.drawPath(
            [{x:origin.x+r.dx*t0,y:origin.y+r.dy*t0,z:origin.z+r.dz*t0},
             {x:origin.x+r.dx*t1,y:origin.y+r.dy*t1,z:origin.z+r.dz*t1}],col,0.65);
        }
      }
      return {muffle:st._muffle, through:st._through, avgInside, dir};
    },
  },
};
