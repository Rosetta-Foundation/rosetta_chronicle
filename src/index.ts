import 'reflect-metadata';
import { Container } from 'inversify';
import { CHRONICLE_TOKENS } from './tokens';
import {
  IDailyChronicleHandler,
  DailyChronicleHandler,
} from './daily-chronicle.handler';
import {
  IChatGptInventoryHandler,
  ChatGptInventoryHandler,
} from './chatgpt-inventory.handler';
import {
  IChatGptImportHandler,
  ChatGptImportHandler,
} from './chatgpt-import.handler';
import {
  IDerivedRecordHandler,
  DerivedRecordHandler,
} from './derived-record.handler';
import {
  ITransformationHandler,
  TransformationHandler,
} from './transformation.handler';
import {
  IChronicleService,
  ChronicleService,
} from './services/chronicle.service';
import {
  IChatGptInventoryService,
  ChatGptInventoryService,
} from './services/chatgpt-inventory.service';
import {
  IChatGptImportService,
  ChatGptImportService,
} from './services/chatgpt-import.service';
import {
  IDerivedRecordService,
  DerivedRecordService,
} from './services/derived-record.service';
import {
  ITransformationService,
  TransformationService,
} from './services/transformation.service';
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
import {
  IChatGptExportRepository,
  ChatGptExportRepository,
} from './repositories/chatgpt-export.repository';
import {
  IChatGptGraphStore,
  ChatGptGraphStore,
} from './repositories/chatgpt-graph-store.repository';
import {
  IDerivedRecordStore,
  DerivedRecordStore,
} from './repositories/derived-record-store.repository';
import {
  ITransformationRegistry,
  TransformationRegistry,
} from './repositories/transformation-registry.repository';
import {
  ITransformationDefinitionStore,
  TransformationDefinitionStore,
} from './repositories/transformation-definition-store.repository';
import {
  ITransformationExecutionStore,
  TransformationExecutionStore,
} from './repositories/transformation-execution-store.repository';

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
  container
    .bind<IChatGptExportRepository>(CHRONICLE_TOKENS.ChatGptExportRepository)
    .to(ChatGptExportRepository);
  container
    .bind<IChatGptGraphStore>(CHRONICLE_TOKENS.ChatGptGraphStore)
    .to(ChatGptGraphStore);
  container
    .bind<IDerivedRecordStore>(CHRONICLE_TOKENS.DerivedRecordStore)
    .to(DerivedRecordStore);
  container
    .bind<ITransformationRegistry>(CHRONICLE_TOKENS.TransformationRegistry)
    .to(TransformationRegistry);
  container
    .bind<ITransformationDefinitionStore>(
      CHRONICLE_TOKENS.TransformationDefinitionStore,
    )
    .to(TransformationDefinitionStore);
  container
    .bind<ITransformationExecutionStore>(
      CHRONICLE_TOKENS.TransformationExecutionStore,
    )
    .to(TransformationExecutionStore);

  // Services
  container
    .bind<IChronicleService>(CHRONICLE_TOKENS.ChronicleService)
    .to(ChronicleService);
  container
    .bind<IChatGptInventoryService>(CHRONICLE_TOKENS.ChatGptInventoryService)
    .to(ChatGptInventoryService);
  container
    .bind<IChatGptImportService>(CHRONICLE_TOKENS.ChatGptImportService)
    .to(ChatGptImportService);
  container
    .bind<IDerivedRecordService>(CHRONICLE_TOKENS.DerivedRecordService)
    .to(DerivedRecordService);
  container
    .bind<ITransformationService>(CHRONICLE_TOKENS.TransformationService)
    .to(TransformationService);

  // Handlers
  container
    .bind<IDailyChronicleHandler>(CHRONICLE_TOKENS.DailyChronicleHandler)
    .to(DailyChronicleHandler);
  container
    .bind<IChatGptInventoryHandler>(CHRONICLE_TOKENS.ChatGptInventoryHandler)
    .to(ChatGptInventoryHandler);
  container
    .bind<IChatGptImportHandler>(CHRONICLE_TOKENS.ChatGptImportHandler)
    .to(ChatGptImportHandler);
  container
    .bind<IDerivedRecordHandler>(CHRONICLE_TOKENS.DerivedRecordHandler)
    .to(DerivedRecordHandler);
  container
    .bind<ITransformationHandler>(CHRONICLE_TOKENS.TransformationHandler)
    .to(TransformationHandler);

  return container;
};

/** Resolve the root Daily Chronicle handler from a fresh container. */
export const getDailyChronicleHandler = (): IDailyChronicleHandler => {
  return buildContainer().get<IDailyChronicleHandler>(
    CHRONICLE_TOKENS.DailyChronicleHandler,
  );
};

/** Resolve the ChatGPT export inventory handler from a fresh container. */
export const getChatGptInventoryHandler = (): IChatGptInventoryHandler => {
  return buildContainer().get<IChatGptInventoryHandler>(
    CHRONICLE_TOKENS.ChatGptInventoryHandler,
  );
};

/** Resolve the ChatGPT source-graph import handler from a fresh container. */
export const getChatGptImportHandler = (): IChatGptImportHandler => {
  return buildContainer().get<IChatGptImportHandler>(
    CHRONICLE_TOKENS.ChatGptImportHandler,
  );
};

/** Resolve the derived-record handler from a fresh container. */
export const getDerivedRecordHandler = (): IDerivedRecordHandler => {
  return buildContainer().get<IDerivedRecordHandler>(
    CHRONICLE_TOKENS.DerivedRecordHandler,
  );
};

/** Resolve the transformation handler from a fresh container. */
export const getTransformationHandler = (): ITransformationHandler => {
  return buildContainer().get<ITransformationHandler>(
    CHRONICLE_TOKENS.TransformationHandler,
  );
};
