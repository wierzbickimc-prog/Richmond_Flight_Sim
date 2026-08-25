// Simple equirectangular local projection: fine for a playable area a few km across.
const METERS_PER_DEG_LAT = 111320;

export function makeProjector(originLat, originLon) {
  const metersPerDegLon = METERS_PER_DEG_LAT * Math.cos((originLat * Math.PI) / 180);

  return {
    originLat,
    originLon,
    // World space: x = east (m), z = south (m) -- matches Three.js right-handed
    // ground plane where north points toward -Z.
    toWorld(lat, lon) {
      const x = (lon - originLon) * metersPerDegLon;
      const z = -(lat - originLat) * METERS_PER_DEG_LAT;
      return { x, z };
    },
    toLatLon(x, z) {
      const lon = originLon + x / metersPerDegLon;
      const lat = originLat - z / METERS_PER_DEG_LAT;
      return { lat, lon };
    },
  };
}
