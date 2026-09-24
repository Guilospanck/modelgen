// three.js preview: the model standing on a cutting-mat grid in model units (meters).
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

// 1, 2, 5 × 10ⁿ: the grid step for a model this big.
function niceStep(x) {
  const p = 10 ** Math.floor(Math.log10(x)), m = x / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}
const label = m => m >= 1 ? `${+m.toPrecision(3)} m` : m >= 0.01 ? `${+(m * 100).toPrecision(3)} cm` : `${+(m * 1000).toPrecision(3)} mm`;

function disposeTree(obj) {
  obj.traverse(o => {
    o.geometry?.dispose();
    for (const m of [o.material].flat().filter(Boolean)) {
      for (const v of Object.values(m)) if (v?.isTexture) v.dispose();
      m.dispose();
    }
  });
}

export function createViewer(container, { onScale } = {}) {
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
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  const sun = new THREE.DirectionalLight(0xffffff, 1.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  scene.add(sun, sun.target);

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.ShadowMaterial({ opacity: 0.28 }));
  floor.receiveShadow = true;
  const grid = new THREE.Group();
  scene.add(floor, grid);

  const loader = new GLTFLoader();
  let model = null, modelName = null, fit = { radius: 1, span: 1 };

  // Minor lines every step, major every 5 steps, like a cutting mat.
  function layGrid(box) {
    const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
    const extent = Math.max(size.x, size.z, size.y * 0.5, 1e-3);
    const step = niceStep(extent / 8), major = step * 5;
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
    onScale?.(label(step));
    return { center, radius: size.length() / 2 || 1, span };
  }

  function frame({ center, radius }) {
    const dist = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.1;
    camera.position.copy(center).add(new THREE.Vector3(0.9, 0.55, 1.4).normalize().multiplyScalar(dist));
    camera.near = dist / 100;
    camera.far = dist * 100;
    camera.updateProjectionMatrix();
    controls.target.copy(center);
    controls.minDistance = radius * 0.2;
    controls.maxDistance = dist * 6;
    controls.update();
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
    controls.update();
    // Fog starts just behind the model, wherever the camera is, so only the grid fades.
    const d = camera.position.distanceTo(controls.target);
    scene.fog.near = d + fit.radius;
    scene.fog.far = d + Math.max(fit.span * 0.45, fit.radius * 2);
    renderer.render(scene, camera);
  });

  return {
    get hasModel() { return model !== null; },
    // Keeps the camera while the same model is being edited; reframes when a different one loads.
    show(bytes, name) {
      const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      return new Promise((resolve, reject) => loader.parse(buf, "", gltf => {
        if (model) { scene.remove(model); disposeTree(model); }
        model = gltf.scene;
        model.traverse(o => { if (o.isMesh) o.castShadow = true; });
        scene.add(model);
        fit = layGrid(new THREE.Box3().setFromObject(model));
        light(fit);
        if (name !== modelName) frame(fit);
        modelName = name;
        resolve();
      }, reject));
    },
  };
}
