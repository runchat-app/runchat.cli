// Basketry UI. The structure lives in app state; this page relaxes it live
// (so you watch rods spring into shape), colours it by stress, and edits it by
// running the same commands an agent would, locally and for free.
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { commands } from "../commands.js";
import {
  addArch,
  addHoop,
  addLoop,
  addPreset,
  autoJoin,
  beginStage,
  bounds,
  carryFrom,
  cutList,
  dist,
  loadDesignOps,
  modelOps,
  readModel,
  slipTies,
  snapshotDesign,
  storePositions,
  weave,
} from "./model.js";
import { SETTLED, analyze, buildSim, profiles, rodPoints, step } from "./sim.js";
import cellsExample from "./examples/cells.js";
import { createStore } from "./store.js";

const $ = (id) => document.getElementById(id);

// ---------- three ----------
const view = $("view");
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  preserveDrawingBuffer: true,
});
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.localClippingEnabled = true;
view.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf1ede6);
scene.fog = new THREE.Fog(0xf1ede6, 30, 70);
// three is Y up; the model is Z up.
const world = new THREE.Group();
world.rotation.x = -Math.PI / 2;
scene.add(world);
world.updateMatrixWorld(true);

scene.add(new THREE.HemisphereLight(0xfffaf0, 0xb9ad98, 1.5));
const SUN_DIR = new THREE.Vector3(-8, 14, 6).normalize();
const sun = new THREE.DirectionalLight(0xfff3e0, 2.2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.radius = 3;
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.01;
scene.add(sun, sun.target);

const perspective = new THREE.PerspectiveCamera(38, 1, 0.05, 300);
perspective.position.set(9, 7, 11);
const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -300, 300);
let camera = perspective;
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.2, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.12;
controls.maxPolarAngle = Math.PI * 0.5;

