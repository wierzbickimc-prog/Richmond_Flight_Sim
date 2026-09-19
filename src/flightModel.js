import * as THREE from 'three';

const DEG = Math.PI / 180;

const MIN_SPEED = 14; // m/s, ~27 kt - forgiving arcade floor, no hard stall
const MAX_SPEED = 62; // m/s, ~120 kt
const CRUISE_SPEED = 34; // m/s, ~66 kt - Cessna 172 economy cruise ballpark
const THROTTLE_RATE = 0.55; // per second
const SPEED_LERP = 0.9;
const BOOST_MULTIPLIER = 10;
const BOOST_SPEED_LERP = 4.2;
// SR-71 Blackbird top speed: 2,193.2 mph converted to m/s (1 mph = 0.44704 m/s) ≈ 980.45 m/s
export const SR71_BOOST_MAX_SPEED = 2193.2 * 0.44704;

const MAX_ROLL = 35 * DEG;
const MAX_PITCH = 20 * DEG;
const ROLL_RATE = 2.6; // rad/s toward target
const PITCH_RATE = 1.4;
const BANK_TURN_RATE = 1.0; // yaw rad/s per rad of roll
const RUDDER_YAW_RATE = 0.35; // rad/s from manual yaw input

const MIN_AGL = 25; // meters - soft floor so terrain stays visible and non-fatal
const MAX_AGL = 520; // meters - keeps the ground legible at all times

export function createFlightState(startPos, startHeadingRad) {
  return {
    position: startPos.clone(),
    heading: startHeadingRad,
    pitch: 0,
    roll: 0,
    speed: CRUISE_SPEED,
    throttle: 0.55,
    boostActive: false,
    forward: new THREE.Vector3(0, 0, -1),
  };
}

function lerpAngle(current, target, rate, dt) {
  const t = Math.min(1, rate * dt);
  return current + (target - current) * t;
}

export function updateFlightModel(state, input, dt, getGroundHeight, boostMaxSpeed = MAX_SPEED * BOOST_MULTIPLIER) {
  state.throttle += (input.throttleUp ? 1 : 0) * THROTTLE_RATE * dt;
  state.throttle -= (input.throttleDown ? 1 : 0) * THROTTLE_RATE * dt;
  state.throttle = Math.max(0, Math.min(1, state.throttle));

  const targetRoll = (input.rollRight ? 1 : 0) - (input.rollLeft ? 1 : 0);
  const targetPitch = (input.pitchUp ? 1 : 0) - (input.pitchDown ? 1 : 0);

  state.roll = lerpAngle(state.roll, targetRoll * MAX_ROLL, ROLL_RATE, dt);
  state.pitch = lerpAngle(state.pitch, targetPitch * MAX_PITCH, PITCH_RATE, dt);

  let yawRate = state.roll * BANK_TURN_RATE;
  yawRate += ((input.yawRight ? 1 : 0) - (input.yawLeft ? 1 : 0)) * RUDDER_YAW_RATE;
  state.heading += yawRate * dt;

  const normalTargetSpeed = MIN_SPEED + state.throttle * (MAX_SPEED - MIN_SPEED);
  const targetSpeed = state.boostActive ? (normalTargetSpeed / MAX_SPEED) * boostMaxSpeed : normalTargetSpeed;
  const speedLerp = state.boostActive ? BOOST_SPEED_LERP : SPEED_LERP;
  state.speed += (targetSpeed - state.speed) * Math.min(1, speedLerp * dt);
  state.speed = Math.max(MIN_SPEED * 0.6, Math.min(boostMaxSpeed, state.speed));

  const forward = new THREE.Vector3(
    Math.sin(state.heading) * Math.cos(state.pitch),
    Math.sin(state.pitch),
    -Math.cos(state.heading) * Math.cos(state.pitch)
  );
  state.forward.copy(forward);

  state.position.addScaledVector(forward, state.speed * dt);

  const ground = getGroundHeight(state.position.x, state.position.z);
  const agl = state.position.y - ground;
  if (agl < MIN_AGL) {
    state.position.y = ground + MIN_AGL;
  } else if (agl > MAX_AGL) {
    state.position.y = ground + MAX_AGL;
  }

  return { agl: state.position.y - ground, groundY: ground };
}

export const FlightLimits = { MIN_SPEED, MAX_SPEED, MIN_AGL, MAX_AGL, CRUISE_SPEED, BOOST_MULTIPLIER, SR71_BOOST_MAX_SPEED };
