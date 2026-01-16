// React app entry point - https://goatdb.dev/docs/react
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app.js';
import { registerSchemas } from '../common/schema.js';

registerSchemas();

const domNode = document.getElementById('root')!;

const root = createRoot(domNode);
root.render(<App />);