// The shadow catcher draws first and neither ground layer writes depth, so
// the two transparent planes never fight over the same pixels.
const groundMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  extensions: { derivatives: true },
  uniforms: { fade: { value: 26 } },
  vertexShader: `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
  fragmentShader: `varying vec2 vP; uniform float fade;
    float grid(float s){ vec2 c = vP / s; vec2 g = abs(fract(c - 0.5) - 0.5) / fwidth(c); return 1. - min(min(g.x, g.y), 1.); }
    void main(){
      float d = length(vP);
      float a = grid(0.5) * 0.10 + grid(2.0) * 0.16;
      vec2 ax = abs(vP) / fwidth(vP); a = max(a, (1. - min(min(ax.x, ax.y), 1.)) * 0.22);
      a *= 1. - smoothstep(fade * 0.4, fade, d);
      gl_FragColor = vec4(0.36, 0.31, 0.24, a);
    }`,
});
const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), groundMat);
ground.renderOrder = -1;
world.add(ground);
const shadowCatcher = new THREE.Mesh(
  new THREE.PlaneGeometry(120, 120),
  new THREE.ShadowMaterial({ opacity: 0.2, depthWrite: false }),
);
shadowCatcher.receiveShadow = true;
shadowCatcher.renderOrder = -2;
world.add(shadowCatcher);

// ---------- instanced geometry ----------
const clipPlane = new THREE.Plane();
const clipped = (mat) => Object.assign(mat, { clipShadows: true });
const unitCyl = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);
const rodMat = clipped(new THREE.MeshStandardMaterial({ roughness: 0.72 }));
const tieMat = clipped(new THREE.MeshStandardMaterial({ roughness: 0.6 }));
const anchorMat = clipped(
  new THREE.MeshStandardMaterial({ color: 0x3a342c, roughness: 0.8 }),
);
const cutMat = new THREE.MeshBasicMaterial({ color: 0x26221d });
let rodMesh = null;
let tieMesh = null;
let anchorMesh = null;
let cutMesh = null;
const gapLines = new THREE.LineSegments(
  new THREE.BufferGeometry(),
  clipped(new THREE.LineBasicMaterial({ color: 0xc2412d })),
);
world.add(gapLines);

function grow(mesh, geo, mat, n, shadow) {
  if (mesh && mesh.instanceMatrix.count >= n) return mesh;
  if (mesh) {
    world.remove(mesh);
    mesh.dispose();
  }
  const m = new THREE.InstancedMesh(geo, mat, Math.max(16, Math.ceil(n * 1.5)));
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.setColorAt(0, new THREE.Color());
  m.castShadow = shadow;
  m.frustumCulled = false;
  world.add(m);
  return m;
}
const sphereGeo = new THREE.SphereGeometry(1, 10, 8);
function ensureCapacity(segs, ties, anchors) {
  rodMesh = grow(rodMesh, unitCyl, rodMat, segs, true);
  tieMesh = grow(tieMesh, sphereGeo, tieMat, ties, false);
  anchorMesh = grow(
    anchorMesh,
    new THREE.BoxGeometry(1, 1, 1),
    anchorMat,
    anchors,
    true,
  );
  cutMesh = grow(cutMesh, sphereGeo, cutMat, segs, false);
}

const marker = new THREE.Mesh(
  new THREE.SphereGeometry(0.07, 16, 12),
  new THREE.MeshBasicMaterial({
    color: 0x2b6cdf,
    depthTest: false,
    transparent: true,
    opacity: 0.9,
  }),
);
marker.renderOrder = 10;
marker.visible = false;
const firstMarker = marker.clone();
firstMarker.material = marker.material.clone();
firstMarker.material.color.set(0x26221d);
const previewMat = new THREE.LineBasicMaterial({
  transparent: true,
  opacity: 0.9,
  depthTest: false,
});
const previewLines = new THREE.LineSegments(
  new THREE.BufferGeometry(),
  previewMat,
);
previewLines.renderOrder = 9;
previewLines.frustumCulled = false;
world.add(marker, firstMarker, previewLines);

const sectionPlane = new THREE.Group();
sectionPlane.add(
  new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      color: 0x2b6cdf,
      transparent: true,
      opacity: 0.06,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  ),
  new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1)),
    new THREE.LineBasicMaterial({
      color: 0x2b6cdf,
      transparent: true,
      opacity: 0.5,
    }),
  ),
);
sectionPlane.visible = false;
world.add(sectionPlane);

// ---------- colours ----------
const STRESS_STOPS = [
  [0, "#d9c9a6"],
  [0.4, "#dcb35e"],
  [0.7, "#e5862f"],
  [1.0, "#d2382b"],
  [2.0, "#7a1530"],
  [3.0, "#2e1238"],
];
const stressRamp = STRESS_STOPS.map(([t, c]) => [t, new THREE.Color(c)]);
function stressColor(u, out) {
  if (u <= 0) return out.copy(stressRamp[0][1]);
  for (let i = 1; i < stressRamp.length; i++) {
    const [t1, c1] = stressRamp[i];
    const [t0, c0] = stressRamp[i - 1];
    if (u <= t1) return out.copy(c0).lerp(c1, (u - t0) / (t1 - t0));
  }
  return out.copy(stressRamp[stressRamp.length - 1][1]);
}
const stageColor = (s, max, out) =>
  out.setHSL(0.6 - 0.55 * (max > 1 ? (s - 1) / (max - 1) : 0), 0.45, 0.55);
const PROFILE_COLORS = { primary: "#7a4f2a", rod: "#d6c29a", weave: "#e8c066" };
function profileColor(name, out) {
  if (PROFILE_COLORS[name]) return out.set(PROFILE_COLORS[name]);
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return out.setHSL(h / 360, 0.45, 0.55);
}
// The load view stretches the ramp so a quarter of the strength reads as red.
const LOAD_SCALE = 4;
const SELECT = new THREE.Color("#2b6cdf");
const HOVER = new THREE.Color("#7fa8f0");
const DANGER = new THREE.Color("#d2382b");
const TIE = new THREE.Color("#3b342b");
const TIE_HOT = new THREE.Color("#e5862f");
const STATUS = { ok: 0x2b6cdf, warn: 0xd98a1c, bad: 0xd2382b };

// ---------- state + simulation ----------
let model = readModel({});
let sim = buildSim([], [], model.material);
let analysis = null;
let settled = true;
let lastWrite = 0;
let selection = new Set();
let hoverId = null;
let preview = null;
const section = { axis: "off", pos: 0, flip: false };
const opts = {
  tool: "orbit",
  colorMode: "stress",
  thickness: 2,
  showTies: true,
  arch: { mode: "fixed", length: 8, ratio: 1.5, socket: "tangent", profile: "rod", bundle: 1 },
  loop: { length: 6, tilt: 0, profile: "rod", bundle: 1 },
  hoop: { length: 8, attach: 0.7, profile: "weave", bundle: 1 },
  weave: { count: 6, slack: 1.25, pattern: "parallel", profile: "weave", bundle: 1 },
  preset: { type: "cross", span: 5, length: 8, profile: "primary", bundle: 1 },
};

const rodSpec = () => ({ profile: opts[opts.tool].profile, bundle: opts[opts.tool].bundle });
let matProfile = "rod";

const store = createStore((state, source) => {
  // A browser with nothing saved (e.g. a published page) starts on the example.
  if (source === "init" && !store?.shared && !Object.keys(state).some((k) => k.startsWith("rods.")))
    return queueMicrotask(() => {
      store.apply(loadDesignOps(store.state, cellsExample));
      frameSoon();
    });
  rebuild(state);
  if (source !== "local") frameIfFirst();
});

function rebuild(state) {
  model = readModel(state);
  const old = sim;
  const carry = carryFrom(old);
  sim = buildSim(
    [...model.rods.values()],
    model.joints,
    model.material,
    (rod) =>
      (rod.v ?? 0) > (old.index.get(rod.id)?.rod.v ?? 0) ? null : carry(rod),
  );
  settled = false;
  const joints = new Set(model.joints.map((j) => j.id));
  for (const id of selection)
    if (!model.rods.has(id) && !joints.has(id)) selection.delete(id);
  syncMaterialInputs();
  $("start").hidden = model.rods.size > 0;
  $("stat-mode").textContent = store.shared ? "shared with canvas" : "local";
  fitShadow();
  renderSelection();
  renderCutSummary();
  if (!$("cutlist").hidden) renderCutList();
  renderIterations(state);
}

function writeBack() {
  const m = readModel(store.state);
  const slipped = slipTies(m, sim);
  if (slipped.length)
    toast(
      `${slipped.length} overloaded lashing${slipped.length > 1 ? "s" : ""} slipped`,
    );
  else storePositions(m, sim);
  store.apply(modelOps(m, store.state));
}

// Undo history: the design as it was before each edit made from this page.
const history = [];
const READ_ONLY = new Set(["describe", "export_rods", "cut_list", "list_iterations", "save_iteration", "delete_iteration"]);

function run(name, args) {
  writeBack();
  try {
    const before = snapshotDesign(store.state);
    const out = commands[name].run(args, { state: store.state, local: true });
    if (out.ops?.length && !READ_ONLY.has(name)) {
      history.push(before);
      if (history.length > 40) history.shift();
    }
    store.apply(out.ops ?? []);
    return out.result;
  } catch (e) {
    toast(e.message, true);
  }
}

// ---------- drawing ----------
const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpV = new THREE.Vector3();
const tmpS = new THREE.Vector3();
const tmpC = new THREE.Color();
const Y = new THREE.Vector3(0, 1, 0);
const AXIS = { x: 0, y: 1, z: 2 };

function draw() {
  const { X, seg, jt, rods } = sim;
  const segCount = seg.length / 4;
  const anchors = rods.reduce((n, r) => n + (r.fix?.length ?? 0), 0);
  ensureCapacity(segCount, jt.length / 4, anchors);
  analysis = analyze(sim);
  const r = 0.01 * opts.thickness;
  const radii = sim.rodP.map((p) => (p.width / 2) * opts.thickness);
  const maxStage = model.meta.stage;
  const erasing = opts.tool === "erase";
  const ax = AXIS[section.axis];
  let cuts = 0;
  for (let s = 0, k = 0; s < seg.length; s += 4, k++) {
    const a = 3 * seg[s];
    const b = 3 * seg[s + 1];
    tmpV.set(X[b] - X[a], X[b + 1] - X[a + 1], X[b + 2] - X[a + 2]);
    const L = tmpV.length();
    tmpQ.setFromUnitVectors(Y, tmpV.divideScalar(L || 1));
    const rr = radii[sim.nodeRod[seg[s]]];
    tmpS.set(rr, L, rr);
    tmpV.set(
      (X[a] + X[b]) / 2,
      (X[a + 1] + X[b + 1]) / 2,
      (X[a + 2] + X[b + 2]) / 2,
    );
    rodMesh.setMatrixAt(k, tmpM.compose(tmpV, tmpQ, tmpS));
    const rod = rods[sim.nodeRod[seg[s]]];
    if (selection.has(rod.id)) tmpC.copy(SELECT);
    else if (rod.id === hoverId) tmpC.copy(erasing ? DANGER : HOVER);
    else if (opts.colorMode === "stress")
      stressColor(analysis.segUtil[k], tmpC);
    else if (opts.colorMode === "load")
      stressColor(
        (analysis.segLoad[k] * 1e6 * LOAD_SCALE) / sim.rodP[sim.nodeRod[seg[s]]].fb,
        tmpC,
      );
    else if (opts.colorMode === "stage") stageColor(rod.stage, maxStage, tmpC);
    else profileColor(sim.rodP[sim.nodeRod[seg[s]]].profile, tmpC);
    rodMesh.setColorAt(k, tmpC);
    if (ax !== undefined) {
      const va = X[a + ax] - section.pos;
      const vb = X[b + ax] - section.pos;
      if (va * vb <= 0 && va !== vb) {
        const t = va / (va - vb);
        tmpV.set(
          X[a] + (X[b] - X[a]) * t,
          X[a + 1] + (X[b + 1] - X[a + 1]) * t,
          X[a + 2] + (X[b + 2] - X[a + 2]) * t,
        );
        const c = rr * 1.6;
        cutMesh.setMatrixAt(
          cuts,
          tmpM.compose(tmpV, tmpQ.identity(), tmpS.set(c, c, c)),
        );
        cutMesh.setColorAt(cuts++, tmpC.set(0x26221d));
      }
    }
  }
  rodMesh.count = segCount;
  cutMesh.count = cuts;

  const cap = sim.P.joint_capacity_n;
  const gaps = [];
  for (let j = 0, k = 0; j < jt.length; j += 4, k++) {
    const a = 3 * jt[j];
    const b = 3 * jt[j + 1];
    tmpV.set(
      (X[a] + X[b]) / 2,
      (X[a + 1] + X[b + 1]) / 2,
      (X[a + 2] + X[b + 2]) / 2,
    );
    const id = sim.jointIds[k];
    const f = Math.abs(analysis.jointF[k]);
    const picked = selection.has(id) || id === hoverId;
    const size = opts.showTies || picked ? r * (picked ? 3.4 : 1.5) : 0;
    tieMesh.setMatrixAt(
      k,
      tmpM.compose(tmpV, tmpQ.identity(), tmpS.set(size, size, size)),
    );
    if (selection.has(id)) tmpC.copy(SELECT);
    else if (id === hoverId) tmpC.copy(erasing ? DANGER : HOVER);
    else if (f > cap) tmpC.copy(DANGER);
    else tmpC.copy(TIE).lerp(TIE_HOT, Math.min(1, f / cap));
    tieMesh.setColorAt(k, tmpC);
    if (
      opts.showTies &&
      Math.hypot(X[b] - X[a], X[b + 1] - X[a + 1], X[b + 2] - X[a + 2]) > 0.01
    )
      gaps.push(X[a], X[a + 1], X[a + 2], X[b], X[b + 1], X[b + 2]);
  }
  tieMesh.count = jt.length / 4;
  gapLines.geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(gaps, 3),
  );

  let n = 0;
  for (const rod of rods)
    for (const f of rod.fix ?? []) {
      tmpV.set(f.p[0], f.p[1], 0.02);
      anchorMesh.setMatrixAt(
        n,
        tmpM.compose(tmpV, tmpQ.identity(), tmpS.set(0.09, 0.09, 0.04)),
      );
      anchorMesh.setColorAt(n++, tmpC.set("#3a342c"));
    }
  anchorMesh.count = n;
  for (const m of [rodMesh, tieMesh, anchorMesh, cutMesh]) {
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }
}

function updateStats() {
  let total = 0;
  let over = 0;
  for (const r of model.rods.values()) {
    total += r.L;
    if (r.L > model.material.max_rod_m) over++;
  }
  const mass = total * sim.P.A * sim.P.density;
  const peak = analysis ? Math.max(0, ...analysis.rodMax) : 0;
  const tie = analysis
    ? Math.max(0, ...Array.from(analysis.jointF, Math.abs))
    : 0;
  $("stat-rods").textContent =
    `${model.rods.size} rods · ${sim.jointIds.length} ties`;
  const sl = $("stat-length");
  sl.textContent = `${total.toFixed(1)} m · ${mass.toFixed(1)} kg${over ? ` · ${over} over ${model.material.max_rod_m} m` : ""}`;
  sl.classList.toggle("warn", over > 0);
  const util = $("stat-util");
  util.textContent = `peak stress ${Math.round(peak * 100)}%`;
  util.classList.toggle("warn", peak > 1);
  const tj = $("stat-joint");
  tj.textContent = `max tie ${Math.round(tie)} N`;
  tj.classList.toggle("warn", tie > sim.P.joint_capacity_n);
  $("stat-sim").querySelector(".dot").classList.toggle("busy", !settled);
  $("stat-sim").querySelector("span").textContent = settled
    ? "settled"
    : "relaxing…";
}

// ---------- camera, shadows, section ----------
const toWorld = (p) => new THREE.Vector3(...p).applyMatrix4(world.matrixWorld);

function modelBox() {
  return bounds(model) ?? { min: [-3, -3, 0], max: [3, 3, 2] };
}

function fitShadow() {
  const b = modelBox();
  const c = toWorld([(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, 0]);
  const size =
    Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2]) / 2 + 2;
  sun.target.position.copy(c);
  sun.position.copy(c).addScaledVector(SUN_DIR, 30);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -size * 1.3;
  sc.right = sc.top = size * 1.3;
  sc.near = 5;
  sc.far = 60;
  sc.updateProjectionMatrix();
}

let framed = false;
function frameIfFirst() {
  if (!framed && model.rods.size) {
    frame();
    framed = true;
  }
}
function frame() {
  const b = modelBox();
  const size = Math.max(
    4,
    Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]),
  );
  const target = toWorld(b.min.map((v, i) => (v + b.max[i]) / 2));
  look(target, new THREE.Vector3(0.8, 0.62, 1), size);
}

function look(target, dir, size) {
  controls.target.copy(target);
  camera.position.copy(target).addScaledVector(dir.normalize(), size * 1.55);
  camera.zoom = 1;
  syncOrtho(size * 1.15);
  camera.updateProjectionMatrix();
}

function syncOrtho(height) {
  const aspect = view.clientWidth / Math.max(1, view.clientHeight);
  const h = height ?? ortho.top - ortho.bottom;
  ortho.top = h / 2;
  ortho.bottom = -h / 2;
  ortho.left = (-h / 2) * aspect;
  ortho.right = (h / 2) * aspect;
  ortho.updateProjectionMatrix();
}

function setOrtho(on) {
  const from = camera;
  const to = on ? ortho : perspective;
  if (from === to) return;
  to.position.copy(from.position);
  to.quaternion.copy(from.quaternion);
  const d = from.position.distanceTo(controls.target);
  if (on) {
    ortho.zoom = 1;
    syncOrtho(2 * d * Math.tan(THREE.MathUtils.degToRad(perspective.fov / 2)));
  } else {
    const h = (ortho.top - ortho.bottom) / ortho.zoom;
    const dist =
      h / (2 * Math.tan(THREE.MathUtils.degToRad(perspective.fov / 2)));
    to.position
      .copy(controls.target)
      .addScaledVector(from.getWorldDirection(new THREE.Vector3()), -dist);
  }
  camera = to;
  controls.object = to;
  to.updateProjectionMatrix();
  $("ortho").checked = on;
}

// The kept side of a section is below `pos` along the axis (above, flipped).
function applySection() {
  const on = section.axis !== "off";
  const planes = on ? [clipPlane] : [];
  for (const m of [rodMat, tieMat, anchorMat, gapLines.material]) {
    m.clippingPlanes = planes;
    m.needsUpdate = true;
  }
  $("section-controls").hidden = !on;
  sectionPlane.visible = on;
  if (!on) return;
  const ax = AXIS[section.axis];
  const s = section.flip ? -1 : 1;
  const n = [0, 0, 0];
  n[ax] = -s;
  clipPlane
    .set(new THREE.Vector3(...n), s * section.pos)
    .applyMatrix4(world.matrixWorld);
  const b = modelBox();
  const ext = b.min.map((v, i) => b.max[i] - v + 1.5);
  const mid = b.min.map((v, i) => (v + b.max[i]) / 2);
  mid[ax] = section.pos;
  sectionPlane.position.set(...mid);
  sectionPlane.rotation.set(0, 0, 0);
  if (ax === 0) sectionPlane.rotation.y = Math.PI / 2;
  if (ax === 1) sectionPlane.rotation.x = Math.PI / 2;
  const [u, v] = [0, 1, 2].filter((i) => i !== ax);
  sectionPlane.scale.set(
    ax === 0 ? ext[2] : ext[u],
    ax === 0 ? ext[1] : ext[v],
    1,
  );
  $("section-v").textContent = `${section.pos.toFixed(2)} m`;
}

function sectionRange(axis) {
  const b = modelBox();
  const ax = AXIS[axis];
  return [axis === "z" ? 0 : b.min[ax] - 0.5, b.max[ax] + 0.5];
}

function setSectionAxis(axis) {
  section.axis = axis;
  for (const b of $("section-axis").children)
    b.classList.toggle("on", b.dataset.v === axis);
  if (axis !== "off") {
    const [lo, hi] = sectionRange(axis);
    const input = $("section-pos");
    input.min = lo.toFixed(2);
    input.max = hi.toFixed(2);
    section.pos = axis === "z" ? Math.min(hi, 1.2) : (lo + hi) / 2;
    input.value = section.pos;
  }
  applySection();
}

function lookAtSection() {
  if (section.axis === "off") return;
  const ax = AXIS[section.axis];
  const b = modelBox();
  const mid = b.min.map((v, i) => (v + b.max[i]) / 2);
  mid[ax] = section.pos;
  const dir = [0, 0, 0];
  dir[ax] = section.flip ? -1 : 1;
  if (ax === 2) dir[1] = -0.001;
  const size = Math.max(4, Math.hypot(...b.min.map((v, i) => b.max[i] - v)));
  setOrtho(true);
  const d = toWorld(dir).sub(toWorld([0, 0, 0]));
  look(toWorld(mid), d, size);
}

function resize() {
  const w = view.clientWidth;
  const h = view.clientHeight;
  renderer.setSize(w, h);
  perspective.aspect = w / h;
  perspective.updateProjectionMatrix();
  syncOrtho();
}
addEventListener("resize", resize);
resize();

// Physics runs on a timer so it keeps relaxing (and saving) while the page is
// offscreen and animation frames are paused.
function physics() {
  setTimeout(physics, 16);
  if (!settled && sim.N) {
    const t0 = performance.now();
    while (performance.now() - t0 < 9) {
      if (step(sim, 20) < SETTLED) {
        settled = true;
        break;
      }
    }
  } else settled = true;
  if (settled && performance.now() - lastWrite > 1200) {
    lastWrite = performance.now();
    writeBack();
  }
}

let frameNo = 0;
function tick() {
  requestAnimationFrame(tick);
  draw();
  if (frameNo++ % 6 === 0) updateStats();
  controls.update();
  sectionPlane.children[0].visible = camera !== ortho;
  placeMeasure();
  renderer.render(scene, camera);
}

// ---------- picking ----------
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const proj = new THREE.Vector3();

function kept(x, y, z) {
  if (section.axis === "off") return true;
  const v = [x, y, z][AXIS[section.axis]] - section.pos;
  return section.flip ? v >= 0 : v <= 0;
}

function pick(e, wantJoints = false) {
  const box = renderer.domElement.getBoundingClientRect();
  const mx = e.clientX - box.left;
  const my = e.clientY - box.top;
  const toScreen = (x, y, z) => {
    proj.set(x, y, z).applyMatrix4(world.matrixWorld).project(camera);
    return [
      ((proj.x + 1) / 2) * box.width,
      ((1 - proj.y) / 2) * box.height,
      proj.z < 1 && kept(x, y, z),
    ];
  };
  const { X, seg, jt, N } = sim;
  if (wantJoints) {
    let best = null;
    for (let j = 0, k = 0; j < jt.length; j += 4, k++) {
      const a = 3 * jt[j];
      const b = 3 * jt[j + 1];
      const p = [
        (X[a] + X[b]) / 2,
        (X[a + 1] + X[b + 1]) / 2,
        (X[a + 2] + X[b + 2]) / 2,
      ];
      const [sx, sy, ok] = toScreen(...p);
      const d = Math.hypot(sx - mx, sy - my);
      if (ok && d < 9 && (!best || d < best.d))
        best = { d, id: sim.jointIds[k], p };
    }
    if (best) return { kind: "joint", id: best.id, p: best.p };
  }
  const sx = new Float32Array(N);
  const sy = new Float32Array(N);
  const ok = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const s = toScreen(X[3 * i], X[3 * i + 1], X[3 * i + 2]);
    sx[i] = s[0];
    sy[i] = s[1];
    ok[i] = s[2] ? 1 : 0;
  }
  let best = null;
  for (let s = 0; s < seg.length; s += 4) {
    const a = seg[s];
    const b = seg[s + 1];
    if (!ok[a] || !ok[b]) continue;
    const dx = sx[b] - sx[a];
    const dy = sy[b] - sy[a];
    const l2 = dx * dx + dy * dy || 1;
    const t = Math.max(
      0,
      Math.min(1, ((mx - sx[a]) * dx + (my - sy[a]) * dy) / l2),
    );
    const d = Math.hypot(sx[a] + t * dx - mx, sy[a] + t * dy - my);
    if (d < 12 && (!best || d < best.d)) best = { d, node: t < 0.5 ? a : b };
  }
  if (best) {
    const rod = sim.rods[sim.nodeRod[best.node]];
    const i = best.node - sim.index.get(rod.id).off;
    const p = [X[3 * best.node], X[3 * best.node + 1], X[3 * best.node + 2]];
    return { kind: "rod", rod: rod.id, i, p, spec: { rod: rod.id, i } };
  }
  ndc.set((mx / box.width) * 2 - 1, -(my / box.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hit = raycaster.intersectObject(ground)[0];
  if (!hit) return null;
  const local = world.worldToLocal(hit.point.clone());
  const snap = (v) => (e.altKey ? v : Math.round(v * 4) / 4);
  const p = [snap(local.x), snap(local.y), 0];
  return { kind: "ground", p, spec: p };
}

function cameraForward() {
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  const m = world
    .worldToLocal(dir.add(camera.position))
    .sub(world.worldToLocal(camera.position.clone()));
  return [m.x, m.y, 0];
}
const cameraSide = () => {
  const [x, y] = cameraForward();
  return [-y, x, 0];
};

function rodSide(target) {
  const rod = model.rods.get(target.rod);
  const n = rod.pts.length;
  const a = rod.pts[Math.max(0, target.i - 1)];
  const b = rod.pts[Math.min(n - 1, target.i + 1)];
  const s = [b[0] - a[0], b[1] - a[1], 0];
  return Math.hypot(s[0], s[1]) > 0.05 ? s : cameraSide();
}

// ---------- previews ----------
// Every placing tool runs its real edit on a scratch copy of the model (with
// the live node positions), so the preview is exactly what a click will add.
function liveModel() {
  const m = readModel(store.state);
  for (const [id, r] of m.rods)
    if (sim.index.get(id)?.n === r.pts.length)
      m.rods.set(id, { ...r, pts: rodPoints(sim, id) });
  return m;
}

function tryEdit(fn) {
  const m = liveModel();
  const before = new Set(m.rods.keys());
  const jointsBefore = m.joints.length;
  const stage = beginStage(m);
  try {
    fn(m, stage);
  } catch (e) {
    return { error: e.message, rods: [], ties: [] };
  }
  const rods = [...m.rods.values()].filter((r) => !before.has(r.id));
  const ties = m.joints
    .slice(jointsBefore)
    .map((j) => [m.rods.get(j.a).pts[j.ia], m.rods.get(j.b).pts[j.ib]]);
  return { rods, ties };
}

const fmt = (v) => `${v.toFixed(2)} m`;

function rodsPreview(made, at, extra = "") {
  if (made.error) return { lines: [], status: "bad", label: made.error, at };
  if (!made.rods.length)
    return { lines: [], status: "bad", label: "Nothing to add here", at };
  const max = model.material.max_rod_m;
  const lens = made.rods.map((r) => r.L);
  const longest = Math.max(...lens);
  const shortest = Math.min(...lens);
  const lines = made.rods.map((r) => (r.closed ? [...r.pts, r.pts[0]] : r.pts));
  for (const [a, b] of made.ties) lines.push([a, b]);
  let label =
    made.rods.length === 1
      ? `${fmt(longest)} rod`
      : `${made.rods.length} rods · ${shortest === longest ? fmt(longest) : `${shortest.toFixed(2)}–${fmt(longest)}`}`;
  const first = made.rods[0];
  label += ` · ${first.profile ?? "rod"}${first.bundle > 1 ? ` ×${first.bundle}` : ""}`;
  label += extra;
  let status = "ok";
  if (longest > max) {
    status = "warn";
    label += ` · over ${max} m stock`;
  }
  const top = made.rods
    .flatMap((r) => r.pts)
    .reduce((a, p) => (p[2] > a[2] ? p : a), at);
  return { lines, status, label, at: top };
}

const archLength = (a, b) =>
  opts.arch.mode === "ratio"
    ? Math.round(dist(a, b) * opts.arch.ratio * 20) / 20
    : opts.arch.length;

let first = null;
function computePreview(target) {
  const t = opts.tool;
  if (!target) return first ? { lines: [], status: "ok" } : null;
  const at = target.p;
  if (t === "preset") {
    if (target.kind !== "ground")
      return { lines: [], status: "bad", label: "Frames go on the ground", at };
    return rodsPreview(
      tryEdit((m, s) => addPreset(m, { ...opts.preset, centre: at }, s)),
      at,
    );
  }
  if (t === "loop") {
    const side = target.kind === "rod" ? rodSide(target) : cameraSide();
    return rodsPreview(
      tryEdit((m, s) =>
        addLoop(
          m,
          {
            at: target.spec,
            length: opts.loop.length,
            ...rodSpec(),
            tilt: opts.loop.tilt,
            side,
          },
          s,
        ),
      ),
      at,
    );
  }
  if (t === "hoop") {
    const r = opts.hoop.length / (2 * Math.PI);
    const made = tryEdit((m, s) => {
      const h = addHoop(
        m,
        {
          centre: [at[0], at[1], at[2] + r],
          length: opts.hoop.length,
          ...rodSpec(),
          normal: cameraForward(),
        },
        s,
      );
      if (opts.hoop.attach > 0)
        autoJoin(m, [h.id], { radius: opts.hoop.attach }, s);
    });
    const p = rodsPreview(
      made,
      at,
      made.ties.length ? ` · ${made.ties.length} ties` : "",
    );
    if (p.status === "ok" && !made.ties.length) {
      p.status = "warn";
      p.label += " · nothing to catch on, it will fall";
    }
    return p;
  }
  if (t === "arch") {
    if (!first) return null;
    const span = dist(first.p, at);
    const L = archLength(first.p, at);
    if (span < 0.3)
      return { lines: [], status: "bad", label: "Pick a different point", at };
    if (L <= span * 1.001)
      return {
        lines: [[first.p, at]],
        status: "bad",
        label: `${fmt(L)} rod can't span ${fmt(span)}`,
        at,
      };
    return rodsPreview(
      tryEdit((m, s) =>
        addArch(
          m,
          {
            a: first.spec,
            b: target.spec,
            length: L,
            socket: opts.arch.socket,
            ...rodSpec(),
          },
          s,
        ),
      ),
      at,
      ` · span ${fmt(span)}`,
    );
  }
  if (t === "joint") {
    if (!first)
      return target.kind === "rod"
        ? null
        : { lines: [], status: "bad", label: "Pick a point on a rod", at };
    const d = dist(first.p, at);
    if (target.kind !== "rod")
      return {
        lines: [[first.p, at]],
        status: "bad",
        label: "Lash to a point on a rod",
        at,
      };
    if (target.rod === first.rod && target.i === first.i)
      return { lines: [], status: "bad", label: "Pick a different point", at };
    const status = d > 1.2 ? "warn" : "ok";
    return {
      lines: [[first.p, at]],
      status,
      label: `${fmt(d)} apart${d > 1.2 ? " · big pull" : ""}`,
      at,
    };
  }
  if (t === "weave") {
    if (!first)
      return target.kind === "rod"
        ? null
        : { lines: [], status: "bad", label: "Pick a rod", at };
    if (target.kind !== "rod" || target.rod === first.rod)
      return {
        lines: [[first.p, at]],
        status: "bad",
        label: "Pick a second, different rod",
        at,
      };
    const w = opts.weave;
    return rodsPreview(
      tryEdit((m, s) =>
        weave(
          m,
          {
            a: first.rod,
            b: target.rod,
            count: w.count,
            slack: w.slack,
            pattern: w.pattern,
            ...rodSpec(),
          },
          s,
        ),
      ),
      at,
    );
  }
  return null;
}

