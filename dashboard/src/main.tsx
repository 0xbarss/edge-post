import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '@fontsource-variable/archivo/wght.css';
import '@fontsource/fragment-mono/latin-400.css';

import App from './App';
import './styles.css';

const container = document.getElementById('root');

if (container === null) {
  throw new Error('The dashboard root element is missing');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
