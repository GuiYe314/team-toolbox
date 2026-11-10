import { Group, Mesh, PlaneGeometry, ShaderMaterial, SphereGeometry } from 'three';

const vertexShader = `
    varying vec2 surfaceUv;
    varying vec3 surfaceNormal;
    varying vec3 surfacePosition;
    void main() {
        surfaceUv = uv;
        surfaceNormal = normalize(mat3(modelMatrix) * normal);
        surfacePosition = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * viewMatrix * vec4(surfacePosition, 1.0);
    }
`;
const surfaceShader = `
    uniform vec3 coreColor;
    uniform vec3 surfaceColor;
    uniform vec3 rimColor;
    varying vec3 surfaceNormal;
    varying vec3 surfacePosition;
    float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
    float noise(vec3 p) {
        vec3 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(hash(i), hash(i+vec3(1,0,0)), f.x), mix(hash(i+vec3(0,1,0)), hash(i+vec3(1,1,0)), f.x), f.y),
                   mix(mix(hash(i+vec3(0,0,1)), hash(i+vec3(1,0,1)), f.x), mix(hash(i+vec3(0,1,1)), hash(i+vec3(1,1,1)), f.x), f.y), f.z);
    }
    void main() {
        vec3 normal = normalize(surfaceNormal);
        float facing = max(0.0, dot(normal, normalize(cameraPosition - surfacePosition)));
        float grain = noise(normal * 31.0) * 0.7 + noise(normal * 75.0) * 0.3;
        float cells = smoothstep(0.32, 0.7, grain);
        vec3 warm = mix(rimColor, surfaceColor, smoothstep(0.0, 0.65, facing));
        vec3 color = mix(warm, coreColor, (0.22 + cells * 0.36) * pow(facing, 0.35));
        color *= 0.88 + grain * 0.18;
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
    }
`;
const coronaShader = `
    uniform vec3 coronaColor;
    uniform vec3 rimColor;
    varying vec2 surfaceUv;
    void main() {
        vec2 point = (surfaceUv - 0.5) * 2.0;
        float radius = length(point);
        float angle = atan(point.y, point.x);
        float streamer = 0.85 + 0.10 * sin(angle * 9.0 + 0.4) + 0.05 * sin(angle * 17.0);
        float halo = exp(-max(0.0, radius - 0.30) * 6.0 / streamer) * (1.0 - smoothstep(0.7, 1.0, radius));
        float ring = exp(-pow((radius - 0.34) * 23.0, 2.0));
        float alpha = halo * 0.25 + ring * 0.12;
        if (alpha < 0.002) discard;
        gl_FragColor = vec4(mix(rimColor, coronaColor, halo), alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
    }
`;

/** 纯程序材质：颗粒光球及朝向相机的日冕，无贴图、定时器或独立动画。 */
export function createSolarSun(radius, colors) {
    const object = new Group();
    const surfaceMaterial = new ShaderMaterial({ vertexShader, fragmentShader: surfaceShader, uniforms: {
        coreColor: { value: colors.core.clone() }, surfaceColor: { value: colors.surface.clone() }, rimColor: { value: colors.rim.clone() }
    } });
    const coronaMaterial = new ShaderMaterial({ vertexShader, fragmentShader: coronaShader, transparent: true, depthWrite: false, uniforms: {
        coronaColor: { value: colors.corona.clone() }, rimColor: { value: colors.rim.clone() }
    } });
    const surface = new Mesh(new SphereGeometry(radius, 48, 32), surfaceMaterial);
    const corona = new Mesh(new PlaneGeometry(radius * 6, radius * 6), coronaMaterial);
    corona.renderOrder = 1;
    object.add(surface, corona);
    return {
        object,
        updateColors(next) {
            surfaceMaterial.uniforms.coreColor.value.copy(next.core);
            surfaceMaterial.uniforms.surfaceColor.value.copy(next.surface);
            surfaceMaterial.uniforms.rimColor.value.copy(next.rim);
            coronaMaterial.uniforms.coronaColor.value.copy(next.corona);
            coronaMaterial.uniforms.rimColor.value.copy(next.rim);
        },
        faceCamera(camera) { corona.quaternion.copy(camera.quaternion); },
        dispose() { surface.geometry.dispose(); corona.geometry.dispose(); surfaceMaterial.dispose(); coronaMaterial.dispose(); }
    };
}
