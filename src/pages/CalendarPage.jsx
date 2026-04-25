import { useState, useMemo } from 'react'
import { ChevronLeft, ChevronRight, Plus, AlertTriangle } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import dayjs from 'dayjs'
import 'dayjs/locale/ko'
dayjs.locale('ko')

import { useStore } from '@/store/useStore.jsx'
import { deleteEvent } from '@/lib/calendarApi'
import BottomSheet from '@/components/BottomSheet'
import ScheduleForm from '@/components/ScheduleForm'
import PostponeSheet from '@/components/PostponeSheet'

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']

const STATUS_DOTS = {
  예정: 'bg-blue-500',
  진행중: 'bg-amber-500',
  완료: 'bg-emerald-500',
  익일: 'bg-violet-500',
  특이: 'bg-rose-500',
}

const STATUS_STYLES = {
  예정:   'text-blue-700',
  진행중: 'text-amber-700',
  완료:   'text-emerald-700 line-through opacity-60',
  익일:   'text-violet-700',
  특이:   'text-rose-700 font-semibold',
}

const TEAM_FILTERS = [
  { id: 'all', label: '전체', color: 'bg-slate-900' },
  { id: 'A',   label: 'A팀 9시',  color: 'bg-blue-600' },
  { id: 'B',   label: 'B팀 12시', color: 'bg-emerald-600' },
  { id: 'C',   label: 'C팀 15시', color: 'bg-violet-600' },
  { id: 'D',   label: 'D팀 18시', color: 'bg-orange-500' },
]

