// 十进制输入转有理数，逐项从端点计算，只在最终显示时舍入；不累加浮点步长。
const fail = message => { const error = new Error(message); error.code = 'invalid_input'; throw error; };
const power = n => 10n ** BigInt(n);

function decimal(raw, label) {
    if (typeof raw !== 'string' || raw.length > 48) fail(`${label}请输入十进制数`);
    const text = raw.trim();
    if (!/^[+-]?(?:\d{1,16}(?:\.\d{0,12})?|\.\d{1,12})$/.test(text)) fail(`${label}最多16位整数、12位小数，不支持科学计数法`);
    const sign = text.startsWith('-') ? -1n : 1n;
    const [whole, fraction = ''] = text.replace(/^[+-]/, '').split('.');
    const numerator = sign * BigInt((whole || '0') + fraction), denominator = power(fraction.length);
    return { numerator, denominator, text: compact(format(numerator, denominator, fraction.length)) };
}
function compact(text) { return text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text; }
function format(numerator, denominator, precision) {
    const negative = numerator < 0n, absolute = negative ? -numerator : numerator;
    const scaled = absolute * power(precision);
    let rounded = scaled / denominator;
    if ((scaled % denominator) * 2n >= denominator) rounded++;
    const digits = rounded.toString().padStart(precision + 1, '0');
    const value = precision ? `${digits.slice(0, -precision)}.${digits.slice(-precision)}` : digits;
    return negative && rounded !== 0n ? '-' + value : value;
}

export function normalizeCalculation(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('计算参数不正确');
    const base = decimal(value.base, '基准值'), rate = decimal(value.rate, '浮动比例');
    if (!['ratio', 'percent'].includes(value.rateMode)) fail('请选择倍率或百分比');
    const denominator = rate.denominator * (value.rateMode === 'percent' ? 100n : 1n);
    if (rate.numerator < 0n || rate.numerator > denominator * 10n) fail('浮动比例应在0～1000%之间');
    if (!Number.isInteger(value.count) || value.count < 2 || value.count > 500) fail('上下每组数量请输入2～500的整数（包含两端点）');
    if (!Number.isInteger(value.precision) || value.precision < 0 || value.precision > 12) fail('小数位数应在0～12之间');
    return { base: base.text, rate: rate.text, rateMode: value.rateMode, count: value.count, precision: value.precision };
}

export function calculateRange(value) {
    const parameters = normalizeCalculation(value);
    const base = decimal(parameters.base, '基准值'), rate = decimal(parameters.rate, '浮动比例');
    const rateDenominator = rate.denominator * (parameters.rateMode === 'percent' ? 100n : 1n);
    const denominator = base.denominator * rateDenominator;
    const center = base.numerator * rateDenominator;
    const delta = (base.numerator < 0n ? -base.numerator : base.numerator) * rate.numerator;
    const steps = BigInt(parameters.count - 1), precision = parameters.precision;
    const rows = Array.from({ length: parameters.count }, (_, index) => ({
        index: index + 1,
        down: format((center - delta) * steps + delta * BigInt(index), denominator * steps, precision),
        up: format(center * steps + delta * BigInt(index), denominator * steps, precision)
    }));
    return {
        parameters, percentage: compact(format(rate.numerator * 100n, rateDenominator, 12)),
        lower: format(center - delta, denominator, precision), base: format(center, denominator, precision), upper: format(center + delta, denominator, precision),
        rows, roundedDuplicates: new Set(rows.map(row => row.down)).size < rows.length || new Set(rows.map(row => row.up)).size < rows.length
    };
}
