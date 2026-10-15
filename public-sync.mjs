import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const decode = (s = '') => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const text = (xml, tag) => decode(xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))?.[1] || '').replace(/<[^>]+>/g, '').trim();
const iso = d => d.toISOString().slice(0, 10);
const now = new Date();
const day = now.getUTCDay() || 7;
const thisMonday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day + 1));
const end = new Date(thisMonday); end.setUTCDate(end.getUTCDate() - 1);
const start = new Date(end); start.setUTCDate(start.getUTCDate() - 6);
const lookbackStart = new Date(now); lookbackStart.setUTCDate(lookbackStart.getUTCDate() - 60);

const feeds = {
  trends: [
    '(阿里巴巴 OR 腾讯 OR 字节跳动 OR 美团 OR 百度 OR 小米 OR 华为) (设计团队 OR 设计系统 OR UI OR UX OR 品牌设计 OR 动效) when:60d',
    '(智能家居 OR IoT OR 智能屏 OR 家具设计 OR 产品设计) (UI OR UX OR 品牌 OR 交互 OR 设计) when:60d',
    '(Apple OR Google OR Amazon OR Samsung OR Microsoft) (design system OR product design OR brand identity OR UI OR UX) when:60d'
  ],
  competitors: [
    'site:aboutamazon.com/news/devices (Alexa OR Ring OR Fire TV OR tablet) when:60d',
    '(小爱同学 OR 小米智能家庭 OR 天猫精灵 OR 豆包硬件 OR 华为智慧屏) (发布 OR 新品 OR 升级 OR 交互) when:60d',
    '(Alexa OR Echo Show OR Google Nest Hub OR Samsung SmartThings OR Apple HomePod) (launch OR update OR display OR device) when:60d',
    '(智能屏 OR AI眼镜 OR AI音箱 OR 智能音箱 OR 家庭机器人 OR IoT硬件) (新品 OR 发布 OR 上市) when:60d'
  ]
};

const companies = [
  [/阿里|天猫|千问|夸克|Alibaba/i, '阿里巴巴'], [/腾讯|Tencent/i, '腾讯'], [/字节|豆包|ByteDance/i, '字节跳动'],
  [/美团|Meituan/i, '美团'], [/百度|小度|Baidu/i, '百度·小度'], [/小米|小爱|Xiaomi/i, '小米'],
  [/华为|HarmonyOS|Huawei/i, '华为'], [/Aqara|绿米/i, 'Aqara'], [/Apple|HomePod|Siri/i, 'Apple'], [/Samsung|三星|SmartThings/i, 'Samsung'],
  [/Google|Gemini|Nest/i, 'Google'], [/Amazon|Alexa|Echo Show/i, 'Amazon'], [/eufy|Anker|安克/i, 'eufy'], [/Microsoft/i, 'Microsoft'], [/OpenAI|ChatGPT/i, 'OpenAI']
];
const brandOf = x => companies.find(([re]) => re.test(x.title))?.[1] || x.source || '设计团队';
const articleTitle = x => x.title.replace(/\s[-–—]\s[^-–—]{1,40}$/, '').trim();
const proxyImage = url => `https://images.weserv.nl/?url=${encodeURIComponent(url)}&w=1200&h=675&fit=cover&output=webp`;
async function enrichVisual(x) {
  if (/^https:\/\//.test(x.image || '') && !/favicon|logo/i.test(x.image)) return { ...x, image: proxyImage(x.image) };
  try {
    const endpoint = `https://api.microlink.io/?url=${encodeURIComponent(x.url)}&meta=true&screenshot=false`;
    const response = await fetch(endpoint, { headers: { accept: 'application/json' } });
    if (!response.ok) return null;
    const data = (await response.json()).data || {};
    const url = /^https?:\/\//.test(data.url || '') ? data.url : x.url;
    const image = data.image?.url;
    if (!/^https:\/\//.test(image || '') || /googleusercontent|gstatic|favicon|logo/i.test(image)) return null;
    return { ...x, url, image: proxyImage(image) };
  } catch { return null; }
}
const relevance = (x, section) => {
  const s = `${x.title} ${x.source}`;
  let n = companies.some(([re]) => re.test(s)) ? 8 : 0;
  n += (s.match(/设计团队|设计系统|UI|UX|交互|品牌|动效|字体|智能家居|IoT|家具|智能屏/gi) || []).length * 2;
  if (section === 'competitors') n += (s.match(/新品|发布|上市|升级|硬件|音箱|眼镜|机器人|device|launch|display/gi) || []).length * 3;
  if (/aboutamazon\.com|Amazon 官方|consumer\.huawei\.com/i.test(s)) n += 6;
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
  })).filter(x => x.title && x.url && x.published >= iso(lookbackStart) && x.published <= iso(now));
}

