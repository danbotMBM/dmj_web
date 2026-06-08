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
// Sphere direction sets are rebuilt whenever the admin changes a ray count.
let SPHERE_DIRS_DIRECT = fibSphere(Params.direct.RAY_COUNT);
let SPHERE_DIRS_ECHO   = fibSphere(Params.echo.RAY_COUNT);
export function rebuildSpheres(){
  SPHERE_DIRS_DIRECT = fibSphere(Math.max(8, Math.round(Params.direct.RAY_COUNT)));
  SPHERE_DIRS_ECHO   = fibSphere(Math.max(8, Math.round(Params.echo.RAY_COUNT)));
}

function reflectFace(d,face){
  if(face==='x') return {x:-d.x,y:d.y,z:d.z};
  if(face==='y') return {x:d.x,y:-d.y,z:d.z};
  return {x:d.x,y:d.y,z:-d.z};
}
function cross(a,b){return {x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x};}
function norm(a){const l=Math.hypot(a.x,a.y,a.z)||1;return{x:a.x/l,y:a.y/l,z:a.z/l};}

export const RayModules={
  direct:{
    color:0xffb454,
    cast(origin, srcPos, scene, st){
      st=st||this;
      const P=Params.direct;
      const reached=[];
      for(const d0 of SPHERE_DIRS_DIRECT){
        let dx=d0.x,dy=d0.y,dz=d0.z;
        let ox=origin.x,oy=origin.y,oz=origin.z;
        let travelled=0, hitSource=false;
        const path=[{x:ox,y:oy,z:oz}];
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
            travelled+=proj; path.push({x:ccx,y:ccy,z:ccz}); hitSource=true; break;
          }
          if(!hit) break;
          travelled+=hit.t;
          const hx=ox+dx*hit.t, hy=oy+dy*hit.t, hz=oz+dz*hit.t;
          path.push({x:hx,y:hy,z:hz});
          const r=reflectFace({x:dx,y:dy,z:dz},hit.face); dx=r.x;dy=r.y;dz=r.z;
          ox=hx+dx*1e-3; oy=hy+dy*1e-3; oz=hz+dz*1e-3;
        }
        if(hitSource) reached.push({dir0:d0,dist:travelled,path});
      }
      // ── combine ──
      // Direction & distance are estimated from ALL rays that reached the
      // source, but loudness is NOT: it depends only on the (weighted-average)
      // path distance. So a single reaching ray already gives full effect, and
      // adding more rays sharpens the dir/dist estimate without raising volume.
      let vx=0,vy=0,vz=0, wSum=0, distW=0;
      for(const r of reached){
        const w=P.REF_DIST/Math.max(P.REF_DIST,r.dist);   // per-ray proximity 0..1
        vx+=r.dir0.x*w; vy+=r.dir0.y*w; vz+=r.dir0.z*w;   // weighted launch direction
        wSum+=w; distW+=r.dist*w;                          // weighted distance estimate
      }
      const repDist = wSum>1e-6 ? distW/wSum : Infinity;   // representative path length
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
      if(scene){ const col=st.color||this.color;
        const stride=Math.max(1,Math.ceil(reached.length/24));
        for(let i=0;i<reached.length;i+=stride) if(reached[i].path.length>1) scene.drawPath(reached[i].path,col,0.2);
      }
      return {volume:st._v, dir, reachedCount:reached.length};
    },
  },

  echo:{
    color:0xff5e87,
    cast(origin, scene, st){
      st=st||this;
      const P=Params.echo;
      const returns=[];
      for(const d0 of SPHERE_DIRS_ECHO){
        let dx=d0.x,dy=d0.y,dz=d0.z;
        let ox=origin.x,oy=origin.y,oz=origin.z;
        let travelled=0, returned=false, arrive=null;
        const path=[{x:ox,y:oy,z:oz}];
        for(let b=0;b<=P.MAX_BOUNCE;b++){
          const hit=World.dda(ox,oy,oz,dx,dy,dz,P.MAX_DIST-travelled,(cx,cy,cz)=>World.solid(cx,cy,cz)?{stop:true}:null);
          const segLen=hit?hit.t:(P.MAX_DIST-travelled);
          if(b>0){ // closest approach back to player
            const wx=origin.x-ox,wy=origin.y-oy,wz=origin.z-oz;
            const proj=Math.max(0,Math.min(segLen,wx*dx+wy*dy+wz*dz));
            const cax=ox+dx*proj,cay=oy+dy*proj,caz=oz+dz*proj;
            if(travelled+proj>P.MIN_PATH && Math.hypot(origin.x-cax,origin.y-cay,origin.z-caz)<=P.RETURN_R){
              travelled+=proj; path.push({x:cax,y:cay,z:caz}); arrive={x:-dx,y:-dy,z:-dz}; returned=true; break;
            }
          }
          if(!hit) break;
          travelled+=hit.t;
          const hx=ox+dx*hit.t,hy=oy+dy*hit.t,hz=oz+dz*hit.t; path.push({x:hx,y:hy,z:hz});
          const r=reflectFace({x:dx,y:dy,z:dz},hit.face); dx=r.x;dy=r.y;dz=r.z;
          ox=hx+dx*1e-3;oy=hy+dy*1e-3;oz=hz+dz*1e-3;
        }
        if(returned) returns.push({arrive,dist:travelled,path});
      }
      let vx=0,vy=0,vz=0,energy=0,wDelay=0;
      for(const r of returns){ const w=P.REF_DIST/Math.max(P.REF_DIST,r.dist);
        energy+=w; vx+=r.arrive.x*w; vy+=r.arrive.y*w; vz+=r.arrive.z*w; wDelay+=(r.dist/P.SPEED)*w; }
      const magRaw=Math.min(1, energy/(SPHERE_DIRS_ECHO.length*P.ENERGY_NORM));
      const delayRaw=energy>1e-6?wDelay/energy:0;
      const L=Math.hypot(vx,vy,vz)||1; const dirRaw={x:vx/L,y:vy/L,z:vz/L};
      const S=P.SMOOTH;
      st._m=(st._m||0)*S+magRaw*(1-S);
      st._delay=(st._delay||0)*S+delayRaw*(1-S);
      st._dx=(st._dx||0)*S+dirRaw.x*magRaw*(1-S);
      st._dy=(st._dy||0)*S+dirRaw.y*magRaw*(1-S);
      st._dz=(st._dz||0)*S+dirRaw.z*magRaw*(1-S);
      const dl=Math.hypot(st._dx,st._dy,st._dz)||1;
      const dir={x:st._dx/dl,y:st._dy/dl,z:st._dz/dl};
      if(scene){ const stride=Math.max(1,Math.ceil(returns.length/24));
        for(let i=0;i<returns.length;i+=stride) if(returns[i].path.length>1) scene.drawPath(returns[i].path,this.color,0.16);
      }
      return {magnitude:st._m, dir, delay:st._delay, returnCount:returns.length};
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
