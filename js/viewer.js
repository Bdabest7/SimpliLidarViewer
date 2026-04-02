/**
 * SimpliLidarViewer — 3D Viewer
 * Uses Three.js r128 loaded as a global UMD script (window.THREE).
 * Exposed as window.Viewer — no ES module imports required.
 */

const Viewer = (function () {

    function Viewer(container) {
        this.container   = container;
        this.scene       = null;
        this.camera      = null;
        this.renderer    = null;
        this.controls    = null;
        this.pointsMesh  = null;
        this.gridHelper  = null;
        this.axesHelper  = null;
        this._cloudData  = null;
        this._rafId      = null;
        this._lastTime   = performance.now();
        this._frameCount = 0;
        this.onFPS       = null;   // callback(fps)

        this._init();
    }

    // ── Init ──────────────────────────────────────────────────────────

    Viewer.prototype._init = function () {
        const w = this.container.clientWidth  || 800;
        const h = this.container.clientHeight || 600;

        // Renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: false });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setSize(w, h);
        this.renderer.setClearColor(0x0d1117);
        this.container.appendChild(this.renderer.domElement);

        // Scene
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(0x0d1117, 0.00005);

        // Camera
        this.camera = new THREE.PerspectiveCamera(55, w / h, 0.01, 100000);
        this.camera.position.set(0, 50, 150);

        // Controls (THREE.OrbitControls from the UMD script)
        this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping      = true;
        this.controls.dampingFactor      = 0.06;
        this.controls.screenSpacePanning = false;
        this.controls.minDistance        = 0.5;
        this.controls.maxDistance        = 50000;
        this.controls.autoRotate         = false;
        this.controls.autoRotateSpeed    = 2.0;

        // Axes (on by default)
        this.axesHelper = new THREE.AxesHelper(10);
        this.scene.add(this.axesHelper);

        // Grid (off by default)
        this.gridHelper = new THREE.GridHelper(200, 20, 0x1a2a3a, 0x1a2a3a);
        this.gridHelper.visible = false;
        this.scene.add(this.gridHelper);

        // Resize observer
        const self = this;
        this._resizeObserver = new ResizeObserver(function () { self._onResize(); });
        this._resizeObserver.observe(this.container);

        this._animate();
    };

    // ── Render loop ───────────────────────────────────────────────────

    Viewer.prototype._animate = function () {
        const self = this;
        this._rafId = requestAnimationFrame(function () { self._animate(); });
        this.controls.update();
        this.renderer.render(this.scene, this.camera);

        this._frameCount++;
        const now = performance.now();
        if (now - this._lastTime >= 1000) {
            const fps = Math.round(this._frameCount * 1000 / (now - this._lastTime));
            this._frameCount = 0;
            this._lastTime   = now;
            if (this.onFPS) this.onFPS(fps);
        }
    };

    Viewer.prototype._onResize = function () {
        const w = this.container.clientWidth;
        const h = this.container.clientHeight;
        if (!w || !h) return;
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h);
    };

    // ── Load point cloud ──────────────────────────────────────────────

    Viewer.prototype.loadCloud = function (data, colors) {
        if (this.pointsMesh) {
            this.scene.remove(this.pointsMesh);
            this.pointsMesh.geometry.dispose();
            this.pointsMesh.material.dispose();
            this.pointsMesh = null;
        }

        this._cloudData = data;

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(data.positions.slice(), 3));
        geo.setAttribute('color',    new THREE.BufferAttribute(colors.slice(), 3));

        const mat = new THREE.PointsMaterial({
            size: 1.0,
            vertexColors: THREE.VertexColors,   // r128 uses THREE.VertexColors enum
            sizeAttenuation: true,
        });

        this.pointsMesh = new THREE.Points(geo, mat);
        this.scene.add(this.pointsMesh);

        // Rescale helpers to fit the data
        const ext    = data.extents;
        const maxExt = Math.max(ext.x, ext.y, ext.z, 1);
        this.axesHelper.scale.setScalar(maxExt * 0.15);

        const gridSize = Math.ceil(maxExt * 1.5 / 10) * 10;
        const wasVisible = this.gridHelper.visible;
        this.scene.remove(this.gridHelper);
        this.gridHelper = new THREE.GridHelper(gridSize, 20, 0x1e2e3e, 0x1e2e3e);
        this.gridHelper.position.y = -ext.z / 2;
        this.gridHelper.visible = wasVisible;
        this.scene.add(this.gridHelper);

        this.fitCamera();
    };

    // ── Color update ──────────────────────────────────────────────────

    Viewer.prototype.updateColors = function (colors) {
        if (!this.pointsMesh) return;
        const attr = this.pointsMesh.geometry.getAttribute('color');
        attr.array.set(colors);
        attr.needsUpdate = true;
    };

    // ── Point size ────────────────────────────────────────────────────

    Viewer.prototype.setPointSize = function (size) {
        if (!this.pointsMesh) return;
        this.pointsMesh.material.size = size;
        this.pointsMesh.material.needsUpdate = true;
    };

    // ── Auto rotate ───────────────────────────────────────────────────

    Viewer.prototype.setAutoRotate = function (enabled, speed, direction) {
        this.controls.autoRotate      = enabled;
        this.controls.autoRotateSpeed = (speed || 2) * (direction || 1);
    };

    // ── Camera helpers ────────────────────────────────────────────────

    Viewer.prototype.fitCamera = function () {
        if (!this._cloudData) return;
        const ext  = this._cloudData.extents;
        const maxE = Math.max(ext.x, ext.y, ext.z, 1);
        const dist = maxE * 1.8;

        this.camera.near = dist * 0.0001;
        this.camera.far  = dist * 100;
        this.camera.updateProjectionMatrix();

        this.camera.position.set(dist * 0.7, dist * 0.5, dist * 0.7);
        this.camera.lookAt(0, 0, 0);
        this.controls.target.set(0, 0, 0);
        this.controls.update();

        this.controls.minDistance = dist * 0.001;
        this.controls.maxDistance = dist * 20;
    };

    Viewer.prototype.resetCamera = function () { this.fitCamera(); };

    Viewer.prototype.setTopView = function () {
        if (!this._cloudData) return;
        const ext  = this._cloudData.extents;
        const dist = Math.max(ext.x, ext.y) * 1.2;
        this.camera.position.set(0, dist, 0.001);
        this.camera.lookAt(0, 0, 0);
        this.controls.target.set(0, 0, 0);
        this.controls.update();
    };

    Viewer.prototype.setSideView = function () {
        if (!this._cloudData) return;
        const ext  = this._cloudData.extents;
        const dist = Math.max(ext.x, ext.z) * 1.2;
        this.camera.position.set(dist, 0, 0);
        this.camera.lookAt(0, 0, 0);
        this.controls.target.set(0, 0, 0);
        this.controls.update();
    };

    // ── Grid / Axes ───────────────────────────────────────────────────

    Viewer.prototype.setGridVisible  = function (v) { this.gridHelper.visible = v; };
    Viewer.prototype.setAxesVisible  = function (v) { this.axesHelper.visible = v; };

    // ── Cleanup ───────────────────────────────────────────────────────

    Viewer.prototype.destroy = function () {
        if (this._rafId) cancelAnimationFrame(this._rafId);
        this._resizeObserver.disconnect();
        this.renderer.dispose();
    };

    return Viewer;
}());

// ─── Expose globally ──────────────────────────────────────────────────────────
window.Viewer = Viewer;
