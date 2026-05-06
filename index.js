class CctvAppPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._hass = null;
    this._camerasSignature = null;
    this._selectedCamera = null;
    this._motionPriority = true;
    this._motionRefreshTimer = null;
    this._escapeHandler = (event) => {
      if (event.key === 'Escape') {
        this._closeFullscreen();
      }
    };
  }

  set hass(hass) {
    this._hass = hass;
    this._renderIfNeeded();
  }

  connectedCallback() {
    document.addEventListener('keydown', this._escapeHandler);
    if (!this._motionRefreshTimer) {
      this._motionRefreshTimer = window.setInterval(() => this._renderIfNeeded(), 30000);
    }
    this._renderIfNeeded(true);
  }

  disconnectedCallback() {
    document.removeEventListener('keydown', this._escapeHandler);
    if (this._motionRefreshTimer) {
      window.clearInterval(this._motionRefreshTimer);
      this._motionRefreshTimer = null;
    }
  }

  _renderIfNeeded(force = false) {
    const cameras = this._getCameras();
    const signature = `${this._motionPriority}:${cameras
      .map((camera) => `${camera.entityId}:${camera.name}:${camera.hasMotion}:${camera.motionSensorId || ''}:${camera.motionLastChanged || ''}`)
      .join('|')}`;

    if (force || signature !== this._camerasSignature) {
      this._camerasSignature = signature;
      this._render(cameras);
    }
  }

  _getCameras() {
    if (!this._hass || !this._hass.states) {
      return [];
    }

    const motionSensors = this._getMotionSensors();
    const cameras = Object.entries(this._hass.states)
      .filter(([entityId]) => entityId.startsWith('camera.'))
      .map(([entityId, state]) => {
        const relatedMotion = motionSensors.find((sensor) => this._isRelatedMotionSensor(entityId, state, sensor));

        return {
          entityId,
          name: state.attributes?.friendly_name || entityId,
          hasMotion: Boolean(relatedMotion),
          motionSensorId: relatedMotion?.entityId || '',
          motionLastChanged: relatedMotion?.lastChanged || '',
        };
      });

    return cameras.sort((left, right) => {
      if (this._motionPriority && left.hasMotion !== right.hasMotion) {
        return left.hasMotion ? -1 : 1;
      }

      if (this._motionPriority && left.hasMotion && right.hasMotion) {
        return new Date(right.motionLastChanged).getTime() - new Date(left.motionLastChanged).getTime();
      }

      return left.entityId.localeCompare(right.entityId);
    });
  }

  _getMotionSensors() {
    const now = Date.now();
    const recentWindow = 2 * 60 * 1000;

    return Object.entries(this._hass.states)
      .filter(([entityId, state]) => {
        if (!entityId.startsWith('binary_sensor.')) {
          return false;
        }

        const lastChanged = new Date(state.last_changed).getTime();
        if (!lastChanged || now - lastChanged > recentWindow) {
          return false;
        }

        return this._looksLikeMotionSensor(entityId, state);
      })
      .map(([entityId, state]) => ({
        entityId,
        state,
        lastChanged: state.last_changed,
        deviceId: this._normalizeText(state.attributes?.device_id || state.attributes?.device || ''),
        text: this._normalizeText(`${entityId} ${state.attributes?.friendly_name || ''}`),
        tokens: this._tokens(`${entityId} ${state.attributes?.friendly_name || ''}`),
      }));
  }

  _looksLikeMotionSensor(entityId, state) {
    const deviceClass = this._normalizeText(state.attributes?.device_class || '');
    const text = this._normalizeText(`${entityId} ${state.attributes?.friendly_name || ''}`);
    const motionWords = ['motion', 'occupancy', 'presence', 'pir', 'person', 'activity', 'detection'];

    return ['motion', 'occupancy', 'presence'].includes(deviceClass) || motionWords.some((word) => text.includes(word));
  }

  _isRelatedMotionSensor(cameraEntityId, cameraState, sensor) {
    const cameraDeviceId = this._normalizeText(cameraState.attributes?.device_id || cameraState.attributes?.device || '');
    if (cameraDeviceId && sensor.deviceId && this._similarDeviceId(cameraDeviceId, sensor.deviceId)) {
      return true;
    }

    const cameraTokens = this._tokens(`${cameraEntityId} ${cameraState.attributes?.friendly_name || ''}`);
    const ignored = new Set(['camera', 'binary', 'sensor', 'motion', 'occupancy', 'presence', 'pir', 'person', 'activity', 'detection']);
    const cameraKeyTokens = cameraTokens.filter((token) => !ignored.has(token) && token.length > 2);

    return cameraKeyTokens.some((token) => sensor.tokens.includes(token) || sensor.text.includes(token));
  }

  _similarDeviceId(left, right) {
    return left === right || left.includes(right) || right.includes(left);
  }

  _tokens(value) {
    return this._normalizeText(value)
      .split(' ')
      .filter(Boolean);
  }

  _normalizeText(value) {
    return String(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  _cameraUrl(entityId) {
    return `/api/camera_proxy/${encodeURIComponent(entityId)}`;
  }

  _openFullscreen(entityId) {
    const camera = this._getCameras().find((item) => item.entityId === entityId);
    if (!camera) {
      return;
    }

    this._selectedCamera = camera;
    this._renderFullscreen();
  }

  _closeFullscreen() {
    if (!this._selectedCamera) {
      return;
    }

    this._selectedCamera = null;
    const overlay = this.shadowRoot.querySelector('.fullscreen');
    if (overlay) {
      overlay.remove();
    }
  }

  _setMotionPriority(enabled) {
    if (this._motionPriority === enabled) {
      return;
    }

    this._motionPriority = enabled;
    this._renderIfNeeded(true);
  }

  _render(cameras) {
    const motionCount = cameras.filter((camera) => camera.hasMotion).length;

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          min-height: 100vh;
          color: #e8fbff;
          background:
            radial-gradient(circle at top left, rgba(0, 255, 255, 0.14), transparent 32rem),
            radial-gradient(circle at bottom right, rgba(78, 70, 255, 0.13), transparent 30rem),
            #070b13;
          font-family: Inter, Roboto, Arial, sans-serif;
          box-sizing: border-box;
        }

        * {
          box-sizing: border-box;
        }

        .shell {
          width: min(1800px, 100%);
          margin: 0 auto;
          padding: clamp(1rem, 2.5vw, 2rem);
        }

        .header {
          display: flex;
          align-items: end;
          justify-content: space-between;
          gap: 1rem;
          margin-bottom: 1.4rem;
        }

        h1 {
          margin: 0;
          font-size: clamp(1.6rem, 3vw, 2.7rem);
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          text-shadow: 0 0 24px rgba(0, 229, 255, 0.22);
        }

        .status {
          color: #8fbac4;
          font-size: 0.92rem;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          white-space: nowrap;
        }

        .toolbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 1rem;
          margin-bottom: 1.25rem;
          flex-wrap: wrap;
        }

        .toggle {
          display: inline-flex;
          gap: 0.25rem;
          padding: 0.28rem;
          border: 1px solid rgba(87, 222, 255, 0.18);
          border-radius: 999px;
          background: rgba(9, 18, 32, 0.72);
          box-shadow: 0 0 24px rgba(0, 229, 255, 0.06);
        }

        .toggle button {
          border: 0;
          border-radius: 999px;
          padding: 0.65rem 0.9rem;
          color: #8fbac4;
          background: transparent;
          cursor: pointer;
          font: inherit;
          font-size: 0.82rem;
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          transition: background 140ms ease, color 140ms ease, box-shadow 140ms ease;
        }

        .toggle button[aria-pressed="true"] {
          color: #e8fbff;
          background: rgba(0, 229, 255, 0.14);
          box-shadow: inset 0 0 0 1px rgba(105, 241, 255, 0.28), 0 0 22px rgba(0, 229, 255, 0.12);
        }

        .toggle button:hover,
        .toggle button:focus-visible {
          color: #e8fbff;
          outline: none;
        }

        .motion-summary {
          color: ${motionCount ? '#ffb8b8' : '#8fbac4'};
          font-size: 0.86rem;
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
        }

        .grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
          gap: clamp(0.85rem, 1.7vw, 1.25rem);
        }

        .card {
          position: relative;
          overflow: hidden;
          border: 1px solid rgba(87, 222, 255, 0.18);
          border-radius: 18px;
          background: rgba(9, 18, 32, 0.78);
          box-shadow: 0 14px 50px rgba(0, 0, 0, 0.34), 0 0 28px rgba(0, 225, 255, 0.05);
          cursor: pointer;
          transition: transform 140ms ease, border-color 140ms ease, box-shadow 140ms ease;
        }

        .card.motion {
          border-color: rgba(255, 68, 68, 0.92);
          box-shadow: 0 14px 50px rgba(0, 0, 0, 0.42), 0 0 28px rgba(255, 43, 43, 0.24);
          animation: motion-pulse 1.8s ease-in-out infinite;
        }

        .card:hover,
        .card:focus-visible {
          border-color: rgba(105, 241, 255, 0.48);
          box-shadow: 0 18px 60px rgba(0, 0, 0, 0.42), 0 0 34px rgba(0, 225, 255, 0.12);
          outline: none;
          transform: translateY(-2px);
        }

        .card.motion:hover,
        .card.motion:focus-visible {
          border-color: rgba(255, 90, 90, 1);
          box-shadow: 0 18px 60px rgba(0, 0, 0, 0.46), 0 0 42px rgba(255, 43, 43, 0.34);
        }

        @keyframes motion-pulse {
          0%, 100% {
            box-shadow: 0 14px 50px rgba(0, 0, 0, 0.42), 0 0 22px rgba(255, 43, 43, 0.18);
          }

          50% {
            box-shadow: 0 14px 50px rgba(0, 0, 0, 0.42), 0 0 42px rgba(255, 43, 43, 0.46);
          }
        }

        .frame {
          position: relative;
          aspect-ratio: 16 / 9;
          background: linear-gradient(135deg, #0b1220, #111827);
        }

        .frame::after {
          content: '';
          position: absolute;
          inset: 0;
          pointer-events: none;
          background: linear-gradient(180deg, transparent 70%, rgba(0, 0, 0, 0.32));
        }

        .motion-badge {
          position: absolute;
          top: 0.75rem;
          left: 0.75rem;
          z-index: 1;
          display: inline-flex;
          align-items: center;
          gap: 0.35rem;
          border: 1px solid rgba(255, 130, 130, 0.55);
          border-radius: 999px;
          padding: 0.35rem 0.55rem;
          color: #ffe9e9;
          background: rgba(88, 0, 0, 0.62);
          box-shadow: 0 0 22px rgba(255, 43, 43, 0.26);
          font-size: 0.72rem;
          font-weight: 800;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .motion-badge::before {
          content: '';
          width: 0.48rem;
          height: 0.48rem;
          border-radius: 50%;
          background: #ff3d3d;
          box-shadow: 0 0 12px rgba(255, 61, 61, 0.9);
        }

        img {
          display: block;
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .name {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 0.75rem;
          padding: 0.85rem 1rem 1rem;
          color: #d9f9ff;
          font-size: 0.98rem;
          font-weight: 600;
          letter-spacing: 0.02em;
        }

        .motion-dot {
          flex: 0 0 auto;
          width: 0.55rem;
          height: 0.55rem;
          border-radius: 50%;
          background: #ff3d3d;
          box-shadow: 0 0 14px rgba(255, 61, 61, 0.9);
        }

        .empty {
          display: grid;
          min-height: 40vh;
          place-items: center;
          border: 1px dashed rgba(143, 186, 196, 0.25);
          border-radius: 20px;
          color: #8fbac4;
          background: rgba(9, 18, 32, 0.5);
          text-align: center;
        }

        .fullscreen {
          position: fixed;
          inset: 0;
          z-index: 2147483647;
          display: grid;
          grid-template-rows: auto 1fr;
          background: rgba(3, 6, 12, 0.96);
          backdrop-filter: blur(12px);
        }

        .fullscreen-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 1rem;
          padding: 1rem clamp(1rem, 2vw, 1.6rem);
          border-bottom: 1px solid rgba(87, 222, 255, 0.16);
          background: rgba(7, 11, 19, 0.86);
        }

        .fullscreen-title {
          min-width: 0;
          overflow: hidden;
          color: #e8fbff;
          font-size: clamp(1rem, 2vw, 1.3rem);
          font-weight: 700;
          letter-spacing: 0.05em;
          text-overflow: ellipsis;
          text-transform: uppercase;
          white-space: nowrap;
        }

        .close {
          border: 1px solid rgba(105, 241, 255, 0.35);
          border-radius: 999px;
          padding: 0.65rem 1rem;
          color: #e8fbff;
          background: rgba(0, 229, 255, 0.08);
          cursor: pointer;
          font: inherit;
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
        }

        .close:hover,
        .close:focus-visible {
          border-color: rgba(105, 241, 255, 0.75);
          background: rgba(0, 229, 255, 0.16);
          outline: none;
        }

        .fullscreen-frame {
          display: grid;
          min-height: 0;
          place-items: center;
          padding: clamp(0.5rem, 1.5vw, 1rem);
        }

        .fullscreen-frame img {
          width: 100%;
          height: 100%;
          max-height: calc(100vh - 5rem);
          object-fit: contain;
          border-radius: 14px;
          box-shadow: 0 0 45px rgba(0, 229, 255, 0.12);
        }
      </style>

      <main class="shell">
        <header class="header">
          <h1>CCTV</h1>
          <div class="status">${cameras.length} camera${cameras.length === 1 ? '' : 's'} detected</div>
        </header>

        <section class="toolbar" aria-label="Camera view controls">
          <div class="toggle" role="group" aria-label="Camera display mode">
            <button type="button" class="mode-button" data-mode="all" aria-pressed="${!this._motionPriority}">All Cameras</button>
            <button type="button" class="mode-button" data-mode="motion" aria-pressed="${this._motionPriority}">Motion Priority Mode</button>
          </div>
          <div class="motion-summary">${motionCount} recent motion event${motionCount === 1 ? '' : 's'}</div>
        </section>

        ${cameras.length ? this._renderGrid(cameras) : this._renderEmpty()}
      </main>
    `;

    this.shadowRoot.querySelectorAll('.mode-button').forEach((button) => {
      button.addEventListener('click', () => this._setMotionPriority(button.dataset.mode === 'motion'));
    });

    this.shadowRoot.querySelectorAll('.card').forEach((card) => {
      card.addEventListener('click', () => this._openFullscreen(card.dataset.entityId));
      card.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          this._openFullscreen(card.dataset.entityId);
        }
      });
    });

    if (this._selectedCamera) {
      this._renderFullscreen();
    }
  }

  _renderGrid(cameras) {
    return `
      <section class="grid" aria-label="Camera feeds">
        ${cameras
          .map(
            (camera) => `
              <article class="card${camera.hasMotion ? ' motion' : ''}" tabindex="0" role="button" aria-label="Open ${this._escapeText(camera.name)} fullscreen" data-entity-id="${this._escapeText(camera.entityId)}">
                <div class="frame">
                  ${camera.hasMotion ? '<span class="motion-badge">Motion</span>' : ''}
                  <img loading="lazy" decoding="async" src="${this._cameraUrl(camera.entityId)}" alt="${this._escapeText(camera.name)} live camera feed">
                </div>
                <div class="name">
                  <span>${this._escapeText(camera.name)}</span>
                  ${camera.hasMotion ? '<span class="motion-dot" aria-label="Recent motion detected"></span>' : ''}
                </div>
              </article>
            `,
          )
          .join('')}
      </section>
    `;
  }

  _renderEmpty() {
    return '<section class="empty">No camera entities found in Home Assistant.</section>';
  }

  _renderFullscreen() {
    this._closeFullscreenElementOnly();

    const camera = this._selectedCamera;
    const overlay = document.createElement('section');
    overlay.className = 'fullscreen';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.innerHTML = `
      <div class="fullscreen-bar">
        <div class="fullscreen-title">${this._escapeText(camera.name)}</div>
        <button class="close" type="button" aria-label="Close fullscreen camera">Close</button>
      </div>
      <div class="fullscreen-frame">
        <img src="${this._cameraUrl(camera.entityId)}" alt="${this._escapeText(camera.name)} fullscreen live camera feed">
      </div>
    `;

    overlay.querySelector('.close').addEventListener('click', () => this._closeFullscreen());
    this.shadowRoot.appendChild(overlay);
    overlay.querySelector('.close').focus();
  }

  _closeFullscreenElementOnly() {
    const overlay = this.shadowRoot.querySelector('.fullscreen');
    if (overlay) {
      overlay.remove();
    }
  }

  _escapeText(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}

if (!customElements.get("cctv_app")) {
  customElements.define("cctv_app", CctvAppPanel);
}
