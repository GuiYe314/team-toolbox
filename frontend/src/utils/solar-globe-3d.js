import Globe from 'globe.gl';
import { ArrowHelper, BufferGeometry, Color, Float32BufferAttribute, Group, Line, LineBasicMaterial, LineDashedMaterial,
    Mesh, MeshBasicMaterial, Points, PointsMaterial, RingGeometry, ShaderMaterial, SphereGeometry,
    SRGBColorSpace, Texture, Vector3 } from 'three';
import { geographicVector, solarBasis, terminatorVectors, latitudeVectors, LATITUDE_GUIDES, MIN_GLOBE_ALTITUDE, MAX_GLOBE_ALTITUDE } from './solar-geometry.js';
import { createSolarSun } from './solar-sun.js';
import dayUrl from '../assets/earth/day.jpg';
import nightUrl from '../assets/earth/night.jpg';
import cloudsUrl from '../assets/earth/clouds.jpg';

const vertexShader = `
    varying vec2 surfaceUv;
    varying vec3 worldNormal;
    varying vec3 worldPosition;
    void main() {
        surfaceUv = uv;
        worldNormal = normalize(mat3(modelMatrix) * normal);
        worldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * viewMatrix * vec4(worldPosition, 1.0);
    }
`;
const earthFragmentShader = `
    uniform sampler2D dayMap;
    uniform sampler2D nightMap;
    uniform vec3 sunDirection;
    uniform vec3 twilightColor;
    varying vec2 surfaceUv;
    varying vec3 worldNormal;
    void main() {
        float illumination = dot(normalize(worldNormal), sunDirection);
        float daylight = smoothstep(-0.065, 0.13, illumination);
        vec3 surface = texture2D(dayMap, surfaceUv).rgb;
        vec3 lights = texture2D(nightMap, surfaceUv).rgb;
        vec3 day = surface * (0.30 + 0.70 * pow(max(0.0, illumination), 0.55));
        vec3 night = surface * 0.035 + lights * 1.1;
        vec3 color = mix(night, day, daylight);
        color += twilightColor * exp(-abs(illumination) * 20.0) * 0.035;
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
    }
`;
const cloudFragmentShader = `
    uniform sampler2D cloudMap;
    uniform vec3 sunDirection;
    uniform vec3 cloudColor;
    varying vec2 surfaceUv;
    varying vec3 worldNormal;
    void main() {
        float mask = texture2D(cloudMap, surfaceUv).r;
        float illumination = dot(normalize(worldNormal), sunDirection);
        float light = 0.07 + 0.93 * smoothstep(-0.07, 0.8, illumination);
        gl_FragColor = vec4(cloudColor * light, smoothstep(0.12, 0.9, mask) * 0.75);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
    }
`;

