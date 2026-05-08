import { Buffer } from 'buffer'
window.Buffer = Buffer

import React, { useState, useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import { TonConnectUIProvider, CHAIN } from '@tonconnect/ui-react'
import App from './App'
import './index.css'
import { TON_NETWORK } from './utils/config'
import { getAdminConfig } from './utils/supabase'

const MANIFEST_URL = 'https://tonyield-two.vercel.app/tonconnect-manifest.json'

function Root() {
  const [network, setNetwork] = useState(TON_NETWORK)

  useEffect(() => {
    // Load network from Supabase config on startup
    getAdminConfig(null).then(cfg => {
      if (cfg?.tonNetwork) setNetwork(cfg.tonNetwork)
    }).catch(() => {})
  }, [])

  const networkChain = network === 'mainnet' ? CHAIN.MAINNET : CHAIN.TESTNET

  return (
    <TonConnectUIProvider
      manifestUrl={MANIFEST_URL}
      network={networkChain}
    >
      <App onNetworkChange={setNetwork} />
    </TonConnectUIProvider>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(<Root />)

