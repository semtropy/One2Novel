import { useNovelStatistics, useDailyOutput, useQualityTrend, usePayoffStats } from "../../api/novel";

interface Props {
  novelId: string;
  onClose: () => void;
}

export default function StatisticsDashboard({ novelId, onClose }: Props) {
  const stats = useNovelStatistics(novelId);
  const daily = useDailyOutput(novelId, 30);
  const quality = useQualityTrend(novelId);
  const payoffs = usePayoffStats(novelId);

  const s = stats.data;
  const maxDaily = Math.max(1, ...(daily.data ?? []).map(d => d.chars));
  const maxScore = Math.max(1, ...(quality.data ?? []).map(q => q.totalScore), 80);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl p-6 max-h-[90vh] overflow-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">写作统计</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>

        {stats.isLoading && <div className="text-center py-8 text-gray-400">加载中...</div>}

        {s && (
          <>
            {/* Overview cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
              <StatCard label="总字数" value={`${(s.totalChars / 1000).toFixed(1)}k`} />
              <StatCard label="章节" value={`${s.completedChapters}/${s.totalChapters}`} />
              <StatCard label="质量均分" value={s.avgQualityScore.toFixed(0)} />
              <StatCard label="预计阅读" value={`${s.estimatedReadingMinutes}min`} />
            </div>

            {/* Daily output chart */}
            {daily.data && daily.data.length > 0 && (
              <div className="mb-5">
                <h3 className="text-sm font-medium text-gray-600 mb-2">每日产出（近 30 天）</h3>
                <div className="flex items-end gap-0.5 h-20 bg-slate-50 rounded-lg p-2">
                  {daily.data.map((d, i) => (
                    <div
                      key={i}
                      className="flex-1 bg-amber-400 hover:bg-amber-500 rounded-t transition-colors relative group"
                      style={{ height: `${Math.max(4, (d.chars / maxDaily) * 100)}%` }}
                    >
                      <div className="absolute -top-5 left-1/2 -translate-x-1/2 text-[10px] text-gray-400 opacity-0 group-hover:opacity-100 whitespace-nowrap">
                        {d.date.slice(5)}: {(d.chars / 1000).toFixed(1)}k
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Quality trend */}
            {quality.data && quality.data.length > 0 && (
              <div className="mb-5">
                <h3 className="text-sm font-medium text-gray-600 mb-2">质量趋势</h3>
                <div className="flex items-end gap-0.5 h-16 bg-slate-50 rounded-lg p-2">
                  {quality.data.map((q, i) => {
                    const pct = Math.max(8, (q.totalScore / maxScore) * 100);
                    const color = q.totalScore >= 52 ? "bg-green-400" : q.totalScore >= 42 ? "bg-amber-400" : "bg-red-400";
                    return (
                      <div
                        key={i}
                        className={`flex-1 ${color} hover:opacity-80 rounded-t transition-opacity relative group`}
                        style={{ height: `${pct}%` }}
                      >
                        <div className="absolute -top-5 left-1/2 -translate-x-1/2 text-[10px] text-gray-400 opacity-0 group-hover:opacity-100 whitespace-nowrap">
                          Ch{q.chapterOrder}: {q.totalScore}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Payoff completion */}
            {payoffs.data && payoffs.data.total > 0 && (
              <div className="mb-5">
                <h3 className="text-sm font-medium text-gray-600 mb-2">
                  伏笔兑现 · {payoffs.data.completionRate}%
                </h3>
                <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-green-500 rounded-full transition-all"
                    style={{ width: `${payoffs.data.completionRate}%` }}
                  />
                </div>
                <div className="flex justify-between text-xs text-gray-400 mt-1">
                  <span>已兑现 {payoffs.data.paidOff}</span>
                  <span>待兑现 {payoffs.data.setup + payoffs.data.hinted + payoffs.data.pendingPayoff}</span>
                </div>
              </div>
            )}

            {/* Detail rows */}
            <div className="grid grid-cols-2 gap-2 text-sm border-t pt-3">
              <DetailRow label="平均每章字数" value={`${s.avgCharsPerChapter.toLocaleString()} 字`} />
              <DetailRow label="总角色数" value={`${s.totalCharacters}`} />
              <DetailRow label="已设置伏笔" value={`${s.payoffSetupCount}`} />
              <DetailRow label="已兑现伏笔" value={`${s.payoffPaidCount}`} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-3 bg-slate-50 rounded-lg text-center">
      <div className="text-lg font-bold text-slate-800">{value}</div>
      <div className="text-xs text-gray-500">{label}</div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between py-1">
      <span className="text-gray-500">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
