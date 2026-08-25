import * as THREE from 'three';
import {
  Cartesian3,
  Cartographic,
  Color,
  ImageryLayer,
  Ion,
  Matrix4,
  OpenStreetMapImageryProvider,
  ShadowMode,
  Transforms,
  Viewer,
  createGooglePhotorealistic3DTileset,
  createWorldTerrainAsync,
} from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';

const DEFAULT_RICHMOND_HEIGHT = 48;

function readRuntimeCredentials() {
  return {
    googleKey:
      import.meta.env.VITE_GOOGLE_MAPS_API_KEY ||
      sessionStorage.getItem('richmond.googleMapsApiKey') ||
      '',
    ionToken:
      import.meta.env.VITE_CESIUM_ION_TOKEN ||
      sessionStorage.getItem('richmond.cesiumIonToken') ||
      '',
  };
}

export function saveRuntimeCredentials({ googleKey = '', ionToken = '' }) {
  if (googleKey.trim()) sessionStorage.setItem('richmond.googleMapsApiKey', googleKey.trim());
  else sessionStorage.removeItem('richmond.googleMapsApiKey');
  if (ionToken.trim()) sessionStorage.setItem('richmond.cesiumIonToken', ionToken.trim());
  else sessionStorage.removeItem('richmond.cesiumIonToken');
}

