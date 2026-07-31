import { JiraRepository } from '../repositories/jira.repository';

/**
 * JiraRepository is a v0.1 placeholder: the contract is that both methods
 * throw a clear not-implemented error (rather than silently returning empty)
 * so accidental wiring into the synthesis path fails loudly.
 */
describe('JiraRepository (placeholder)', () => {
  const repo = new JiraRepository();

  it('getTicketContext throws not-implemented', async () => {
    await expect(repo.getTicketContext(['PROJ-1'])).rejects.toThrow(
      'not implemented',
    );
  });

  it('getActivity throws not-implemented', async () => {
    await expect(repo.getActivity(['PROJ-1'])).rejects.toThrow(
      'not implemented',
    );
  });
});
