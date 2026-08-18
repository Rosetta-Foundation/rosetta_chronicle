import { ResolvedSourceNode } from '../types';
import { isRecord } from './chatgpt-export.utils';

const stringParts = (parts: unknown): string => {
  if (!Array.isArray(parts)) return '';
  return parts
    .filter((part): part is string => typeof part === 'string')
    .join('\n');
};

/**
 * Extract text from one vendor mapping node. Object parts (image
 * pointers, etc.) are not turned into invented attachment contents.
 */
export const extractRawNode = (
  value: unknown,
  nodeId: string,
): ResolvedSourceNode | { error: string } => {
  if (!isRecord(value)) return { error: `node-missing:${nodeId}` };
  const message = value['message'];
  if (message == null) return { error: `source-content-unavailable:${nodeId}` };
  if (!isRecord(message)) {
    return { error: `source-content-unavailable:${nodeId}` };
  }
  const author = isRecord(message['author']) ? message['author'] : undefined;
  const role =
    typeof author?.['role'] === 'string' ? author['role'] : undefined;
  const content = isRecord(message['content']) ? message['content'] : undefined;
  const contentType =
    typeof content?.['content_type'] === 'string'
      ? content['content_type']
      : undefined;
  const text = stringParts(content?.['parts']);
  const metadata = isRecord(message['metadata'])
    ? message['metadata']
    : undefined;
  const attachments = Array.isArray(metadata?.['attachments'])
    ? metadata['attachments'].filter(isRecord).map((attachment) => ({
        ...(typeof attachment['id'] === 'string'
          ? { id: attachment['id'] }
          : {}),
        presentInArchive: false,
        ...(typeof attachment['mime_type'] === 'string'
          ? { mimeType: attachment['mime_type'] }
          : {}),
      }))
    : [];
  return {
    nodeId,
    ...(role ? { role } : {}),
    ...(contentType ? { contentType } : {}),
    text,
    attachments,
  };
};

export const conversationIdOf = (value: unknown): string | undefined => {
  if (!isRecord(value)) return undefined;
  if (typeof value['conversation_id'] === 'string') {
    return value['conversation_id'];
  }
  if (typeof value['id'] === 'string') return value['id'];
  return undefined;
};

export const mappingOf = (
  value: unknown,
): Record<string, unknown> | undefined => {
  if (!isRecord(value)) return undefined;
  const mapping = value['mapping'];
  return isRecord(mapping) ? mapping : undefined;
};
