import { injectable } from 'inversify';
import { Activity } from '../types';

/** Jira ticket context including parent Epic and OKR. */
export interface JiraTicketContext {
  key: string;
  summary: string;
  parentEpicKey?: string;
  parentOkr?: string;
}

/**
 * Source adapter for Jira activity. Resource access only — no business logic.
 */
export interface IJiraRepository {
  /** Fetch ticket context (incl. parent Epic + OKR) for the given keys. */
  getTicketContext(ticketKeys: string[]): Promise<JiraTicketContext[]>;
  /** Collect ticket transitions/comments as activity for the given keys. */
  getActivity(ticketKeys: string[]): Promise<Activity[]>;
}

/**
 * Jira implementation of {@link IJiraRepository}.
 *
 * Not yet implemented — a v0.1 placeholder. The interface and DI binding exist
 * so the composition root and downstream consumers can be wired ahead of the
 * live implementation; both methods currently throw. When built out, this will
 * call the Jira API and map issues to {@link JiraTicketContext} and changelog
 * entries to {@link Activity}, holding resource access only.
 */
@injectable()
export class JiraRepository implements IJiraRepository {
  /** @inheritDoc */
  async getTicketContext(
    _ticketKeys: string[],
  ): Promise<JiraTicketContext[]> {
    // TODO(v0.1): call the Jira API and map issues → JiraTicketContext[].
    throw new Error('JiraRepository.getTicketContext not implemented');
  }

  /** @inheritDoc */
  async getActivity(_ticketKeys: string[]): Promise<Activity[]> {
    // TODO(v0.1): call the Jira API and map changelog → Activity[].
    throw new Error('JiraRepository.getActivity not implemented');
  }
}
