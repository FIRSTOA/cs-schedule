import { useState, useEffect, useRef, useCallback } from 'react'
import { RefreshCw, Download, Upload, CheckCircle, AlertTriangle, CalendarDays, Clock, Wifi, WifiOff } from 'lucide-react'
import dayjs from 'dayjs'
import { useStore, getReadCalendarKeys, resolveCalendar } from '@/store/useStore.jsx'
import {
  fetchAllEvents,
  createEvent,
  updateEvent,
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

  // ── 수동 반영하기 (앱 → 구글) ─────────────────────────────────────────────
  const handleExport = async () => {
    setLoading(true)
    let successCount = 0
    let failCount = 0

    const today = dayjs().format('YYYY-MM-DD')
    const targetSchedules = state.schedules.filter(s => (s.workDate || s.date) >= today)

    if (targetSchedules.length === 0) {
      actions.addSyncLog({ time: dayjs().format('HH:mm'), type: 'export', msg: '반영할 일정이 없습니다.', ok: false })
      setLoading(false)
      return
    }

    for (const s of targetSchedules) {
      try {
        const workDate = s.workDate || s.date
        const startHour = s.team === 'A' ? 9 : s.team === 'B' ? 12 : s.team === 'C' ? 15 : 18
        const endHour = startHour
        const endMin = 30
        const statusTag = s.status === '완료' ? '[완료] ' : s.status === '특이' ? '[특이] ' : s.status === '진행중' ? '[진행중] ' : ''
        const colorId = s.status === '완료' ? '8' : s.status === '특이' ? '11' : s.status === '진행중' ? '5' : undefined
        // 담당자 이름이 이미 title 앞에 포함된 경우 중복 방지
        const titleAlreadyHasMember = s.member && s.member !== '미배정' && s.title.startsWith(`${s.member} / `)
        const baseTitle = s.member && s.member !== '미배정' && !titleAlreadyHasMember ? `${s.member} / ${s.title}` : s.title
        const eventBody = {
          summary: `${statusTag}${baseTitle}`,
          ...(colorId ? { colorId } : {}),
          location: s.location || s.address || '',
          description: [
            s.memo ? `메모: ${s.memo}` : '',
            `팀: ${s.team}팀`,
            `담당자: ${s.member || '미배정'}`,
            `상태: ${s.status || '예정'}`,
            s.phone ? `연락처: ${s.phone}` : '',
          ].filter(Boolean).join('\n'),
          start: {
            dateTime: `${workDate}T${String(startHour).padStart(2, '0')}:00:00+09:00`,
            timeZone: 'Asia/Seoul',
          },
          end: {
            dateTime: `${workDate}T${String(endHour).padStart(2, '0')}:${String(endMin).padStart(2, '0')}:00+09:00`,
            timeZone: 'Asia/Seoul',
          },
        }
        if (s.googleEventId) {
          await updateEvent(s.googleEventId, eventBody)
        } else {
          const created = await createEvent(eventBody)
          actions.updateSchedule({ ...s, googleEventId: created.id })
        }
        successCount++
      } catch (e) {
        console.error('반영 실패:', s.title, e)
        failCount++
      }
    }

    actions.addSyncLog({
      time: dayjs().format('HH:mm'),
      type: 'export',
      msg: `반영 완료 (성공 ${successCount}개${failCount > 0 ? `, 실패 ${failCount}개` : ''})`,
      ok: failCount === 0,
    })
    setLoading(false)
  }

  const formatCountdown = (secs) => {
    if (!secs) return ''
    const m = Math.floor(secs / 60)
    const s = secs % 60
    return `${m}:${String(s).padStart(2, '0')}`
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
              <p>{state.googleCalendarId || 'firstoa8@gmail.com'}</p>
              <p className="text-slate-300 mt-0.5">자동 로그인</p>
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

        {/* 동기화 버튼 */}
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={handleImport}
            disabled={loading}
            className="bg-white rounded-2xl p-5 shadow-sm flex flex-col items-center gap-2 active:scale-95 transition-transform disabled:opacity-50"
          >
            <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
              <Download size={20} className="text-blue-600" />
            </div>
            <div className="text-center">
              <p className="text-sm font-semibold text-slate-900">가져오기</p>
              <p className="text-xs text-slate-400 mt-0.5">구글 캘린더 → 앱</p>
            </div>
          </button>

          <button
            onClick={handleExport}
            disabled={loading}
            className="bg-slate-900 rounded-2xl p-5 shadow-sm flex flex-col items-center gap-2 active:scale-95 transition-transform disabled:opacity-50"
          >
            <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
              <Upload size={20} className="text-white" />
            </div>
            <div className="text-center">
              <p className="text-sm font-semibold text-white">전체 반영</p>
              <p className="text-xs text-slate-400 mt-0.5">전체 수동 반영</p>
            </div>
          </button>
        </div>

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
