import * as THREE from 'three';
import {
  Cartesian2,
  Cartesian3,
  Color,
  DistanceDisplayCondition,
  LabelStyle,
  NearFarScalar,
} from 'cesium';

const GOLD = Color.fromCssColorString('#ffcc33');
const CYAN = Color.fromCssColorString('#33ccff');
const VISITED = Color.fromCssColorString('#39ff8a');

function markerColor(marker) {
  return marker.visited ? VISITED : marker.primary ? GOLD : CYAN;
}

function positionAt(marker, height) {
  return Cartesian3.fromDegrees(marker.lon, marker.lat, height);
}

function applyMarkerHeight(marker, groundHeight) {
  marker.groundHeight = groundHeight;
  marker.beamEntity.position = positionAt(marker, groundHeight + marker.beamHeight / 2);
  marker.postEntity.position = positionAt(marker, groundHeight + 4);
  marker.labelEntity.position = positionAt(marker, groundHeight + marker.beamHeight * 0.62);
  marker.ringEntity.ellipse.height = groundHeight + 0.8;
}

function applyMarkerColor(marker) {
  const color = markerColor(marker);
  marker.beamEntity.cylinder.material = color.withAlpha(marker.primary ? 0.22 : 0.15);
  marker.postEntity.cylinder.material = color.withAlpha(0.9);
  marker.ringEntity.ellipse.material = color.withAlpha(marker.visited ? 0.18 : 0.1);
  marker.ringEntity.ellipse.outlineColor = color.withAlpha(0.85);
  marker.labelEntity.label.fillColor = marker.primary ? Color.fromCssColorString('#ffe38a') : color;
}

export function buildCesiumLandmarkMarkers(viewer, projector, landmarksData, sampleGroundAt) {
  const markers = [];

  for (const lm of landmarksData.landmarks) {
    const { x, z } = projector.toWorld(lm.lat, lm.lon);
    const beamHeight = lm.primary ? 520 : 360;
    const marker = {
      id: lm.id,
      name: lm.name,
      primary: !!lm.primary,
      radius: lm.radius_m,
      lat: lm.lat,
      lon: lm.lon,
      beamHeight,
      worldPos: new THREE.Vector3(x, 0, z),
      visited: false,
      groundHeight: 48,
      lastGroundSample: -Infinity,
    };

    marker.beamEntity = viewer.entities.add({
      id: `landmark-beam-${lm.id}`,
      position: positionAt(marker, 48 + beamHeight / 2),
      cylinder: {
        length: beamHeight,
        topRadius: lm.primary ? 3 : 2,
        bottomRadius: lm.primary ? 11 : 8,
        material: (lm.primary ? GOLD : CYAN).withAlpha(lm.primary ? 0.22 : 0.15),
        outline: false,
        shadows: 0,
      },
    });

    marker.postEntity = viewer.entities.add({
      id: `landmark-post-${lm.id}`,
      position: positionAt(marker, 52),
      cylinder: {
        length: 8,
        topRadius: 1.1,
        bottomRadius: 1.1,
        material: (lm.primary ? GOLD : CYAN).withAlpha(0.9),
      },
    });

    marker.ringEntity = viewer.entities.add({
      id: `landmark-ring-${lm.id}`,
      position: Cartesian3.fromDegrees(lm.lon, lm.lat, 0),
      ellipse: {
        semiMajorAxis: lm.radius_m,
        semiMinorAxis: lm.radius_m,
        height: 48.8,
        material: (lm.primary ? GOLD : CYAN).withAlpha(0.1),
        outline: true,
        outlineColor: (lm.primary ? GOLD : CYAN).withAlpha(0.85),
      },
    });

    marker.labelEntity = viewer.entities.add({
      id: `landmark-label-${lm.id}`,
      position: positionAt(marker, 48 + beamHeight * 0.62),
      label: {
        text: lm.name,
        font: lm.primary ? '700 20px system-ui' : '650 17px system-ui',
        style: LabelStyle.FILL_AND_OUTLINE,
        fillColor: lm.primary ? Color.fromCssColorString('#ffe38a') : CYAN,
        outlineColor: Color.fromCssColorString('#07121a').withAlpha(0.95),
        outlineWidth: 5,
        pixelOffset: new Cartesian2(0, -10),
        showBackground: true,
        backgroundColor: Color.fromCssColorString('#07121a').withAlpha(0.68),
        backgroundPadding: new Cartesian2(12, 8),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        distanceDisplayCondition: new DistanceDisplayCondition(0, 13000),
        scaleByDistance: new NearFarScalar(800, 1.15, 12000, 0.58),
      },
    });

    const initialHeight = sampleGroundAt(lm.lat, lm.lon, 48);
    applyMarkerHeight(marker, initialHeight);
    markers.push(marker);
  }

  markers.sort((a, b) => Number(b.primary) - Number(a.primary));
  return markers;
}

export function updateLandmarkGrounding(markers, sampleGroundAt, time) {
  for (const marker of markers) {
    if (time - marker.lastGroundSample < 1.4) continue;
    marker.lastGroundSample = time;
    const height = sampleGroundAt(marker.lat, marker.lon, marker.groundHeight);
    if (Math.abs(height - marker.groundHeight) > 0.15) applyMarkerHeight(marker, height);
  }
}

export function setMarkersVisible(markers, visible) {
  for (const marker of markers) {
    marker.beamEntity.show = visible;
    marker.postEntity.show = visible;
    marker.ringEntity.show = visible;
    marker.labelEntity.show = visible;
  }
}

export function updateLandmarkDetection(markers, aircraftPos) {
  const newlyVisited = [];
  for (const marker of markers) {
    if (marker.visited) continue;
    const dist = Math.hypot(aircraftPos.x - marker.worldPos.x, aircraftPos.z - marker.worldPos.z);
    if (dist <= marker.radius) {
      marker.visited = true;
      applyMarkerColor(marker);
      newlyVisited.push(marker);
    }
  }
  return newlyVisited;
}

export function distanceTo(markerId, markers, aircraftPos) {
  const marker = markers.find((item) => item.id === markerId);
  if (!marker) return null;
  return Math.hypot(aircraftPos.x - marker.worldPos.x, aircraftPos.z - marker.worldPos.z);
}