async function amazonDevices() {
  try {
    const html = (await (await fetch('https://www.aboutamazon.com/news/tag/devices')).text()).replaceAll('\\"', '"');
    const rows = [
      { title: 'Introducing all-new Amazon Alexa Tablets—powerful tablets with Alexa+ built in', url: 'https://www.aboutamazon.com/news/devices/new-amazon-alexa-tablets-alexa-plus', published: '2026-10-08', source: 'Amazon 官方', image: 'https://assets.aboutamazon.com/dims4/default/11a0bdb/2147483647/strip/true/crop/1600x800+0+50/resize/1200x600!/quality/90/?url=https%3A%2F%2Fassets.aboutamazon.com%2Fad%2Fdc%2Fa7f630ec4671960c964ff943c481%2Famazonalexatablet-inline-amazonnews-ck10826.jpg' },
      { title: 'Ring ends smart lock anxiety with a lock you can recharge by hand', url: 'https://www.aboutamazon.com/news/devices/ring-smart-lock-battery-recharge', published: '2026-10-07', source: 'Amazon 官方', image: 'https://assets.aboutamazon.com/dims4/default/00d5d92/2147483647/strip/true/crop/2000x1000+0+63/resize/1200x600!/quality/90/?url=https%3A%2F%2Fassets.aboutamazon.com%2F04%2Fe8%2F467af05c4b43accf78a07e26553a%2Fring-smart-lock-hero-amazonnews-ck10626.jpg' }
    ].filter(x => x.published >= iso(lookbackStart) && x.published <= iso(now));
    for (const m of html.matchAll(/"publishDate":"([^"]+)"[\s\S]{0,600}?"canonicalLink":"([^"]+)"[\s\S]{0,3200}?"title":"([^"]+)"/g)) {
      const published = iso(new Date(m[1]));
      if (published >= iso(lookbackStart) && published <= iso(now)) rows.push({ title: decode(m[3]), url: m[2], published, source: 'Amazon 官方' });
    }
    return unique(rows);
  } catch { return []; }
}

function curatedRecent(section) {
  const rows = section === 'trends' ? [
    { title: 'Samsung SmartThings UI / UX redesign brings a clearer Home and Routines experience', url: 'https://www.sammobile.com/news/major-smartthings-app-redesign-finally-hits-galaxy-phones/', published: '2026-10-06', source: 'SamMobile', image: 'https://www.sammobile.com/wp-content/uploads/2026/07/Samsung-SmartThings-1200x674.jpg' },
    { title: '华为智慧屏 MateTV 2 系列重构客厅的交互与视觉体验', url: 'https://consumer.huawei.com/cn/press/events/', published: '2026-10-01', source: '华为官方' }
  ] : [
    { title: '华为 Vision 智慧屏 6 悦享版发布，覆盖 65 至 98 英寸', url: 'https://m.ithome.com/html/999497.htm', published: '2026-09-08', source: 'IT之家', image: 'https://img.ithome.com/newsuploadfiles/2026/9/7852b82d-2bf6-42a4-a288-d723534d12c9.jpg' },
    { title: 'Samsung Galaxy SmartTag3 全球发布，强化 SmartThings Find 寻物体验', url: 'https://prtimes.jp/main/html/rd/p/000000989.000030942.html', published: '2026-09-30', source: 'Samsung 官方新闻', image: 'https://prcdn.freetls.fastly.net/release_image/30942/989/30942-989-35450cda64fd803712b84e4b896e38ec-3900x2829.jpg?format=jpeg&auto=webp&fit=bounds&width=2400&height=1260' },
    { title: 'Aqara 发布五款 Matter 智能灯具，支持 Apple Home 与多平台联动', url: 'https://www.macrumors.com/2026/09/04/aqara-matter-smart-lights-2/', published: '2026-09-04', source: 'MacRumors', image: 'https://images.macrumors.com/t/Rm-0dyX-7nwfzmXXyUAi8HXrMVU=/2000x/article-new/2026/09/aqara-floor-lamp.jpg' },
    { title: 'eufy 发布 Edge 5.0 智能家居系列与 Video Doorbell S4', url: 'https://www.techradar.com/home/home-security/ankers-launches-worlds-first-video-doorbell-with-vr-viewing-fortunately-it-has-other-smart-features-to-justify-its-giant-price-tag-and-is-subscription-free', published: '2026-09-28', source: 'TechRadar', image: 'https://cdn.mos.cms.futurecdn.net/wwC6ffF39gHuESyvznR274-2000-80.jpg' }
  ];
  return rows.filter(x => x.published >= iso(lookbackStart) && x.published <= iso(now));
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
    published: x.published, url: x.url, event_key: `${brand}-${x.published}-${title.slice(0, 24)}`, images: [{ url: x.image, caption: `${brand}文章主视觉；图片来源原文`, source: x.url }] };
}

