#!/usr/bin/env python3
"""Weekly technical SEO / GEO audit of the ЖК VILNYI site — offline, on the files of the site root.

  python3 seo-bot/audit.py [--root <site dir>] [--lighthouse <dir with *.json reports>] [--out seo-bot/report/seo-report.json]

Checks every static page (uk en he ro de fr it + /facts/ + the app's index.html): <title> / meta description / canonical
(self, absolute) / hreflang 7 + x-default and reciprocity / one <h1> / <img> alt + width + height / internal links and
assets resolve / JSON-LD (seo-bot/jsonld_check.py) / page weight (HTML + eager images) / Open Graph image exists;
sitemaps (every <loc> exists, lastmod ISO, alternates), robots.txt (AI crawlers allowed, sitemap line), llms.txt links,
IndexNow key file. Optional Lighthouse JSON reports (from the workflow) are summarised. Writes one JSON report; exit 0
always (the report says what is wrong) unless --strict is given.
"""
import argparse, glob, json, os, re, sys, time
from html.parser import HTMLParser
from urllib.parse import urlparse, unquote

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from jsonld_check import check_html  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('--root', default=os.path.dirname(HERE))
ap.add_argument('--lighthouse', default='')
ap.add_argument('--out', default=os.path.join(HERE, 'report', 'seo-report.json'))
ap.add_argument('--strict', action='store_true')
A = ap.parse_args()
ROOT = os.path.abspath(A.root)
CFG = json.load(open(os.path.join(HERE, 'config.json')))
BASE = CFG['base'].rstrip('/')
LANGS = ['uk', 'en', 'he', 'ro', 'de', 'fr', 'it']
AI_BOTS = ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-SearchBot', 'PerplexityBot', 'Google-Extended', 'Applebot-Extended', 'Bingbot', 'CCBot']


