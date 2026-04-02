# SimpliLidarViewer

A lightweight, browser-based LiDAR point cloud viewer. Open `.las` and `.laz` files directly in your browser with no installation, no server, and no build tools required.

## Features

- **LAS & LAZ support** — native binary parsing for LAS 1.0-1.4 (point formats 0-10) and pure-JavaScript LAZ decompression with no external dependencies
- **Color modes** — elevation (viridis), classification (ASPRS colors), intensity, RGB, or single color
- **3D navigation** — orbit, pan, and zoom with Three.js; auto-rotate with adjustable speed and direction
- **Coordinate system** — EPSG code lookup via epsg.io with proj4 integration
- **Subsampling** — automatically handles large point clouds (up to 5M points displayed)
- **Works offline** — opens directly from `file://` for `.las` files; `.laz` also works from `file://` with the pure-JS decoder
- **Zero build step** — plain HTML, CSS, and JavaScript; no npm, no bundler, no framework

## Quick Start

### Option 1: Open directly

Double-click `index.html` to open in your browser. Drag and drop a `.las` or `.laz` file onto the viewer.

### Option 2: Local server (optional)

Run `launch.bat` (Windows) to start a local web server. This tries Python, then Node.js:

```
launch.bat
```

The viewer opens automatically at `http://localhost:8080`.

## File Structure

```
SimpliLidarViewer/
  index.html          Main application
  launch.bat          Windows launcher (local HTTP server)
  css/
    style.css         Application styles
  js/
    main.js           Application logic & UI
    las-parser.js     LAS binary parser (1.0-1.4)
    laz-decoder.js    Pure-JS LAZ decompressor
    colorizer.js      Point cloud color modes
    viewer.js         Three.js 3D renderer
```

## Supported Formats

| Format | Version | Point Formats | Notes |
|--------|---------|---------------|-------|
| LAS | 1.0 - 1.4 | 0 - 10 | Full support |
| LAZ | 1.0 - 1.3 | 0 - 5 | Pointwise chunked compression |
| LAZ | 1.4 | 6 - 10 | Pointwise chunked (layered chunked not yet supported) |

## Color Modes

- **Elevation** — viridis colormap based on Z height
- **Classification** — ASPRS standard class colors (ground, vegetation, buildings, etc.)
- **Intensity** — viridis colormap based on return intensity
- **RGB** — native point colors (if present in the file)
- **Single Color** — uniform color with a color picker

## Dependencies

All loaded via CDN `<script>` tags (no npm required):

- [Three.js r128](https://threejs.org/) — 3D rendering
- [proj4js](https://proj4js.org/) — coordinate system transformations

The LAZ decompressor is a self-contained pure-JavaScript implementation based on the [LASzip](https://github.com/LASzip/LASzip) algorithm (Apache 2.0).

## Browser Support

Modern browsers with WebGL support: Chrome, Firefox, Edge, Safari.

## License

Copyright (c) 2025 Brenton Roesner

This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

See [LICENSE](LICENSE) for the full license text.
