import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type { Gate, GatePosition, GateVisualState } from "@/lib/portal-model";
import { createGateOrbit } from "./gate-orbit";

export type GateScene = { update: (position: GateVisualState, target: GatePosition | null) => void; setVisible: (visible: boolean) => void; dispose: () => void };

/**
 * 3D gate model shown on the dashboard and gate panels.
 *
 * Look (24 Oct 2026, Jarrod: "regenerate the image to make it 3D but with the same
 * look"): it matches the flat artwork in public/gates/*-blue.webp, which shows
 * first while the model loads: a navy studio backdrop with a blue glow behind the
 * gate (CSS, see .gate-model.is-rendered in control-room.css), galvanised steel
 * leaves, dark brushed posts, a black card reader with a blue light and a glossy
 * dark floor that fades out at the edges. Unlike the flat artwork the leaves (or
 * the boom) really move, and the status beacon flashes.
 *
 * Truthfulness: the leaf previews a labelled command; the beacon colour uses the
 * verified position only. Geometry and travel duration are illustrative, not a
 * sensor feed.
 */
export function createGateScene(host: HTMLElement, kind: Gate["kind"], initial: GateVisualState, initialTarget: GatePosition | null, onLost: () => void, interactive = false): GateScene {
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0); // transparent: the CSS backdrop shows through
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  const scene = new THREE.Scene();
  const boom = kind === "boom";
  const sliding = kind === "sliding";
  const camera = new THREE.PerspectiveCamera(boom ? 30 : sliding ? 32 : 28, 1, .1, 40);
  if (boom) { camera.position.set(-.9, 1.6, 5.7); camera.lookAt(.3, .85, 0); }
  else if (sliding) { camera.position.set(1.2, 1.52, 7.2); camera.lookAt(0.4, 1.05, 0); }
  else { camera.position.set(1.3, 1.35, kind === "double-swing" ? 5.2 : 5.1); camera.lookAt(0, 1.05, 0); }

  // Reflections: a neutral studio, tinted blue by the lights below.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const environment = pmrem.fromScene(room, .04);
  scene.environment = environment.texture;
  scene.environmentIntensity = .55;
  room.dispose();
  pmrem.dispose();

  // Lighting like the artwork: a cool key from the front, a strong blue light
  // behind the gate (the halo), and a soft navy fill.
  const key = new THREE.DirectionalLight(0xe8f1ff, 2.6);
  key.position.set(-2.5, 5, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -3.5; key.shadow.camera.right = 3.5;
  key.shadow.camera.top = 4; key.shadow.camera.bottom = -3;
  key.shadow.bias = -.0008;
  key.shadow.radius = 4;
  scene.add(key, new THREE.HemisphereLight(0x5f8fe0, 0x050c1c, .75));
  const rim = new THREE.DirectionalLight(0x2f74ff, 5.5);
  rim.position.set(.5, 2.5, -4); scene.add(rim);
  const halo = new THREE.PointLight(0x2a6cff, 9, 6, 1.6);
  halo.position.set(0, 1.4, -1.1); scene.add(halo);
  const sheen = new THREE.PointLight(0x4f8dff, 1.2, 4, 2);
  sheen.position.set(0, .35, 1.6); scene.add(sheen);

  // Materials, matched to the artwork.
  const galvanised = new THREE.MeshStandardMaterial({ color: 0x939ca5, metalness: .85, roughness: .44 });
  const galvanisedEdge = new THREE.MeshStandardMaterial({ color: 0xaab3bb, metalness: .85, roughness: .36 });
  const post = new THREE.MeshStandardMaterial({ color: 0x5d6873, metalness: .88, roughness: .3 });
  const postCap = new THREE.MeshStandardMaterial({ color: 0x8a95a0, metalness: .9, roughness: .25 });
  const cabinet = new THREE.MeshStandardMaterial({ color: 0x3a424b, metalness: .85, roughness: .32 });
  const black = new THREE.MeshStandardMaterial({ color: 0x07090c, metalness: .3, roughness: .18 });
  const readerGlow = new THREE.MeshStandardMaterial({ color: 0x2f7bff, emissive: 0x1f6bff, emissiveIntensity: 1.1, roughness: .3 });
  const motorBody = new THREE.MeshStandardMaterial({ color: 0x1d2228, metalness: .55, roughness: .42 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xe6ebf0, metalness: 1, roughness: .12 });
  const beacon = new THREE.MeshStandardMaterial({ color: 0xf5bd64, emissive: 0xf5bd64, emissiveIntensity: .75, roughness: .2 });
  const statusMaterials = [beacon];
  const model = new THREE.Group(); scene.add(model);
  const box = (parent: THREE.Object3D, w: number, h: number, d: number, x: number, y: number, z: number, material: THREE.Material, radius = .007) => {
    const mesh = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, Math.min(radius, w / 3, h / 3, d / 3)), material);
    mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
  };
  const cylinder = (parent: THREE.Object3D, radius: number, height: number, x: number, y: number, z: number, material: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 20), material);
    mesh.position.set(x, y, z); mesh.castShadow = true; parent.add(mesh); return mesh;
  };
  /** A card reader on a post: black glossy body with a blue light, as in the artwork. */
  const reader = (x: number, y: number, z: number) => {
    box(model, .155, .27, .028, x, y, z - .004, readerGlow, .025);
    box(model, .115, .225, .036, x, y, z + .006, black, .02);
  };
  /** A square base plate with four bolts. */
  const basePlate = (x: number, size: number) => {
    box(model, size, .03, size, x, .015, 0, postCap, .006);
    for (const dx of [-1, 1]) for (const dz of [-1, 1]) cylinder(model, .016, .03, x + dx * size * .38, .04, dz * size * .38, chrome);
  };

  // Glossy dark floor that fades into the backdrop at its edges.
  const fade = document.createElement("canvas"); fade.width = fade.height = 256;
  const fadeContext = fade.getContext("2d");
  if (fadeContext) {
    const gradient = fadeContext.createRadialGradient(128, 128, 10, 128, 128, 128);
    gradient.addColorStop(0, "#ffffff"); gradient.addColorStop(.55, "#bbbbbb"); gradient.addColorStop(1, "#000000");
    fadeContext.fillStyle = gradient; fadeContext.fillRect(0, 0, 256, 256);
  }
  const fadeTexture = new THREE.CanvasTexture(fade);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(9, 6), new THREE.MeshStandardMaterial({ color: 0x010409, metalness: .45, roughness: .42, transparent: true, alphaMap: fadeTexture, envMapIntensity: .18 }));
  floor.rotation.x = -Math.PI / 2; floor.position.set(boom ? .3 : sliding ? 0.2 : 0, 0, .4); floor.receiveShadow = true; scene.add(floor);

  const leaves: THREE.Group[] = [];
  let slideTravel = 0;
  if (boom) {
    // Cabinet on the left, boom running right to a rest post (as in boom-blue.webp).
    const cx = -1.05;
    box(model, .62, .05, .58, cx, .025, 0, postCap, .01);
    box(model, .46, 1.28, .44, cx, .69, 0, cabinet, .03);
    box(model, .47, .03, .45, cx, .77, 0, post, .004); // panel seam
    box(model, .48, .07, .46, cx, 1.36, 0, post, .03);
    box(model, .40, .05, .38, cx, 1.41, 0, postCap, .03);
    reader(cx - .12, .98, .225);
    box(model, .05, .05, .025, cx + .12, 1.25, .225, beacon, .01);
    const hub = cylinder(model, .14, .12, cx + .25, 1.06, .17, cabinet); hub.rotation.x = Math.PI / 2;
    const hubCap = cylinder(model, .09, .03, cx + .25, 1.06, .24, post); hubCap.rotation.x = Math.PI / 2;
    const arm = new THREE.Group(); arm.position.set(cx + .25, 1.06, .2); model.add(arm); leaves.push(arm);
    box(arm, .26, .14, .12, .13, 0, 0, cabinet, .02);
    const white = new THREE.MeshStandardMaterial({ color: 0xf1f3f5, metalness: .15, roughness: .35 });
    const red = new THREE.MeshStandardMaterial({ color: 0xd61f2c, roughness: .4 });
    box(arm, 2.45, .085, .075, 1.42, 0, 0, white, .012);
    for (const at of [.75, 1.55, 2.3]) box(arm, .42, .088, .078, at, 0, 0, red, .004);
    const restX = cx + .25 + 2.5;
    box(model, .22, .03, .22, restX, .015, .2, postCap, .006);
    box(model, .08, 1.0, .08, restX, .5, .2, post, .01);
    box(model, .14, .08, .12, restX, 1.01, .2, post, .012);
  } else if (sliding) {
    // One leaf on an overhead track. Opening slides it aside. Travel is a picture, not a sensor.
    const opening = 2.2;
    const left = -opening / 2 - 0.08;
    const right = opening / 2 + 0.08;
    for (const x of [left, right]) {
      box(model, 0.16, 2.05, 0.16, x, 1.05, 0, post, 0.01);
      box(model, 0.18, 0.05, 0.18, x, 2.1, 0, postCap, 0.012);
      basePlate(x, 0.32);
    }
    box(model, opening + 0.55, 0.07, 0.1, 0.2, 1.92, 0, post, 0.01);
    const leafWidth = opening - 0.06;
    slideTravel = leafWidth;
    const slideBase = left + 0.1;
    const leaf = new THREE.Group();
    leaf.position.set(slideBase, 0.16, 0.02);
    leaf.userData.slideBase = slideBase;
    model.add(leaf);
    leaves.push(leaf);
    box(leaf, leafWidth, 0.07, 0.05, leafWidth / 2, 0.08, 0, galvanised);
    box(leaf, leafWidth, 0.07, 0.05, leafWidth / 2, 1.62, 0, galvanised);
    box(leaf, 0.06, 1.58, 0.05, 0.04, 0.85, 0, galvanised);
    box(leaf, 0.06, 1.58, 0.05, leafWidth - 0.04, 0.85, 0, galvanised);
    for (let i = 0; i < 7; i++) box(leaf, leafWidth - 0.12, 0.07, 0.028, leafWidth / 2, 0.28 + i * 0.18, 0.02, galvanisedEdge, 0.004);
    for (const x of [0.2, leafWidth - 0.2]) cylinder(leaf, 0.045, 0.04, x, 1.78, 0, chrome);
    box(model, 0.38, 0.32, 0.24, right + 0.02, 0.34, 0.18, motorBody, 0.03);
    reader(right, 1.42, 0.12);
    cylinder(model, 0.05, 0.04, right, 2.145, 0, black);
    cylinder(model, 0.044, 0.07, right, 2.2, 0, beacon);
  } else {
    const width = kind === "double-swing" ? 2.15 : 1.42;
    for (const x of [-width / 2 - .1, width / 2 + .1]) {
      box(model, .17, 2.05, .17, x, 1.055, 0, post, .01);
      box(model, .19, .05, .19, x, 2.1, 0, postCap, .012);
      basePlate(x, .34);
    }
    const count = kind === "double-swing" ? 2 : 1;
    const leafWidth = (width - .04) / count;
    for (let side = 0; side < count; side++) {
      const leaf = new THREE.Group();
      leaf.position.set(side === 0 ? -width / 2 : width / 2, .2, 0);
      if (side === 1) leaf.scale.x = -1;
      model.add(leaf); leaves.push(leaf);
      // Galvanised frame and pickets.
      box(leaf, .07, 1.68, .07, .035, .84, 0, galvanised);
      box(leaf, .07, 1.68, .07, leafWidth - .035, .84, 0, galvanised);
      box(leaf, leafWidth, .08, .07, leafWidth / 2, .04, 0, galvanised);
      box(leaf, leafWidth, .08, .07, leafWidth / 2, 1.64, 0, galvanised);
      const bars = count === 1 ? 9 : 9;
      for (let i = 1; i <= bars; i++) box(leaf, .032, 1.52, .032, .07 + i * (leafWidth - .14) / (bars + 1), .84, 0, galvanisedEdge, .004);
      // Hinges on the post side.
      for (const y of [.22, 1.42]) {
        cylinder(model, .03, .2, leaf.position.x - (side ? -.03 : .03), y + .2, .06, chrome);
        box(model, .09, .12, .012, leaf.position.x - (side ? -.065 : .065), y + .2, .087, galvanisedEdge, .004);
      }
      if (count === 2) {
        // Swing-gate motor near the bottom hinge, as in double-swing-blue.webp. It is
        // part of the leaf group so it swings with the leaf.
        box(leaf, .36, .1, .1, .24, .32, .1, motorBody, .03);
        const rod = cylinder(leaf, .018, .18, .5, .32, .1, chrome); rod.rotation.z = Math.PI / 2;
      }
      if (count === 2 && side === 1) {
        // Centre latch and drop bolt, on the right leaf so they swing with it.
        box(leaf, .16, .14, .03, leafWidth - .03, .95, .06, galvanisedEdge, .006);
        cylinder(leaf, .016, .62, leafWidth - .06, .3, .06, chrome);
      }
      if (count === 1) {
        // Latch handle on the leaf; the keeper stays on the post.
        box(leaf, .12, .05, .05, leafWidth - .08, .9, .07, galvanisedEdge, .01);
      }
    }
    if (count === 1) box(model, .05, .16, .03, width / 2 + .02, 1.1, .06, galvanisedEdge, .006);
    // Card reader on the right post (as in the artwork) and the status beacon on top.
    const readerPost = width / 2 + .1;
    reader(readerPost, 1.45, .1);
    cylinder(model, .05, .04, readerPost, 2.145, 0, black);
    cylinder(model, .044, .07, readerPost, 2.2, 0, beacon);
  }

  let position = initial;
  let visible = true;
  let disposed = false;
  let dirtyFrames = 2;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  // The boom lifts. A swing leaf rotates. A sliding leaf travels sideways on X.
  const openTravel = sliding ? slideTravel : boom ? Math.PI / 2.1 : -Math.PI / 2.5;
  const angleFor = (target: GatePosition) => target === "open" ? openTravel : 0;
  // Unknown swing/boom art sits halfway. A half-open slider would look open, so it stays across the driveway.
  let angle = sliding
    ? (initial === "open" ? openTravel : 0)
    : (initial === "open" || initial === "closed" ? angleFor(initial) : openTravel / 2);
  let targetAngle = initialTarget ? angleFor(initialTarget) : angle;
  let lastFrame = 0;
  const orient = () => leaves.forEach((leaf, index) => {
    if (sliding) leaf.position.x = Number(leaf.userData.slideBase) + angle;
    else if (boom) leaf.rotation.z = angle;
    else leaf.rotation.y = angle * (index ? -1 : 1);
  });
  const update = (next: GateVisualState, target: GatePosition | null) => {
    position = next;
    targetAngle = target ? angleFor(target) : angle;
    const colour = next === "open" ? 0x00ed78 : next === "closed" ? 0xff343e : next === "inactive" ? 0x566477 : 0xffb020;
    statusMaterials.forEach((material) => { material.color.setHex(colour); material.emissive.setHex(colour); material.emissiveIntensity = next === "inactive" ? 0 : .8; });
    model.visible = true; dirtyFrames = 3;
    wake();
  };
  const frame = (time: number) => {
    if (!visible || document.hidden || disposed) { renderer.setAnimationLoop(null); return; }
    const target = targetAngle;
    const elapsed = lastFrame ? Math.min((time - lastFrame) / 1000, .1) : 1 / 60;
    lastFrame = time;
    angle = reduced.matches ? target : THREE.MathUtils.damp(angle, target, 3.2, elapsed);
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
  const orbit = interactive ? createGateOrbit(camera, renderer.domElement, () => { dirtyFrames = 3; wake(); }, sliding ? { x: 0.4, y: 1.02, z: 0 } : undefined) : null;
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
  host.appendChild(renderer.domElement); update(initial, initialTarget); resize();
  return {
    update,
    setVisible(value) { visible = value; dirtyFrames = 2; if (value) wake(); else renderer.setAnimationLoop(null); },
    dispose() {
      disposed = true; observer.disconnect(); renderer.setAnimationLoop(null);
      orbit?.dispose();
      document.removeEventListener("visibilitychange", visibility);
      renderer.domElement.removeEventListener("webglcontextlost", lost);
      const materials = new Set<THREE.Material>();
      scene.traverse((object) => { if (object instanceof THREE.Mesh) { object.geometry.dispose(); (Array.isArray(object.material) ? object.material : [object.material]).forEach((material) => materials.add(material)); } });
      materials.forEach((material) => material.dispose()); fadeTexture.dispose(); environment.dispose(); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
    },
  };
}
