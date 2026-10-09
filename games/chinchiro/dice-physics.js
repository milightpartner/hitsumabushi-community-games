// サイコロとどんぶりの物理シミュレーション（描画には依存しない）。
//
// 出目はホストが乱数で先に決める。各端末はこのモジュールで「投げた結果」を画面に出さずに
// 最後まで計算し、止まったときに上を向いている面に、決まった出目が来るように
// サイコロの目の割り当て（向き）を差し替えてから、記録した動きを再生する。
// そのため端末ごとに転がり方が少し違っても、出目は必ず全員で一致する。
//
// RAPIER（@dimforge/rapier3d-compat）は呼び出し側で init してから渡す（ブラウザと Node の両方で使うため）。

export const DIE_SIZE = 1.15;
export const STEP_HZ = 120;
export const FRAME_EVERY = 2; // 記録は 60fps
export const MAX_SECONDS = 6;
export const GRAVITY = 140;
// ションベンにするサイコロの着地点。どんぶりの中心からの距離と、手前（+z）から測った左右の角度[rad]
export const OUT = { dist: [6.8, 7.6], angle: [0.8, 1.5] };
// ションベンのサイコロが止まってよい、どんぶりの中心からの距離（これより遠いと画面の外に出る）
export const OUT_MAX_DIST = 8.8;

// どんぶりの形。半径 r と高さ y の組を、内側の底の中心 → 内壁 → 縁 → 外壁 → 高台 → 裏の中心 の順に並べる
const INNER_FLAT = 1.9;
const RIM_R = 5.2;
const DEPTH = 3.6;
const WALL = 0.24;
export const TABLE_Y = -0.62;
// 卓は畳・布のように、よく止まり、あまり跳ねない
export const TABLE_FRICTION = 1.4;
export const TABLE_RESTITUTION = 0.08;

function innerY(r) {
  if (r <= INNER_FLAT) return 0;
  const t = (r - INNER_FLAT) / (RIM_R - INNER_FLAT);
  return DEPTH * Math.pow(t, 2.1);
}

export function bowlSurfaceY(r) {
  return innerY(Math.min(r, RIM_R));
}

export const BOWL_PROFILE = (() => {
  const pts = [];
  // 内側：底の中心から縁まで
  pts.push([0, 0]);
  for (let i = 0; i <= 28; i++) {
    const r = INNER_FLAT * 0.6 + ((RIM_R - INNER_FLAT * 0.6) * i) / 28;
    pts.push([r, innerY(r)]);
  }
  // 縁（丸い口縁）
  const lipCx = RIM_R + WALL / 2;
  const lipCy = DEPTH;
  for (let i = 1; i < 8; i++) {
    const a = Math.PI - (Math.PI * i) / 8;
    pts.push([lipCx + Math.cos(a) * (WALL / 2), lipCy + Math.sin(a) * (WALL / 2) + 0.02]);
  }
  // 外側：縁から高台まで（内側を少し外・下にずらした形）
  for (let i = 28; i >= 6; i--) {
    const r = INNER_FLAT * 0.6 + ((RIM_R - INNER_FLAT * 0.6) * i) / 28;
    pts.push([r + WALL, innerY(r) - WALL * 1.1]);
  }
  // 高台
  const footR = 2.5;
  pts.push([footR + 0.15, TABLE_Y + 0.12]);
  pts.push([footR, TABLE_Y]);
  pts.push([footR - 0.25, TABLE_Y]);
  pts.push([footR - 0.3, -0.36]);
  pts.push([0, -0.36]);
  return pts;
})();

// ---------- 乱数（シードから毎回同じ値を出す） ----------

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- サイコロの向き（立方体の24通りの回転） ----------

// 目ごとの面の向き（標準のサイコロ。向かい合う面の和が7）
export const FACE_NORMALS = {
  1: [0, 1, 0],
  6: [0, -1, 0],
  2: [0, 0, 1],
  5: [0, 0, -1],
  3: [1, 0, 0],
  4: [-1, 0, 0],
};

// 3x3 の符号付き置換行列で det = +1 のもの（行優先の配列）
export const CUBE_ROTATIONS = (() => {
  const perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  const out = [];
  for (const p of perms) {
    for (let s = 0; s < 8; s++) {
      const signs = [s & 1 ? -1 : 1, s & 2 ? -1 : 1, s & 4 ? -1 : 1];
      const m = [0, 0, 0, 0, 0, 0, 0, 0, 0];
      for (let row = 0; row < 3; row++) m[row * 3 + p[row]] = signs[row];
      const det = m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
      if (det === 1) out.push(m);
    }
  }
  return out;
})();

