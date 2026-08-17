import 'reflect-metadata';
import { Container } from 'inversify';
import { join } from 'path';

const { CHRONICLE_TOKENS } = require('../tokens');
const {
  ChatGptInventoryService,
} = require('../services/chatgpt-inventory.service');
const {
  ChatGptExportRepository,
} = require('../repositories/chatgpt-export.repository');

const FIXTURE = join(
  __dirname,
  'fixtures/chatgpt-export/complete-export',
);

const INGESTED = '2026-08-17T21:00:00.000Z';

const LEAKS = [
  'REDACTED_SHOULD_NOT_LEAK',
  'SYNTHETIC_TITLE_MUST_NOT_LEAK',
  'REDACTED_EMAIL_MUST_NOT_LEAK',
  'REDACTED_FILENAME_MUST_NOT_LEAK',
];

describe('ChatGptInventoryService', () => {
  let service: {
    inventory: (
      path: string,
      ingestedAt: string,
    ) => Promise<Record<string, unknown>>;
  };

  beforeEach(() => {
    const container = new Container();
    container
      .bind(CHRONICLE_TOKENS.ChatGptExportRepository)
      .to(ChatGptExportRepository);
    container
      .bind(CHRONICLE_TOKENS.ChatGptInventoryService)
      .to(ChatGptInventoryService);
    service = container.get(CHRONICLE_TOKENS.ChatGptInventoryService);
  });

  it('inventories the structural fixture without leaking source text', async () => {
    const inventory = await service.inventory(FIXTURE, INGESTED);
    const dumped = JSON.stringify(inventory);
    for (const leak of LEAKS) {
      expect(dumped).not.toContain(leak);
    }
    expect(inventory.status).toBe('ok');
    expect(inventory.ingestedAt).toBe(INGESTED);
    expect(inventory.sourceKind).toBe('directory');
    expect(inventory.conversationCount).toBe(9);
    expect(inventory.shardCount).toBe(2);
    expect(inventory.conversationsWithBranches).toBeGreaterThanOrEqual(2);
    expect(inventory.contentTypes).toEqual(
      expect.arrayContaining([
        'text',
        'multimodal_text',
        'thoughts',
        'reasoning_recap',
        'unknown_widget',
      ]),
    );
    expect(inventory.roleCounts).toEqual(
      expect.objectContaining({
        user: expect.any(Number),
        assistant: expect.any(Number),
      }),
    );
    expect(inventory.attachmentsMissing).toBeGreaterThanOrEqual(1);
    expect(inventory.attachmentsPresent).toBeGreaterThanOrEqual(1);
    expect(inventory.privacySignals).toEqual(
      expect.arrayContaining(['ads.json', 'message_feedback.json', 'user.json']),
    );
    expect(inventory.eventTimeRange).toBeDefined();
    expect(inventory.eventTimeRange).not.toEqual({
      start: INGESTED,
      end: INGESTED,
    });
  });

  it('flags reconstructed and explicit branches', async () => {
    const inventory = await service.inventory(FIXTURE, INGESTED);
    const byId = Object.fromEntries(
      (
        inventory.conversations as {
          sourceId: string;
          branched: boolean;
          archived: boolean;
          hasMissingMessageTimestamps: boolean;
        }[]
      ).map((c) => [c.sourceId, c]),
    );
    expect(byId['conv-linear'].branched).toBe(false);
    expect(byId['conv-parent-branch'].branched).toBe(true);
    expect(byId['conv-explicit-children'].branched).toBe(true);
    expect(byId['conv-archived'].archived).toBe(true);
    expect(byId['conv-missing-timestamps'].hasMissingMessageTimestamps).toBe(
      true,
    );
  });

  it('records unsupported malformed and unknown content types', async () => {
    const inventory = await service.inventory(FIXTURE, INGESTED);
    const reasons = (
      inventory.unsupported as { reason: string }[]
    ).map((u) => u.reason);
    expect(reasons).toEqual(
      expect.arrayContaining([
        'conversation-not-object',
        'node-not-object',
        'node-missing-id',
        'unknown-content-type:unknown_widget',
        'attachment-missing-from-archive',
      ]),
    );
  });

  it('returns status missing without inventing conversations', async () => {
    const inventory = await service.inventory(
      '/tmp/no-such-chatgpt-export',
      INGESTED,
    );
    expect(inventory.status).toBe('missing');
    expect(inventory.conversationCount).toBe(0);
    expect(inventory.ingestedAt).toBe(INGESTED);
    expect(inventory.error).toMatch(/not found/);
  });
});
