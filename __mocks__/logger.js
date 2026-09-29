// Minimal stand-in for MagicMirror's js/logger.js so node_helper tests
// don't need the real Electron/renderer logging pipeline.
module.exports = {
  log: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
};