class Page(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.title = None; self._t = False; self.meta = {}; self.links = []; self.alts = {}; self.canonical = None
        self.h1 = 0; self.imgs = []; self.hrefs = []; self.lang = None; self.og = {}
    def handle_starttag(self, tag, a):
        a = dict(a)
        if tag == 'html': self.lang = a.get('lang')
        elif tag == 'title': self._t = True; self.title = ''
        elif tag == 'meta':
            if a.get('name'): self.meta[a['name']] = a.get('content', '')
            if a.get('property'): self.og[a['property']] = a.get('content', '')
        elif tag == 'link':
            if a.get('rel') == 'canonical': self.canonical = a.get('href')
            elif a.get('rel') == 'alternate' and a.get('hreflang'): self.alts[a['hreflang']] = a.get('href')
            elif a.get('href'): self.hrefs.append(a['href'])
        elif tag == 'h1': self.h1 += 1
        elif tag == 'img': self.imgs.append(a)
        elif tag == 'a' and a.get('href'): self.hrefs.append(a['href'])
    def handle_endtag(self, tag):
        if tag == 'title': self._t = False
    def handle_data(self, d):
        if self._t: self.title += d


def local_path(href, page_rel):
    """href → file under ROOT or None (external / not checkable)."""
    if href.startswith(('mailto:', 'tel:', 'viber:', 'javascript:', '#')): return None
    u = urlparse(href)
    if u.scheme in ('http', 'https'):
        if not href.startswith(BASE): return None
        path = u.path
    elif u.scheme: return None
    else:
        path = u.path if href.startswith('/') else os.path.normpath(os.path.join('/' + os.path.dirname(page_rel), u.path))
    path = unquote(path)
    if path.endswith('/') or path == '': path += 'index.html'
    return os.path.join(ROOT, path.lstrip('/'))


def url_to_file(url):
    return local_path(url, '')


pages = sorted(f for f in glob.glob(os.path.join(ROOT, '**', 'index.html'), recursive=True)
               if os.path.relpath(f, ROOT).split(os.sep)[0] in LANGS + ['facts'] or os.path.relpath(f, ROOT) == 'index.html')
issues = {}   # kind -> [ (page, detail) ]
def bad(kind, page, detail=''):
    issues.setdefault(kind, []).append([page, str(detail)[:200]])

stats = {'pages': 0, 'jsonldTypes': {}, 'htmlBytes': [], 'eagerImgBytes': [], 'titleLen': [], 'descLen': []}
parsed = {}
for f in pages:
    rel = os.path.relpath(f, ROOT); html = open(f, encoding='utf8').read(); p = Page(); p.feed(html); parsed[rel] = p
    stats['pages'] += 1; stats['htmlBytes'].append(len(html.encode()))
    is_app = rel == 'index.html'
    url = BASE + '/' + (rel[:-len('index.html')])
    if not p.title: bad('missing-title', rel)
    else: stats['titleLen'].append(len(p.title))
    d = p.meta.get('description', '')
    if not d: bad('missing-description', rel)
    else: stats['descLen'].append(len(d))
    if p.canonical != url: bad('canonical-not-self', rel, p.canonical)
    if not is_app and not rel.startswith('facts/'):
        if p.h1 != 1: bad('h1-count', rel, p.h1)
        miss = [l for l in LANGS + ['x-default'] if l not in p.alts]
        if miss: bad('hreflang-missing', rel, miss)
        if p.alts.get(p.lang) != url: bad('hreflang-self', rel, p.alts.get(p.lang))
    for l, h in p.alts.items():
        tf = url_to_file(h)
        if not tf or not os.path.exists(tf): bad('hreflang-target-missing', rel, h); continue
        trel = os.path.relpath(tf, ROOT)
        if trel in parsed or os.path.exists(tf):
            q = parsed.get(trel)
            if q is None:
                q = Page(); q.feed(open(tf, encoding='utf8').read()); parsed[trel] = q
            if url not in q.alts.values(): bad('hreflang-not-reciprocal', rel, h)
    og = p.og.get('og:image')
    if not og: bad('og-image-missing', rel)
    elif og.startswith(BASE) and not os.path.exists(url_to_file(og)): bad('og-image-file-missing', rel, og)
    eager = 0
    for im in p.imgs:
        if im.get('alt') is None: bad('img-no-alt', rel, im.get('src'))
        if not is_app and (not im.get('width') or not im.get('height')): bad('img-no-size', rel, im.get('src'))
        src = im.get('src')
        fp = local_path(src, rel) if src else None
        if fp and not os.path.exists(fp): bad('img-missing', rel, src)
        elif fp and im.get('loading') != 'lazy': eager += os.path.getsize(fp)
    stats['eagerImgBytes'].append(eager)
    for h in set(p.hrefs):
        fp = local_path(h, rel)
        if fp and not os.path.exists(fp): bad('broken-internal-link', rel, h)
    types, errs = check_html(html)
    for t in types:
        for tt in (t if isinstance(t, list) else [t]): stats['jsonldTypes'][tt] = stats['jsonldTypes'].get(tt, 0) + 1
    for e in errs: bad('jsonld', rel, e)
    if len(html.encode()) > 120_000: bad('html-heavy', rel, len(html.encode()))

# sitemaps
sm_urls = []
def read(p):
    try: return open(os.path.join(ROOT, p), encoding='utf8').read()
    except Exception: return None
idx = read('sitemap.xml')
if not idx or '<sitemapindex' not in idx: bad('sitemap-index', 'sitemap.xml', 'missing or not an index')
else:
    for sm in re.findall(r'<loc>(.*?)</loc>', idx):
        body = read(sm.replace(BASE + '/', ''))
        if body is None: bad('sitemap-missing', 'sitemap.xml', sm); continue
        for loc, lm in re.findall(r'<url><loc>(.*?)</loc><lastmod>(.*?)</lastmod>', body):
            sm_urls.append(loc)
            if not re.match(r'^\d{4}-\d{2}-\d{2}$', lm): bad('sitemap-lastmod', sm, loc)
            f = url_to_file(loc)
            if not f or not os.path.exists(f): bad('sitemap-url-missing', sm, loc)
static_urls = {BASE + '/' + os.path.relpath(f, ROOT)[:-len('index.html')] for f in pages}
not_in_sm = sorted(static_urls - set(sm_urls))
for u in not_in_sm: bad('page-not-in-sitemap', u)

rob = read('robots.txt') or ''
for b in AI_BOTS:
    if not re.search(rf'User-agent: {re.escape(b)}\s*\nAllow: /', rob): bad('robots-ai-bot', 'robots.txt', b)
if f'Sitemap: {BASE}/sitemap.xml' not in rob: bad('robots-sitemap', 'robots.txt')
if re.search(r'User-agent: \*\s*\n(?:Allow: [^\n]*\n)*Disallow: /\s*$', rob, re.M): bad('robots-blocks-all', 'robots.txt')
llm = read('llms.txt') or ''
if not llm.startswith('# '): bad('llms-txt', 'llms.txt', 'missing or no H1')
for u in re.findall(r'\]\((https?://[^)]+)\)', llm):
    f = url_to_file(u)
    if f and not os.path.exists(f): bad('llms-link-broken', 'llms.txt', u)
key = CFG.get('indexnow', {}).get('key', '')
if not key or (read(f'{key}.txt') or '').strip() != key: bad('indexnow-key-file', f'{key}.txt')

# lighthouse (optional)
lh = []
if A.lighthouse and os.path.isdir(A.lighthouse):
    for f in sorted(glob.glob(os.path.join(A.lighthouse, '*.json'))):
        try:
            r = json.load(open(f))
            cats = {k: round((v.get('score') or 0) * 100) for k, v in r.get('categories', {}).items()}
            au = r.get('audits', {})
            lh.append({'url': r.get('finalDisplayedUrl') or r.get('finalUrl'), 'scores': cats,
                       'lcp_ms': round(au.get('largest-contentful-paint', {}).get('numericValue', 0)), 'cls': round(au.get('cumulative-layout-shift', {}).get('numericValue', 0), 3),
                       'tbt_ms': round(au.get('total-blocking-time', {}).get('numericValue', 0)), 'bytes': round(au.get('total-byte-weight', {}).get('numericValue', 0))})
        except Exception as e: lh.append({'file': os.path.basename(f), 'error': str(e)[:120]})

def summ(xs): return {'min': min(xs), 'max': max(xs), 'avg': round(sum(xs) / len(xs))} if xs else {}
state = {}
try: state = json.load(open(os.path.join(HERE, 'state.json')))
except Exception: pass
sp = state.get('pages', {})
report = {
    'generated': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'base': BASE,
    'pages': stats['pages'], 'sitemapUrls': len(sm_urls), 'jsonldTypes': dict(sorted(stats['jsonldTypes'].items())),
    'htmlBytes': summ(stats['htmlBytes']), 'eagerImageBytes': summ(stats['eagerImgBytes']), 'titleLength': summ(stats['titleLen']), 'descriptionLength': summ(stats['descLen']),
    'issueCounts': {k: len(v) for k, v in sorted(issues.items())}, 'issues': {k: v[:25] for k, v in sorted(issues.items())},
    'indexnow': {'pinged': sum(1 for v in sp.values() if v.get('pinged')), 'neverPinged': sum(1 for v in sp.values() if not v.get('pinged')), 'lastPing': state.get('lastPing')},
    'lighthouse': lh, 'ok': not issues,
}
os.makedirs(os.path.dirname(A.out), exist_ok=True)
json.dump(report, open(A.out, 'w'), ensure_ascii=False, indent=1)
print(json.dumps({k: report[k] for k in ('pages', 'sitemapUrls', 'issueCounts', 'htmlBytes', 'eagerImageBytes', 'ok')}, ensure_ascii=False))
sys.exit(1 if (A.strict and issues) else 0)
