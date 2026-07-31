import 'reflect-metadata';
import { Container } from 'inversify';

// require after any module-level mocks so they apply before the class loads.
const { CHRONICLE_TOKENS } = require('../tokens');
const { ChronicleService } = require('../services/chronicle.service');

describe('ChronicleService (DI wiring)', () => {
  let container: Container;
  let mockGitRepo: { getActivity: jest.Mock };
  let mockGitDiscoveryRepo: { discover: jest.Mock };
  let mockClaudeCodeRepo: { getActivity: jest.Mock };
  let mockNotesRepo: { getActivity: jest.Mock };
  let mockCalendarRepo: { getActivity: jest.Mock };

  beforeEach(() => {
    mockGitRepo = { getActivity: jest.fn().mockResolvedValue([]) };
    mockGitDiscoveryRepo = { discover: jest.fn().mockResolvedValue([]) };
    mockClaudeCodeRepo = { getActivity: jest.fn().mockResolvedValue([]) };
    mockNotesRepo = { getActivity: jest.fn().mockResolvedValue([]) };
    mockCalendarRepo = { getActivity: jest.fn().mockResolvedValue([]) };

    container = new Container();
    container
      .bind(CHRONICLE_TOKENS.GitRepository)
      .toConstantValue(mockGitRepo);
    container
      .bind(CHRONICLE_TOKENS.GitDiscoveryRepository)
      .toConstantValue(mockGitDiscoveryRepo);
    container
      .bind(CHRONICLE_TOKENS.ClaudeCodeRepository)
      .toConstantValue(mockClaudeCodeRepo);
    container
      .bind(CHRONICLE_TOKENS.NotesRepository)
      .toConstantValue(mockNotesRepo);
    container
      .bind(CHRONICLE_TOKENS.CalendarRepository)
      .toConstantValue(mockCalendarRepo);
    container
      .bind(CHRONICLE_TOKENS.ChronicleService)
      .to(ChronicleService);
  });

  it('resolves ChronicleService with its repository dependencies', () => {
    const service = container.get(CHRONICLE_TOKENS.ChronicleService);
    expect(service).toBeInstanceOf(ChronicleService);
  });

  it('synthesizes a Daily Chronicle from git activity', async () => {
    mockGitRepo.getActivity.mockResolvedValue([
      {
        source: 'git',
        id: 'abc123def456',
        timestamp: '2026-07-21T14:00:00Z',
        summary: 'feat: add chronicle git source adapter',
        evidence: [
          { source: 'git', ref: 'abc123def456', description: 'abc123de feat: … (Russ)' },
        ],
      },
    ]);

    const service = container.get<{
      generateDailyChronicle: (input: unknown) => Promise<{
        markdown: string;
        tags: string[];
        sections: { heading: string }[];
      }>;
    }>(CHRONICLE_TOKENS.ChronicleService);

    const result = await service.generateDailyChronicle({
      window: { start: '2026-07-21', end: '2026-07-21' },
      gitRepoPath: '/tmp/repo',
      jiraTicketKeys: [],
    });

    expect(mockGitRepo.getActivity).toHaveBeenCalledWith(
      '/tmp/repo',
      { start: '2026-07-21', end: '2026-07-21' },
      false, // includeMerges defaults to false
    );
    expect(result.markdown).toContain('# Daily Chronicle');
    expect(result.markdown).toContain('add chronicle git source adapter');
    expect(result.markdown).toContain('abc123de'); // evidence ref
    expect(result.tags).toContain('DELIVERY'); // "feat:" → DELIVERY
    expect(result.sections.map((s) => s.heading)).toEqual([
      'Executive Summary',
      'Work Completed',
    ]);
  });

  it('adds a Notes & Discussions section when notes are present', async () => {
    mockNotesRepo.getActivity.mockResolvedValue([
      {
        source: 'notes',
        id: 'note1',
        timestamp: '2026-07-21T10:00:00',
        summary: 'discussed Entra/Okta federation with Vinay',
        evidence: [{ source: 'notes', ref: 'note1', description: 'note: …' }],
      },
    ]);

    const service = container.get<{
      generateDailyChronicle: (input: unknown) => Promise<{
        markdown: string;
        sections: { heading: string }[];
      }>;
    }>(CHRONICLE_TOKENS.ChronicleService);

    const result = await service.generateDailyChronicle({
      window: { start: '2026-07-21', end: '2026-07-21' },
      gitRepoPath: '/tmp/repo',
      jiraTicketKeys: [],
      notes: '- discussed Entra/Okta federation with Vinay',
    });

    expect(mockNotesRepo.getActivity).toHaveBeenCalledWith(
      { start: '2026-07-21', end: '2026-07-21' },
      '- discussed Entra/Okta federation with Vinay',
    );
    expect(result.sections.map((s) => s.heading)).toContain('Notes & Discussions');
    expect(result.markdown).toContain('discussed Entra/Okta federation with Vinay');
  });

  it('adds a Claude Sessions section with titled and untitled sessions', async () => {
    mockClaudeCodeRepo.getActivity.mockResolvedValue([
      {
        source: 'claude-code',
        id: 'sess-titled',
        timestamp: '2026-07-21T10:00:00Z',
        summary: 'Build the thing',
        evidence: [
          { source: 'claude-code', ref: 'sess-titled', description: 'session' },
          { source: 'claude-code', ref: 'org/repo#42', description: 'PR org/repo#42', url: 'https://github.com/org/repo/pull/42' },
        ],
      },
      {
        source: 'claude-code',
        id: 'sess-untitled',
        timestamp: '2026-07-21T11:00:00Z',
        summary: 'Investigate something [needs-review]',
        evidence: [{ source: 'claude-code', ref: 'sess-untitled', description: 'session' }],
        reviewNeeded: true,
      },
    ]);

    const service = container.get<{
      generateDailyChronicle: (input: unknown) => Promise<{
        markdown: string;
        sections: { heading: string; body: string }[];
      }>;
    }>(CHRONICLE_TOKENS.ChronicleService);

    const result = await service.generateDailyChronicle({
      window: { start: '2026-07-21', end: '2026-07-21' },
      gitRepoPath: '/tmp/repo',
      jiraTicketKeys: [],
      claudeCodeProjectPath: '/tmp/project',
    });

    expect(mockClaudeCodeRepo.getActivity).toHaveBeenCalledWith(
      { start: '2026-07-21', end: '2026-07-21' },
      '/tmp/project',
    );
    const sessionsSection = result.sections.find((s) => s.heading === 'Claude Sessions');
    expect(sessionsSection).toBeDefined();
    expect(sessionsSection!.body).toContain('Build the thing');
    expect(sessionsSection!.body).toContain('org/repo#42'); // PR link rendered
    expect(sessionsSection!.body).toContain('Sessions to review');
    expect(sessionsSection!.body).toContain('Investigate something');
    expect(sessionsSection!.body).not.toContain('[needs-review]'); // marker stripped in review block
    expect(result.markdown).toContain('2 Claude sessions');
  });

  it('skips Claude Code source when claudeCodeProjectPath is not provided', async () => {
    const service = container.get<{
      generateDailyChronicle: (input: unknown) => Promise<{ sections: { heading: string }[] }>;
    }>(CHRONICLE_TOKENS.ChronicleService);

    await service.generateDailyChronicle({
      window: { start: '2026-07-21', end: '2026-07-21' },
      gitRepoPath: '/tmp/repo',
      jiraTicketKeys: [],
    });

    expect(mockClaudeCodeRepo.getActivity).not.toHaveBeenCalled();
  });

  it('merges prior tags from existingMarkdown with freshly inferred tags', async () => {
    // Fresh activity only infers DELIVERY; prior Chronicle had CROSS-TEAM and ARCH too.
    mockGitRepo.getActivity.mockResolvedValue([
      {
        source: 'git', id: 'abc', timestamp: '2026-07-21T10:00:00Z',
        summary: 'feat: ship thing', evidence: [{ source: 'git', ref: 'abc', description: '' }],
      },
    ]);

    const existingMarkdown = '## Suggested Tags\n\n`[DELIVERY]` `[CROSS-TEAM]` `[ARCH]`\n';

    const service = container.get<{
      generateDailyChronicle: (input: unknown) => Promise<{ tags: string[] }>;
    }>(CHRONICLE_TOKENS.ChronicleService);

    const result = await service.generateDailyChronicle({
      window: { start: '2026-07-21', end: '2026-07-21' },
      gitRepoPath: '/tmp/repo',
      jiraTicketKeys: [],
      existingMarkdown,
    });

    expect(result.tags).toContain('DELIVERY');   // freshly inferred
    expect(result.tags).toContain('CROSS-TEAM'); // preserved from prior
    expect(result.tags).toContain('ARCH');       // preserved from prior
  });

  it('prefers priorTags over existingMarkdown when both are present', async () => {
    mockGitRepo.getActivity.mockResolvedValue([
      {
        source: 'git', id: 'abc', timestamp: '2026-07-21T10:00:00Z',
        summary: 'feat: ship thing', evidence: [{ source: 'git', ref: 'abc', description: '' }],
      },
    ]);

    const service = container.get<{
      generateDailyChronicle: (input: unknown) => Promise<{ tags: string[] }>;
    }>(CHRONICLE_TOKENS.ChronicleService);

    const result = await service.generateDailyChronicle({
      window: { start: '2026-07-21', end: '2026-07-21' },
      gitRepoPath: '/tmp/repo',
      jiraTicketKeys: [],
      priorTags: ['SECURITY'], // from the structured sidecar
      existingMarkdown: '## Suggested Tags\n\n`[ARCH]`\n', // legacy — must be ignored
    });

    expect(result.tags).toContain('DELIVERY');  // freshly inferred
    expect(result.tags).toContain('SECURITY');  // from priorTags (sidecar)
    expect(result.tags).not.toContain('ARCH');  // markdown ignored when priorTags present
  });

  it('returns a structured data sidecar of all activity and unioned tags', async () => {
    mockGitRepo.getActivity.mockResolvedValue([
      {
        source: 'git', id: 'g1', timestamp: '2026-07-21T10:00:00Z',
        summary: 'feat: ship thing', repo: 'repo-a',
        evidence: [{ source: 'git', ref: 'g1', description: '' }],
      },
    ]);
    mockNotesRepo.getActivity.mockResolvedValue([
      {
        source: 'notes', id: 'n1', timestamp: '2026-07-21T00:00:00',
        summary: 'a note', evidence: [{ source: 'notes', ref: 'n1', description: '' }],
      },
    ]);

    const service = container.get<{
      generateDailyChronicle: (input: unknown) => Promise<{
        data: { window: unknown; tags: string[]; activities: { id: string }[] };
        tags: string[];
      }>;
    }>(CHRONICLE_TOKENS.ChronicleService);

    const result = await service.generateDailyChronicle({
      window: { start: '2026-07-21', end: '2026-07-21' },
      gitRepoPath: '/tmp/repo',
      jiraTicketKeys: [],
      notes: '- a note',
    });

    expect(result.data.window).toEqual({ start: '2026-07-21', end: '2026-07-21' });
    expect(result.data.tags).toEqual(result.tags);
    // Sidecar carries the structured activity, not rendered Markdown.
    expect(result.data.activities.map((a) => a.id)).toContain('g1');
    expect(result.data.activities.map((a) => a.id)).toContain('n1');
  });

  it('passes input.notes straight to NotesRepository, never parsing notes from existingMarkdown', async () => {
    // Notes are authoritative input (PRD-0003): the service must not scrape the
    // rendered Chronicle for notes. It should forward exactly what it is handed.
    const existingMarkdown = `## Notes & Discussions\n\n- note only in old markdown\n`;

    const service = container.get<{
      generateDailyChronicle: (input: unknown) => Promise<{ markdown: string }>;
    }>(CHRONICLE_TOKENS.ChronicleService);

    await service.generateDailyChronicle({
      window: { start: '2026-07-21', end: '2026-07-21' },
      gitRepoPath: '/tmp/repo',
      jiraTicketKeys: [],
      notes: '- authoritative note',
      existingMarkdown,
    });

    // NotesRepository received exactly the input notes — not the markdown-scraped one.
    const notesArg: string | undefined = mockNotesRepo.getActivity.mock.calls[0][1];
    expect(notesArg).toBe('- authoritative note');
    expect(notesArg).not.toContain('note only in old markdown');
  });

  it('produces an empty-but-valid Chronicle when there is no activity', async () => {
    const service = container.get<{
      generateDailyChronicle: (input: unknown) => Promise<{ markdown: string; tags: string[] }>;
    }>(CHRONICLE_TOKENS.ChronicleService);

    const result = await service.generateDailyChronicle({
      window: { start: '2026-07-21', end: '2026-07-21' },
      gitRepoPath: '/tmp/repo',
      jiraTicketKeys: [],
    });

    expect(result.tags).toEqual([]);
    expect(result.markdown).toContain('No engineering activity was recorded');
  });

  it('discovers repos under workspaceRoot and aggregates their commits', async () => {
    mockGitDiscoveryRepo.discover.mockResolvedValue([
      '/ws/repo-a',
      '/ws/repo-b',
    ]);
    mockGitRepo.getActivity.mockImplementation((repoPath: string) =>
      Promise.resolve([
        {
          source: 'git',
          id: `${repoPath}-sha`,
          timestamp: '2026-07-21T10:00:00Z',
          summary: `feat: work in ${repoPath}`,
          repo: repoPath.split('/').pop(),
          evidence: [{ source: 'git', ref: `${repoPath}-sha`, description: '' }],
        },
      ]),
    );

    const service = container.get<{
      generateDailyChronicle: (input: unknown) => Promise<{ markdown: string }>;
    }>(CHRONICLE_TOKENS.ChronicleService);

    const result = await service.generateDailyChronicle({
      window: { start: '2026-07-21', end: '2026-07-21' },
      gitRepoPath: '',
      workspaceRoot: '/ws',
      jiraTicketKeys: [],
    });

    expect(mockGitDiscoveryRepo.discover).toHaveBeenCalledWith('/ws', undefined);
    // Both discovered repos were queried.
    expect(mockGitRepo.getActivity).toHaveBeenCalledWith(
      '/ws/repo-a',
      { start: '2026-07-21', end: '2026-07-21' },
      false,
    );
    expect(mockGitRepo.getActivity).toHaveBeenCalledWith(
      '/ws/repo-b',
      { start: '2026-07-21', end: '2026-07-21' },
      false,
    );
    // Commits are grouped by repo under bold subheadings.
    expect(result.markdown).toContain('**repo-a**');
    expect(result.markdown).toContain('**repo-b**');
    expect(result.markdown).toContain('2 commits');
  });

  it('threads includeMerges through discovery options to the git repo', async () => {
    mockGitDiscoveryRepo.discover.mockResolvedValue(['/ws/repo-a']);

    const service = container.get<{
      generateDailyChronicle: (input: unknown) => Promise<unknown>;
    }>(CHRONICLE_TOKENS.ChronicleService);

    await service.generateDailyChronicle({
      window: { start: '2026-07-21', end: '2026-07-21' },
      gitRepoPath: '',
      workspaceRoot: '/ws',
      discovery: { includeMerges: true },
      jiraTicketKeys: [],
    });

    expect(mockGitRepo.getActivity).toHaveBeenCalledWith(
      '/ws/repo-a',
      { start: '2026-07-21', end: '2026-07-21' },
      true,
    );
  });

  it('does not discover when workspaceRoot is absent', async () => {
    const service = container.get<{
      generateDailyChronicle: (input: unknown) => Promise<unknown>;
    }>(CHRONICLE_TOKENS.ChronicleService);

    await service.generateDailyChronicle({
      window: { start: '2026-07-21', end: '2026-07-21' },
      gitRepoPath: '/tmp/repo',
      jiraTicketKeys: [],
    });

    expect(mockGitDiscoveryRepo.discover).not.toHaveBeenCalled();
  });

  it('excludes the output Chronicle repo from discovered git activity', async () => {
    mockGitDiscoveryRepo.discover.mockResolvedValue([
      '/ws/repo-a',
      '/ws/my-chronicle', // the output repo — must be filtered out
    ]);
    mockGitRepo.getActivity.mockImplementation((repoPath: string) =>
      Promise.resolve([
        {
          source: 'git',
          id: `${repoPath}-sha`,
          timestamp: '2026-07-21T10:00:00Z',
          summary: `work in ${repoPath}`,
          repo: repoPath.split('/').pop(),
          evidence: [{ source: 'git', ref: `${repoPath}-sha`, description: '' }],
        },
      ]),
    );

    const service = container.get<{
      generateDailyChronicle: (input: unknown) => Promise<unknown>;
    }>(CHRONICLE_TOKENS.ChronicleService);

    await service.generateDailyChronicle({
      window: { start: '2026-07-21', end: '2026-07-21' },
      gitRepoPath: '',
      workspaceRoot: '/ws',
      outputRepoPath: '/ws/my-chronicle',
      jiraTicketKeys: [],
    });

    const queried = mockGitRepo.getActivity.mock.calls.map((c: unknown[]) => c[0]);
    expect(queried).toContain('/ws/repo-a');
    expect(queried).not.toContain('/ws/my-chronicle');
  });

  it('still queries an explicit gitRepoPath even if it equals the output repo', async () => {
    mockGitDiscoveryRepo.discover.mockResolvedValue([]);

    const service = container.get<{
      generateDailyChronicle: (input: unknown) => Promise<unknown>;
    }>(CHRONICLE_TOKENS.ChronicleService);

    await service.generateDailyChronicle({
      window: { start: '2026-07-21', end: '2026-07-21' },
      gitRepoPath: '/ws/my-chronicle',
      outputRepoPath: '/ws/my-chronicle',
      jiraTicketKeys: [],
    });

    const queried = mockGitRepo.getActivity.mock.calls.map((c: unknown[]) => c[0]);
    expect(queried).toContain('/ws/my-chronicle'); // explicit request honored
  });
});