/** 一次组件挂载独享一个场景。无常驻动画，交互和数据变化才申请一帧。 */
export async function createRealisticGlobe(host, { signal, colors, onViewChange, onAnnotations, onError }) {
    const textures = [], bitmaps = [], resources = new Set();
    let world, frame = null, disposed = false, visible = !document.hidden, updatingView = false;
    let shader, clouds, marker, markerRing, sun, terminator, stars;
    const arrows = [], latitudeLines = [];
    const own = resource => { resources.add(resource); return resource; };
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('webgl2', { alpha: true, antialias: true, powerPreference: 'low-power', preserveDrawingBuffer: true });
    if (!context) throw new Error('浏览器未能启用三维显示，已切换为简化示意。');
    canvas.setAttribute('aria-hidden', 'true');
    canvas.tabIndex = -1;

    function draw() {
        frame = null;
        if (disposed || !visible || !world) return;
        try {
            world.controls().update();
            sun?.faceCamera(world.camera());
            world.renderer().render(world.scene(), world.camera());
            updateAnnotations();
        } catch { onError(new Error('三维画面暂时无法绘制，已切换为简化示意。')); }
    }
    function invalidate() { if (!disposed && visible && frame === null) frame = requestAnimationFrame(draw); }
    function contextLost(event) {
        event.preventDefault();
        if (!disposed) onError(new Error('三维显示已中断，已切换为简化示意。'));
    }
    function dispose() {
        if (disposed) return;
        disposed = true;
        if (frame !== null) cancelAnimationFrame(frame);
        frame = null;
        signal.removeEventListener('abort', dispose);
        canvas.removeEventListener('webglcontextlost', contextLost);
        if (world) {
            world.controls().removeEventListener('change', invalidate);
            world.onZoom(null).onGlobeReady(() => {});
            world._destructor();
        }
        for (const resource of resources) resource.dispose();
        sun?.dispose();
        for (const texture of textures) texture.dispose();
        for (const bitmap of bitmaps) bitmap.close();
        context.getExtension('WEBGL_lose_context')?.loseContext();
        host.replaceChildren();
    }

    function updateAnnotations() {
        if (!onAnnotations || !sun) return;
        const { width, height } = host.getBoundingClientRect();
        const camera = world.camera(), radius = world.getGlobeRadius();
        const { lng } = world.pointOfView();
        function project(position, label) {
            // 标签不能穿过地球：检查点到相机线段的最近球心距离。
            const ray = camera.position.clone().sub(position);
            const progress = Math.max(0, Math.min(1, -position.dot(ray) / ray.lengthSq()));
            const occluded = position.clone().addScaledVector(ray, progress).lengthSq() < radius * radius;
            const projected = position.clone().project(camera);
            return { ...label, x: (projected.x + 1) * width / 2, y: (1 - projected.y) * height / 2,
                visible: !occluded && projected.z > -1 && projected.z < 1 && Math.abs(projected.x) < 0.96 && Math.abs(projected.y) < 0.94 };
        }
        const labels = LATITUDE_GUIDES.map(guide => {
            const v = geographicVector(guide.latitude, lng - 18);
            return project(new Vector3(v.x, v.y, v.z).multiplyScalar(radius * 1.018), guide);
        });
        const sunLabel = project(sun.object.position, { id: 'sun', name: '太阳', kind: 'sun' });
        const belowSun = sun.object.position.clone().addScaledVector(new Vector3(0, 1, 0).applyQuaternion(camera.quaternion), -radius * 0.18).project(camera);
        sunLabel.y = (1 - belowSun.y) * height / 2;
        labels.push(sunLabel);
        onAnnotations(labels);
    }

    function sunColors(nextColors) {
        return { core: new Color(nextColors.sunCore), surface: new Color(nextColors.sun), rim: new Color(nextColors.sunRim), corona: new Color(nextColors.sunCorona) };
    }

    async function loadTexture(url, isColor) {
        const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]), credentials: 'same-origin' });
        if (!response.ok) throw new Error('地球贴图未能加载，已切换为简化示意，可重试。');
        const blob = await response.blob();
        signal.throwIfAborted();
        const bitmap = await createImageBitmap(blob, { imageOrientation: 'flipY', colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
        if (disposed || signal.aborted) { bitmap.close(); signal.throwIfAborted(); throw new Error('视图已关闭'); }
        bitmaps.push(bitmap);
        const texture = new Texture(bitmap);
        texture.flipY = false;
        if (isColor) texture.colorSpace = SRGBColorSpace;
        texture.needsUpdate = true;
        textures.push(texture);
        return texture;
    }

    function updateTheme(nextColors) {
        if (disposed || !world) return;
        world.backgroundColor(nextColors.transparent).atmosphereColor(nextColors.atmosphere);
        if (shader) shader.uniforms.twilightColor.value.set(nextColors.twilight);
        if (clouds) clouds.material.uniforms.cloudColor.value.set(nextColors.cloud);
        marker?.material.color.set(nextColors.marker);
        markerRing?.material.color.set(nextColors.marker);
        sun?.updateColors(sunColors(nextColors));
        for (let index = 0; index < latitudeLines.length; index++) latitudeLines[index].material.color.set(nextColors[LATITUDE_GUIDES[index].kind]);
        terminator?.material.color.set(nextColors.terminator);
        stars?.material.color.set(nextColors.stars);
        for (const arrow of arrows) arrow.setColor(new Color(nextColors.ray));
        invalidate();
    }

    function setSolar(solar) {
        if (disposed || !shader) return;
        const { sun: directionVector, tangent } = solarBasis(solar);
        const direction = new Vector3(directionVector.x, directionVector.y, directionVector.z);
        const side = new Vector3(tangent.x, tangent.y, tangent.z);
        const radius = world.getGlobeRadius();
        shader.uniforms.sunDirection.value.copy(direction);
        clouds.material.uniforms.sunDirection.value.copy(direction);
        marker.position.copy(direction).multiplyScalar(radius * 1.024);
        markerRing.position.copy(direction).multiplyScalar(radius * 1.024);
        markerRing.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), direction);
        sun.object.position.copy(direction).multiplyScalar(radius * 1.5);
        for (let index = 0; index < arrows.length; index++) {
            const offset = (index - 1) * radius * 0.12;
            arrows[index].position.copy(direction).multiplyScalar(radius * 1.36).addScaledVector(side, offset);
            arrows[index].setDirection(direction.clone().negate());
            arrows[index].setLength(radius * 1.36 - Math.sqrt((radius * 1.02) ** 2 - offset ** 2), radius * 0.045, radius * 0.02);
        }
        const points = terminatorVectors(solar, 240).map(v => new Vector3(v.x, v.y, v.z).multiplyScalar(radius * 1.014));
        terminator.geometry.setFromPoints(points);
        terminator.computeLineDistances();
        invalidate();
    }

    function setView(latitude, longitude, altitude) {
        if (disposed || !world) return;
        updatingView = true;
        try {
            world.pointOfView({ lat: latitude, lng: longitude, altitude });
            world.controls().update();
        } finally { updatingView = false; }
        invalidate();
    }
    function resize() {
        if (disposed || !world) return;
        const { width, height } = host.getBoundingClientRect();
        if (!width || !height) return;
        world.width(width).height(height);
        invalidate();
    }
    function setVisible(nextVisible) {
        visible = nextVisible;
        if (!visible && frame !== null) { cancelAnimationFrame(frame); frame = null; }
        if (visible) invalidate();
    }

    signal.addEventListener('abort', dispose, { once: true });
    canvas.addEventListener('webglcontextlost', contextLost);
    try {
        signal.throwIfAborted();
        world = new Globe(host, { animateIn: false, rendererConfig: { canvas, context, alpha: true, antialias: true, preserveDrawingBuffer: true } });
        world.enablePointerInteraction(false).globeCurvatureResolution(2)
            .showAtmosphere(true).atmosphereAltitude(0.12).onGlobeReady(invalidate);
        world.pauseAnimation();
        const controls = world.controls();
        controls.enableDamping = false;
        controls.enablePan = false;
        controls.minDistance = world.getGlobeRadius() * (1 + MIN_GLOBE_ALTITUDE);
        controls.maxDistance = world.getGlobeRadius() * (1 + MAX_GLOBE_ALTITUDE);
        controls.minPolarAngle = Math.PI / 12;
        controls.maxPolarAngle = Math.PI * 11 / 12;
        controls.addEventListener('change', invalidate);
        world.onZoom(pov => { if (!updatingView && !disposed) onViewChange(pov); });
        world.renderer().setPixelRatio(Math.min(devicePixelRatio || 1, 2));
        world.renderer().debug.onShaderError = () => onError(new Error('三维材质暂不可用，已切换为简化示意。'));
        updateTheme(colors);
        resize();

        const [dayMap, nightMap, cloudMap] = await Promise.all([
            loadTexture(dayUrl, true), loadTexture(nightUrl, true), loadTexture(cloudsUrl, false)
        ]);
        signal.throwIfAborted();
        shader = own(new ShaderMaterial({ vertexShader, fragmentShader: earthFragmentShader, uniforms: {
            dayMap: { value: dayMap }, nightMap: { value: nightMap },
            sunDirection: { value: new Vector3(0, 0, 1) }, twilightColor: { value: new Color(colors.twilight) }
        } }));
        const previousMaterial = world.globeMaterial();
        world.globeMaterial(shader);
        previousMaterial.dispose();
        const radius = world.getGlobeRadius();
        clouds = new Mesh(own(new SphereGeometry(radius * 1.009, 96, 48)), own(new ShaderMaterial({
            vertexShader, fragmentShader: cloudFragmentShader, transparent: true, depthWrite: false,
            uniforms: { cloudMap: { value: cloudMap }, sunDirection: { value: new Vector3(0, 0, 1) }, cloudColor: { value: new Color(colors.cloud) } }
        })));
        clouds.rotation.y = -Math.PI / 2;
        const details = new Group();
        marker = new Mesh(own(new SphereGeometry(radius * 0.013, 16, 12)), own(new MeshBasicMaterial({ color: colors.marker })));
        markerRing = new Mesh(own(new RingGeometry(radius * 0.036, radius * 0.042, 48)), own(new MeshBasicMaterial({ color: colors.marker })));
        sun = createSolarSun(radius * 0.095, sunColors(colors));
        for (const guide of LATITUDE_GUIDES) {
            const geometry = own(new BufferGeometry().setFromPoints(latitudeVectors(guide.latitude).map(v => new Vector3(v.x, v.y, v.z).multiplyScalar(radius * 1.016))));
            const material = own(guide.kind === 'equator'
                ? new LineBasicMaterial({ color: colors.equator, transparent: true, opacity: 0.82 })
                : new LineDashedMaterial({ color: colors.tropic, dashSize: 2.2, gapSize: 1.5, transparent: true, opacity: 0.84 }));
            const line = new Line(geometry, material);
            line.computeLineDistances();
            latitudeLines.push(line); details.add(line);
        }
        terminator = new Line(own(new BufferGeometry()), own(new LineDashedMaterial({ color: colors.terminator, dashSize: 1.5, gapSize: 1.7, transparent: true, opacity: 0.60 })));
        for (let index = 0; index < 3; index++) {
            const arrow = new ArrowHelper(new Vector3(0, 0, -1), new Vector3(), 1, colors.ray);
            arrow.line.material.transparent = arrow.cone.material.transparent = true;
            arrow.line.material.opacity = 0.72;
            arrow.cone.material.opacity = 0.85;
            arrows.push(arrow);
            details.add(arrow);
        }
        // 固定、稀疏星点。无需远程星空图片，也不启动装饰动画。
        const starPositions = [];
        for (let index = 0; index < 260; index++) {
            const latitude = Math.asin(1 - 2 * (index + 0.5) / 260) * 180 / Math.PI;
            const v = geographicVector(latitude, index * 137.507764);
            starPositions.push(v.x * 1400, v.y * 1400, v.z * 1400);
        }
        stars = new Points(own(new BufferGeometry().setAttribute('position', new Float32BufferAttribute(starPositions, 3))), own(new PointsMaterial({ color: colors.stars, size: 1.25, sizeAttenuation: false, transparent: true, opacity: 0.48, depthWrite: false })));
        details.add(clouds, marker, markerRing, sun.object, terminator, stars);
        world.scene().add(details);
        return { setSolar, setView, resize, setVisible, updateTheme, dispose };
    } catch (error) {
        dispose();
        throw error;
    }
}
