# CCTV App Panel

A Home Assistant custom frontend panel for CCTV monitoring.

## Repository tree

```text
.
├── hacs.json
├── info.md
├── README.md
└── www
    └── cctv-app
        ├── index.js
        └── README.md
```

## What this is

`cctv-app` is a frontend-only Home Assistant custom panel. It is not a backend integration and does not include Python, Node.js, or a build step.

The main panel file is:

```text
www/cctv-app/index.js
```

## Home Assistant `panel_custom` configuration

For manual installation into `/config/www/cctv-app/index.js`, add this to `configuration.yaml`:

```yaml
panel_custom:
  - name: cctv_app
    sidebar_title: CCTV
    sidebar_icon: mdi:cctv
    url_path: cctv
    module_url: /local/cctv-app/index.js
```

## Installation

### Manual `/config/www` installation

1. Copy `www/cctv-app/index.js` from this repository to:

   ```text
   /config/www/cctv-app/index.js
   ```

2. Add the `panel_custom` YAML shown above.
3. Restart Home Assistant.
4. Open the CCTV panel from the sidebar or browse to `/cctv`.

### Optional HACS frontend installation

This repository includes `hacs.json` metadata for frontend/plugin usage. After adding the repository as a HACS frontend/plugin repository, configure `panel_custom` with the static HACS URL for this module, for example:

```yaml
panel_custom:
  - name: cctv_app
    sidebar_title: CCTV
    sidebar_icon: mdi:cctv
    url_path: cctv
    module_url: /hacsfiles/HA-CCTV-APP/www/cctv-app/index.js
```

Use the exact HACS path that matches the repository name shown in your Home Assistant installation.

## Features

- Auto-detects `camera.*` entities from `hass.states`.
- Uses `/api/camera_proxy/{entity_id}` for previews and fullscreen feeds.
- Responsive camera grid with Shadow DOM styling.
- Motion-priority mode and auto-cycle mode.
- Camera detail view with related device controls when device metadata is available.
- Pure vanilla JavaScript module with no external frameworks.
