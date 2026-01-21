
export const SERVER_NAME = 'agent-browser-mcp-server';
export const SERVER_VERSION = '1.0.0';

export const CHARACTER_LIMIT = 25000;
export const DEFAULT_TIMEOUT_MS = 60000;
export const DEFAULT_BIN = 'agent-browser';

export const ALLOWED_ROOT_COMMANDS = new Set([
  'open',
  'snapshot',
  'click',
  'fill',
  'type',
  'press',
  'connect',
  'session',
  'evaluate',
  'goto',
  'back',
  'forward',
  'refresh',
  'wait',
  'close',
  'reload',
  'headers',
  'set-headers'
]);

export const ERR_NOT_ALLOWED = 'Command not allowed';
export const ERR_TIMEOUT = 'Command timed out';
export const ERR_INVALID_INPUT = 'Invalid input';
