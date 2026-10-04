import type { ProjectSnapshot } from '@/types';
import type { ReleaseCandidate } from './releaseCandidate';
import type { PostPublishObservation } from './postPublishFeedback';
import type { PostPublishExperimentReview } from './postPublishExperiment';
import type { DirectorLearningRecord } from './directorLearningLibrary';

export interface LineageNode {
  id: string;
  kind: 'version' | 'external' | 'selection' | 'rc' | 'render' | 'observation' | 'experiment' | 'learning' | 'application' | 'missing';
  label: string;
  status: string;
  details: Array<[string, string]>;
}
export interface LineageEdge { from: string; to: string; label: string }
export interface StoryLineage { nodes: LineageNode[]; edges: LineageEdge[]; warnings: string[]; scope: string }

export interface StoryLineageEvidence {
  candidates: ReleaseCandidate[];
  observations: PostPublishObservation[];
  experiments: PostPublishExperimentReview[];
  learningRecords: DirectorLearningRecord[];
}

/** Derive read-only evidence from one snapshot. Never join global RC history by name or version ID. */
export function buildStoryLineage(current: ProjectSnapshot, candidate?: ReleaseCandidate, evidence?: StoryLineageEvidence, now = new Date()): StoryLineage {
  const snapshot = candidate?.snapshot ?? current;
  const nodes = new Map<string, LineageNode>();
  const edges: LineageEdge[] = [];
  const warnings: string[] = [];
  const versions = snapshot.storyAssemblyVersions ?? [];
  const versionKey = (id: string) => `version:${id}`;
  const add = (entry: LineageNode) => { nodes.set(entry.id, entry); };
  const edge = (from: string, to: string, label: string) => {
    if (!edges.some((item) => item.from === from && item.to === to)) edges.push({ from, to, label });
  };
  const requireVersion = (id: string) => {
    const key = versionKey(id);
    if (!nodes.has(key)) {
      add({ id: key, kind: 'missing', label: '缺失方案', status: '无法核验', details: [['方案 ID', id]] });
      warnings.push(`来源方案 ${id} 不在此快照中；未猜测或补接其他工程。`);
    }
    return key;
  };
  const counts = new Map<string, number>();
  versions.forEach((version) => counts.set(version.id, (counts.get(version.id) ?? 0) + 1));
  for (const version of versions) {
    if ((counts.get(version.id) ?? 0) > 1) {
      add({ id: versionKey(version.id), kind: 'missing', label: '方案 ID 冲突', status: '无法核验', details: [['方案 ID', version.id]] });
      continue;
    }
    add({ id: versionKey(version.id), kind: 'version', label: version.label, status: version.provenance ? '外部派生方案' : '导演方案', details: [
      ['方案 ID', version.id], ['冻结时间', version.createdAt], ['说明', version.note || '未填写'],
      ['来源类型', version.provenance?.kind === 'external-otio' ? 'OTIO' : version.provenance?.kind === 'external-fcpxml' ? 'FCPXML' : version.provenance ? 'EDL' : '本机结构'],
      ['片段数', String(version.segments.length)], ['结构预览', version.assembly.preview?.reviewedAt ? '有评审记录（有效性以发布门禁为准）' : '尚无评审记录'],
      ['外部新增候选', String(version.externalCandidates?.length ?? 0)],
    ] });
  }
  for (const [id, count] of counts) if (count > 1) warnings.push(`方案 ID ${id} 重复 ${count} 次，相关关系不作有效证明。`);
  for (const version of versions) {
    if (!version.provenance || counts.get(version.id) !== 1) continue;
    const p = version.provenance;
    const externalId = `external:${version.id}`;
    add({ id: externalId, kind: 'external', label: p.kind === 'external-otio' ? 'OTIO 外部精剪' : p.kind === 'external-fcpxml' ? 'FCPXML 外部精剪' : 'EDL 外部精剪', status: '已保存派生', details: [
      ['导入文件', p.fileName], ['导入时间', p.importedAt], ['父方案 ID', p.parentVersionId], ['派生方案 ID', version.id],
      ['证据', '方案 provenance；不推断文件是否曾在外部软件完成精剪'],
    ] });
    edge(requireVersion(p.parentVersionId), externalId, '来源');
    edge(externalId, versionKey(version.id), '派生');
  }
  for (const inbox of snapshot.externalClipInboxes ?? []) {
    const target = inbox.savedVersionId ? versions.find((v) => v.id === inbox.savedVersionId && counts.get(v.id) === 1) : undefined;
    const matches = target?.provenance?.parentVersionId === inbox.parentVersionId && target.provenance.fileName === inbox.fileName;
    const id = matches ? `external:${target!.id}` : `inbox:${inbox.id}`;
    const approved = inbox.clips.filter((clip) => clip.decision === 'approve').length;
    const rejected = inbox.clips.filter((clip) => clip.decision === 'reject').length;
    const pending = inbox.clips.length - approved - rejected;
    const details: Array<[string, string]> = [['收件箱 ID', inbox.id], ['审核', `批准 ${approved} · 拒绝 ${rejected} · 待审 ${pending}`]];
    inbox.clips.filter((clip) => clip.decision === 'reject').forEach((clip) => details.push(['拒绝理由', `${clip.label || clip.id}：${clip.reason || '未填写'}`]));
    const existing = nodes.get(id);
    if (existing) existing.details.push(...details);
    else {
      add({ id, kind: 'external', label: inbox.externalTimeline ? 'OTIO 待审导入' : 'EDL 待审导入', status: inbox.savedVersionId ? '派生绑定无法核验' : pending ? '等待片段审核' : '等待确认保存', details: [['导入文件', inbox.fileName], ['导入时间', inbox.importedAt], ['父方案 ID', inbox.parentVersionId], ...details] });
      edge(requireVersion(inbox.parentVersionId), id, '送审');
      if (inbox.savedVersionId) warnings.push(`收件箱 ${inbox.fileName} 的派生绑定缺失或不一致，未连接为已认可派生。`);
    }
  }
  const selection = snapshot.storyVersionSelection;
  if (selection) {
    add({ id: 'selection', kind: 'selection', label: candidate ? '冻结时导演胜出' : '当前导演胜出', status: '已记录选版', details: [
      ['胜出方案 ID', selection.winnerVersionId], ['选版时间', selection.selectedAt], ['胜出理由', selection.rationale || '未填写'],
      ['对比方案', selection.comparedVersionIds.join(' / ')], ...Object.entries(selection.rejectedReasons).map(([id, reason]): [string, string] => ['淘汰理由', `${id}：${reason}`]),
    ] });
    edge(requireVersion(selection.winnerVersionId), 'selection', '胜出');
  }
  if (candidate) {
    const bound = candidate.storyDecision;
    const winner = bound && versions.find((v) => v.id === bound.versionId && counts.get(v.id) === 1);
    const valid = Boolean(bound && winner && selection && bound.versionId === selection.winnerVersionId && bound.rationale === selection.rationale && bound.selectedAt === selection.selectedAt);
    add({ id: 'rc', kind: 'rc', label: candidate.label, status: valid ? '绑定导演选版' : '选版绑定无法核验', details: [['RC ID', candidate.id], ['冻结时间', candidate.createdAt], ['工程', candidate.projectName], ['冻结时阻断项', String(candidate.health.blockers)], ['绑定方案', bound?.versionId ?? '旧记录未绑定'], ['绑定理由', bound?.rationale ?? '未记录']] });
    if (valid) edge('selection', 'rc', '冻结');
    else warnings.push(`${candidate.label} 缺少完整且一致的选版绑定；不从当前工程倒推历史。`);
    if (candidate.render) {
      const render = candidate.render;
      add({ id: 'render', kind: 'render', label: '成片凭证', status: '已记录渲染结果', details: [['输出文件', render.outputPath], ['渲染报告', render.reportPath], ['SHA-256', render.sha256], ['渲染时间', render.renderedAt], ['说明', '这是已保存的凭证；本视图未重新读取文件验证哈希，也不代表已公开发布。']] });
      edge('rc', 'render', '渲染');
    }
  }
  if (evidence) {
    appendPublicationEvidence({ snapshot, selectedCandidate: candidate, evidence, now, nodes, edges, warnings, add, edge });
  }
  // Detect cycles without recursive traversal, even for damaged imported projects.
  const incoming = new Map([...nodes.keys()].map((id) => [id, 0]));
  edges.forEach((e) => incoming.set(e.to, (incoming.get(e.to) ?? 0) + 1));
  const queue = [...incoming].filter(([, count]) => count === 0).map(([id]) => id);
  for (let index = 0; index < queue.length; index++) {
    for (const e of edges.filter((item) => item.from === queue[index])) {
      incoming.set(e.to, incoming.get(e.to)! - 1);
      if (incoming.get(e.to) === 0) queue.push(e.to);
    }
  }
  if (queue.length !== nodes.size) warnings.push('检测到循环来源关系；图中保留异常记录，但不能视为有效血缘证明。');
  return { nodes: [...nodes.values()], edges, warnings, scope: candidate ? `${candidate.projectName} · ${candidate.label} 冻结记录` : `${snapshot.projectName} · 当前工程` };
}

