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

  // Services
  ChronicleService: Symbol.for('ChronicleService'),

  // Repositories (one per source)
  GitRepository: Symbol.for('GitRepository'),
  GitDiscoveryRepository: Symbol.for('GitDiscoveryRepository'),
  JiraRepository: Symbol.for('JiraRepository'),
  ClaudeCodeRepository: Symbol.for('ClaudeCodeRepository'),
  NotesRepository: Symbol.for('NotesRepository'),
  CalendarRepository: Symbol.for('CalendarRepository'),

  // Persistence
  ChronicleRepository: Symbol.for('ChronicleRepository'),
  NotesStore: Symbol.for('NotesStore'),
  ChronicleStore: Symbol.for('ChronicleStore'),
  QueueStore: Symbol.for('QueueStore'),
} as const;
