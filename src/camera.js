import * as THREE from 'three';

const CHASE_OFFSET = new THREE.Vector3(0, 7.5, 24);
const CHASE_LOOK_OFFSET = new THREE.Vector3(0, 1.5, -6);
// Pilot's eye position inside the cabin: low enough to sit under the roof line,
// far enough back that the spinning prop reads as a disc out ahead.
const COCKPIT_OFFSET = new THREE.Vector3(0, 0.45, -0.3);
const SR71_CHASE_OFFSET = new THREE.Vector3(0, 10, 46);
const SR71_CHASE_LOOK_OFFSET = new THREE.Vector3(0, 1.2, -7);
const SR71_COCKPIT_OFFSET = new THREE.Vector3(0, 0.58, -7.45);

const tmpPos = new THREE.Vector3();
const tmpLook = new THREE.Vector3();

export function createCameraRig() {
  return { mode: 'chase', aircraftMode: 'cessna', boostActive: false };
}

export function setCameraAircraftMode(rig, mode) {
  rig.aircraftMode = mode;
  rig.boostActive = false;
}

export function toggleCameraMode(rig) {
  rig.mode = rig.mode === 'chase' ? 'cockpit' : 'chase';
}

export function updateCamera(camera, rig, aircraftGroup, dt) {
  const isSR71 = rig.aircraftMode === 'sr71';
  const chaseOffset = isSR71 ? SR71_CHASE_OFFSET : CHASE_OFFSET;
  const chaseLookOffset = isSR71 ? SR71_CHASE_LOOK_OFFSET : CHASE_LOOK_OFFSET;
  if (rig.mode === 'chase') {
    tmpPos.copy(chaseOffset);
    if (rig.boostActive) tmpPos.z *= 1.28;
    tmpPos.applyQuaternion(aircraftGroup.quaternion).add(aircraftGroup.position);
    tmpLook.copy(chaseLookOffset).applyQuaternion(aircraftGroup.quaternion).add(aircraftGroup.position);
    const t = Math.min(1, 5.5 * dt);
    camera.position.lerp(tmpPos, t);
    const lookTarget = camera.userData.lookTarget || tmpLook.clone();
    lookTarget.lerp(tmpLook, t);
    camera.userData.lookTarget = lookTarget;
    camera.up.set(0, 1, 0);
    camera.lookAt(lookTarget);
  } else {
    tmpPos.copy(isSR71 ? SR71_COCKPIT_OFFSET : COCKPIT_OFFSET).applyQuaternion(aircraftGroup.quaternion).add(aircraftGroup.position);
    camera.position.copy(tmpPos);
    camera.quaternion.copy(aircraftGroup.quaternion);
  }

  const targetFov = rig.boostActive ? 82 : 60;
  camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 5.5);
  camera.updateProjectionMatrix();
}
