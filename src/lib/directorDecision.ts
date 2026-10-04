import type { DirectorDecision, DirectorLearningApplication, DirectorSceneDecision, NarrativeRole, Scene } from '@/types';

export const EMPTY_DIRECTOR_DECISION: DirectorDecision = {
  objective: '',
  audience: '',
  thesis: '',
  contentType: 'knowledge',
  tone: '',
  pacing: 'balanced',
  emotionArc: '',
  endingAction: '',
  visualRules: '',
  scenes: {},
  updatedAt: '',
};

const ROLES: NarrativeRole[] = ['hook', 'context', 'argument', 'proof', 'turn', 'cta', 'custom'];

export function defaultNarrativeRole(index: number, total: number): NarrativeRole {
  if (index === 0) return 'hook';
  if (index === total - 1 && total > 1) return 'cta';
  if (index === 1) return 'context';
  if (index === total - 2 && total > 3) return 'proof';
  return 'argument';
}

export function sceneDecisionFor(
  director: DirectorDecision,
  scene: Scene,
  index: number,
  total: number,
): DirectorSceneDecision {
  return director.scenes[scene.id] ?? {
    sceneId: scene.id,
    narrativeRole: defaultNarrativeRole(index, total),
    intent: '',
    visualRule: '',
    locked: false,
  };
}

export function normalizeDirectorDecision(value: unknown): DirectorDecision {
  if (!value || typeof value !== 'object') return { ...EMPTY_DIRECTOR_DECISION, scenes: {} };
  const input = value as Partial<DirectorDecision>;
  const scenes: DirectorDecision['scenes'] = {};
  if (input.scenes && typeof input.scenes === 'object') {
    for (const [sceneId, raw] of Object.entries(input.scenes)) {
      if (!raw || typeof raw !== 'object') continue;
      const decision = raw as Partial<DirectorSceneDecision>;
      scenes[sceneId] = {
        sceneId,
        narrativeRole: ROLES.includes(decision.narrativeRole as NarrativeRole) ? decision.narrativeRole as NarrativeRole : 'custom',
        intent: String(decision.intent ?? ''),
        visualRule: String(decision.visualRule ?? ''),
        locked: Boolean(decision.locked),
      };
    }
  }
  const learningApplications = Array.isArray(input.learningApplications) ? input.learningApplications.flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return [];
    const application = raw as Partial<DirectorLearningApplication>;
    if (!application.proposalId || !application.appliedAt || !Array.isArray(application.citations)) return [];
    const citations = application.citations.flatMap((citation) => {
      if (!citation || typeof citation !== 'object' || !citation.recordId || !citation.provenance) return [];
      return [{
        recordId: String(citation.recordId),
        role: citation.role,
        freshness: citation.freshness,
        credentialStatus: 'verified' as const,
        summary: String(citation.summary ?? ''),
        hypothesis: String(citation.hypothesis ?? ''),
        scope: structuredClone(citation.scope),
        provenance: structuredClone(citation.provenance),
      }];
    });
    return [{ proposalId: String(application.proposalId), appliedAt: String(application.appliedAt), rationale: String(application.rationale ?? ''), fields: Array.isArray(application.fields) ? application.fields.map(String) : [], citations }];
  }).slice(-50) : undefined;
  return {
    objective: String(input.objective ?? ''),
    audience: String(input.audience ?? ''),
    thesis: String(input.thesis ?? ''),
    contentType: ['knowledge', 'product', 'story', 'tutorial', 'other'].includes(String(input.contentType))
      ? input.contentType as DirectorDecision['contentType'] : 'knowledge',
    tone: String(input.tone ?? ''),
    pacing: ['calm', 'balanced', 'fast'].includes(String(input.pacing)) ? input.pacing as DirectorDecision['pacing'] : 'balanced',
    emotionArc: String(input.emotionArc ?? ''),
    endingAction: String(input.endingAction ?? ''),
    visualRules: String(input.visualRules ?? ''),
    ...(learningApplications?.length ? { learningApplications } : {}),
    scenes,
    updatedAt: String(input.updatedAt ?? ''),
  };
}

export function lockedSceneIds(director: DirectorDecision, scenes: Scene[]) {
  const current = new Set(scenes.map((scene) => scene.id));
  return Object.values(director.scenes)
    .filter((decision) => decision.locked && current.has(decision.sceneId))
    .map((decision) => decision.sceneId);
}