export async function createCesiumWorld(container, projector, onStatus = () => {}) {
  const credentials = readRuntimeCredentials();
  if (credentials.ionToken) Ion.defaultAccessToken = credentials.ionToken;

  const osmLayer = new ImageryLayer(
    new OpenStreetMapImageryProvider({
      url: 'https://tile.openstreetmap.org/',
      credit: '© OpenStreetMap contributors',
      maximumLevel: 19,
    })
  );

  const viewer = new Viewer(container, {
    animation: false,
    baseLayer: osmLayer,
    baseLayerPicker: false,
    fullscreenButton: false,
    geocoder: false,
    homeButton: false,
    infoBox: false,
    navigationHelpButton: false,
    scene3DOnly: true,
    sceneModePicker: false,
    selectionIndicator: false,
    shouldAnimate: true,
    timeline: false,
    useBrowserRecommendedResolution: true,
    useDefaultRenderLoop: false,
    shadows: true,
    terrainShadows: ShadowMode.ENABLED,
  });

  viewer.scene.screenSpaceCameraController.enableInputs = false;
  viewer.scene.globe.depthTestAgainstTerrain = true;
  viewer.scene.globe.enableLighting = true;
  viewer.scene.globe.showGroundAtmosphere = true;
  viewer.scene.highDynamicRange = true;
  viewer.scene.fog.enabled = true;
  viewer.scene.fog.density = 0.00014;
  viewer.scene.postProcessStages.fxaa.enabled = true;
  viewer.scene.backgroundColor = new Color(0.55, 0.72, 0.86, 1);
  viewer.resolutionScale = Math.min(1.35, window.devicePixelRatio || 1);

  let tileset = null;
  let mode = 'osm-fallback';
  let loadError = null;

  try {
    onStatus(credentials.googleKey ? 'Connecting to Google Photorealistic 3D Tiles…' : 'Connecting to Cesium real-world 3D data…');
    const apiOptions = { onlyUsingWithGoogleGeocoder: true };
    if (credentials.googleKey) apiOptions.key = credentials.googleKey;

    tileset = await createGooglePhotorealistic3DTileset(apiOptions, {
      maximumScreenSpaceError: 7,
      cacheBytes: 512 * 1024 * 1024,
      maximumCacheOverflowBytes: 256 * 1024 * 1024,
      showCreditsOnScreen: true,
      enableCollision: true,
    });
    viewer.scene.primitives.add(tileset);
    viewer.scene.globe.show = false;
    viewer.imageryLayers.removeAll();
    mode = credentials.googleKey ? 'google-photorealistic' : 'cesium-photorealistic-evaluation';
    onStatus('Streaming real Richmond terrain and buildings…');
  } catch (error) {
    loadError = error;
    console.error('Photorealistic 3D Tiles failed; using the terrain/OSM fallback.', error);
    viewer.scene.globe.show = true;
    try {
      onStatus('Photorealistic tiles unavailable — loading Cesium World Terrain…');
      viewer.terrainProvider = await createWorldTerrainAsync({
        requestVertexNormals: true,
        requestWaterMask: true,
      });
      mode = 'cesium-terrain-osm';
      onStatus('Using real terrain with OpenStreetMap imagery.');
    } catch (terrainError) {
      console.error('Cesium World Terrain also failed; using the ellipsoid fallback.', terrainError);
      mode = 'osm-fallback';
      onStatus('Real 3D data unavailable — using the OpenStreetMap fallback.');
    }
  }

  const originFixed = Cartesian3.fromDegrees(projector.originLon, projector.originLat, 0);
  const enuToFixed = Transforms.eastNorthUpToFixedFrame(originFixed);
  const localPoint = new Cartesian3();
  const localVector = new Cartesian3();
  const destination = new Cartesian3();
  const direction = new Cartesian3();
  const up = new Cartesian3();
  const threeDirection = new THREE.Vector3();
  const threeUp = new THREE.Vector3();
  const cartographicScratch = new Cartographic();
  let heightExclusions = [];
  let lastGroundHeight = DEFAULT_RICHMOND_HEIGHT;

  function localToFixed(x, y, z, result = new Cartesian3()) {
    // Simulator coordinates are east/up/south. Cesium's local frame is
    // east/north/up, hence (x, -z, y).
    localPoint.x = x;
    localPoint.y = -z;
    localPoint.z = y;
    return Matrix4.multiplyByPoint(enuToFixed, localPoint, result);
  }

  function localDirectionToFixed(vector, result) {
    localVector.x = vector.x;
    localVector.y = -vector.z;
    localVector.z = vector.y;
    Matrix4.multiplyByPointAsVector(enuToFixed, localVector, result);
    return Cartesian3.normalize(result, result);
  }

  function sampleGroundAt(lat, lon, fallback = lastGroundHeight) {
    Cartographic.fromDegrees(lon, lat, 0, cartographicScratch);
    let height;
    if (viewer.scene.sampleHeightSupported) {
      height = viewer.scene.sampleHeight(cartographicScratch, heightExclusions);
    }
    if (!Number.isFinite(height) && viewer.scene.globe.show) {
      height = viewer.scene.globe.getHeight(cartographicScratch);
    }
    // Coarse photogrammetry LODs can briefly report bounding-volume heights
    // hundreds of metres below/above Richmond while tiles refine. Reject those
    // transient values so the arcade altitude limiter never yanks the aircraft.
    if (Number.isFinite(height) && height > -80 && height < 220) {
      lastGroundHeight = height;
      return height;
    }
    return fallback;
  }

  function getGroundHeight(x, z) {
    const { lat, lon } = projector.toLatLon(x, z);
    return sampleGroundAt(lat, lon);
  }

  function syncCamera(threeCamera) {
    localToFixed(threeCamera.position.x, threeCamera.position.y, threeCamera.position.z, destination);
    threeCamera.getWorldDirection(threeDirection);
    threeUp.set(0, 1, 0).applyQuaternion(threeCamera.quaternion);
    localDirectionToFixed(threeDirection, direction);
    localDirectionToFixed(threeUp, up);

    viewer.camera.setView({ destination, orientation: { direction, up } });
    const verticalFov = THREE.MathUtils.degToRad(threeCamera.fov);
    const aspect = Math.max(0.01, threeCamera.aspect);
    viewer.camera.frustum.aspectRatio = aspect;
    viewer.camera.frustum.fov = aspect > 1
      ? 2 * Math.atan(Math.tan(verticalFov / 2) * aspect)
      : verticalFov;
    viewer.camera.frustum.near = 0.5;
  }

  function resize() {
    viewer.resize();
    viewer.resolutionScale = Math.min(1.35, window.devicePixelRatio || 1);
  }

  function setHeightExclusions(objects) {
    heightExclusions = objects;
  }

  function render(threeCamera) {
    syncCamera(threeCamera);
    viewer.render();
  }

  return {
    viewer,
    tileset,
    mode,
    loadError,
    credentials,
    getGroundHeight,
    sampleGroundAt,
    localToFixed,
    setHeightExclusions,
    resize,
    render,
  };
}
