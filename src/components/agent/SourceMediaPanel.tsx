import { useEffect, useMemo, useRef, useState } from 'react';
import { inspectionToSource, parseEditDecisionList, parseSourceTranscript, searchSourceTranscript, type SourceMediaInspection } from '@/lib/sourceMedia';
import { transcriptSelectionRange, type SourceTranscriptionCapabilities, type SourceTranscriptionFailure, type SourceTranscriptionProgress, type SourceTranscriptionResult } from '@/lib/sourceTranscription';
import { useEditorStore } from '@/store/editorStore';
import { useUIStore } from '@/store/uiStore';
import RoughCutReviewPanel from './RoughCutReviewPanel';
import type { SourceVisualCheckpointResult } from '@/lib/sourceVisualCheckpoint';
import SourceEventMarkerPanel from './SourceEventMarkerPanel';
import SourceActionIndexPanel from './SourceActionIndexPanel';
import SourceVisualIndexPanel from './SourceVisualIndexPanel';
import SourceStoryAssemblyPanel from './SourceStoryAssemblyPanel';

interface SourceMediaBridge {
  selectSourceMedia: () => Promise<{ canceled: boolean; sources: SourceMediaInspection[] }>;
  inspectSourceMedia: (paths: string[]) => Promise<SourceMediaInspection[]>;
  registerSourceMedia: (path: string) => Promise<{ url: string }>;
  generateSourceProxy: (sourceId: string, path: string) => Promise<{ proxyPath: string; url: string }>;
  cancelSourceProxy: (sourceId: string) => Promise<{ canceled: boolean }>;
  generateSourceWaveform: (path: string) => Promise<{ peaks: number[] }>;
  generateSourceVisualCheckpoint: (path: string, start: number, end: number) => Promise<SourceVisualCheckpointResult>;
  getSourceTranscriptionCapabilities: () => Promise<SourceTranscriptionCapabilities>;
  startSourceTranscription: (sourceId: string, path: string, options: { model: string; language: string }) => Promise<{ jobId: string; cached: boolean; result?: SourceTranscriptionResult }>;
  cancelSourceTranscription: (jobId: string) => Promise<{ canceled: boolean }>;
  onSourceProxyProgress: (listener: (progress: { sourceId: string; percent: number }) => void) => () => void;
  onSourceTranscriptionProgress: (listener: (progress: SourceTranscriptionProgress) => void) => () => void;
  onSourceTranscriptionResult: (listener: (result: SourceTranscriptionResult) => void) => () => void;
  onSourceTranscriptionError: (listener: (failure: SourceTranscriptionFailure) => void) => () => void;
}

