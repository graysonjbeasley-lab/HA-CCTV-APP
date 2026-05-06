class CctvAppPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._hass = null;
    this._camerasSignature = null;
    this._selectedCamera = null;
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
    this._renderIfNeeded(true);
  }

  disconnectedCallback() {
    document.removeEventListener('keydown', this._escapeHandler);
  }


  _renderIfNeeded(force = false) {
    const cameras = this._getCameras();
    const signature = cameras
      .map((camera) => `${camera.entityId}:${camera.name}`)
      .join('|');

    if (force || signature !== this._camerasSignature) {
      this._camerasSignature = signature;
      this._render(cameras);
    }
  }

  _getCameras() {
    if (!this._hass || !this._hass.states) {
      return [];
    }

    return Object.entries(this._hass.states)
      .filter(([entityId]) => entityId.startsWith('camera.'))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([entityId, state]) => ({
        entityId,
        name: state.attributes?.friendly_name || entityId,
      }));
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

  _render(cameras) {
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

        .grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
          gap: clamp(0.85rem, 1.7vw, 1.25rem);
        }

        .card {
          overflow: hidden;
          border: 1px solid rgba(87, 222, 255, 0.18);
          border-radius: 18px;
          background: rgba(9, 18, 32, 0.78);
          box-shadow: 0 14px 50px rgba(0, 0, 0, 0.34), 0 0 28px rgba(0, 225, 255, 0.05);
          cursor: pointer;
          transition: transform 140ms ease, border-color 140ms ease, box-shadow 140ms ease;
        }

        .card:hover,
        .card:focus-visible {
          border-color: rgba(105, 241, 255, 0.48);
          box-shadow: 0 18px 60px rgba(0, 0, 0, 0.42), 0 0 34px rgba(0, 225, 255, 0.12);
          outline: none;
          transform: translateY(-2px);
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

        img {
          display: block;
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .name {
          padding: 0.85rem 1rem 1rem;
          color: #d9f9ff;
          font-size: 0.98rem;
          font-weight: 600;
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

        ${cameras.length ? this._renderGrid(cameras) : this._renderEmpty()}
      </main>
    `;

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
              <article class="card" tabindex="0" role="button" aria-label="Open ${this._escapeText(camera.name)} fullscreen" data-entity-id="${this._escapeText(camera.entityId)}">
                <div class="frame">
                  <img loading="lazy" decoding="async" src="${this._cameraUrl(camera.entityId)}" alt="${this._escapeText(camera.name)} live camera feed">
                </div>
                <div class="name">${this._escapeText(camera.name)}</div>
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
