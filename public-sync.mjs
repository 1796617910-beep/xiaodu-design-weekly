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
    '(腾讯ISUX OR 腾讯CDC OR 腾讯设计 OR 阿里巴巴设计 OR 阿里UED OR 小米设计) (设计 OR 交互 OR 品牌 OR 字体 OR 动效) when:60d',
    '(site:isux.tencent.com OR site:cdc.tencent.com OR site:alibabadesign.com OR site:ux.ant.design) when:60d',
    '(site:developer.apple.com/design OR site:design.google OR site:microsoft.design) (design OR interaction OR typography OR motion) when:60d',
    '(小米 OR 腾讯 OR 阿里巴巴 OR Apple) (设计团队 OR 设计复盘 OR 设计系统 OR 品牌设计 OR 交互设计) when:60d',
    '(site:uisdc.com OR site:zcool.com.cn OR site:ui.cn) (小米 OR 腾讯 OR 阿里 OR 苹果 OR UI OR 品牌 OR 交互) when:60d'
  ],
  competitors: [
    '(小米 OR 小爱 OR 天猫精灵 OR 华为) (智能屏 OR 智慧屏 OR 带屏音箱 OR 智能音箱 OR 家庭中控) (发布 OR 新品 OR 升级) when:60d',
    '(Echo Show OR Nest Hub OR Google Home Speaker OR HomePod) (launch OR update OR new OR release) when:60d',
    '(site:aboutamazon.com/news/devices OR site:blog.google OR site:consumer.huawei.com) (智能屏 OR speaker OR Echo OR Nest OR display OR home) when:60d',
    '(Aqara OR Samsung SmartThings OR 小米 OR 华为 OR 天猫精灵) (IoT OR 全屋智能 OR 中控屏 OR Matter OR 家庭机器人) (发布 OR 新品 OR 升级) when:60d',
    '(豆包硬件 OR 千问眼镜 OR AI学习机 OR 家庭陪伴机器人) (发布 OR 新品 OR 升级) when:60d'
  ]
};

