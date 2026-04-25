import { useState, useMemo } from 'react'
import { Plus, Search, X, RefreshCw, CalendarDays } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import dayjs from 'dayjs'
import 'dayjs/locale/ko'
dayjs.locale('ko')

import { useStore } from '@/store/useStore.jsx'
import ScheduleCard from '@/components/ScheduleCard'
import BottomSheet from '@/components/BottomSheet'
import ScheduleForm from '@/components/ScheduleForm'
import PostponeSheet from '@/components/PostponeSheet'

const TEAMS = [
  { id: 'A', label: 'A팀', sub: '오전 9시' },
  { id: 'B', label: 'B팀', sub: '오후 12시' },
  { id: 'C', label: 'C팀', sub: '오후 3시' },
  { id: 'D', label: 'D팀', sub: '오후 6시' },
]

const STATUS_FILTERS = ['전체', '예정', '진행중', '완료', '익일', '특이']

// 캘린더 카테고리 — 메인 화면에 보일 3종.
// 점검/마감(teamReport)은 메인에 안 나옴 (별도 진입점에서 관리).
const CATEGORY_FILTERS = [
  { id: 'all',  label: '전체',     roles: ['pool', 'teamAS', 'ops'] },
  { id: 'pool', label: '익일통합', roles: ['pool'] },
  { id: 'as',   label: 'A/S',      roles: ['teamAS'] },
  { id: 'ops',  label: '납품',     roles: ['ops'] },
]

// 카테고리 배지 색상
const CATEGORY_BADGE = {
  pool:       { label: '익일통합', cls: 'bg-amber-100 text-amber-700 border-amber-200' },
  teamAS:     { label: 'A/S',      cls: 'bg-blue-100 text-blue-700 border-blue-200' },
  ops:        { label: '납품',     cls: 'bg-purple-100 text-purple-700 border-purple-200' },
  teamReport: { label: '점검',     cls: 'bg-slate-100 text-slate-600 border-slate-200' },
}

// 다음 평일 구하기 (토=6, 일=0 건너뜀)
function nextWeekday(dateStr) {
  let d = dayjs(dateStr).add(1, 'day')
  while (d.day() === 0 || d.day() === 6) {
    d = d.add(1, 'day')
  }
  return d.format('YYYY-MM-DD')
}

