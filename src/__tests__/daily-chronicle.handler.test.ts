import 'reflect-metadata';
import { Container } from 'inversify';

const { CHRONICLE_TOKENS } = require('../tokens');
const { DailyChronicleHandler } = require('../daily-chronicle.handler');

describe('DailyChronicleHandler (generate → persist composition)', () => {
  let container: Container;
  let mockService: { generateDailyChronicle: jest.Mock };
  let mockRepo: { persistDaily: jest.Mock; readDaily: jest.Mock };
  let mockNotesStore: { readDaily: jest.Mock; appendDaily: jest.Mock };
  let mockChronicleStore: { readDaily: jest.Mock; writeDaily: jest.Mock };

  const generated = {
    window: { start: '2026-07-22', end: '2026-07-22' },
    sections: [],
    tags: [],
    markdown: '# Daily Chronicle',
    data: {
      window: { start: '2026-07-22', end: '2026-07-22' },
      tags: [],
      activities: [],
    },
  };

  beforeEach(() => {
    mockService = {
      generateDailyChronicle: jest.fn().mockResolvedValue(generated),
    };
    mockRepo = {
      persistDaily: jest
        .fn()
        .mockResolvedValue({
          path: '/repo/chronicles/2026-07-22.md',
          committed: true,
        }),
      readDaily: jest.fn().mockResolvedValue(null),
    };
    mockNotesStore = {
      readDaily: jest.fn().mockResolvedValue(null),
      appendDaily: jest.fn().mockResolvedValue(undefined),
    };
    mockChronicleStore = {
      readDaily: jest.fn().mockResolvedValue(null),
      writeDaily: jest.fn().mockResolvedValue(undefined),
    };

    container = new Container();
    container
      .bind(CHRONICLE_TOKENS.ChronicleService)
      .toConstantValue(mockService);
    container
      .bind(CHRONICLE_TOKENS.ChronicleRepository)
      .toConstantValue(mockRepo);
    container.bind(CHRONICLE_TOKENS.NotesStore).toConstantValue(mockNotesStore);
    container
      .bind(CHRONICLE_TOKENS.ChronicleStore)
      .toConstantValue(mockChronicleStore);
    container
      .bind(CHRONICLE_TOKENS.DailyChronicleHandler)
      .to(DailyChronicleHandler);
  });

  const getHandler = () =>
    container.get<{
      handle: (input: unknown) => Promise<{
        chronicle: unknown;
        persisted?: unknown;
        clobberPrevented?: { wouldClobber: boolean; dropped: { id: string }[] };
      }>;
    }>(CHRONICLE_TOKENS.DailyChronicleHandler);

  it('generates only when no outputRepoPath is given', async () => {
    const result = await getHandler().handle({
      window: { start: '2026-07-22', end: '2026-07-22' },
      gitRepoPath: '/tmp/repo',
      jiraTicketKeys: [],
    });

    expect(mockService.generateDailyChronicle).toHaveBeenCalledTimes(1);
    expect(mockRepo.persistDaily).not.toHaveBeenCalled();
    expect(result.persisted).toBeUndefined();
    expect(result.chronicle).toBe(generated);
  });

  it('persists to the output repo when outputRepoPath is given', async () => {
    const result = await getHandler().handle({
      window: { start: '2026-07-22', end: '2026-07-22' },
      gitRepoPath: '/tmp/repo',
      jiraTicketKeys: [],
      outputRepoPath: '/personal/chronicle',
    });

    expect(mockRepo.persistDaily).toHaveBeenCalledWith(
      '/personal/chronicle',
      generated,
    );
    expect(result.persisted).toEqual({
      path: '/repo/chronicles/2026-07-22.md',
      committed: true,
    });
  });

  it('skips persistence for an empty day when skipEmpty is set', async () => {
    // generated fixture has zero activities and there is no prior Chronicle.
    const result = await getHandler().handle({
      window: { start: '2026-07-22', end: '2026-07-22' },
      gitRepoPath: '/tmp/repo',
      jiraTicketKeys: [],
      outputRepoPath: '/personal/chronicle',
      skipEmpty: true,
    });

    expect(mockRepo.persistDaily).not.toHaveBeenCalled();
    expect(mockChronicleStore.writeDaily).not.toHaveBeenCalled();
    expect((result as { skippedEmpty?: boolean }).skippedEmpty).toBe(true);
    expect(result.persisted).toBeUndefined();
  });

  it('persists an empty day with skipEmpty when a prior Chronicle exists', async () => {
    mockChronicleStore.readDaily.mockResolvedValue({
      window: { start: '2026-07-22', end: '2026-07-22' },
      tags: [],
      activities: [],
    });

    const result = await getHandler().handle({
      window: { start: '2026-07-22', end: '2026-07-22' },
      gitRepoPath: '/tmp/repo',
      jiraTicketKeys: [],
      outputRepoPath: '/personal/chronicle',
      skipEmpty: true,
    });

    expect(mockRepo.persistDaily).toHaveBeenCalled();
    expect((result as { skippedEmpty?: boolean }).skippedEmpty).toBeUndefined();
  });

  it('persists a day with activity normally when skipEmpty is set', async () => {
    mockService.generateDailyChronicle.mockResolvedValue({
      ...generated,
      data: {
        ...generated.data,
        activities: [
          {
            source: 'git',
            id: 'sha1',
            timestamp: '2026-07-22T10:00:00Z',
            summary: 'feat: work',
            evidence: [],
          },
        ],
      },
    });

    const result = await getHandler().handle({
      window: { start: '2026-07-22', end: '2026-07-22' },
      gitRepoPath: '/tmp/repo',
      jiraTicketKeys: [],
      outputRepoPath: '/personal/chronicle',
      skipEmpty: true,
    });

    expect(mockRepo.persistDaily).toHaveBeenCalled();
    expect((result as { skippedEmpty?: boolean }).skippedEmpty).toBeUndefined();
  });

  it('writes the structured sidecar (source of truth) when persisting', async () => {
    await getHandler().handle({
      window: { start: '2026-07-22', end: '2026-07-22' },
      gitRepoPath: '/tmp/repo',
      jiraTicketKeys: [],
      outputRepoPath: '/personal/chronicle',
    });

    expect(mockChronicleStore.writeDaily).toHaveBeenCalledWith(
      '/personal/chronicle',
      generated.data,
    );
  });

  it('prefers prior tags from the sidecar over the rendered Markdown', async () => {
    mockChronicleStore.readDaily.mockResolvedValue({
      window: { start: '2026-07-22', end: '2026-07-22' },
      tags: ['ARCH', 'CROSS-TEAM'],
      activities: [],
    });
    // Markdown is present but should be ignored for tags when the sidecar exists.
    mockRepo.readDaily.mockResolvedValue('## Suggested Tags\n\n`[DELIVERY]`\n');

    await getHandler().handle({
      window: { start: '2026-07-22', end: '2026-07-22' },
      gitRepoPath: '/tmp/repo',
      jiraTicketKeys: [],
      outputRepoPath: '/personal/chronicle',
    });

    const callArg = mockService.generateDailyChronicle.mock.calls[0][0];
    expect(callArg.priorTags).toEqual(['ARCH', 'CROSS-TEAM']);
  });

  it('leaves priorTags undefined for a legacy day with no sidecar (markdown fallback)', async () => {
    mockChronicleStore.readDaily.mockResolvedValue(null);
    mockRepo.readDaily.mockResolvedValue('## Suggested Tags\n\n`[DELIVERY]`\n');

    await getHandler().handle({
      window: { start: '2026-07-22', end: '2026-07-22' },
      gitRepoPath: '/tmp/repo',
      jiraTicketKeys: [],
      outputRepoPath: '/personal/chronicle',
    });

    const callArg = mockService.generateDailyChronicle.mock.calls[0][0];
    expect(callArg.priorTags).toBeUndefined();
    // The service still receives the markdown so it can migrate the tags once.
    expect(callArg.existingMarkdown).toContain('DELIVERY');
  });

  it('reads existing Chronicle and passes existingMarkdown to the service', async () => {
    const existingMd = '## Suggested Tags\n\n`[CROSS-TEAM]`\n';
    mockRepo.readDaily.mockResolvedValue(existingMd);

    await getHandler().handle({
      window: { start: '2026-07-22', end: '2026-07-22' },
      gitRepoPath: '/tmp/repo',
      jiraTicketKeys: [],
      outputRepoPath: '/personal/chronicle',
    });

    expect(mockRepo.readDaily).toHaveBeenCalledWith(
      '/personal/chronicle',
      '2026-07-22',
    );
    const callArg = mockService.generateDailyChronicle.mock.calls[0][0];
    expect(callArg.existingMarkdown).toBe(existingMd);
  });

  it('does not call readDaily when outputRepoPath is absent', async () => {
    await getHandler().handle({
      window: { start: '2026-07-22', end: '2026-07-22' },
      gitRepoPath: '/tmp/repo',
      jiraTicketKeys: [],
    });

    expect(mockRepo.readDaily).not.toHaveBeenCalled();
    const callArg = mockService.generateDailyChronicle.mock.calls[0][0];
    expect(callArg.existingMarkdown).toBeUndefined();
  });

  it('passes inline notes straight through when not persisting (no store)', async () => {
    await getHandler().handle({
      window: { start: '2026-07-22', end: '2026-07-22' },
      gitRepoPath: '/tmp/repo',
      jiraTicketKeys: [],
      notes: '- ephemeral note',
    });

    expect(mockNotesStore.appendDaily).not.toHaveBeenCalled();
    const callArg = mockService.generateDailyChronicle.mock.calls[0][0];
    expect(callArg.notes).toBe('- ephemeral note');
  });

  it('appends inline notes to the store and passes the stored notes to the service', async () => {
    mockNotesStore.readDaily.mockResolvedValue(
      '- yesterday note\n- new note\n',
    );

    await getHandler().handle({
      window: { start: '2026-07-22', end: '2026-07-22' },
      gitRepoPath: '/tmp/repo',
      jiraTicketKeys: [],
      outputRepoPath: '/personal/chronicle',
      notes: '- new note',
    });

    // Inline notes appended to the authoritative file.
    expect(mockNotesStore.appendDaily).toHaveBeenCalledWith(
      '/personal/chronicle',
      '2026-07-22',
      '- new note',
    );
    // Service receives the authoritative file's contents, not the inline notes.
    const callArg = mockService.generateDailyChronicle.mock.calls[0][0];
    expect(callArg.notes).toBe('- yesterday note\n- new note\n');
  });

  it('migrates notes from an existing rendered Chronicle into the notes store (once)', async () => {
    mockRepo.readDaily.mockResolvedValue(
      '## Notes & Discussions\n\n- prior note one\n- prior note two\n',
    );
    mockNotesStore.readDaily.mockResolvedValue(
      '- prior note one\n- prior note two\n',
    );

    await getHandler().handle({
      window: { start: '2026-07-22', end: '2026-07-22' },
      gitRepoPath: '/tmp/repo',
      jiraTicketKeys: [],
      outputRepoPath: '/personal/chronicle',
    });

    // The two prior notes were lifted out of the rendered Markdown into the store.
    const migrated = mockNotesStore.appendDaily.mock.calls[0];
    expect(migrated[0]).toBe('/personal/chronicle');
    expect(migrated[1]).toBe('2026-07-22');
    expect(migrated[2]).toContain('prior note one');
    expect(migrated[2]).toContain('prior note two');
  });

  // --- Clobber guard (PRD-0005) ---

  const activity = (id: string) => ({
    source: 'git' as const,
    id,
    timestamp: '2026-07-22T10:00:00Z',
    summary: `commit ${id}`,
    evidence: [{ source: 'git' as const, ref: id, description: id }],
  });

  // Make the service return a chronicle whose data carries the given activities.
  const generatedWith = (ids: string[]) => ({
    ...generated,
    data: { ...generated.data, activities: ids.map(activity) },
  });

  it('blocks persistence when the fresh run is a strict subset of the prior sidecar', async () => {
    // Prior sidecar had two activities; this run only produced one (a drop).
    mockChronicleStore.readDaily.mockResolvedValue({
      window: { start: '2026-07-22', end: '2026-07-22' },
      tags: [],
      activities: [activity('a'), activity('b')],
    });
    mockService.generateDailyChronicle.mockResolvedValue(generatedWith(['a']));

    const result = await getHandler().handle({
      window: { start: '2026-07-22', end: '2026-07-22' },
      gitRepoPath: '/tmp/repo',
      jiraTicketKeys: [],
      outputRepoPath: '/personal/chronicle',
    });

    // Neither the sidecar nor the render was written.
    expect(mockChronicleStore.writeDaily).not.toHaveBeenCalled();
    expect(mockRepo.persistDaily).not.toHaveBeenCalled();
    // The dropped activity is surfaced.
    expect(result.clobberPrevented?.wouldClobber).toBe(true);
    expect(result.clobberPrevented?.dropped.map((a) => a.id)).toEqual(['b']);
    expect(result.persisted).toBeUndefined();
  });

  it('persists when force is set, even on a would-clobber', async () => {
    mockChronicleStore.readDaily.mockResolvedValue({
      window: { start: '2026-07-22', end: '2026-07-22' },
      tags: [],
      activities: [activity('a'), activity('b')],
    });
    mockService.generateDailyChronicle.mockResolvedValue(generatedWith(['a']));

    const result = await getHandler().handle({
      window: { start: '2026-07-22', end: '2026-07-22' },
      gitRepoPath: '/tmp/repo',
      jiraTicketKeys: [],
      outputRepoPath: '/personal/chronicle',
      force: true,
    });

    expect(mockChronicleStore.writeDaily).toHaveBeenCalled();
    expect(mockRepo.persistDaily).toHaveBeenCalled();
    expect(result.clobberPrevented).toBeUndefined();
  });

  it('persists normally when the fresh run adds activity (superset)', async () => {
    mockChronicleStore.readDaily.mockResolvedValue({
      window: { start: '2026-07-22', end: '2026-07-22' },
      tags: [],
      activities: [activity('a')],
    });
    mockService.generateDailyChronicle.mockResolvedValue(
      generatedWith(['a', 'b']),
    );

    const result = await getHandler().handle({
      window: { start: '2026-07-22', end: '2026-07-22' },
      gitRepoPath: '/tmp/repo',
      jiraTicketKeys: [],
      outputRepoPath: '/personal/chronicle',
    });

    expect(mockRepo.persistDaily).toHaveBeenCalled();
    expect(result.clobberPrevented).toBeUndefined();
  });

  it('does not guard the first run for a day (no prior sidecar)', async () => {
    mockChronicleStore.readDaily.mockResolvedValue(null);
    mockService.generateDailyChronicle.mockResolvedValue(generatedWith(['a']));

    const result = await getHandler().handle({
      window: { start: '2026-07-22', end: '2026-07-22' },
      gitRepoPath: '/tmp/repo',
      jiraTicketKeys: [],
      outputRepoPath: '/personal/chronicle',
    });

    expect(mockRepo.persistDaily).toHaveBeenCalled();
    expect(result.clobberPrevented).toBeUndefined();
  });
});
