import React, { useState } from 'react'
import { Coins, Send, Zap } from 'lucide-react'
import { DAY_NAMES } from '../utils/config'
const TODAY_DOW = new Date().getDay()
import './PlansPage.css'

const formatTon = (value) => `${(Number(value) || 0).toFixed(2)} TON`
const formatPct = (value) => `${(Number(value) || 0).toFixed(1)}%`
const formatDuration = (plan) => {
  const n = Number(plan?.duration) || 0
  const unit = plan?.durationUnit === 'hours' ? 'hour' : 'day'
  return `${n} ${unit}${n === 1 ? '' : 's'}`
}
const formatDistribution = (minutes) => {
  const n = Number(minutes) || 0
  if (n < 60) return `${n} min`
  const h = n / 60
  return `${h} hour${h === 1 ? '' : 's'}`
}
const formatYieldName = (plan) => {
  if (plan?.id === 1) return 'Starter Yield'
  if (plan?.id === 2) return 'Pro Yield'
  if (plan?.id === 3) return 'VIP Yield'
  const v = String(plan?.name || plan?.tier || '')
    .replace(/\bBasic\b/gi, 'Starter Yield')
    .replace(/\bProfessional\b/gi, 'Pro Yield')
    .replace(/\bElite\b/gi, 'VIP Yield')
  return /\byield\b/i.test(v) ? v : `${v} Yield`
}

function detectPlan(plans, amount) {
  const amt = parseFloat(amount) || 0
  if (!amt) return null
  const eligible = plans.filter(p => amt >= p.min && (!p.max || amt <= p.max))
  if (eligible.length === 0) return null
  return eligible[eligible.length - 1]
}

