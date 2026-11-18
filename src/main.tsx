import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AppBoundary } from './ui/CrashScreen';
// the house type: Work Sans for everything that is read, Special Elite (open-licensed) as the typewriter face, and
// Caveat (open-licensed, SIL OFL 1.1; one weight, Latin only) as the handwriting on the pitch deck's papers
import '@fontsource/work-sans/400.css';
import '@fontsource/work-sans/400-italic.css';
import '@fontsource/work-sans/600.css';
import '@fontsource/work-sans/700.css';
import '@fontsource/special-elite/400.css';
import '@fontsource/caveat/latin-600.css';
import './styles.css';
import { applyTheme, readTheme } from './theme';

applyTheme(readTheme());

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {/* if drawing the page fails, a plain screen with ways on stands in for a white page */}
    <AppBoundary><App /></AppBoundary>
  </React.StrictMode>,
);
