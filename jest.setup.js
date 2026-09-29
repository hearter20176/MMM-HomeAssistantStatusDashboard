// Stub MagicMirror browser globals so module files can be required in Node
global.Module = { register: () => {} };
global.Log = { info: () => {}, warn: () => {}, error: () => {} };
global.config = { locale: "en" };

// Minimal DOM so getDom()/_buildEntityGroups tests can run under the "node" test environment
const { JSDOM } = require("jsdom");

const dom = new JSDOM("<!doctype html><html><body></body></html>");
global.document = dom.window.document;
