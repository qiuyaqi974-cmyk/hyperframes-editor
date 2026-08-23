import { useEffect, useRef, useState } from 'react';

/* ------------------------------------------------------------------ */
/* 分组                                                                */
/* ------------------------------------------------------------------ */

export function Section({
  title,
  children,
  accent,
}: {
  title: string;
  children: React.ReactNode;
  accent?: string;
}) {
  return (
    <div className="border-b border-stroke px-4 py-4">
      <div className="mb-3 flex items-center gap-2">
        {accent && (
          <span className="h-[10px] w-[3px] rounded-full" style={{ background: accent }} />
        )}
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-faint">
          {title}
        </h3>
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-[64px] shrink-0 text-[12px] text-ink-dim">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 数字输入：支持左右拖拽微调（编辑器该有的手感）                        */
/* ------------------------------------------------------------------ */

interface NumberFieldProps {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  precision?: number;
}

export function NumberField({
  value,
  onChange,
  min = -Infinity,
  max = Infinity,
  step = 1,
  suffix,
  precision = 0,
}: NumberFieldProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const drag = useRef<{ x: number; start: number } | null>(null);

  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const show = draft ?? (precision > 0 ? value.toFixed(precision) : String(Math.round(value)));

  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (!drag.current) return;
      const delta = (e.clientX - drag.current.x) * step;
      onChange(clamp(Number((drag.current.start + delta).toFixed(precision + 2))));
    };
    const up = () => {
      drag.current = null;
      document.body.style.cursor = '';
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  });

  return (
    <div className="flex items-center rounded-md border border-stroke bg-panel-3 focus-within:border-accent">
      <input
        className="w-full bg-transparent px-2 py-[6px] text-[12px] tabular-nums text-ink outline-none"
        value={show}
        onChange={(e) => {
          setDraft(e.target.value);
          const n = parseFloat(e.target.value);
          if (!Number.isNaN(n)) onChange(clamp(n));
        }}
        onBlur={() => setDraft(null)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'ArrowUp') {
            e.preventDefault();
            onChange(clamp(value + step));
          }
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            onChange(clamp(value - step));
          }
        }}
      />
      {suffix && <span className="pr-1 text-[10px] text-ink-faint">{suffix}</span>}
      <span
        title="左右拖拽调整"
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, start: value };
          document.body.style.cursor = 'ew-resize';
        }}
        className="cursor-ew-resize select-none px-[6px] text-[11px] text-ink-faint hover:text-accent"
      >
        ⇔
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 滑杆                                                                */
/* ------------------------------------------------------------------ */

export function SliderField({
  value,
  onChange,
  min,
  max,
  step = 0.01,
  format,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => string;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="range"
        className="hf-range flex-1"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
      <span className="w-[42px] shrink-0 text-right text-[11px] tabular-nums text-ink-dim">
        {format ? format(value) : value.toFixed(2)}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 分段选择                                                            */
/* ------------------------------------------------------------------ */

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex gap-1 rounded-md bg-panel-3 p-[3px]">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`flex-1 rounded px-1 py-[4px] text-[11px] transition-colors ${
            value === o.value
              ? 'bg-accent text-white'
              : 'text-ink-dim hover:bg-white/5 hover:text-ink'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 颜色                                                                */
/* ------------------------------------------------------------------ */

export function ColorField({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-stroke bg-panel-3 px-2 py-[4px]">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-[20px] w-[24px] cursor-pointer rounded border-0 bg-transparent p-0"
      />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-transparent font-mono text-[11px] uppercase text-ink outline-none"
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 开关                                                                */
/* ------------------------------------------------------------------ */

export function Toggle({
  value,
  onChange,
  label,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  label?: string;
}) {
  return (
    <button
      onClick={() => onChange(!value)}
      className="flex w-full items-center justify-between gap-2"
    >
      {label && <span className="text-[12px] text-ink-dim">{label}</span>}
      <span
        className={`relative h-[18px] w-[32px] shrink-0 rounded-full transition-colors ${
          value ? 'bg-accent' : 'bg-panel-3 ring-1 ring-inset ring-stroke'
        }`}
      >
        <span
          className="absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white transition-all"
          style={{ left: value ? 16 : 2 }}
        />
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* 文本域                                                              */
/* ------------------------------------------------------------------ */

export function TextArea({
  value,
  onChange,
  rows = 3,
}: {
  value: string;
  onChange: (v: string) => void;
  rows?: number;
}) {
  return (
    <textarea
      value={value}
      rows={rows}
      onChange={(e) => onChange(e.target.value)}
      className="w-full resize-y rounded-md border border-stroke bg-panel-3 px-2 py-[6px] text-[12px] leading-relaxed text-ink outline-none focus:border-accent"
    />
  );
}