function showPreview(p) {
  preview = p;
  const pos = [];
  for (const line of p?.lines ?? [])
    for (let i = 0; i + 1 < line.length; i++)
      pos.push(...line[i], ...line[i + 1]);
  previewLines.geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(pos, 3),
  );
  previewLines.visible = pos.length > 0;
  previewMat.color.set(STATUS[p?.status ?? "ok"]);
  const el = $("measure");
  el.hidden = !p?.label;
  if (p?.label) {
    el.textContent = p.label;
    el.className = p.status === "ok" ? "" : p.status;
  }
}

function placeMeasure() {
  if (!preview?.label) return;
  proj.copy(toWorld(preview.at)).project(camera);
  const box = renderer.domElement.getBoundingClientRect();
  const el = $("measure");
  el.style.left = `${box.left + ((proj.x + 1) / 2) * box.width}px`;
  el.style.top = `${box.top + ((1 - proj.y) / 2) * box.height}px`;
}

let lastHoverKey = "";
function hover(target, force = false) {
  const t = opts.tool;
  const selecting = t === "orbit" || t === "erase";
  hoverId = null;
  if (selecting)
    hoverId =
      target?.kind === "rod"
        ? target.rod
        : target?.kind === "joint"
          ? target.id
          : null;
  if (t === "weave" && target?.kind === "rod") hoverId = target.rod;
  marker.visible = !!target && !selecting;
  if (target) {
    marker.position.set(...target.p);
    marker.material.color.set(target.kind === "rod" ? 0x2b6cdf : 0x26221d);
  }
  const key = JSON.stringify([t, first?.p, target?.p, target?.rod, opts[t]]);
  if (!force && key === lastHoverKey) return;
  lastHoverKey = key;
  showPreview(selecting ? null : computePreview(target));
}

