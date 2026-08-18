import { InterpretationPolicy, ResolvedSourceNode } from '../types';
import { sha256Hex } from './chatgpt-export.utils';

export const CANDIDATE_OBSERVATION_TYPE = 'candidate-observation' as const;
export const CANDIDATE_OBSERVATION_SCHEMA = 'candidate-observation/1';
export const CANDIDATE_OBSERVATION_TEMPLATE_ID =
  'candidate-observation/1';
export const INTERPRET_PRODUCER_NAME = 'chronicle-interpret';

/**
 * Public prompt template. Contains no source text. Expanded prompts
 * that interpolate resolved nodes are ephemeral and must not be
 * persisted.
 */
export const CANDIDATE_OBSERVATION_TEMPLATE = `
You extract candidate observations from explicitly cited source nodes.

A directly-supported statement is still YOUR classification of support.
It does not become source truth. Only the cited nodes are source.

Rules:
- Return 1–3 observations, or exactly one insufficient-evidence result.
- Distinguish directly-supported (the cited source explicitly states or
  shows the statement) from inferred (you inferred it; it is not
  directly present).
- Cite only the provided node ids. Do not invent refs.
- If an attachment is referenced but unavailable, do not invent its
  contents. Insufficient evidence is a legitimate result.
- Do not write a biography, Activity, Daily Chronicle, or promotion.

Respond with JSON only, one of:
{"result":"observations","observations":[{"statement":"...","epistemicClass":"directly-supported"|"inferred","citedNodeIds":["..."],"supportNote":"..."}]}
{"result":"insufficient-evidence","citedNodeIds":["..."],"supportNote":"..."}

Cited nodes (ephemeral; do not echo this block into durable records):
{{nodes_json}}
`.trim();

export const CANDIDATE_OBSERVATION_TEMPLATE_HASH = sha256Hex(
  CANDIDATE_OBSERVATION_TEMPLATE,
);

export const CANDIDATE_OBSERVATION_POLICY: InterpretationPolicy = {
  id: 'candidate-observation-policy',
  version: '1',
  maxObservations: 3,
  epistemicClasses: [
    'directly-supported',
    'inferred',
    'insufficient-evidence',
  ],
  outputSchemaId: CANDIDATE_OBSERVATION_SCHEMA,
  promptTemplateId: CANDIDATE_OBSERVATION_TEMPLATE_ID,
  promptTemplateHash: CANDIDATE_OBSERVATION_TEMPLATE_HASH,
};

/**
 * Interpolate resolved nodes into the public template. The result is
 * the expanded prompt — in-memory only.
 */
export const expandCandidateObservationPrompt = (
  nodes: ResolvedSourceNode[],
): string =>
  CANDIDATE_OBSERVATION_TEMPLATE.replace(
    '{{nodes_json}}',
    JSON.stringify(
      nodes.map((node) => ({
        nodeId: node.nodeId,
        role: node.role,
        contentType: node.contentType,
        text: node.text,
        attachments: node.attachments.map((attachment) => ({
          id: attachment.id,
          presentInArchive: attachment.presentInArchive,
          mimeType: attachment.mimeType,
        })),
      })),
    ),
  );
