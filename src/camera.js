import * as THREE from 'three';

const CHASE_OFFSET = new THREE.Vector3(0, 7.5, 24);
const CHASE_LOOK_OFFSET = new THREE.Vector3(0, 1.5, -6);
// Pilot's eye position inside the cabin: low enough to sit under the roof line,
// far enough back that the spinning prop reads as a disc out ahead.
const COCKPIT_OFFSET = new THREE.Vector3(0, 0.45, -0.3);

const tmpPos = new THREE.Vector3();
const tmpLook = new THREE.Vector3();

export function createCameraRig() {
  return { mode: 'chase' };
}

export function toggleCameraMode(rig) {
  rig.mode = rig.mode === 'chase' ? 'cockpit' : 'chase';
}

export function updateCamera(camera, rig, aircraftGroup, dt) {
  if (rig.mode === 'chase') {
    tmpPos.copy(CHASE_OFFSET).applyQuaternion(aircraftGroup.quaternion).add(aircraftGroup.position);
    tmpLook.copy(CHASE_LOOK_OFFSET).applyQuaternion(aircraftGroup.quaternion).add(aircraftGroup.position);
    const t = Math.min(1, 5.5 * dt);
    camera.position.lerp(tmpPos, t);
    const lookTarget = camera.userData.lookTarget || tmpLook.clone();
    lookTarget.lerp(tmpLook, t);
    camera.userData.lookTarget = lookTarget;
    camera.up.set(0, 1, 0);
    camera.lookAt(lookTarget);
  } else {
    tmpPos.copy(COCKPIT_OFFSET).applyQuaternion(aircraftGroup.quaternion).add(aircraftGroup.position);
    camera.position.copy(tmpPos);
    camera.quaternion.copy(aircraftGroup.quaternion);
  }
}
