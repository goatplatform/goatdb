// React app entry point - https://goatdb.dev/docs/react
// deno-lint-ignore no-unused-vars
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app.tsx';
import { registerSchemas } from '../common/schema.ts';

registerSchemas();

const domNode = document.getElementById('root')!;

const root = createRoot(domNode);
root.render(<App />);
