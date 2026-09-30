import { describe, expect, it, Mock, vi } from 'vitest';

declare const process: { exit: Mock<(arg: unknown) => void>; cwd: () => string };
declare const console: { log: Mock<(...args: unknown[]) => void> };

export const testOkFixture = (pairedTestFolderPath: string): void => {
  const folder = pairedTestFolderPath.split('/').pop();
  describe(`${folder} ok`, () => {
    it('should work', () => {
      // ptsl-disable-fn immutable
      process.exit = vi.fn();
      process.cwd = () => `${pairedTestFolderPath}/fixture-ok`;
      console.log = vi.fn();
      const { remainingFilesErrs } = require(`${__dirname}/../../src/lint.ts`);

      expect(process.exit.mock.calls).toEqual([[0]]);
      expect(remainingFilesErrs).toEqual([]);

      const consoleLogCalls = console.log.mock.calls;
      expect(consoleLogCalls.length).toEqual(1);
      expect(consoleLogCalls[0]?.[0]).toMatch(/^0 errors. Took \d+ms$/);
    });
  });
};

export const testErrFixture = (pairedTestFolderPath: string): void => {
  const folder = pairedTestFolderPath.split('/').pop();
  describe(`${folder} err`, () => {
    it('should work', () => {
      // ptsl-disable-fn immutable
      process.exit = vi.fn();
      process.cwd = () => `${pairedTestFolderPath}/fixture-err`;
      console.log = vi.fn();
      const { remainingFilesErrs } = require(`${__dirname}/../../src/lint.ts`);

      expect(process.exit.mock.calls).toEqual([[1]]);
      expect(remainingFilesErrs).toMatchSnapshot();

      const consoleLogCalls = console.log.mock.calls;
      const consoleLogCallLast = consoleLogCalls[consoleLogCalls.length - 1];
      expect(consoleLogCallLast?.[0]).toMatch(/^x \d+ errors. Took \d+ms$/);
    });
  });
};
