import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { ObserveService } from '../../../services/observe.service';

export const unix = (iso: string): number => Date.parse(iso) / 1000;

export interface FixtureNode {
  id: string;
  role: string;
  text: string | unknown[];
  parent?: string | null;
  time?: string | number | null;
}

export const conversation = (
  id: string,
  nodes: FixtureNode[],
  current?: string,
): Record<string, unknown> => ({
  conversation_id: id,
  current_node: current ?? nodes[nodes.length - 1]?.id,
  mapping: Object.fromEntries(
    nodes.map((node) => {
      const message: Record<string, unknown> = {
        author: { role: node.role },
        content: {
          content_type: 'text',
          parts: Array.isArray(node.text) ? node.text : [node.text],
        },
      };
      if (node.time === null) {
        // omit create_time
      } else if (typeof node.time === 'number') {
        message['create_time'] = node.time;
      } else if (typeof node.time === 'string') {
        message['create_time'] = unix(node.time);
      } else {
        message['create_time'] = unix('2024-01-02T12:00:00.000Z');
      }
      return [
        node.id,
        {
          id: node.id,
          parent: node.parent === undefined ? null : node.parent,
          message,
        },
      ];
    }),
  ),
});

export const observeShard = async (
  observe: ObserveService,
  dataDir: string,
  scopeId: string,
  fileName: string,
  body: unknown,
): Promise<void> => {
  const dir = join(dataDir, scopeId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, fileName), `${JSON.stringify(body)}\n`);
  await observe.handle({
    op: 'init',
    dataDir,
    scopeId,
    filePath: dir,
  });
  await observe.handle({ op: 'observe', dataDir, scopeId });
};

export const PRACTICE_JAN = 'I call this practice the winding path.';
export const PRACTICE_FEB =
  'The winding path is a formulation of returning to the same work.';
export const PRACTICE_MAR = 'I am practicing the winding path.';
export const PRACTICE_NOW = "I'm practicing the winding path";
