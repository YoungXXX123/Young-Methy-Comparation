export type TargetMarker = {
  name: string;
  start: number;
  end: number;
  referenceStart: number;
  referenceEnd: number;
};

export function locateTarget(reference: string, sequence: string, name: string, fallback = "靶点"): TargetMarker | null {
  const start = reference.indexOf(sequence);
  if (!sequence || start < 0 || start !== reference.lastIndexOf(sequence)) return null;
  const half = (sequence.length - 1) / 2;
  return { name: name.trim() || fallback, start: -half, end: half,
    referenceStart: start + 1, referenceEnd: start + sequence.length };
}

export function visibleTarget(target: TargetMarker | null | undefined, bounds: readonly [number, number]) {
  if (!target || target.end + .5 < bounds[0] || target.start - .5 > bounds[1]) return null;
  return { start: Math.max(target.start - .5, bounds[0]), end: Math.min(target.end + .5, bounds[1]),
    showCenter: bounds[0] <= 0 && bounds[1] >= 0 };
}

function fitText(text: string, width: number, fontSize: number) {
  const units = (value: string) => [...value].reduce((sum, char) => sum + (/[^\x00-\x7F]/.test(char) ? 1 : .6), 0);
  let value = text;
  if (units(value) * fontSize <= width) return value;
  while (value.length && units(`${value}…`) * fontSize > width) value = value.slice(0, -1);
  return `${value}…`;
}

type MarkOptions = {
  target?: TargetMarker | null;
  bounds: readonly [number, number];
  left: number;
  right: number;
  top: number;
  bottom: number;
  labelY: number;
  labelLeft?: number;
  labelRight?: number;
  fontSize?: number;
};

export function TargetMark({ target, bounds, left, right, top, bottom, labelY, labelLeft = left, labelRight = right, fontSize = 11 }: MarkOptions) {
  const span = visibleTarget(target, bounds);
  if (!target || !span) return null;
  const x = (value: number) => left + (value - bounds[0]) / (bounds[1] - bounds[0]) * (right - left);
  const caption = `${target.name} · ${target.referenceStart}–${target.referenceEnd} bp`;
  return <g pointerEvents="none" aria-label={`靶点 ${caption}，中心距离 0 bp`}>
    <rect x={x(span.start)} y={top} width={Math.max(1, x(span.end) - x(span.start))} height={bottom - top} fill="#7b61a8" opacity=".10" />
    {span.showCenter && <line x1={x(0)} x2={x(0)} y1={top} y2={bottom} stroke="#7b61a8" strokeDasharray="4 4" />}
    <text x={(labelLeft + labelRight) / 2} y={labelY} textAnchor="middle" fontSize={fontSize} fontWeight="600" fill="#7b61a8">
      {fitText(caption, labelRight - labelLeft, fontSize)}<title>{caption}</title>
    </text>
  </g>;
}

export function drawTargetMark(context: CanvasRenderingContext2D, { target, bounds, left, right, top, bottom, labelY, labelLeft = left, labelRight = right, fontSize = 13 }: MarkOptions) {
  const span = visibleTarget(target, bounds);
  if (!target || !span) return;
  const x = (value: number) => left + (value - bounds[0]) / (bounds[1] - bounds[0]) * (right - left);
  context.save();
  context.fillStyle = "rgba(123, 97, 168, .10)";
  context.fillRect(x(span.start), top, Math.max(1, x(span.end) - x(span.start)), bottom - top);
  context.strokeStyle = "#7b61a8"; context.lineWidth = 1; context.setLineDash([4, 4]);
  if (span.showCenter) {
    context.beginPath(); context.moveTo(x(0), top); context.lineTo(x(0), bottom); context.stroke();
  }
  context.fillStyle = "#7b61a8"; context.font = `600 ${fontSize}px sans-serif`;
  context.textAlign = "center"; context.textBaseline = "alphabetic";
  const caption = `${target.name} · ${target.referenceStart}–${target.referenceEnd} bp`;
  context.fillText(fitText(caption, labelRight - labelLeft, fontSize), (labelLeft + labelRight) / 2, labelY);
  context.restore();
}
