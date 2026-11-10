import { pointToView, viewToCoordinates } from './solar-position.js';
import { LATITUDE_GUIDES } from './solar-geometry.js';

// 本地简化大陆轮廓，仅作方向参照；坐标为 [经度, 纬度]，无外部地图。
const LAND = [
    [[-168,71],[-150,70],[-140,61],[-128,59],[-123,49],[-124,41],[-117,32],[-112,28],[-110,23],[-105,20],[-97,16],[-90,18],[-86,21],[-81,25],[-80,31],[-75,36],[-66,45],[-56,51],[-61,58],[-76,62],[-83,69],[-100,74],[-120,72],[-140,69]],
    [[-92,18],[-86,15],[-83,9],[-78,8],[-77,6],[-82,8],[-87,13]],
    [[-81,12],[-70,12],[-61,8],[-51,4],[-35,-6],[-40,-20],[-48,-29],[-54,-34],[-65,-55],[-72,-51],[-75,-40],[-71,-26],[-76,-15],[-81,-4]],
    [[-55,60],[-45,62],[-22,71],[-20,81],[-42,84],[-62,77]],
    [[-10,36],[-10,44],[-6,49],[0,50],[8,54],[6,58],[12,66],[25,71],[35,70],[30,60],[42,60],[50,67],[65,70],[90,76],[120,72],[145,71],[164,67],[179,65],[176,58],[157,51],[145,45],[142,38],[130,43],[124,39],[122,30],[118,24],[109,20],[106,10],[101,3],[98,9],[98,17],[92,22],[87,21],[80,8],[75,11],[69,23],[60,25],[56,18],[49,13],[44,13],[38,29],[35,34],[27,40],[23,37],[16,41],[12,44],[9,42],[5,43],[0,40]],
    [[-17,34],[-4,36],[10,36],[24,32],[34,30],[36,23],[43,12],[51,12],[49,2],[42,-9],[40,-19],[32,-28],[19,-35],[12,-26],[11,-12],[8,4],[-1,5],[-10,6],[-17,15]],
    [[113,-22],[114,-33],[130,-34],[138,-38],[147,-39],[154,-28],[150,-19],[143,-11],[136,-12],[131,-11],[122,-17]],
    [[47,-13],[51,-16],[49,-25],[44,-24]],
    [[130,31],[136,34],[141,40],[145,44],[142,45],[138,39],[134,35]],
    [[95,5],[106,-6],[115,-8],[120,-9],[110,-5],[103,1]],
    [[109,7],[118,7],[119,0],[113,-4],[109,1]],
    [[131,-2],[141,-2],[151,-7],[147,-10],[138,-8]],
    [[166,-35],[174,-40],[178,-39],[173,-35]],
    [[166,-47],[172,-43],[173,-40],[168,-44]],
    [[-9,50],[-6,58],[-2,58],[1,52]],
    [[-25,63],[-14,64],[-17,67],[-22,66]],
    [[-180,-72],[-145,-75],[-100,-72],[-60,-65],[-45,-75],[0,-70],[50,-67],[90,-67],[140,-68],[180,-72],[180,-90],[-180,-90]]
];
const WIDTH = 680, HEIGHT = 470;
const EARTH = { x: 320, y: 226, radius: 174 };

