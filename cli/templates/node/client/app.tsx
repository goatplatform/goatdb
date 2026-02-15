// Main app component
import React from 'react';
import { useDBReady } from '@goatdb/goatdb/react';

export function Contents() {
  // TODO: Replace with your app
  return <div>Hello World</div>;
}

export function App() {
  const ready = useDBReady(); // Waits for database initialization
  // Handle initial loading phase
  if (ready === 'loading') {
    return <div>Loading...</div>;
  }
  if (ready === 'error') {
    return <div>Error! Please reload the page.</div>;
  }
  // Once  loaded, continue to the contents of the app
  return <Contents />;
}
