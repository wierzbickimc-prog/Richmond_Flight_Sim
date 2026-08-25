const KEY_MAP = {
  KeyW: 'throttleUp',
  KeyS: 'throttleDown',
  KeyA: 'rollLeft',
  KeyD: 'rollRight',
  ArrowUp: 'pitchUp',
  ArrowDown: 'pitchDown',
  ArrowLeft: 'yawLeft',
  ArrowRight: 'yawRight',
};

export function createControls({ onToggleCamera, onReset, onToggleHud, onToggleMarkers, onTogglePause } = {}) {
  const input = {
    throttleUp: false,
    throttleDown: false,
    rollLeft: false,
    rollRight: false,
    pitchUp: false,
    pitchDown: false,
    yawLeft: false,
    yawRight: false,
  };

  function keydown(e) {
    if (KEY_MAP[e.code]) {
      input[KEY_MAP[e.code]] = true;
      e.preventDefault();
      return;
    }
    switch (e.code) {
      case 'KeyF':
        onToggleCamera && onToggleCamera();
        break;
      case 'KeyR':
        onReset && onReset();
        break;
      case 'KeyH':
        onToggleHud && onToggleHud();
        break;
      case 'KeyM':
        onToggleMarkers && onToggleMarkers();
        break;
      case 'KeyP':
        onTogglePause && onTogglePause();
        break;
      default:
        return;
    }
    e.preventDefault();
  }

  function keyup(e) {
    if (KEY_MAP[e.code]) {
      input[KEY_MAP[e.code]] = false;
      e.preventDefault();
    }
  }

  window.addEventListener('keydown', keydown);
  window.addEventListener('keyup', keyup);
  window.addEventListener('blur', () => {
    for (const k of Object.keys(input)) input[k] = false;
  });

  return { input };
}
