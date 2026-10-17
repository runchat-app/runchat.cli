// A small viewer for app UIs. It shows the app's own part of the shared
// scene (its group), optionally with the rest of the scene as context, or a
// model built in the page from mesh parts (a specimen). Z up.
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

export function createViewer(container, { group, onPick } = {}) {
  THREE.Object3D.DEFAULT_UP.set(0, 0, 1);
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xcfdce6);
  scene.fog = new THREE.Fog(0xcfdce6, 140, 420);
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;
  scene.add(new THREE.HemisphereLight(0xdfeaf5, 0x6b6450, 0.9));
  const sun = new THREE.DirectionalLight(0xfff1dc, 3.2);
  sun.position.set(40, -30, 60);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  Object.assign(sun.shadow.camera, {
    left: -60,
    right: 60,
    top: 60,
    bottom: -60,
    far: 300,
  });
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 2000);
  camera.position.set(60, -70, 55);
  const controls = new OrbitControls(camera, renderer.domElement);
  const grid = new THREE.GridHelper(200, 40, 0xc8c6bf, 0xdcdad3);
  grid.rotation.x = Math.PI / 2;
  scene.add(grid);
  const root = new THREE.Group();
  scene.add(root);

  const loader = new GLTFLoader();
  const models = new Map();
  const load = (url) => {
    if (!models.has(url))
      models.set(
        url,
        loader.loadAsync(url).then((g) => g.scene),
      );
    return models.get(url);
  };
  let framed = false;
  let version = 0;

  function primitive(o) {
    const mat = new THREE.MeshStandardMaterial({
      color: o.color ?? "#e8e4dc",
      roughness: 0.85,
    });
    if (o.kind === "box" && o.size)
      return new THREE.Mesh(
        new THREE.BoxGeometry(...o.size).translate(0, 0, o.size[2] / 2),
        mat,
      );
    if (o.kind === "cylinder")
      return new THREE.Mesh(
        new THREE.CylinderGeometry(o.radius, o.radius, o.height, 24)
          .rotateX(Math.PI / 2)
          .translate(0, 0, o.height / 2),
        mat,
      );
    if (o.kind === "sphere")
      return new THREE.Mesh(
        new THREE.SphereGeometry(o.radius, 24, 12).translate(0, 0, o.radius),
        mat,
      );
    if (o.kind === "extrusion" && o.profile) {
      return new THREE.Mesh(
        new THREE.ExtrudeGeometry(
          new THREE.Shape(o.profile.map(([x, y]) => new THREE.Vector2(x, y))),
          { depth: o.height, bevelEnabled: false },
        ),
        mat,
      );
    }
    return null;
  }

  let latest = [];
  let only = null;
  let context = false;

  /** Objects in a group and everything under it. */
  function within(objects, groupId) {
    const keep = new Set([groupId]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const o of objects) {
        if (!keep.has(o.id) && o.parent && keep.has(o.parent)) {
          keep.add(o.id);
          grew = true;
        }
      }
    }
    return objects.filter((o) => keep.has(o.id));
  }

  function setObjects(objects) {
    latest = objects;
    if (mode !== "scene") return;
    return draw(only && !context ? within(objects, only) : objects);
  }

  /** Show only this group (null for everything); context adds the rest. */
  function setFilter(next) {
    if ("only" in next) only = next.only;
    if ("context" in next) context = next.context;
    framed = false;
    mode = "scene";
    controls.autoRotate = false;
    setObjects(latest);
  }

  let mode = "scene";
  async function draw(objects) {
    const mine = version + 1;
    version = mine;
    const nodes = new Map();
    const pending = [];
    for (const o of objects) {
      if (o.hidden) continue;
      const node = new THREE.Group();
      node.position.set(...o.position);
      node.rotation.set(...o.rotation.map((d) => (d * Math.PI) / 180));
      node.scale.set(...o.scale);
      node.userData.id = o.id;
      nodes.set(o.id, node);
      if (o.kind === "mesh" && o.url) {
        pending.push(
          load(o.url).then(
            (model) => {
              const upright = new THREE.Group();
              upright.rotation.x = Math.PI / 2;
              const copy = model.clone();
              copy.traverse((m) => {
                if (m.isMesh) {
                  m.castShadow = m.receiveShadow = true;
                }
              });
              upright.add(copy);
              node.add(upright);
            },
            () => {},
          ),
        );
      } else {
        const mesh = primitive(o);
        if (mesh) {
          mesh.castShadow = mesh.receiveShadow = true;
          node.add(mesh);
        }
      }
    }
    for (const o of objects) {
      const node = nodes.get(o.id);
      if (node) (nodes.get(o.parent) ?? root).add(node);
    }
    await Promise.all(pending);
    if (mine !== version) return;
    root.clear();
    for (const [id, node] of nodes) {
      const o = objects.find((x) => x.id === id);
      if (!o.parent || !nodes.has(o.parent)) root.add(node);
    }
    if (!framed) frame();
  }

  const textureLoader = new THREE.TextureLoader();
  const textureCache = new Map();
  async function texture(ref, srgb) {
    if (!ref) return null;
    const url = await ref;
    if (!url) return null;
    if (!textureCache.has(url)) {
      textureCache.set(
        url,
        textureLoader.loadAsync(url).then((t) => {
          t.flipY = false;
          t.wrapS = t.wrapT = THREE.RepeatWrapping;
          t.anisotropy = 8;
          if (srgb) t.colorSpace = THREE.SRGBColorSpace;
          return t;
        }),
      );
    }
    return textureCache.get(url);
  }

  /**
   * Show a model built from mesh parts (as a command would return them)
   * instead of the scene, e.g. a plant specimen. resolve(ref) turns a
   * "texture:<id>" reference into a URL (or a promise of one).
   */
  async function showParts(parts, resolve, { spin = true } = {}) {
    mode = "parts";
    const mine = version + 1;
    version = mine;
    const group = new THREE.Group();
    for (const p of parts) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(p.vertices, 3));
      g.setIndex(p.faces);
      if (p.uvs) g.setAttribute("uv", new THREE.Float32BufferAttribute(p.uvs, 2));
      if (p.colors) {
        const c = new THREE.Color();
        g.setAttribute("color", new THREE.Float32BufferAttribute(p.colors.flatMap((h) => c.set(h).toArray()), 3));
      }
      g.computeVertexNormals();
      const m = p.material ?? {};
      const ref = (v) => (typeof v === "string" && v.startsWith("texture:") ? resolve(v.slice(8)) : v);
      const material = new THREE.MeshStandardMaterial({
        color: m.color ?? "#e8e4dc",
        roughness: m.roughness ?? 0.85,
        metalness: m.metalness ?? 0,
        vertexColors: !!p.colors,
        side: m.doubleSided === false ? THREE.FrontSide : THREE.DoubleSide,
        transparent: (m.opacity ?? 1) < 1,
        opacity: m.opacity ?? 1,
        alphaTest: m.alphaMode === "MASK" ? (m.alphaCutoff ?? 0.5) : 0,
      });
      const [map, normal] = await Promise.all([texture(ref(m.map), true), texture(ref(m.normalMap), false)]);
      if (map) material.map = map;
      if (normal) material.normalMap = normal;
      material.needsUpdate = true;
      const mesh = new THREE.Mesh(g, material);
      mesh.castShadow = mesh.receiveShadow = true;
      group.add(mesh);
    }
    if (mine !== version) return;
    root.clear();
    root.add(group);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshStandardMaterial({ color: "#8a8a6a", roughness: 1 }));
    const box = new THREE.Box3().setFromObject(group);
    const size = box.getSize(new THREE.Vector3());
    ground.scale.setScalar(Math.max(size.x, size.y) * 0.8 + 0.2);
    ground.receiveShadow = true;
    root.add(ground);
    controls.autoRotate = spin;
    controls.autoRotateSpeed = 1.2;
    framed = false;
    frame(group, 0.4);
  }

  function frame(target = root, minRadius = 5) {
    const box = new THREE.Box3().setFromObject(target);
    if (box.isEmpty()) return;
    const c = box.getCenter(new THREE.Vector3());
    const r = Math.max(minRadius, box.getSize(new THREE.Vector3()).length() / 2);
    controls.target.copy(c);
    camera.position
      .copy(c)
      .add(
        new THREE.Vector3(0.8, -1, 0.75).normalize().multiplyScalar(r * 2.4),
      );
    framed = true;
  }
  function frameGroup() {
    const target = root.getObjectByProperty("userData", undefined);
    let found = null;
    root.traverse((n) => {
      if (n.userData.id === group) found = n;
    });
    frame(found ?? target ?? root);
  }

  const ray = new THREE.Raycaster();
  let down = null;
  renderer.domElement.addEventListener(
    "pointerdown",
    (e) => (down = [e.clientX, e.clientY]),
  );
  renderer.domElement.addEventListener("pointerup", (e) => {
    if (
      !onPick ||
      !down ||
      Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4
    )
      return;
    const b = renderer.domElement.getBoundingClientRect();
    ray.setFromCamera(
      new THREE.Vector2(
        ((e.clientX - b.left) / b.width) * 2 - 1,
        -((e.clientY - b.top) / b.height) * 2 + 1,
      ),
      camera,
    );
    const hit = ray.intersectObject(root, true)[0];
    const point = hit
      ? hit.point
      : ray.ray.intersectPlane(
          new THREE.Plane(new THREE.Vector3(0, 0, 1), 0),
          new THREE.Vector3(),
        );
    if (point)
      onPick(
        [+point.x.toFixed(2), +point.y.toFixed(2), +point.z.toFixed(2)],
        e,
      );
  });

  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    renderer.setSize(w, h);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(container);
  resize();
  renderer.setAnimationLoop(() => {
    controls.update();
    renderer.render(scene, camera);
  });
  return { setObjects, setFilter, showParts, frame, frameGroup };
}
