import * as THREE from 'three';

// Low-poly Cessna 172-style high-wing propeller plane, built entirely from
// primitives so the demo has no external model or texture dependencies.
//
// Convention: the nose points along local -Z, wings span X, up is +Y.
// Roughly to scale -- 11m span, 8.3m length, matching a real 172.
export function buildAircraft() {
  const group = new THREE.Group();

  const white = new THREE.MeshLambertMaterial({ color: '#f4f4f1' });
  const stripe = new THREE.MeshLambertMaterial({ color: '#1b56a4' });
  const stripeDark = new THREE.MeshLambertMaterial({ color: '#123a72' });
  const glass = new THREE.MeshPhongMaterial({
    color: '#2c4552',
    shininess: 110,
    specular: 0x99bbcc,
    transparent: true,
    opacity: 0.72,
  });
  const rubber = new THREE.MeshLambertMaterial({ color: '#1a1a1a' });
  const metal = new THREE.MeshPhongMaterial({ color: '#c7ccd1', shininess: 70 });
  // Blades fade out as RPM rises and the blur disc fades in, so the prop reads
  // as spinning rather than as a solid cross strobing in front of the camera.
  const propBlade = new THREE.MeshLambertMaterial({ color: '#232323', transparent: true, opacity: 1 });

  // --- Fuselage: a lathed profile gives a proper tapered body ---
  // Profile runs nose (0) to tail (7.3) with radius at each station.
  const profile = [
    [0.05, 0.0],
    [0.32, 0.18],
    [0.52, 0.48],
    [0.63, 0.95],
    [0.68, 1.7],
    [0.68, 3.0],
    [0.6, 4.1],
    [0.45, 5.2],
    [0.3, 6.3],
    [0.16, 7.1],
    [0.05, 7.3],
  ].map(([r, y]) => new THREE.Vector2(r, y));

  const fuseGeo = new THREE.LatheGeometry(profile, 14);
  fuseGeo.rotateX(Math.PI / 2); // +Y (nose->tail) becomes +Z
  fuseGeo.translate(0, 0, -3.0); // nose at z=-3.0, tail at z=+4.3
  const fuselage = new THREE.Mesh(fuseGeo, white);
  group.add(fuselage);

  // Belly stripe along the fuselage sides.
  const stripeGeo = new THREE.BoxGeometry(1.3, 0.26, 5.6);
  const bellyStripe = new THREE.Mesh(stripeGeo, stripe);
  bellyStripe.position.set(0, -0.3, 0.6);
  group.add(bellyStripe);

  // --- Engine cowling and spinner ---
  const cowl = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.5, 0.9, 14), white);
  cowl.rotation.x = Math.PI / 2;
  cowl.position.set(0, 0.02, -2.75);
  group.add(cowl);

  // Hidden when the camera sits inside the cabin -- from a pilot's eye these
  // fill the screen with the inside of the airframe.
  const cockpitHidden = [fuselage, bellyStripe, cowl];

  const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.62, 12), metal);
  spinner.rotation.x = -Math.PI / 2;
  spinner.position.set(0, 0.02, -3.42);
  group.add(spinner);

  // --- Cabin glazing ---
  // Collected so the cockpit camera can hide it; viewed from a seat inside the
  // cabin these panels otherwise cut translucent bands across the whole view.
  const glazing = [];

  const windshield = new THREE.Mesh(new THREE.BoxGeometry(1.16, 0.62, 0.9), glass);
  windshield.position.set(0, 0.5, -1.55);
  windshield.rotation.x = -0.42;
  glazing.push(windshield);

  const cabinTop = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.5, 1.8), glass);
  cabinTop.position.set(0, 0.56, -0.55);
  glazing.push(cabinTop);

  for (const side of [1, -1]) {
    const sideWin = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.46, 1.7), glass);
    sideWin.position.set(side * 0.63, 0.3, -0.5);
    glazing.push(sideWin);

    const rearWin = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.36, 0.8), glass);
    rearWin.position.set(side * 0.6, 0.28, 0.75);
    glazing.push(rearWin);
  }
  for (const g of glazing) group.add(g);

  // --- High wing with dihedral, in two halves ---
  const WING_SPAN = 5.5;
  const WING_CHORD = 1.6;
  function makeWing(side) {
    const wing = new THREE.Group();

    const panel = new THREE.Mesh(new THREE.BoxGeometry(WING_SPAN, 0.16, WING_CHORD), white);
    panel.position.set((side * WING_SPAN) / 2, 0, 0);
    wing.add(panel);

    // Wingtip stripe.
    const tip = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.18, WING_CHORD * 1.02), stripe);
    tip.position.set(side * (WING_SPAN - 0.75), 0, 0);
    wing.add(tip);

    // Aileron / flap split along the trailing edge.
    const flap = new THREE.Mesh(new THREE.BoxGeometry(WING_SPAN * 0.92, 0.1, 0.34), white);
    flap.position.set((side * WING_SPAN) / 2, -0.02, WING_CHORD / 2 + 0.12);
    wing.add(flap);

    // Nav light at the tip.
    const light = new THREE.Mesh(
      new THREE.SphereGeometry(0.11, 6, 6),
      new THREE.MeshBasicMaterial({ color: side > 0 ? '#3fdd6a' : '#e04b4b' })
    );
    light.position.set(side * WING_SPAN, 0.02, -WING_CHORD / 2 + 0.1);
    wing.add(light);

    wing.rotation.z = -side * 0.045; // dihedral
    return wing;
  }

  const wingRoot = new THREE.Group();
  wingRoot.position.set(0, 0.82, -0.35);
  wingRoot.add(makeWing(1), makeWing(-1));
  group.add(wingRoot);

  // Wing struts (the Cessna signature).
  for (const side of [1, -1]) {
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.5, 5), metal);
    strut.position.set(side * 1.5, 0.1, 0.0);
    strut.rotation.z = side * 0.62;
    strut.rotation.x = 0.08;
    group.add(strut);
  }

  // --- Empennage ---
  const hStab = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.13, 1.0), white);
  hStab.position.set(0, 0.32, 3.7);
  group.add(hStab);

  const elevator = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.09, 0.36), white);
  elevator.position.set(0, 0.32, 4.28);
  group.add(elevator);

  // Swept vertical fin built from a triangular prism.
  const finShape = new THREE.Shape();
  finShape.moveTo(0, 0);
  finShape.lineTo(1.55, 1.5);
  finShape.lineTo(1.55, 0);
  finShape.lineTo(0, 0);
  const finGeo = new THREE.ExtrudeGeometry(finShape, { depth: 0.12, bevelEnabled: false });
  finGeo.rotateY(Math.PI / 2);
  finGeo.translate(-0.06, 0.28, 2.95);
  const fin = new THREE.Mesh(finGeo, white);
  group.add(fin);

  const finStripe = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.0, 0.75), stripeDark);
  finStripe.position.set(0, 1.15, 4.16);
  finStripe.rotation.x = -0.35;
  group.add(finStripe);

  // --- Landing gear: two mains with wheel pants plus a nose wheel ---
  function makeWheel(x, y, z, scale, pant) {
    const g = new THREE.Group();
    const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.2, 12), rubber);
    tire.rotation.z = Math.PI / 2;
    g.add(tire);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.22, 8), metal);
    hub.rotation.z = Math.PI / 2;
    g.add(hub);
    if (pant) {
      const fairing = new THREE.Mesh(new THREE.SphereGeometry(0.34, 8, 6), white);
      fairing.scale.set(0.6, 0.85, 1.5);
      g.add(fairing);
    }
    g.position.set(x, y, z);
    g.scale.setScalar(scale);
    return g;
  }

  for (const side of [1, -1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.12, 0.22), metal);
    leg.position.set(side * 0.72, -0.62, 0.45);
    leg.rotation.z = side * 0.42;
    group.add(leg);
    group.add(makeWheel(side * 1.3, -0.95, 0.45, 1, true));
  }
  const noseLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.85, 6), metal);
  noseLeg.position.set(0, -0.62, -2.15);
  group.add(noseLeg);
  group.add(makeWheel(0, -1.0, -2.15, 0.85, false));

  // --- Propeller ---
  const propGroup = new THREE.Group();
  propGroup.position.set(0, 0.02, -3.5);

  // A 172 has a two-blade prop: one box spanning the full diameter, not two
  // crossed boxes (which would read as four blades).
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.85, 0.045), propBlade);
  propGroup.add(blade);

  // A translucent disc that fades in with RPM, so the prop reads as spinning
  // instead of strobing at high frame rates.
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(0.95, 20),
    new THREE.MeshBasicMaterial({
      color: '#c9ccd0',
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  );
  disc.position.z = -0.04;
  propGroup.add(disc);
  group.add(propGroup);

  // Antenna + beacon so the silhouette has some fine detail.
  const antenna = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.32, 0.05), metal);
  antenna.position.set(0, 0.92, 1.4);
  group.add(antenna);

  const beacon = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 6, 6),
    new THREE.MeshBasicMaterial({ color: '#ff5544' })
  );
  beacon.position.set(0, 1.82, 3.55);
  group.add(beacon);

  group.traverse((obj) => {
    if (obj.isMesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
    }
  });

  return {
    group,
    propGroup,
    propDisc: disc,
    propBladeMat: propBlade,
    cockpitHidden: [...cockpitHidden, ...glazing],
  };
}
