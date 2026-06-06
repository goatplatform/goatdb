export const EXIT_CODE_NO_MATCH = 2;
export const NO_MATCH_MESSAGE_PREFIX = 'No tests matched';

export class NoMatchError extends Error {
  constructor(suiteName?: string, testName?: string) {
    const filters: string[] = [];
    if (suiteName) filters.push(`--suite=${JSON.stringify(suiteName)}`);
    if (testName) filters.push(`--test=${JSON.stringify(testName)}`);
    if (filters.length === 0) {
      throw new Error(
        'NoMatchError requires at least one of suiteName or testName',
      );
    }
    super(`${NO_MATCH_MESSAGE_PREFIX} ${filters.join(' ')}`);
    this.name = 'NoMatchError';
  }
}
