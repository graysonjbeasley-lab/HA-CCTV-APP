# CCTV App Panel installation notes

This repository packages a Home Assistant frontend-only custom panel. It should be served as a static JavaScript module and loaded through `panel_custom`.

## Static file path

Manual installation target:

```text
/config/www/cctv-app/index.js
```

Home Assistant serves this file as:

```text
/local/cctv-app/index.js
```

## Required `panel_custom` configuration

```yaml
panel_custom:
  - name: cctv_app
    sidebar_title: CCTV
    sidebar_icon: mdi:cctv
    url_path: cctv
    module_url: /local/cctv-app/index.js
```

## HACS frontend/plugin usage

The repository includes `hacs.json` with plugin metadata. If installed through HACS as a frontend/plugin repository, use the HACS static resource URL in `module_url`, for example:

```yaml
panel_custom:
  - name: cctv_app
    sidebar_title: CCTV
    sidebar_icon: mdi:cctv
    url_path: cctv
    module_url: /hacsfiles/HA-CCTV-APP/www/cctv-app/index.js
```

No backend Python integration is required.
