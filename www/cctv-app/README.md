# CCTV App Panel

`cctv-app` is a pure frontend Home Assistant custom panel. It is a static JavaScript module that registers the custom element `cctv_app` for use with Home Assistant's `panel_custom` integration.

This repository contains no backend integration, no Python code, no Node.js runtime, and no build step.

## Features

- Automatically discovers `camera.*` entities from `hass.states`.
- Displays camera previews in a responsive Shadow DOM grid.
- Uses Home Assistant's camera proxy endpoint: `/api/camera_proxy/{entity_id}`.
- Provides fullscreen viewing, motion-priority sorting, device controls, and auto-cycle monitoring.
- Uses only vanilla JavaScript and browser Web Components.

## Repository layout

```text
www/cctv-app/index.js   # Main custom panel module
www/cctv-app/README.md  # Panel documentation
hacs.json               # HACS frontend repository metadata
info.md                 # Additional Home Assistant installation notes
```

## Manual installation with `/config/www`

1. Copy this folder into Home Assistant:

   ```text
   /config/www/cctv-app/index.js
   ```

2. Add the panel to `configuration.yaml`:

   ```yaml
   panel_custom:
     - name: cctv_app
       sidebar_title: CCTV
       sidebar_icon: mdi:cctv
       url_path: cctv
       module_url: /local/cctv-app/index.js
   ```

3. Restart Home Assistant or reload YAML configuration where supported.
4. Open the CCTV panel from the sidebar or browse to `/cctv`.

## Optional HACS frontend installation

When installed as a HACS frontend/plugin repository, keep the JavaScript file served as a static frontend resource. Depending on your HACS installation path, use the HACS-served module URL for the same `panel_custom` entry, for example:

```yaml
panel_custom:
  - name: cctv_app
    sidebar_title: CCTV
    sidebar_icon: mdi:cctv
    url_path: cctv
    module_url: /hacsfiles/HA-CCTV-APP/www/cctv-app/index.js
```

If you install manually instead of through HACS, use `/local/cctv-app/index.js` as shown above.

## Notes

- The `name` in `panel_custom` must be `cctv_app` because that is the custom element registered by `index.js`.
- The panel is frontend-only and reads Home Assistant state from the `hass` object supplied by the frontend.
- No external JavaScript frameworks are required.
