/**
 * InversifyJS injection tokens for Chronicle.
 *
 * Uses `Symbol.for` (the global symbol registry) so the same symbol is returned
 * across module instances — this matters when the container and the class under
 * test are loaded from different module instances (e.g. in Jest with require).
 *
 * The token — not the interface — is the runtime injection key.
 */
export const CHRONICLE_TOKENS = {
  // Handlers
  DailyChronicleHandler: Symbol.for('DailyChronicleHandler'),
  ChatGptInventoryHandler: Symbol.for('ChatGptInventoryHandler'),
  ChatGptImportHandler: Symbol.for('ChatGptImportHandler'),
  DerivedRecordHandler: Symbol.for('DerivedRecordHandler'),
  TransformationHandler: Symbol.for('TransformationHandler'),
  ProvenanceHandler: Symbol.for('ProvenanceHandler'),
  InterpretHandler: Symbol.for('InterpretHandler'),
  EvaluateHandler: Symbol.for('EvaluateHandler'),
  CurrentUnderstandingHandler: Symbol.for('CurrentUnderstandingHandler'),
  ChatGptConversationViewHandler: Symbol.for(
    'ChatGptConversationViewHandler',
  ),
  ChatGptConversationLocateHandler: Symbol.for(
    'ChatGptConversationLocateHandler',
  ),
  ObserveHandler: Symbol.for('ObserveHandler'),

  // Services
  ChronicleService: Symbol.for('ChronicleService'),
  ChatGptInventoryService: Symbol.for('ChatGptInventoryService'),
  ChatGptImportService: Symbol.for('ChatGptImportService'),
  DerivedRecordService: Symbol.for('DerivedRecordService'),
  TransformationService: Symbol.for('TransformationService'),
  ProvenanceService: Symbol.for('ProvenanceService'),
  InterpretationService: Symbol.for('InterpretationService'),
  EvaluationService: Symbol.for('EvaluationService'),
  CurrentUnderstandingService: Symbol.for('CurrentUnderstandingService'),
  ChatGptConversationViewService: Symbol.for(
    'ChatGptConversationViewService',
  ),
  ChatGptConversationLocateService: Symbol.for(
    'ChatGptConversationLocateService',
  ),
  ObserveService: Symbol.for('ObserveService'),

  // Repositories (one per source)
  GitRepository: Symbol.for('GitRepository'),
  ChatGptExportRepository: Symbol.for('ChatGptExportRepository'),
  GitDiscoveryRepository: Symbol.for('GitDiscoveryRepository'),
  JiraRepository: Symbol.for('JiraRepository'),
  ClaudeCodeRepository: Symbol.for('ClaudeCodeRepository'),
  CursorRepository: Symbol.for('CursorRepository'),
  NotesRepository: Symbol.for('NotesRepository'),
  CalendarRepository: Symbol.for('CalendarRepository'),

  // Persistence
  ChronicleRepository: Symbol.for('ChronicleRepository'),
  NotesStore: Symbol.for('NotesStore'),
  ChronicleStore: Symbol.for('ChronicleStore'),
  QueueStore: Symbol.for('QueueStore'),
  ChatGptGraphStore: Symbol.for('ChatGptGraphStore'),
  DerivedRecordStore: Symbol.for('DerivedRecordStore'),
  TransformationRegistry: Symbol.for('TransformationRegistry'),
  TransformationDefinitionStore: Symbol.for('TransformationDefinitionStore'),
  TransformationExecutionStore: Symbol.for('TransformationExecutionStore'),
  ExecutionOccurrenceStore: Symbol.for('ExecutionOccurrenceStore'),
  SourceContentRepository: Symbol.for('SourceContentRepository'),
  ModelInvocationRepository: Symbol.for('ModelInvocationRepository'),
  EvaluationStore: Symbol.for('EvaluationStore'),
  SourceVaultRepository: Symbol.for('SourceVaultRepository'),
  ObserveConfigRepository: Symbol.for('ObserveConfigRepository'),
  ObservationReceiptRepository: Symbol.for('ObservationReceiptRepository'),
} as const;