function deleteSelection() {
  if (!selection.size) return;
  const rods = [...selection].filter((id) => model.rods.has(id));
  const joints = [...selection].filter((id) => !model.rods.has(id));
  selection = new Set();
  run("remove", { rods, joints });
  toast(
    `Removed ${[rods.length && `${rods.length} rod${rods.length > 1 ? "s" : ""}`, joints.length && `${joints.length} lashing${joints.length > 1 ? "s" : ""}`].filter(Boolean).join(" and ")}`,
  );
}

function warnIfLong(result) {
  const long =
    result?.added?.filter(
      (id) => model.rods.get(id)?.L > model.material.max_rod_m,
    ) ?? [];
  if (long.length)
    toast(
      `${long.length} rod${long.length > 1 ? "s are" : " is"} longer than ${model.material.max_rod_m} m stock and need splicing`,
    );
}

function click(target, e) {
  const t = opts.tool;
  if (t === "orbit") {
    const id =
      target?.kind === "rod"
        ? target.rod
        : target?.kind === "joint"
          ? target.id
          : null;
    if (e.shiftKey && id)
      selection.has(id) ? selection.delete(id) : selection.add(id);
    else selection = new Set(id ? [id] : []);
    renderSelection();
    return;
  }
  if (!target) return;
  if (t === "erase") {
    if (target.kind === "rod") run("remove", { rods: [target.rod] });
    else if (target.kind === "joint") run("remove", { joints: [target.id] });
    return;
  }
  if (preview?.status === "bad") return toast(preview.label, true);
  const twoClick = t === "arch" || t === "joint" || t === "weave";
  if (twoClick && !first) {
    first = target;
    firstMarker.position.set(...target.p);
    firstMarker.visible = true;
    setHint();
    return;
  }
  let result;
  if (t === "preset") {
    result = run("add_preset", { ...opts.preset, centre: target.p });
    frameSoon();
  } else if (t === "loop") {
    const side = target.kind === "rod" ? rodSide(target) : cameraSide();
    result = run("add_loop", {
      at: target.spec,
      length: opts.loop.length,
      ...rodSpec(),
      tilt: opts.loop.tilt,
      side,
    });
  } else if (t === "hoop") {
    const r = opts.hoop.length / (2 * Math.PI);
    result = run("add_hoop", {
      centre: [target.p[0], target.p[1], target.p[2] + r],
      length: opts.hoop.length,
      ...rodSpec(),
      normal: cameraForward(),
      attach_radius: opts.hoop.attach,
    });
  } else {
    const a = first;
    clearFirst();
    if (t === "arch")
      result = run("add_arch", {
        a: a.spec,
        b: target.spec,
        length: archLength(a.p, target.p),
        socket: opts.arch.socket,
        ...rodSpec(),
      });
    else if (t === "joint") run("add_joint", { a: a.spec, b: target.spec });
    else if (t === "weave")
      result = run("weave", {
        a: a.rod,
        b: target.rod,
        count: opts.weave.count,
        slack: opts.weave.slack,
        pattern: opts.weave.pattern,
        ...rodSpec(),
      });
  }
  warnIfLong(result);
}