function appendPublicationEvidence(context: {
  snapshot: ProjectSnapshot;
  selectedCandidate?: ReleaseCandidate;
  evidence: StoryLineageEvidence;
  now: Date;
  nodes: Map<string, LineageNode>;
  edges: LineageEdge[];
  warnings: string[];
  add: (node: LineageNode) => void;
  edge: (from: string, to: string, label: string) => void;
}) {
  const { snapshot, selectedCandidate, evidence, now, nodes, warnings, add, edge } = context;
  const duplicateIds = <T extends { id: string }>(items: T[], label: string) => {
    const counts = new Map<string, number>();
    items.forEach((item) => counts.set(item.id, (counts.get(item.id) ?? 0) + 1));
    for (const [id, count] of counts) if (count > 1) warnings.push(`${label} ID ${id} 重复 ${count} 次，相关关系不能作为有效证明。`);
    return counts;
  };
  const candidateCounts = duplicateIds(evidence.candidates, 'RC');
  const observationCounts = duplicateIds(evidence.observations, '发布观察');
  const experimentCounts = duplicateIds(evidence.experiments, '实验结论');
  const learningCounts = duplicateIds(evidence.learningRecords, '学习记录');
  const applications = snapshot.director?.learningApplications ?? [];
  const applicationCounts = new Map<string, number>();
  applications.forEach((item) => applicationCounts.set(item.proposalId, (applicationCounts.get(item.proposalId) ?? 0) + 1));
  for (const [id, count] of applicationCounts) if (count > 1) warnings.push(`Brief 应用回执 ${id} 重复 ${count} 次。`);

  const candidateMap = new Map(evidence.candidates.filter((item) => candidateCounts.get(item.id) === 1).map((item) => [item.id, item]));
  if (selectedCandidate && !candidateMap.has(selectedCandidate.id)) candidateMap.set(selectedCandidate.id, selectedCandidate);
  const observationMap = new Map(evidence.observations.filter((item) => observationCounts.get(item.id) === 1).map((item) => [item.id, item]));
  const experimentMap = new Map(evidence.experiments.filter((item) => experimentCounts.get(item.id) === 1).map((item) => [item.id, item]));
  const learningMap = new Map(evidence.learningRecords.filter((item) => learningCounts.get(item.id) === 1).map((item) => [item.id, item]));

  const citedRecordIds = new Set(applications.flatMap((item) => item.citations.map((citation) => citation.recordId)));
  const selectedObservationIds = new Set<string>();
  if (selectedCandidate) {
    evidence.observations.filter((item) => item.rcId === selectedCandidate.id).forEach((item) => selectedObservationIds.add(item.id));
  }
  for (const recordId of citedRecordIds) learningMap.get(recordId)?.provenance.observationIds.forEach((id) => selectedObservationIds.add(id));
  const selectedExperimentIds = new Set(evidence.experiments.filter((item) => selectedObservationIds.has(item.leftObservationId) || selectedObservationIds.has(item.rightObservationId)).map((item) => item.id));
  for (const id of selectedExperimentIds) {
    const experiment = experimentMap.get(id);
    if (experiment) { selectedObservationIds.add(experiment.leftObservationId); selectedObservationIds.add(experiment.rightObservationId); }
  }
  const selectedLearningIds = new Set(evidence.learningRecords.filter((item) => citedRecordIds.has(item.id)
    || item.provenance.observationIds.some((id) => selectedObservationIds.has(id))
    || (item.sourceKind === 'experiment-review' && selectedExperimentIds.has(item.id.replace(/^learning:experiment:/, '')))).map((item) => item.id));
  for (const recordId of selectedLearningIds) learningMap.get(recordId)?.provenance.observationIds.forEach((id) => selectedObservationIds.add(id));
  for (const experiment of evidence.experiments) {
    if (selectedObservationIds.has(experiment.leftObservationId) || selectedObservationIds.has(experiment.rightObservationId)) {
      selectedExperimentIds.add(experiment.id);
      selectedObservationIds.add(experiment.leftObservationId);
      selectedObservationIds.add(experiment.rightObservationId);
    }
  }

  const rcNode = (rcId: string, expectedHash?: string) => {
    if (selectedCandidate?.id === rcId) {
      if (expectedHash && selectedCandidate.render?.sha256 !== expectedHash) {
        warnings.push(`${selectedCandidate.label} 的发布证据哈希与冻结 RC 冲突。`);
        const render = nodes.get('render');
        if (render) {
          render.kind = 'missing';
          render.status = '成片哈希冲突';
          if (!render.details.some(([label, value]) => label === '证据记录哈希' && value === expectedHash)) render.details.push(['证据记录哈希', expectedHash]);
        }
      }
      return selectedCandidate.render ? 'render' : 'rc';
    }
    const rcKey = `evidence-rc:${rcId}`;
    const renderKey = `evidence-render:${rcId}`;
    const rc = candidateMap.get(rcId);
    if (!rc) {
      if (!nodes.has(rcKey)) add({ id: rcKey, kind: 'missing', label: '缺失冻结 RC', status: '来源断裂', details: [['RC ID', rcId]] });
      warnings.push(`发布证据引用的 RC ${rcId} 不存在。`);
      return rcKey;
    }
    if (!nodes.has(rcKey)) add({ id: rcKey, kind: 'rc', label: rc.label, status: '引用的冻结 RC', details: [['RC ID', rc.id], ['工程', rc.projectName], ['冻结时间', rc.createdAt]] });
    if (!rc.render?.sha256) {
      warnings.push(`${rc.label} 缺少最终成片哈希。`);
      return rcKey;
    }
    const matches = !expectedHash || rc.render.sha256 === expectedHash;
    if (!nodes.has(renderKey)) {
      add({ id: renderKey, kind: matches ? 'render' : 'missing', label: matches ? '成片凭证' : '成片哈希冲突', status: matches ? '已记录渲染结果' : '凭证不一致', details: [['RC ID', rc.id], ['SHA-256', rc.render.sha256], ...(expectedHash && !matches ? [['证据记录哈希', expectedHash] as [string, string]] : [])] });
      edge(rcKey, renderKey, '渲染');
    }
    if (!matches) warnings.push(`${rc.label} 的当前成片哈希 ${rc.render.sha256} 与证据记录 ${expectedHash} 冲突。`);
    return renderKey;
  };

  const requireObservation = (id: string) => {
    const key = `observation:${id}`;
    if (!nodes.has(key)) {
      add({ id: key, kind: 'missing', label: '缺失发布观察', status: '来源断裂', details: [['观察 ID', id]] });
      warnings.push(`血缘引用的发布观察 ${id} 不存在。`);
    }
    return key;
  };
  const semanticKeys = new Map<string, number>();
  evidence.observations.forEach((item) => {
    const key = [item.rcId, item.source.platform, item.source.postUrl, item.observedAt].join('|');
    semanticKeys.set(key, (semanticKeys.get(key) ?? 0) + 1);
  });
  for (const [key, count] of semanticKeys) if (count > 1) warnings.push(`检测到 ${count} 条重复发布观察（${key}）。`);
  for (const id of selectedObservationIds) {
    const observation = observationMap.get(id);
    if (!observation) { requireObservation(id); continue; }
    const nodeId = `observation:${id}`;
    const mapping = observation.source.mappingReceipt;
    const importMissing = observation.source.kind === 'platform-export' && (!observation.source.sourceFileName || !observation.source.sourceFileSha256 || !mapping);
    add({ id: nodeId, kind: importMissing ? 'missing' : 'observation', label: `${observation.source.platform} 发布观察`, status: importMissing ? '导入凭证不完整' : '发布后证据', details: [
      ['观察 ID', observation.id], ['内容 ID / 链接', observation.source.postUrl], ['账号', observation.source.accountLabel],
      ['发布时间', observation.publishedAt], ['观测时间', observation.observedAt], ['时间窗', `${observation.windowHours} 小时`],
      ['RC ID', observation.rcId], ['成片 SHA-256', observation.renderSha256],
      ['导入文件', observation.source.sourceFileName ?? (observation.source.kind === 'manual-entry' ? '人工录入' : '缺失')],
      ['文件 SHA-256', observation.source.sourceFileSha256 ?? (observation.source.kind === 'manual-entry' ? '不适用' : '缺失')],
      ['导入行号', mapping ? String(mapping.rowIndex + 1) : observation.source.kind === 'manual-entry' ? '不适用' : '缺失'],
      ['映射回执', mapping ? mapping.fields.map((item) => `${item.sourceField}→${item.targetField} (${item.unit})`).join('；') : observation.source.kind === 'manual-entry' ? '不适用' : '缺失'],
    ] });
    if (importMissing) warnings.push(`发布观察 ${id} 的平台导入文件、哈希或行级映射回执缺失。`);
    edge(rcNode(observation.rcId, observation.renderSha256), nodeId, '发布观察');
  }

  const linkExperimentSide = (experiment: PostPublishExperimentReview, side: 'left' | 'right') => {
    const observationId = side === 'left' ? experiment.leftObservationId : experiment.rightObservationId;
    const rcId = side === 'left' ? experiment.leftRcId : experiment.rightRcId;
    const hash = side === 'left' ? experiment.leftRenderSha256 : experiment.rightRenderSha256;
    const observation = observationMap.get(observationId);
    if (!observation || observation.rcId !== rcId || observation.renderSha256 !== hash) {
      warnings.push(`实验 ${experiment.id} 的${side === 'left' ? '左' : '右'}侧观察、RC 或成片哈希无法一致核验。`);
    }
    return requireObservation(observationId);
  };
  for (const id of selectedExperimentIds) {
    const experiment = experimentMap.get(id);
    if (!experiment) continue;
    const nodeId = `experiment:${id}`;
    add({ id: nodeId, kind: 'experiment', label: '发布版本实验', status: '人工确认的描述性结论', details: [
      ['实验 ID', id], ['结论', experiment.conclusion], ['确认时间', experiment.confirmedAt], ['因果边界', '仅描述性对照，不是因果证明'],
      ['左侧来源', `${experiment.leftObservationId} · ${experiment.leftRcId} · ${experiment.leftRenderSha256}`],
      ['右侧来源', `${experiment.rightObservationId} · ${experiment.rightRcId} · ${experiment.rightRenderSha256}`],
    ] });
    edge(linkExperimentSide(experiment, 'left'), nodeId, '实验左侧');
    edge(linkExperimentSide(experiment, 'right'), nodeId, '实验右侧');
  }

  const freshness = (confirmedAt: string) => {
    const age = Math.max(0, Math.floor((now.getTime() - Date.parse(confirmedAt)) / 86_400_000));
    return { age, label: age <= 60 ? '新鲜' : age <= 180 ? '衰减' : '过期' };
  };
  for (const id of selectedLearningIds) {
    const record = learningMap.get(id);
    if (!record) continue;
    const nodeId = `learning:${id}`;
    const time = freshness(record.provenance.sourceConfirmedAt);
    const lengthsMatch = record.provenance.rcIds.length === record.provenance.renderSha256.length;
    add({ id: nodeId, kind: lengthsMatch ? 'learning' : 'missing', label: '导演学习记录', status: lengthsMatch ? `${record.curation?.role === 'support' ? '支持' : record.curation?.role === 'counterexample' ? '反例' : record.curation?.role === 'context' ? '背景' : '未分类'} · ${time.label}` : '凭证数量不一致', details: [
      ['学习记录 ID', record.id], ['摘要', record.summary], ['证据角色', record.curation?.role ?? '未分类'], ['创作假设', record.curation?.hypothesis ?? '未分类'],
      ['时效', `${time.label} · ${time.age} 天`], ['来源确认时间', record.provenance.sourceConfirmedAt],
      ['观察来源', record.provenance.observationIds.join(' / ') || '缺失'], ['RC', record.provenance.rcIds.join(' / ') || '缺失'], ['成片 SHA-256', record.provenance.renderSha256.join(' / ') || '缺失'],
    ] });
    if (!lengthsMatch) warnings.push(`学习记录 ${id} 的 RC 与成片哈希数量不一致。`);
    for (const observationId of record.provenance.observationIds) edge(requireObservation(observationId), nodeId, '形成学习');
    if (record.sourceKind === 'experiment-review') {
      const experimentId = record.id.replace(/^learning:experiment:/, '');
      if (experimentMap.has(experimentId)) edge(`experiment:${experimentId}`, nodeId, '确认结论');
      else {
        const missingExperimentId = `experiment:${experimentId}`;
        if (!nodes.has(missingExperimentId)) add({ id: missingExperimentId, kind: 'missing', label: '缺失实验结论', status: '学习来源断裂', details: [['实验 ID', experimentId]] });
        edge(missingExperimentId, nodeId, '确认结论');
        warnings.push(`学习记录 ${id} 引用的实验结论 ${experimentId} 不存在。`);
      }
    }
    record.provenance.rcIds.forEach((rcId, index) => rcNode(rcId, record.provenance.renderSha256[index]));
  }

  for (const application of applications) {
    const nodeId = `application:${application.proposalId}`;
    const duplicated = (applicationCounts.get(application.proposalId) ?? 0) > 1;
    add({ id: nodeId, kind: duplicated ? 'missing' : 'application', label: '已应用到 Brief', status: duplicated ? '重复应用回执' : '人工应用回执', details: [
      ['提案 ID', application.proposalId], ['应用时间', application.appliedAt], ['应用字段', application.fields.join(' / ') || '缺失'], ['适用理由', application.rationale],
      ...application.citations.map((item): [string, string] => ['引用证据', `${item.recordId} · ${item.role} · ${item.freshness}`]),
    ] });
    for (const citation of application.citations) {
      const record = learningMap.get(citation.recordId);
      if (!record) {
        const missingId = `learning:${citation.recordId}`;
        if (!nodes.has(missingId)) add({ id: missingId, kind: 'missing', label: '缺失学习记录', status: 'Brief 引用断裂', details: [['学习记录 ID', citation.recordId]] });
        warnings.push(`Brief 应用 ${application.proposalId} 引用的学习记录 ${citation.recordId} 不存在。`);
        edge(missingId, nodeId, '应用引用');
        continue;
      }
      const citationMatches = citation.role === record.curation?.role
        && citation.provenance.sourceConfirmedAt === record.provenance.sourceConfirmedAt
        && JSON.stringify(citation.provenance.observationIds) === JSON.stringify(record.provenance.observationIds)
        && JSON.stringify(citation.provenance.rcIds) === JSON.stringify(record.provenance.rcIds)
        && JSON.stringify(citation.provenance.renderSha256) === JSON.stringify(record.provenance.renderSha256);
      if (!citationMatches) warnings.push(`Brief 应用 ${application.proposalId} 中的引用 ${citation.recordId} 与当前学习记录凭证不一致。`);
      edge(`learning:${citation.recordId}`, nodeId, citationMatches ? '应用引用' : '引用冲突');
    }
  }
}

/** Bounded topological layout; cyclic leftovers occupy a separate column. */
export function layoutStoryLineage(graph: StoryLineage) {
  const columns = new Map<string, number>();
  const pending = new Set(graph.nodes.map((n) => n.id));
  for (let pass = 0; pass < graph.nodes.length; pass++) {
    let changed = false;
    for (const id of pending) {
      const parents = graph.edges.filter((e) => e.to === id).map((e) => e.from);
      if (parents.every((p) => columns.has(p))) {
        columns.set(id, parents.length ? Math.max(...parents.map((p) => columns.get(p)!)) + 1 : 0);
        pending.delete(id); changed = true;
      }
    }
    if (!changed) break;
  }
  const last = columns.size ? Math.max(...columns.values()) + 1 : 0;
  pending.forEach((id) => columns.set(id, last));
  const rows = new Map<number, number>();
  return graph.nodes.map((node) => {
    const column = columns.get(node.id)!;
    const row = rows.get(column) ?? 0;
    rows.set(column, row + 1);
    return { ...node, x: 12 + column * 190, y: 16 + row * 92 };
  });
}
