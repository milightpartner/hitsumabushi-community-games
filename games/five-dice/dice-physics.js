// サイコロとトレイの物理シミュレーション（描画には依存しない）。
//
// 出目はホストが乱数で先に決める。各端末はこのモジュールで「投げた結果」を画面に出さずに
// 最後まで計算し、止まったときに上を向いている面に、決まった出目が来るように
// サイコロの目の割り当て（向き）を差し替えてから、記録した動きを再生する。
// そのため端末ごとに転がり方が少し違っても、出目は必ず全員で一致する（チンチロと同じ方式）。
//
// RAPIER（@dimforge/rapier3d-compat）は呼び出し側で init してから渡す（ブラウザと Node の両方で使うため）。

export const DIE_SIZE = 1.0;
export const STEP_HZ = 120;
export const FRAME_EVERY = 2; // 記録は 60fps
export const MAX_SECONDS = 6;
export const GRAVITY = 110;

// トレイ。床（フェルト）の上面が y = 0。hx・hz は内側の半分の幅・奥行き
export const TRAY = { hx: 5.0, hz: 3.2, wall: 0.4, height: 0.85, base: 0.35 };
export const TABLE_Y = -TRAY.base;
// キープしたサイコロを置く台（トレイの手前）
export const RACK = { z: TRAY.hz + TRAY.wall + 1.35, slot: 1.6, top: TABLE_Y + 0.3 };

export function rackPos(i) {
  return [(i - 2) * RACK.slot, RACK.top + DIE_SIZE / 2, RACK.z];
}

// 壁の当たり判定は見た目の壁より高くして、サイコロがトレイの外へ飛び出さないようにする
const WALL_COLLIDER_H = 3.4;

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
  const u = rotate([-q[0], -q[1], -q[2], q[3]], [0, 1, 0]);
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

// ---------- シミュレーション ----------

const KIND_FELT = 0;
const KIND_WALL = 1;
export const SOUND_FELT = 0;
export const SOUND_DICE = 1;
export const SOUND_WALL = 2;

// 投げるサイコロの最初の並び（中心どうしを √3 より離して、最初から重ならないようにする）
const OFFSETS = [[0, 0, 0], [0.1, 0.15, 1.85], [0.1, 0.1, -1.85], [1.85, 0.3, 0.92], [1.85, 0.25, -0.92]];

/**
 * 1回の投げをシミュレートする。
 * @param RAPIER 初期化済みの Rapier
 * @param seed 投げ方を決めるシード
 * @param count 投げるサイコロの数（1〜5）
 * @returns { frames: Float32Array[count], events, finals: {pos, q, inside, flat, axis, dot}[], settled }
 */
