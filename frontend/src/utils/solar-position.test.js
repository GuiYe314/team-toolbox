import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculateSolarPosition, normalizeLongitude, pointToView, viewToCoordinates, solarIllumination, formatLatitude, formatLongitude } from './solar-position.js';
import { geographicVector, solarBasis, terminatorVectors, isSurfaceVisible, LATITUDE_GUIDES, latitudeVectors } from './solar-geometry.js';

test('2024 年春秋分的太阳直射点接近赤道', () => {
    for (const instant of ['2024-03-20T03:06:00Z', '2024-09-22T12:44:00Z']) {
        assert.ok(Math.abs(calculateSolarPosition(instant).subsolarLatitude) < 0.03, instant);
    }
});
test('南北至日直射点分别位于南北回归线附近', () => {
    assert.ok(Math.abs(calculateSolarPosition('2024-06-20T20:51:00Z').subsolarLatitude - 23.44) < 0.03);
    assert.ok(Math.abs(calculateSolarPosition('2024-12-21T09:21:00Z').subsolarLatitude + 23.44) < 0.03);
});
test('UTC 06/12/18 时的太阳依次位于东经、零经线附近和西经', () => {
    const values = [6, 12, 18].map(hour => calculateSolarPosition(new Date(Date.UTC(2024, 3, 15, hour))).subsolarLongitude);
    for (let i = 0; i < values.length; i++) assert.ok(Math.abs(values[i] - [90, 0, -90][i]) < 1);
});
test('带时区偏移的等价时刻与 UTC 完全一致，计算不修改输入', () => {
    const date = new Date('2024-06-21T20:00:00+08:00');
    const before = date.toISOString();
    assert.deepEqual(calculateSolarPosition(date), calculateSolarPosition('2024-06-21T12:00:00Z'));
    assert.equal(date.toISOString(), before);
});
test('闰日、年界和日期变更线附近保持有效的经纬度', () => {
    for (const instant of ['2024-02-29T23:59:59Z', '2024-12-31T23:59:59Z', '2025-01-01T00:00:00Z', '2026-11-10T00:00:00Z']) {
        const result = calculateSolarPosition(instant);
        assert.ok(Math.abs(result.subsolarLatitude) < 23.5);
        assert.ok(result.subsolarLongitude >= -180 && result.subsolarLongitude < 180);
    }
    assert.equal(normalizeLongitude(540), -180);
    assert.equal(normalizeLongitude(-541), 179);
    assert.throws(() => calculateSolarPosition('not-a-date'), TypeError);
});
test('太阳每天向西移动约 15 度每小时', () => {
    const first = calculateSolarPosition('2026-11-10T06:00:00Z');
    const second = calculateSolarPosition('2026-11-10T07:00:00Z');
    assert.ok(Math.abs(normalizeLongitude(second.subsolarLongitude - first.subsolarLongitude) + 15) < 0.02);
});
test('直射点为最强光，反面为夜，赤道春分的 90 度处为分界', () => {
    const solar = { subsolarLatitude: 0, subsolarLongitude: 15 };
    assert.equal(solarIllumination(0, 15, solar), 1);
    assert.equal(solarIllumination(0, -165, solar), -1);
    assert.ok(Math.abs(solarIllumination(0, 105, solar)) < 1e-12);
});
test('夏至北极为昼南极为夜，冬至相反', () => {
    const summer = calculateSolarPosition('2024-06-20T20:51:00Z');
    const winter = calculateSolarPosition('2024-12-21T09:21:00Z');
    assert.ok(solarIllumination(90, 0, summer) > 0 && solarIllumination(-90, 0, summer) < 0);
    assert.ok(solarIllumination(90, 0, winter) < 0 && solarIllumination(-90, 0, winter) > 0);
});
test('球面投影区分背面，逆投影与多角度旋转保持一致', () => {
    assert.ok(pointToView(0, 180, 0, 0).z < 0);
    for (const [viewLat, viewLon] of [[0, 0], [15, 179], [-60, -120], [75, 30]]) {
        for (const [lat, lon] of [[25, 60], [-60, -140], [0, 179], [85, -10]]) {
            const v = pointToView(lat, lon, viewLat, viewLon);
            const restored = viewToCoordinates(v.x, v.y, v.z, viewLat, viewLon);
            assert.ok(Math.abs(restored.latitude - lat) < 1e-9);
            assert.ok(Math.abs(normalizeLongitude(restored.longitude - lon)) < 1e-9);
            assert.ok(Math.abs(v.x ** 2 + v.y ** 2 + v.z ** 2 - 1) < 1e-12);
        }
    }
});
test('经纬度展示明确标记南北和东西', () => {
    assert.equal(formatLatitude(-23.438), '23.4°S');
    assert.equal(formatLongitude(115.06), '115.1°E');
    assert.equal(formatLongitude(-130.12), '130.1°W');
});

