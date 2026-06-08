import * as THREE from 'three';

/* ════════════════════════════════════════════════════════════
   VOXEL WORLD — a 3D grid. 0 = empty, 1 = solid. Cell size in m.
   The whole acoustic + collision model reads from this grid.
   ════════════════════════════════════════════════════════════ */
export const World = (() => {
  const CELL = 1.5;                       // metres per voxel
  let NX=0, NY=0, NZ=0;                    // grid dims (x,height,z)
  let grid = null;                        // Uint8Array, idx = x + NX*(y + NY*z)

  const idx = (x,y,z) => x + NX*(y + NY*z);
  const inBounds = (x,y,z) => x>=0&&y>=0&&z>=0&&x<NX&&y<NY&&z<NZ;
  function solid(x,y,z){ if(!inBounds(x,y,z)) return true; return grid[idx(x,y,z)]===1; } // OOB = solid wall
  function solidAt(wx,wy,wz){ return solid(Math.floor(wx/CELL),Math.floor(wy/CELL),Math.floor(wz/CELL)); }

  // build the multi-room layout. Returns spawn point.
  let spawn = new THREE.Vector3();
  let rooms = [];
  function build(){
    // overall bounds chosen to fit three rooms + connecting corridors
    NX=46; NY=14; NZ=30;
    grid = new Uint8Array(NX*NY*NZ).fill(1);   // start all solid, carve rooms

    rooms = [];
    const carve=(x0,y0,z0,x1,y1,z1)=>{
      for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++)for(let z=z0;z<=z1;z++)
        if(inBounds(x,y,z)) grid[idx(x,y,z)]=0;
    };
    // Room S (small): low ceiling, tight
    carve(2,1,2, 8,3,8);          rooms.push({name:'small',cx:5,cz:5});
    // Room L (very big): wide and fairly tall
    carve(12,1,2, 30,7,22);       rooms.push({name:'big',cx:21,cz:12});
    // Room T (tall & narrow): small footprint, very high
    carve(34,1,4, 39,12,9);       rooms.push({name:'tall',cx:36,cz:6});

    // corridors connecting them (carve doorways at floor level)
    carve(8,1,4, 13,2,6);         // small → big
    carve(30,1,10, 35,2,12);      // big → tall

    // ── interior partition walls in the BIG room that stop short of the
    //    ceiling (room ceiling is y=7; these rise to y=4, leaving a gap) ──
    const fill=(x0,y0,z0,x1,y1,z1)=>{
      for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++)for(let z=z0;z<=z1;z++)
        if(inBounds(x,y,z)) grid[idx(x,y,z)]=1;
    };
    fill(17,1,2, 17,4,14);        // long divider from the north wall, gap before far side
    fill(24,1,9, 24,4,22);        // offset divider from the south wall
    fill(20,1,17, 27,4,17);       // cross piece creating a little alcove
    // top of the big room (y 5–7) stays open over all of these

    spawn.set(5*CELL+CELL/2, 1*CELL+0.9, 5*CELL+CELL/2); // stand in small room
    return spawn;
  }

  /* 3D DDA (Amanatides & Woo). Casts from world point along unit dir.
     onCell(cx,cy,cz, tEnter) called for each cell entered (excluding start).
     Stops when cb returns an object {stop:true,...}; that object is returned.
     Also returns {face} axis of last crossing for normals. */
  function dda(ox,oy,oz, dx,dy,dz, maxDist, cb){
    let cx=Math.floor(ox/CELL), cy=Math.floor(oy/CELL), cz=Math.floor(oz/CELL);
    const stepX=Math.sign(dx)||1, stepY=Math.sign(dy)||1, stepZ=Math.sign(dz)||1;
    const inv=(d)=> d!==0 ? 1/Math.abs(d) : Infinity;
    const tDX=inv(dx)*CELL, tDY=inv(dy)*CELL, tDZ=inv(dz)*CELL;
    // distance to first boundary on each axis
    const fx = dx>0 ? (cx+1)*CELL-ox : ox-cx*CELL;
    const fy = dy>0 ? (cy+1)*CELL-oy : oy-cy*CELL;
    const fz = dz>0 ? (cz+1)*CELL-oz : oz-cz*CELL;
    let tMaxX = dx!==0 ? fx*inv(dx) : Infinity;
    let tMaxY = dy!==0 ? fy*inv(dy) : Infinity;
    let tMaxZ = dz!==0 ? fz*inv(dz) : Infinity;
    let t=0, face='x';
    let guard=0;
    while(t<=maxDist && guard++<512){
      if(tMaxX<tMaxY && tMaxX<tMaxZ){ cx+=stepX; t=tMaxX; tMaxX+=tDX; face='x'; }
      else if(tMaxY<tMaxZ){ cy+=stepY; t=tMaxY; tMaxY+=tDY; face='y'; }
      else { cz+=stepZ; t=tMaxZ; tMaxZ+=tDZ; face='z'; }
      const r = cb(cx,cy,cz,t,face);
      if(r && r.stop) return Object.assign({t,face,cx,cy,cz},r);
    }
    return null;
  }

  function dims(){ return {NX,NY,NZ,CELL}; }
  function eachSolid(fn){ for(let z=0;z<NZ;z++)for(let y=0;y<NY;y++)for(let x=0;x<NX;x++) if(grid[idx(x,y,z)]===1) fn(x,y,z); }

  return { CELL, build, solid, solidAt, dda, dims, eachSolid, get spawn(){return spawn;}, get rooms(){return rooms;} };
})();
