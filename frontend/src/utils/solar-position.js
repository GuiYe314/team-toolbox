const DEG = Math.PI / 180;
const sin = value => Math.sin(value * DEG);
const cos = value => Math.cos(value * DEG);
const wrap = value => ((value % 360) + 360) % 360;

/** NOAA 太阳位置近似算法；仅依赖 UTC，不读取位置或网络。 */
export function calculateSolarPosition(input = new Date()) {
    const date = input instanceof Date ? new Date(input.getTime()) : new Date(input);
    if (!Number.isFinite(date.getTime())) throw new TypeError('无效的日期');
    const century = (date.getTime() / 86400000 + 2440587.5 - 2451545) / 36525;
    const meanLongitude = wrap(280.46646 + century * (36000.76983 + century * 0.0003032));
    const meanAnomaly = 357.52911 + century * (35999.05029 - 0.0001537 * century);
    const eccentricity = 0.016708634 - century * (0.000042037 + 0.0000001267 * century);
    const center = sin(meanAnomaly) * (1.914602 - century * (0.004817 + 0.000014 * century))
        + sin(2 * meanAnomaly) * (0.019993 - 0.000101 * century) + sin(3 * meanAnomaly) * 0.000289;
    const omega = 125.04 - 1934.136 * century;
    const apparentLongitude = meanLongitude + center - 0.00569 - 0.00478 * sin(omega);
    const meanObliquity = 23 + (26 + (21.448 - century * (46.815 + century * (0.00059 - century * 0.001813))) / 60) / 60;
    const obliquity = meanObliquity + 0.00256 * cos(omega);
    const y = Math.tan(obliquity * DEG / 2) ** 2;
    const equationOfTimeMinutes = 4 / DEG * (y * sin(2 * meanLongitude) - 2 * eccentricity * sin(meanAnomaly)
        + 4 * eccentricity * y * sin(meanAnomaly) * cos(2 * meanLongitude)
        - 0.5 * y ** 2 * sin(4 * meanLongitude) - 1.25 * eccentricity ** 2 * sin(2 * meanAnomaly));
    const utcMinutes = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60 + date.getUTCMilliseconds() / 60000;
    return { date, subsolarLatitude: Math.asin(sin(obliquity) * sin(apparentLongitude)) / DEG,
        subsolarLongitude: normalizeLongitude(180 - (utcMinutes + equationOfTimeMinutes) / 4), equationOfTimeMinutes };
}

export function normalizeLongitude(longitude) {
    return ((longitude + 180) % 360 + 360) % 360 - 180;
}
export const formatLatitude = latitude => `${Math.abs(latitude).toFixed(1)}°${latitude >= 0 ? 'N' : 'S'}`;
export const formatLongitude = longitude => `${Math.abs(longitude).toFixed(1)}°${longitude >= 0 ? 'E' : 'W'}`;

/** 单位球面到视图坐标，x 向右、y 向上、z 朝向观察者；z<0 为背面。 */
export function pointToView(latitude, longitude, viewLatitude, viewLongitude) {
    const relative = longitude - viewLongitude;
    return { x: cos(latitude) * sin(relative),
        y: sin(latitude) * cos(viewLatitude) - cos(latitude) * cos(relative) * sin(viewLatitude),
        z: sin(latitude) * sin(viewLatitude) + cos(latitude) * cos(relative) * cos(viewLatitude) };
}
/** 正射投影逆变换，接收可见球面上的单位向量。 */
export function viewToCoordinates(x, y, z, viewLatitude, viewLongitude) {
    return { latitude: Math.asin(Math.max(-1, Math.min(1, y * cos(viewLatitude) + z * sin(viewLatitude)))) / DEG,
        longitude: normalizeLongitude(viewLongitude + Math.atan2(x, z * cos(viewLatitude) - y * sin(viewLatitude)) / DEG) };
}
export function solarIllumination(latitude, longitude, solar) {
    return sin(latitude) * sin(solar.subsolarLatitude)
        + cos(latitude) * cos(solar.subsolarLatitude) * cos(longitude - solar.subsolarLongitude);
}
