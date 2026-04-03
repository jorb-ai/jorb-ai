/**
 * Renderer Entry Point (React)
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';

// Render React app
const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