function clearFirst() {
  first = null;
  firstMarker.visible = false;
  setHint();
}

let downAt = null;
const wantsJoints = () => opts.tool === "orbit" || opts.tool === "erase";
renderer.domElement.addEventListener(
  "pointerdown",
  (e) => (downAt = [e.clientX, e.clientY, e.button]),
);
renderer.domElement.addEventListener("pointermove", (e) => {
  if (e.buttons) return;
  hover(pick(e, wantsJoints()));
});
renderer.domElement.addEventListener("pointerup", (e) => {
  if (
    !downAt ||
    downAt[2] !== 0 ||
    Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4
  )
    return;
  const target = pick(e, wantsJoints());
  hover(target, true);
  click(target, e);
  hover(target, true);
});
renderer.domElement.addEventListener("pointerleave", () => {
  marker.visible = false;
  hoverId = null;
  if (!first) showPreview(null);
  lastHoverKey = "";
});

// ---------- tools + panels ----------
const ICONS = {
  orbit: '<path d="M4 3l9 4-4 1.5L7.5 13z" fill="currentColor"/>',
  preset:
    '<path d="M2 14c0-6 3-11 6-11s6 5 6 11M5 14c0-4 1.4-7 3-7s3 3 3 7" fill="none" stroke="currentColor" stroke-width="1.4"/>',
  arch: '<path d="M2 14C2 6 5 3 8 3s6 3 6 11" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  loop: '<path d="M8 14C3 8 4 2 8 2s5 6 0 12z" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  hoop: '<circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  joint:
    '<path d="M2 4l12 8M2 12l12-8" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="8" r="2" fill="currentColor"/>',
  weave:
    '<path d="M2 3c4 2 8 2 12 0M2 13c4-2 8-2 12 0M4 3.8v8.4M8 4.6v6.8M12 3.8v8.4" fill="none" stroke="currentColor" stroke-width="1.3"/>',
  erase:
    '<path d="M3 4h10M6 4V2.5h4V4M4.5 4l.8 10h5.4l.8-10" fill="none" stroke="currentColor" stroke-width="1.4"/>',
};
const TOOLS = [
  [
    "orbit",
    "Select",
    "Click a rod or lashing to select · Shift adds · Delete removes · drag to orbit",
  ],
  ["preset", "Frame", "Click the ground to place a starter frame"],
  [
    "arch",
    "Arch",
    "Click two points (ground or rods) to spring an arch between them",
  ],
  ["loop", "Loop", "Click the ground or a rod to stand a teardrop loop there"],
  ["hoop", "Hoop", "Click to drop a hoop · it ties itself to rods it touches"],
  ["joint", "Lash", "Click two points on rods to lash them together"],
  ["weave", "Weave", "Click two rods to fill between them with bridging rods"],
  ["erase", "Remove", "Click a rod or lashing to remove it"],
];

