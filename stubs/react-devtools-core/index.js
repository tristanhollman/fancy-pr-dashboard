// Stub for Ink's optional `react-devtools-core` peer dependency.
//
// Ink imports it from `devtools.js` behind a `process.env.DEV === 'true'` guard,
// but Bun's bundler resolves the specifier regardless. Without this stub,
// `bun build --compile` fails with `Could not resolve: "react-devtools-core"`,
// and `--external react-devtools-core` only moves the failure to startup.
export default {
  initialize() {},
  connectToDevTools() {},
};