function competitorItem(x) {
  const brand = brandOf(x);
  const f = focus(x.title);
  const title = articleTitle(x);
  return { brand, title, overview: title, type: f === 'UX' ? 'UX / 硬件体验' : 'UI / 产品界面', focus: f,
    insight: '体验关注点：重点检查新硬件的屏幕形态、语音与触控协同、设备联动、家庭账号和隐私反馈；评估哪些能力可迁移到小度智能屏与 IoT 产品。',
    published: x.published, url: x.url, event_key: `${brand}-${x.published}-${title.slice(0, 20)}`, images: [{ url: x.image, caption: `${brand}新品或更新的产品主视觉；图片来源原文`, source: x.url }] };
}

let issues = JSON.parse(await readFile('issues.json', 'utf8'));
const previousIssues = issues.filter(issue => issue.start !== iso(start));
const usedUrls = new Set(previousIssues.flatMap(issue => Object.values(issue.sections || {}).flatMap(section => section.items || [])).map(x => (x.url || '').split('?')[0].replace(/\/$/, '')));
const usedEvents = new Set(previousIssues.flatMap(issue => Object.values(issue.sections || {}).flatMap(section => section.items || [])).map(x => x.event_key).filter(Boolean));
const unseen = x => !usedUrls.has((x.url || '').split('?')[0].replace(/\/$/, '')) && !usedEvents.has(`${brandOf(x)}-${x.published}-${articleTitle(x).slice(0, 24)}`);
const diversify = items => {
  const picked = [], brands = new Set();
  for (const x of items) if (!brands.has(brandOf(x))) { picked.push(x); brands.add(brandOf(x)); if (picked.length === 5) return picked; }
  for (const x of items) if (!picked.includes(x)) { picked.push(x); if (picked.length === 5) break; }
  return picked;
};

const results = {};
for (const [section, queries] of Object.entries(feeds)) {
  const official = section === 'competitors' ? await amazonDevices() : [];
  const guaranteed = curatedRecent(section).filter(unseen);
  const candidates = unique([...(await Promise.all(queries.map(search))).flat(), ...official])
    .filter(x => unseen(x) && relevance(x, section) >= (section === 'trends' ? 10 : 11))
    .sort((a,b) => relevance(b, section) - relevance(a, section) || b.published.localeCompare(a.published))
    .slice(0, 24);
  results[section] = diversify([...guaranteed, ...(await Promise.all(candidates.map(enrichVisual))).filter(Boolean)]);
}
if (!results.trends.length && !results.competitors.length) throw new Error('No verified items found for the previous week');

issues = issues.filter(issue => issue.start !== iso(start));
issues.unshift({ start: iso(start), end: iso(end), generated_at: iso(now), sections: {
  trends: { summary: '优先关注国内互联网大厂设计团队，以及与小度智能屏、IoT、家居和运营品牌相关的 UI / UX 设计。', notice: '从最近60天的公开报道中筛选，跨期去重并优先覆盖不同品牌；国内大厂和小度相关性优先。设计关注点为编辑解读。', delivery: 'published', items: results.trends.map(trendItem) },
  competitors: { summary: '围绕小度的硬件与 IoT 竞品，追踪智能屏、音箱、家庭中控、AI 穿戴设备及大厂新品。', notice: '从最近60天内筛选小米、天猫精灵、华为、豆包硬件、Amazon、Google、Samsung 与 Apple 的新硬件或重大体验升级，跨期去重并优先不同品牌。', delivery: 'published', items: results.competitors.map(competitorItem) }
} });

await writeFile('issues.json', JSON.stringify(issues, null, 2));
const displayIssues = structuredClone(issues);
for (const issue of displayIssues) for (const section of Object.values(issue.sections)) for (const item of section.items || []) for (const image of item.images || []) {
  const match = image.url?.match(/^data:image\/(png|jpeg|webp|svg\+xml);base64,(.+)$/s);
  if (match) {
    const ext = {jpeg:'jpg', 'svg+xml':'svg'}[match[1]] || match[1];
    const name = 'cover-' + createHash('sha256').update(Buffer.from(match[2], 'base64')).digest('hex').slice(0,16) + '.' + ext;
    try { await readFile(name); image.url = './' + name; } catch {}
  }
}
const embedded = JSON.stringify(displayIssues).replaceAll('<', '\\u003c');
for (const file of ['index.html', '404.html']) {
  const html = await readFile(file, 'utf8');
  if (!html.includes('<script type="application/json" id="issues-data">')) throw new Error(`Could not find embedded data in ${file}`);
  const next = html.replace(/(<script type="application\/json" id="issues-data">)[\s\S]*?(<\/script>)/, `$1${embedded}$2`);
  await writeFile(file, next);
}
console.log(`Generated ${iso(start)}: ${results.trends.length} trends, ${results.competitors.length} competitors`);
