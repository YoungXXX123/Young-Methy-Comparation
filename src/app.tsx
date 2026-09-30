import { useEffect, useMemo, useState } from "react";
import { analyzeFile, sanitizeSequence } from "./legacy-alignment";
import { mergeAb1Batches } from "./ab1-workflow";
import { datasetCsv, readSpreadsheet, type Dataset } from "./data";
import { analyzeDatasets, type Comparison, type Marking, type Method } from "./statistics";
import { regionBatches, type Read, type Region } from "./ab1";
import { clampBounds, fullBounds, SharedChart, type Bounds } from "./chart";
import { RegionAtlas } from "./region-atlas";
import { downloadReport, reportCanvas, type RegionSource, type ReportPart } from "./report";

type Ab1Entry = { id: string; file: File; group: string; batch: string; includeTable: boolean };
type RegionAb1Entry = { id: string; file: File; group: string; batch: string };
type RegionEvidence = { entries: RegionAb1Entry[]; reads: Read[]; uploadGroup: string; uploadBatch: string;
  filterQ: boolean; minimumQ: number; focus: boolean; showCpn: boolean };
const emptyRegionEvidence = (): RegionEvidence => ({ entries: [], reads: [], uploadGroup: "", uploadBatch: "",
  filterQ: false, minimumQ: 20, focus: true, showCpn: false });
const baseColors = { A: "#258f64", C: "#397dd3", G: "#3e485b", T: "#d54d57" };

