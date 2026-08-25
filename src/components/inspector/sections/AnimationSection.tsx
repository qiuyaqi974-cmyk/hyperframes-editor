import type { AnimationType, Block, EasingName, SlideDirection } from '@/types';
import { useEditorStore } from '@/store/editorStore';
import { useUIStore } from '@/store/uiStore';
import { EASINGS } from '@/lib/animation';
import { NumberField, Row, Section, Segmented, SliderField } from '@/components/ui/Field';

const ANIM_OPTIONS: { value: AnimationType; label: string }[] = [
  { value: 'none', label: '无' },
  { value: 'fade', label: 'Fade' },
  { value: 'slide', label: 'Slide' },
  { value: 'scale', label: 'Scale' },
];

const EASE_OPTIONS: { value: EasingName; label: string }[] = [
  { value: 'linear', label: 'Linear' },
  { value: 'easeOut', label: 'Out' },
  { value: 'easeInOut', label: 'InOut' },
  { value: 'spring', label: 'Spring' },
];

const DIR_OPTIONS: { value: SlideDirection; label: string }[] = [
  { value: 'left', label: '← 左' },
  { value: 'right', label: '右 →' },
  { value: 'up', label: '↑ 上' },
  { value: 'down', label: '↓ 下' },
];

/** 缓动曲线预览：把 EASINGS 纯函数采样成折线，直观看到动画「怎么动」 */
function EasingCurve({ easing }: { easing: EasingName }) {
  const W = 132;
  const H = 40;
  const N = 48;
  const fn = EASINGS[easing] ?? EASINGS.linear;
  const pts: string[] = [];
  for (let i = 0; i <= N; i++) {
    const p = i / N;
    const v = Math.max(0, Math.min(1, fn(p)));
    pts.push(`${(p * W).toFixed(1)},${(H - v * H).toFixed(1)}`);
  }
  const label = EASE_OPTIONS.find((o) => o.value === easing)?.label ?? easing;
  return (
    <div className="flex items-center gap-2 rounded-md border border-stroke bg-panel-3 px-2 py-1.5">
      <svg width={W} height={H} className="shrink-0">
        <line x1="0" y1={H} x2={W} y2={H} stroke="#2c313a" strokeWidth="1" />
        <line x1="0" y1="0" x2="0" y2={H} stroke="#2c313a" strokeWidth="1" />
        <path d={`M${pts.join(' L')}`} fill="none" stroke="#5b8cff" strokeWidth="1.6" />
      </svg>
      <span className="text-[10.5px] text-ink-dim">{label} 曲线</span>
    </div>
  );
}

export default function AnimationSection({ block }: { block: Block }) {
  const updateAnimation = useEditorStore((s) => s.updateAnimation);
  const setTime = useUIStore((s) => s.setTime);
  const anim = block.animation;

  return (
    <Section title="Animation · 入场">
      <Segmented value={anim.type} options={ANIM_OPTIONS} onChange={(type) => updateAnimation(block.id, { type })} />

      {anim.type !== 'none' && (
        <>
          <Row label="时长">
            <NumberField
              value={anim.duration}
              onChange={(duration) => updateAnimation(block.id, { duration })}
              min={0.05}
              max={10}
              step={0.05}
              precision={2}
              suffix="s"
            />
          </Row>
          <Row label="延迟">
            <NumberField
              value={anim.delay}
              onChange={(delay) => updateAnimation(block.id, { delay })}
              min={0}
              max={10}
              step={0.05}
              precision={2}
              suffix="s"
            />
          </Row>
          <Row label="缓动">
            <Segmented
              value={anim.easing}
              options={EASE_OPTIONS}
              onChange={(easing) => updateAnimation(block.id, { easing })}
            />
          </Row>
          <EasingCurve easing={anim.easing} />
          {anim.type === 'slide' && (
            <>
              <Row label="方向">
                <Segmented
                  value={anim.direction}
                  options={DIR_OPTIONS}
                  onChange={(direction) => updateAnimation(block.id, { direction })}
                />
              </Row>
              <Row label="距离">
                <SliderField
                  value={anim.distance}
                  onChange={(distance) => updateAnimation(block.id, { distance })}
                  min={10}
                  max={1200}
                  step={10}
                  format={(v) => `${Math.round(v)}`}
                />
              </Row>
            </>
          )}
          {anim.type === 'scale' && (
            <Row label="起始">
              <SliderField
                value={anim.from}
                onChange={(from) => updateAnimation(block.id, { from })}
                min={0}
                max={2}
                step={0.05}
                format={(v) => `${Math.round(v * 100)}%`}
              />
            </Row>
          )}
          <button
            onClick={() => setTime(block.start)}
            className="w-full rounded-md border border-stroke bg-panel-3 py-[6px] text-[11px] text-ink-dim hover:border-accent hover:text-ink"
          >
            ↺ 跳到入点预览动画
          </button>
        </>
      )}
    </Section>
  );
}