/** 组件私有绘制缓存，不写文件或共享状态。 */
export function createSolarGlobeRenderer(canvas) {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('浏览器无法绘制地球，请启用 Canvas 2D。');
    const texture = document.createElement('canvas');
    texture.width = 1440; texture.height = 720;
    const surface = texture.getContext('2d', { willReadFrequently: true });
    let texturePixels, textureKey;
    function makeTexture(colors) {
        const key = `${colors.ocean}-${colors.land}-${colors.landStroke}`;
        if (key === textureKey) return;
        surface.fillStyle = colors.ocean;
        surface.fillRect(0, 0, texture.width, texture.height);
        surface.fillStyle = colors.land; surface.strokeStyle = colors.landStroke; surface.lineWidth = 1.5;
        for (const continent of LAND) {
            surface.beginPath();
            continent.forEach(([longitude, latitude], index) => {
                const x = (longitude + 180) / 360 * texture.width, y = (90 - latitude) / 180 * texture.height;
                if (index) surface.lineTo(x, y); else surface.moveTo(x, y);
            });
            surface.closePath(); surface.fill(); surface.stroke();
        }
        texturePixels = surface.getImageData(0, 0, texture.width, texture.height).data;
        textureKey = key;
    }
    return function draw({ solar, viewLatitude, viewLongitude, scale, colors }) {
        const factor = Math.min(2, Math.max(0.6, scale));
        canvas.width = Math.round(WIDTH * factor); canvas.height = Math.round(HEIGHT * factor);
        makeTexture(colors);
        const sun = pointToView(solar.subsolarLatitude, solar.subsolarLongitude, viewLatitude, viewLongitude);
        const radius = Math.round(EARTH.radius * factor), size = radius * 2;
        const pixels = context.createImageData(size, size);
        // 清晰球面：逆投影每个像素，点积确定昼夜，没有背面大陆穿透。
        for (let row = 0; row < size; row++) {
            const y = (radius - row - 0.5) / radius;
            for (let column = 0; column < size; column++) {
                const x = (column + 0.5 - radius) / radius, depthSquared = 1 - x * x - y * y;
                if (depthSquared < 0) continue;
                const z = Math.sqrt(depthSquared);
                const coordinates = viewToCoordinates(x, y, z, viewLatitude, viewLongitude);
                const tx = Math.max(0, Math.min(texture.width - 1, Math.floor((coordinates.longitude + 180) / 360 * texture.width)));
                const ty = Math.max(0, Math.min(texture.height - 1, Math.floor((90 - coordinates.latitude) / 180 * texture.height)));
                const sourceIndex = (ty * texture.width + tx) * 4, targetIndex = (row * size + column) * 4;
                const illumination = x * sun.x + y * sun.y + z * sun.z;
                const daylight = Math.max(0, Math.min(1, (illumination + 0.06) / 0.12));
                const light = (0.18 + 0.38 * daylight + 0.44 * Math.max(0, illumination)) * (0.75 + 0.25 * z);
                for (let channel = 0; channel < 3; channel++) pixels.data[targetIndex + channel] = texturePixels[sourceIndex + channel] * light;
                pixels.data[targetIndex + 3] = Math.min(1, z * radius) * 255;
            }
        }
        context.putImageData(pixels, Math.round(EARTH.x * factor) - radius, Math.round(EARTH.y * factor) - radius);
        context.setTransform(factor, 0, 0, factor, 0, 0);
        const project = v => ({ x: EARTH.x + v.x * EARTH.radius, y: EARTH.y - v.y * EARTH.radius });
        function drawCurve(vectors) {
            context.beginPath(); let visible = false;
            for (const vector of vectors) {
                if (vector.z < 0) { visible = false; continue; }
                const point = project(vector);
                if (visible) context.lineTo(point.x, point.y); else context.moveTo(point.x, point.y);
                visible = true;
            }
            context.stroke();
        }
        context.strokeStyle = colors.grid; context.lineWidth = 0.7;
        for (let latitude = -60; latitude <= 60; latitude += 30) drawCurve(Array.from({ length: 181 }, (_, i) => pointToView(latitude, i * 2 - 180, viewLatitude, viewLongitude)));
        for (let longitude = -180; longitude < 180; longitude += 30) drawCurve(Array.from({ length: 91 }, (_, i) => pointToView(i * 2 - 90, longitude, viewLatitude, viewLongitude)));
        for (const guide of LATITUDE_GUIDES) {
            context.strokeStyle = colors[guide.kind]; context.lineWidth = 1.3;
            context.setLineDash(guide.kind === 'equator' ? [] : [5, 4]);
            drawCurve(Array.from({ length: 241 }, (_, i) => pointToView(guide.latitude, i * 1.5 - 180, viewLatitude, viewLongitude)));
            context.setLineDash([]);
            const anchor = pointToView(guide.latitude, viewLongitude - 18, viewLatitude, viewLongitude);
            if (anchor.z > 0) {
                const label = project(anchor), text = `${guide.name} ${guide.coordinate}`;
                context.font = `11px ${colors.font}`; context.textAlign = 'center'; context.textBaseline = 'middle';
                const width = context.measureText(text).width + 14;
                context.fillStyle = colors.labelBackground;
                context.beginPath(); context.roundRect(label.x - width / 2, label.y - 20, width, 17, 8); context.fill();
                context.fillStyle = colors[guide.kind]; context.fillText(text, label.x, label.y - 11);
            }
        }
        context.textBaseline = 'alphabetic';
        const length = Math.hypot(sun.x, sun.z);
        const a = length > 1e-9 ? { x: sun.z / length, y: 0, z: -sun.x / length } : { x: 1, y: 0, z: 0 };
        const b = { x: sun.y * a.z - sun.z * a.y, y: sun.z * a.x - sun.x * a.z, z: sun.x * a.y - sun.y * a.x };
        context.strokeStyle = colors.terminator; context.lineWidth = 1.3; context.setLineDash([4, 4]);
        drawCurve(Array.from({ length: 361 }, (_, i) => {
            const angle = i * Math.PI / 180;
            return { x: a.x * Math.cos(angle) + b.x * Math.sin(angle), y: a.y * Math.cos(angle) + b.y * Math.sin(angle), z: a.z * Math.cos(angle) + b.z * Math.sin(angle) };
        }));
        context.setLineDash([]); context.strokeStyle = colors.outline; context.lineWidth = 1.2;
        context.beginPath(); context.arc(EARTH.x, EARTH.y, EARTH.radius, 0, Math.PI * 2); context.stroke();
        // 太阳为方向示意，射线平行。背面的直射点不透视显示。
        const marker = project(sun), screenLength = Math.hypot(sun.x, sun.y);
        const direction = screenLength > 0.06 ? { x: sun.x / screenLength, y: -sun.y / screenLength } : { x: 1, y: 0 };
        const sunDistance = Math.min(278, 180 / Math.max(0.01, Math.abs(direction.y)));
        const sunIcon = { x: EARTH.x + direction.x * sunDistance, y: EARTH.y + direction.y * sunDistance };
        if (sun.z > 0) {
            context.strokeStyle = colors.ray; context.lineWidth = 1.5;
            for (const offset of [-9, 0, 9]) {
                const end = { x: marker.x - direction.y * offset, y: marker.y + direction.x * offset };
                const rayLength = Math.hypot(sunIcon.x - marker.x, sunIcon.y - marker.y) - 21;
                context.beginPath(); context.moveTo(end.x + direction.x * rayLength, end.y + direction.y * rayLength); context.lineTo(end.x, end.y); context.stroke();
                context.beginPath(); context.moveTo(end.x, end.y); context.lineTo(end.x + direction.x * 7 - direction.y * 3, end.y + direction.y * 7 + direction.x * 3);
                context.moveTo(end.x, end.y); context.lineTo(end.x + direction.x * 7 + direction.y * 3, end.y + direction.y * 7 - direction.x * 3); context.stroke();
            }
            context.strokeStyle = colors.marker; context.beginPath(); context.arc(marker.x, marker.y, 11, 0, Math.PI * 2); context.stroke();
            context.fillStyle = colors.marker; context.beginPath(); context.arc(marker.x, marker.y, 4.5, 0, Math.PI * 2); context.fill();
        }
        const corona = context.createRadialGradient(sunIcon.x, sunIcon.y, 12, sunIcon.x, sunIcon.y, 38);
        corona.addColorStop(0, colors.sunCoronaSoft); corona.addColorStop(1, colors.transparent);
        context.fillStyle = corona; context.beginPath(); context.arc(sunIcon.x, sunIcon.y, 38, 0, Math.PI * 2); context.fill();
        const photosphere = context.createRadialGradient(sunIcon.x - 4, sunIcon.y - 5, 1, sunIcon.x, sunIcon.y, 17);
        photosphere.addColorStop(0, colors.sunCore); photosphere.addColorStop(0.55, colors.sun); photosphere.addColorStop(1, colors.sunRim);
        context.fillStyle = photosphere; context.beginPath(); context.arc(sunIcon.x, sunIcon.y, 17, 0, Math.PI * 2); context.fill();
        context.save(); context.clip(); context.globalAlpha = 0.16; context.fillStyle = colors.sunRim;
        for (let index = 0; index < 60; index++) {
            const angle = index * 2.39996, distance = Math.sqrt((index + 0.5) / 60) * 16;
            context.beginPath(); context.ellipse(sunIcon.x + Math.cos(angle) * distance, sunIcon.y + Math.sin(angle) * distance, 1.1, 0.7, angle, 0, Math.PI * 2); context.fill();
        }
        context.restore();
        context.fillStyle = colors.label; context.font = `12px ${colors.font}`; context.textAlign = 'center';
        context.fillText('太阳方向', sunIcon.x, sunIcon.y + 42);
        context.fillText('N', EARTH.x, EARTH.y - EARTH.radius - 13); context.fillText('S', EARTH.x, EARTH.y + EARTH.radius + 22);
        context.setTransform(1, 0, 0, 1, 0, 0);
    };
}
export const GLOBE_WIDTH = WIDTH;
