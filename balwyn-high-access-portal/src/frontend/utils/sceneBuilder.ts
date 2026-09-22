import * as THREE from "three";
import { OrbitControls } from "three-stdlib";
import type { EmergencyState, GateStatus, WeatherSnapshot } from "../../shared/types";
import { weatherParticles } from "./weatherSystem";

interface SceneController {
  updateGates: (gates: GateStatus[]) => void;
  updateWeather: (weather: WeatherSnapshot) => void;
  updateEmergency: (emergency: EmergencyState) => void;
  destroy: () => void;
}

export function buildCampusScene(
  mountNode: HTMLDivElement,
  initialGates: GateStatus[],
  initialWeather: WeatherSnapshot,
  initialEmergency: EmergencyState,
): SceneController {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#08131f");
  scene.fog = new THREE.Fog("#08131f", 14, 50);

  const camera = new THREE.PerspectiveCamera(50, mountNode.clientWidth / mountNode.clientHeight, 0.1, 200);
  camera.position.set(12, 12, 16);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(mountNode.clientWidth, mountNode.clientHeight);
  renderer.shadowMap.enabled = true;
  mountNode.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.target.set(0, 1, 0);
  controls.maxPolarAngle = Math.PI / 2.12;
  controls.minDistance = 7;
  controls.maxDistance = 28;

  const hemi = new THREE.HemisphereLight("#9fd8ff", "#0a1524", 1.4);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight("#87ceff", 2.4);
  sun.position.set(10, 18, 8);
  sun.castShadow = true;
  scene.add(sun);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(34, 24),
    new THREE.MeshStandardMaterial({ color: "#355769", metalness: 0.1, roughness: 0.96 }),
  );
  ground.receiveShadow = true;
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(22, 4),
    new THREE.MeshStandardMaterial({ color: "#1f2d3a", roughness: 0.92 }),
  );
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, 0.01, 2);
  scene.add(road);

  const campusGroup = new THREE.Group();
  scene.add(campusGroup);

  const buildingMaterial = new THREE.MeshStandardMaterial({ color: "#8ea6b5", roughness: 0.76, metalness: 0.12 });
  const roofMaterial = new THREE.MeshStandardMaterial({ color: "#0f2a47", roughness: 0.5 });
  const buildingConfigs = [
    { width: 5, height: 2.6, depth: 4, x: -7, z: -3 },
    { width: 7, height: 3.2, depth: 5, x: 1, z: -4 },
    { width: 4.5, height: 2.4, depth: 3.6, x: 8, z: 1.5 },
  ];

  for (const config of buildingConfigs) {
    const shell = new THREE.Mesh(new THREE.BoxGeometry(config.width, config.height, config.depth), buildingMaterial);
    shell.castShadow = true;
    shell.receiveShadow = true;
    shell.position.set(config.x, config.height / 2, config.z);
    campusGroup.add(shell);

    const roof = new THREE.Mesh(new THREE.BoxGeometry(config.width + 0.15, 0.16, config.depth + 0.15), roofMaterial);
    roof.position.set(config.x, config.height + 0.1, config.z);
    roof.castShadow = true;
    campusGroup.add(roof);
  }

  const field = new THREE.Mesh(
    new THREE.PlaneGeometry(9, 6),
    new THREE.MeshStandardMaterial({ color: "#24553a", roughness: 0.95 }),
  );
  field.rotation.x = -Math.PI / 2;
  field.position.set(8, 0.02, -6);
  scene.add(field);

  const gateGroup = new THREE.Group();
  scene.add(gateGroup);
  const gateMeshes = new Map<string, THREE.Mesh>();
  initialGates.forEach((gate, index) => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.4, 1.6, 2.3),
      new THREE.MeshStandardMaterial({ color: statusToColor(gate.status), emissive: statusToColor(gate.status), emissiveIntensity: 0.15 }),
    );
    mesh.position.set(-11 + index * 7, 0.8, 4.1 - index * 1.2);
    mesh.castShadow = true;
    mesh.userData.baseX = mesh.position.x;
    gateGroup.add(mesh);
    gateMeshes.set(gate.id, mesh);
  });

  const cloudGroup = new THREE.Group();
  scene.add(cloudGroup);
  for (let i = 0; i < 8; i += 1) {
    const cloud = new THREE.Mesh(
      new THREE.SphereGeometry(0.7 + (i % 3) * 0.18, 12, 12),
      new THREE.MeshStandardMaterial({ color: "#f6fbff", transparent: true, opacity: 0.35 }),
    );
    cloud.position.set(-10 + i * 3.2, 7 + (i % 2) * 0.4, -5 + (i % 3));
    cloudGroup.add(cloud);
  }

  const rainGeometry = new THREE.BufferGeometry();
  const rainVertices = new Float32Array(300 * 3);
  for (let i = 0; i < rainVertices.length; i += 3) {
    rainVertices[i] = (Math.random() - 0.5) * 28;
    rainVertices[i + 1] = Math.random() * 10 + 2;
    rainVertices[i + 2] = (Math.random() - 0.5) * 18;
  }
  rainGeometry.setAttribute("position", new THREE.BufferAttribute(rainVertices, 3));
  const rain = new THREE.Points(
    rainGeometry,
    new THREE.PointsMaterial({ color: "#8fd7ff", size: 0.09, transparent: true, opacity: 0.0 }),
  );
  scene.add(rain);

  const lockdownBeacon = new THREE.Mesh(
    new THREE.CylinderGeometry(0.14, 0.14, 3.2, 12),
    new THREE.MeshStandardMaterial({ color: "#ff3b2f", emissive: "#ff3b2f", emissiveIntensity: 0 }),
  );
  lockdownBeacon.position.set(0, 1.6, 8.5);
  scene.add(lockdownBeacon);

  let frameId = 0;

  const animate = () => {
    frameId = window.requestAnimationFrame(animate);
    const positions = rainGeometry.getAttribute("position");
    for (let i = 1; i < positions.count * 3; i += 3) {
      const next = positions.array[i] - 0.12;
      positions.array[i] = next < 0.4 ? 10.5 : next;
    }
    positions.needsUpdate = true;
    cloudGroup.rotation.y += 0.0008;
    controls.update();
    renderer.render(scene, camera);
  };
  animate();

  const updateWeather = (next: WeatherSnapshot) => {
    const particles = weatherParticles(next.mode);
    sun.intensity = 1.2 + particles.sunStrength;
    (rain.material as THREE.PointsMaterial).opacity = particles.rainIntensity;
    for (const cloud of cloudGroup.children) {
      const material = (cloud as THREE.Mesh).material as THREE.MeshStandardMaterial;
      material.opacity = particles.cloudOpacity;
    }
  };

  const updateEmergency = (next: EmergencyState) => {
    const material = lockdownBeacon.material as THREE.MeshStandardMaterial;
    material.emissiveIntensity = next.mode === "normal" ? 0 : 1.2;
    material.color.set(next.mode === "fire" ? "#ffab1a" : "#ff3b2f");
    material.emissive.set(next.mode === "fire" ? "#ffab1a" : "#ff3b2f");
  };

  const updateGates = (gates: GateStatus[]) => {
    gates.forEach((gate) => {
      const mesh = gateMeshes.get(gate.id);
      if (!mesh) {
        return;
      }
      const material = mesh.material as THREE.MeshStandardMaterial;
      material.color.set(statusToColor(gate.status));
      material.emissive.set(statusToColor(gate.status));
      material.emissiveIntensity = gate.status === "issue" ? 0.5 : 0.18;
      mesh.position.x = Number(mesh.userData.baseX) + gate.openPercent / 180;
      mesh.rotation.y = THREE.MathUtils.degToRad(gate.openPercent / 4);
    });
  };

  const handleResize = () => {
    camera.aspect = mountNode.clientWidth / mountNode.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(mountNode.clientWidth, mountNode.clientHeight);
  };

  window.addEventListener("resize", handleResize);
  updateGates(initialGates);
  updateWeather(initialWeather);
  updateEmergency(initialEmergency);

  return {
    updateGates,
    updateWeather,
    updateEmergency,
    destroy: () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("resize", handleResize);
      controls.dispose();
      renderer.dispose();
      mountNode.removeChild(renderer.domElement);
      scene.traverse((item) => {
        if (item instanceof THREE.Mesh) {
          const mesh = item as THREE.Mesh;
          mesh.geometry.dispose();
          const material = mesh.material;
          if (Array.isArray(material)) {
            material.forEach((entry) => entry.dispose());
          } else {
            material.dispose();
          }
        }
      });
    },
  };
}

function statusToColor(status: GateStatus["status"]): string {
  if (status === "open") {
    return "#2ee05a";
  }
  if (status === "issue") {
    return "#ffab1a";
  }
  if (status === "moving") {
    return "#0099ff";
  }
  return "#ff3b2f";
}
