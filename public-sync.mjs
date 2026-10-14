import { readFile, writeFile } from 'node:fs/promises';

const decode = (s = '') => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const text = (xml, tag) => decode(xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))?.[1] || '').replace(/<[^>]+>/g, '').trim();
const iso = d => d.toISOString().slice(0, 10);
const now = new Date();
const day = now.getUTCDay() || 7;
const thisMonday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day + 1));
const end = new Date(thisMonday); end.setUTCDate(end.getUTCDate() - 1);
const start = new Date(end); start.setUTCDate(start.getUTCDate() - 6);

const feeds = {
  trends: ['design identity OR UI OR UX OR typography OR motion design when:7d', '品牌设计 OR UI设计 OR UX体验 OR 字体设计 OR 动效 when:7d'],
  competitors: ['(Alexa OR Gemini OR Google Nest OR Siri OR ChatGPT OR 小爱同学 OR 天猫精灵 OR 豆包) (update OR design OR interface OR experience OR 更新 OR 交互) when:7d']
};

async function search(query) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=zh-CN&gl=CN&ceid=CN:zh-Hans`;
  const response = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 weekly-design-observer' } });
  if (!response.ok) throw new Error(`RSS ${response.status}: ${query}`);
  const xml = await response.text();
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map(([, item]) => ({
    title: text(item, 'title'), url: text(item, 'link'), published: iso(new Date(text(item, 'pubDate'))), source: text(item, 'source') || '公开新闻源'
  })).filter(x => x.title && x.url && x.published >= iso(start) && x.published <= iso(end));
}

function unique(items) {
  const seen = new Set();
  return items.filter(x => {
    const key = x.title.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '').slice(0, 72);
    if (!key || seen.has(key)) return false;
    seen.add(key); return true;
  });
}
const focus = title => /UX|experience|interaction|体验|交互|功能|更新/i.test(title) ? 'UX' : 'UI';

function trendItem(x) {
  const brand = x.title.split(/\s[-–—|]​?\s/)[0].slice(0, 42);
  const f = focus(x.title);
  return { brand, overview: x.title, type: f === 'UX' ? 'UX / 使用体验' : 'UI / 视觉设计', focus: f,
    insight: f === 'UX' ? '关注信息层级、操作路径与反馈是否降低用户理解成本；可结合小度真实场景进一步验证。' : '关注色彩、字体、图形与动效如何形成可识别的视觉系统；可评估在智能屏上的可读性。',
    published: x.published, url: x.url, event_key: `${brand}-${x.published}`, images: [] };
}

function competitorItem(x) {
  const brand = x.title.match(/Alexa|Gemini|Google Nest|Siri|ChatGPT|小爱同学|小爱|天猫精灵|豆包/i)?.[0] || x.source;
  const f = focus(x.title);
  return { brand, overview: x.title, type: f === 'UX' ? 'UX / 体验变化' : 'UI / 界面视觉', focus: f,
    insight: '体验解读：关注该更新对任务效率、多模态反馈和学习成本的影响；小度可在对应场景中进行可用性验证。此段为设计解读，标题与日期来自原始报道。',
    published: x.published, url: x.url, event_key: `${brand}-${x.published}-${x.title.slice(0, 20)}`, images: [] };
}

const results = {};
for (const [section, queries] of Object.entries(feeds)) results[section] = unique((await Promise.all(queries.map(search))).flat()).slice(0, 5);
if (!results.trends.length && !results.competitors.length) throw new Error('No verified items found for the previous week');

let issues = JSON.parse(await readFile('issues.json', 'utf8'));
issues = issues.filter(issue => issue.start !== iso(start));
issues.unshift({ start: iso(start), end: iso(end), generated_at: iso(now), sections: {
  trends: { summary: '本周设计趋势：从公开来源筛选最新 UI、UX、品牌、字体与动效案例。', notice: '自动汇总前一周公开报道；标题、日期与链接来自原始来源，设计关注点为编辑解读。', delivery: 'published', items: results.trends.map(trendItem) },
  competitors: { summary: '本周竞品追踪：关注智能助手与 AI 产品的交互和界面变化。', notice: '自动汇总前一周公开报道，已按标题去重；体验启发为设计解读。内容不足时不凑数。', delivery: 'published', items: results.competitors.map(competitorItem) }
} });

await writeFile('issues.json', JSON.stringify(issues, null, 2));
const embedded = JSON.stringify(issues).replaceAll('<', '\\u003c');
for (const file of ['index.html', '404.html']) {
  const html = await readFile(file, 'utf8');
  const next = html.replace(/(<script type="application\/json" id="issues-data">)[\s\S]*?(<\/script>)/, `$1${embedded}$2`);
  if (next === html) throw new Error(`Could not update embedded data in ${file}`);
  await writeFile(file, next);
}
console.log(`Generated ${iso(start)}: ${results.trends.length} trends, ${results.competitors.length} competitors`);
