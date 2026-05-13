import { Buffer } from 'buffer'
window.Buffer = Buffer

import React from 'react'
import ReactDOM from 'react-dom/client'
import { TonConnectUIProvider } from '@tonconnect/ui-react'
import App from './App'
import './index.css'

const MANIFEST_URL = 'https://tonyieldpro.vercel.app/tonconnect-manifest.json'

ReactDOM.createRoot(document.getElementById('root')).render(
  <TonConnectUIProvider
    manifestUrl={MANIFEST_URL}
  >
    <App />
  </TonConnectUIProvider>
)
