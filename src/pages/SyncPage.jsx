import { useState, useEffect, useRef, useCallback } from 'react'
import { RefreshCw, CheckCircle, AlertTriangle, CalendarDays, Clock, Wifi, WifiOff } from 'lucide-react'
import dayjs from 'dayjs'
import { useStore, getReadCalendarKeys, resolveCalendar } from '@/store/useStore.jsx'
import {
  fetchAllEvents,
  googleEventToSchedule,
} from '@/lib/calendarApi'

const AUTO_SYNC_INTERVAL = 30 * 1000 // 30초

export default function SyncPage() {
  const { state, actions } = useStore()
  const [loading, setLoading] = useState(false)
  const [nextSyncIn, setNextSyncIn] = useState(null)
  const [syncError, setSyncError] = useState('')
  const countdownTimer = useRef(null)

  // 연결 상태는 store에서 읽기
  const connected = state.googleConnected
  const lastSyncTime = state.lastSyncAt ? dayjs(state.lastSyncAt) : null

  // 카운트다운 표시 (수동 동기화 후 5분 카운트다운)
  const startCountdown = useCallback(() => {
    if (countdownTimer.current) clearInterval(countdownTimer.current)
    setNextSyncIn(AUTO_SYNC_INTERVAL / 1000)
    countdownTimer.current = setInterval(() => {
      setNextSyncIn(prev => {
        if (prev <= 1) {
          clearInterval(countdownTimer.current)
          return null
        }
        return prev - 1
      })
    }, 1000)
  }, [])

  useEffect(() => {
    // 이미 연결됐으면 카운트다운 시작
    if (connected) startCountdown()
    return () => {
      if (countdownTimer.current) clearInterval(countdownTimer.current)
    }
  }, []) // eslint-disable-line

  // ── 수동 가져오기 (멀티 캘린더) ───────────────────────────────────────────
  const handleImport = async () => {
    setLoading(true)
    setSyncError('')
    try {
      const readKeys = getReadCalendarKeys()
      const idToKey = {}
      const calendarIds = []
      for (const key of readKeys) {
        const meta = resolveCalendar(state.calendars, key)
        if (meta?.id) {
          idToKey[meta.id] = { key, meta }
          calendarIds.push(meta.id)
        }
      }
      const { events, errors } = await fetchAllEvents(calendarIds)
      let nextId = Math.max(...state.schedules.map(s => s.id || 0), 0) + 1
      const mapped = events.map(ev => {
        const ctx = idToKey[ev._calendarId] || {}
        const s = googleEventToSchedule(ev, { calKey: ctx.key, calMeta: ctx.meta })
        s.id = s.id || nextId++
        return s
      })
      actions.importFromGoogle(mapped)
      actions.setGoogleConnected(true)
      const now = dayjs()
      startCountdown()
      const errNote = errors && errors.length > 0 ? ` (캘린더 ${errors.length}개 실패)` : ''
      actions.addSyncLog({
        time: now.format('HH:mm'),
        type: 'import',
        msg: `가져오기 완료 (${mapped.length}개 일정)${errNote}`,
        ok: !errors || errors.length === 0,
      })
      // 어떤 캘린더가 실패했는지 콘솔에 자세히 (디버그)
      if (errors && errors.length > 0) {
        console.warn('실패한 캘린더 상세:', errors)
        errors.forEach(err => {
          const calName = idToKey[err.calendarId]?.meta?.label || err.calendarId.slice(0, 24) + '…'
          const tag = err.reason ? `${err.reason}${err.code ? `/${err.code}` : ''}` : (err.code || '')
          const detail = err.detailMessage || err.error
          const suffix = tag ? ` [${tag}] ${detail}` : ` ${detail}`
          actions.addSyncLog({
            time: dayjs().format('HH:mm'),
            type: 'import',
            msg: `실패: ${calName} →${suffix}`,
            ok: false,
          })
        })
      }
    } catch (e) {
      const errMsg = e?.message || String(e)
      setSyncError(errMsg)
      actions.setGoogleConnected(false)
      actions.addSyncLog({ time: dayjs().format('HH:mm'), type: 'import', msg: `가져오기 실패: ${errMsg}`, ok: false })
    }
    setLoading(false)
  }

  return (
    <div className="flex flex-col h-full">
      {/* 헤더 */}
      <header className="bg-slate-900 text-white px-5 pt-12 pb-5 safe-top shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white/15 rounded-2xl flex items-center justify-center">
              <CalendarDays size={20} />
            </div>
            <div>
              <h1 className="text-2xl font-bold">동기화</h1>
              <p className="text-xs text-slate-400">구글 캘린더 연동</p>
            </div>
          </div>
          {nextSyncIn && (
            <div className="flex items-center gap-1.5 bg-white/10 px-3 py-1.5 rounded-xl">
              <Clock size={12} className="text-emerald-400" />
              <span className="text-xs text-emerald-300 tabular-nums">
                {nextSyncIn}초 후 자동 갱신
              </span>
            </div>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4 pb-24 space-y-4">

        {/* 연결 상태 카드 */}
        <div className="bg-white rounded-2xl p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-2xl flex items-center justify-center ${
                connected ? 'bg-emerald-100' : 'bg-slate-100'
              }`}>
                {connected
                  ? <Wifi size={20} className="text-emerald-600" />
                  : <WifiOff size={20} className="text-slate-400" />
                }
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900">구글 캘린더</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300'}`} />
                  <span className="text-xs text-slate-500">
                    {connected
                      ? lastSyncTime
                        ? `연결됨 · ${lastSyncTime.format('HH:mm')} 동기화`
                        : '연결됨'
                      : '연결 중...'}
                  </span>
                </div>
              </div>
            </div>
            <div className="text-xs text-slate-400 text-right">
              <p>10개 캘린더</p>
              <p className="text-slate-300 mt-0.5">서비스 계정</p>
              <p className="text-slate-300 mt-0.5 tabular-nums">
                v {import.meta.env.VITE_BUILD_TIME?.slice(5, 16).replace('T', ' ') || 'dev'}
              </p>
            </div>
          </div>

          {syncError && (
            <div className="mt-3 bg-red-50 rounded-xl p-3 flex gap-2">
              <AlertTriangle size={14} className="text-red-500 shrink-0 mt-0.5" />
              <p className="text-xs text-red-600">{syncError}</p>
            </div>
          )}

          {/* 자동 동기화 안내 */}
          <div className="mt-3 bg-emerald-50 rounded-xl p-3">
            <p className="text-xs text-emerald-700 font-medium">✓ 실시간 자동 동기화</p>
            <p className="text-xs text-emerald-600 mt-0.5">
              앱 수정 → 3초 후 구글 반영<br />
              구글 변경 → 30초마다 + 앱 다시 켤 때 즉시 반영
            </p>
          </div>
        </div>

        {/* 동기화 버튼 — 자동 동기화가 모든 걸 처리하므로 즉시 새로고침 한 종류만. */}
        <button
          onClick={handleImport}
          disabled={loading}
          className="w-full bg-white rounded-2xl p-5 shadow-sm flex items-center justify-center gap-3 active:scale-95 transition-transform disabled:opacity-50"
        >
          <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
            <RefreshCw size={20} className="text-blue-600" />
          </div>
          <div className="text-left">
            <p className="text-sm font-semibold text-slate-900">새로고침</p>
            <p className="text-xs text-slate-400 mt-0.5">구글 캘린더 즉시 다시 가져오기</p>
          </div>
        </button>

        {/* 로딩 표시 */}
        {loading && (
          <div className="flex items-center justify-center gap-2 py-3">
            <RefreshCw size={16} className="text-blue-500 animate-spin" />
            <span className="text-sm text-slate-500">처리 중...</span>
          </div>
        )}

        {/* 동기화 기록 */}
        {state.syncLogs?.length > 0 && (
          <div className="bg-white rounded-2xl p-4 shadow-sm">
            <p className="text-xs font-semibold text-slate-500 mb-3">동기화 기록</p>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {[...state.syncLogs].reverse().map((log, i) => (
                <div key={i} className="flex items-start gap-2">
                  {log.ok
                    ? <CheckCircle size={14} className="text-emerald-500 shrink-0 mt-0.5" />
                    : <AlertTriangle size={14} className="text-amber-500 shrink-0 mt-0.5" />
                  }
                  <p className="text-xs text-slate-600 flex-1">{log.msg}</p>
                  <span className="text-xs text-slate-400 shrink-0">{log.time}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
