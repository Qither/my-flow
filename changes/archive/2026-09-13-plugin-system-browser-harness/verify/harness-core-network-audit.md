# my-flow browser: outbound network audit

Scenario: `fixture`
Started: 2026-09-11T13:05:40.102Z
Finished: 2026-09-11T13:05:45.221Z

scenario completed: yes
only loopback destinations: no

## Destinations

| destination | port | via | count | first seen |
| --- | --- | --- | --- | --- |
| 127.0.0.1 | 60389 | node fetch | 4 | 2026-09-11T13:05:40.584Z |
| 127.0.0.1 | 60389 | node net.connect | 5 | 2026-09-11T13:05:40.588Z |
| 127.0.0.1 | 60389 | node websocket | 4 | 2026-09-11T13:05:40.617Z |
| 127.0.0.1 | 60388 | proxy | 3 | 2026-09-11T13:05:40.934Z |
| 127.0.0.1 | 60389 | proxy | 1 | 2026-09-11T13:05:40.878Z |
| accounts.google.com | 443 | proxy | 4 | 2026-09-11T13:05:40.623Z |
| android.clients.google.com | 443 | proxy | 1 | 2026-09-11T13:05:42.908Z |
| example.com | 443 | proxy | 7 | 2026-09-11T13:05:40.984Z |
| example.invalid | 443 | proxy | 1 | 2026-09-11T13:05:45.031Z |
| mtalk.google.com | 5228 | proxy | 1 | 2026-09-11T13:05:42.907Z |
| update.googleapis.com | 443 | proxy | 2 | 2026-09-11T13:05:40.643Z |
| www.google.com | 443 | proxy | 6 | 2026-09-11T13:05:40.625Z |

## Destinations outside loopback

Each of these was refused by the audit proxy, and each is a question to answer.

- `accounts.google.com:443` via proxy, 4 attempt(s)
- `android.clients.google.com:443` via proxy, 1 attempt(s)
- `example.com:443` via proxy, 7 attempt(s)
- `example.invalid:443` via proxy, 1 attempt(s)
- `mtalk.google.com:5228` via proxy, 1 attempt(s)
- `update.googleapis.com:443` via proxy, 2 attempt(s)
- `www.google.com:443` via proxy, 6 attempt(s)

## Versions

- node: v24.1.0
- chromium: C:\Program Files\Google\Chrome\Application\chrome.exe
- stagehand: 4.1.0

## Chromium flags

```
--user-data-dir=C:\Users\qiujm\.my-flow\browser\profiles\Agent-General
--remote-debugging-port=0
--enable-unsafe-extension-debugging
--no-first-run
--no-default-browser-check
--disable-background-networking
--disable-sync
--disable-component-update
--disable-default-apps
--disable-breakpad
--disable-domain-reliability
--disable-client-side-phishing-detection
--disable-features=Translate,OptimizationHints,MediaRouter,InterestFeedContentSuggestions
--window-size=1280,800
--remote-allow-origins=chrome-extension://pljmheomijcfbgcbiccbbgehjckjnlij
--headless=new
--proxy-server=127.0.0.1:60387
--proxy-bypass-list=<-loopback>
--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1
```

## Calls made

- `browser_open` -> allow
- `browser_observe` -> allow
- `browser_click` -> allow
- `browser_read` -> allow
- `browser_screenshot` -> allow
- `browser_extract` -> allow
- `browser_extract` -> error (no model gateway configured)
- `browser_tabs` -> allow
- `browser_open` -> deny (domain chrome-error://chromewebdata/ not in allowlist)

## Scenario log

```
browser ready on http://127.0.0.1:60389 (profile Agent-General)
browser_open: allow
[stagehand] ERROR CDP response failed {"requestId":32,"method":"DOM.getFrameOwner","error":"-32000 Frame with the given id was not found.","targetId":"0A264512DFAF4F33FADA8C66F9583493"}
stagehand: CDP response failed
[stagehand] ERROR CDP response failed {"requestId":36,"method":"Accessibility.getFullAXTree","error":"-32602 Frame with the given frameId is not found.","targetId":"0A264512DFAF4F33FADA8C66F9583493"}
stagehand: CDP response failed
[stagehand] ERROR CDP response failed {"requestId":43,"method":"DOM.getFrameOwner","error":"-32000 Frame with the given id was not found.","targetId":"0A264512DFAF4F33FADA8C66F9583493"}
stagehand: CDP response failed
browser_observe: allow
candidates: Go to page two | Sign in | Downloads | Say hello | Search | Search | Frame button | Shadow button
a page target was announced but never appeared in the page list
browser_click: allow
browser_read: allow
browser_screenshot: allow
browser_extract: allow
browser_extract: error (no model gateway configured)
browser_tabs: allow
browser_open: deny (domain chrome-error://chromewebdata/ not in allowlist)
page fetch to example.invalid attempted
```

