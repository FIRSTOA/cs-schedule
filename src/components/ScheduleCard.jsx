import { useState } from 'react'
import { MapPin, Phone, Clock, ChevronRight, AlertTriangle } from 'lucide-react'
import { motion } from 'framer-motion'
import NaviSheet from '@/components/NaviSheet'

const STATUS_STYLES = {
  예정:   { bar: 'bg-blue-500',    badge: 'bg-blue-50 text-blue-700 border-blue-200' },
  진행중: { bar: 'bg-amber-500',   badge: 'bg-amber-50 text-amber-700 border-amber-200' },
  완료:   { bar: 'bg-emerald-500', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  익일:   { bar: 'bg-violet-500',  badge: 'bg-violet-50 text-violet-700 border-violet-200' },
  특이:   { bar: 'bg-rose-500',    badge: 'bg-rose-50 text-rose-700 border-rose-200' },
}

// 카테고리 배지 (출처 캘린더 표시)
const CATEGORY_BADGE = {
  pool:       { label: '익일통합', cls: 'bg-amber-100 text-amber-700' },
  teamAS:     { label: 'A/S',      cls: 'bg-blue-100 text-blue-700' },
  ops:        { label: '납품',     cls: 'bg-purple-100 text-purple-700' },
  teamReport: { label: '점검',     cls: 'bg-slate-100 text-slate-600' },
}

export default function ScheduleCard({ item, onTap, onComplete, onPostpone, onIssue }) {
  const style = STATUS_STYLES[item.status] || STATUS_STYLES['예정']
  const isDone = item.status === '완료'
  const isIssue = item.status === '특이'
  const [naviOpen, setNaviOpen] = useState(false)

  const handleCall = (e) => {
    e.stopPropagation()
    if (item.phone) window.location.href = `tel:${item.phone.replace(/-/g, '')}`
  }

  // 제목에 이미 "담당자 / " 접두사가 있으면 제거 (담당자는 별도 표시)
  const cleanTitle = item.member && item.member !== '미배정' && item.title?.startsWith(`${item.member} / `)
    ? item.title.slice(item.member.length + 3)
    : item.title

  return (
    <>
      <motion.div
        layout
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96 }}
        transition={{ duration: 0.18 }}
        className={`bg-white rounded-2xl shadow-sm overflow-hidden border ${
          isIssue ? 'border-rose-200' : 'border-transparent'
        } ${isDone ? 'opacity-55' : ''}`}
      >
        {/* 상태 컬러 바 */}
        <div className={`h-1 w-full ${style.bar}`} />

        <div className="p-4">
          {/* 상단: 시간 + 제목 + 상태 뱃지 */}
          <div className="flex items-start justify-between gap-2 mb-2.5">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[11px] text-slate-400 font-medium tabular-nums flex items-center gap-1">
                  <Clock size={10} />
                  {item.start} ~ {item.end}
                </span>
                {isIssue && (
                  <AlertTriangle size={11} className="text-rose-500 shrink-0" />
                )}
              </div>
              <p className={`text-[15px] font-bold leading-snug ${
                isDone ? 'line-through text-slate-400' : 'text-slate-900'
              }`}>
                {item.member && item.member !== '미배정' && (
                  <span className="text-blue-700 mr-1">{item.member}</span>
                )}
                {cleanTitle}
              </p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
              {(() => {
                const role = item.calendarRole || (item.calendarKey?.split(':')[0])
                const cat = role ? CATEGORY_BADGE[role] : null
                return cat ? (
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${cat.cls}`}>
                    {cat.label}
                  </span>
                ) : null
              })()}
              <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${style.badge}`}>
                {item.status}
              </span>
              <button
                onClick={() => onTap(item)}
                className="w-7 h-7 flex items-center justify-center rounded-full text-slate-300 hover:text-slate-600 hover:bg-slate-100 active:bg-slate-200 transition-colors"
              >
                <ChevronRight size={15} />
              </button>
            </div>
          </div>

          {/* 위치 / 연락처 */}
          <div className="space-y-1.5 mb-3">
            {item.location && (
              <button
                onClick={() => setNaviOpen(true)}
                className="flex items-center gap-1.5 text-xs text-slate-500 w-full text-left active:text-blue-600"
              >
                <MapPin size={11} className="shrink-0 text-slate-400" />
                <span className="truncate">{item.location}</span>
                <span className="shrink-0 text-[10px] text-slate-300 ml-auto">지도 ›</span>
              </button>
            )}
            {item.phone && (
              <button
                onClick={handleCall}
                className="flex items-center gap-1.5 text-xs text-slate-500 w-full text-left active:text-blue-600"
              >
                <Phone size={11} className="shrink-0 text-slate-400" />
                <span>{item.phone}</span>
              </button>
            )}
            {item.memo && (
              <div className={`text-xs px-2.5 py-1.5 rounded-xl ${
                isIssue ? 'bg-rose-50 text-rose-700' : 'bg-slate-50 text-slate-500'
              }`}>
                {item.memo}
              </div>
            )}
          </div>

          {/* 액션 버튼 — 완료/특이/미루기는 다시 누르면 토글되어 원복 */}
          <div className="flex gap-1.5">
            <ActionBtn label={isDone ? '완료 해제' : '완료'} onClick={() => onComplete(item)} color="emerald" active={isDone} />
            <ActionBtn label={item.originalDate && item.originalDate !== item.date ? '미루기 해제' : '미루기'} onClick={() => onPostpone(item)} color="violet" active={!!(item.originalDate && item.originalDate !== item.date)} />
            <ActionBtn label={isIssue ? '특이 해제' : '특이'} onClick={() => onIssue(item)} color="rose" active={isIssue} />
            <ActionBtn label="🗺 네비" onClick={() => setNaviOpen(true)} color="slate" />
          </div>
        </div>
      </motion.div>

      {/* 네비 앱 선택 시트 */}
      <NaviSheet
        open={naviOpen}
        onClose={() => setNaviOpen(false)}
        location={item.location}
      />
    </>
  )
}

function ActionBtn({ label, onClick, disabled, color, active }) {
  const colors = {
    emerald: active ? 'bg-emerald-500 text-white' : 'bg-emerald-50 text-emerald-700 active:bg-emerald-100',
    violet:  active ? 'bg-violet-500 text-white'  : 'bg-violet-50 text-violet-700 active:bg-violet-100',
    rose:    active ? 'bg-rose-500 text-white'    : 'bg-rose-50 text-rose-700 active:bg-rose-100',
    slate:   'bg-slate-100 text-slate-600 active:bg-slate-200',
  }
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex-1 h-9 rounded-xl text-xs font-semibold transition-all ${
        disabled ? 'opacity-30 cursor-not-allowed bg-slate-100 text-slate-400' : colors[color]
      }`}
    >
      {label}
    </button>
  )
}
