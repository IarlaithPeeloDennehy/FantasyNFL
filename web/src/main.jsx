import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// The /react subpath, not /next: this is a Vite single-page app, and the Next
// build of this component imports `next/navigation` to read the route, which
// does not resolve here. There is no router either, so the plain component is
// the whole integration -- one page view, sent on load.
import { Analytics } from '@vercel/analytics/react'
import App from './App.jsx'
import './index.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
    <Analytics />
  </StrictMode>,
)
