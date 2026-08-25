const MS_TO_KT = 1.94384;
const M_TO_FT = 3.28084;

function headingLabel(rad) {
  let deg = (rad * 180) / Math.PI;
  deg = ((deg % 360) + 360) % 360;
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const idx = Math.round(deg / 22.5) % 16;
  return { deg: Math.round(deg), dir: dirs[idx] };
}

export function createHud(markers) {
  const root = document.getElementById('hud');
  const els = {
    altitude: document.getElementById('hud-altitude'),
    speed: document.getElementById('hud-speed'),
    heading: document.getElementById('hud-heading'),
    throttle: document.getElementById('hud-throttle'),
    distance: document.getElementById('hud-distance'),
    checklist: document.getElementById('hud-checklist'),
    toast: document.getElementById('hud-toast'),
    pause: document.getElementById('hud-pause'),
    progress: document.getElementById('hud-progress'),
    aircraft: document.getElementById('hud-aircraft'),
    boost: document.getElementById('hud-boost'),
  };

  els.checklist.innerHTML = '';
  const rows = {};
  for (const m of markers) {
    const row = document.createElement('div');
    row.className = 'checklist-row' + (m.primary ? ' primary' : '');
    row.innerHTML = `<span class="dot"></span><span class="name">${m.name}</span>`;
    els.checklist.appendChild(row);
    rows[m.id] = row;
  }

  let toastTimer = null;

  return {
    setVisible(visible) {
      root.style.display = visible ? '' : 'none';
    },
    setPaused(paused) {
      els.pause.style.display = paused ? 'flex' : 'none';
    },
    update({ agl, speed, heading, throttle, distanceToPrimary, visitedCount, total, aircraftName, boostActive }) {
      els.altitude.textContent = `${Math.round(agl * M_TO_FT)} ft AGL`;
      els.speed.textContent = `${Math.round(speed * MS_TO_KT)} kt`;
      const h = headingLabel(heading);
      els.heading.textContent = `${String(h.deg).padStart(3, '0')}° ${h.dir}`;
      els.throttle.textContent = `${Math.round(throttle * 100)}%`;
      els.aircraft.textContent = aircraftName;
      els.boost.textContent = boostActive ? '10× ENGAGED' : 'STANDBY';
      els.boost.classList.toggle('active', boostActive);
      els.distance.textContent =
        distanceToPrimary == null
          ? '--'
          : distanceToPrimary < 1000
          ? `${Math.round(distanceToPrimary)} m`
          : `${(distanceToPrimary / 1000).toFixed(2)} km`;
      els.progress.textContent = `${visitedCount}/${total} landmarks visited`;
    },
    markVisited(marker) {
      const row = rows[marker.id];
      if (row) row.classList.add('visited');
    },
    toast(message) {
      els.toast.textContent = message;
      els.toast.classList.add('show');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => els.toast.classList.remove('show'), 4200);
    },
  };
}
