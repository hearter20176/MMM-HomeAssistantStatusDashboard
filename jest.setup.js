// Stub MagicMirror browser globals so module files can be required in Node
global.Module = { register: () => {} };
global.Log = { info: () => {}, warn: () => {}, error: () => {} };
global.config = { locale: "en" };