function mulMatVec(m, v) {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

// クォータニオン q の逆回転でベクトル v を回す（ワールド → サイコロのローカル）
function rotateInv(q, v) {
  const [x, y, z, w] = q;
  return rotate([-x, -y, -z, w], v);
}

function rotate(q, v) {
  const [qx, qy, qz, qw] = q;
  const [vx, vy, vz] = v;
  const ix = qw * vx + qy * vz - qz * vy;
  const iy = qw * vy + qz * vx - qx * vz;
  const iz = qw * vz + qx * vy - qy * vx;
  const iw = -qx * vx - qy * vy - qz * vz;
  return [
    ix * qw + iw * -qx + iy * -qz - iz * -qy,
    iy * qw + iw * -qy + iz * -qx - ix * -qz,
    iz * qw + iw * -qz + ix * -qy - iy * -qx,
  ];
}

// 止まったサイコロで上を向いているローカル軸と、その傾き（1 = 真上）
export function upAxis(q) {
  const u = rotateInv(q, [0, 1, 0]);
  let best = null;
  let bestDot = -2;
  for (const axis of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
    const d = axis[0] * u[0] + axis[1] * u[1] + axis[2] * u[2];
    if (d > bestDot) { bestDot = d; best = axis; }
  }
  return { axis: best, dot: bestDot };
}

// 上を向いた軸 axis に目 value が来るような、目の割り当ての回転を選ぶ（候補4つから pick で選ぶ）
export function rotationForValue(axis, value, pick) {
  const n = FACE_NORMALS[value];
  const fits = CUBE_ROTATIONS.filter((m) => {
    const v = mulMatVec(m, n);
    return v[0] === axis[0] && v[1] === axis[1] && v[2] === axis[2];
  });
  return fits[Math.floor(pick * fits.length) % fits.length];
}

// 回転行列 m で、ローカル軸 axis に来る目
export function valueOnAxis(m, axis) {
  for (const [value, n] of Object.entries(FACE_NORMALS)) {
    const v = mulMatVec(m, n);
    if (v[0] === axis[0] && v[1] === axis[1] && v[2] === axis[2]) return Number(value);
  }
  return 0;
}

// ---------- シミュレーション ----------

let bowlVerts = null;
let bowlIndices = null;

function buildBowlMesh(segments) {
  const prof = BOWL_PROFILE;
  const verts = new Float32Array(prof.length * segments * 3);
  for (let s = 0; s < segments; s++) {
    const a = (Math.PI * 2 * s) / segments;
    const c = Math.cos(a);
    const sn = Math.sin(a);
    for (let i = 0; i < prof.length; i++) {
      const k = (s * prof.length + i) * 3;
      verts[k] = prof[i][0] * c;
      verts[k + 1] = prof[i][1];
      verts[k + 2] = prof[i][0] * sn;
    }
  }
  const idx = [];
  for (let s = 0; s < segments; s++) {
    const s2 = (s + 1) % segments;
    for (let i = 0; i < prof.length - 1; i++) {
      const a = s * prof.length + i;
      const b = s2 * prof.length + i;
      const c = s * prof.length + i + 1;
      const d = s2 * prof.length + i + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  return { verts, indices: new Uint32Array(idx) };
}

const KIND_BOWL = 0;
const KIND_TABLE = 1;
export const SOUND_BOWL = 0;
export const SOUND_DICE = 1;
export const SOUND_TABLE = 2;

/**
 * 1回の投げをシミュレートする。
 * @param RAPIER 初期化済みの Rapier
 * @param seed 投げ方を決めるシード
 * @param outIndex ションベン（どんぶりの外に出る）にするサイコロの番号。無ければ -1
 * @param abortEarly ションベンにならないと分かったら打ち切って null を返す
 * @returns { frames: Float32Array[3][], events, finals: {pos, q, inside, dot}[], steps } または null
 */
export function simulate(RAPIER, seed, outIndex, abortEarly = false) {
  if (!bowlVerts) {
    const mesh = buildBowlMesh(48);
    bowlVerts = mesh.verts;
    bowlIndices = mesh.indices;
  }
  const rand = mulberry32(seed);
  const world = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });
  world.timestep = 1 / STEP_HZ;
  world.numSolverIterations = 8;

  const kinds = new Map();
  const bowlBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const bowlCol = world.createCollider(
    RAPIER.ColliderDesc.trimesh(bowlVerts, bowlIndices).setFriction(0.28).setRestitution(0.42),
    bowlBody,
  );
  kinds.set(bowlCol.handle, KIND_BOWL);
  const tableCol = world.createCollider(
    RAPIER.ColliderDesc.cuboid(40, 0.5, 40).setTranslation(0, TABLE_Y - 0.5, 0).setFriction(TABLE_FRICTION).setRestitution(TABLE_RESTITUTION),
    bowlBody,
  );
  kinds.set(tableCol.handle, KIND_TABLE);

  // 手前（カメラ側 +z）の上から、奥へ向かって放る
  const half = DIE_SIZE / 2;
  const round = 0.09 * DIE_SIZE;
  const hx = rand() * 2 - 1;
  const base = { x: hx * 1.2, y: 5.6 + rand() * 0.8, z: 3.6 + rand() * 0.6 };
  const aim = { x: -hx * 1.5 + (rand() - 0.5) * 2, z: -(6 + rand() * 2.5) };
  // 向きがばらばらの立方体どうしが最初から重ならないよう、中心を √3 より離して置く
  const offsets = [[-0.92, 0, 0.5], [0.92, 0.1, 0.5], [0, 0.2, -1.05]].map((o) => o.map((c) => c * DIE_SIZE * 1.05));
  const bodies = [];
  const dieHandles = new Map();
  for (let i = 0; i < 3; i++) {
    const o = offsets[i];
    const q = randomQuat(rand);
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(base.x + o[0], base.y + o[1], base.z + o[2])
      .setRotation({ x: q[0], y: q[1], z: q[2], w: q[3] })
      .setLinearDamping(0.08)
      .setAngularDamping(0.25)
      .setCcdEnabled(true);
    const out = i === outIndex;
    let vx = aim.x + (rand() - 0.5) * 1.6;
    let vy = -(1 + rand() * 2);
    let vz = aim.z + (rand() - 0.5) * 1.6;
    if (out) {
      // ションベンにするサイコロは、どんぶりのすぐ外の着地点を決めて、縁を越える一番低い山なりで放る
      const a = Math.PI / 2 + (rand() < 0.5 ? -1 : 1) * (OUT.angle[0] + rand() * (OUT.angle[1] - OUT.angle[0]));
      const dist = OUT.dist[0] + rand() * (OUT.dist[1] - OUT.dist[0]);
      const v = lobOverRim([base.x + o[0], base.y + o[1], base.z + o[2]], [Math.cos(a) * dist, Math.sin(a) * dist]);
      [vx, vy, vz] = v;
    }
    desc.setLinvel(vx, vy, vz);
    desc.setAngvel({ x: (rand() - 0.5) * 40, y: (rand() - 0.5) * 30, z: (rand() - 0.5) * 40 });
    const body = world.createRigidBody(desc);
    const col = world.createCollider(
      RAPIER.ColliderDesc.roundCuboid(half - round, half - round, half - round, round)
        .setDensity(1)
        .setFriction(0.35)
        .setRestitution(0.38)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      body,
    );
    dieHandles.set(col.handle, i);
    bodies.push(body);
  }

  const queue = new RAPIER.EventQueue(true);
  const frames = [[], [], []];
  const events = [];
  const maxSteps = MAX_SECONDS * STEP_HZ;
  let calm = 0;
  let step = 0;
  for (; step < maxSteps; step++) {
    world.step(queue);
    queue.drainCollisionEvents((h1, h2, started) => {
      if (!started) return;
      const d1 = dieHandles.get(h1);
      const d2 = dieHandles.get(h2);
      if (d1 === undefined && d2 === undefined) return;
      const die = d1 !== undefined ? d1 : d2;
      const other = d1 !== undefined ? h2 : h1;
      let mag;
      let kind;
      if (d1 !== undefined && d2 !== undefined) {
        kind = SOUND_DICE;
        mag = relSpeed(bodies[d1], bodies[d2]);
      } else {
        kind = kinds.get(other) === KIND_TABLE ? SOUND_TABLE : SOUND_BOWL;
        mag = speed(bodies[die]);
      }
      events.push({ t: step / STEP_HZ, kind, die, mag });
    });
    if (step % FRAME_EVERY === 0) recordFrame(bodies, frames);

    const moving = bodies.some((b) => speed(b) > 0.08 || angSpeed(b) > 0.15);
    calm = moving ? 0 : calm + 1;
    if (calm > STEP_HZ * 0.25) break;

    // ションベンにならないと分かった時点で打ち切る（外に出ないまま時間が経った／遠くまで転がった）
    if (abortEarly && outIndex >= 0 && step % 12 === 0) {
      const t = bodies[outIndex].translation();
      const r = Math.hypot(t.x, t.z);
      if ((step > STEP_HZ * 0.9 && r < RIM_R) || r > OUT_MAX_DIST) {
        world.free();
        queue.free();
        return null;
      }
    }
  }
  recordFrame(bodies, frames);

  const finals = bodies.map((b) => {
    const t = b.translation();
    const r = b.rotation();
    const q = [r.x, r.y, r.z, r.w];
    const horiz = Math.hypot(t.x, t.z);
    const up = upAxis(q);
    return {
      pos: [t.x, t.y, t.z],
      q,
      inside: horiz < RIM_R - 0.2 && t.y > -0.2,
      onTable: horiz > RIM_R + 0.3 && t.y < TABLE_Y + 0.8,
      stacked: t.y > bowlSurfaceY(horiz) + half + 0.45,
      dot: up.dot,
      axis: up.axis,
      dist: horiz,
    };
  });
  world.free();
  queue.free();
  return { frames: frames.map((f) => Float32Array.from(f)), events, finals, steps: step, settled: calm > STEP_HZ * 0.25 };
}

// start から着地点 [x, z]（卓の上）へ放る初速。滞空時間を短い方から試し、
// どんぶりの縁の上を通る瞬間にサイコロが縁より十分高くなる、最初のものを返す
function lobOverRim(start, land) {
  const [sx, sy, sz] = start;
  const landY = TABLE_Y + DIE_SIZE / 2;
  const clearR = RIM_R + WALL + DIE_SIZE * 0.6;
  const clearY = DEPTH + DIE_SIZE * 0.7;
  let v = null;
  for (let T = 0.3; T <= 1.2; T += 0.02) {
    const vx = (land[0] - sx) / T;
    const vz = (land[1] - sz) / T;
    const vy = (landY - sy + 0.5 * GRAVITY * T * T) / T;
    v = [vx, vy, vz];
    let ok = true;
    for (let k = 1; k <= 40; k++) {
      const t = (T * k) / 40;
      const r = Math.hypot(sx + vx * t, sz + vz * t);
      const y = sy + vy * t - 0.5 * GRAVITY * t * t;
      if (r > RIM_R - DIE_SIZE * 0.6 && r < clearR && y < clearY) { ok = false; break; }
    }
    if (ok) return v;
  }
  return v;
}

function recordFrame(bodies, frames) {
  for (let i = 0; i < bodies.length; i++) {
    const t = bodies[i].translation();
    const r = bodies[i].rotation();
    frames[i].push(t.x, t.y, t.z, r.x, r.y, r.z, r.w);
  }
}

function speed(b) {
  const v = b.linvel();
  return Math.hypot(v.x, v.y, v.z);
}

function angSpeed(b) {
  const v = b.angvel();
  return Math.hypot(v.x, v.y, v.z);
}

function relSpeed(a, b) {
  const va = a.linvel();
  const vb = b.linvel();
  return Math.hypot(va.x - vb.x, va.y - vb.y, va.z - vb.z);
}

function randomQuat(rand) {
  const u1 = rand();
  const u2 = rand();
  const u3 = rand();
  const s1 = Math.sqrt(1 - u1);
  const s2 = Math.sqrt(u1);
  return [s1 * Math.sin(2 * Math.PI * u2), s1 * Math.cos(2 * Math.PI * u2), s2 * Math.sin(2 * Math.PI * u3), s2 * Math.cos(2 * Math.PI * u3)];
}

// 投げの出来。2 = 条件どおり（全部どんぶりの中で平らに止まる／指定のサイコロだけが卓の近くに出る）、
// 1 = 見た目は役どおり（ションベンなら外に出ている）だが少し傾いている等、0 = 役と食い違う
function grade(sim, outIndex) {
  const outOk = outIndex < 0 || (sim.finals[outIndex].onTable && sim.finals[outIndex].dist < OUT_MAX_DIST);
  const insOk = sim.finals.every((f, i) => i === outIndex || f.inside);
  if (!outOk || !insOk) return 0;
  const tidy = sim.settled && sim.finals.every((f, i) => i === outIndex || (!f.stacked && f.dot > 0.94));
  return tidy ? 2 : 1;
}

// 条件に合う投げが見つかるまで、シードを変えて試す。見つからなければ一番ましなものを返す。
// 最初に試すのは seed そのもの。ホストが見つけたシードを配れば、ほかの端末はたいてい1回の計算で済む
export function planThrow(RAPIER, seed, outIndex, maxTries = 40) {
  let best = null;
  let bestGrade = -1;
  for (let k = 0; k < maxTries; k++) {
    const s = (seed + Math.imul(k, 0x9e3779b1)) >>> 0;
    // 最後の1回だけは打ち切らずに最後まで計算する（何も残らないことが無いように）
    const sim = simulate(RAPIER, s, outIndex, k < maxTries - 1 || best !== null);
    if (!sim) continue;
    const g = grade(sim, outIndex);
    if (g === 2) return { sim, seed: s, tries: k + 1, ok: true };
    if (g > bestGrade) { best = { sim, seed: s }; bestGrade = g; }
  }
  return { sim: best.sim, seed: best.seed, tries: maxTries, ok: false };
}
