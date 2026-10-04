import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { detectSourceVisualChanges } from '../electron/sourceVisualIndex';
import { selectVisualIndexSamples } from '../src/lib/sourceVisualIndex';
import { evaluateCandidateCorrection, evaluateChangeDetection, evaluateSampleCoverage } from '../src/lib/sourceVisualBenchmark';
import type { VisualUnderstandingCandidate } from '../src/lib/sourceVisualUnderstanding';

const root = mkdtempSync(join(tmpdir(), 'hyperframes-visual-benchmark-'));
const create = (name: string, args: string[]) => {
  const path = join(root, `${name}.mp4`);
  const result = spawnSync(ffmpegInstaller.path, ['-y', ...args, path], { windowsHide: true, encoding: 'utf8' });
  assert.equal(result.status, 0, `${name}: ${result.stderr}`);
  return path;
};

try {
  const hardCuts = create('hard-cuts', [
    '-f', 'lavfi', '-i', 'color=c=red:s=320x180:r=4:d=3', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=4:d=3',
    '-f', 'lavfi', '-i', 'color=c=green:s=320x180:r=4:d=3', '-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1:a=0[out]',
    '-map', '[out]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
  ]);
  const longShot = create('long-shot', ['-f', 'lavfi', '-i', 'color=c=#334455:s=320x180:r=4:d=12', '-c:v', 'libx264', '-pix_fmt', 'yuv420p']);
  const slowChange = create('slow-change', ['-f', 'lavfi', '-i', 'color=c=white:s=320x180:r=4:d=8', '-vf', 'fade=t=in:st=1:d=5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p']);
  const shortAction = create('short-action', [
    '-f', 'lavfi', '-i', 'color=c=black:s=320x180:r=4:d=3', '-f', 'lavfi', '-i', 'color=c=white:s=320x180:r=4:d=0.5',
    '-f', 'lavfi', '-i', 'color=c=black:s=320x180:r=4:d=2.5', '-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1:a=0[out]',
    '-map', '[out]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
  ]);

  const hardDetected = await detectSourceVisualChanges(hardCuts);
  const longDetected = await detectSourceVisualChanges(longShot);
  const slowDetected = await detectSourceVisualChanges(slowChange);
  const shortDetected = await detectSourceVisualChanges(shortAction);
  const hardSamples = selectVisualIndexSamples(9, hardDetected, 12, 2);
  const longSamples = selectVisualIndexSamples(12, longDetected, 12, 4);
  const slowSamples = selectVisualIndexSamples(8, slowDetected, 12, 2);
  const shortSamples = selectVisualIndexSamples(6, shortDetected, 12, 10);

  const expected: VisualUnderstandingCandidate = { frameId: 'fixture-1', subject: '一只手', action: '拿着', object: '杯子', result: '', shot: 'closeup', tags: ['杯子'], uncertainty: '单帧无法确认后续动作', confidence: 0.8 };
  const fixtureCandidate: VisualUnderstandingCandidate = { ...expected, action: '放下', result: '杯子已放稳', tags: ['杯子', '完成'] };
  const report = {
    format: 'hyperframes-source-visual-benchmark-v1',
    onlineModelCalled: false,
    cases: {
      hardCuts: { changes: evaluateChangeDetection([3, 6], hardDetected), coverage: evaluateSampleCoverage(9, hardSamples), sentImageBudget: hardSamples.length },
      longShot: { changes: evaluateChangeDetection([], longDetected), coverage: evaluateSampleCoverage(12, longSamples), sentImageBudget: longSamples.length },
      slowChange: { changes: evaluateChangeDetection([], slowDetected), coverage: evaluateSampleCoverage(8, slowSamples), sentImageBudget: slowSamples.length, note: '缓慢亮度变化只记录观察，不要求被判为硬切。' },
      shortAction: { changes: evaluateChangeDetection([3, 3.5], shortDetected), coverage: evaluateSampleCoverage(6, shortSamples, [{ start: 3, end: 3.5 }]), sentImageBudget: shortSamples.length },
      transcriptConflictFixture: { candidateQuality: evaluateCandidateCorrection(fixtureCandidate, expected), note: '固定夹具模拟口播诱导错误；人工答案是唯一基准，没有调用在线模型。' },
    },
  };

  assert.equal(report.cases.hardCuts.changes.recall, 1, `hard-cut recall: ${JSON.stringify(report.cases.hardCuts.changes)}`);
  assert.equal(report.cases.hardCuts.changes.precision, 1, `hard-cut precision: ${JSON.stringify(report.cases.hardCuts.changes)}`);
  assert.equal(report.cases.longShot.changes.detected, 0, `static long shot false positives: ${longDetected}`);
  assert.equal(report.cases.shortAction.coverage.coveredImportantRanges, 1, `short action missed by samples: ${JSON.stringify(shortSamples)}`);
  assert.ok(Object.values(report.cases).filter((item) => 'sentImageBudget' in item).every((item) => item.sentImageBudget <= 12));
  assert.deepEqual(report.cases.transcriptConflictFixture.candidateQuality.corrections, ['action', 'result', 'tags']);

  const outputIndex = process.argv.indexOf('--output');
  if (outputIndex >= 0) {
    const outputPath = resolve(process.argv[outputIndex + 1]);
    if (!process.argv[outputIndex + 1]) throw new Error('--output 需要文件路径。');
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }
  console.log(JSON.stringify(report, null, 2));
  console.log('Source visual benchmark passed. Online vision was not called.');
} finally {
  const safeRoot = resolve(root);
  if (safeRoot.startsWith(resolve(tmpdir())) && safeRoot.includes('hyperframes-visual-benchmark-')) rmSync(safeRoot, { recursive: true, force: true });
}
