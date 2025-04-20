import { describe, it, expect } from 'vitest';
import { createLogger } from './logger';

describe('Logger', () => {
  it('should create a logger instance with the given module name', () => {
    const logger = createLogger('test-module');
    expect(logger).toBeDefined();
    expect(logger.level).toBe('info');
  });
}); 