export default function TodayPage() {
  const { state, actions } = useStore()
  const today = dayjs().format('YYYY-MM-DD')
  const nextWorkday = useMemo(() => nextWeekday(today), [today])

  const [activeTeam, setActiveTeam] = useState('A')
  const [statusFilter, setStatusFilter] = useState('전체')
  const [categoryFilter, setCategoryFilter] = useState('all') // all | pool | as | ops
  const [search, setSearch] = useState('')
  const [editItem, setEditItem] = useState(null)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [postponeItem, setPostponeItem] = useState(null)

  // 카테고리 필터에 해당하는 role 집합
  const allowedRoles = useMemo(() => {
    const cat = CATEGORY_FILTERS.find(c => c.id === categoryFilter)
    return new Set(cat ? cat.roles : ['pool', 'teamAS', 'ops'])
  }, [categoryFilter])

  // 일정이 현재 화면에 표시 대상인지 — 메인 화면에서는 점검/마감 항상 제외.
  // 모든 일정은 시작 시간 기반 팀 슬롯으로 분류 (ops/pool/teamAS 동일).
  const matchesTeamAndCategory = (s) => {
    const role = s.calendarRole || (s.calendarKey?.split(':')[0]) || (s.team ? 'teamAS' : null)
    if (!role) return false // 메타가 없으면 메인 화면에서 제외 (잔재 가능성)
    if (role === 'teamReport') return false
    if (!allowedRoles.has(role)) return false
    return s.team === activeTeam
  }

  // ── 일정 분류 ──────────────────────────────────────────────────────────────
  // "오늘 날짜였다가 미뤄진 일정" = 원래 오늘이었으나 다른 날짜로 변경된 것
  // → 구글에서 가져온 일정 중 오늘 날짜가 아닌 것 + 앱에서 미루기 처리된 것
  // 실용적 기준: originalDate가 오늘인 것 OR status가 '익일'이었다가 날짜가 바뀐 것
  // → 가장 명확한 방법: 앱에서 미루기(postpone)된 일정은 originalDate를 저장
  // 현재 구조에서는 originalDate 필드가 없으므로:
  // "오늘 탭에 보여야 할 일정" = 오늘 날짜 일정 + 다음 평일 일정 + 미뤄진 일정(originalDate === today)
  // originalDate가 없는 경우 → 날짜가 오늘 이후이고 status가 '예정'/'익일'인 것 중
  // googleEventId가 없는 것(앱에서 직접 미룬 것)을 포함
  // 가장 명확한 방법: postponeSchedule 시 originalDate 저장

  const displaySchedules = useMemo(() => {
    return state.schedules
      .filter(matchesTeamAndCategory)
      .filter(s => {
        const isToday = s.date === today
        const isNextWorkday = s.date === nextWorkday
        const isPostponedFromToday = s.originalDate === today

        if (statusFilter === '전체') {
          return isToday || isNextWorkday || isPostponedFromToday
        }
        if (statusFilter === '익일') {
          return isNextWorkday || isPostponedFromToday
        }
        return isToday && s.status === statusFilter
      })
      .filter(s => {
        if (!search) return true
        const q = search.toLowerCase()
        return (s.title + s.location + s.member + (s.memo || '')).toLowerCase().includes(q)
      })
      .sort((a, b) => {
        const aOrder = a.date === today ? 0 : a.date === nextWorkday ? 1 : 2
        const bOrder = b.date === today ? 0 : b.date === nextWorkday ? 1 : 2
        if (aOrder !== bOrder) return aOrder - bOrder
        return (a.start || '').localeCompare(b.start || '')
      })
  }, [state.schedules, today, nextWorkday, activeTeam, statusFilter, categoryFilter, search, allowedRoles]) // eslint-disable-line

  // ── 통계 (오늘 기준 — 카테고리 필터 무관, 우리 팀 작업 + 풀 + 운영 모두 포함) ───
  const stats = useMemo(() => {
    const inScope = state.schedules.filter(s => {
      const role = s.calendarRole || (s.calendarKey?.split(':')[0]) || (s.team ? 'teamAS' : null)
      if (!role || role === 'teamReport') return false
      return s.team === activeTeam
    })
    const todayItems = inScope.filter(s => s.date === today)
    const nextItems = inScope.filter(s => s.date === nextWorkday)
    const postponedItems = inScope.filter(s => s.originalDate === today)
    return {
      total: todayItems.length,
      done: todayItems.filter(s => s.status === '완료').length,
      inProgress: todayItems.filter(s => s.status === '진행중').length,
      issue: todayItems.filter(s => s.status === '특이').length,
      nextDay: nextItems.length + postponedItems.length,
    }
  }, [state.schedules, today, nextWorkday, activeTeam])

  // ── 카테고리별 카운트 (chip 옆에 표시) ────────────────────────────────────
  const categoryCounts = useMemo(() => {
    const counts = { all: 0, pool: 0, as: 0, ops: 0 }
    state.schedules.forEach(s => {
      const role = s.calendarRole || (s.calendarKey?.split(':')[0]) || (s.team ? 'teamAS' : null)
      if (!role || role === 'teamReport') return
      if (s.team !== activeTeam) return
      const isToday = s.date === today
      const isNextWorkday = s.date === nextWorkday
      const isPostponed = s.originalDate === today
      if (!(isToday || isNextWorkday || isPostponed)) return
      counts.all++
      if (role === 'pool') counts.pool++
      else if (role === 'teamAS') counts.as++
      else if (role === 'ops') counts.ops++
    })
    return counts
  }, [state.schedules, today, nextWorkday, activeTeam])

  // 완료/특이 버튼은 토글 — 같은 상태에서 다시 누르면 '예정'으로 되돌림.
  const handleComplete = (item) => actions.setStatus(item.id, item.status === '완료' ? '예정' : '완료')
  const handleIssue = (item) => actions.setStatus(item.id, item.status === '특이' ? '예정' : '특이')

  // 미루기 버튼 토글 — 이미 미뤄진 일정(originalDate 보유)에서 다시 누르면 원래 날짜로 복구.
  const handlePostpone = (item) => {
    if (item.originalDate && item.originalDate !== item.date) {
      actions.unpostponeSchedule(item.id)
      return
    }
    setPostponeItem(item)
  }

  const handleSave = (formData) => {
    if (formData.id) {
      actions.updateSchedule(formData)
    } else {
      actions.addSchedule({ ...formData, date: formData.date || today })
    }
    setIsFormOpen(false)
    setEditItem(null)
  }

  const handleDelete = (id) => {
    actions.deleteSchedule(id)
    setIsFormOpen(false)
    setEditItem(null)
  }

  const handleTapCard = (item) => {
    setEditItem(item)
    setIsFormOpen(true)
  }

  const handlePostponeConfirm = (id, date) => {
    actions.postponeSchedule(id, date)
  }

  const progressPct = stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0

  // 필터별 카운트 — 메인 화면 범위(우리 팀 A/S + 풀 + 운영)에서 계산
  const filterCount = (f) => {
    const inScope = state.schedules.filter(s => {
      const role = s.calendarRole || (s.calendarKey?.split(':')[0]) || (s.team ? 'teamAS' : null)
      if (!role || role === 'teamReport') return false
      if (s.team !== activeTeam) return false
      // 카테고리 필터도 반영
      return allowedRoles.has(role)
    })
    if (f === '전체') {
      return inScope.filter(s =>
        s.date === today || s.date === nextWorkday || s.originalDate === today
      ).length
    }
    if (f === '익일') {
      return inScope.filter(s =>
        s.date === nextWorkday || s.originalDate === today
      ).length
    }
    return inScope.filter(s => s.date === today && s.status === f).length
  }

  // 날짜 그룹 라벨
  const getDateLabel = (date) => {
    if (date === today) return null // 오늘은 라벨 없음
    if (date === nextWorkday) return `다음 평일 (${dayjs(nextWorkday).format('M/D ddd')})`
    return `${dayjs(date).format('M/D ddd')} (미뤄진 일정)`
  }

  return (
    <div className="flex flex-col h-full">
      {/* ── 헤더 ── */}
      <header className="bg-slate-900 text-white px-5 pt-12 pb-5 safe-top shrink-0">
        <div className="flex items-start justify-between mb-3">
          <div>
            <p className="text-xs text-slate-400 font-medium">
              {dayjs().format('YYYY년 M월 D일 dddd')}
            </p>
            <h1 className="text-2xl font-bold mt-0.5">오늘 외근 일정</h1>
          </div>
          <button
            onClick={() => { setEditItem(null); setIsFormOpen(true) }}
            className="w-10 h-10 bg-white/15 rounded-2xl flex items-center justify-center active:bg-white/25 transition-colors mt-1"
          >
            <Plus size={20} />
          </button>
        </div>

        {/* 통계 칩 */}
        <div className="flex gap-2 mb-4 overflow-x-auto">
          {[
            { label: '전체', value: stats.total, color: 'bg-white/15' },
            { label: '완료', value: stats.done, color: 'bg-emerald-500/30' },
            { label: '진행중', value: stats.inProgress, color: 'bg-amber-500/30' },
            { label: '특이', value: stats.issue, color: stats.issue > 0 ? 'bg-rose-500/40' : 'bg-white/10' },
            { label: '익일+', value: stats.nextDay, color: 'bg-blue-500/30' },
          ].map(({ label, value, color }) => (
            <div key={label} className={`${color} rounded-xl px-3 py-2 text-center min-w-[52px] shrink-0`}>
              <p className="text-[10px] text-white/70 font-medium">{label}</p>
              <p className="text-lg font-bold leading-none mt-0.5">{value}</p>
            </div>
          ))}
        </div>

        {/* 진행률 바 */}
        {stats.total > 0 && (
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1.5 bg-white/15 rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-emerald-400 rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${progressPct}%` }}
                transition={{ duration: 0.6, ease: 'easeOut' }}
              />
            </div>
            <span className="text-xs text-white/60 font-medium tabular-nums">{progressPct}%</span>
          </div>
        )}
      </header>

      {/* ── 팀 탭 ── */}
      <div className="bg-white border-b border-slate-100 px-4 pt-3 pb-0 shrink-0">
        <div className="grid grid-cols-4 gap-1">
          {TEAMS.map(({ id, label, sub }) => (
            <button
              key={id}
              onClick={() => setActiveTeam(id)}
              className={`py-2.5 rounded-xl text-center transition-all ${
                activeTeam === id
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-500 hover:bg-slate-50'
              }`}
            >
              <p className="text-sm font-bold">{label}</p>
              <p className={`text-[10px] font-medium mt-0.5 ${activeTeam === id ? 'text-white/70' : 'text-slate-400'}`}>{sub}</p>
            </button>
          ))}
        </div>
      </div>

      {/* ── 검색 + 카테고리 + 상태 필터 ── */}
      <div className="bg-white px-4 py-3 space-y-2.5 shrink-0 border-b border-slate-100">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="이름, 주소, 메모 검색"
            className="w-full h-9 pl-8 pr-8 bg-slate-50 rounded-xl text-sm text-slate-900 border border-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-900/15"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400">
              <X size={14} />
            </button>
          )}
        </div>

        {/* 카테고리 chips — 익일통합/A/S/납품 분류 */}
        <div className="flex gap-1.5 overflow-x-auto pb-0.5">
          {CATEGORY_FILTERS.map(c => {
            const count = categoryCounts[c.id] ?? 0
            const active = categoryFilter === c.id
            const accentCls = active
              ? c.id === 'pool' ? 'bg-amber-500 text-white'
              : c.id === 'as'   ? 'bg-blue-600 text-white'
              : c.id === 'ops'  ? 'bg-purple-600 text-white'
              : 'bg-slate-900 text-white'
              : 'bg-slate-100 text-slate-500'
            return (
              <button
                key={c.id}
                onClick={() => setCategoryFilter(c.id)}
                className={`shrink-0 h-7 px-3 rounded-full text-xs font-semibold transition-all ${accentCls}`}
              >
                {c.label}{count > 0 && <span className="ml-0.5 opacity-70">{count}</span>}
              </button>
            )
          })}
        </div>

        <div className="flex gap-1.5 overflow-x-auto pb-0.5">
          {STATUS_FILTERS.map(f => {
            const count = filterCount(f)
            return (
              <button
                key={f}
                onClick={() => setStatusFilter(f)}
                className={`shrink-0 h-7 px-3 rounded-full text-xs font-semibold transition-all ${
                  statusFilter === f
                    ? f === '익일'
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-500'
                }`}
              >
                {f} {count > 0 && <span className="ml-0.5 opacity-70">{count}</span>}
              </button>
            )
          })}
        </div>
      </div>

      {/* ── 일정 목록 ── */}
      <div className="flex-1 overflow-y-auto px-4 py-3 pb-24 space-y-3">
        <AnimatePresence mode="popLayout">
          {displaySchedules.length === 0 ? (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col items-center justify-center py-16 text-center"
            >
              <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mb-3">
                <CalendarDays size={24} className="text-slate-300" />
              </div>
              <p className="text-slate-500 font-medium">
                {statusFilter === '익일' ? '익일 일정이 없습니다' : '오늘 일정이 없습니다'}
              </p>
              <p className="text-slate-400 text-sm mt-1">+ 버튼으로 일정을 추가하세요</p>
            </motion.div>
          ) : (
            (() => {
              // 날짜 그룹별로 구분선 삽입
              let lastDate = null
              return displaySchedules.map((item, idx) => {
                const showDivider = item.date !== lastDate && lastDate !== null
                const isGroupStart = item.date !== lastDate
                lastDate = item.date
                const label = getDateLabel(item.date)

                return (
                  <div key={item.id}>
                    {isGroupStart && label && (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="flex items-center gap-2 py-1"
                      >
                        <div className="flex-1 h-px bg-blue-100" />
                        <span className="text-xs text-blue-500 font-semibold shrink-0 flex items-center gap-1">
                          <CalendarDays size={11} />
                          {label}
                        </span>
                        <div className="flex-1 h-px bg-blue-100" />
                      </motion.div>
                    )}
                    <ScheduleCard
                      item={item}
                      onTap={handleTapCard}
                      onComplete={handleComplete}
                      onPostpone={handlePostpone}
                      onIssue={handleIssue}
                    />
                  </div>
                )
              })
            })()
          )}
        </AnimatePresence>
      </div>

      {/* ── 일정 추가/수정 시트 ── */}
      <BottomSheet
        open={isFormOpen}
        onClose={() => { setIsFormOpen(false); setEditItem(null) }}
        title={editItem ? '일정 수정' : '새 일정 추가'}
        fullHeight
      >
        <ScheduleForm
          item={editItem}
          onSave={handleSave}
          onDelete={handleDelete}
          onClose={() => { setIsFormOpen(false); setEditItem(null) }}
        />
      </BottomSheet>

      {/* ── 미루기 시트 ── */}
      <PostponeSheet
        open={!!postponeItem}
        onClose={() => setPostponeItem(null)}
        item={postponeItem}
        onConfirm={handlePostponeConfirm}
      />
    </div>
  )
}