const toolBar = $("tools");
TOOLS.forEach(([id, label], k) => {
  const b = document.createElement("button");
  b.dataset.tool = id;
  b.innerHTML = `<svg viewBox="0 0 16 16">${ICONS[id]}</svg><span>${label}</span><kbd>${k + 1}</kbd>`;
  b.onclick = () => setTool(id);
  toolBar.appendChild(b);
});

function setHint() {
  const t = TOOLS.find(([id]) => id === opts.tool);
  let hint = t[2];
  if (first)
    hint =
      opts.tool === "arch"
        ? "Now click where the other end goes · Esc to cancel"
        : opts.tool === "joint"
          ? "Now click the point to lash to · Esc to cancel"
          : "Now click the second rod · Esc to cancel";
  $("hint").textContent = hint + "  ·  Alt: no grid snap";
}

function setTool(id) {
  opts.tool = id;
  clearFirst();
  showPreview(null);
  lastHoverKey = "";
  for (const b of toolBar.children)
    b.classList.toggle("on", b.dataset.tool === id);
  if (id !== "orbit") $("start").hidden = true;
  renderOptions();
}

function field(label, input, note = "") {
  return `<div class="opt"><label>${label} ${note ? `<small>${note}</small>` : ""}</label>${input}</div>`;
}
const num = (k, v, step, min, max) =>
  `<input type="number" data-o="${k}" value="${v}" step="${step}" min="${min}" max="${max}" />`;
const choice = (k, v, list) =>
  `<div class="seg">${list.map(([val, label]) => `<button data-o="${k}" data-v="${val}" class="${val === v ? "on" : ""}">${label}</button>`).join("")}</div>`;

function renderOptions() {
  const t = opts.tool;
  const o = opts[t];
  const titles = {
    orbit: "Select",
    preset: "Starter frame",
    arch: "Arch",
    loop: "Loop",
    hoop: "Hoop",
    joint: "Lash",
    weave: "Weave",
    erase: "Remove",
  };
  let html = `<h3>${titles[t]}</h3>`;
  if (t === "preset")
    html +=
      choice("type", o.type, [
        ["cross", "Cross"],
        ["dome", "Dome"],
        ["tunnel", "Tunnel"],
        ["tripod", "Tripod"],
      ]) +
      field("Span", num("span", o.span, 0.5, 2, 12), "m") +
      field("Rod length", num("length", o.length, 0.5, 2, 16), "m");
  else if (t === "arch")
    html +=
      field(
        "Rod length",
        choice("mode", o.mode, [
          ["fixed", "Fixed"],
          ["ratio", "× span"],
        ]),
      ) +
      (o.mode === "fixed"
        ? field("Length", num("length", o.length, 0.5, 1, 16), "m")
        : field("Rod ÷ span", num("ratio", o.ratio, 0.05, 1.05, 3))) +
      field(
        "Ground socket",
        choice("socket", o.socket, [
          ["tangent", "Natural"],
          ["vertical", "Vertical"],
          ["pin", "Pinned"],
        ]),
      );
  else if (t === "loop")
    html +=
      field("Rod length", num("length", o.length, 0.5, 2, 12), "m") +
      field("Lean", num("tilt", o.tilt, 5, -60, 60), "°");
  else if (t === "hoop")
    html +=
      field("Circumference", num("length", o.length, 0.5, 2, 12), "m") +
      field("Tie radius", num("attach", o.attach, 0.1, 0, 2), "m");
  else if (t === "weave")
    html +=
      field("Rods", num("count", o.count, 1, 1, 40)) +
      field("Slack", num("slack", o.slack, 0.05, 1, 2), "length ÷ gap") +
      field(
        "Pattern",
        choice("pattern", o.pattern, [
          ["parallel", "Parallel"],
          ["diagonal", "Diagonal"],
        ]),
      );
  else if (t === "joint")
    html += `<p class="opt">Lashings are springs: they pull rods together and open a gap when they carry a lot of force (red line).</p>`;
  else if (t === "orbit")
    html += `<p class="opt">Click rods or lashings to select them; Shift-click to add more. Delete or Backspace removes the selection.</p>`;
  else
    html += `<p class="opt">Removing a rod or lashing lets the rest of the structure relax.</p>`;
  if (o?.profile !== undefined)
    html +=
      field("Profile", choice("profile", o.profile, Object.keys(profiles(model.material)).map((k) => [k, k[0].toUpperCase() + k.slice(1)]))) +
      field("Bundle", num("bundle", o.bundle, 1, 1, 12), "rods lashed together");
  html += `<p class="opt"><small>Previews show what a click adds: blue is fine, orange is a warning, red can't be placed.</small></p>`;
  const el = $("options");
  el.innerHTML = html;
  el.querySelectorAll("input[data-o]").forEach((inp) =>
    inp.addEventListener("change", () => {
      o[inp.dataset.o] = Number(inp.value);
    }),
  );
  el.querySelectorAll("button[data-o]").forEach((b) =>
    b.addEventListener("click", () => {
      o[b.dataset.o] = b.dataset.v;
      renderOptions();
    }),
  );
}

function renderSelection() {
  const el = $("selection");
  const ids = [...selection];
  el.hidden = !ids.length;
  if (!ids.length) return;
  const a = analysis ?? analyze(sim);
  let html;
  if (ids.length === 1 && model.rods.has(ids[0])) {
    const rod = model.rods.get(ids[0]);
    const k = sim.rods.findIndex((r) => r.id === rod.id);
    const ties = model.joints.filter(
      (j) => j.a === rod.id || j.b === rod.id,
    ).length;
    const over = rod.L > model.material.max_rod_m;
    html = `<h3>Rod ${rod.id}</h3><dl>
    <dt>Kind</dt><dd>${rod.kind}${rod.closed ? " (closed)" : ""}</dd>
    <dt>Profile</dt><dd>${sim.rodP[k]?.profile ?? "rod"} · ${sim.rodP[k]?.section_mm} mm${sim.rodP[k]?.bundle > 1 ? ` ×${sim.rodP[k].bundle}` : ""}</dd>
    <dt>Length</dt><dd class="${over ? "bad" : ""}">${rod.L.toFixed(2)} m${over ? ` (over ${model.material.max_rod_m} m)` : ""}</dd>
    <dt>Stage</dt><dd>${rod.stage}</dd>
    <dt>Peak stress</dt><dd>${a.rodStress[k]?.toFixed(1) ?? "–"} MPa (${Math.round((a.rodMax[k] ?? 0) * 100)}%)</dd>
    <dt>From loads</dt><dd>${a.rodLoad[k]?.toFixed(1) ?? "–"} MPa</dd>
    <dt>Lashings</dt><dd>${ties}</dd>
    <dt>Anchors</dt><dd>${rod.fix?.length ?? 0}</dd></dl>
    ${profileControls([rod.id])}
    <div class="row"><button id="sel-tie">Tie to neighbours</button><button id="sel-del" class="danger">Delete</button></div>`;
  } else if (ids.length === 1) {
    const j = model.joints.find((x) => x.id === ids[0]);
    const k = sim.jointIds.indexOf(j.id);
    const f = Math.abs(a.jointF[k] ?? 0);
    const cap = model.material.joint_capacity_n;
    html = `<h3>Lashing ${j.id}</h3><dl>
    <dt>Ties</dt><dd>${j.a} ↔ ${j.b}</dd>
    <dt>Force</dt><dd class="${f > cap ? "bad" : ""}">${Math.round(f)} N of ${cap} N</dd>
    <dt>Gap</dt><dd>${((f / (j.k ?? model.material.joint_stiffness)) * 1000).toFixed(0)} mm</dd>
    <dt>Stage</dt><dd>${j.stage}</dd></dl>
    <div class="row"><button id="sel-del" class="danger">Delete</button></div>`;
  } else {
    const rods = ids.filter((id) => model.rods.has(id));
    const total = rods.reduce((s, id) => s + model.rods.get(id).L, 0);
    html = `<h3>${ids.length} selected</h3><dl>
    <dt>Rods</dt><dd>${rods.length} · ${total.toFixed(2)} m</dd>
    <dt>Lashings</dt><dd>${ids.length - rods.length}</dd></dl>
    ${rods.length ? profileControls(rods) : ""}
    <div class="row"><button id="sel-clear">Deselect</button><button id="sel-del" class="danger">Delete</button></div>`;
  }
  el.innerHTML = html;
  $("sel-del").onclick = deleteSelection;
  const rodIds = ids.filter((id) => model.rods.has(id));
  el.querySelectorAll("[data-sp]").forEach((b) =>
    b.addEventListener("click", () => run("set_profile", { rods: rodIds, profile: b.dataset.sp })),
  );
  if ($("sel-bundle"))
    $("sel-bundle").addEventListener("change", (e) =>
      run("set_profile", { rods: rodIds, bundle: Math.max(1, Number(e.target.value) || 1) }),
    );
  if ($("sel-clear"))
    $("sel-clear").onclick = () => ((selection = new Set()), renderSelection());
  if ($("sel-tie"))
    $("sel-tie").onclick = () => {
      const r = run("auto_join", { rods: ids, radius: 0.6 });
      if (r) toast("Tied to nearby rods");
    };
}

