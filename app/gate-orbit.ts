import type { PerspectiveCamera } from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

/** Camera interaction only: this module has no gate-command or network access. */
export function createGateOrbit(camera: PerspectiveCamera, canvas: HTMLCanvasElement, onChange: () => void) {
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 1.02, 0);
  controls.cursor.copy(controls.target);
  controls.minDistance = 3.5;
  controls.maxDistance = 12;
  controls.maxTargetRadius = 2.5;
  controls.minPolarAngle = .12;
  controls.maxPolarAngle = Math.PI / 2 - .03;
  controls.enableDamping = false;
  controls.rotateSpeed = .8;
  controls.zoomSpeed = .8;
  controls.panSpeed = .7;
  controls.update();
  controls.saveState();
  controls.addEventListener("change", onChange);
  controls.listenToKeyEvents(canvas);
  const reset = () => { controls.reset(); onChange(); };
  const keyReset = (event: KeyboardEvent) => {
    if (event.key.toLowerCase() === "r" && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); reset(); }
  };
  canvas.addEventListener("dblclick", reset);
  canvas.addEventListener("keydown", keyReset);
  canvas.tabIndex = 0;
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", "Interactive 3D gate model. Drag to rotate, wheel to zoom, right-drag or arrow keys to pan. Double-click or press R to reset.");
  return {
    reset,
    dispose() {
      canvas.removeEventListener("dblclick", reset);
      canvas.removeEventListener("keydown", keyReset);
      controls.removeEventListener("change", onChange);
      controls.dispose();
    },
  };
}
