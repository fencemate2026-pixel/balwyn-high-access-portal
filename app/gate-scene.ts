import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type { Gate, GateVisualState } from "@/lib/portal-model";

export type GateScene = { update: (position: GateVisualState) => void; setVisible: (visible: boolean) => void; dispose: () => void };

/** Decorative hardware model. Only verified position changes move the leaf.
 * Geometry is illustrative, not an installation drawing or sensor feed. */
export function createGateScene(host: HTMLElement, kind: Gate["kind"], initial: GateVisualState, onLost: () => void): GateScene {
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x0b131e, 0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.3;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, .1, 40);
  camera.position.set(3.5, 2.6, 5.2);
  camera.lookAt(0, 1.02, 0);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const environment = pmrem.fromScene(room, .04);
  scene.environment = environment.texture;
  room.dispose();
  pmrem.dispose();
  const key = new THREE.DirectionalLight(0xeaf5ff, 4);
  key.position.set(-2, 5, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -3; key.shadow.camera.right = 3;
  key.shadow.camera.top = 4; key.shadow.camera.bottom = -3;
  key.shadow.bias = -.001;
  scene.add(key, new THREE.HemisphereLight(0xbcdcff, 0x122231, 2.1));
  const rim = new THREE.DirectionalLight(0x55acff, 3);
  rim.position.set(2, 3, -3); scene.add(rim);

  const steel = new THREE.MeshStandardMaterial({ color: 0x8094a8, metalness: .9, roughness: .26 });
  const edge = new THREE.MeshStandardMaterial({ color: 0xc5d0d8, metalness: .9, roughness: .2 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x162331, metalness: .75, roughness: .29 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x080f18, roughness: .65 });
  const lens = new THREE.MeshStandardMaterial({ color: 0x55acff, emissive: 0x168bea, emissiveIntensity: .65, metalness: .4, roughness: .14 });
  const beacon = new THREE.MeshStandardMaterial({ color: 0xf5bd64, emissive: 0xf5bd64, emissiveIntensity: .75, roughness: .2 });
  const statusMaterials = [beacon];
  const model = new THREE.Group(); scene.add(model);
  const box = (parent: THREE.Object3D, w: number, h: number, d: number, x: number, y: number, z: number, material: THREE.Material, radius = .007) => {
    const mesh = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, Math.min(radius, w / 3, h / 3, d / 3)), material);
    mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
  };
  const cylinder = (parent: THREE.Object3D, radius: number, height: number, x: number, y: number, z: number, material: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 16), material);
    mesh.position.set(x, y, z); mesh.castShadow = true; parent.add(mesh); return mesh;
  };
  const pad = box(model, 2.8, .12, 1.28, 0, -.06, 0, dark, .04);
  pad.receiveShadow = true;
  box(model, 2.58, .012, .013, 0, -.01, .647, lens, .002);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(15, 15), new THREE.ShadowMaterial({ opacity: .3 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -.125; floor.receiveShadow = true; scene.add(floor);
  const leaves: THREE.Group[] = [];
  const boom = kind === "boom";
  if (boom) {
    box(model, .42, 1.2, .48, .84, .6, 0, steel, .05);
    box(model, .46, .09, .52, .84, 1.22, 0, dark, .025);
    box(model, .29, .32, .018, .84, .89, .249, dark, .01);
    box(model, .20, .10, .022, .84, .96, .26, lens, .008);
    box(model, .045, .04, .025, .95, .65, .25, beacon);
    const arm = new THREE.Group(); arm.position.set(.84, 1.09, .29); model.add(arm); leaves.push(arm);
    box(arm, 2.0, .09, .085, -.91, 0, 0, edge, .015);
    const stripe = new THREE.MeshStandardMaterial({ color: 0xcd3a47, roughness: .36 });
    for (let i = 0; i < 4; i++) box(arm, .14, .093, .089, -i * .43 - .3, 0, 0, stripe, .006);
    const hub = cylinder(model, .12, .15, .84, 1.09, .34, steel); hub.rotation.x = Math.PI / 2;
  } else {
    const width = kind === "double-swing" ? 2.05 : 1.48;
    for (const x of [-width / 2 - .10, width / 2 + .10]) {
      box(model, .16, 2.18, .18, x, 1.09, 0, steel, .008);
      box(model, .19, .045, .21, x, 2.20, 0, edge, .012);
      box(model, .30, .035, .32, x, .02, 0, steel);
      for (const dx of [-.11, .11]) for (const dz of [-.12, .12]) cylinder(model, .017, .015, x + dx, .045, dz, edge);
    }
    const count = kind === "double-swing" ? 2 : 1;
    const leafWidth = (width - .055) / count;
    for (let side = 0; side < count; side++) {
      const leaf = new THREE.Group();
      leaf.position.set(side === 0 ? -width / 2 : width / 2, .13, 0);
      if (side === 1) leaf.scale.x = -1;
      model.add(leaf); leaves.push(leaf);
      box(leaf, .066, 1.92, .085, .032, .96, 0, steel);
      box(leaf, .066, 1.92, .085, leafWidth - .032, .96, 0, steel);
      box(leaf, leafWidth, .09, .085, leafWidth / 2, .045, 0, steel);
      box(leaf, leafWidth, .09, .085, leafWidth / 2, 1.875, 0, steel);
      const bars = count === 1 ? 8 : 5;
      for (let i = 1; i <= bars; i++) box(leaf, .026, 1.75, .033, .065 + i * (leafWidth - .13) / (bars + 1), .96, 0, edge, .006);
      for (const y of [.30, 1.63]) cylinder(model, .038, .13, leaf.position.x - (side ? -.01 : .01), y, .072, edge);
      box(leaf, .12, .28, .045, leafWidth - .08, 1.1, .069, dark, .014);
      box(leaf, .048, .022, .052, leafWidth - .08, 1.07, .09, edge);
    }
    const post = -width / 2 - .1;
    box(model, .108, .24, .046, post, 1.38, .117, rubber, .012);
    box(model, .074, .14, .014, post, 1.405, .15, lens, .009);
    box(model, .046, .018, .019, post, 1.315, .15, beacon, .004);
    cylinder(model, .048, .045, post, 2.249, 0, rubber);
    cylinder(model, .043, .065, post, 2.301, 0, beacon);
  }
  let position = initial;
  let visible = true;
  let disposed = false;
  let dirtyFrames = 2;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  const angleFor = () => position === "open" ? (boom ? -Math.PI / 2.1 : -Math.PI / 2.5) : 0;
  let angle = angleFor();
  const orient = () => leaves.forEach((leaf, index) => { if (boom) leaf.rotation.z = angle; else leaf.rotation.y = angle * (index ? -1 : 1); });
  const update = (next: GateVisualState) => {
    position = next;
    const colour = next === "open" ? 0x42e8a4 : next === "closed" ? 0xff727f : next === "inactive" ? 0x566477 : 0xf5bd64;
    statusMaterials.forEach((material) => { material.color.setHex(colour); material.emissive.setHex(colour); material.emissiveIntensity = next === "inactive" ? 0 : .8; });
    model.visible = true; dirtyFrames = 3;
    wake();
  };
  const frame = (time: number) => {
    if (!visible || document.hidden || disposed) { renderer.setAnimationLoop(null); return; }
    const target = angleFor();
    angle = reduced.matches ? target : THREE.MathUtils.lerp(angle, target, .075);
    if (Math.abs(target - angle) < .001) angle = target;
    const flashing = position !== "inactive" && !reduced.matches;
    // One gentle pulse per second; only status feedback changes its colour.
    const intensity = flashing ? .25 + 1.75 * ((Math.sin(time * Math.PI * 2 / 1000) + 1) / 2) ** 3 : position === "inactive" ? 0 : .8;
    statusMaterials.forEach((material) => { material.emissiveIntensity = intensity; });
    orient(); renderer.render(scene, camera);
    // Stop offscreen/inactive animation; respect reduced-motion preferences.
    if (!flashing && angle === target && --dirtyFrames <= 0) renderer.setAnimationLoop(null);
  };
  function wake() { if (visible && !document.hidden && !disposed) renderer.setAnimationLoop(frame); }
  const resize = () => {
    const width = host.clientWidth, height = host.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height); camera.aspect = width / height; camera.updateProjectionMatrix(); dirtyFrames = 2; wake();
  };
  const observer = new ResizeObserver(resize); observer.observe(host);
  const visibility = () => { dirtyFrames = 2; wake(); };
  const lost = (event: Event) => { event.preventDefault(); renderer.setAnimationLoop(null); onLost(); };
  renderer.domElement.addEventListener("webglcontextlost", lost);
  document.addEventListener("visibilitychange", visibility);
  host.appendChild(renderer.domElement); update(initial); resize();
  return {
    update,
    setVisible(value) { visible = value; dirtyFrames = 2; if (value) wake(); else renderer.setAnimationLoop(null); },
    dispose() {
      disposed = true; observer.disconnect(); renderer.setAnimationLoop(null);
      document.removeEventListener("visibilitychange", visibility);
      renderer.domElement.removeEventListener("webglcontextlost", lost);
      const materials = new Set<THREE.Material>();
      scene.traverse((object) => { if (object instanceof THREE.Mesh) { object.geometry.dispose(); (Array.isArray(object.material) ? object.material : [object.material]).forEach((material) => materials.add(material)); } });
      materials.forEach((material) => material.dispose()); environment.dispose(); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
    },
  };
}