function profileControls(ids) {
  const rods = ids.map((id) => model.rods.get(id));
  const cur = new Set(rods.map((r) => r.profile ?? "rod"));
  const bundles = new Set(rods.map((r) => r.bundle ?? 1));
  const one = (set) => (set.size === 1 ? [...set][0] : null);
  const buttons = Object.keys(profiles(model.material))
    .map((k) => `<button data-sp="${k}" class="${one(cur) === k ? "on" : ""}">${k[0].toUpperCase() + k.slice(1)}</button>`)
    .join("");
  return `<div class="seg">${buttons}</div>
    <div class="row"><label style="flex:1">Bundle <small>rods lashed together</small></label><input id="sel-bundle" type="number" min="1" max="12" step="1" value="${one(bundles) ?? ""}" placeholder="mixed" /></div>`;
}

function renderLegend() {
  const el = $("legend");
  const ramp = (upTo, scale, note) => {
    const g = STRESS_STOPS.filter(([t]) => t <= upTo)
      .map(([t, c]) => `${c} ${(t / upTo) * 100}%`)
      .join(",");
    const tick = (u) => `<span>${Math.round((u * 100) / scale)}%</span>`;
    el.innerHTML = `<div class="bar" style="background:linear-gradient(90deg,${g})"></div><div class="ticks">${tick(0)}${tick(upTo / 3)}${tick((2 * upTo) / 3)}${tick(upTo)}</div><p class="note">${note}</p>`;
  };
  if (opts.colorMode === "stress")
    ramp(3, 1, "Total stress as a share of each profile's strength.");
  else if (opts.colorMode === "load")
    ramp(
      1,
      LOAD_SCALE,
      "Stress added by loads since each rod was placed (excluding the bending that formed it), as a share of strength.",
    );
  else if (opts.colorMode === "stage") {
    el.innerHTML = `<div class="bar" style="background:linear-gradient(90deg,hsl(216,45%,55%),hsl(108,45%,55%),hsl(18,45%,55%))"></div><div class="ticks"><span>first</span><span>latest</span></div>`;
  } else
    el.innerHTML = Object.entries(profiles(model.material))
      .map(([k, p]) => `<div class="ticks"><span><i class="swatch" style="background:${profileColor(k, new THREE.Color()).getStyle()}"></i>${p.label}</span><span>${p.section_mm} mm</span></div>`)
      .join("");
}

// ---------- cut list ----------
function renderCutSummary() {
  const c = cutList(model);
  $("cut-summary").innerHTML = c.rods
    ? `<b>${c.rods} rods</b> · ${Object.values(c.by_profile).map((p) => `${p.total_m.toFixed(0)} m ${p.section_mm} mm`).join(" + ")} · ${c.stock_pieces} pieces of ${c.stock_max_m} m stock${c.over_max.length ? ` · <span class="bad">${c.over_max.length} need splicing</span>` : ""}`
    : "No rods yet.";
}

function cutCsv(c) {
  const rows = [["length_m", "qty", "kind", "rods", "over_max"]];
  for (const r of c.rows)
    rows.push([
      r.length_m.toFixed(2),
      r.count,
      r.kinds.join(" "),
      r.rods.join(" "),
      r.over_max ? "yes" : "",
    ]);
  return rows.map((r) => r.join(",")).join("\n");
}

function renderCutList() {
  const c = cutList(model);
  const rows = c.rows
    .map(
      (r) =>
        `<tr class="${r.over_max ? "over" : ""}"><td><i class="swatch" style="background:${profileColor(r.profile, new THREE.Color()).getStyle()}"></i>${r.profile} <small>${r.section_mm} mm</small></td><td class="num">${r.length_m.toFixed(2)}</td><td class="num">${r.count}</td><td>${r.kinds.join(", ")}</td><td>${r.rods.join(" ")}</td></tr>`,
    )
    .join("");
  const per = Object.values(c.by_profile)
    .map((p) => `<div><b>${p.total_m.toFixed(1)} m</b><span>${p.rods} × ${p.label} (${p.section_mm} mm)</span></div>`)
    .join("");
  $("cut-body").innerHTML = `<div class="totals">
      <div><b>${c.rods}</b><span>rods to cut (${c.members} members)</span></div>
      <div><b>${c.total_m.toFixed(1)} m</b><span>total length</span></div>
      <div><b>${c.stock_pieces}</b><span>pieces of ${c.stock_max_m} m stock</span></div>
      ${per}
      <div><b>${c.lashings}</b><span>lashings</span></div>
      <div><b>${c.ground_sockets}</b><span>ground sockets</span></div>
      <div><b>${c.over_max.length}</b><span>over max, need splicing</span></div>
    </div>
    <table><thead><tr><th>Profile</th><th class="num">Cut (m)</th><th class="num">Qty</th><th>Kind</th><th>Rods</th></tr></thead><tbody>${rows || `<tr><td colspan="5">No rods yet.</td></tr>`}</tbody></table>
    <p>Lengths are rest lengths rounded up to 5 cm; bundles count every rod in them; hoops include ${model.material.lap_m} m of lap. Set max rod and lap under Lashings &amp; stock.</p>`;
}

$("cut-open").onclick = () => {
  renderCutList();
  $("cutlist").hidden = false;
};
$("cut-close").onclick = () => ($("cutlist").hidden = true);
$("cutlist").addEventListener("click", (e) => {
  if (e.target.id === "cutlist") $("cutlist").hidden = true;
});
$("cut-copy").onclick = async () => {
  try {
    await navigator.clipboard.writeText(cutCsv(cutList(model)));
    toast("Cut list copied as CSV");
  } catch {
    toast("Clipboard is blocked here · use Download", true);
  }
};
$("cut-download").onclick = () => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(
    new Blob([cutCsv(cutList(model))], { type: "text/csv" }),
  );
  a.download = "basketry-cut-list.csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

// ---------- iterations ----------
function thumbnail() {
  const src = renderer.domElement;
  const c = document.createElement("canvas");
  c.width = 192;
  c.height = 120;
  const scale = Math.max(c.width / src.width, c.height / src.height);
  const w = src.width * scale;
  const h = src.height * scale;
  try {
    renderer.render(scene, camera);
    c.getContext("2d").drawImage(src, (c.width - w) / 2, (c.height - h) / 2, w, h);
    return c.toDataURL("image/webp", 0.7);
  } catch {
    return undefined;
  }
}

const escapeHtml = (t) => String(t).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);

