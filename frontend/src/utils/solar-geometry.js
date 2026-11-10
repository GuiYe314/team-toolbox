import { pointToView } from './solar-position.js';

export const DEFAULT_GLOBE_ALTITUDE = 2.25;
export const MIN_GLOBE_ALTITUDE = 1.35;
export const MAX_GLOBE_ALTITUDE = 4.2;
export const LATITUDE_GUIDES = Object.freeze([
    Object.freeze({ id: 'tropic-north', latitude: 23.44, name: '北回归线', coordinate: '23.44°N', kind: 'tropic' }),
    Object.freeze({ id: 'equator', latitude: 0, name: '赤道', coordinate: '0°', kind: 'equator' }),
    Object.freeze({ id: 'tropic-south', latitude: -23.44, name: '南回归线', coordinate: '23.44°S', kind: 'tropic' })
]);

/** 固定纬度的小圆，与日期或太阳位置无关。 */
export function latitudeVectors(latitude, segments = 240) {
    return Array.from({ length: segments + 1 }, (_, index) => geographicVector(latitude, index / segments * 360 - 180));
}

// 与 Globe.gl 一致：北极 +Y、零经线 +Z、东经 90° +X。
export function geographicVector(latitude, longitude) {
    return pointToView(latitude, longitude, 0, 0);
}

/** 与太阳向量正交的大圆；返回单位向量，供三维昼夜分界和射线共用。 */
export function solarBasis(solar) {
    const sun = geographicVector(solar.subsolarLatitude, solar.subsolarLongitude);
    const length = Math.hypot(sun.x, sun.z);
    const tangent = length > 1e-9 ? { x: sun.z / length, y: 0, z: -sun.x / length } : { x: 1, y: 0, z: 0 };
    return { sun, tangent, bitangent: {
        x: sun.y * tangent.z - sun.z * tangent.y,
        y: sun.z * tangent.x - sun.x * tangent.z,
        z: sun.x * tangent.y - sun.y * tangent.x
    } };
}

export function terminatorVectors(solar, segments = 180) {
    const { tangent, bitangent } = solarBasis(solar);
    return Array.from({ length: segments + 1 }, (_, index) => {
        const angle = index / segments * Math.PI * 2;
        return { x: tangent.x * Math.cos(angle) + bitangent.x * Math.sin(angle),
            y: tangent.y * Math.cos(angle) + bitangent.y * Math.sin(angle),
            z: tangent.z * Math.cos(angle) + bitangent.z * Math.sin(angle) };
    });
}

/** 透视相机的可见球冠比半球小，不能仅用 z > 0 判断表面标记。 */
export function isSurfaceVisible(latitude, longitude, viewLatitude, viewLongitude, altitude) {
    return pointToView(latitude, longitude, viewLatitude, viewLongitude).z > 1 / (1 + altitude);
}
