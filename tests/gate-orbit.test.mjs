import assert from "node:assert/strict";
import test from "node:test";
import { PerspectiveCamera, Vector3 } from "three";
import { createGateOrbit } from "../app/gate-orbit.ts";

// Real OrbitControls, with a minimal event surface; no browser, WebGL or gate API.
class CanvasEvents extends EventTarget {
  style = {};
  clientWidth = 600;
  clientHeight = 400;
  root = new EventTarget();
  attributes = {};
  getRootNode() { return this.root; }
  setPointerCapture() {}
  releasePointerCapture() {}
  setAttribute(name, value) { this.attributes[name] = value; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 600, height: 400 }; }
  emit(type, fields = {}) {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { pointerType: "mouse", pointerId: 1, button: 0, clientX: 100, clientY: 100, pageX: 100, pageY: 100, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...fields });
    this.dispatchEvent(event);
  }
  drag(button, x) {
    this.emit("pointerdown", { button });
    this.emit("pointermove", { button, clientX: x, pageX: x });
    this.emit("pointerup", { button, clientX: x, pageX: x });
  }
}
function setup(t) {
  const camera = new PerspectiveCamera(32, 1.5, .1, 40);
  camera.position.set(3.5, 2.6, 5.2);
  const canvas = new CanvasEvents();
  let changes = 0;
  const orbit = createGateOrbit(camera, canvas, () => changes++);
  t.after(() => orbit.dispose());
  return { camera, canvas, orbit, changes: () => changes };
}

test("left-drag rotates the actual camera through a full horizontal revolution", t => {
  const { camera, canvas, changes } = setup(t);
  const start = camera.position.clone();
  canvas.drag(0, 350);
  assert.ok(camera.position.distanceTo(start) > 5, "half-turn must move the camera to the other side");
  canvas.drag(0, 350);
  assert.ok(camera.position.distanceTo(start) < 1e-6, "two half-turns complete a full revolution");
  assert.ok(changes() >= 2, "input must request a new rendered frame");
});

test("wheel zooms, right-drag pans, and double-click restores the original camera", t => {
  const { camera, canvas } = setup(t);
  const start = camera.position.clone();
  const distance = camera.position.distanceTo(new Vector3(0, 1.02, 0));
  canvas.emit("wheel", { deltaY: -100, deltaMode: 0 });
  assert.ok(camera.position.distanceTo(new Vector3(0, 1.02, 0)) < distance);
  const zoomed = camera.position.clone();
  canvas.drag(2, 200);
  assert.ok(camera.position.distanceTo(zoomed) > .1);
  canvas.emit("dblclick");
  assert.ok(camera.position.distanceTo(start) < 1e-6);
});

test("keyboard reset and cleanup prevent stale controls after a view is removed", t => {
  const { camera, canvas, orbit } = setup(t);
  const start = camera.position.clone();
  canvas.drag(0, 220);
  canvas.emit("keydown", { key: "r", code: "KeyR" });
  assert.ok(camera.position.distanceTo(start) < 1e-6);
  orbit.dispose();
  canvas.drag(0, 320);
  canvas.emit("wheel", { deltaY: -100, deltaMode: 0 });
  assert.ok(camera.position.distanceTo(start) < 1e-6);
});
