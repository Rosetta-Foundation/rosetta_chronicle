import 'reflect-metadata';
import { Container } from 'inversify';
import { CHRONICLE_TOKENS } from './tokens';
import {
  IDailyChronicleHandler,
  DailyChronicleHandler,
} from './daily-chronicle.handler';
import {
  IChronicleService,
  ChronicleService,
} from './services/chronicle.service';
import { IGitRepository, GitRepository } from './repositories/git.repository';
import {
  IGitDiscoveryRepository,
  GitDiscoveryRepository,
} from './repositories/git-discovery.repository';
import {
  IJiraRepository,
  JiraRepository,
} from './repositories/jira.repository';
import {
  IClaudeCodeRepository,
  ClaudeCodeRepository,
} from './repositories/claude-code.repository';
import {
  ICursorRepository,
  CursorRepository,
} from './repositories/cursor.repository';
import {
  INotesRepository,
  NotesRepository,
} from './repositories/notes.repository';
import {
  ICalendarRepository,
  CalendarRepository,
} from './repositories/calendar.repository';
import {
  IChronicleRepository,
  ChronicleRepository,
} from './repositories/chronicle.repository';
import { INotesStore, NotesStore } from './repositories/notes-store.repository';
import {
  IChronicleStore,
  ChronicleStore,
} from './repositories/chronicle-store.repository';
import { IQueueStore, QueueStore } from './repositories/queue-store.repository';

/**
 * Composition root. Wires the InversifyJS container and exposes a factory for
 * the root handler. No business logic lives here.
 */
export const buildContainer = (): Container => {
  const container = new Container();

  // Repositories
  container
    .bind<IGitRepository>(CHRONICLE_TOKENS.GitRepository)
    .to(GitRepository);
  container
    .bind<IGitDiscoveryRepository>(CHRONICLE_TOKENS.GitDiscoveryRepository)
    .to(GitDiscoveryRepository);
  container
    .bind<IJiraRepository>(CHRONICLE_TOKENS.JiraRepository)
    .to(JiraRepository);
  container
    .bind<IClaudeCodeRepository>(CHRONICLE_TOKENS.ClaudeCodeRepository)
    .to(ClaudeCodeRepository);
  container
    .bind<ICursorRepository>(CHRONICLE_TOKENS.CursorRepository)
    .to(CursorRepository);
  container
    .bind<INotesRepository>(CHRONICLE_TOKENS.NotesRepository)
    .to(NotesRepository);
  container
    .bind<ICalendarRepository>(CHRONICLE_TOKENS.CalendarRepository)
    .to(CalendarRepository);
  container
    .bind<IChronicleRepository>(CHRONICLE_TOKENS.ChronicleRepository)
    .to(ChronicleRepository);
  container.bind<INotesStore>(CHRONICLE_TOKENS.NotesStore).to(NotesStore);
  container
    .bind<IChronicleStore>(CHRONICLE_TOKENS.ChronicleStore)
    .to(ChronicleStore);
  container.bind<IQueueStore>(CHRONICLE_TOKENS.QueueStore).to(QueueStore);

  // Services
  container
    .bind<IChronicleService>(CHRONICLE_TOKENS.ChronicleService)
    .to(ChronicleService);

  // Handlers
  container
    .bind<IDailyChronicleHandler>(CHRONICLE_TOKENS.DailyChronicleHandler)
    .to(DailyChronicleHandler);

  return container;
};

/** Resolve the root Daily Chronicle handler from a fresh container. */
export const getDailyChronicleHandler = (): IDailyChronicleHandler => {
  return buildContainer().get<IDailyChronicleHandler>(
    CHRONICLE_TOKENS.DailyChronicleHandler,
  );
};
