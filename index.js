class CctvAppPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._hass = null;
    this._renderSignature = null;
    this._view = 'grid';
    this._detailMode = 'fullscreen';
    this._selectedCameraEntityId = null;
    this._motionPriority = true;
    this._motionRefreshTimer = null;
    this._escapeHandler = (event) => {
      if (event.key === 'Escape') {
        if (this.shadowRoot.querySelector('.fullscreen')) {
          this._closeFullscreen();
          return;
        }

        if (this._view === 'detail') {
          this._backToGrid();
        }
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
    const selectedEntities = this._selectedCameraEntityId ? this._getDeviceEntities(this._selectedCameraEntityId) : [];
    const signature = [
      this._view,
      this._detailMode,
      this._selectedCameraEntityId || '',
      this._motionPriority,
      cameras.map((camera) => `${camera.entityId}:${camera.name}:${camera.hasMotion}:${camera.motionSensorId}:${camera.motionLastChanged}`).join('|'),
      selectedEntities.map((entity) => `${entity.entityId}:${entity.state.state}:${entity.name}`).join('|'),
    ].join('::');

    if (force || signature !== this._renderSignature) {
      this._renderSignature = signature;
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
          deviceId: this._deviceIdForEntity(entityId, state),
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
        deviceId: this._normalizeText(this._deviceIdForEntity(entityId, state)),
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
    const cameraDeviceId = this._normalizeText(this._deviceIdForEntity(cameraEntityId, cameraState));
    if (cameraDeviceId && sensor.deviceId && this._similarDeviceId(cameraDeviceId, sensor.deviceId)) {
      return true;
    }

    const cameraTokens = this._tokens(`${cameraEntityId} ${cameraState.attributes?.friendly_name || ''}`);
    const ignored = new Set(['camera', 'binary', 'sensor', 'motion', 'occupancy', 'presence', 'pir', 'person', 'activity', 'detection']);
    const cameraKeyTokens = cameraTokens.filter((token) => !ignored.has(token) && token.length > 2);

    return cameraKeyTokens.some((token) => sensor.tokens.includes(token) || sensor.text.includes(token));
  }

  _getDeviceEntities(cameraEntityId) {
    if (!this._hass || !this._hass.states) {
      return [];
    }

    const cameraState = this._hass.states[cameraEntityId];
    const cameraDeviceId = this._deviceIdForEntity(cameraEntityId, cameraState);
    if (!cameraDeviceId) {
      return [];
    }

    const allowedDomains = new Set(['sensor', 'binary_sensor', 'switch', 'button']);

    return Object.entries(this._hass.states)
      .filter(([entityId, state]) => {
        const domain = this._domain(entityId);
        return allowedDomains.has(domain) && this._deviceIdForEntity(entityId, state) === cameraDeviceId;
      })
      .sort(([leftId], [rightId]) => leftId.localeCompare(rightId))
      .map(([entityId, state]) => ({
        entityId,
        state,
        domain: this._domain(entityId),
        name: state.attributes?.friendly_name || entityId,
      }));
  }

  _groupDeviceEntities(entities) {
    return {
      sensors: entities.filter((entity) => entity.domain === 'sensor'),
      binarySensors: entities.filter((entity) => entity.domain === 'binary_sensor'),
      switches: entities.filter((entity) => entity.domain === 'switch'),
      buttons: entities.filter((entity) => entity.domain === 'button'),
    };
  }

  _deviceIdForEntity(entityId, state) {
    return String(
      state?.attributes?.device_id ||
        state?.attributes?.device ||
        state?.attributes?.device_identifier ||
        this._hass?.entities?.[entityId]?.device_id ||
        this._hass?.entityRegistry?.[entityId]?.device_id ||
        '',
    );
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

  _domain(entityId) {
    return entityId.split('.')[0];
  }

  _cameraUrl(entityId) {
    return `/api/camera_proxy/${encodeURIComponent(entityId)}`;
  }

  _openCameraDetail(entityId, mode = 'fullscreen') {
    const camera = this._getCameras().find((item) => item.entityId === entityId);
    if (!camera) {
      return;
    }

    this._selectedCameraEntityId = entityId;
    this._detailMode = mode;
    this._view = 'detail';
    this._renderIfNeeded(true);
  }

  _backToGrid() {
    this._view = 'grid';
    this._detailMode = 'fullscreen';
    this._selectedCameraEntityId = null;
    this._closeFullscreenElementOnly();
    this._renderIfNeeded(true);
  }

  _openFullscreen(entityId = this._selectedCameraEntityId) {
    const camera = this._getCameras().find((item) => item.entityId === entityId);
    if (!camera) {
      return;
    }

    this._renderFullscreen(camera);
  }

  _closeFullscreen() {
    this._closeFullscreenElementOnly();
  }

  _setMotionPriority(enabled) {
    if (this._motionPriority === enabled) {
      return;
    }

    this._motionPriority = enabled;
    this._renderIfNeeded(true);
  }

  _setDetailMode(mode) {
    if (this._detailMode === mode) {
      return;
    }

    this._detailMode = mode;
    this._renderIfNeeded(true);
  }

  _callEntityService(entityId, action) {
    if (!this._hass || !this._hass.callService) {
      return;
    }

    const domain = this._domain(entityId);
    if (domain === 'switch') {
      this._hass.callService('switch', action, { entity_id: entityId });
    }

    if (domain === 'button') {
      this._hass.callService('button', 'press', { entity_id: entityId });
    }
  }

  _render(cameras) {
    const selectedCamera = cameras.find((camera) => camera.entityId === this._selectedCameraEntityId);

    if (this._view === 'detail' && selectedCamera) {
      this._renderDetail(cameras, selectedCamera);
      return;
    }

    this._view = 'grid';
    this._renderGridPage(cameras);
  }

  _styles() {
    return `
      <style>
        :host {
          display: block;
          min-height: 100vh;
          color: #e8fbff;
          background:
            linear-gradient(135deg, rgba(0, 229, 255, 0.08), transparent 24rem),
            radial-gradient(circle at top left, rgba(0, 255, 255, 0.14), transparent 32rem),
            radial-gradient(circle at bottom right, rgba(78, 70, 255, 0.13), transparent 30rem),
            #070b13;
          font-family: Inter, Roboto, Arial, sans-serif;
          box-sizing: border-box;
        }

        * {
          box-sizing: border-box;
        }

        button {
          font: inherit;
        }

        .shell {
          width: min(1800px, 100%);
          margin: 0 auto;
          padding: clamp(1rem, 2.5vw, 2rem);
        }

        .header,
        .detail-topbar {
          display: flex;
          align-items: end;
          justify-content: space-between;
          gap: 1rem;
          margin-bottom: 1.4rem;
        }

        h1,
        h2,
        h3 {
          margin: 0;
        }

        h1 {
          font-size: clamp(1.6rem, 3vw, 2.7rem);
          font-weight: 800;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          text-shadow: 0 0 24px rgba(0, 229, 255, 0.22);
        }

        h2 {
          font-size: clamp(1.25rem, 2.3vw, 2rem);
          letter-spacing: 0.06em;
          text-transform: uppercase;
        }

        h3 {
          color: #e8fbff;
          font-size: 0.9rem;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .status,
        .meta,
        .entity-id {
          color: #8fbac4;
          font-size: 0.86rem;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .toolbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 1rem;
          margin-bottom: 1.25rem;
          flex-wrap: wrap;
        }

        .toggle,
        .detail-tabs {
          display: inline-flex;
          gap: 0.25rem;
          padding: 0.28rem;
          border: 1px solid rgba(87, 222, 255, 0.18);
          border-radius: 999px;
          background: rgba(9, 18, 32, 0.72);
          box-shadow: 0 0 24px rgba(0, 229, 255, 0.06);
        }

        .toggle button,
        .detail-tabs button,
        .back,
        .close,
        .control-action,
        .fullscreen-action {
          border: 1px solid transparent;
          border-radius: 999px;
          padding: 0.65rem 0.9rem;
          color: #8fbac4;
          background: transparent;
          cursor: pointer;
          font-weight: 800;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          transition: background 140ms ease, color 140ms ease, border-color 140ms ease, box-shadow 140ms ease, transform 140ms ease;
        }

        .toggle button[aria-pressed="true"],
        .detail-tabs button[aria-pressed="true"] {
          color: #e8fbff;
          background: rgba(0, 229, 255, 0.14);
          box-shadow: inset 0 0 0 1px rgba(105, 241, 255, 0.28), 0 0 22px rgba(0, 229, 255, 0.12);
        }

        .back,
        .close,
        .control-action,
        .fullscreen-action {
          border-color: rgba(105, 241, 255, 0.35);
          color: #e8fbff;
          background: rgba(0, 229, 255, 0.08);
        }

        .toggle button:hover,
        .toggle button:focus-visible,
        .detail-tabs button:hover,
        .detail-tabs button:focus-visible,
        .back:hover,
        .back:focus-visible,
        .close:hover,
        .close:focus-visible,
        .control-action:hover,
        .control-action:focus-visible,
        .fullscreen-action:hover,
        .fullscreen-action:focus-visible {
          border-color: rgba(105, 241, 255, 0.75);
          color: #e8fbff;
          outline: none;
          transform: translateY(-1px);
        }

        .motion-summary {
          color: #ffb8b8;
          font-size: 0.86rem;
          font-weight: 800;
          letter-spacing: 0.06em;
          text-transform: uppercase;
        }

        .grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
          gap: clamp(0.85rem, 1.7vw, 1.25rem);
        }

        .card,
        .dashboard-panel,
        .entity-group {
          border: 1px solid rgba(87, 222, 255, 0.18);
          border-radius: 18px;
          background: linear-gradient(145deg, rgba(9, 18, 32, 0.86), rgba(5, 10, 20, 0.72));
          box-shadow: 0 14px 50px rgba(0, 0, 0, 0.34), 0 0 28px rgba(0, 225, 255, 0.05);
        }

        .card {
          position: relative;
          overflow: hidden;
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

        .frame,
        .detail-feed {
          position: relative;
          overflow: hidden;
          background: linear-gradient(135deg, #0b1220, #111827);
        }

        .frame {
          aspect-ratio: 16 / 9;
        }

        .frame::after,
        .detail-feed::after {
          content: '';
          position: absolute;
          inset: 0;
          pointer-events: none;
          background:
            linear-gradient(180deg, transparent 68%, rgba(0, 0, 0, 0.36)),
            repeating-linear-gradient(0deg, rgba(255, 255, 255, 0.025) 0 1px, transparent 1px 5px);
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
          font-weight: 900;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .motion-badge::before,
        .motion-dot {
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
          font-weight: 700;
          letter-spacing: 0.02em;
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

        .detail-shell {
          display: grid;
          gap: 1rem;
        }

        .detail-topbar {
          align-items: center;
          margin-bottom: 0;
        }

        .detail-title {
          min-width: 0;
          display: grid;
          gap: 0.25rem;
        }

        .detail-title h2,
        .entity-name {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .dashboard-panel {
          overflow: hidden;
          min-height: 62vh;
        }

        .detail-feed {
          height: min(70vh, 760px);
          border-radius: 18px;
        }

        .detail-feed img {
          object-fit: contain;
        }

        .feed-hud {
          position: absolute;
          inset: auto 1rem 1rem 1rem;
          z-index: 1;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 1rem;
          padding: 0.8rem;
          border: 1px solid rgba(87, 222, 255, 0.18);
          border-radius: 14px;
          background: rgba(3, 6, 12, 0.72);
          backdrop-filter: blur(12px);
        }

        .control-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 1rem;
          padding: 1rem;
        }

        .entity-group {
          min-width: 0;
          padding: 1rem;
        }

        .entity-list {
          display: grid;
          gap: 0.7rem;
          margin-top: 0.85rem;
        }

        .entity-row {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          align-items: center;
          gap: 0.75rem;
          padding: 0.8rem;
          border: 1px solid rgba(87, 222, 255, 0.12);
          border-radius: 14px;
          background: rgba(2, 9, 18, 0.46);
        }

        .entity-name {
          color: #d9f9ff;
          font-weight: 800;
        }

        .entity-state {
          justify-self: end;
          border: 1px solid rgba(143, 186, 196, 0.18);
          border-radius: 999px;
          padding: 0.35rem 0.55rem;
          color: #e8fbff;
          background: rgba(0, 229, 255, 0.08);
          font-size: 0.78rem;
          font-weight: 900;
          letter-spacing: 0.06em;
          text-transform: uppercase;
        }

        .entity-state.on {
          border-color: rgba(94, 255, 177, 0.42);
          color: #caffdf;
          background: rgba(21, 156, 91, 0.18);
          box-shadow: 0 0 16px rgba(21, 156, 91, 0.2);
        }

        .control-action {
          grid-column: 1 / -1;
          justify-self: start;
          padding-inline: 1rem;
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
          font-weight: 800;
          letter-spacing: 0.05em;
          text-overflow: ellipsis;
          text-transform: uppercase;
          white-space: nowrap;
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

        @media (max-width: 900px) {
          .header,
          .detail-topbar,
          .feed-hud {
            align-items: stretch;
            flex-direction: column;
          }

          .control-grid {
            grid-template-columns: 1fr;
          }
        }
      </style>
    `;
  }

  _renderGridPage(cameras) {
    const motionCount = cameras.filter((camera) => camera.hasMotion).length;

    this.shadowRoot.innerHTML = `
      ${this._styles()}
      <main class="shell">
        <header class="header">
          <h1>CCTV Control Center</h1>
          <div class="status">${cameras.length} camera${cameras.length === 1 ? '' : 's'} detected</div>
        </header>

        <section class="toolbar" aria-label="Camera view controls">
          <div class="toggle" role="group" aria-label="Camera display mode">
            <button type="button" class="mode-button" data-mode="all" aria-pressed="${!this._motionPriority}">All Cameras</button>
            <button type="button" class="mode-button" data-mode="motion" aria-pressed="${this._motionPriority}">Motion Priority Mode</button>
          </div>
          <div class="motion-summary">${motionCount} recent motion event${motionCount === 1 ? '' : 's'}</div>
        </section>

        ${cameras.length ? this._renderCameraGrid(cameras) : this._renderEmpty()}
      </main>
    `;

    this.shadowRoot.querySelectorAll('.mode-button').forEach((button) => {
      button.addEventListener('click', () => this._setMotionPriority(button.dataset.mode === 'motion'));
    });

    this.shadowRoot.querySelectorAll('.card').forEach((card) => {
      card.addEventListener('click', () => this._openCameraDetail(card.dataset.entityId));
      card.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          this._openCameraDetail(card.dataset.entityId);
        }
      });
    });
  }

  _renderCameraGrid(cameras) {
    return `
      <section class="grid" aria-label="Camera feeds">
        ${cameras
          .map(
            (camera) => `
              <article class="card${camera.hasMotion ? ' motion' : ''}" tabindex="0" role="button" aria-label="Open ${this._escapeText(camera.name)} detail dashboard" data-entity-id="${this._escapeText(camera.entityId)}">
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

  _renderDetail(cameras, camera) {
    const deviceEntities = this._getDeviceEntities(camera.entityId);
    const grouped = this._groupDeviceEntities(deviceEntities);

    this.shadowRoot.innerHTML = `
      ${this._styles()}
      <main class="shell detail-shell">
        <header class="detail-topbar">
          <button class="back" type="button">Back to Grid</button>
          <div class="detail-title">
            <h2>${this._escapeText(camera.name)}</h2>
            <div class="meta">${this._escapeText(camera.entityId)} · ${camera.deviceId ? `Device ${this._escapeText(camera.deviceId)}` : 'No device_id exposed'}</div>
          </div>
          <div class="detail-tabs" role="group" aria-label="Camera detail mode">
            <button type="button" class="detail-mode" data-detail-mode="fullscreen" aria-pressed="${this._detailMode === 'fullscreen'}">Fullscreen View</button>
            <button type="button" class="detail-mode" data-detail-mode="controls" aria-pressed="${this._detailMode === 'controls'}">Device Controls</button>
          </div>
        </header>

        ${this._detailMode === 'controls' ? this._renderControlPanel(grouped, camera) : this._renderDetailFeed(camera)}
      </main>
    `;

    this.shadowRoot.querySelector('.back')?.addEventListener('click', () => this._backToGrid());
    this.shadowRoot.querySelectorAll('.detail-mode').forEach((button) => {
      button.addEventListener('click', () => this._setDetailMode(button.dataset.detailMode));
    });
    this.shadowRoot.querySelector('.fullscreen-action')?.addEventListener('click', () => this._openFullscreen(camera.entityId));
    this.shadowRoot.querySelectorAll('.control-action').forEach((button) => {
      button.addEventListener('click', () => this._callEntityService(button.dataset.entityId, button.dataset.action));
    });
  }

  _renderDetailFeed(camera) {
    return `
      <section class="dashboard-panel detail-feed" aria-label="Fullscreen camera view">
        ${camera.hasMotion ? '<span class="motion-badge">Motion</span>' : ''}
        <img src="${this._cameraUrl(camera.entityId)}" alt="${this._escapeText(camera.name)} fullscreen live camera feed">
        <div class="feed-hud">
          <div>
            <div class="entity-name">Live tactical feed</div>
            <div class="entity-id">${this._escapeText(camera.entityId)}</div>
          </div>
          <button class="fullscreen-action" type="button">Open Immersive</button>
        </div>
      </section>
    `;
  }

  _renderControlPanel(grouped, camera) {
    const total = grouped.sensors.length + grouped.binarySensors.length + grouped.switches.length + grouped.buttons.length;

    return `
      <section class="dashboard-panel" aria-label="Device control panel">
        <div class="control-grid">
          ${total ? '' : `<section class="empty">No sensor, binary_sensor, switch, or button entities share the device_id for ${this._escapeText(camera.name)}.</section>`}
          ${this._renderEntityGroup('Sensors', grouped.sensors)}
          ${this._renderEntityGroup('Binary Sensors', grouped.binarySensors)}
          ${this._renderEntityGroup('Switches', grouped.switches)}
          ${this._renderEntityGroup('Buttons', grouped.buttons)}
        </div>
      </section>
    `;
  }

  _renderEntityGroup(title, entities) {
    if (!entities.length) {
      return '';
    }

    return `
      <section class="entity-group">
        <h3>${this._escapeText(title)}</h3>
        <div class="entity-list">
          ${entities.map((entity) => this._renderEntityRow(entity)).join('')}
        </div>
      </section>
    `;
  }

  _renderEntityRow(entity) {
    const stateClass = this._normalizeText(entity.state.state) === 'on' ? ' on' : '';
    const action = entity.domain === 'switch' ? (entity.state.state === 'on' ? 'turn_off' : 'turn_on') : 'press';
    const actionLabel = entity.domain === 'switch' ? (entity.state.state === 'on' ? 'Turn Off' : 'Turn On') : 'Press';
    const canControl = entity.domain === 'switch' || entity.domain === 'button';

    return `
      <article class="entity-row">
        <div>
          <div class="entity-name">${this._escapeText(entity.name)}</div>
          <div class="entity-id">${this._escapeText(entity.entityId)}</div>
        </div>
        <div class="entity-state${stateClass}">${this._escapeText(entity.state.state)}</div>
        ${canControl ? `<button class="control-action" type="button" data-entity-id="${this._escapeText(entity.entityId)}" data-action="${action}">${actionLabel}</button>` : ''}
      </article>
    `;
  }

  _renderEmpty() {
    return '<section class="empty">No camera entities found in Home Assistant.</section>';
  }

  _renderFullscreen(camera) {
    this._closeFullscreenElementOnly();

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
        <img src="${this._cameraUrl(camera.entityId)}" alt="${this._escapeText(camera.name)} immersive live camera feed">
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
