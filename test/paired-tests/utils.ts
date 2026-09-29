import { describe, expect, it, vi } from 'vitest';

export const testOkFixture = (pairedTestFolderPath) => {
  const folder = pairedTestFolderPath.split('/').pop();
  describe(`${folder} ok`, () => {
    it('should work', () => {
      process.exit = vi.fn();
      process.cwd = () => `${pairedTestFolderPath}/fixture-ok`;
      console.log = vi.fn();
      const { remainingFilesErrs } = require(`${__dirname}/../../src/lint.ts`);

      expect(process.exit.mock.calls).toEqual([[0]]);
      expect(remainingFilesErrs).toEqual([]);

      const consoleLogCalls = console.log.mock.calls;
      expect(consoleLogCalls.length).toEqual(1);
      expect(consoleLogCalls[0][0]).toMatch(/^0 errors. Took \d+ms$/);
    });
  });
};

export const testErrFixture = (pairedTestFolderPath) => {
  const folder = pairedTestFolderPath.split('/').pop();
  describe(`${folder} err`, () => {
    it('should work', () => {
      process.exit = vi.fn();
      process.cwd = () => `${pairedTestFolderPath}/fixture-err`;
      console.log = vi.fn();
      const { remainingFilesErrs } = require(`${__dirname}/../../src/lint.ts`);

      expect(process.exit.mock.calls).toEqual([[1]]);
      expect(remainingFilesErrs).toMatchSnapshot();

      const consoleLogCalls = console.log.mock.calls;
      const consoleLogCallLast = consoleLogCalls[consoleLogCalls.length - 1];
      expect(consoleLogCallLast[0]).toMatch(/^x \d+ errors. Took \d+ms$/);
    });
  });
};
