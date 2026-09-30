import type { CpgRow } from "./legacy-alignment";

type Batch = { group: string; batch: string; rows: CpgRow[] };
const colors = ["#397dd3", "#d54d57", "#258f64", "#8f62bd", "#c58d25", "#36a0a4"];

function csvCell(value: string | number) {
  const text = String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function saveCsv(batches: Batch[]) {
  const lines = ["Group,Batch,CpN_Position,Distance_to_Target_Center,C_Ratio,Measured_Samples"];
  for (const batch of batches) for (const row of batch.rows) lines.push([
    csvCell(batch.group), csvCell(batch.batch), row.position, row.distance,
    row.averageC === null ? "" : row.averageC.toFixed(6), row.measuredSamples,
  ].join(","));
  const url = URL.createObjectURL(new Blob([`\uFEFF${lines.join("\n")}`], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = "CpN_Original_Reference_Analysis.csv";
  document.body.append(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function CpnResults({ reference, target, batches, failures }: {
  reference: string; target: string; batches: Batch[]; failures: string[];
}) {
  const all = batches.flatMap((batch) => batch.rows);
  const distances = all.map((row) => row.distance);
  const minimum = Math.min(0, ...distances), maximum = Math.max(1, ...distances);
  const span = Math.max(1, maximum - minimum);
  const x = (value: number) => 66 + (value - minimum) / span * 778;
  const y = (value: number) => 245 - value * 205;
  return <section className="card cpn-results"><div className="section-head"><div><div className="eyebrow">ORIGINAL REFERENCE</div>
    <h2>CpN 独立比对结果</h2></div><button className="secondary" disabled={!all.length}
      onClick={() => saveCsv(batches)}>下载 CpN CSV</button></div>
    <p className="hint">原始参考 {reference.length} bp · 原始靶序列 {target} · 仅纳入参考非 CpG 的 C、且同位点 AB1 判读为 C。纵轴为 C/(C+T)，读段按批次拼接并在重叠位点选择较高 Phred Q。</p>
    {all.length ? <><div className="chart-scroller"><svg className="cpn-chart" viewBox="0 0 900 300" role="img" aria-label="CpN 位点 C 除以 C 加 T 折线图">
      {[0, .25, .5, .75, 1].map((tick) => <g key={tick}><line x1="66" x2="844" y1={y(tick)} y2={y(tick)} stroke="#e6eeed" />
        <text x="58" y={y(tick) + 4} textAnchor="end" fontSize="12" fill="#667e7f">{tick * 100}%</text></g>)}
      <line x1="66" x2="844" y1="245" y2="245" stroke="#9ab1b0" />
      {batches.map((batch, index) => {
        const rows = [...batch.rows].sort((a, b) => a.distance - b.distance);
        const color = colors[index % colors.length];
        const path = rows.map((row, i) => `${i ? "L" : "M"}${x(row.distance).toFixed(1)},${y(row.averageC ?? 0).toFixed(1)}`).join(" ");
        return <g key={`${batch.group}:${batch.batch}`}><path d={path} fill="none" stroke={color} strokeWidth="2" />
          {rows.map((row) => <circle key={row.position} cx={x(row.distance)} cy={y(row.averageC ?? 0)} r="3.5" fill={color}>
            <title>{batch.group} / {batch.batch} · CpN {row.position} · {((row.averageC ?? 0) * 100).toFixed(1)}%</title>
          </circle>)}</g>;
      })}
      <text x="66" y="268" fontSize="12" fill="#667e7f">{minimum} bp</text>
      <text x="844" y="268" textAnchor="end" fontSize="12" fill="#667e7f">{maximum} bp</text>
      <text x="450" y="292" textAnchor="middle" fontSize="12" fill="#667e7f">距原始靶点中心距离</text>
    </svg></div>
      <div className="cpn-legend">{batches.map((batch, index) => <span key={`${batch.group}:${batch.batch}`}>
        <i style={{ background: colors[index % colors.length] }} />{batch.group} / {batch.batch}</span>)}</div>
      <div className="table-wrap"><table><thead><tr><th>条件组</th><th>批次</th><th>CpN 位置</th><th>距离 / bp</th><th>C/(C+T)</th></tr></thead><tbody>
        {batches.flatMap((batch) => batch.rows.map((row) => <tr key={`${batch.group}:${batch.batch}:${row.position}`}>
          <td>{batch.group}</td><td>{batch.batch}</td><td>{row.position}</td><td>{row.distance}</td>
          <td>{((row.averageC ?? 0) * 100).toFixed(1)}%</td></tr>))}
      </tbody></table></div></> : <p className="empty">没有同时满足原始参考 CpN 和 AB1 同位点 C 判读的位点。</p>}
    {failures.length ? <p className="error">{failures.join("；")}</p> : null}
  </section>;
}
