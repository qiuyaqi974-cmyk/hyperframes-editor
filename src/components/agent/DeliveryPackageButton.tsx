import { useState } from 'react';
import { createDeliveryPackage, type DeliveryPackagePayload } from '@/lib/exportDeliveryPackage';
import { useEditorStore } from '@/store/editorStore';
import { analyzeProjectHealth } from '@/lib/projectHealth';

interface ElectronDeliveryBridge {
  exportDeliveryPackage: (payload: DeliveryPackagePayload) => Promise<{ canceled: boolean; outputPath?: string }>;
  revealPath: (path: string) => Promise<string>;
}

export default function DeliveryPackageButton() {
  const [busy, setBusy] = useState(false);
  const [outputPath, setOutputPath] = useState('');
  const [status, setStatus] = useState('');
  const bridge = (window as Window & { hyperframesElectron?: ElectronDeliveryBridge }).hyperframesElectron;

  const handleExport = async () => {
    if (busy) return;
    if (!bridge) {
      setStatus('交付包需要从桌面版启动；浏览器版仍可导出 JSON / HTML。');
      return;
    }
    const snapshot = useEditorStore.getState().exportSnapshot();
    const health = analyzeProjectHealth(snapshot);
    if (health.blockers.length) {
      setStatus(`暂不能交付：${health.blockers[0].title}。请先打开“项目体检”。`);
      return;
    }
    setBusy(true);
    setStatus('正在整理时间轴与媒体文件…');
    try {
      const result = await bridge.exportDeliveryPackage(createDeliveryPackage(snapshot));
      if (result.canceled || !result.outputPath) {
        setStatus('已取消导出。');
        return;
      }
      setOutputPath(result.outputPath);
      setStatus('交付包已生成：含 manifest、sceneplan 和独立媒体文件。');
    } catch (error) {
      setStatus(`导出失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="inline-flex flex-col gap-1.5">
      <button
        type="button"
        onClick={handleExport}
        disabled={busy}
        className="w-full rounded-md border border-emerald-300/40 bg-emerald-300/10 px-2.5 py-[6px] text-left text-[11px] font-medium text-emerald-100 hover:bg-emerald-300/20 disabled:opacity-50"
      >
        {busy ? '正在整理交付包…' : '导出当前稿交付包'}
      </button>
      {status && <span className="text-[10px] leading-relaxed text-ink-faint">{status}</span>}
      {outputPath && bridge && (
        <button
          type="button"
          onClick={() => void bridge.revealPath(outputPath)}
          className="self-start text-[10px] text-emerald-200 underline underline-offset-2"
        >
          打开交付文件夹
        </button>
      )}
    </span>
  );
}
