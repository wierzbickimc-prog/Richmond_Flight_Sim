import * as THREE from 'three';

// Low-poly Cessna 172-style high-wing propeller plane, built entirely from primitives
// so the demo has no external model/license dependencies.
export function buildAircraft() {
  const group = new THREE.Group();

  const whiteMat = new THREE.MeshLambertMaterial({ color: '#f2f2ef' });
  const stripeMat = new THREE.MeshLambertMaterial({ color: '#c8272c' });
  const glassMat = new THREE.MeshLambertMaterial({ color: '#3b4a52' });
  const propMat = new THREE.MeshLambertMaterial({ color: '#2b2b2b' });
  const wheelMat = new THREE.MeshLambertMaterial({ color: '#1c1c1c' });
  const metalMat = new THREE.MeshLambertMaterial({ color: '#cfd3d6' });

  // Fuselage: nose-to-tail along -Z (forward = -Z in local space).
  const fuselage = new THREE.Mesh(new THREE.CapsuleGeometry(0.62, 4.6, 4, 8), whiteMat);
  fuselage.rotation.x = Math.PI / 2;
  fuselage.position.set(0, 0, 0.1);
  fuselage.castShadow = true;
  group.add(fuselage);

  const stripe = new THREE.Mesh(new THREE.CapsuleGeometry(0.64, 3.4, 4, 8), stripeMat);
  stripe.rotation.x = Math.PI / 2;
  stripe.position.set(0, -0.05, 0.4);
  stripe.scale.set(1, 1, 0.35);
  group.add(stripe);

  // Engine cowl / nose.
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.62, 8, 8), metalMat);
  nose.position.set(0, 0, -2.55);
  nose.scale.set(1, 1, 0.7);
  group.add(nose);

  // Cockpit greenhouse.
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.62, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), glassMat);
  canopy.position.set(0, 0.35, -0.4);
  canopy.scale.set(0.95, 0.85, 1.5);
  group.add(canopy);

  // High wing (Cessna signature) sits above the fuselage.
  const wing = new THREE.Mesh(new THREE.BoxGeometry(11.2, 0.18, 1.5), whiteMat);
  wing.position.set(0, 0.95, 0.2);
  wing.castShadow = true;
  group.add(wing);
  const wingStripeL = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.2, 1.55), stripeMat);
  wingStripeL.position.set(4.2, 0.96, 0.2);
  group.add(wingStripeL);
  const wingStripeR = wingStripeL.clone();
  wingStripeR.position.x = -4.2;
  group.add(wingStripeR);

  // Wing struts.
  const strutGeo = new THREE.CylinderGeometry(0.05, 0.05, 1.6, 4);
  const strutL = new THREE.Mesh(strutGeo, metalMat);
  strutL.position.set(2.1, 0.45, 0.5);
  strutL.rotation.z = 0.35;
  group.add(strutL);
  const strutR = strutL.clone();
  strutR.position.x = -2.1;
  strutR.rotation.z = -0.35;
  group.add(strutR);

  // Horizontal + vertical tail.
  const hStab = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.14, 0.9), whiteMat);
  hStab.position.set(0, 0.15, 2.55);
  group.add(hStab);
  const vStab = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.2, 1.1), whiteMat);
  vStab.position.set(0, 0.7, 2.65);
  group.add(vStab);
  const vStabStripe = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.2, 0.4), stripeMat);
  vStabStripe.position.set(0, 0.7, 3.0);
  group.add(vStabStripe);

  // Landing gear.
  const legGeo = new THREE.CylinderGeometry(0.05, 0.05, 1.0, 4);
  const wheelGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.24, 10);
  function makeGear(x) {
    const g = new THREE.Group();
    const leg = new THREE.Mesh(legGeo, metalMat);
    leg.position.y = 0.1;
    leg.rotation.z = x > 0 ? 0.15 : -0.15;
    g.add(leg);
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.rotation.x = Math.PI / 2;
    wheel.position.y = -0.45;
    g.add(wheel);
    g.position.set(x, -0.55, 0.3);
    return g;
  }
  group.add(makeGear(1.3));
  group.add(makeGear(-1.3));
  const noseWheelLeg = new THREE.Mesh(legGeo, metalMat);
  noseWheelLeg.position.set(0, -0.55, -2.2);
  noseWheelLeg.scale.y = 0.7;
  group.add(noseWheelLeg);
  const noseWheel = new THREE.Mesh(wheelGeo, wheelMat);
  noseWheel.rotation.x = Math.PI / 2;
  noseWheel.position.set(0, -0.9, -2.2);
  noseWheel.scale.set(0.85, 0.85, 0.85);
  group.add(noseWheel);

  // Propeller (spun each frame by the caller).
  const propGroup = new THREE.Group();
  propGroup.position.set(0, 0, -2.85);
  const bladeGeo = new THREE.BoxGeometry(0.16, 1.7, 0.05);
  const blade1 = new THREE.Mesh(bladeGeo, propMat);
  const blade2 = new THREE.Mesh(bladeGeo, propMat);
  blade2.rotation.z = Math.PI / 2;
  propGroup.add(blade1, blade2);
  const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.4, 8), metalMat);
  spinner.rotation.x = -Math.PI / 2;
  spinner.position.z = -0.05;
  propGroup.add(spinner);
  group.add(propGroup);

  group.traverse((obj) => {
    if (obj.isMesh) obj.castShadow = true;
  });

  return { group, propGroup };
}
