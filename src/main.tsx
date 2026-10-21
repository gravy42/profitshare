import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
// the Alone Girl Universe type: Work Sans for everything that is read, Special Elite (open-licensed) as the typewriter face
import '@fontsource/work-sans/400.css';
import '@fontsource/work-sans/400-italic.css';
import '@fontsource/work-sans/600.css';
import '@fontsource/work-sans/700.css';
import '@fontsource/special-elite/400.css';
import './styles.css';
import { applyTheme, readTheme } from './theme';

applyTheme(readTheme());

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