test('三维坐标与地理方向一致，向量点积等于太阳照射角余弦', () => {
    assert.ok(geographicVector(0, 0).z > 0.999);
    assert.ok(geographicVector(0, 90).x > 0.999);
    assert.ok(geographicVector(90, 0).y > 0.999);
    for (const instant of ['2024-03-20T03:06:00Z', '2024-06-20T20:51:00Z', '2024-12-21T09:21:00Z']) {
        const solar = calculateSolarPosition(instant), { sun } = solarBasis(solar);
        for (const [lat, lon] of [[0, 0], [39.9, 116.4], [-33.8, 151.2], [90, 180]]) {
            const v = geographicVector(lat, lon);
            assert.ok(Math.abs(v.x * sun.x + v.y * sun.y + v.z * sun.z - solarIllumination(lat, lon, solar)) < 1e-12);
        }
    }
});

test('三维昼夜分界是一条闭合大圆，每一点都与太阳方向正交', () => {
    for (const [lat, lon] of [[0, 0], [23.44, 179], [-23.44, -90], [90, 30]]) {
        const solar = { subsolarLatitude: lat, subsolarLongitude: lon }, { sun } = solarBasis(solar);
        const points = terminatorVectors(solar);
        for (const v of points) {
            assert.ok(Math.abs(Math.hypot(v.x, v.y, v.z) - 1) < 1e-12);
            assert.ok(Math.abs(v.x * sun.x + v.y * sun.y + v.z * sun.z) < 1e-12);
        }
        assert.ok(Math.hypot(points[0].x - points.at(-1).x, points[0].y - points.at(-1).y, points[0].z - points.at(-1).z) < 1e-12);
    }
});

test('透视视角隐藏地平线后的点，缩远后可见范围扩大且不透视背面', () => {
    assert.equal(isSurfaceVisible(0, 0, 0, 0, 2.25), true);
    assert.equal(isSurfaceVisible(0, 180, 0, 0, 2.25), false);
    assert.equal(isSurfaceVisible(0, 70, 0, 0, 1.35), false);
    assert.equal(isSurfaceVisible(0, 70, 0, 0, 4.2), true);
    assert.equal(isSurfaceVisible(0, 88, 0, 0, 4.2), false);
});

test('赤道和南北回归线位于正确纬度，闭合并固定在单位球面', () => {
    assert.deepEqual(LATITUDE_GUIDES.map(guide => guide.latitude), [23.44, 0, -23.44]);
    assert.deepEqual(LATITUDE_GUIDES.map(guide => guide.name), ['北回归线', '赤道', '南回归线']);
    for (const guide of LATITUDE_GUIDES) {
        const points = latitudeVectors(guide.latitude);
        for (const v of points) {
            assert.ok(Math.abs(Math.hypot(v.x, v.y, v.z) - 1) < 1e-12);
            assert.ok(Math.abs(Math.asin(v.y) * 180 / Math.PI - guide.latitude) < 1e-12);
        }
        assert.ok(Math.hypot(points[0].x - points.at(-1).x, points[0].y - points.at(-1).y, points[0].z - points.at(-1).z) < 1e-12);
    }
});
