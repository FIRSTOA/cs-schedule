import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { useStore } from '@/store/useStore.jsx'
import NaviSheet from '@/components/NaviSheet'
import dayjs from 'dayjs'

const STATUSES = ['예정', '진행중', '완료', '익일', '특이']
const TEAMS = ['A', 'B', 'C', 'D']

// ── 캘린더 선택지 ────────────────────────────────────────────────────────────
// teamAS / teamReport는 팀별 분리되므로 calendarKey = `${role}:${team}`로 결정.
// pool / ops는 단일 캘린더 (팀 무관) — 팀은 시간 슬롯 결정용.
const CALENDAR_OPTIONS = [
  { value: 'teamAS',     label: 'A/S',      desc: '팀별 활성 작업', needsTeam: true  },
  { value: 'pool',       label: '익일통합', desc: '접수 풀',        needsTeam: false },
  { value: 'teamReport', label: '점검/마감', desc: '팀별 점검',      needsTeam: true  },
  { value: 'ops',        label: '납품/운영', desc: '전사 운영',      needsTeam: false },
]

// ── 팀별 고정 시간 (회사 룰) ──────────────────────────────────────────────────
export const TEAM_TIME = {
  A: { start: '09:00', end: '09:30', label: 'A팀', sub: '오전 9시' },
  B: { start: '12:00', end: '12:30', label: 'B팀', sub: '오후 12시' },
  C: { start: '15:00', end: '15:30', label: 'C팀', sub: '오후 3시' },
  D: { start: '18:00', end: '18:30', label: 'D팀', sub: '오후 6시' },
}

function buildTitle(member, rawTitle) {
  const stripped = rawTitle.replace(/^.+?\s*\/\s*/, '').trim()
  if (!member || member === '미배정') return stripped || rawTitle
  return `${member} / ${stripped || rawTitle}`
}