export default function PlansPage({ plans, onDeposit, config }) {
  const [calcAmt, setCalcAmt] = useState('')

  // Auto-detect plan from amount (same logic as DepositModal)
  const amt = parseFloat(calcAmt) || 0
  const autoPlan = detectPlan(plans, calcAmt)
  const best = plans.find(p => p.hot) || plans[1] || plans[0]
  const activePlan = autoPlan || best
  const rate = activePlan?.rate || 2.5
  const duration = activePlan?.duration || 1
  const intervalMin = activePlan?.profitIntervalMinutes || 5
  const durationMs = activePlan?.durationMs || (duration * (activePlan?.durationUnit === 'hours' ? 3_600_000 : 86_400_000))

  const profitPerInterval = amt * rate / 100
  const totalIntervals = Math.floor(durationMs / (intervalMin * 60_000))
  const totalProfit = profitPerInterval * totalIntervals
  const intervalLabel = formatDistribution(intervalMin)

  const referralRate = config?.referralRate || 5

  // Build a human-readable active days label from the most common plan's active days
  const commonDays = plans[0]?.activeDays || [1,2,3,4,5]
  const allSameDays = plans.every(p => JSON.stringify(p.activeDays||[1,2,3,4,5]) === JSON.stringify(commonDays))
  const activeDaysLabel = allSameDays
    ? commonDays.map(d => DAY_NAMES[d]).join('–')
    : 'Weekday'
  const colorMap = { gold: 'var(--gold)', blue: 'var(--blue)', purple: 'var(--purple)' }
  const planColor = colorMap[activePlan?.color] || 'var(--gold)'

  return (
    <div className="page page-enter">
      <div style={{height:18}}/>
      <div className="pp-hero">
        <div className="pph-label">YIELD MARKETS</div>
        <div className="pph-title">TON Yield<br/><em>Strategies</em></div>
        <div className="pph-sub">Select a strategy that matches your risk profile.</div>
      </div>

      {/* Calculator */}
      <div className="calc-box">
        <div className="oc-orbit" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className="calc-header">
          <span className="calc-icon"><Zap size={18} color="#0098EA" /></span>
          <span className="calc-title">RETURN CALCULATOR</span>
        </div>

        {/* Auto-plan badge */}
        <div className="auto-plan-row" style={{marginBottom:12}}>
          {autoPlan && (
            <div className="auto-plan-badge" style={{
              background: planColor,
              color: autoPlan.color === 'gold' ? '#080b12' : '#fff'
            }}>
              <Coins size={16} color={autoPlan.color === 'gold' ? '#080b12' : '#fff'} />
              <span>{formatYieldName(autoPlan)} - {formatPct(autoPlan.rate)} - {formatDistribution(autoPlan.profitIntervalMinutes)} - {formatDuration(autoPlan)}</span>
              <span className="apb-tag">AUTO</span>
            </div>
          )}
        </div>

        {/* Range guide */}
        <div className="plan-range-guide">
          {plans.map(p => (
            <div key={p.id} className={`prg-item ${autoPlan?.id === p.id ? 'active ' + p.color : ''}`}>
              <div className="prg-tier">{p.tier}</div>
              <div className="prg-range">
                <span>{formatTon(p.min)}</span>
                <span className="prg-sep">to</span>
                <span>{p.max ? formatTon(p.max) : 'No limit'}</span>
              </div>
              <div className="prg-rate">{formatPct(p.rate)}</div>
            </div>
          ))}
        </div>

        <div className="calc-input-row">
          <input
            className="calc-input"
            type="number"
            placeholder="0.00"
            value={calcAmt}
            onChange={e => setCalcAmt(e.target.value)}
          />
          <span className="calc-unit">TON</span>
        </div>

        <div className="calc-results">
          <div className="cr-item">
            <div className="cr-val" style={amt ? {color: planColor} : {}}>{amt ? `+${profitPerInterval.toFixed(3)} TON` : '---'}</div>
            <div className="cr-label">{intervalLabel}</div>
          </div>
          <div className="cr-item">
            <div className="cr-val" style={amt ? {color: planColor} : {}}>{amt ? `+${totalProfit.toFixed(3)} TON` : '---'}</div>
            <div className="cr-label">Total return</div>
          </div>
        </div>
      </div>

      {plans.map(plan => (
        <div key={plan.id} className={`plan-card ${plan.color}`}>
          {plan.hot && <div className="pc-hot-ribbon">★ TOP</div>}
          <div className="pc-top">
            <div>
              <span className={`pc-badge ${plan.color}`}>{formatYieldName(plan).replace(/\s+Yield$/i, '').toUpperCase()}</span>
              <div className="pc-name">{formatYieldName(plan).toUpperCase()}</div>
              <div className="pc-range">Min. deposit {formatTon(plan.min)} · Max. deposit {plan.max ? formatTon(plan.max) : 'No limit'}</div>
            </div>
            <div className="pc-rate-wrap">
              <div className={`pc-rate ${plan.color}`}>{formatPct(plan.rate)}</div>
              <div className="pc-per">{formatDistribution(plan.profitIntervalMinutes)}</div>
            </div>
          </div>
          {/* Active days chips */}
          <div className="pc-days-row">
            {[0,1,2,3,4,5,6].map(i => {
              const on = (plan.activeDays||[1,2,3,4,5]).includes(i)
              const cls = `pc-day-chip ${on ? 'on ' + plan.color : 'off'} ${i===TODAY_DOW?'today':''}`
              return <span key={i} className={cls}>{DAY_NAMES[i]}</span>
            })}
          </div>
          <div className="pc-divider"/>
          <div className="pc-features">
            <div className="pc-feat"><div className={`dot ${plan.color}`}/>Duration {formatDuration(plan)}</div>
            <div className="pc-feat"><div className={`dot ${plan.color}`}/>{formatDistribution(plan.profitIntervalMinutes)}</div>
            <div className="pc-feat"><div className={`dot ${plan.color}`}/>{formatPct(referralRate)} referral income</div>
            <div className="pc-feat"><div className={`dot ${plan.color}`}/>{(plan.activeDays||[1,2,3,4,5]).map(d=>DAY_NAMES[d]).join('-')} distributions</div>
          </div>
          <button className={`pc-btn ${plan.color}`} onClick={() => onDeposit(plan)}><Send size={16} color="#FFFFFF" /> Open Position</button>
        </div>
      ))}
      <div style={{height:8}}/>
    </div>
  )
}