export function simulate(RAPIER, seed, count) {
  const rand = mulberry32(seed);
  const world = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });
  world.timestep = 1 / STEP_HZ;
  world.numSolverIterations = 8;

  const { hx, hz, wall } = TRAY;
  const kinds = new Map();
  const tray = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  // 床はフェルト：よく止まり、あまり跳ねない
  const floor = world.createCollider(
    RAPIER.ColliderDesc.cuboid(hx + wall, 0.5, hz + wall).setTranslation(0, -0.5, 0).setFriction(0.6).setRestitution(0.28),
    tray,
  );
  kinds.set(floor.handle, KIND_FELT);
  // 壁は木：よく跳ね返る
  const h = WALL_COLLIDER_H / 2;
  const walls = [
    [hx + wall / 2, 0, wall / 2, hz + wall],
    [-(hx + wall / 2), 0, wall / 2, hz + wall],
    [0, hz + wall / 2, hx + wall, wall / 2],
    [0, -(hz + wall / 2), hx + wall, wall / 2],
  ];
  for (const [x, z, ex, ez] of walls) {
    const c = world.createCollider(
      RAPIER.ColliderDesc.cuboid(ex, h, ez).setTranslation(x, h, z).setFriction(0.22).setRestitution(0.5),
      tray,
    );
    kinds.set(c.handle, KIND_WALL);
  }

  // トレイの右側の上から、左の壁へ向かって放る
  const half = DIE_SIZE / 2;
  const round = 0.09 * DIE_SIZE;
  const base = { x: 1.2 + rand() * 0.8, y: 3.4 + rand() * 0.6, z: (rand() - 0.5) * 1.2 };
  const aim = { x: -(4 + rand() * 4), z: (rand() - 0.5) * 3 };
  const bodies = [];
  const dieHandles = new Map();
  for (let i = 0; i < count; i++) {
    const o = OFFSETS[i].map((c) => c * DIE_SIZE * 1.02);
    const q = randomQuat(rand);
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(base.x + o[0], base.y + o[1], base.z + o[2])
      .setRotation({ x: q[0], y: q[1], z: q[2], w: q[3] })
      .setLinearDamping(0.1)
      .setAngularDamping(0.3)
      .setCcdEnabled(true);
    desc.setLinvel(aim.x + (rand() - 0.5) * 2, -(1 + rand() * 2), aim.z + (rand() - 0.5) * 2);
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
  const frames = bodies.map(() => []);
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
        kind = kinds.get(other) === KIND_WALL ? SOUND_WALL : SOUND_FELT;
        mag = speed(bodies[die]);
      }
      events.push({ t: step / STEP_HZ, kind, die, mag });
    });
    if (step % FRAME_EVERY === 0) recordFrame(bodies, frames);

    const moving = bodies.some((b) => speed(b) > 0.08 || angSpeed(b) > 0.15);
    calm = moving ? 0 : calm + 1;
    if (calm > STEP_HZ * 0.25) break;
  }
  recordFrame(bodies, frames);

  const finals = bodies.map((b) => {
    const t = b.translation();
    const r = b.rotation();
    const q = [r.x, r.y, r.z, r.w];
    const up = upAxis(q);
    return {
      pos: [t.x, t.y, t.z],
      q,
      inside: Math.abs(t.x) < hx - 0.3 && Math.abs(t.z) < hz - 0.3,
      // 床に直接のっている（ほかのサイコロや壁に乗り上げていない）
      flat: t.y < half + 0.2,
      dot: up.dot,
      axis: up.axis,
    };
  });
  world.free();
  queue.free();
  return { frames: frames.map((f) => Float32Array.from(f)), events, finals, settled: calm > STEP_HZ * 0.25 };
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

// 止まったサイコロどうしの、真上から見た一番近い距離
function minGap(finals) {
  let m = Infinity;
  for (let a = 0; a < finals.length; a++) {
    for (let b = a + 1; b < finals.length; b++) {
      m = Math.min(m, Math.hypot(finals[a].pos[0] - finals[b].pos[0], finals[a].pos[2] - finals[b].pos[2]));
    }
  }
  return m;
}

// 投げの出来。2 = 全部トレイの中で平らに、ばらけて止まる、1 = トレイの中だが傾いている・くっついている、0 = 外に出た
function grade(sim) {
  if (!sim.finals.every((f) => f.inside)) return 0;
  const tidy = sim.settled && sim.finals.every((f) => f.flat && f.dot > 0.94) && minGap(sim.finals) > DIE_SIZE * 1.3;
  return tidy ? 2 : 1;
}

// 条件に合う投げが見つかるまで、シードを変えて試す。見つからなければ一番ましなものを返す。
// 最初に試すのは seed そのもの。ホストが見つけたシードを配れば、ほかの端末はたいてい1回の計算で済む
export function planThrow(RAPIER, seed, count, maxTries = 30) {
  let best = null;
  let bestGrade = -1;
  for (let k = 0; k < maxTries; k++) {
    const s = (seed + Math.imul(k, 0x9e3779b1)) >>> 0;
    const sim = simulate(RAPIER, s, count);
    const g = grade(sim);
    if (g === 2) return { sim, seed: s, tries: k + 1, ok: true };
    if (g > bestGrade) { best = { sim, seed: s }; bestGrade = g; }
  }
  return { sim: best.sim, seed: best.seed, tries: maxTries, ok: false };
}