function saveText(text: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a"); a.href = url; a.download = filename;
  document.body.append(a); a.click(); a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function referenceSequence(input: string) {
  const body = input.trim().startsWith(">") ? input.split(/\r?\n/).filter((line) => !line.startsWith(">")).join("") : input;
  return sanitizeSequence(body);
}

export default function App() {
  const [tables, setTables] = useState<Dataset[]>([]);
  const [generated, setGenerated] = useState<Dataset[]>([]);
  const [ab1, setAb1] = useState<Ab1Entry[]>([]);
  const [ab1UploadGroup, setAb1UploadGroup] = useState("Sample_1");
  const [ab1UploadBatch, setAb1UploadBatch] = useState("Batch_1");
  const [reads, setReads] = useState<Read[]>([]);
  const [referenceInput, setReferenceInput] = useState("");
  const [targetInput, setTargetInput] = useState("");
  const [trim, setTrim] = useState(false);
  const [qualityThreshold, setQualityThreshold] = useState(20);
  const [windowSize, setWindowSize] = useState(20);
  const [compared, setCompared] = useState<string[] | null>(null);
  const [threshold, setThreshold] = useState(20);
  const [method, setMethod] = useState<Method>("welch");
  const [marking, setMarking] = useState<Marking>("p");
  const [regions, setRegions] = useState<Region[]>([]);
  const [regionEvidence, setRegionEvidence] = useState<Record<string, RegionEvidence>>({});
  const [regionReferenceInput, setRegionReferenceInput] = useState("");
  const [regionTargetInput, setRegionTargetInput] = useState("");
  const [selectedRegion, setSelectedRegion] = useState("");
  const [viewport, setViewport] = useState<Bounds>([-25, 25]);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const datasets = useMemo(() => [...tables, ...generated], [tables, generated]);
  const groups = useMemo(() => [...new Set(datasets.map((d) => d.group.trim()).filter(Boolean))], [datasets]);
  const preferredGroups = groups.filter((g) => /dnmt3a|dnmt1/i.test(g));
  const defaultCompared = preferredGroups.some((g) => /dnmt3a/i.test(g)) &&
    preferredGroups.some((g) => /dnmt1/i.test(g)) ? preferredGroups : groups;
  const useCompared = compared === null ? defaultCompared : compared.filter((g) => groups.includes(g));
  const duplicateBatches = new Set(datasets.map((d) => `${d.group.trim()}\u0000${d.batch.trim()}`)).size !== datasets.length;
  const reference = useMemo(() => referenceSequence(referenceInput), [referenceInput]);
  const target = useMemo(() => sanitizeSequence(targetInput), [targetInput]);
  const center = target && reference.includes(target) ? reference.indexOf(target) + (target.length - 1) / 2 : null;
  const regionReference = useMemo(() => referenceSequence(regionReferenceInput), [regionReferenceInput]);
  const regionTarget = useMemo(() => sanitizeSequence(regionTargetInput), [regionTargetInput]);
  const regionCenter = regionTarget && regionReference.indexOf(regionTarget) >= 0 &&
    regionReference.indexOf(regionTarget) === regionReference.lastIndexOf(regionTarget)
    ? regionReference.indexOf(regionTarget) + (regionTarget.length - 1) / 2 : null;
  const regionSources = useMemo<Record<string, RegionSource>>(() => Object.fromEntries(regions.flatMap((region) => {
    const evidence = regionEvidence[region.name];
    if (!evidence) return [];
    return [[region.name, { reads: evidence.entries.length ? evidence.reads : reads,
      reference: evidence.entries.length ? regionReference : reference,
      center: evidence.entries.length ? regionCenter : center,
      filterQ: evidence.filterQ, minimumQ: evidence.minimumQ, focus: evidence.focus, showCpn: evidence.showCpn }]];
  })), [regions, regionEvidence, regionReference, regionCenter, reads, reference, center]);
  const comparison = useMemo<Comparison | null>(() => {
    if (groups.length < 2 || useCompared.length < 2) return null;
    try { return analyzeDatasets(datasets, useCompared, threshold, method, marking); }
    catch { return null; }
  }, [datasets, groups.join("\u0000"), useCompared.join("\u0000"), threshold, method, marking]);
  const full = useMemo(() => fullBounds(datasets), [datasets]);
  useEffect(() => { setViewport(full); setStart(String(Math.round(full[0]))); setEnd(String(Math.round(full[1]))); }, [full[0], full[1]]);
  useEffect(() => { setPreview(""); }, [datasets, regions, reads, regionEvidence, regionReference, regionTarget, threshold, method, marking, compared]);

  const resetRegionReads = () => setRegionEvidence((current) => Object.fromEntries(
    Object.entries(current).map(([name, evidence]) => [name, { ...evidence, reads: [] }])));

  const readTables = async (files: FileList | null) => {
    if (!files?.length) return;
    setError("");
    const added: Dataset[] = [], failures: string[] = [];
    for (const file of Array.from(files)) {
      try { added.push(...await readSpreadsheet(file)); }
      catch (e) { failures.push(e instanceof Error ? e.message : String(e)); }
    }
    setTables((current) => [...current, ...added.filter((row) => !current.some((old) => old.id === row.id))]);
    setNotice(`读取 ${added.length} 个表格数据集。每个文件或工作表视为一个独立批次。`);
    if (failures.length) setError(failures.join("；"));
  };

  const addAb1 = (files: FileList | null) => {
    if (!files?.length) return;
    const incoming = Array.from(files).filter((file) => /\.(ab1|abi)$/i.test(file.name));
    setAb1((current) => {
      const known = new Set(current.map((entry) => entry.id));
      return [...current, ...incoming.flatMap((file) => {
        const id = `${file.name}:${file.size}:${file.lastModified}`;
        if (known.has(id)) return [];
        return [{ id, file, group: ab1UploadGroup.trim(), batch: ab1UploadBatch.trim(), includeTable: !tables.length }];
      })];
    });
    setNotice(`已选择 ${incoming.length} 个 AB1。`);
  };

  const updateTable = (id: string, key: "group" | "batch", value: string) =>
    setTables((current) => current.map((row) => row.id === id ? { ...row, [key]: value } : row));
  const updateAb1 = (id: string, change: Partial<Ab1Entry>) =>
    setAb1((current) => current.map((entry) => entry.id === id ? { ...entry, ...change } : entry));

  const updateRegionEvidence = (name: string, change: Partial<RegionEvidence>) =>
    setRegionEvidence((current) => ({ ...current, [name]: { ...(current[name] ?? emptyRegionEvidence()), ...change } }));

  const addRegionAb1 = (name: string, files: FileList | null) => {
    if (!files?.length) return;
    const incoming = Array.from(files).filter((file) => /\.(ab1|abi)$/i.test(file.name));
    setRegionEvidence((current) => {
      const evidence = current[name] ?? emptyRegionEvidence();
      const group = evidence.uploadGroup || comparison?.groups[0] || groups[0] || "Sample_1";
      const batch = evidence.uploadBatch || datasets.find((dataset) => dataset.group === group)?.batch || "Batch_1";
      const known = new Set(evidence.entries.map((entry) => entry.id));
      return { ...current, [name]: { ...evidence, reads: [], entries: [...evidence.entries,
        ...incoming.flatMap((file) => {
          const id = `${file.name}:${file.size}:${file.lastModified}`;
          return known.has(id) ? [] : [{ id, file, group, batch }];
        })] } };
    });
    setNotice(`${name} 已选择 ${incoming.length} 个 AB1，请按条件组检查后比对。`);
  };

  const processRegionAb1 = async (name: string) => {
    const evidence = regionEvidence[name];
    if (!evidence?.entries.length) { setError("请先为此区域选择 AB1 文件。"); return; }
    if (regionReference.length < 50) { setError("此区域的参考 DNA 序列至少需要 50 bp。"); return; }
    if (!regionTarget || regionReference.indexOf(regionTarget) < 0 ||
      regionReference.indexOf(regionTarget) !== regionReference.lastIndexOf(regionTarget)) {
      setError("此区域的靶序列必须在参考序列中恰好出现一次，以确定 distance=0。"); return;
    }
    if (evidence.entries.some((entry) => !groups.includes(entry.group) || !entry.batch.trim())) {
      setError("请为此区域的每个 AB1 选择已有的条件组并填写批次编号。"); return;
    }
    setBusy(true); setError("");
    const mapped: Read[] = [], failures: string[] = [];
    for (const entry of evidence.entries) {
      try {
        const result = await analyzeFile(entry.file, regionReference, trim, qualityThreshold, windowSize);
        mapped.push({ file: entry.file, group: entry.group, batch: entry.batch.trim(), result });
      } catch (e) { failures.push(`${entry.file.name}：${e instanceof Error ? e.message : String(e)}`); }
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    }
    updateRegionEvidence(name, { reads: mapped });
    setBusy(false);
    setNotice(`${name} 完成 ${mapped.length} 个 AB1 比对，按样本和批次拼接为 ${regionBatches(mapped).length} 行区域 logo。`);
    if (failures.length) setError(failures.join("；"));
  };

  const processAb1 = async () => {
    setError("");
    if (!reference || reference.length < 50) { setError("请提供至少 50 bp 的参考 DNA 序列。"); return; }
    if (!target || reference.indexOf(target) < 0 || reference.indexOf(target) !== reference.lastIndexOf(target)) {
      setError("靶序列必须在参考序列中恰好出现一次，才能确定 distance=0。"); return;
    }
    if (!ab1.length) { setError("请先选择 AB1 文件。"); return; }
    if (ab1.some((entry) => !entry.group.trim() || !entry.batch.trim())) { setError("每个 AB1 都需要条件组和批次名称。"); return; }
    setBusy(true); setNotice("正在用原工具算法逐条比对 AB1…");
    const mapped: Read[] = [], failures: string[] = [];
    for (const entry of ab1) {
      try {
        const result = await analyzeFile(entry.file, reference, trim, qualityThreshold, windowSize);
        mapped.push({ file: entry.file, group: entry.group.trim(), batch: entry.batch.trim(), result });
      } catch (e) { failures.push(`${entry.file.name}：${e instanceof Error ? e.message : String(e)}`); }
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    }
    const { datasets: next, failures: mergeFailures } = mergeAb1Batches(mapped,
      new Set(ab1.filter((entry) => entry.includeTable).map((entry) => entry.file)), reference, target);
    failures.push(...mergeFailures);
    setReads(mapped); setGenerated(next); setBusy(false);
    setNotice(`完成 ${mapped.length} 个读段比对，生成 ${next.length} 个独立批次的 CpG 表格；表格已直接进入比较。`);
    if (failures.length) setError(failures.join("；"));
  };

  const saveRegion = () => {
    if (!comparison) { setError("请先导入至少两个条件组。"); return; }
    if (regions.length >= 12) { setError("最多保存 12 个区域。"); return; }
    const a = Number(start), b = Number(end);
    if (!Number.isFinite(a) || !Number.isFinite(b)) { setError("请输入有效的区域坐标。"); return; }
    const bounded = clampBounds(Math.round(a), Math.round(b), full);
    const lo = Math.round(bounded[0]), hi = Math.round(bounded[1]);
    const region = { name: `R${String(Math.max(0, ...regions.map((r) => Number(r.name.slice(1)))) + 1).padStart(2, "0")}`, start: lo, end: hi };
    setRegions((current) => [...current, region]); setSelectedRegion(region.name); setViewport([lo, hi]);
    setRegionEvidence((current) => ({ ...current, [region.name]: emptyRegionEvidence() }));
    setNotice(`已保存 ${region.name}：${lo}–${hi} bp。`);
  };

  const exportFigure = async (part: ReportPart, format: "png" | "pdf", shouldPreview = false) => {
    if (!comparison) { setError("请先导入可比较的数据。"); return; }
    setBusy(true); setError("");
    try {
      const canvas = await reportCanvas(datasets, comparison, regions, reads, reference, center, part, trim, qualityThreshold, windowSize, regionSources);
      if (shouldPreview) setPreview(canvas.toDataURL("image/png"));
      else await downloadReport(canvas, format, `Young-Methy-Comparation_${part}.${format}`);
      setNotice(shouldPreview ? "报告预览已生成。" : "文件已交给浏览器下载。");
    } catch (e) { setError(`生成报告失败：${e instanceof Error ? e.message : String(e)}`); }
    finally { setBusy(false); }
  };

  const active = regions.find((r) => r.name === selectedRegion) ?? regions[0];
  const activeEvidence = active ? regionEvidence[active.name] ?? emptyRegionEvidence() : null;
  const ab1BatchCount = new Set(ab1.map((entry) => `${entry.group}\u0000${entry.batch}`)).size;
  const regionAb1BatchCount = new Set(activeEvidence?.entries.map((entry) => `${entry.group}\u0000${entry.batch}`)).size;
  const regionUploadGroup = activeEvidence?.uploadGroup || comparison?.groups[0] || "";
  const regionUploadBatch = activeEvidence?.uploadBatch || datasets.find((dataset) => dataset.group === regionUploadGroup)?.batch || "Batch_1";
  return <div className="app-shell">
    <header className="hero"><div className="hero-inner"><h1>甲基化差异图谱分析工具</h1></div></header>
    <main className="layout">
      <aside className="sidebar">
        <section className="card"><h2><span>01</span> 导入已有表格</h2>
          <label className="upload-box">＋ 选择 CSV 或 Excel（可多选）<input type="file" accept=".csv,.tsv,.xls,.xlsx" multiple
            onChange={(e) => { void readTables(e.target.files); e.target.value = ""; }} /></label>
          </section>
        <section className="card"><h2><span>02</span> 从 AB1 生成表格</h2>
          <label>参考 DNA 序列（FASTA 或纯序列）<textarea value={referenceInput} onChange={(e) => setReferenceInput(e.target.value)} placeholder=">reference\nACGT…" rows={4} /></label>
          <label>靶序列（在参考中恰好出现一次）<input value={targetInput} onChange={(e) => setTargetInput(e.target.value)} placeholder="ACGT…" /></label>
          <div className="input-pair"><label>本次上传所属条件组<input list="known-groups" value={ab1UploadGroup} onChange={(e) => setAb1UploadGroup(e.target.value)} /></label>
            <label>本次上传独立批次<input value={ab1UploadBatch} onChange={(e) => setAb1UploadBatch(e.target.value)} /></label></div>
          <datalist id="known-groups">{groups.map((group) => <option key={group} value={group} />)}</datalist>
          <label className="upload-box">＋ 选择 AB1（可多选）<input type="file" accept=".ab1,.abi" multiple
            onChange={(e) => { addAb1(e.target.files); e.target.value = ""; }} /></label>
          <details><summary>原算法质量修剪设置</summary><label className="check"><input type="checkbox" checked={trim} onChange={(e) => setTrim(e.target.checked)} /> 启用滑窗 Phred 修剪</label>
            <div className="input-pair"><label>最低平均 Q<input type="number" min="1" max="60" value={qualityThreshold} onChange={(e) => setQualityThreshold(Number(e.target.value))} /></label>
              <label>窗口 bp<input type="number" min="3" max="100" value={windowSize} onChange={(e) => setWindowSize(Number(e.target.value))} /></label></div></details>
          <button className="primary" disabled={busy || !ab1.length} onClick={() => void processAb1()}>{busy ? "正在处理…" : "比对 AB1 并生成 CpG 表格"}</button>
          </section>
        <section className="card"><h2><span>03</span> 比较规则</h2>
          <div className="field-title">参与检验的条件组</div>
          <div className="checks">{groups.map((group) => <label key={group} className="check"><input type="checkbox"
            checked={useCompared.includes(group)} onChange={(e) => setCompared((current) => {
              const seed = current ?? defaultCompared;
              return e.target.checked ? [...new Set([...seed, group])] : seed.filter((g) => g !== group);
            })} /> {group}</label>)}</div>
          <label>观察差值阈值（百分点）<input type="number" min="0" max="100" value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} /></label>
          <label>独立批次检验<select value={method} onChange={(e) => setMethod(e.target.value as Method)}><option value="welch">Welch ANOVA</option><option value="anova">普通单因素 ANOVA</option></select></label>
          <label>有重复时的标记<select value={marking} onChange={(e) => setMarking(e.target.value as Marking)}><option value="p">P &lt; 0.05</option><option value="q">BH 校正 Q &lt; 0.05</option></select></label>
          <p className="hint">每组至少 3 个独立批次才做逐 CpG 检验。无足够重复时，红色小星号仅表示所选组间观察差值超过阈值。</p></section>
        <section className="card"><h2><span>04</span> 区域与报告</h2>
          <div className="input-pair"><label>起点 bp<input type="number" value={start} onChange={(e) => setStart(e.target.value)} /></label>
            <label>终点 bp<input type="number" value={end} onChange={(e) => setEnd(e.target.value)} /></label></div>
          <button className="secondary" onClick={saveRegion}>保存区域（最小 50 bp）</button>
          <div className="region-list">{regions.map((r) => <div key={r.name} className={`region-row ${active?.name === r.name ? "active" : ""}`}>
            <button onClick={() => { setSelectedRegion(r.name); setViewport([r.start, r.end]); setStart(String(Math.round(r.start))); setEnd(String(Math.round(r.end))); }}>{r.name} · {Math.round(r.start)}–{Math.round(r.end)}</button>
            <button aria-label={`删除 ${r.name}`} onClick={() => {
              setRegions((current) => current.filter((v) => v.name !== r.name));
              setRegionEvidence((current) => { const next = { ...current }; delete next[r.name]; return next; });
              if (selectedRegion === r.name) setSelectedRegion("");
            }}>×</button></div>)}</div>
          <button className="ghost" onClick={() => setViewport(full)}>显示全长</button>
          <div className="export-grid"><button disabled={busy || !comparison} onClick={() => void exportFigure("combined", "png", true)}>预览合并图</button>
            <button disabled={busy || !comparison} onClick={() => void exportFigure("combined", "png")}>合并 PNG</button>
            <button disabled={busy || !comparison} onClick={() => void exportFigure("combined", "pdf")}>合并 PDF</button>
            <button disabled={busy || !comparison} onClick={() => void exportFigure("main", "png")}>单独主图</button>
            <button disabled={busy || !comparison || !regions.length} onClick={() => void exportFigure("logo", "png")}>单独 AB1 logo 图</button></div>
        </section>
      </aside>
      <div className="content">
        {notice && <div className="notice" role="status">{notice}</div>}{error && <div className="error" role="alert">{error}</div>}
        <section className="card"><div className="section-head"><div><div className="eyebrow">DATASETS</div><h2>输入数据与独立批次</h2></div><strong>{datasets.length} 份</strong></div>
          {!datasets.length && !ab1.length ? <p className="empty">先导入已有表格，或上传 AB1 生成 CpG 表格。</p> : null}
          {tables.length > 0 && <div className="table-wrap"><table><thead><tr><th>文件 / 工作表</th><th>条件组</th><th>独立批次</th><th>CpG</th><th></th></tr></thead><tbody>
            {tables.map((d) => <tr key={d.id}><td>{d.file}{d.sheet && ` / ${d.sheet}`}</td>
              <td><input value={d.group} onChange={(e) => updateTable(d.id, "group", e.target.value)} /></td>
              <td><input value={d.batch} onChange={(e) => updateTable(d.id, "batch", e.target.value)} /></td>
              <td>{d.rows.length}</td><td><button className="small" onClick={() => setTables((current) => current.filter((row) => row.id !== d.id))}>移除</button></td></tr>)}</tbody></table></div>}
          {ab1.length > 0 && <details className="ab1-details"><summary>已选择 {ab1.length} 个 AB1，分属 {ab1BatchCount} 个组/批次 · 查看或调整读段</summary>
            <div className="table-wrap"><table><thead><tr><th>文件</th><th>条件组</th><th>独立批次</th><th>加入比较</th><th></th></tr></thead><tbody>
            {ab1.map((entry) => <tr key={entry.id}><td><span className="file-name" title={entry.file.name}>{entry.file.name}</span></td><td><input value={entry.group} onChange={(e) => updateAb1(entry.id, { group: e.target.value })} /></td>
              <td><input value={entry.batch} onChange={(e) => updateAb1(entry.id, { batch: e.target.value })} /></td>
              <td><input type="checkbox" checked={entry.includeTable} onChange={(e) => updateAb1(entry.id, { includeTable: e.target.checked })} /></td>
              <td><button className="small" onClick={() => { setAb1((current) => current.filter((x) => x.id !== entry.id)); setReads([]); setGenerated([]); }}>移除</button></td></tr>)}</tbody></table></div></details>}
          {generated.length > 0 && <div className="table-wrap"><h3>由原工具算法生成、已进入比较的表格</h3><table><thead><tr><th>条件组 / 批次</th><th>CpG</th><th>表格名</th><th>下载</th></tr></thead><tbody>
            {generated.map((d) => <tr key={d.id}><td>{d.group} / {d.batch}</td><td>{d.rows.length}</td><td>{d.file}</td>
              <td><button className="small" onClick={() => saveText(datasetCsv(d), `${d.group}_${d.batch}_CpG.csv`)}>CSV</button></td></tr>)}</tbody></table></div>}
        </section>
        <section className="card"><div className="section-head"><div><div className="eyebrow">OVERVIEW</div><h2>共轴甲基化图谱</h2></div><span className="muted">横向拖动缩放 · 点击图后按 + / − 调整 · 双击复位</span></div>
          {duplicateBatches && <p className="error">同一条件组出现重复批次名称；请在上方修改，以免把同一批次计为独立重复。</p>}
          {comparison ? <><div className="metrics"><div><strong>{comparison.groups.length}</strong><span>条件组</span></div><div><strong>{datasets.length}</strong><span>独立批次</span></div>
            <div><strong>{comparison.sites.length}</strong><span>CpG 坐标</span></div><div><strong>{comparison.sites.filter((s) => s.marked).length}</strong><span>红色星号</span></div></div>
            <p className="chart-note">{comparison.inferential ? `${method === "welch" ? "Welch" : "单因素"} ANOVA · ${marking.toUpperCase()} < 0.05；星号是所选组的总体检验。`
              : `观察差异模式：所选组最大均值差 > ${threshold} 个百分点；不显示 P 值。`}</p>
            <SharedChart datasets={datasets} comparison={comparison} viewport={viewport} setViewport={(v) => { setViewport(v); setStart(String(Math.round(v[0]))); setEnd(String(Math.round(v[1]))); }} regions={regions} />
            {regions.length > 0 && <><RegionAtlas datasets={datasets} comparison={comparison} regions={regions}
              sources={regionSources} />
              <div className="legend"><span style={{ color: baseColors.A }}>● A</span><span style={{ color: baseColors.C }}>● C</span>
                <span style={{ color: baseColors.G }}>● G</span><span style={{ color: baseColors.T }}>● T</span></div></>}
          </> : <p className="empty">至少导入两个条件组，图谱会在这里出现。</p>}</section>
        {active && comparison && activeEvidence && <section className="card"><div className="section-head"><div><div className="eyebrow">REGIONAL EVIDENCE</div>
          <h2>{active.name} · {Math.round(active.start)}–{Math.round(active.end)} bp</h2></div></div>
          <div className="region-inputs"><h3>为 {active.name} 补充 AB1 序列 logo</h3>
            <label>区域共用参考 DNA 序列（FASTA 或纯序列）<textarea rows={4} value={regionReferenceInput}
              onChange={(e) => { setRegionReferenceInput(e.target.value); resetRegionReads(); }} placeholder=">reference\nACGT…" /></label>
            <label>区域共用靶序列（对应表格的 distance=0）<input value={regionTargetInput}
              onChange={(e) => { setRegionTargetInput(e.target.value); resetRegionReads(); }} placeholder="ACGT…" /></label>
            <div className="input-pair"><label>本次上传所属样本<select value={regionUploadGroup}
              onChange={(e) => updateRegionEvidence(active.name, { uploadGroup: e.target.value, uploadBatch: "" })}>
              {comparison.groups.map((group) => <option key={group} value={group}>{group}</option>)}</select></label>
              <label>本次上传批次编号<input value={regionUploadBatch}
                onChange={(e) => updateRegionEvidence(active.name, { uploadBatch: e.target.value })} /></label></div>
            <label className="upload-box">＋ 上传 {active.name} 的 AB1（可多选）<input type="file" accept=".ab1,.abi" multiple
              onChange={(e) => { addRegionAb1(active.name, e.target.files); e.target.value = ""; }} /></label>
            {activeEvidence.entries.length > 0 && <details className="ab1-details"><summary>已选择 {activeEvidence.entries.length} 个 AB1，分属 {regionAb1BatchCount} 个样本/批次 · 查看或调整读段</summary>
              <div className="table-wrap"><table><thead><tr><th>AB1 文件</th><th>样本</th><th>批次编号</th><th></th></tr></thead><tbody>
              {activeEvidence.entries.map((entry) => <tr key={entry.id}><td><span className="file-name" title={entry.file.name}>{entry.file.name}</span></td><td><select value={entry.group}
                onChange={(e) => updateRegionEvidence(active.name, { entries: activeEvidence.entries.map((item) =>
                  item.id === entry.id ? { ...item, group: e.target.value } : item), reads: [] })}>
                {comparison.groups.map((group) => <option key={group} value={group}>{group}</option>)}</select></td>
                <td><input value={entry.batch} onChange={(e) => updateRegionEvidence(active.name, { entries: activeEvidence.entries.map((item) =>
                  item.id === entry.id ? { ...item, batch: e.target.value } : item), reads: [] })} /></td>
                <td><button className="small" onClick={() => updateRegionEvidence(active.name, {
                  entries: activeEvidence.entries.filter((item) => item.id !== entry.id), reads: [] })}>移除</button></td></tr>)}</tbody></table></div></details>}
            <button className="primary" disabled={busy || !activeEvidence.entries.length}
              onClick={() => void processRegionAb1(active.name)}>{busy ? "正在处理…" : `比对并显示 ${active.name} logo`}</button>
            <div className="region-options"><label className="check"><input type="checkbox" checked={activeEvidence.filterQ}
              onChange={(e) => updateRegionEvidence(active.name, { filterQ: e.target.checked })} /> 按质控分数筛选 logo</label>
              {activeEvidence.filterQ && <label>最低 Phred Q<input type="number" min="0" max="60" value={activeEvidence.minimumQ}
                onChange={(e) => updateRegionEvidence(active.name, { minimumQ: Math.max(0, Math.min(60, Number(e.target.value) || 0)) })} /></label>}
              <label className="check"><input type="checkbox" checked={activeEvidence.focus}
                onChange={(e) => updateRegionEvidence(active.name, { focus: e.target.checked })} /> Focus：只显示 CpG 位点的 C/T logo</label>
              <label className="check"><input type="checkbox" checked={activeEvidence.showCpn}
                onChange={(e) => updateRegionEvidence(active.name, { showCpn: e.target.checked })} /> 显示非 CpG C（CpN）位点</label></div>
          </div>
          <p className="hint">比对后，logo 显示在上方对应的局部图下方。CpG/CpN 按 C/T 峰高比例绘制；关闭 Focus 后，其他位点按四通道峰高比例浅色显示。</p></section>}
        {preview && <section className="card"><div className="section-head"><div><div className="eyebrow">REPORT</div><h2>合并报告预览</h2></div></div>
          <img className="report-preview" src={preview} alt="甲基化与 AB1 logo 合并报告" />
          <p className="hint">无测序信号的位置留白；区域 logo 按当前质控、Focus 与 CpN 选择生成。</p></section>}
      </div>
    </main>
  </div>;
}
