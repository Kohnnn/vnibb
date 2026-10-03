'use client';

import type { CuratedWorkflowSelection, PromptTemplate } from '@/lib/api';
import { getStarterForWorkflow } from '@/lib/researchStarters';

interface ReviewedWorkflowDisclosureProps {
  workflow: CuratedWorkflowSelection;
  symbol?: string;
  prompt?: PromptTemplate;
  matrixSelectionAvailable?: boolean;
}

export function ReviewedWorkflowDisclosure({ workflow, symbol, prompt, matrixSelectionAvailable = false }: ReviewedWorkflowDisclosureProps) {
  const starter = getStarterForWorkflow(workflow);
  const serverPrompt = prompt?.source === 'system' && prompt.id === workflow.id && prompt.revision === workflow.revision ? prompt : undefined;
  const scope = serverPrompt?.scope ?? starter?.scope;
  const requirements = serverPrompt?.requiredEvidenceKinds ?? starter?.requiredEvidenceKinds;
  const limits = serverPrompt?.limits ?? starter?.limits;

  return (
    <div className="space-y-1 text-xs text-[var(--text-secondary)]" role="note" aria-label="Reviewed workflow requirements">
      <p>Reviewed workflow {workflow.id}@{workflow.revision} · Scope: {scope || 'unknown'} · Current symbol: {symbol || workflow.symbol || 'not selected'}</p>
      <p>Requires: {requirements?.join(', ') || 'refresh the prompt library to review evidence requirements'}</p>
      {limits?.map((limit) => <p key={limit}>{limit}</p>)}
      {scope === 'matrix' && !matrixSelectionAvailable ? <p className="text-amber-300">Missing requirement: attach an authorized frozen Matrix selection before sending this workflow.</p> : null}
      <p>Evidence availability is checked by the server after context creation. Missing evidence is reported as a limitation, not invented.</p>
    </div>
  );
}