const companies = [
  [/阿里|天猫|千问|夸克|Alibaba/i, '阿里巴巴'], [/腾讯|Tencent/i, '腾讯'], [/字节|豆包|ByteDance/i, '字节跳动'],
  [/美团|Meituan/i, '美团'], [/百度|小度|Baidu/i, '百度·小度'], [/小米|小爱|Xiaomi/i, '小米'],
  [/华为|HarmonyOS|Huawei/i, '华为'], [/Aqara|绿米/i, 'Aqara'], [/Apple|HomePod|Siri/i, 'Apple'], [/Samsung|三星|SmartThings/i, 'Samsung'],
  [/Google|Gemini|Nest/i, 'Google'], [/Amazon|Alexa|Echo Show/i, 'Amazon'], [/eufy|Anker|安克/i, 'eufy'], [/Microsoft/i, 'Microsoft'], [/OpenAI|ChatGPT/i, 'OpenAI']
];
const brandOf = x => x.brand || companies.find(([re]) => re.test(x.title))?.[1] || x.source || '设计团队';
const articleTitle = x => x.title.replace(/\s[-–—]\s[^-–—]{1,40}$/, '').trim();
const proxyImage = url => `https://images.weserv.nl/?url=${encodeURIComponent(url)}&w=1200&h=675&fit=cover&output=webp`;
async function chineseOverview(x) {
  if (/[\u4e00-\u9fff]/.test(x.title)) return x;
  try {
    const endpoint = 'https://api.mymemory.translated.net/get?q='+encodeURIComponent(articleTitle(x))+'&langpair=en%7Czh-CN';
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(12000) });
    if (!response.ok) return null;
    const data = await response.json();
    const translated = decode(data.responseData?.translatedText || '').trim();
    if (data.responseStatus !== 200 || !/[\u4e00-\u9fff]/.test(translated)) return null;
    return { ...x, original_title: x.title, brand: brandOf(x), title: translated };
  } catch { return null; }
}

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
// Source priority and direct hardware relevance precede recency and brand diversity.
const designTopic = /设计团队|设计复盘|设计系统|界面设计|交互设计|视觉设计|品牌设计|字体|动效|排版|UI|UX|design|typograph|motion|identity|rebrand/i;
const hardwareTopic = /智能屏|智慧屏|中控屏|带屏音箱|智能音箱|音箱|全屋智能|家庭机器人|学习机|IoT|Matter|Echo|Nest|HomePod|SmartThings|speaker|smart display|smart home|doorbell|智能门锁|智能灯|AI眼镜|千问眼镜/i;
const directCompetitor = /小米|小爱|天猫精灵|华为|Xiaomi|Huawei|Alexa|Amazon|Echo|Google|Nest|HomePod|Apple|苹果|Samsung|三星|Aqara|绿米/i;
const sourcePriority = (x, section) => {
  const text = [x.title,x.source,x.url].join(' ');
  if (section === 'trends') {
    if (/腾讯ISUX|腾讯CDC|阿里UED|小米设计|阿里巴巴设计|腾讯设计|isux.tencent.com|cdc.tencent.com|alibabadesign.com|ux.ant.design|developer.apple.com.*design|design.google|microsoft.design/i.test(text)) return 0;
    if (/设计团队|设计复盘|design team/i.test(text) && /小米|腾讯|阿里|Apple|苹果|Huawei|华为|Microsoft|Google/i.test(text)) return 0;
    if (/优设|uisdc.com|站酷|zcool|UI中国|ui.cn|It's Nice That|itsnicethat|Abduzeedo|Creative Boom|creativeboom/i.test(text)) return 1;
    return 2;
  }
  if (directCompetitor.test(text) && /智能屏|智慧屏|中控屏|带屏音箱|智能音箱|音箱|Echo Show|Nest Hub|HomePod|speaker|smart display/i.test(text)) return 0;
  if (directCompetitor.test(text) && hardwareTopic.test(text)) return 1;
  if (hardwareTopic.test(text)) return 2;
  return 3;
};
const relevance = (x, section) => {
  const text = [x.title,x.source,x.url].join(' ');
  if (/导购|怎么选|哪个品牌好|推荐哪款|好用手机|排行榜|投资|股价|债券|招聘|GEO|买球|彩票|kaiyun|jiuyou/i.test(text)) return -100;
  if (section === 'trends' && !designTopic.test(x.title)) return -100;
  if (section === 'competitors' && !hardwareTopic.test(x.title)) return -100;
  let score = section === 'trends' ? 12 : 14;
  if (/小米|腾讯|阿里巴巴|阿里UED|Apple|苹果/i.test(text)) score += 8;
  if (/智能屏|音箱|家庭|IoT|UI|UX|品牌|字体|交互|动效/i.test(x.title)) score += 5;
  if (section === 'competitors' && /发布|新品|上市|升级|launch|update|release/i.test(x.title)) score += 5;
  return score;
};
const compareCandidates = section => (a,b) => sourcePriority(a,section)-sourcePriority(b,section) || relevance(b,section)-relevance(a,section) || b.published.localeCompare(a.published);

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
    const rows = [];
    for (const m of html.matchAll(/"publishDate":"([^"]+)"[\s\S]{0,600}?"canonicalLink":"([^"]+)"[\s\S]{0,3200}?"title":"([^"]+)"/g)) {
      const published = iso(new Date(m[1]));
      if (published >= iso(lookbackStart) && published <= iso(now)) rows.push({ title: decode(m[3]), url: m[2], published, source: 'Amazon 官方' });
    }
    return unique(rows);
  } catch { return []; }
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
  return { brand, title, overview: title, ...(x.original_title ? {original_title:x.original_title} : {}), type: f === 'UX' ? 'UX / 使用体验' : 'UI / 视觉设计', focus: f,
    insight: f === 'UX' ? '设计关注点：家庭多人、远场语音与大屏场景中，检查信息层级、操作路径和反馈是否清晰，并评估儿童与老人的理解成本。' : '设计关注点：色彩、字体、图形、动效与品牌资产如何延展到智能屏、IoT 设备和运营活动，并保持远距离可读性。',
    published: x.published, url: x.url, event_key: `${brand}-${x.published}-${title.slice(0, 24)}`, images: [{ url: x.image, caption: `${brand}文章主视觉；图片来源原文`, source: x.url }] };
}

function competitorItem(x) {
  const brand = brandOf(x);
  const f = focus(x.title);
  const title = articleTitle(x);
  return { brand, title, overview: title, ...(x.original_title ? {original_title:x.original_title} : {}), type: f === 'UX' ? 'UX / 硬件体验' : 'UI / 产品界面', focus: f,
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
  const candidates = unique([...(await Promise.all(queries.map(search))).flat(), ...official])
    .filter(x => unseen(x) && relevance(x, section) >= (section === 'trends' ? 10 : 11))
    .sort(compareCandidates(section))
    .slice(0, 24);
  const visualCandidates = (await Promise.all(candidates.map(enrichVisual))).filter(Boolean);
  const localized = (await Promise.all(visualCandidates.map(chineseOverview))).filter(Boolean);
  results[section] = diversify(localized.sort(compareCandidates(section)));
}
if (!results.trends.length && !results.competitors.length) throw new Error('No verified items found for the previous week');

issues = issues.filter(issue => issue.start !== iso(start));
const weeklySummary = (section) => { const items=results[section]; if(!items.length)return '本期未收录'+(section==='trends'?'设计趋势':'竞品')+'文章。'; return '本期关注：'+items.map(x=>articleTitle(x).replace(/[。；;].*$/, '')).join('；')+'。'; };
issues.unshift({ start: iso(start), end: iso(end), generated_at: iso(now), sections: {
  trends: { summary: weeklySummary('trends'), notice: '从最近60天的公开报道中筛选，跨期去重并优先覆盖不同品牌；国内大厂和小度相关性优先。设计关注点为编辑解读。', delivery: 'published', items: results.trends.map(trendItem) },
  competitors: { summary: weeklySummary('competitors'), notice: '从最近60天内筛选小米、天猫精灵、华为、豆包硬件、Amazon、Google、Samsung 与 Apple 的新硬件或重大体验升级，跨期去重并优先不同品牌。', delivery: 'published', items: results.competitors.map(competitorItem) }
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
