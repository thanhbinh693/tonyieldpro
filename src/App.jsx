import React, { useState } from 'react'
import { useApp } from './hooks/useApp'
import HomePage from './pages/HomePage'
import PlansPage from './pages/PlansPage'
import ProfilePage from './pages/ProfilePage'
import AdminPage from './pages/AdminPage'
import BottomNav from './components/BottomNav'
import DepositModal from './components/DepositModal'
import LoadingScreen from './components/LoadingScreen'
import WithdrawModal from './components/WithdrawModal'
import Toast from './components/Toast'
import './App.css'

export default function App() {
  const appState = useApp()
  const { tab, toast, isAdmin, isAdminView } = appState
  const [depositOpen, setDepositOpen] = useState(false)
  const [withdrawOpen, setWithdrawOpen] = useState(false)
  const [depositPlan, setDepositPlan] = useState(null)

  const openDeposit = (plan = null) => {
    setDepositPlan(plan)
    setDepositOpen(true)
  }
  const openWithdraw = () => setWithdrawOpen(true)

  if (appState.loading) return <LoadingScreen />

  if (appState.config?.maintenanceMode && !isAdmin) {
    return <LoadingScreen mode="maintenance" />
  }

  if (isAdmin && isAdminView) {
    return (
      <div className="app">
        <div className="noise" />
        <div className="glow-top glow-red on" />
        <AdminPage {...appState} />
        {toast && <Toast msg={toast.msg} type={toast.type} />}
      </div>
    )
  }

  return (
    <div className="app">
      <div className="noise" />
      <div className={`glow-top glow-gold  ${tab === 'home' ? 'on' : ''}`} />
      <div className={`glow-top glow-blue  ${tab === 'plans' ? 'on' : ''}`} />
      <div className={`glow-top glow-purple${tab === 'profile' ? 'on' : ''}`} />

      <div className="pages">
        {tab === 'home' && <HomePage {...appState} onDeposit={openDeposit} onWithdraw={openWithdraw} />}
        {tab === 'plans' && <PlansPage {...appState} onDeposit={openDeposit} />}
        {tab === 'profile' && <ProfilePage {...appState} />}
      </div>

      <BottomNav tab={tab} setTab={appState.setTab} />

      {depositOpen && (
        <DepositModal
          plans={appState.plans}
          defaultPlan={depositPlan}
          onClose={() => setDepositOpen(false)}
          showToast={appState.showToast}
          onSubmit={appState.submitDeposit}
          walletConnected={appState.walletLiveConnected}
          onConnectWallet={appState.connectWallet}
          userBalance={appState.user?.balance || 0}
        />
      )}

      {withdrawOpen && (
        <WithdrawModal
          balance={appState.user?.balance}
          config={appState.config}
          onClose={() => setWithdrawOpen(false)}
          showToast={appState.showToast}
          onSubmit={appState.submitWithdraw}
          walletConnected={appState.walletLinked}
          onConnectWallet={appState.connectWallet}
          user={appState.user}
        />
      )}

      {toast && <Toast msg={toast.msg} type={toast.type} />}
    </div>
  )
}
