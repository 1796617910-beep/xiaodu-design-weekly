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
  trends: [
    '(阿里巴巴 OR 腾讯 OR 字节跳动 OR 美团 OR 百度 OR 小米 OR 华为) (设计团队 OR 设计系统 OR UI OR UX OR 品牌设计 OR 动效) when:7d',
    '(智能家居 OR IoT OR 智能屏 OR 家具设计 OR 产品设计) (UI OR UX OR 品牌 OR 交互 OR 设计) when:7d',
    '(Apple OR Google OR Amazon OR Samsung OR Microsoft) (design system OR product design OR brand identity OR UI OR UX) when:7d'
  ],
  competitors: [
    '(小爱同学 OR 小米智能家庭 OR 天猫精灵 OR 豆包硬件 OR 华为智慧屏) (发布 OR 新品 OR 升级 OR 交互) when:7d',
    '(Alexa OR Echo Show OR Google Nest Hub OR Samsung SmartThings OR Apple HomePod) (launch OR update OR display OR device) when:7d',
    '(智能屏 OR AI眼镜 OR AI音箱 OR 智能音箱 OR 家庭机器人 OR IoT硬件) (新品 OR 发布 OR 上市) when:7d'
  ]
};

const companies = [
  [/阿里|天猫|千问|夸克|Alibaba/i, '阿里巴巴'], [/腾讯|Tencent/i, '腾讯'], [/字节|豆包|ByteDance/i, '字节跳动'],
  [/美团|Meituan/i, '美团'], [/百度|小度|Baidu/i, '百度·小度'], [/小米|小爱|Xiaomi/i, '小米'],
  [/华为|HarmonyOS|Huawei/i, '华为'], [/Apple|HomePod|Siri/i, 'Apple'], [/Google|Gemini|Nest/i, 'Google'],
  [/Amazon|Alexa|Echo Show/i, 'Amazon'], [/Samsung|SmartThings/i, 'Samsung'], [/Microsoft/i, 'Microsoft'], [/OpenAI|ChatGPT/i, 'OpenAI']
];
const brandOf = x => companies.find(([re]) => re.test(x.title))?.[1] || x.source || '设计团队';
const articleTitle = x => x.title.replace(/\s[-–—]\s[^-–—]{1,40}$/, '').trim();
const coverFor = x => `https://api.microlink.io/?url=${encodeURIComponent(x.url)}&screenshot=true&meta=false&embed=screenshot.url`;
const relevance = (x, section) => {
  const s = `${x.title} ${x.source}`;
  let n = companies.some(([re]) => re.test(s)) ? 8 : 0;
  n += (s.match(/设计团队|设计系统|UI|UX|交互|品牌|动效|字体|智能家居|IoT|家具|智能屏/gi) || []).length * 2;
  if (section === 'competitors') n += (s.match(/新品|发布|上市|升级|硬件|音箱|眼镜|机器人|device|launch|display/gi) || []).length * 3;
  if (/评测|横评|导购|怎么选|哪个品牌好|推荐哪款|好用手机|排行榜|FAQ|投资|股价|债券|招聘|GEO|体坛|买球|彩票|kaiyun|jiuyou|超跑|时速/i.test(s)) return -100;
  return n;
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
  const brand = brandOf(x);
  const f = focus(x.title);
  const title = articleTitle(x);
  return { brand, title, overview: title, type: f === 'UX' ? 'UX / 使用体验' : 'UI / 视觉设计', focus: f,
    insight: f === 'UX' ? '设计关注点：家庭多人、远场语音与大屏场景中，检查信息层级、操作路径和反馈是否清晰，并评估儿童与老人的理解成本。' : '设计关注点：色彩、字体、图形、动效与品牌资产如何延展到智能屏、IoT 设备和运营活动，并保持远距离可读性。',
    published: x.published, url: x.url, event_key: `${brand}-${x.published}-${title.slice(0, 24)}`, images: [{ url: coverFor(x), caption: `${brand}相关文章页面封面`, source: x.url }] };
}

function competitorItem(x) {
  const brand = brandOf(x);
  const f = focus(x.title);
  const title = articleTitle(x);
  return { brand, title, overview: title, type: f === 'UX' ? 'UX / 硬件体验' : 'UI / 产品界面', focus: f,
    insight: '体验关注点：重点检查新硬件的屏幕形态、语音与触控协同、设备联动、家庭账号和隐私反馈；评估哪些能力可迁移到小度智能屏与 IoT 产品。',
    published: x.published, url: x.url, event_key: `${brand}-${x.published}-${title.slice(0, 20)}`, images: [{ url: coverFor(x), caption: `${brand}新品或更新文章封面`, source: x.url }] };
}

const results = {};
for (const [section, queries] of Object.entries(feeds)) results[section] = unique((await Promise.all(queries.map(search))).flat()).filter(x => relevance(x, section) >= (section === 'trends' ? 10 : 11)).sort((a,b) => relevance(b, section) - relevance(a, section) || b.published.localeCompare(a.published)).slice(0, 5);
if (!results.trends.length && !results.competitors.length) throw new Error('No verified items found for the previous week');

let issues = JSON.parse(await readFile('issues.json', 'utf8'));
issues = issues.filter(issue => issue.start !== iso(start));
issues.unshift({ start: iso(start), end: iso(end), generated_at: iso(now), sections: {
  trends: { summary: '优先关注国内互联网大厂设计团队，以及与小度智能屏、IoT、家居和运营品牌相关的 UI / UX 设计。', notice: '自动汇总前一周公开报道；国内大厂和小度相关性优先，国外大型品牌作为补充。设计关注点为编辑解读。', delivery: 'published', items: results.trends.map(trendItem) },
  competitors: { summary: '围绕小度的硬件与 IoT 竞品，追踪智能屏、音箱、家庭中控、AI 穿戴设备及大厂新品。', notice: '优先小米、天猫精灵、华为、豆包硬件、Amazon、Google、Samsung 与 Apple 的新硬件或重大体验升级；内容不足时不凑数。', delivery: 'published', items: results.competitors.map(competitorItem) }
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