export default function ScheduleForm({ item, onSave, onDelete, onClose }) {
  const { state } = useStore()
  const isNew = !item?.id

  // 팀 결정: 기존 아이템이면 그 팀, 신규면 'A'
  const initTeam = item?.team || 'A'
  const initTime = TEAM_TIME[initTeam]
  // 캘린더 결정: 기존 아이템이면 그 role, 신규면 'teamAS' (A/S 기본)
  const initCalendarRole = item?.calendarRole || 'teamAS'

  const [form, setForm] = useState({
    team: initTeam,
    calendarRole: initCalendarRole,
    member: '미배정',
    rawTitle: '',
    date: dayjs().format('YYYY-MM-DD'),
    start: initTime.start,
    end: initTime.end,
    location: '',
    phone: '',
    status: '예정',
    memo: '',
    googleEventId: null,
    ...item,
    calendarRole: initCalendarRole,
    // 기존 아이템이면 rawTitle 추출, 신규면 빈 문자열
    rawTitle: item?.title ? item.title.replace(/^.+?\s*\/\s*/, '').trim() : '',
    // 기존 아이템이면 시간 유지, 신규면 팀 고정 시간
    start: item?.start || initTime.start,
    end: item?.end || initTime.end,
  })

  const [naviOpen, setNaviOpen] = useState(false)

  const members = state.members[form.team] || ['미배정']

  // 팀 변경 시 → 멤버 초기화 + 시간 자동 변경
  const handleTeamChange = (team) => {
    const teamMembers = state.members[team] || ['미배정']
    const time = TEAM_TIME[team]
    setForm(f => ({
      ...f,
      team,
      member: teamMembers[0] || '미배정',
      start: time.start,
      end: time.end,
    }))
  }

  const handleSave = () => {
    if (!form.rawTitle.trim()) {
      alert('업무 내용을 입력해주세요.')
      return
    }
    const title = buildTitle(form.member, form.rawTitle)
    // calendarKey 빌드: teamAS/teamReport는 팀별, pool/ops는 단일
    const opt = CALENDAR_OPTIONS.find(o => o.value === form.calendarRole)
    const calendarKey = opt?.needsTeam ? `${form.calendarRole}:${form.team}` : form.calendarRole
    onSave({ ...form, title, calendarKey, calendarRole: form.calendarRole })
  }

  const set = (key) => (e) => setForm(f => ({ ...f, [key]: e.target.value }))

  const currentCalOpt = CALENDAR_OPTIONS.find(o => o.value === form.calendarRole) || CALENDAR_OPTIONS[0]

  return (
    <div className="px-5 py-4 space-y-4 pb-8">

      {/* 캘린더 선택 */}
      <div>
        <label className="block text-xs font-semibold text-slate-500 mb-2">캘린더</label>
        <div className="grid grid-cols-4 gap-1.5 p-1 bg-slate-100 rounded-xl">
          {CALENDAR_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setForm(f => ({ ...f, calendarRole: opt.value }))}
              className={`py-2 rounded-lg text-center transition-all ${
                form.calendarRole === opt.value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
              }`}
            >
              <p className="text-xs font-bold">{opt.label}</p>
              <p className="text-[10px] font-medium mt-0.5 opacity-70">{opt.desc}</p>
            </button>
          ))}
        </div>
        {!currentCalOpt.needsTeam && (
          <p className="mt-1.5 text-[11px] text-slate-400">
            ※ 이 캘린더는 팀과 무관 — 아래 팀 선택은 시간 슬롯만 결정합니다.
          </p>
        )}
      </div>

      {/* 팀 선택 */}
      <div>
        <label className="block text-xs font-semibold text-slate-500 mb-2">팀 (시간 자동 설정)</label>
        <div className="grid grid-cols-4 gap-1.5 p-1 bg-slate-100 rounded-xl">
          {TEAMS.map(t => {
            const tt = TEAM_TIME[t]
            return (
              <button
                key={t}
                onClick={() => handleTeamChange(t)}
                className={`py-2.5 rounded-lg text-center transition-all ${
                  form.team === t ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
                }`}
              >
                <p className="text-xs font-bold">{tt.label}</p>
                <p className="text-[10px] font-medium mt-0.5 opacity-70">{tt.sub}</p>
              </button>
            )
          })}
        </div>
        {/* 시간 표시 (읽기 전용) */}
        <div className="mt-2 flex items-center gap-2 px-3 py-2 bg-slate-50 rounded-xl border border-slate-100">
          <span className="text-xs text-slate-400">고정 시간</span>
          <span className="text-xs font-semibold text-slate-700 ml-auto">
            {TEAM_TIME[form.team].start} ~ {TEAM_TIME[form.team].end}
          </span>
        </div>
      </div>

      {/* 담당자 */}
      <div>
        <label className="block text-xs font-semibold text-slate-500 mb-1.5">담당자</label>
        <select
          value={form.member}
          onChange={set('member')}
          className="w-full h-11 px-3 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/20"
        >
          {members.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>

      {/* 업무 내용 */}
      <div>
        <label className="block text-xs font-semibold text-slate-500 mb-1.5">업무 내용</label>
        <input
          value={form.rawTitle}
          onChange={set('rawTitle')}
          placeholder="예: 강남 고객사 정기 점검"
          className="w-full h-11 px-3 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/20"
        />
        {form.member && form.member !== '미배정' && form.rawTitle && (
          <p className="mt-1 text-xs text-slate-400">
            저장 제목: <span className="text-slate-600 font-medium">{form.member} / {form.rawTitle}</span>
          </p>
        )}
      </div>

      {/* 상태 */}
      <div>
        <label className="block text-xs font-semibold text-slate-500 mb-1.5">상태</label>
        <div className="flex gap-1.5 flex-wrap">
          {STATUSES.map(s => (
            <button
              key={s}
              onClick={() => setForm(f => ({ ...f, status: s }))}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
                form.status === s
                  ? s === '예정'   ? 'bg-blue-600 text-white border-blue-600'
                  : s === '진행중' ? 'bg-amber-500 text-white border-amber-500'
                  : s === '완료'   ? 'bg-emerald-600 text-white border-emerald-600'
                  : s === '익일'   ? 'bg-violet-600 text-white border-violet-600'
                  :                  'bg-rose-600 text-white border-rose-600'
                  : 'bg-slate-50 text-slate-500 border-slate-200'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* 날짜 */}
      <div>
        <label className="block text-xs font-semibold text-slate-500 mb-1.5">날짜</label>
        <input
          type="date"
          value={form.date}
          onChange={set('date')}
          className="w-full h-11 px-3 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/20"
        />
      </div>

      {/* 주소 */}
      <div>
        <label className="block text-xs font-semibold text-slate-500 mb-1.5">주소</label>
        <div className="flex gap-2">
          <input
            value={form.location}
            onChange={set('location')}
            placeholder="서울 강남구 테헤란로 10"
            className="flex-1 h-11 px-3 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/20"
          />
          {form.location && (
            <button
              onClick={() => setNaviOpen(true)}
              className="h-11 px-3 bg-slate-100 rounded-xl text-xs font-semibold text-slate-600 active:bg-slate-200 shrink-0"
            >
              🗺 지도
            </button>
          )}
        </div>
      </div>

      {/* 연락처 */}
      <div>
        <label className="block text-xs font-semibold text-slate-500 mb-1.5">연락처</label>
        <input
          type="tel"
          value={form.phone}
          onChange={set('phone')}
          placeholder="010-0000-0000"
          className="w-full h-11 px-3 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/20"
        />
      </div>

      {/* 메모 */}
      <div>
        <label className="block text-xs font-semibold text-slate-500 mb-1.5">메모</label>
        <textarea
          value={form.memo}
          onChange={set('memo')}
          rows={3}
          placeholder="특이사항, 참고 내용..."
          className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 resize-none focus:outline-none focus:ring-2 focus:ring-slate-900/20"
        />
      </div>

      {/* 저장 버튼 */}
      <button
        onClick={handleSave}
        className="w-full h-12 bg-slate-900 text-white rounded-xl font-semibold text-sm active:bg-slate-800 transition-colors"
      >
        {isNew ? '일정 추가' : '저장하기'}
      </button>

      {/* 삭제 버튼 */}
      {!isNew && (
        <button
          onClick={() => onDelete(item.id)}
          className="w-full h-10 flex items-center justify-center gap-1.5 text-rose-500 text-sm font-medium active:text-rose-700"
        >
          <Trash2 size={14} />
          일정 삭제
        </button>
      )}

      {/* 네비 앱 선택 시트 */}
      <NaviSheet
        open={naviOpen}
        onClose={() => setNaviOpen(false)}
        location={form.location}
      />
    </div>
  )
}
