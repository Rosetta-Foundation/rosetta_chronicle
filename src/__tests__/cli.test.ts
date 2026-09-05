/**
 * CLI tests.
 *
 * We test the argument-parsing and orchestration logic in cli.ts by exercising
 * the exported helpers indirectly via child_process. The heavy lifting
 * (handler, repos) is covered by their own unit tests — here we care that the
 * CLI plumbs args correctly and exits with the right codes.
 *
 * Strategy: run `node dist/bin/cli.js` (built artifact) for happy-path smoke
 * tests, and unit-test the date enumeration helper directly since it's pure.
 */
import { execFileSync, spawnSync } from 'child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const CLI = join(__dirname, '../../dist/bin/cli.js');

// Rebuild so CLI tests see the current source, not a stale dist.
beforeAll(() => {
  execFileSync('bun', ['run', 'build'], {
    cwd: join(__dirname, '../..'),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
});

describe('chronicle CLI', () => {
  it('prints usage and exits 0 with --help', () => {
    const result = spawnSync(process.execPath, [CLI, '--help'], {
      encoding: 'utf-8',
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('chronicle backfill');
    expect(result.stdout).toContain('append-session');
    expect(result.stdout).toContain('inventory-chatgpt');
    expect(result.stdout).toContain('import-chatgpt');
    expect(result.stdout).toContain('record-derived');
    expect(result.stdout).toContain('transform-record');
    expect(result.stdout).toContain('transformation-provenance');
    expect(result.stdout).toContain('provenance');
    expect(result.stdout).toContain('interpret-source');
    expect(result.stdout).toContain('evaluate-derived');
    expect(result.stdout).toContain('current-understanding');
    expect(result.stdout).toContain('observe-init');
    expect(result.stdout).toContain('forget-scope');
    expect(result.stdout).toContain('chronicle version');
  });

  it('prints the package version with --version and version', () => {
    const pkg = JSON.parse(
      readFileSync(join(__dirname, '../../package.json'), 'utf-8'),
    ) as { version: string };
    for (const args of [['--version'], ['version']] as const) {
      const result = spawnSync(process.execPath, [CLI, ...args], {
        encoding: 'utf-8',
      });
      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe(pkg.version);
    }
  });

  it('vault-status uses the default data-dir when --data-dir is omitted', () => {
    const home = mkdtempSync(join(tmpdir(), 'cli-home-'));
    try {
      const result = spawnSync(process.execPath, [CLI, 'vault-status'], {
        encoding: 'utf-8',
        env: { ...process.env, HOME: home, CHRONICLE_DATA_DIR: undefined },
      });
      expect(result.status).toBe(1);
      expect(result.stderr).not.toContain('--data-dir <dir> is required');
      expect(result.stderr).toContain(
        join(home, '.local', 'share', 'rosetta', 'chronicle', 'default'),
      );
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('inventory-chatgpt exits 1 without --export', () => {
    const result = spawnSync(process.execPath, [CLI, 'inventory-chatgpt'], {
      encoding: 'utf-8',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--export');
  });

  it('import-chatgpt exits 1 without --export', () => {
    const result = spawnSync(process.execPath, [CLI, 'import-chatgpt'], {
      encoding: 'utf-8',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--export');
  });

  it('import-chatgpt exits 1 without --output', () => {
    const result = spawnSync(
      process.execPath,
      [CLI, 'import-chatgpt', '--export', '/tmp/no-such-chatgpt-export'],
      {
        encoding: 'utf-8',
        env: { ...process.env, CHRONICLE_SOURCE_GRAPH_DIR: undefined },
      },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--output');
  });

  it('inventory-chatgpt prints JSON for a missing export', () => {
    const result = spawnSync(
      process.execPath,
      [CLI, 'inventory-chatgpt', '--export', '/tmp/no-such-chatgpt-export'],
      { encoding: 'utf-8' },
    );
    expect(result.status).toBe(1);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.status).toBe('missing');
    expect(parsed.ingestedAt).toBeDefined();
    expect(parsed.conversationCount).toBe(0);
  });

  it('import-chatgpt --dry-run does not write a graph', () => {
    const repo = mkdtempSync(join(tmpdir(), 'cli-import-dry-'));
    const fixture = join(
      __dirname,
      'fixtures/chatgpt-export/complete-export',
    );
    try {
      const result = spawnSync(
        process.execPath,
        [
          CLI,
          'import-chatgpt',
          '--export',
          fixture,
          '--output',
          repo,
          '--dry-run',
        ],
        { encoding: 'utf-8' },
      );
      expect(result.status).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.status).toBe('imported');
      expect(parsed.conversationCount).toBe(9);
      expect(existsSync(parsed.path)).toBe(false);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it('import-chatgpt writes a graph without leaking source text', () => {
    const repo = mkdtempSync(join(tmpdir(), 'cli-import-'));
    const fixture = join(
      __dirname,
      'fixtures/chatgpt-export/complete-export',
    );
    try {
      const result = spawnSync(
        process.execPath,
        [CLI, 'import-chatgpt', '--export', fixture, '--output', repo],
        { encoding: 'utf-8' },
      );
      expect(result.status).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.status).toBe('imported');
      const dumped = readFileSync(parsed.path, 'utf-8');
      expect(dumped).not.toContain('REDACTED_SHOULD_NOT_LEAK');
      expect(dumped).not.toContain('SYNTHETIC_TITLE_MUST_NOT_LEAK');
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it('record-derived exits 1 without --output', () => {
    const result = spawnSync(
      process.execPath,
      [CLI, 'record-derived', '--source-graph-hash', 'a'.repeat(64)],
      {
        encoding: 'utf-8',
        env: { ...process.env, CHRONICLE_DERIVED_DIR: undefined },
      },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--output');
  });

  it('record-derived writes a synthetic note without Daily Chronicle files', () => {
    const out = mkdtempSync(join(tmpdir(), 'cli-derived-'));
    try {
      const result = spawnSync(
        process.execPath,
        [
          CLI,
          'record-derived',
          '--output',
          out,
          '--source-graph-hash',
          'a'.repeat(64),
          '--conversation-id',
          'conv-1',
          '--node-id',
          'n1',
          '--type',
          'human-note',
          '--producer-type',
          'human',
          '--producer-name',
          'fixture',
          '--content',
          'SYNTHETIC_DERIVED_NOTE',
        ],
        { encoding: 'utf-8' },
      );
      expect(result.status).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.status).toBe('recorded');
      expect(existsSync(parsed.path)).toBe(true);
      expect(readFileSync(parsed.path, 'utf-8')).toContain(
        'SYNTHETIC_DERIVED_NOTE',
      );
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  it('transform-record writes execution and derived without Daily Chronicle', () => {
    const out = mkdtempSync(join(tmpdir(), 'cli-xform-'));
    const execDir = mkdtempSync(join(tmpdir(), 'cli-exec-'));
    const defDir = mkdtempSync(join(tmpdir(), 'cli-def-'));
    try {
      const result = spawnSync(
        process.execPath,
        [
          CLI,
          'transform-record',
          '--output',
          out,
          '--executions',
          execDir,
          '--definitions',
          defDir,
          '--source-ref',
          'a'.repeat(64),
          '--type',
          'human-note',
          '--version',
          '1',
          '--producer-type',
          'human',
          '--producer-name',
          'fixture',
          '--content',
          'SYNTHETIC_DERIVED_NOTE',
        ],
        { encoding: 'utf-8' },
      );
      expect(result.status).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.status).toBe('recorded');
      expect(existsSync(parsed.executionPath)).toBe(true);
      expect(existsSync(parsed.definitionPath)).toBe(true);
      expect(existsSync(parsed.derivedPaths[0])).toBe(true);
      expect(existsSync(join(out, 'chronicles'))).toBe(false);
      expect(readFileSync(parsed.definitionPath, 'utf-8')).not.toContain(
        'SYNTHETIC_DERIVED_NOTE',
      );
      const walk = spawnSync(
        process.execPath,
        [
          CLI,
          'transformation-provenance',
          '--derived',
          parsed.derivedIds[0],
          '--output',
          out,
          '--executions',
          execDir,
          '--definitions',
          defDir,
        ],
        { encoding: 'utf-8' },
      );
      expect(walk.status).toBe(0);
      const provenance = JSON.parse(walk.stdout);
      expect(provenance.executionId).toBe(parsed.executionId);
      expect(provenance.definitionId).toBe(parsed.definitionId);
      expect(provenance.definition.type).toBe('human-note');
      const graphs = mkdtempSync(join(tmpdir(), 'cli-graphs-'));
      const graphWalk = spawnSync(
        process.execPath,
        [
          CLI,
          'provenance',
          '--from',
          `derived-record:${parsed.derivedIds[0]}`,
          '--direction',
          'backward',
          '--graphs',
          graphs,
          '--output',
          out,
          '--executions',
          execDir,
          '--definitions',
          defDir,
        ],
        { encoding: 'utf-8' },
      );
      expect(graphWalk.status).toBe(0);
      const graphResult = JSON.parse(graphWalk.stdout);
      expect(graphResult.status).toBe('partial');
      expect(graphResult.failures.map((row: { code: string }) => row.code)).toContain(
        'source-graph-missing',
      );
      rmSync(graphs, { recursive: true, force: true });
    } finally {
      rmSync(out, { recursive: true, force: true });
      rmSync(execDir, { recursive: true, force: true });
      rmSync(defDir, { recursive: true, force: true });
    }
  });

  it('provenance exits 1 without --from', () => {
    const result = spawnSync(process.execPath, [CLI, 'provenance'], {
      encoding: 'utf-8',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--from');
  });

  it('transformation-provenance --execution requires --definitions', () => {
    const result = spawnSync(
      process.execPath,
      [
        CLI,
        'transformation-provenance',
        '--execution',
        'a'.repeat(64),
        '--executions',
        mkdtempSync(join(tmpdir(), 'cli-exec-req-')),
      ],
      {
        encoding: 'utf-8',
        env: { ...process.env, CHRONICLE_DEFINITION_DIR: undefined },
      },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--definitions');
  });

  it('interpret-source exits 1 without --export', () => {
    const result = spawnSync(process.execPath, [CLI, 'interpret-source'], {
      encoding: 'utf-8',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--export');
  });

  it('interpret-source rejects --review-state and --content', () => {
    const reviewed = spawnSync(
      process.execPath,
      [CLI, 'interpret-source', '--review-state', 'recognized'],
      { encoding: 'utf-8' },
    );
    expect(reviewed.status).toBe(1);
    expect(reviewed.stderr).toContain('unreviewed');
    const contented = spawnSync(
      process.execPath,
      [CLI, 'interpret-source', '--content', 'nope'],
      { encoding: 'utf-8' },
    );
    expect(contented.status).toBe(1);
    expect(contented.stderr).toContain('--content');
  });

  it('interpret-source --dry-run writes nothing and omits source text', () => {
    const graphs = mkdtempSync(join(tmpdir(), 'cli-e4-graphs-'));
    const derived = mkdtempSync(join(tmpdir(), 'cli-e4-derived-'));
    const execs = mkdtempSync(join(tmpdir(), 'cli-e4-exec-'));
    const defs = mkdtempSync(join(tmpdir(), 'cli-e4-def-'));
    const occs = mkdtempSync(join(tmpdir(), 'cli-e4-occ-'));
    const fixture = join(
      __dirname,
      'fixtures/chatgpt-export/complete-export',
    );
    try {
      const imported = spawnSync(
        process.execPath,
        [CLI, 'import-chatgpt', '--export', fixture, '--output', graphs],
        { encoding: 'utf-8' },
      );
      expect(imported.status).toBe(0);
      const graph = JSON.parse(imported.stdout);
      const result = spawnSync(
        process.execPath,
        [
          CLI,
          'interpret-source',
          '--type',
          'candidate-observation',
          '--export',
          fixture,
          '--graph',
          graph.path,
          '--source-graph-hash',
          graph.contentHash,
          '--conversation-id',
          'conv-linear',
          '--node-id',
          'node-linear-1',
          '--output',
          derived,
          '--executions',
          execs,
          '--definitions',
          defs,
          '--occurrences',
          occs,
          '--provider',
          'fixture',
          '--model',
          'synthetic-model',
          '--dry-run',
        ],
        { encoding: 'utf-8' },
      );
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('"status": "dry-run"');
      expect(result.stdout).not.toContain('REDACTED_SHOULD_NOT_LEAK');
      expect(result.stdout).not.toContain('SYNTHETIC_TITLE_MUST_NOT_LEAK');
      expect(readdirSync(derived)).toEqual([]);
      expect(readdirSync(execs)).toEqual([]);
      expect(readdirSync(defs)).toEqual([]);
      expect(readdirSync(occs)).toEqual([]);
    } finally {
      rmSync(graphs, { recursive: true, force: true });
      rmSync(derived, { recursive: true, force: true });
      rmSync(execs, { recursive: true, force: true });
      rmSync(defs, { recursive: true, force: true });
      rmSync(occs, { recursive: true, force: true });
    }
  });

  it('current-understanding exits 1 without a perspective', () => {
    const result = spawnSync(
      process.execPath,
      [CLI, 'current-understanding', '--output', '/tmp', '--evaluations', '/tmp'],
      { encoding: 'utf-8' },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--evaluator-name');
  });

  it('current-understanding redacts source identifiers and writes nothing', () => {
    const derivedDir = mkdtempSync(join(tmpdir(), 'cli-cu-derived-'));
    const evalDir = mkdtempSync(join(tmpdir(), 'cli-cu-eval-'));
    try {
      const recorded = spawnSync(
        process.execPath,
        [
          CLI,
          'record-derived',
          '--output',
          derivedDir,
          '--source-graph-hash',
          'a'.repeat(64),
          '--conversation-id',
          'conv-1',
          '--node-id',
          'n1',
          '--type',
          'human-note',
          '--producer-type',
          'human',
          '--producer-name',
          'fixture',
          '--content',
          'SYNTHETIC_DERIVED_NOTE',
        ],
        { encoding: 'utf-8' },
      );
      expect(recorded.status).toBe(0);
      const beforeDerived = readdirSync(derivedDir).sort();
      const beforeEval = readdirSync(evalDir).sort();
      const result = spawnSync(
        process.execPath,
        [
          CLI,
          'current-understanding',
          '--output',
          derivedDir,
          '--evaluations',
          evalDir,
          '--evaluator-name',
          'operator',
          '--as-of',
          '2026-08-18T21:18:00.000Z',
        ],
        { encoding: 'utf-8' },
      );
      expect(result.status).toBe(0);
      expect(result.stdout).not.toContain('conv-1');
      expect(result.stdout).not.toContain('n1');
      expect(result.stdout).not.toContain('SYNTHETIC_DERIVED_NOTE');
      expect(result.stdout).toContain('human-interpretation');
      expect(readdirSync(derivedDir).sort()).toEqual(beforeDerived);
      expect(readdirSync(evalDir).sort()).toEqual(beforeEval);
    } finally {
      rmSync(derivedDir, { recursive: true, force: true });
      rmSync(evalDir, { recursive: true, force: true });
    }
  });

  it('evaluate-derived exits 1 without --derived', () => {
    const result = spawnSync(process.execPath, [CLI, 'evaluate-derived'], {
      encoding: 'utf-8',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--derived');
  });

  it('evaluate-derived rejects a non-human evaluator', () => {
    const result = spawnSync(
      process.execPath,
      [CLI, 'evaluate-derived', '--evaluator-type', 'agent', '--derived', 'a'.repeat(64)],
      { encoding: 'utf-8' },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('human evaluators only');
  });

  it('evaluate-derived writes ids without note prose', () => {
    const derivedDir = mkdtempSync(join(tmpdir(), 'cli-eval-derived-'));
    const evalDir = mkdtempSync(join(tmpdir(), 'cli-eval-store-'));
    try {
      const recorded = spawnSync(
        process.execPath,
        [
          CLI,
          'record-derived',
          '--output',
          derivedDir,
          '--source-graph-hash',
          'a'.repeat(64),
          '--conversation-id',
          'conv-1',
          '--node-id',
          'n1',
          '--type',
          'human-note',
          '--producer-type',
          'human',
          '--producer-name',
          'fixture',
          '--content',
          'SYNTHETIC_DERIVED_NOTE',
          '--review-state',
          'unreviewed',
        ],
        { encoding: 'utf-8' },
      );
      expect(recorded.status).toBe(0);
      const derivedId = JSON.parse(recorded.stdout).id as string;
      const result = spawnSync(
        process.execPath,
        [
          CLI,
          'evaluate-derived',
          '--derived',
          derivedId,
          '--evaluator-name',
          'operator',
          '--evidence-support',
          'supported',
          '--note',
          'SYNTHETIC_EVALUATION_NOTE',
          '--evaluated-at',
          '2026-08-18T22:00:00.000Z',
          '--output',
          derivedDir,
          '--evaluations',
          evalDir,
        ],
        { encoding: 'utf-8' },
      );
      expect(result.status).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.status).toBe('recorded');
      expect(parsed.evaluatedRecordId).toBe(derivedId);
      expect(result.stdout).not.toContain('SYNTHETIC_EVALUATION_NOTE');
      expect(readFileSync(parsed.path, 'utf-8')).toContain(
        'SYNTHETIC_EVALUATION_NOTE',
      );
      const derivedFile = JSON.parse(
        readFileSync(join(derivedDir, `${derivedId}.json`), 'utf-8'),
      );
      expect(derivedFile.reviewState).toBe('unreviewed');
    } finally {
      rmSync(derivedDir, { recursive: true, force: true });
      rmSync(evalDir, { recursive: true, force: true });
    }
  });

  it('exits 1 with unknown command', () => {
    const result = spawnSync(process.execPath, [CLI, 'foobar'], {
      encoding: 'utf-8',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("unknown command 'foobar'");
  });

  it('backfill exits 1 without --start', () => {
    const result = spawnSync(process.execPath, [CLI, 'backfill'], {
      encoding: 'utf-8',
      env: { ...process.env, CHRONICLE_REPO: undefined },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--start');
  });

  it('backfill --dry-run generates output without a repo', () => {
    // Create a temp git repo with one commit so git activity returns something.
    const tmpRepo = join(tmpdir(), `cli-test-repo-${process.pid}`);
    mkdirSync(tmpRepo, { recursive: true });
    execFileSync('git', ['-C', tmpRepo, 'init'], { stdio: 'pipe' });
    execFileSync(
      'git',
      ['-C', tmpRepo, 'config', 'user.email', 'test@test.com'],
      { stdio: 'pipe' },
    );
    execFileSync('git', ['-C', tmpRepo, 'config', 'user.name', 'Test'], {
      stdio: 'pipe',
    });
    writeFileSync(join(tmpRepo, 'README.md'), 'test');
    execFileSync('git', ['-C', tmpRepo, 'add', '.'], { stdio: 'pipe' });
    execFileSync(
      'git',
      ['-C', tmpRepo, 'commit', '-m', 'feat: initial commit'],
      { stdio: 'pipe' },
    );

    // Match cli.ts today() — local calendar date, not UTC (toISOString).
    const now = new Date();
    const today = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
    ].join('-');
    const result = spawnSync(
      process.execPath,
      [
        CLI,
        'backfill',
        '--start',
        today,
        '--git-repo',
        tmpRepo,
        '--project',
        tmpRepo,
        '--dry-run',
      ],
      { encoding: 'utf-8' },
    );

    rmSync(tmpRepo, { recursive: true, force: true });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('# Daily Chronicle');
  });

  it('append-session exits 1 without session-id and empty stdin', () => {
    const result = spawnSync(process.execPath, [CLI, 'append-session'], {
      encoding: 'utf-8',
      input: '', // empty stdin
      env: { ...process.env, CHRONICLE_REPO: '/tmp/noop' },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('session-id');
  });

  it('append-session targets a Cursor session’s creation day, not today', () => {
    // Fixture: a Cursor session created yesterday, under an isolated HOME.
    const tmpHome = join(tmpdir(), `cli-test-cursor-home-${process.pid}`);
    const project = '/tmp/cli-cursor-project';
    const slug = 'tmp-cli-cursor-project';
    const sessionId = 'aaaabbbb-cccc-dddd-eeee-ffff00001111';

    const transcriptDir = join(
      tmpHome,
      '.cursor',
      'projects',
      slug,
      'agent-transcripts',
      sessionId,
    );
    mkdirSync(transcriptDir, { recursive: true });
    writeFileSync(
      join(transcriptDir, `${sessionId}.jsonl`),
      JSON.stringify({
        role: 'user',
        message: { content: [{ type: 'text', text: 'yesterday work' }] },
      }) + '\n',
    );

    const yesterday = new Date(Date.now() - 86_400_000);
    const yesterdayDate = [
      yesterday.getFullYear(),
      String(yesterday.getMonth() + 1).padStart(2, '0'),
      String(yesterday.getDate()).padStart(2, '0'),
    ].join('-');
    const metaDir = join(tmpHome, '.cursor', 'chats', 'hash', sessionId);
    mkdirSync(metaDir, { recursive: true });
    writeFileSync(
      join(metaDir, 'meta.json'),
      JSON.stringify({
        title: 'Yesterday session',
        createdAtMs: yesterday.getTime(),
        cwd: project,
      }),
    );

    const hookPayload = JSON.stringify({
      session_id: sessionId,
      cwd: project,
      hook_event_name: 'Stop',
      source: 'cursor',
    });

    const result = spawnSync(
      process.execPath,
      [CLI, 'append-session', '--project', project, '--dry-run'],
      {
        encoding: 'utf-8',
        input: hookPayload,
        env: { ...process.env, HOME: tmpHome },
      },
    );

    rmSync(tmpHome, { recursive: true, force: true });

    expect(result.status).toBe(0);
    // The generated Chronicle covers the session's creation day.
    expect(result.stdout).toContain(`_${yesterdayDate}_`);
    expect(result.stdout).toContain('Yesterday session');
  });

  it('append-session reads session_id from stdin JSON (Stop hook mode)', () => {
    // We can't easily test full append with a real JSONL, but we can verify it
    // reads stdin and attempts the operation (will fail gracefully with no valid
    // transcript dir — that's fine, the session just produces no activities).
    const now = new Date();
    const today = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
    ].join('-');
    const hookPayload = JSON.stringify({
      session_id: 'test-nonexistent-session-id',
      cwd: '/tmp/nonexistent-project',
      hook_event_name: 'Stop',
    });

    const tmpRepo = join(tmpdir(), `cli-test-append-${process.pid}`);
    mkdirSync(tmpRepo, { recursive: true });
    execFileSync('git', ['-C', tmpRepo, 'init'], { stdio: 'pipe' });
    execFileSync(
      'git',
      ['-C', tmpRepo, 'config', 'user.email', 'test@test.com'],
      { stdio: 'pipe' },
    );
    execFileSync('git', ['-C', tmpRepo, 'config', 'user.name', 'Test'], {
      stdio: 'pipe',
    });
    writeFileSync(join(tmpRepo, 'README.md'), `chronicle repo for ${today}`);
    execFileSync('git', ['-C', tmpRepo, 'add', '.'], { stdio: 'pipe' });
    execFileSync('git', ['-C', tmpRepo, 'commit', '-m', 'chore: init'], {
      stdio: 'pipe',
    });

    const result = spawnSync(
      process.execPath,
      [CLI, 'append-session', '--repo', tmpRepo],
      {
        encoding: 'utf-8',
        input: hookPayload,
      },
    );

    rmSync(tmpRepo, { recursive: true, force: true });

    // Non-existent session/project → produces empty Chronicle but succeeds
    expect(result.status).toBe(0);
  });
});

// Pure unit test of the date enumeration logic extracted inline.
describe('date enumeration', () => {
  function enumerateDates(start: string, end: string): string[] {
    const dates: string[] = [];
    let cursor = new Date(`${start}T12:00:00Z`);
    const last = new Date(`${end}T12:00:00Z`);
    while (cursor <= last) {
      dates.push(cursor.toISOString().slice(0, 10));
      cursor = new Date(cursor.getTime() + 86_400_000);
    }
    return dates;
  }

  it('returns a single date for start === end', () => {
    expect(enumerateDates('2026-07-22', '2026-07-22')).toEqual(['2026-07-22']);
  });

  it('returns the full inclusive range', () => {
    expect(enumerateDates('2026-07-20', '2026-07-22')).toEqual([
      '2026-07-20',
      '2026-07-21',
      '2026-07-22',
    ]);
  });

  it('handles month boundary', () => {
    expect(enumerateDates('2026-07-30', '2026-08-01')).toEqual([
      '2026-07-30',
      '2026-07-31',
      '2026-08-01',
    ]);
  });

  it('returns empty when start is after end', () => {
    expect(enumerateDates('2026-07-22', '2026-07-21')).toEqual([]);
  });
});
