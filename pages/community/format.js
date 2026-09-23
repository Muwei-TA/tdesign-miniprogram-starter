/** 展示层格式化工具（纯函数，无副作用） */

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function pad(n) {
  return n < 10 ? `0${n}` : `${n}`;
}

/**
 * 相对时间文案：刚刚 / N 分钟前 / 今天 HH:mm / 昨天 HH:mm / M月D日 / YYYY年M月D日
 * 历史内容按真实日期呈现，不制造"当前活跃"的错觉。
 */
export function formatRelativeTime(input) {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return '';

  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;

  if (diff < MINUTE) return '刚刚';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} 分钟前`;

  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) return `今天 ${time}`;

  const yesterday = new Date(now.getTime() - DAY);
  if (date.toDateString() === yesterday.toDateString()) return `昨天 ${time}`;

  if (date.getFullYear() === now.getFullYear()) return `${date.getMonth() + 1}月${date.getDate()}日`;
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

/** 计数展示：超过 999 显示 999+，不制造夸张数字 */
export function formatCount(n) {
  const num = Number(n) || 0;
  if (num <= 0) return '';
  return num > 999 ? '999+' : `${num}`;
}

/** 摘要：按字符截断并补省略号，用于列表卡片（正文完整内容仍需详情页重新请求） */
export function excerpt(text = '', max = 120) {
  const clean = String(text).replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

/** 秒数转 mm:ss，用于视频时长胶囊 */
export function formatDuration(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
}

export default { formatRelativeTime, formatCount, excerpt, formatDuration };