function clock(seconds: number) {
  const safe = Math.max(0, seconds || 0);
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = Math.floor(safe % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

export default function SourceMediaPanel() {
  const sources = useEditorStore((state) => state.sourceMedia);
  const blocks = useEditorStore((state) => state.blocks);
  const addSourceMedia = useEditorStore((state) => state.addSourceMedia);
  const updateSourceMedia = useEditorStore((state) => state.updateSourceMedia);
  const removeSourceMedia = useEditorStore((state) => state.removeSourceMedia);
  const addSourceClip = useEditorStore((state) => state.addSourceClip);
  const [expanded, setExpanded] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const [sourceIn, setSourceIn] = useState(0);
  const [sourceOut, setSourceOut] = useState(5);
  const [proxyId, setProxyId] = useState('');
  const [proxyProgress, setProxyProgress] = useState(0);
  const [message, setMessage] = useState('');
  const [waveformBusy, setWaveformBusy] = useState(false);
  const [transcriptionCapabilities, setTranscriptionCapabilities] = useState<SourceTranscriptionCapabilities>();
  const [transcriptionJob, setTranscriptionJob] = useState<{ jobId: string; sourceId: string }>();
  const [transcriptionProgress, setTranscriptionProgress] = useState(0);
  const [transcriptionPhase, setTranscriptionPhase] = useState<SourceTranscriptionProgress['phase']>('queued');
  const [transcriptionModel, setTranscriptionModel] = useState('small');
  const [transcriptionLanguage, setTranscriptionLanguage] = useState('zh');
  const [previewTime, setPreviewTime] = useState(0);
  const [transcriptQuery, setTranscriptQuery] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const edlRef = useRef<HTMLInputElement>(null);
  const transcriptRef = useRef<HTMLInputElement>(null);
  const bridge = (window as Window & { hyperframesElectron?: SourceMediaBridge }).hyperframesElectron;
  const selected = sources.find((item) => item.id === selectedId) ?? sources[0];
  const clipDuration = Math.max(0, sourceOut - sourceIn);
  const transcriptResults = useMemo(
    () => selected ? searchSourceTranscript(selected.transcript ?? [], transcriptQuery).slice(0, 20) : [],
    [selected, transcriptQuery],
  );
  const displayPeaks = useMemo(() => {
    const peaks = selected?.waveform?.peaks ?? [];
    const step = Math.max(1, Math.ceil(peaks.length / 180));
    return peaks.filter((_, index) => index % step === 0);
  }, [selected?.waveform]);

  useEffect(() => {
    if (!selectedId && sources[0]) setSelectedId(sources[0].id);
  }, [selectedId, sources]);

  useEffect(() => {
    if (!selected || !bridge) { setPreviewUrl(''); return; }
    let active = true;
    void (async () => {
      try {
        const result = await bridge.registerSourceMedia(selected.proxyPath || selected.path);
        if (active) setPreviewUrl(result.url);
      } catch {
        if (selected.proxyPath) {
          try {
            const fallback = await bridge.registerSourceMedia(selected.path);
            if (active) {
              setPreviewUrl(fallback.url);
              updateSourceMedia(selected.id, { proxyPath: undefined, status: 'original' });
            }
            return;
          } catch { /* 原片也已离线。 */ }
        }
        if (active) {
          setPreviewUrl('');
          updateSourceMedia(selected.id, { status: 'missing' });
        }
      }
    })();
    setSourceIn(0);
    setSourceOut(Math.min(5, selected.duration));
    setPreviewTime(0);
    setTranscriptQuery('');
    return () => { active = false; };
  }, [bridge, selected?.id, selected?.path, selected?.proxyPath, updateSourceMedia]);

  useEffect(() => {
    if (!bridge) return;
    return bridge.onSourceProxyProgress((progress) => {
      if (progress.sourceId === proxyId) setProxyProgress(progress.percent);
    });
  }, [bridge, proxyId]);

  useEffect(() => {
    if (!bridge) return;
    let active = true;
    void bridge.getSourceTranscriptionCapabilities().then((capabilities) => {
      if (!active) return;
      setTranscriptionCapabilities(capabilities);
      setTranscriptionModel((current) => capabilities.models.includes(current) ? current : (capabilities.models[0] ?? current));
    });
    const stopProgress = bridge.onSourceTranscriptionProgress((progress) => {
      setTranscriptionJob((job) => {
        if (!job || job.jobId !== progress.jobId) return job;
        setTranscriptionProgress(progress.percent);
        setTranscriptionPhase(progress.phase);
        return job;
      });
    });
    const stopResult = bridge.onSourceTranscriptionResult((result) => {
      updateSourceMedia(result.sourceId, { transcript: result.segments, transcription: result.meta, roughCutPlan: undefined });
      setTranscriptionJob((job) => job?.jobId === result.jobId ? undefined : job);
      setTranscriptionProgress(100);
      setMessage(`本机转写完成：${result.segments.length} 段，含逐词时间码，结果已缓存。`);
    });
    const stopError = bridge.onSourceTranscriptionError((failure) => {
      setTranscriptionJob((job) => job?.jobId === failure.jobId ? undefined : job);
      setMessage(`本机转写失败：${failure.error}`);
    });
    return () => { active = false; stopProgress(); stopResult(); stopError(); };
  }, [bridge, updateSourceMedia]);

  const usedClipCount = useMemo(() => blocks.filter(
    (block) => block.type === 'video' && Boolean(block.props.externalSourceId),
  ).length, [blocks]);

  const importSources = async () => {
    if (!bridge) return;
    setMessage('正在读取原片信息…');
    try {
      const result = await bridge.selectSourceMedia();
      if (result.canceled) { setMessage(''); return; }
      const imported = result.sources.map(inspectionToSource);
      imported.forEach(addSourceMedia);
      if (imported[0]) setSelectedId(imported[0].id);
      setMessage(`已引用 ${imported.length} 条原片；工程没有复制视频数据。`);
    } catch (error) {
      setMessage(`导入失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const createProxy = async () => {
    if (!bridge || !selected) return;
    setProxyId(selected.id);
    setProxyProgress(0);
    setMessage('正在生成 960px 轻量代理，原片不会被修改…');
    try {
      const result = await bridge.generateSourceProxy(selected.id, selected.path);
      updateSourceMedia(selected.id, { proxyPath: result.proxyPath, status: 'proxy-ready' });
      setPreviewUrl(result.url);
      setProxyProgress(100);
      setMessage('代理已就绪；预览用代理，最终渲染仍用原片。');
    } catch (error) {
      setMessage(`代理失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setProxyId('');
    }
  };

  const addClip = () => {
    if (!selected || clipDuration < 0.1) return;
    addSourceClip(selected.id, sourceIn, sourceOut);
    setMessage(`已把 ${clock(sourceIn)}–${clock(sourceOut)} 放入当前播放头。`);
  };

  const createWaveform = async () => {
    if (!bridge || !selected || waveformBusy) return;
    setWaveformBusy(true);
    setMessage('正在读取音轨并建立波形缓存，不分析或上传视频画面…');
    try {
      const result = await bridge.generateSourceWaveform(selected.path);
      updateSourceMedia(selected.id, { waveform: { peaks: result.peaks, generatedAt: new Date().toISOString() } });
      setMessage(`波形已缓存，共 ${result.peaks.length} 个采样点。`);
    } catch (error) {
      setMessage(`波形生成失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setWaveformBusy(false);
    }
  };

  const seekSource = (time: number) => {
    const target = selected ? Math.max(0, Math.min(time, selected.duration)) : 0;
    if (videoRef.current) videoRef.current.currentTime = target;
    setPreviewTime(target);
  };

  const seekWaveform = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (!selected) return;
    const rect = event.currentTarget.getBoundingClientRect();
    seekSource((event.clientX - rect.left) / Math.max(1, rect.width) * selected.duration);
  };

  const importTranscript = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !selected) return;
    try {
      const segments = parseSourceTranscript(await file.text());
      if (!segments.length) throw new Error('没有识别到带时间码的字幕段落。');
      updateSourceMedia(selected.id, {
        transcript: segments,
        roughCutPlan: undefined,
        transcription: {
          backend: 'imported',
          model: 'SRT/VTT',
          language: 'unknown',
          generatedAt: new Date().toISOString(),
          wordTimestamps: false,
        },
      });
      setMessage(`已导入 ${segments.length} 条转写，可按台词搜索镜头。`);
    } catch (error) {
      setMessage(`转写导入失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const startTranscription = async () => {
    if (!bridge || !selected || transcriptionJob) return;
    setTranscriptionProgress(0);
    setTranscriptionPhase('queued');
    setMessage('正在启动本机逐词转写；原片不会上传。CPU 长素材需要耐心等待…');
    try {
      const started = await bridge.startSourceTranscription(selected.id, selected.path, { model: transcriptionModel, language: transcriptionLanguage });
      if (started.result) {
        updateSourceMedia(started.result.sourceId, { transcript: started.result.segments, transcription: started.result.meta, roughCutPlan: undefined });
        setTranscriptionProgress(100);
        setMessage(`已直接复用缓存：${started.result.segments.length} 段逐词转写。`);
        return;
      }
      setTranscriptionJob({ jobId: started.jobId, sourceId: selected.id });
    } catch (error) {
      setMessage(`无法启动转写：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const cancelTranscription = async () => {
    if (!bridge || !transcriptionJob) return;
    const result = await bridge.cancelSourceTranscription(transcriptionJob.jobId);
    if (result.canceled) {
      setTranscriptionJob(undefined);
      setMessage('已取消本机转写；原片和已有转写未改动。');
    }
  };

  const importEdl = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !bridge) return;
    setMessage('正在读取 EDL 与原片…');
    try {
      const edl = parseEditDecisionList(JSON.parse(await file.text()));
      const aliases = [...new Set(edl.ranges.map((range) => range.source))];
      const inspections = await bridge.inspectSourceMedia(aliases.map((alias) => edl.sources[alias]));
      const byAlias = new Map(aliases.map((alias, index) => [alias, inspectionToSource(inspections[index])]));
      byAlias.forEach(addSourceMedia);
      let time = useUIStore.getState().currentTime;
      for (const range of edl.ranges) {
        const source = byAlias.get(range.source);
        if (!source) continue;
        useUIStore.getState().setTime(time);
        addSourceClip(source.id, range.start, range.end);
        time += range.end - range.start;
      }
      useUIStore.getState().setTime(time);
      setSelectedId(byAlias.values().next().value?.id ?? '');
      setMessage(`EDL 已生成 ${edl.ranges.length} 个连续粗剪片段。`);
    } catch (error) {
      setMessage(`EDL 导入失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return (
    <section className="rounded-lg border border-cyan-300/20 bg-panel-2/70 p-2.5" aria-label="长视频源素材台">
      <button type="button" onClick={() => setExpanded((value) => !value)} className="flex w-full items-center gap-2 text-left">
        <span className="text-[11px] font-semibold text-ink">长视频源素材台</span>
        <span className="rounded-full border border-cyan-300/25 bg-cyan-300/10 px-2 py-0.5 text-[9px] text-cyan-100">{sources.length} 原片 · {usedClipCount} 选段</span>
        <span className="ml-auto text-[11px] text-ink-faint">{expanded ? '−' : '+'}</span>
      </button>
      {expanded && (
        <div className="mt-2.5 space-y-2.5 border-t border-stroke pt-2.5">
          <div className="flex gap-1.5">
            <button type="button" onClick={() => void importSources()} disabled={!bridge} className="flex-1 rounded-md bg-cyan-500 px-2 py-1.5 text-[10.5px] font-medium text-white disabled:opacity-45">引用本地原片</button>
            <button type="button" onClick={() => edlRef.current?.click()} disabled={!bridge} className="rounded-md border border-stroke px-2 py-1.5 text-[10px] text-ink-dim disabled:opacity-45">导入 EDL</button>
            <input ref={edlRef} type="file" accept="application/json,.json" className="hidden" onChange={(event) => void importEdl(event)} />
          </div>
          {!bridge && <p className="text-[9px] leading-relaxed text-ink-faint">本地长视频引用需要从 HyperFrames 桌面版打开。</p>}
          {sources.length > 0 && (
            <select value={selected?.id ?? ''} onChange={(event) => setSelectedId(event.target.value)} className="w-full rounded border border-stroke bg-panel px-2 py-1.5 text-[10.5px] text-ink outline-none">
              {sources.map((source) => <option key={source.id} value={source.id}>{source.name} · {clock(source.duration)}{source.proxyPath ? ' · 代理就绪' : ''}</option>)}
            </select>
          )}
          <SourceStoryAssemblyPanel onMessage={setMessage} />
          {selected && (
            <>
              <div className="overflow-hidden rounded-md border border-stroke bg-black/70">
                {previewUrl ? <video ref={videoRef} src={previewUrl} controls preload="metadata" onTimeUpdate={(event) => setPreviewTime(event.currentTarget.currentTime)} className="aspect-video w-full object-contain" /> : <div className="flex aspect-video items-center justify-center text-[10px] text-ink-faint">素材不可读取</div>}
              </div>
              {selected.waveform?.peaks.length ? (
                <button type="button" onClick={seekWaveform} className="relative flex h-12 w-full items-center gap-px overflow-hidden rounded-md border border-cyan-300/20 bg-slate-950 px-1" title="点击波形跳转原片">
                  {displayPeaks.map((peak, index) => <span key={index} className="min-w-px flex-1 rounded-full bg-cyan-300/70" style={{ height: `${Math.max(4, peak * 42)}px` }} />)}
                  <span className="pointer-events-none absolute inset-y-0 w-px bg-amber-300" style={{ left: `${selected.duration ? previewTime / selected.duration * 100 : 0}%` }} />
                </button>
              ) : (
                <button type="button" onClick={() => void createWaveform()} disabled={!bridge || waveformBusy} className="w-full rounded-md border border-cyan-300/25 bg-cyan-300/[0.05] px-2 py-1.5 text-[10px] text-cyan-100 disabled:opacity-45">{waveformBusy ? '正在生成波形…' : '生成整段音频波形'}</button>
              )}
              <div className="grid grid-cols-2 gap-1.5">
                <button type="button" onClick={() => setSourceIn(videoRef.current?.currentTime ?? 0)} className="rounded border border-stroke px-2 py-1.5 text-[10px] text-ink-dim">设入点 {clock(sourceIn)}</button>
                <button type="button" onClick={() => setSourceOut(videoRef.current?.currentTime ?? selected.duration)} className="rounded border border-stroke px-2 py-1.5 text-[10px] text-ink-dim">设出点 {clock(sourceOut)}</button>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <label className="text-[9px] text-ink-faint">入点<input type="number" min={0} max={sourceOut} step={0.1} value={sourceIn} onChange={(event) => setSourceIn(Number(event.target.value))} className="mt-1 w-full rounded border border-stroke bg-panel px-2 py-1 text-[10px] text-ink" /></label>
                <label className="text-[9px] text-ink-faint">出点<input type="number" min={sourceIn} max={selected.duration} step={0.1} value={sourceOut} onChange={(event) => setSourceOut(Number(event.target.value))} className="mt-1 w-full rounded border border-stroke bg-panel px-2 py-1 text-[10px] text-ink" /></label>
              </div>
              <SourceEventMarkerPanel source={selected} start={sourceIn} end={sourceOut} onMessage={setMessage} onSelect={(start, end) => { setSourceIn(start); setSourceOut(end); seekSource(start); }} />
              <SourceActionIndexPanel key={selected.id} source={selected} start={sourceIn} end={sourceOut} onMessage={setMessage} />
              <SourceVisualIndexPanel key={`visual-${selected.id}`} source={selected} onSeek={seekSource} />
              {proxyId === selected.id && <div className="h-1.5 overflow-hidden rounded-full bg-panel-3"><div className="h-full bg-cyan-400" style={{ width: `${proxyProgress}%` }} /></div>}
              <div className="flex gap-1.5">
                <button type="button" onClick={addClip} disabled={clipDuration < 0.1} className="min-w-0 flex-1 rounded-md bg-violet-500 px-2 py-1.5 text-[10.5px] font-medium text-white disabled:opacity-45">选段进时间轴 · {clipDuration.toFixed(1)}s</button>
                {!selected.proxyPath && proxyId !== selected.id && <button type="button" onClick={() => void createProxy()} className="rounded-md border border-cyan-300/30 px-2 py-1.5 text-[10px] text-cyan-100">生成代理</button>}
                {proxyId === selected.id && <button type="button" onClick={() => void bridge?.cancelSourceProxy(selected.id)} className="rounded-md border border-red-300/30 px-2 py-1.5 text-[10px] text-red-200">取消</button>}
                <button type="button" onClick={() => { if (window.confirm('移除原片引用及其全部时间轴选段？原文件不会删除。')) removeSourceMedia(selected.id); }} className="rounded-md border border-stroke px-2 py-1.5 text-[10px] text-ink-faint">移除</button>
              </div>
              <div className="rounded-md border border-stroke bg-panel/50 p-2">
                <div className="mb-1.5 flex items-center justify-between"><span className="text-[10px] font-semibold text-ink-dim">本机逐词转写与台词检索</span><button type="button" onClick={() => transcriptRef.current?.click()} className="text-[9.5px] text-cyan-200">导入 SRT / VTT</button></div>
                <input ref={transcriptRef} type="file" accept=".srt,.vtt,text/vtt,application/x-subrip" className="hidden" onChange={(event) => void importTranscript(event)} />
                <div className="mb-1.5 grid grid-cols-[1fr_0.8fr_auto] gap-1.5">
                  <select value={transcriptionModel} onChange={(event) => setTranscriptionModel(event.target.value)} disabled={!transcriptionCapabilities?.models.length || Boolean(transcriptionJob)} className="min-w-0 rounded border border-stroke bg-panel px-1.5 py-1 text-[9.5px] text-ink disabled:opacity-45">
                    {(transcriptionCapabilities?.models.length ? transcriptionCapabilities.models : ['small']).map((model) => <option key={model} value={model}>{model} 模型</option>)}
                  </select>
                  <select value={transcriptionLanguage} onChange={(event) => setTranscriptionLanguage(event.target.value)} disabled={Boolean(transcriptionJob)} className="min-w-0 rounded border border-stroke bg-panel px-1.5 py-1 text-[9.5px] text-ink disabled:opacity-45">
                    <option value="zh">中文</option><option value="auto">自动识别</option><option value="en">英文</option>
                  </select>
                  {transcriptionJob ? <button type="button" onClick={() => void cancelTranscription()} className="rounded border border-red-300/30 px-2 py-1 text-[9.5px] text-red-200">取消转写</button> : <button type="button" onClick={() => void startTranscription()} disabled={!transcriptionCapabilities?.available || !transcriptionCapabilities.models.length} className="rounded bg-cyan-600 px-2 py-1 text-[9.5px] font-medium text-white disabled:opacity-45">{selected.transcript?.length ? '重新转写' : '开始转写'}</button>}
                </div>
                {transcriptionJob?.sourceId === selected.id && <div className="mb-1.5"><div className="mb-1 flex justify-between text-[8.5px] text-cyan-100"><span>{transcriptionPhase === 'loading-model' ? '加载模型' : transcriptionPhase === 'transcribing' ? '识别音频' : '排队'}</span><span>{transcriptionProgress}%</span></div><div className="h-1.5 overflow-hidden rounded-full bg-panel-3"><div className="h-full bg-cyan-400" style={{ width: `${transcriptionProgress}%` }} /></div></div>}
                {transcriptionCapabilities && <p className="mb-1.5 text-[8.5px] leading-relaxed text-ink-faint">{transcriptionCapabilities.available ? `${transcriptionCapabilities.cuda ? transcriptionCapabilities.deviceName : 'CPU 模式（两小时素材可能耗时较长）'} · 已缓存 ${transcriptionCapabilities.models.join(' / ') || '无'} 模型 · 原片不上传` : `本机转写不可用：${transcriptionCapabilities.error ?? '缺少运行库'}`}</p>}
                {selected.transcription && <p className="mb-1.5 text-[8.5px] text-emerald-200/80">当前：{selected.transcription.backend === 'faster-whisper' ? `${selected.transcription.model} · ${selected.transcription.wordTimestamps ? '逐词时间码' : '分段时间码'}${selected.transcription.cached ? ' · 缓存命中' : ''}` : '外部字幕 · 分段时间码'} · {selected.transcript?.length ?? 0} 段</p>}
                <input value={transcriptQuery} onChange={(event) => setTranscriptQuery(event.target.value)} disabled={!selected.transcript?.length} placeholder={selected.transcript?.length ? '搜索说过的话，例如：放盐、出锅…' : '先在本机转写，或导入带时间码字幕'} className="w-full rounded border border-stroke bg-panel px-2 py-1.5 text-[10px] text-ink outline-none disabled:opacity-45" />
                {transcriptQuery && <div className="mt-1.5 max-h-44 space-y-1 overflow-y-auto">
                  {transcriptResults.map((segment) => <div key={segment.id} className="rounded border border-stroke bg-panel/70 p-1.5">
                    <div className="flex items-start gap-1.5"><button type="button" onClick={() => seekSource(segment.start)} className="shrink-0 font-mono text-[9px] text-cyan-200">{clock(segment.start)}</button><span className="min-w-0 flex-1 text-[9.5px] leading-relaxed text-ink-dim">{segment.text}</span><button type="button" onClick={() => { const range = transcriptSelectionRange(segment, selected.duration); setSourceIn(range.start); setSourceOut(range.end); seekSource(range.start); }} className="shrink-0 rounded border border-violet-300/25 px-1.5 py-1 text-[9px] text-violet-100">设为选段</button></div>
                  </div>)}
                  {!transcriptResults.length && <p className="py-2 text-center text-[9px] text-ink-faint">没有找到匹配台词。</p>}
                </div>}
              </div>
              <RoughCutReviewPanel source={selected} onSeek={seekSource} onMessage={setMessage} generateVisualCheckpoint={bridge ? (start, end) => bridge.generateSourceVisualCheckpoint(selected.path, start, end) : undefined} />
              <p className="break-all text-[9px] leading-relaxed text-ink-faint">{selected.width}×{selected.height} · {(selected.size / 1024 / 1024 / 1024).toFixed(2)} GB · {selected.path}</p>
            </>
          )}
          {message && <p className="text-[9.5px] leading-relaxed text-cyan-100/80">{message}</p>}
          <p className="text-[9px] leading-relaxed text-ink-faint">EDL 格式：sources 映射本地路径，ranges 提供 source / start / end。适合接收 video-use 或其他粗剪工具的决策清单。</p>
        </div>
      )}
    </section>
  );
}