let iterationsKey = "";
function renderIterations(state) {
  const list = state.iterations ?? [];
  const key = JSON.stringify(list);
  if (key === iterationsKey) return;
  iterationsKey = key;
  const el = $("iter-list");
  if (!list.length) {
    el.innerHTML = `<li class="empty">Save the design to compare iterations later.</li>`;
    return;
  }
  el.innerHTML = [...list]
    .reverse()
    .map((it) => {
      const thumb = state[`iter.${it.id}`]?.thumbnail;
      const when = new Date(it.at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
      return `<li data-id="${it.id}">
        ${thumb ? `<img src="${thumb}" alt="" />` : `<span class="ph"></span>`}
        <div><div class="name" title="${escapeHtml(it.note ?? it.name)}">${escapeHtml(it.name)}</div>
        <div class="meta">${it.rods} rods · ${Math.round(it.total_length_m)} m · ${Math.round(it.max_utilization * 100)}% · ${when}</div></div>
        <div class="acts"><button data-act="load">Load</button><button data-act="del" aria-label="Delete">✕</button></div>
      </li>`;
    })
    .join("");
}

$("iter-save").onclick = () => {
  if (!model.rods.size) return toast("Nothing to save yet");
  writeBack();
  const input = $("iter-name");
  const r = run("save_iteration", { name: input.value.trim(), thumbnail: thumbnail() });
  if (r) {
    input.value = "";
    toast(`Saved "${r.name}"`);
  }
};
$("iter-name").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("iter-save").click();
});
$("iter-list").addEventListener("click", (e) => {
  const id = e.target.closest("li")?.dataset.id;
  const act = e.target.dataset?.act ?? (id ? "load" : null);
  if (!act || !id) return;
  const it = (store.state.iterations ?? []).find((x) => x.id === id);
  if (act === "load") {
    selection = new Set();
    if (run("load_iteration", { id })) {
      toast(`Loaded "${it?.name ?? id}"`);
      frameSoon();
    }
  } else if (act === "del" && confirm(`Delete "${it?.name ?? id}"?`)) run("delete_iteration", { id });
});

$("design-export").onclick = () => {
  writeBack();
  const file = { format: "basketry", version: 1, saved: new Date().toISOString(), design: snapshotDesign(store.state) };
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(file)], { type: "application/json" }));
  a.download = `basketry-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
$("design-import").onclick = () => $("design-file").click();
$("design-file").addEventListener("change", async (e) => {
  const f = e.target.files?.[0];
  e.target.value = "";
  if (!f) return;
  try {
    const file = JSON.parse(await f.text());
    const design = file.design ?? file;
    if (!Object.keys(design).some((k) => k.startsWith("rods."))) throw new Error("not a Basketry design file");
    selection = new Set();
    store.apply(loadDesignOps(store.state, design));
    toast(`Loaded ${f.name}`);
    frameSoon();
  } catch (err) {
    toast(`Couldn't load ${f.name}: ${err.message}`, true);
  }
});

// ---------- panel wiring ----------
$("color-mode").addEventListener("click", (e) => {
  const v = e.target.dataset?.v;
  if (!v) return;
  opts.colorMode = v;
  for (const b of $("color-mode").children)
    b.classList.toggle("on", b.dataset.v === v);
  renderLegend();
});
$("thick").addEventListener("input", (e) => {
  opts.thickness = Number(e.target.value);
  $("thick-v").textContent = `×${opts.thickness}`;
});
$("show-ties").addEventListener(
  "change",
  (e) => (opts.showTies = e.target.checked),
);
$("ortho").addEventListener("change", (e) => setOrtho(e.target.checked));
$("panel-toggle").addEventListener("click", () => {
  const open = document.body.classList.toggle("panel-open");
  $("panel-toggle").setAttribute("aria-expanded", String(open));
});
$("section-axis").addEventListener("click", (e) => {
  const v = e.target.dataset?.v;
  if (v) setSectionAxis(v);
});
$("section-pos").addEventListener("input", (e) => {
  section.pos = Number(e.target.value);
  applySection();
});
$("section-flip").onclick = () => {
  section.flip = !section.flip;
  applySection();
};
$("section-look").onclick = lookAtSection;

function syncMaterialInputs() {
  document.querySelectorAll("input[data-m]").forEach((inp) => {
    if (document.activeElement !== inp) inp.value = model.material[inp.dataset.m];
  });
  const profs = profiles(model.material);
  if (!profs[matProfile]) matProfile = "rod";
  $("mat-profile").innerHTML = Object.keys(profs)
    .map((k) => `<button data-v="${k}" class="${k === matProfile ? "on" : ""}">${k[0].toUpperCase() + k.slice(1)}</button>`)
    .join("");
  const p = profs[matProfile];
  $("mat-profile-label").textContent = p.label;
  document.querySelectorAll("input[data-p]").forEach((inp) => {
    if (document.activeElement !== inp) inp.value = p[inp.dataset.p];
  });
  $("mat-steam").checked = !!p.steam_bent;
  $("mat-steam").disabled = matProfile === "rod";
  $("bundle-action").value = model.material.bundle_action ?? 0.5;
  $("bundle-v").textContent = `${model.material.bundle_action ?? 0.5}`;
  $("grav").value = model.material.gravity ?? 1;
  $("grav-v").textContent = `×${model.material.gravity ?? 1}`;
  renderLegend();
}
$("mat-profile").addEventListener("click", (e) => {
  if (!e.target.dataset?.v) return;
  matProfile = e.target.dataset.v;
  syncMaterialInputs();
});
document.querySelectorAll("input[data-m]").forEach((inp) =>
  inp.addEventListener("change", () => run("set_material", { [inp.dataset.m]: Number(inp.value) })),
);
document.querySelectorAll("input[data-p]").forEach((inp) =>
  inp.addEventListener("change", () =>
    run("set_material", { profile: matProfile, [inp.dataset.p]: Number(inp.value) }),
  ),
);
$("mat-steam").addEventListener("change", (e) =>
  run("set_material", { profile: matProfile, steam_bent: e.target.checked }),
);
$("bundle-action").addEventListener("change", (e) => run("set_material", { bundle_action: Number(e.target.value) }));
$("bundle-action").addEventListener("input", (e) => ($("bundle-v").textContent = e.target.value));
$("grav").addEventListener("change", (e) =>
  run("set_material", { gravity: Number(e.target.value) }),
);
$("grav").addEventListener(
  "input",
  (e) => ($("grav-v").textContent = `×${e.target.value}`),
);

$("drop").onclick = () => {
  if (!model.rods.size)
    return toast("Place a frame first: hoops need something to catch on");
  const r = run("scatter_hoops", {
    count: Number($("drop-count").value) || 8,
    seed: Math.floor(Math.random() * 1e9),
  });
  if (r)
    toast(
      r.added.length
        ? `${r.added.length} hoops caught`
        : "No hoops caught · try a denser frame",
    );
};
function undo() {
  const prev = history.pop();
  if (!prev) return toast("Nothing to undo");
  selection = new Set();
  store.apply(loadDesignOps(store.state, prev));
}
$("undo").onclick = undo;
$("clear").onclick = () => {
  if (confirm("Remove every rod?")) run("clear", {});
};
$("start").addEventListener("click", (e) => {
  const type = e.target.dataset?.preset;
  if (!type) return;
  run("add_preset", {
    type,
    span: type === "tunnel" ? 4 : 5,
    length: 8,
    centre: [0, 0, 0],
  });
  frameSoon();
});

function frameSoon() {
  setTimeout(frame, 50);
  framed = true;
}

addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
  if ((e.ctrlKey || e.metaKey) && e.key === "z") {
    undo();
    e.preventDefault();
  } else if (e.key === "Delete" || e.key === "Backspace") {
    deleteSelection();
    e.preventDefault();
  } else if (e.key === "Escape") {
    if (!$("cutlist").hidden) $("cutlist").hidden = true;
    else if (first) (clearFirst(), showPreview(null));
    else ((selection = new Set()), renderSelection());
  } else if (e.key === "f") frame();
  else if (/^[1-8]$/.test(e.key)) setTool(TOOLS[Number(e.key) - 1][0]);
});

let toastTimer = 0;
function toast(text, error = false) {
  const el = $("toast");
  el.textContent = text;
  el.className = `show${error ? " error" : ""}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = ""), 2600);
}

setTool("orbit");
frame();
fitShadow();
physics();
tick();

// Handy for driving the page from the console or a test.
window.basketry = {
  run,
  store,
  get sim() {
    return sim;
  },
  get preview() {
    return preview;
  },
  get selection() {
    return selection;
  },
  frame,
  setSectionAxis,
  lookAtSection,
  setOrtho,
  screenOf(p) {
    proj.copy(toWorld(p)).project(camera);
    const box = renderer.domElement.getBoundingClientRect();
    return [box.left + ((proj.x + 1) / 2) * box.width, box.top + ((1 - proj.y) / 2) * box.height];
  },
};
