#!/usr/bin/env python3
"""IndexNow ping for changed URLs (Bing, Yandex, Seznam, … — all IndexNow engines share submissions).

  python3 seo-bot/indexnow.py [--mode daily|weekly|all] [--dry]

Candidates come from seo-bot/state.json (written by build.mjs):
  - never pinged, or content changed since the last ping (`ch` != `pch`)            → pinged by every run;
  - only the daily price changed (`lastmod` > `pinged`) and last ping ≥ N days ago   → pinged by the weekly run only
    (N = config.pingPricePagesEveryDays) — no daily mass pings for the rate update;
  - removed URLs (state.removed, not yet pinged)                                     → pinged so engines drop them.
  --mode all pings every URL once. Successful pings (HTTP 200/202) update `pinged` / `pch` in state.json.
Google does not use IndexNow (it reads the sitemap; Search Console is the owner's job).
"""
import argparse, datetime, json, os, sys, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ap = argparse.ArgumentParser()
ap.add_argument('--mode', default='daily', choices=['daily', 'weekly', 'all'])
ap.add_argument('--dry', action='store_true')
A = ap.parse_args()
CFG = json.load(open(os.path.join(HERE, 'config.json')))
SF = os.path.join(HERE, 'state.json')
state = json.load(open(SF))
pages = state.get('pages', {})
today = datetime.date.today().isoformat()
N = int(CFG.get('pingPricePagesEveryDays', 7))
days = lambda d: (datetime.date.fromisoformat(today) - datetime.date.fromisoformat(d)).days if d else 10 ** 6

cand = []
for u, p in pages.items():
    if A.mode == 'all' or not p.get('pinged') or p.get('ch') != p.get('pch'): cand.append(u)
    elif A.mode == 'weekly' and p.get('lastmod', '') > p.get('pinged', '') and days(p['pinged']) >= N: cand.append(u)
gone = [r['url'] for r in state.get('removed', []) if not r.get('pinged')]
urls = cand + gone
print(f'IndexNow: {len(cand)} changed + {len(gone)} removed URL(s), mode {A.mode}')
if not urls or A.dry:
    print('\n'.join(urls[:20])); sys.exit(0)

host = CFG['base'].split('://')[1].strip('/')
key = CFG['indexnow']['key']
ok_any = False
for i in range(0, len(urls), 9000):
    batch = urls[i:i + 9000]
    body = json.dumps({'host': host, 'key': key, 'keyLocation': f"{CFG['base']}/{key}.txt", 'urlList': batch}).encode()
    for ep in CFG['indexnow']['endpoints']:
        try:
            req = urllib.request.Request(ep, data=body, headers={'Content-Type': 'application/json; charset=utf-8', 'User-Agent': 'vilnyi-seo-bot/1.0'})
            with urllib.request.urlopen(req, timeout=30) as r:
                print(ep, r.status); ok_any |= r.status in (200, 202)
        except Exception as e:
            print(ep, 'failed:', str(e)[:160])
if ok_any:
    for u in cand:
        pages[u]['pinged'] = today; pages[u]['pch'] = pages[u].get('ch', '')
    for r in state.get('removed', []):
        if r['url'] in gone: r['pinged'] = today
    state['lastPing'] = {'date': today, 'urls': len(urls), 'mode': A.mode}
    open(SF, 'w').write(json.dumps(state, separators=(',', ':'), ensure_ascii=False).replace('},"', '},\n"') + '\n')
print('state updated' if ok_any else 'no endpoint accepted the ping; state unchanged')
