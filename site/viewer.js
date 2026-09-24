// three.js viewport: the model on a cutting-mat grid in model units (meters), with selection,
// move/rotate/scale gizmos and draggable shape points.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

// 1, 2, 5 × 10ⁿ: the grid step for a model this big.
export function niceStep(x) {
  const p = 10 ** Math.floor(Math.log10(x)), m = x / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}
const label = m => m >= 1 ? `${+m.toPrecision(3)} m` : m >= 0.01 ? `${+(m * 100).toPrecision(3)} cm` : `${+(m * 1000).toPrecision(3)} mm`;
const SELECT = 0xf2c230, PROBLEM = new THREE.Color(0xd9412b), HANDLE = 0xf2c230, HANDLE_ON = 0xffffff;

function disposeTree(obj) {
  obj.traverse(o => {
    o.geometry?.dispose();
    for (const m of [o.material].flat().filter(Boolean)) {
      for (const v of Object.values(m)) if (v?.isTexture) v.dispose();
      m.dispose();
    }
  });
}

// on: { scale(label), select(name | null), transform(name, { position, rotation, scale }), point(name, index, pos) }
export function createViewer(container, on = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.append(renderer.domElement);

  const scene = new THREE.Scene();
  // Fog in the mat's color fades the grid out at its edges instead of ending it on a hard line.
  scene.fog = new THREE.Fog(0x000000, 1, 2);
  const matColor = () => scene.fog.color.setStyle(getComputedStyle(container).getPropertyValue("--mat").trim() || "#2f5d50");
  matColor();
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", matColor);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 1000);
  const orbit = new OrbitControls(camera, renderer.domElement);
  orbit.enableDamping = true;

  const sun = new THREE.DirectionalLight(0xffffff, 1.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  scene.add(sun, sun.target);

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.ShadowMaterial({ opacity: 0.28 }));
  floor.receiveShadow = true;
  const grid = new THREE.Group();
  scene.add(floor, grid);

  // Gizmo for parts and for points; orbiting pauses while it drags.
  const gizmo = new TransformControls(camera, renderer.domElement);
  gizmo.setSize(0.8);
  scene.add(gizmo.getHelper());
  gizmo.addEventListener("dragging-changed", e => { orbit.enabled = !e.value; if (!e.value) commitDrag(); });
  const outline = new THREE.BoxHelper(undefined, SELECT);
  outline.material.depthTest = false;
  outline.renderOrder = 998;
  outline.visible = false;
  scene.add(outline);

  const loader = new GLTFLoader();
  let model = null, modelName = null, loads = 0, fit = { center: new THREE.Vector3(), radius: 1, span: 1 };
  let nodes = new Map(); // part name → Object3D
  let selected = null, handles = [], activeHandle = -1, mode = "translate", snap = false, step = 0.01;

  // Minor lines every step, major every 5 steps, like a cutting mat. Returns the grid's span.
  function layGrid(box) {
    const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
    const extent = Math.max(size.x, size.z, size.y * 0.5, 1e-3);
    step = niceStep(extent / 8);
    const major = step * 5;
    const span = Math.ceil((extent * 8) / major) * major;
    const cx = Math.round(center.x / major) * major, cz = Math.round(center.z / major) * major;
    for (const c of grid.children) disposeTree(c);
    grid.clear();
    const lines = (divisions, opacity) => {
      const g = new THREE.GridHelper(span, divisions, 0xffffff, 0xffffff);
      g.material.transparent = true;
      g.material.opacity = opacity;
      g.material.depthWrite = false;
      return g;
    };
    grid.add(lines(Math.round(span / step), 0.1), lines(Math.round(span / major), 0.28));
    // Lift the lines a hair above the shadow so they don't flicker into it.
    grid.position.set(cx, box.min.y + span * 1e-4, cz);
    floor.position.set(cx, box.min.y, cz);
    floor.scale.set(span, 1, span);
    on.scale?.(label(step));
    applySnap();
    return span;
  }

  // The grid stays put while a model is edited; it only moves when the model leaves its middle
  // or sinks through the floor.
  function gridHolds(box) {
    const half = fit.span * 0.3, g = floor.position;
    return box.min.x >= g.x - half && box.max.x <= g.x + half && box.min.z >= g.z - half && box.max.z <= g.z + half
      && box.min.y >= g.y - step / 2;
  }

  function frame({ center, radius }) {
    const dist = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.1;
    camera.position.copy(center).add(new THREE.Vector3(0.9, 0.55, 1.4).normalize().multiplyScalar(dist));
    camera.near = dist / 100;
    camera.far = dist * 100;
    camera.updateProjectionMatrix();
    orbit.target.copy(center);
    orbit.minDistance = radius * 0.2;
    orbit.maxDistance = dist * 6;
    orbit.update();
  }

  function light({ center, radius }) {
    sun.position.copy(center).add(new THREE.Vector3(1, 2.5, 1.5).multiplyScalar(radius * 2));
    sun.target.position.copy(center);
    const s = sun.shadow.camera;
    s.left = s.bottom = -radius * 2;
    s.right = s.top = radius * 2;
    s.near = radius * 0.1;
    s.far = radius * 10;
    s.updateProjectionMatrix();
  }

  function applySnap() {
    gizmo.setTranslationSnap(snap ? step : null);
    gizmo.setRotationSnap(snap ? THREE.MathUtils.degToRad(15) : null);
    gizmo.setScaleSnap(snap ? 0.1 : null);
  }

  // ---------- selection, gizmo, points ----------

  function clearHandles() {
    for (const h of handles) { h.removeFromParent(); h.geometry.dispose(); h.material.dispose(); }
    handles = [];
    activeHandle = -1;
  }

  function attach() {
    const obj = selected && nodes.get(selected.name);
    outline.visible = !!obj;
    if (obj) outline.setFromObject(obj);
    clearHandles();
    if (!obj) { gizmo.detach(); return; }
    // Points live in the part's own space; size them in world terms whatever the part's scale.
    const s = obj.getWorldScale(new THREE.Vector3()), r = fit.radius * 0.03;
    for (const [i, h] of (selected.points ?? []).entries()) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: HANDLE, depthTest: false, transparent: true }));
      m.position.fromArray(h.pos);
      m.scale.set(r / Math.abs(s.x), r / Math.abs(s.y), r / Math.abs(s.z));
      m.renderOrder = 999;
      m.userData.index = i;
      obj.add(m);
      handles.push(m);
    }
    const h = handles[selected.point ?? -1];
    if (h) {
      activeHandle = selected.point;
      h.material.color.set(HANDLE_ON);
      gizmo.setMode("translate");
      gizmo.setSpace(selected.points[activeHandle].flat ? "local" : "world");
      gizmo.showZ = !selected.points[activeHandle].flat;
      gizmo.attach(h);
    } else {
      gizmo.setMode(mode);
      gizmo.setSpace("world");
      gizmo.showZ = true;
      gizmo.attach(obj);
    }
  }

  // Part transforms are read back in modelgen's convention: rotation R = Rz·Ry·Rx is three's "ZYX".
  function commitDrag() {
    const obj = gizmo.object;
    if (!obj || !selected) return;
    if (activeHandle >= 0) { on.point?.(selected.name, activeHandle, obj.position.toArray()); return; }
    const e = new THREE.Euler().setFromQuaternion(obj.quaternion, "ZYX");
    on.transform?.(selected.name, { position: obj.position.toArray(), rotation: [e.x, e.y, e.z], scale: obj.scale.toArray() }, mode);
  }

  // A click (not a drag) picks a point, else the nearest part, else clears the selection.
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let down = null;
  renderer.domElement.addEventListener("pointerdown", e => { down = gizmo.axis ? null : [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener("pointerup", e => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
    const rect = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    // Points are small; pick the nearest one within a finger's reach on screen rather than by exact hit.
    let near = null, best = 12;
    for (const hd of handles) {
      const p = hd.getWorldPosition(new THREE.Vector3()).project(camera);
      const d = Math.hypot((p.x - ndc.x) * rect.width / 2, (p.y - ndc.y) * rect.height / 2);
      if (d < best) { best = d; near = hd; }
    }
    if (near) { on.select?.(selected.name, near.userData.index); return; }
    const hit = model && ray.intersectObject(model, true).find(h => h.object.visible);
    let o = hit?.object;
    while (o && !o.userData.part) o = o.parent;
    on.select?.(o ? o.userData.part : null);
  });

  function resize() {
    const { clientWidth: w, clientHeight: h } = container;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(container);
  resize();
  renderer.setAnimationLoop(() => {
    orbit.update();
    if (outline.visible) outline.update();
    // Fog starts just behind the model, wherever the camera is, so only the grid fades.
    const d = camera.position.distanceTo(orbit.target);
    scene.fog.near = d + fit.radius;
    scene.fog.far = d + Math.max(fit.span * 0.45, fit.radius * 2);
    renderer.render(scene, camera);
  });

  return {
    get hasModel() { return model !== null; },
    // Keeps the camera while the same model is being edited; reframes when a different one loads.
    // parts: names of the document's parts; problems: names of parts with errors (tinted red).
    show(bytes, name, { parts = [], problems = [] } = {}) {
      const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      const load = ++loads;
      return new Promise((resolve, reject) => loader.parse(buf, "", gltf => {
        // Parsing is async: a newer model may already be on its way; never let an older one land after it.
        if (load !== loads) { disposeTree(gltf.scene); resolve(); return; }
        gizmo.detach();
        clearHandles();
        if (model) { scene.remove(model); disposeTree(model); }
        model = gltf.scene;
        // Node names straight from the file: three rewrites names like "Top ☀" or "a.b" on load.
        const json = gltf.parser.json, wanted = new Set(parts), root = model.children[0];
        nodes = new Map();
        for (const [obj, ref] of gltf.parser.associations) {
          const n = ref?.nodes !== undefined && obj.isObject3D ? json.nodes[ref.nodes].name : undefined;
          if (n !== undefined && obj !== root && wanted.has(n)) { obj.userData.part = n; nodes.set(n, obj); }
        }
        const bad = new Set(problems);
        model.traverse(o => {
          if (!o.isMesh) return;
          o.castShadow = true;
          let p = o;
          while (p && !p.userData.part) p = p.parent;
          if (p && bad.has(p.userData.part)) for (const m of [o.material].flat()) { m.emissive = PROBLEM; m.emissiveIntensity = 0.7; }
        });
        scene.add(model);
        const box = new THREE.Box3().setFromObject(model), size = box.getSize(new THREE.Vector3());
        const span = name !== modelName || !gridHolds(box) ? layGrid(box) : fit.span;
        fit = { box, center: box.getCenter(new THREE.Vector3()), radius: size.length() / 2 || 1, span };
        light(fit);
        if (name !== modelName) frame(fit);
        modelName = name;
        attach();
        resolve();
      }, reject));
    },
    // sel: { name, points?: [{ pos, flat }], point?: index } or null
    select(sel) { selected = sel; attach(); },
    setMode(m) { mode = m; if (activeHandle < 0) gizmo.setMode(m); },
    setSnap(on) { snap = on; applySnap(); },
    focus() {
      const obj = selected && nodes.get(selected.name);
      if (obj) orbit.target.copy(new THREE.Box3().setFromObject(obj).getCenter(new THREE.Vector3()));
    },
    // Where a ray straight down through the model's middle first meets it: a spot new parts can touch.
    surfacePoint() {
      if (!model) return null;
      const c = fit.box.getCenter(new THREE.Vector3());
      ray.set(new THREE.Vector3(c.x, fit.box.max.y + fit.radius, c.z), new THREE.Vector3(0, -1, 0));
      const hit = ray.intersectObject(model, true).find(x => x.object.isMesh && !handles.includes(x.object));
      return hit ? hit.point.toArray() : null;
    },
    // Model-space bounds, for sizing new parts.
    bounds() { return fit.box ? { min: fit.box.min.toArray(), max: fit.box.max.toArray() } : null; },
    get step() { return step; },
  };
}