export default function CalendarPage() {
  const { state, actions } = useStore()
  const today = dayjs().format('YYYY-MM-DD')

  const [currentMonth, setCurrentMonth] = useState(dayjs().startOf('month'))
  const [selectedDate, setSelectedDate] = useState(today)
  const [teamFilter, setTeamFilter] = useState('all')
  const [editItem, setEditItem] = useState(null)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [postponeItem, setPostponeItem] = useState(null)

  // 달력 셀 생성
  const calendarCells = useMemo(() => {
    const startOfMonth = currentMonth.startOf('month')
    const endOfMonth = currentMonth.endOf('month')
    const startDay = startOfMonth.day()
    const daysInMonth = endOfMonth.date()

    const cells = []
    for (let i = 0; i < startDay; i++) cells.push({ date: null, day: null })
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({ date: currentMonth.date(d).format('YYYY-MM-DD'), day: d })
    }
    while (cells.length % 7 !== 0) cells.push({ date: null, day: null })
    return cells
  }, [currentMonth])

  // 날짜별 일정 맵 (팀 필터 적용)
  const schedulesByDate = useMemo(() => {
    const map = {}
    state.schedules
      .filter(s => teamFilter === 'all' || s.team === teamFilter)
      .forEach(s => {
        if (!map[s.date]) map[s.date] = []
        map[s.date].push(s)
      })
    return map
  }, [state.schedules, teamFilter])

  // 선택된 날짜의 일정 (팀 필터 적용, 시간순)
  const selectedSchedules = useMemo(() => {
    return (schedulesByDate[selectedDate] || []).sort((a, b) => a.start.localeCompare(b.start))
  }, [schedulesByDate, selectedDate])

  const handleOpenAdd = () => {
    // 현재 팀 필터가 특정 팀이면 그 팀으로, 아니면 A팀으로 기본값
    const defaultTeam = teamFilter !== 'all' ? teamFilter : 'A'
    setEditItem({ date: selectedDate, team: defaultTeam })
    setIsFormOpen(true)
  }

  const handleSave = (formData) => {
    // 편집 저장은 무조건 dirty — 폼의 옛 localDirty(=false from import)에 가리지 않게.
    if (formData.id) actions.updateSchedule({ ...formData, localDirty: true })
    else actions.addSchedule(formData)
    setIsFormOpen(false)
    setEditItem(null)
  }

  const handleDelete = async (id) => {
    setIsFormOpen(false)
    setEditItem(null)
    const item = state.schedules.find(s => s.id === id)
    // 구글에 있는 이벤트면 거기부터 지움 — 안 그러면 다음 import에 부활.
    if (item?.googleEventId) {
      try {
        await deleteEvent(item.googleEventId, item.calendarId)
      } catch (e) {
        actions.addSyncLog({
          time: dayjs().format('HH:mm'),
          type: 'export',
          msg: `삭제 실패: ${item.title || ''} - ${e.message}`,
          ok: false,
        })
        return
      }
    }
    actions.deleteSchedule(id)
  }

  return (
    <div className="flex flex-col h-full">
      {/* ── 헤더 ── */}
      <header className="bg-slate-900 text-white px-5 pt-12 pb-4 safe-top shrink-0">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setCurrentMonth(m => m.subtract(1, 'month'))}
            className="w-9 h-9 flex items-center justify-center rounded-xl bg-white/15 active:bg-white/25"
          >
            <ChevronLeft size={18} />
          </button>
          <div className="text-center">
            <p className="text-lg font-bold">{currentMonth.format('YYYY년 M월')}</p>
          </div>
          <button
            onClick={() => setCurrentMonth(m => m.add(1, 'month'))}
            className="w-9 h-9 flex items-center justify-center rounded-xl bg-white/15 active:bg-white/25"
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </header>

      {/* ── 팀 필터 탭 ── */}
      <div className="bg-white border-b border-slate-100 px-4 py-2.5 shrink-0">
        <div className="flex gap-1.5 overflow-x-auto pb-0.5">
          {TEAM_FILTERS.map(f => (
            <button
              key={f.id}
              onClick={() => setTeamFilter(f.id)}
              className={`shrink-0 h-7 px-3 rounded-full text-xs font-semibold transition-all ${
                teamFilter === f.id
                  ? `${f.color} text-white`
                  : 'bg-slate-100 text-slate-500'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pb-24">
        {/* ── 달력 그리드 ── */}
        <div className="bg-white">
          {/* 요일 헤더 */}
          <div className="grid grid-cols-7 border-b border-slate-100">
            {WEEKDAYS.map((d, i) => (
              <div key={d} className={`py-2 text-center text-xs font-semibold ${
                i === 0 ? 'text-rose-500' : i === 6 ? 'text-blue-500' : 'text-slate-400'
              }`}>{d}</div>
            ))}
          </div>

          {/* 날짜 셀 */}
          <div className="grid grid-cols-7">
            {calendarCells.map((cell, idx) => {
              if (!cell.date) return <div key={`empty-${idx}`} className="h-16 border-b border-r border-slate-50" />

              const isToday = cell.date === today
              const isSelected = cell.date === selectedDate
              const daySchedules = schedulesByDate[cell.date] || []
              const hasIssue = daySchedules.some(s => s.status === '특이')
              const isSun = idx % 7 === 0
              const isSat = idx % 7 === 6

              // 상태별 점 (최대 3개)
              const dots = daySchedules.slice(0, 3).map(s => STATUS_DOTS[s.status] || 'bg-slate-400')

              return (
                <button
                  key={cell.date}
                  onClick={() => setSelectedDate(cell.date)}
                  className={`h-16 flex flex-col items-center pt-1.5 border-b border-r border-slate-50 transition-colors relative ${
                    isSelected ? 'bg-slate-900' : 'bg-white active:bg-slate-50'
                  }`}
                >
                  <span className={`w-7 h-7 flex items-center justify-center rounded-full text-sm font-semibold ${
                    isToday && !isSelected ? 'bg-slate-900 text-white'
                    : isSelected ? 'text-white'
                    : isSun ? 'text-rose-500'
                    : isSat ? 'text-blue-500'
                    : 'text-slate-700'
                  }`}>
                    {cell.day}
                  </span>
                  <div className="flex gap-0.5 mt-1">
                    {dots.map((dot, i) => (
                      <span key={i} className={`w-1.5 h-1.5 rounded-full ${isSelected ? 'opacity-70 bg-white' : dot}`} />
                    ))}
                    {daySchedules.length > 3 && (
                      <span className={`text-[9px] font-bold ${isSelected ? 'text-white/70' : 'text-slate-400'}`}>+</span>
                    )}
                  </div>
                  {hasIssue && !isSelected && (
                    <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-rose-500 rounded-full" />
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {/* ── 선택 날짜 일정 목록 ── */}
        <div className="px-4 pt-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-slate-900">
              {dayjs(selectedDate).format('M월 D일 (ddd)')} 일정
              <span className="ml-1.5 text-slate-400 font-normal">({selectedSchedules.length}건)</span>
            </h2>
            <button
              onClick={handleOpenAdd}
              className="flex items-center gap-1 text-xs text-white font-semibold bg-slate-900 px-3 py-1.5 rounded-xl active:bg-slate-700"
            >
              <Plus size={12} /> 추가
            </button>
          </div>

          <AnimatePresence>
            {selectedSchedules.length === 0 ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-center py-10 text-slate-400 text-sm"
              >
                <div className="text-3xl mb-2">📅</div>
                <p>이 날 일정이 없습니다</p>
                <button
                  onClick={handleOpenAdd}
                  className="mt-3 text-xs text-slate-500 underline"
                >
                  일정 추가하기
                </button>
              </motion.div>
            ) : (
              <div className="space-y-2">
                {selectedSchedules.map(item => {
                  const cleanTitle = item.member && item.member !== '미배정' && item.title?.startsWith(`${item.member} / `)
                    ? item.title.slice(item.member.length + 3)
                    : item.title
                  return (
                  <motion.button
                    key={item.id}
                    layout
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    onClick={() => { setEditItem(item); setIsFormOpen(true) }}
                    className="w-full bg-white rounded-2xl px-4 py-3 flex items-center gap-3 shadow-sm text-left active:bg-slate-50"
                  >
                    <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOTS[item.status] || 'bg-slate-400'}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-400 tabular-nums shrink-0">{item.start}</span>
                        <span className={`text-sm font-medium truncate ${STATUS_STYLES[item.status]}`}>
                          {item.member && item.member !== '미배정' && (
                            <span className="text-blue-700 mr-1">{item.member}</span>
                          )}
                          {cleanTitle}
                        </span>
                      </div>
                      {item.location && (
                        <p className="text-xs text-slate-400 truncate mt-0.5">{item.location}</p>
                      )}
                    </div>
                    {item.status === '특이' && <AlertTriangle size={14} className="text-rose-500 shrink-0" />}
                    {/* 팀 뱃지 */}
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md shrink-0 ${
                      item.team === 'A' ? 'bg-blue-100 text-blue-700'
                      : item.team === 'B' ? 'bg-emerald-100 text-emerald-700'
                      : item.team === 'C' ? 'bg-violet-100 text-violet-700'
                      : 'bg-orange-100 text-orange-700'
                    }`}>
                      {item.team}팀
                    </span>
                  </motion.button>
                  )
                })}
              </div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* ── 일정 추가/수정 시트 ── */}
      <BottomSheet
        open={isFormOpen}
        onClose={() => { setIsFormOpen(false); setEditItem(null) }}
        title={editItem?.id ? '일정 수정' : '새 일정 추가'}
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
        onConfirm={(id, date) => actions.postponeSchedule(id, date)}
      />
    </div>
  )
}
