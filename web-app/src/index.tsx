import React from 'react';
import { createRoot } from 'npm:react-dom@19.0.0/client';
import { App } from './app.tsx';

const domNode = document.getElementById('root')!;

const root = createRoot(domNode);
root.render(<App />);
