import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { DailyPoint } from './review'

const decimal = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 })

export function formatMetric(value: number | null, metric: 'views' | 'impressions' | 'ctr' | 'revenue') {
  if (value === null) return '—'
  const formatted = decimal.format(value)
  return metric === 'ctr' ? formatted + '%' : metric === 'revenue' ? formatted + ' 元' : formatted
}

function Trend({ points, title, metric, color }: {
  points: DailyPoint[]
  title: string
  metric: 'views' | 'ctr'
  color: string
}) {
  const available = points.some(point => point[metric] !== null)

  return (
    <section className="metric-trend">
      <h3>{title}</h3>
      {available ? (
        <div className="metric-chart">
          <ResponsiveContainer width="100%" height={215} minWidth={0} initialDimension={{ width: 420, height: 215 }}>
            <LineChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="#e7e9f0" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="day" tickFormatter={(day: string) => day.slice(5)} minTickGap={18} tick={{ fontSize: 11 }} />
              <YAxis width={47} domain={[0, 'auto']} allowDecimals={metric === 'ctr'}
                tick={{ fontSize: 11 }} tickFormatter={(value: number) => formatMetric(value, metric)} />
              <Tooltip labelFormatter={day => String(day)}
                formatter={value => typeof value === 'number' ? formatMetric(value, metric) : '—'} />
              <Line type="linear" dataKey={metric} name={metric === 'views' ? '新增阅读量' : '加权 CTR'}
                stroke={color} strokeWidth={2} connectNulls={false} dot={{ r: 2.7 }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : <div className="metric-chart metric-chart-empty">这个周期暂无可比较数据</div>}
    </section>
  )
}

export function MetricTrends({ points }: { points: DailyPoint[] }) {
  return (
    <>
      <div className="metric-trends">
        <Trend points={points} title="阅读量趋势" metric="views" color="#5344c2" />
        <Trend points={points} title="CTR 趋势" metric="ctr" color="#176c6b" />
      </div>
      <details className="metric-daily">
        <summary>查看逐日数据</summary>
        <div className="source-table-wrap" tabIndex={0} role="region" aria-label="逐日数据区">
          <table className="source-table metric-data-table" aria-label="逐日运营数据">
            <thead>
              <tr>
                <th scope="col">日期（UTC+8）</th><th scope="col">新增展现量</th><th scope="col">新增阅读量</th>
                <th scope="col">加权 CTR</th><th scope="col">单日收益</th>
              </tr>
            </thead>
            <tbody>
              {points.map(point => (
                <tr key={point.day}>
                  <th scope="row">{point.day}</th>
                  <td>{formatMetric(point.impressions, 'impressions')}</td>
                  <td>{formatMetric(point.views, 'views')}</td>
                  <td>{formatMetric(point.ctr, 'ctr')}</td>
                  <td>{formatMetric(point.revenue, 'revenue')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  )
}
