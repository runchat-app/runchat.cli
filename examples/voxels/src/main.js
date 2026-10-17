// Voxel modeller UI. It renders whatever is in the shared state and writes
// clicks straight back to it, so people and agents edit one model.
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { DEFAULT_SIZE, PALETTE, cellKey, parseKey } from "./voxels.js";

const view = document.getElementById("view");
const statusEl = document.getElementById("status");
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  preserveDrawingBuffer: true,
});
renderer.setPixelRatio(devicePixelRatio);
renderer.setClearColor(0xf6f3ee);
view.appendChild(renderer.domElement);

// three is Y up; the model is Z up, so the world group turns Z up into Y up.
const scene = new THREE.Scene();
const world = new THREE.Group();
world.rotation.x = -Math.PI / 2;
scene.add(world);
scene.add(new THREE.HemisphereLight(0xffffff, 0xb8b0a2, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(6, 12, 8);
scene.add(sun);

const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 500);
camera.position.set(9, 8, 11);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1, 0);

const grid = new THREE.GridHelper(40, 80, 0xcfc7b8, 0xe3ddd3);
scene.add(grid);
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(200, 200),
  new THREE.MeshBasicMaterial({ visible: false }),
);
world.add(ground);

let voxels = {};
let size = DEFAULT_SIZE;
let color = PALETTE[0];
let mesh = null;
let cellsByInstance = [];

function rebuild() {
  if (mesh) {
    world.remove(mesh);
    mesh.geometry.dispose();
  }
  const entries = Object.entries(voxels);
  grid.scale.setScalar(size / 0.5);
  const geometry = new THREE.BoxGeometry(size * 0.96, size * 0.96, size * 0.96);
  mesh = new THREE.InstancedMesh(
    geometry,
    new THREE.MeshStandardMaterial({ roughness: 0.85 }),
    Math.max(1, entries.length),
  );
  mesh.count = entries.length;
  const m = new THREE.Matrix4();
  const c = new THREE.Color();
  cellsByInstance = entries.map(([key, hex], i) => {
    const [x, y, z] = parseKey(key);
    m.setPosition((x + 0.5) * size, (y + 0.5) * size, (z + 0.5) * size);
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, c.set(hex));
    return [x, y, z];
  });
  mesh.computeBoundingBox();
  world.add(mesh);
  world.updateMatrixWorld(true);
  statusEl.textContent = `${entries.length} voxels · ${size} m`;
}

let framed = false;
function frame() {
  if (!mesh || mesh.count === 0) return;
  const box = new THREE.Box3().setFromObject(mesh);
  const centre = box.getCenter(new THREE.Vector3());
  const radius = Math.max(2, box.getSize(new THREE.Vector3()).length() * 0.75);
  controls.target.copy(centre);
  camera.position
    .copy(centre)
    .add(
      new THREE.Vector3(1, 0.8, 1.2).normalize().multiplyScalar(radius * 2.2),
    );
  framed = true;
}
document.getElementById("frame").onclick = frame;

runchat.state.subscribe((state) => {
  voxels = state.voxels ?? {};
  size = state.voxel_size ?? DEFAULT_SIZE;
  rebuild();
  if (!framed) frame();
});

const swatches = document.getElementById("swatches");
for (const hex of PALETTE) {
  const b = document.createElement("button");
  b.style.background = hex;
  b.className = hex === color ? "on" : "";
  b.onclick = () => {
    color = hex;
    for (const el of swatches.children) el.className = el === b ? "on" : "";
  };
  swatches.appendChild(b);
}

const ray = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let downAt = null;
renderer.domElement.addEventListener(
  "pointerdown",
  (e) => (downAt = [e.clientX, e.clientY]),
);
renderer.domElement.addEventListener("pointerup", (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4)
    return;
  const box = renderer.domElement.getBoundingClientRect();
  pointer.set(
    ((e.clientX - box.left) / box.width) * 2 - 1,
    -((e.clientY - box.top) / box.height) * 2 + 1,
  );
  ray.setFromCamera(pointer, camera);
  const hit = ray.intersectObjects(mesh ? [mesh, ground] : [ground])[0];
  if (!hit) return;
  if (hit.object === mesh && hit.instanceId !== undefined) {
    const cell = cellsByInstance[hit.instanceId];
    if (e.shiftKey) {
      runchat.state.apply([{ op: "set", key: "voxels", value: without(cell) }]);
      return;
    }
    const n = hit.face.normal;
    add([
      cell[0] + Math.round(n.x),
      cell[1] + Math.round(n.y),
      cell[2] + Math.round(n.z),
    ]);
  } else if (!e.shiftKey) {
    const p = world.worldToLocal(hit.point.clone());
    add([Math.floor(p.x / size), Math.floor(p.y / size), 0]);
  }
});

function add(cell) {
  runchat.state.apply([
    { op: "set", key: "voxels", value: { ...voxels, [cellKey(cell)]: color } },
  ]);
}
function without(cell) {
  const next = { ...voxels };
  delete next[cellKey(cell)];
  return next;
}

function resize() {
  const { clientWidth: w, clientHeight: h } = view;
  renderer.setSize(w, h);
  camera.aspect = w / Math.max(1, h);
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(view);
resize();
renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});
