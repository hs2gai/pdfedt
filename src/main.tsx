import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './app/app.css';

// StrictMode is intentionally omitted: EmbedPDF's Viewport can miss the initial size measurement
// when effects run twice, leaving pages unrendered (observed in S1)
createRoot(document.getElementById('root')!).render(<App />);
