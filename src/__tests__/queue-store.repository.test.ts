import 'reflect-metadata';
import { Container } from 'inversify';

// Mock fs before requiring the class under test.
jest.mock('fs');

import * as fs from 'fs';
import { CHRONICLE_TOKENS } from '../tokens';
import { IQueueStore, QueueStore } from '../repositories/queue-store.repository';
import { QueueItem } from '../types';
import { queueItemId } from '../utils/queue.utils';

const REPO = '/fake/repo';

const makeItem = (overrides: Partial<QueueItem> = {}): QueueItem => ({
  id: 'aabbccddee11',
  title: 'Test task',
  state: 'inbox',
  refs: [],
  signals: [],
  addedAt: '2026-07-24T00:00:00.000Z',
  ...overrides,
});

describe('QueueStore', () => {
  let container: Container;
  let store: IQueueStore;

  beforeEach(() => {
    jest.clearAllMocks();
    container = new Container();
    container.bind<IQueueStore>(CHRONICLE_TOKENS.QueueStore).to(QueueStore);
    store = container.get<IQueueStore>(CHRONICLE_TOKENS.QueueStore);
  });

  describe('read', () => {
    it('returns [] when the queue file does not exist', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      await expect(store.read(REPO)).resolves.toEqual([]);
    });

    it('parses items from an existing queue file', async () => {
      const md = `## Inbox\n- [ ] First task\n`;
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(md);
      const items = await store.read(REPO);
      expect(items).toHaveLength(1);
      expect(items[0].title).toBe('First task');
      expect(items[0].state).toBe('inbox');
    });

    it('reads from chronicles/queue.md under the repo path', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue('');
      await store.read(REPO);
      expect(fs.readFileSync).toHaveBeenCalledWith(
        expect.stringContaining('chronicles/queue.md'),
        'utf-8',
      );
    });
  });

  describe('write', () => {
    it('creates the chronicles directory if absent', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      (fs.mkdirSync as jest.Mock).mockImplementation(() => undefined);
      (fs.writeFileSync as jest.Mock).mockImplementation(() => undefined);
      const items = [makeItem()];
      await store.write(REPO, items);
      expect(fs.mkdirSync).toHaveBeenCalledWith(
        expect.stringContaining('chronicles'),
        expect.objectContaining({ recursive: true }),
      );
    });

    it('writes serialized Markdown to chronicles/queue.md', async () => {
      (fs.mkdirSync as jest.Mock).mockImplementation(() => undefined);
      (fs.writeFileSync as jest.Mock).mockImplementation(() => undefined);
      const items = [makeItem({ title: 'Write me' })];
      await store.write(REPO, items);
      const [writtenPath, writtenContent] = (fs.writeFileSync as jest.Mock).mock.calls[0];
      expect(writtenPath).toContain('chronicles/queue.md');
      expect(writtenContent).toContain('Write me');
    });
  });

  describe('append', () => {
    it('appends a new item to an existing queue', async () => {
      const md = `## Inbox\n- [ ] Existing task\n`;
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(md);
      (fs.mkdirSync as jest.Mock).mockImplementation(() => undefined);
      (fs.writeFileSync as jest.Mock).mockImplementation(() => undefined);

      // Use a different id so dedup does not skip the write.
      const newItem = makeItem({ id: queueItemId('Brand new task'), title: 'Brand new task' });
      await store.append(REPO, newItem);

      const writtenContent = (fs.writeFileSync as jest.Mock).mock.calls[0][1] as string;
      expect(writtenContent).toContain('Existing task');
      expect(writtenContent).toContain('Brand new task');
    });

    it('is idempotent — does not duplicate an item with the same id (jira key)', async () => {
      // parseQueue derives the id from the jira key when present.
      const id = queueItemId('PROJ-1');
      const item = makeItem({ id, title: 'Already there' });
      const md = `## Inbox\n- [ ] Already there [jira:PROJ-1]\n`;
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(md);

      await store.append(REPO, item);

      // writeFileSync should NOT have been called — item already present (same id)
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    it('does not write when the item id already exists in the queue (title hash)', async () => {
      // parseQueue derives the id from the title when no jira/prd ref present.
      const id = queueItemId('Existing task');
      const item = makeItem({ id, title: 'Existing task' });
      const md = `## Inbox\n- [ ] Existing task\n`;
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(md);

      await store.append(REPO, item);
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });
  });
});
