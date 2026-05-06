class CctvAppPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });

    this._hass = null;
    this._uiReady = false;
    this._updateQueued = false;
    this._updateHandle = null;
    this._lastCameras = [];
    this._cameraCards = new Map();
    this._entityRows = new Map();
    this._gridOrder = '';

    this._view = 'grid';
    this._detailMode = 'fullscreen';
    this._selectedCameraEntityId = null;
    this._motionPriority = true;

    this._autoCycleEnabled = false;
    this._autoCyclePaused = false;
    this._autoCycleScope = 'all';
    this._autoCycleInterval = 8;
    this._autoCycleEntityId = null;
    this._autoCycleTimer = null;
    this._motionRefreshTimer = null;

    this._onKeyDown = (event) => this._handleKeyDown(event);
    this._onClick = (event) => this._handleClick(event);
    this._onInput = (event) => this._handleInput(event);
    this._onShadowKeyDown = (event) => this._handleShadowKeyDown(event);
    this._onAutoCyclePointer = (event) => this._handleAutoCycleInteraction(event);
  }

  set hass(hass) {
    this._hass = hass;
    this._scheduleUpdate();
  }

  connectedCallback() {
    this._ensureUi();
    document.addEventListener('keydown', this._onKeyDown);
    this.shadowRoot.addEventListener('click', this._onClick);
    this.shadowRoot.addEventListener('input', this._onInput);
    this.shadowRoot.addEventListener('keydown', this._onShadowKeyDown);
    this._refs?.autoOverlay?.addEventListener('pointerdown', this._onAutoCyclePointer);

    if (!this._motionRefreshTimer) {
      this._motionRefreshTimer = window.setInterval(() => this._scheduleUpdate(), 30000);
    }

    this._scheduleUpdate(true);
  }

  disconnectedCallback() {
    document.removeEventListener('keydown', this._onKeyDown);
    this.shadowRoot.removeEventListener('click', this._onClick);
    this.shadowRoot.removeEventListener('input', this._onInput);
    this.shadowRoot.removeEventListener('keydown', this._onShadowKeyDown);
    this._refs?.autoOverlay?.removeEventListener('pointerdown', this._onAutoCyclePointer);

    if (this._motionRefreshTimer) {
      window.clearInterval(this._motionRefreshTimer);
      this._motionRefreshTimer = null;
    }

    if (this._updateHandle) {
      window.cancelAnimationFrame(this._updateHandle);
      this._updateHandle = null;
    }

    this._clearAutoCycleTimer();
  }

  _scheduleUpdate(force = false) {
    if (!this.isConnected && !force) {
      return;
    }

    this._ensureUi();
    if (this._updateQueued) {
      return;
    }

    this._updateQueued = true;
    this._updateHandle = window.requestAnimationFrame(() => {
      this._updateQueued = false;
      this._updateHandle = null;
      this._update();
    });
  }

  _update() {
    const cameras = this._getCameras();
    this._lastCameras = cameras;

    const selectedStillExists = cameras.some((camera) => camera.entityId === this._selectedCameraEntityId);
    if (this._view === 'detail' && !selectedStillExists) {
      this._backToGrid(false);
    }

    this._updateGridPage(cameras);
    this._updateDetailPage(cameras);
    this._updateAutoCycleOverlay(cameras);
  }

  _ensureUi() {
    if (this._uiReady) {
      return;
    }

    this.shadowRoot.innerHTML = `
      ${this._styles()}
      <main class="shell grid-page" data-page="grid">
        <header class="header">
          <h1>CCTV Control Center</h1>
          <div class="status camera-count">0 cameras detected</div>
        </header>

        <section class="toolbar" aria-label="Camera view controls">
          <div class="toggle" role="group" aria-label="Camera display mode">
            <button type="button" class="mode-button" data-mode="all" aria-pressed="false">All Cameras</button>
            <button type="button" class="mode-button" data-mode="motion" aria-pressed="true">Motion Priority Mode</button>
          </div>
          <div class="motion-summary">0 recent motion events</div>
        </section>

        <section class="cycle-panel" aria-label="Auto-cycle mode">
          <div class="cycle-status">
            <div class="cycle-title">Auto-Cycle Mode · Ready</div>
            <div class="cycle-meta">0 eligible · 0 online · 0 motion · No camera queued</div>
          </div>
          <div class="toggle" role="group" aria-label="Auto-cycle camera scope">
            <button type="button" class="cycle-button cycle-scope" data-cycle-scope="all" aria-pressed="true">All Cameras</button>
            <button type="button" class="cycle-button cycle-scope" data-cycle-scope="motion" aria-pressed="false">Motion Only</button>
          </div>
          <label class="cycle-range">
            <span class="cycle-interval-label">8s</span>
            <input class="cycle-interval" type="range" min="5" max="15" step="1" value="8" aria-label="Auto-cycle interval seconds">
          </label>
          <div class="fullscreen-actions cycle-actions">
            <button type="button" class="cycle-button cycle-start">Start Cycle</button>
            <button type="button" class="cycle-button cycle-pause" hidden>Pause</button>
            <button type="button" class="cycle-button cycle-resume" hidden>Resume</button>
            <button type="button" class="cycle-button cycle-stop" hidden>Stop</button>
          </div>
        </section>

        <section class="grid scale-balanced" aria-label="Camera feeds"></section>
        <section class="empty" hidden>No camera entities found in Home Assistant.</section>
      </main>

      <main class="shell detail-shell" data-page="detail" hidden>
        <header class="detail-topbar">
          <button class="back" type="button">Back to Grid</button>
          <div class="detail-title">
            <h2 class="detail-name"></h2>
            <div class="meta detail-meta"></div>
          </div>
          <div class="detail-tabs" role="group" aria-label="Camera detail mode">
            <button type="button" class="detail-mode" data-detail-mode="fullscreen" aria-pressed="true">Fullscreen View</button>
            <button type="button" class="detail-mode" data-detail-mode="controls" aria-pressed="false">Device Controls</button>
          </div>
        </header>

        <section class="dashboard-panel detail-feed" aria-label="Fullscreen camera view">
          <span class="motion-badge detail-motion" hidden>Motion</span>
          <img class="detail-image" alt="Fullscreen live camera feed">
          <div class="feed-hud">
            <div>
              <div class="entity-name">Live tactical feed</div>
              <div class="entity-id detail-feed-status"><span class="status-light"></span>Offline</div>
            </div>
            <button class="fullscreen-action" type="button">Open Immersive</button>
          </div>
        </section>

        <section class="dashboard-panel control-panel" aria-label="Device control panel" hidden>
          <div class="control-grid">
            <section class="empty controls-empty" hidden>No sensor, binary_sensor, switch, or button entities share this camera device_id.</section>
            <section class="entity-group" data-group="sensors" hidden><h3>Sensors</h3><div class="entity-list"></div></section>
            <section class="entity-group" data-group="binarySensors" hidden><h3>Binary Sensors</h3><div class="entity-list"></div></section>
            <section class="entity-group" data-group="switches" hidden><h3>Switches</h3><div class="entity-list"></div></section>
            <section class="entity-group" data-group="buttons" hidden><h3>Buttons</h3><div class="entity-list"></div></section>
          </div>
        </section>
      </main>

      <section class="fullscreen auto-cycle" role="dialog" aria-modal="true" hidden>
        <div class="fullscreen-bar">
          <div>
            <div class="fullscreen-title auto-title"></div>
            <div class="fullscreen-subtitle auto-subtitle"></div>
          </div>
          <div class="fullscreen-actions auto-cycle-control">
            <button class="close cycle-pause" type="button">Pause</button>
            <button class="close cycle-resume" type="button" hidden>Resume</button>
            <button class="close cycle-stop" type="button" aria-label="Stop auto-cycle mode">Stop</button>
          </div>
        </div>
        <div class="fullscreen-frame">
          <div class="pause-ribbon" hidden>Cycling Paused</div>
          <img class="auto-image" alt="Auto-cycle live camera feed">
        </div>
      </section>

      <section class="fullscreen immersive" role="dialog" aria-modal="true" hidden>
        <div class="fullscreen-bar">
          <div class="fullscreen-title immersive-title"></div>
          <button class="close immersive-close" type="button" aria-label="Close fullscreen camera">Close</button>
        </div>
        <div class="fullscreen-frame">
          <img class="immersive-image" alt="Immersive live camera feed">
        </div>
      </section>
    `;

    this._refs = {
      gridPage: this.shadowRoot.querySelector('[data-page="grid"]'),
      detailPage: this.shadowRoot.querySelector('[data-page="detail"]'),
      cameraCount: this.shadowRoot.querySelector('.camera-count'),
      motionSummary: this.shadowRoot.querySelector('.motion-summary'),
      modeAll: this.shadowRoot.querySelector('.mode-button[data-mode="all"]'),
      modeMotion: this.shadowRoot.querySelector('.mode-button[data-mode="motion"]'),
      cyclePanel: this.shadowRoot.querySelector('.cycle-panel'),
      cycleTitle: this.shadowRoot.querySelector('.cycle-title'),
      cycleMeta: this.shadowRoot.querySelector('.cycle-meta'),
      cycleScopeAll: this.shadowRoot.querySelector('.cycle-scope[data-cycle-scope="all"]'),
      cycleScopeMotion: this.shadowRoot.querySelector('.cycle-scope[data-cycle-scope="motion"]'),
      cycleInterval: this.shadowRoot.querySelector('.cycle-interval'),
      cycleIntervalLabel: this.shadowRoot.querySelector('.cycle-interval-label'),
      cycleStart: this.shadowRoot.querySelector('.cycle-start'),
      cyclePause: this.shadowRoot.querySelector('.cycle-actions .cycle-pause'),
      cycleResume: this.shadowRoot.querySelector('.cycle-actions .cycle-resume'),
      cycleStop: this.shadowRoot.querySelector('.cycle-actions .cycle-stop'),
      grid: this.shadowRoot.querySelector('.grid'),
      gridEmpty: this.shadowRoot.querySelector('.grid-page > .empty'),
      detailName: this.shadowRoot.querySelector('.detail-name'),
      detailMeta: this.shadowRoot.querySelector('.detail-meta'),
      detailFeed: this.shadowRoot.querySelector('.detail-feed'),
      detailMotion: this.shadowRoot.querySelector('.detail-motion'),
      detailImage: this.shadowRoot.querySelector('.detail-image'),
      detailFeedStatus: this.shadowRoot.querySelector('.detail-feed-status'),
      detailModeFullscreen: this.shadowRoot.querySelector('.detail-mode[data-detail-mode="fullscreen"]'),
      detailModeControls: this.shadowRoot.querySelector('.detail-mode[data-detail-mode="controls"]'),
      controlPanel: this.shadowRoot.querySelector('.control-panel'),
      controlsEmpty: this.shadowRoot.querySelector('.controls-empty'),
      autoOverlay: this.shadowRoot.querySelector('.auto-cycle'),
      autoTitle: this.shadowRoot.querySelector('.auto-title'),
      autoSubtitle: this.shadowRoot.querySelector('.auto-subtitle'),
      autoImage: this.shadowRoot.querySelector('.auto-image'),
      autoPause: this.shadowRoot.querySelector('.auto-cycle .cycle-pause'),
      autoResume: this.shadowRoot.querySelector('.auto-cycle .cycle-resume'),
      pauseRibbon: this.shadowRoot.querySelector('.pause-ribbon'),
      immersive: this.shadowRoot.querySelector('.immersive'),
      immersiveTitle: this.shadowRoot.querySelector('.immersive-title'),
      immersiveImage: this.shadowRoot.querySelector('.immersive-image'),
    };

    this._uiReady = true;
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
          status: state.state,
          isOnline: this._isOnlineCameraState(state),
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
    if (!this._hass?.states) {
      return [];
    }

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
    if (!this._hass?.states) {
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

  _updateGridPage(cameras) {
    const inGrid = this._view === 'grid';
    const motionCount = cameras.filter((camera) => camera.hasMotion).length;
    this._refs.gridPage.hidden = !inGrid;
    this._refs.cameraCount.textContent = `${cameras.length} camera${cameras.length === 1 ? '' : 's'} detected`;
    this._refs.motionSummary.textContent = `${motionCount} recent motion event${motionCount === 1 ? '' : 's'}`;
    this._refs.modeAll.setAttribute('aria-pressed', String(!this._motionPriority));
    this._refs.modeMotion.setAttribute('aria-pressed', String(this._motionPriority));

    this._updateAutoCycleControls(cameras);
    this._updateCameraCards(cameras);
  }

  _updateCameraCards(cameras) {
    this._refs.grid.hidden = !cameras.length;
    this._refs.gridEmpty.hidden = Boolean(cameras.length);
    this._refs.grid.className = `grid ${this._gridScaleClass(cameras.length)}`;

    const seen = new Set();
    const order = cameras.map((camera) => camera.entityId).join('|');

    cameras.forEach((camera) => {
      seen.add(camera.entityId);
      const card = this._cameraCards.get(camera.entityId) || this._createCameraCard(camera.entityId);
      this._updateCameraCard(card, camera);
    });

    this._cameraCards.forEach((card, entityId) => {
      if (!seen.has(entityId)) {
        card.root.remove();
        this._cameraCards.delete(entityId);
      }
    });

    if (order !== this._gridOrder) {
      const fragment = document.createDocumentFragment();
      cameras.forEach((camera) => fragment.appendChild(this._cameraCards.get(camera.entityId).root));
      this._refs.grid.appendChild(fragment);
      this._gridOrder = order;
    }
  }

  _createCameraCard(entityId) {
    const root = document.createElement('article');
    root.className = 'card';
    root.tabIndex = 0;
    root.setAttribute('role', 'button');
    root.dataset.entityId = entityId;
    root.innerHTML = `
      <div class="frame">
        <span class="motion-badge" hidden>Motion</span>
        <span class="status-pill">Online</span>
        <img loading="lazy" decoding="async" alt="Live camera feed">
      </div>
      <div class="name">
        <span class="name-meta"><span class="camera-name"></span><span class="status-light" aria-label="Online"></span></span>
        <span class="motion-dot" aria-label="Recent motion detected" hidden></span>
      </div>
    `;

    const card = {
      root,
      motionBadge: root.querySelector('.motion-badge'),
      statusPill: root.querySelector('.status-pill'),
      image: root.querySelector('img'),
      name: root.querySelector('.camera-name'),
      statusLight: root.querySelector('.status-light'),
      motionDot: root.querySelector('.motion-dot'),
      signature: '',
    };
    this._cameraCards.set(entityId, card);
    return card;
  }

  _updateCameraCard(card, camera) {
    const isActive = camera.entityId === this._selectedCameraEntityId || camera.entityId === this._autoCycleEntityId;
    const statusText = camera.isOnline ? 'Online' : 'Offline';
    const src = this._cameraUrl(camera.entityId);
    const signature = [camera.name, camera.hasMotion, camera.isOnline, statusText, isActive, src].join('|');

    if (card.signature === signature) {
      return;
    }

    card.signature = signature;
    card.root.className = `card${camera.hasMotion ? ' motion' : ''}${isActive ? ' active' : ''}`;
    card.root.setAttribute('aria-label', `Open ${camera.name} detail dashboard`);
    card.motionBadge.hidden = !camera.hasMotion;
    card.motionDot.hidden = !camera.hasMotion;
    card.statusPill.className = `status-pill${camera.isOnline ? '' : ' offline'}`;
    card.statusPill.textContent = statusText;
    card.statusLight.className = `status-light${camera.isOnline ? '' : ' offline'}`;
    card.statusLight.setAttribute('aria-label', statusText);
    card.name.textContent = camera.name;
    card.image.alt = `${camera.name} live camera feed`;
    if (card.image.getAttribute('src') !== src) {
      card.image.setAttribute('src', src);
    }
  }

  _updateDetailPage(cameras) {
    const camera = cameras.find((item) => item.entityId === this._selectedCameraEntityId);
    const showDetail = this._view === 'detail' && Boolean(camera);
    this._refs.detailPage.hidden = !showDetail;
    if (!showDetail) {
      return;
    }

    this._refs.detailName.textContent = camera.name;
    this._refs.detailMeta.textContent = `${camera.entityId} · ${camera.deviceId ? `Device ${camera.deviceId}` : 'No device_id exposed'}`;
    this._refs.detailModeFullscreen.setAttribute('aria-pressed', String(this._detailMode === 'fullscreen'));
    this._refs.detailModeControls.setAttribute('aria-pressed', String(this._detailMode === 'controls'));
    this._refs.detailFeed.hidden = this._detailMode !== 'fullscreen';
    this._refs.controlPanel.hidden = this._detailMode !== 'controls';

    if (this._detailMode === 'fullscreen') {
      this._updateDetailFeed(camera);
    } else {
      this._updateControlPanel(camera);
    }
  }

  _updateDetailFeed(camera) {
    const src = this._cameraUrl(camera.entityId);
    this._refs.detailMotion.hidden = !camera.hasMotion;
    this._refs.detailImage.alt = `${camera.name} fullscreen live camera feed`;
    if (this._refs.detailImage.getAttribute('src') !== src) {
      this._refs.detailImage.setAttribute('src', src);
    }

    this._refs.detailFeedStatus.innerHTML = '';
    const light = document.createElement('span');
    light.className = `status-light${camera.isOnline ? '' : ' offline'}`;
    this._refs.detailFeedStatus.append(light, `${camera.isOnline ? 'Online' : 'Offline'} · ${camera.entityId}`);
  }

  _updateControlPanel(camera) {
    const grouped = this._groupDeviceEntities(this._getDeviceEntities(camera.entityId));
    const total = grouped.sensors.length + grouped.binarySensors.length + grouped.switches.length + grouped.buttons.length;
    this._refs.controlsEmpty.hidden = Boolean(total);
    this._updateEntityGroup('sensors', grouped.sensors);
    this._updateEntityGroup('binarySensors', grouped.binarySensors);
    this._updateEntityGroup('switches', grouped.switches);
    this._updateEntityGroup('buttons', grouped.buttons);
  }

  _updateEntityGroup(groupName, entities) {
    const group = this.shadowRoot.querySelector(`[data-group="${groupName}"]`);
    const list = group.querySelector('.entity-list');
    group.hidden = !entities.length;

    const seen = new Set();
    const fragment = document.createDocumentFragment();

    entities.forEach((entity) => {
      seen.add(entity.entityId);
      const row = this._entityRows.get(entity.entityId) || this._createEntityRow(entity.entityId);
      this._updateEntityRow(row, entity);
      fragment.appendChild(row.root);
    });

    this._entityRows.forEach((row, entityId) => {
      if (row.groupName === groupName && !seen.has(entityId)) {
        row.root.remove();
        this._entityRows.delete(entityId);
      }
    });

    list.appendChild(fragment);
  }

  _createEntityRow(entityId) {
    const root = document.createElement('article');
    root.className = 'entity-row';
    root.dataset.entityId = entityId;
    root.innerHTML = `
      <div>
        <div class="entity-name"></div>
        <div class="entity-id"></div>
      </div>
      <div class="entity-state"></div>
      <button class="control-action" type="button"></button>
    `;

    const row = {
      root,
      name: root.querySelector('.entity-name'),
      id: root.querySelector('.entity-id'),
      state: root.querySelector('.entity-state'),
      action: root.querySelector('.control-action'),
      signature: '',
      groupName: '',
    };
    this._entityRows.set(entityId, row);
    return row;
  }

  _updateEntityRow(row, entity) {
    const canControl = entity.domain === 'switch' || entity.domain === 'button';
    const action = entity.domain === 'switch' ? (entity.state.state === 'on' ? 'turn_off' : 'turn_on') : 'press';
    const actionLabel = entity.domain === 'switch' ? (entity.state.state === 'on' ? 'Turn Off' : 'Turn On') : 'Press';
    const stateClass = this._normalizeText(entity.state.state) === 'on' ? ' on' : '';
    const groupName = entity.domain === 'binary_sensor' ? 'binarySensors' : `${entity.domain}s`;
    const signature = [entity.name, entity.entityId, entity.state.state, canControl, action, actionLabel, groupName].join('|');

    if (row.signature === signature) {
      return;
    }

    row.signature = signature;
    row.groupName = groupName;
    row.name.textContent = entity.name;
    row.id.textContent = entity.entityId;
    row.state.className = `entity-state${stateClass}`;
    row.state.textContent = entity.state.state;
    row.action.hidden = !canControl;
    row.action.dataset.entityId = entity.entityId;
    row.action.dataset.action = action;
    row.action.textContent = actionLabel;
  }

  _updateAutoCycleControls(cameras) {
    const onlineCount = cameras.filter((camera) => camera.isOnline).length;
    const eligibleCount = this._getCycleCameras(cameras).length;
    const motionEligibleCount = cameras.filter((camera) => camera.isOnline && camera.hasMotion).length;
    const stateText = this._autoCycleEnabled ? (this._autoCyclePaused ? 'Paused' : 'Cycling') : 'Ready';
    const currentCamera = this._currentCycleCamera(cameras);

    this._refs.cycleTitle.textContent = `Auto-Cycle Mode · ${stateText}`;
    this._refs.cycleMeta.textContent = `${eligibleCount} eligible · ${onlineCount} online · ${motionEligibleCount} motion · ${currentCamera ? currentCamera.name : 'No camera queued'}`;
    this._refs.cycleScopeAll.setAttribute('aria-pressed', String(this._autoCycleScope === 'all'));
    this._refs.cycleScopeMotion.setAttribute('aria-pressed', String(this._autoCycleScope === 'motion'));
    this._refs.cycleInterval.value = String(this._autoCycleInterval);
    this._refs.cycleIntervalLabel.textContent = `${this._autoCycleInterval}s`;
    this._refs.cycleStart.hidden = this._autoCycleEnabled;
    this._refs.cyclePause.hidden = !this._autoCycleEnabled || this._autoCyclePaused;
    this._refs.cycleResume.hidden = !this._autoCycleEnabled || !this._autoCyclePaused;
    this._refs.cycleStop.hidden = !this._autoCycleEnabled;
  }

  _updateAutoCycleOverlay(cameras) {
    if (!this._autoCycleEnabled) {
      this._refs.autoOverlay.hidden = true;
      return;
    }

    const camera = this._currentCycleCamera(cameras);
    if (!camera) {
      this._autoCyclePaused = true;
      this._clearAutoCycleTimer();
      this._refs.autoOverlay.hidden = true;
      return;
    }

    this._autoCycleEntityId = camera.entityId;
    this._refs.autoOverlay.hidden = false;
    this._refs.autoOverlay.className = `fullscreen auto-cycle${this._autoCyclePaused ? ' auto-cycle-paused' : ''}`;
    this._refs.autoTitle.textContent = `Auto-Cycle · ${camera.name}`;
    this._refs.autoSubtitle.textContent = `${this._autoCyclePaused ? 'Paused by interaction' : `Next camera in ${this._autoCycleInterval}s`} · ${this._autoCycleScope === 'motion' ? 'Motion-only cameras' : 'All online cameras'}`;
    this._refs.autoPause.hidden = this._autoCyclePaused;
    this._refs.autoResume.hidden = !this._autoCyclePaused;
    this._refs.pauseRibbon.hidden = !this._autoCyclePaused;
    this._refs.autoImage.alt = `${camera.name} auto-cycle live camera feed`;
    const src = this._cameraUrl(camera.entityId);
    if (this._refs.autoImage.getAttribute('src') !== src) {
      this._refs.autoImage.setAttribute('src', src);
    }
  }

  _gridScaleClass(count) {
    if (count <= 4) {
      return 'scale-few';
    }

    if (count >= 10) {
      return 'scale-wall';
    }

    return 'scale-balanced';
  }

  _openCameraDetail(entityId, mode = 'fullscreen') {
    if (!this._lastCameras.some((camera) => camera.entityId === entityId)) {
      return;
    }

    this._selectedCameraEntityId = entityId;
    this._detailMode = mode;
    this._view = 'detail';
    this._scheduleUpdate(true);
  }

  _backToGrid(schedule = true) {
    this._view = 'grid';
    this._detailMode = 'fullscreen';
    this._selectedCameraEntityId = null;
    this._closeFullscreenElementOnly();
    if (schedule) {
      this._scheduleUpdate(true);
    }
  }

  _openFullscreen(entityId = this._selectedCameraEntityId) {
    const camera = this._lastCameras.find((item) => item.entityId === entityId) || this._getCameras().find((item) => item.entityId === entityId);
    if (!camera) {
      return;
    }

    this._refs.immersive.hidden = false;
    this._refs.immersiveTitle.textContent = camera.name;
    this._refs.immersiveImage.alt = `${camera.name} immersive live camera feed`;
    const src = this._cameraUrl(camera.entityId);
    if (this._refs.immersiveImage.getAttribute('src') !== src) {
      this._refs.immersiveImage.setAttribute('src', src);
    }
    this.shadowRoot.querySelector('.immersive-close').focus();
  }

  _closeFullscreen() {
    this._closeFullscreenElementOnly();
  }

  _closeFullscreenElementOnly() {
    this._refs.immersive.hidden = true;
  }

  _startAutoCycle() {
    const camera = this._currentCycleCamera();
    if (!camera) {
      return;
    }

    this._autoCycleEnabled = true;
    this._autoCyclePaused = false;
    this._autoCycleEntityId = camera.entityId;
    this._scheduleUpdate(true);
    this._scheduleAutoCycle();
  }

  _resumeAutoCycle() {
    if (!this._autoCycleEnabled) {
      this._startAutoCycle();
      return;
    }

    const camera = this._currentCycleCamera();
    if (!camera) {
      this._stopAutoCycle();
      return;
    }

    this._autoCyclePaused = false;
    this._autoCycleEntityId = camera.entityId;
    this._scheduleUpdate(true);
    this._scheduleAutoCycle();
  }

  _pauseAutoCycle() {
    if (!this._autoCycleEnabled || this._autoCyclePaused) {
      return;
    }

    this._autoCyclePaused = true;
    this._clearAutoCycleTimer();
    this._scheduleUpdate(true);
  }

  _stopAutoCycle() {
    this._autoCycleEnabled = false;
    this._autoCyclePaused = false;
    this._autoCycleEntityId = null;
    this._clearAutoCycleTimer();
    this._scheduleUpdate(true);
  }

  _advanceAutoCycle() {
    if (!this._autoCycleEnabled || this._autoCyclePaused) {
      return;
    }

    const cameras = this._getCycleCameras();
    if (!cameras.length) {
      this._stopAutoCycle();
      return;
    }

    const currentIndex = Math.max(0, cameras.findIndex((camera) => camera.entityId === this._autoCycleEntityId));
    this._autoCycleEntityId = cameras[(currentIndex + 1) % cameras.length].entityId;
    this._scheduleUpdate(true);
    this._scheduleAutoCycle();
  }

  _scheduleAutoCycle() {
    this._clearAutoCycleTimer();
    if (!this._autoCycleEnabled || this._autoCyclePaused) {
      return;
    }

    this._autoCycleTimer = window.setTimeout(() => this._advanceAutoCycle(), this._autoCycleInterval * 1000);
  }

  _clearAutoCycleTimer() {
    if (this._autoCycleTimer) {
      window.clearTimeout(this._autoCycleTimer);
      this._autoCycleTimer = null;
    }
  }

  _setMotionPriority(enabled) {
    if (this._motionPriority === enabled) {
      return;
    }

    this._motionPriority = enabled;
    this._scheduleUpdate(true);
  }

  _setDetailMode(mode) {
    if (this._detailMode === mode) {
      return;
    }

    this._detailMode = mode;
    this._scheduleUpdate(true);
  }

  _setAutoCycleInterval(value) {
    const nextInterval = Math.min(15, Math.max(5, Number(value) || 8));
    if (this._autoCycleInterval === nextInterval) {
      return;
    }

    this._autoCycleInterval = nextInterval;
    this._scheduleUpdate(true);
    this._scheduleAutoCycle();
  }

  _setAutoCycleScope(scope) {
    if (!['all', 'motion'].includes(scope) || this._autoCycleScope === scope) {
      return;
    }

    this._autoCycleScope = scope;
    const camera = this._currentCycleCamera();
    this._autoCycleEntityId = camera?.entityId || null;
    if (this._autoCycleEnabled && !camera) {
      this._autoCyclePaused = true;
      this._clearAutoCycleTimer();
    }

    this._scheduleUpdate(true);
    this._scheduleAutoCycle();
  }

  _getCycleCameras(cameras = this._getCameras()) {
    return cameras.filter((camera) => camera.isOnline && (this._autoCycleScope === 'all' || camera.hasMotion));
  }

  _currentCycleCamera(cameras = this._getCameras()) {
    const cycleCameras = this._getCycleCameras(cameras);
    return cycleCameras.find((camera) => camera.entityId === this._autoCycleEntityId) || cycleCameras[0] || null;
  }

  _handleKeyDown(event) {
    if (event.key !== 'Escape') {
      return;
    }

    if (!this._refs?.autoOverlay.hidden) {
      this._pauseAutoCycle();
      return;
    }

    if (!this._refs?.immersive.hidden) {
      this._closeFullscreen();
      return;
    }

    if (this._view === 'detail') {
      this._backToGrid();
    }
  }

  _handleShadowKeyDown(event) {
    const card = event.target.closest('.card');
    if (card && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      this._openCameraDetail(card.dataset.entityId);
    }
  }

  _handleClick(event) {
    const card = event.target.closest('.card');
    if (card) {
      this._openCameraDetail(card.dataset.entityId);
      return;
    }

    if (event.target.closest('.back')) {
      this._backToGrid();
      return;
    }

    const modeButton = event.target.closest('.mode-button');
    if (modeButton) {
      this._setMotionPriority(modeButton.dataset.mode === 'motion');
      return;
    }

    const detailButton = event.target.closest('.detail-mode');
    if (detailButton) {
      this._setDetailMode(detailButton.dataset.detailMode);
      return;
    }

    const cycleScope = event.target.closest('.cycle-scope');
    if (cycleScope) {
      this._setAutoCycleScope(cycleScope.dataset.cycleScope);
      return;
    }

    if (event.target.closest('.cycle-start')) {
      this._startAutoCycle();
      return;
    }

    if (event.target.closest('.cycle-pause')) {
      this._pauseAutoCycle();
      return;
    }

    if (event.target.closest('.cycle-resume')) {
      this._resumeAutoCycle();
      return;
    }

    if (event.target.closest('.cycle-stop')) {
      this._stopAutoCycle();
      return;
    }

    if (event.target.closest('.fullscreen-action')) {
      this._openFullscreen(this._selectedCameraEntityId);
      return;
    }

    if (event.target.closest('.immersive-close')) {
      this._closeFullscreen();
      return;
    }

    const action = event.target.closest('.control-action');
    if (action) {
      this._callEntityService(action.dataset.entityId, action.dataset.action);
    }
  }

  _handleInput(event) {
    if (event.target.matches('.cycle-interval')) {
      this._setAutoCycleInterval(event.target.value);
    }
  }

  _handleAutoCycleInteraction(event) {
    if (event.target.closest('.auto-cycle-control')) {
      return;
    }

    this._pauseAutoCycle();
  }

  _callEntityService(entityId, action) {
    if (!this._hass?.callService) {
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

  _isOnlineCameraState(state) {
    return Boolean(state) && !['unavailable', 'unknown'].includes(String(state.state).toLowerCase());
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

        :host::before {
          content: '';
          position: fixed;
          inset: 0;
          z-index: 2;
          pointer-events: none;
          background:
            linear-gradient(90deg, transparent, rgba(112, 238, 255, 0.03), transparent),
            repeating-linear-gradient(0deg, rgba(255, 255, 255, 0.018) 0 1px, transparent 1px 7px);
          mix-blend-mode: screen;
        }

        * {
          box-sizing: border-box;
        }

        button {
          font: inherit;
        }

        [hidden] {
          display: none !important;
        }

        .shell {
          position: relative;
          z-index: 1;
          width: min(1800px, 100%);
          margin: 0 auto;
          padding: clamp(1rem, 2.5vw, 2rem);
          animation: view-enter 180ms ease-out both;
        }

        @keyframes view-enter {
          from {
            opacity: 0;
            transform: translateY(8px);
          }

          to {
            opacity: 1;
            transform: translateY(0);
          }
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

        .cycle-panel {
          display: grid;
          grid-template-columns: minmax(14rem, 1fr) auto auto;
          align-items: center;
          gap: 0.75rem;
          width: 100%;
          margin-bottom: 1.25rem;
          padding: 0.9rem;
          border: 1px solid rgba(87, 222, 255, 0.18);
          border-radius: 18px;
          background: linear-gradient(135deg, rgba(0, 229, 255, 0.08), rgba(9, 18, 32, 0.68));
          box-shadow: 0 0 28px rgba(0, 229, 255, 0.07);
        }

        .cycle-status {
          display: grid;
          gap: 0.2rem;
          min-width: 0;
        }

        .cycle-title {
          color: #e8fbff;
          font-size: 0.95rem;
          font-weight: 900;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .cycle-meta {
          color: #8fbac4;
          font-size: 0.8rem;
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
        }

        .cycle-range {
          display: flex;
          align-items: center;
          gap: 0.65rem;
          color: #8fbac4;
          font-size: 0.78rem;
          font-weight: 800;
          letter-spacing: 0.06em;
          text-transform: uppercase;
        }

        .cycle-range input {
          width: min(16rem, 28vw);
          accent-color: #00e5ff;
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
        .cycle-button,
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
        .detail-tabs button[aria-pressed="true"],
        .cycle-button[aria-pressed="true"] {
          color: #e8fbff;
          background: rgba(0, 229, 255, 0.14);
          box-shadow: inset 0 0 0 1px rgba(105, 241, 255, 0.28), 0 0 22px rgba(0, 229, 255, 0.12);
        }

        .cycle-button,
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
        .cycle-button:hover,
        .cycle-button:focus-visible,
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
          gap: clamp(0.7rem, 1.4vw, 1.25rem);
        }

        .grid.scale-few {
          grid-template-columns: repeat(auto-fit, minmax(min(100%, 520px), 1fr));
        }

        .grid.scale-balanced {
          grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        }

        .grid.scale-wall {
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        }

        .grid.scale-wall .name {
          padding: 0.65rem 0.75rem 0.8rem;
          font-size: 0.85rem;
        }

        .grid.scale-wall .motion-badge {
          top: 0.45rem;
          left: 0.45rem;
          padding: 0.24rem 0.42rem;
          font-size: 0.62rem;
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

        .card.active {
          border-color: rgba(0, 229, 255, 0.9);
          box-shadow: 0 18px 62px rgba(0, 0, 0, 0.44), 0 0 36px rgba(0, 229, 255, 0.26);
        }

        .card.active::before {
          content: '';
          position: absolute;
          inset: 0;
          z-index: 1;
          pointer-events: none;
          border-radius: inherit;
          box-shadow: inset 0 0 0 1px rgba(215, 252, 255, 0.32), inset 0 0 28px rgba(0, 229, 255, 0.08);
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

        .frame::before,
        .detail-feed::before {
          content: '';
          position: absolute;
          inset: 0;
          pointer-events: none;
          background: linear-gradient(110deg, transparent 25%, rgba(118, 242, 255, 0.1) 45%, transparent 65%);
          transform: translateX(-100%);
          animation: camera-shimmer 2.8s ease-in-out infinite;
        }

        @keyframes camera-shimmer {
          0%, 55% {
            transform: translateX(-100%);
          }

          100% {
            transform: translateX(100%);
          }
        }

        .frame::after,
        .detail-feed::after {
          content: '';
          position: absolute;
          inset: 0;
          z-index: 1;
          pointer-events: none;
          background:
            linear-gradient(180deg, transparent 68%, rgba(0, 0, 0, 0.36)),
            repeating-linear-gradient(0deg, rgba(255, 255, 255, 0.025) 0 1px, transparent 1px 5px);
        }

        .motion-badge {
          position: absolute;
          top: 0.75rem;
          left: 0.75rem;
          z-index: 2;
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
          animation: motion-dot-pulse 1.2s ease-in-out infinite;
        }

        @keyframes motion-dot-pulse {
          0%, 100% {
            transform: scale(1);
            opacity: 0.72;
          }

          50% {
            transform: scale(1.24);
            opacity: 1;
          }
        }

        .status-pill {
          position: absolute;
          right: 0.75rem;
          top: 0.75rem;
          z-index: 2;
          display: inline-flex;
          align-items: center;
          gap: 0.35rem;
          border: 1px solid rgba(143, 186, 196, 0.28);
          border-radius: 999px;
          padding: 0.32rem 0.52rem;
          color: #d9f9ff;
          background: rgba(3, 6, 12, 0.6);
          font-size: 0.68rem;
          font-weight: 900;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          backdrop-filter: blur(8px);
        }

        .status-pill::before,
        .status-light {
          content: '';
          width: 0.5rem;
          height: 0.5rem;
          border-radius: 50%;
          background: #5effb1;
          box-shadow: 0 0 12px rgba(94, 255, 177, 0.75);
        }

        .status-pill.offline::before,
        .status-light.offline {
          background: #ff5e73;
          box-shadow: 0 0 12px rgba(255, 94, 115, 0.72);
        }

        img {
          position: relative;
          z-index: 0;
          display: block;
          width: 100%;
          height: 100%;
          object-fit: cover;
          opacity: 0;
          animation: feed-reveal 220ms ease-out 90ms forwards;
        }

        @keyframes feed-reveal {
          to {
            opacity: 1;
          }
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

        .name-meta {
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
          min-width: 0;
        }

        .name-meta span:first-child {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .status-light {
          display: inline-block;
          flex: 0 0 auto;
          vertical-align: middle;
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
          z-index: 2;
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

        .fullscreen-actions {
          display: flex;
          align-items: center;
          gap: 0.6rem;
          flex-wrap: wrap;
          justify-content: flex-end;
        }

        .fullscreen-subtitle {
          margin-top: 0.2rem;
          color: #8fbac4;
          font-size: 0.78rem;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .fullscreen.auto-cycle-paused .fullscreen-frame img {
          filter: saturate(0.72) brightness(0.82);
        }

        .pause-ribbon {
          position: absolute;
          z-index: 2;
          border: 1px solid rgba(255, 211, 94, 0.45);
          border-radius: 999px;
          padding: 0.6rem 0.9rem;
          color: #fff4c2;
          background: rgba(84, 60, 0, 0.58);
          box-shadow: 0 0 28px rgba(255, 211, 94, 0.15);
          font-weight: 900;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .fullscreen-frame {
          position: relative;
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

        @media (prefers-reduced-motion: reduce) {
          .shell,
          .card.motion,
          .motion-dot,
          .motion-badge::before,
          .frame::before,
          .detail-feed::before,
          img {
            animation: none;
          }

          img {
            opacity: 1;
          }
        }

        @media (max-width: 900px) {
          .header,
          .detail-topbar,
          .feed-hud {
            align-items: stretch;
            flex-direction: column;
          }

          .cycle-panel {
            grid-template-columns: 1fr;
          }

          .cycle-range input {
            width: 100%;
          }

          .control-grid {
            grid-template-columns: 1fr;
          }
        }
      </style>
    `;
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
