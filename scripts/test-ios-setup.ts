// Usage: npx tsx --tsconfig tsconfig.json scripts/test-ios-setup.ts
// Which iPhone setup step a visitor is on (lib/ios-setup.ts): in Instagram/
// TikTok's browser, in Safari, or opened from the Home Screen. Pure logic.
import assert from "node:assert"
import { iosSetupState, inAppBrowserName, iosVersion, iosSupportsWebPush, isIos } from "../lib/ios-setup"

let passed = 0
const ok = (name: string) => { passed++; console.log(`  ok  ${name}`) }

const SAFARI_17 = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1"
const SAFARI_16_1 = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.1 Mobile/15E148 Safari/604.1"
const INSTAGRAM = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 330.0.3.12.235 (iPhone15,2; iOS 17_5; en_US; en; scale=3.00; 1179x2556; 601420827)"
const TIKTOK = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 musical_ly_34.5.0 JsSdk/2.0 NetType/WIFI Channel/App Store ByteLocale/en Region/US"
const FACEBOOK = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/470.0.0.37.106;FBBV/600000000]"
const IPAD_AS_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15"
const ANDROID_INSTAGRAM = "Mozilla/5.0 (Linux; Android 14; SM-S918U) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.0.0 Mobile Safari/537.36 Instagram 330.0.0.40.92 Android"
const CHROME_DESKTOP = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

assert.equal(inAppBrowserName(INSTAGRAM), "Instagram")
assert.equal(inAppBrowserName(TIKTOK), "TikTok")
assert.equal(inAppBrowserName(FACEBOOK), "Facebook")
assert.equal(inAppBrowserName(SAFARI_17), null)
ok("names the in-app browser")

assert.equal(iosSetupState({ ua: INSTAGRAM, standalone: false }), "in-app")
assert.equal(iosSetupState({ ua: TIKTOK, standalone: false }), "in-app")
assert.equal(iosSetupState({ ua: SAFARI_17, standalone: false }), "browser")
assert.equal(iosSetupState({ ua: SAFARI_17, standalone: true }), "installed")
assert.equal(iosSetupState({ ua: SAFARI_16_1, standalone: true }), "old-ios")
ok("in-app browser, Safari, Home Screen, old iOS")

assert.equal(iosSetupState({ ua: ANDROID_INSTAGRAM, standalone: false }), "not-ios", "Android Instagram: not this page's job")
assert.equal(iosSetupState({ ua: CHROME_DESKTOP, standalone: false }), "not-ios")
assert.equal(iosSetupState({ ua: IPAD_AS_MAC, maxTouchPoints: 0, standalone: false }), "not-ios", "a real Mac")
assert.equal(iosSetupState({ ua: IPAD_AS_MAC, maxTouchPoints: 5, standalone: false }), "browser", "iPad reporting as Mac")
assert.ok(!isIos(CHROME_DESKTOP))
ok("Android, desktop and iPad-as-Mac")

assert.deepEqual(iosVersion(SAFARI_17), [17, 4])
assert.deepEqual(iosVersion(IPAD_AS_MAC), [17, 4])
assert.equal(iosSupportsWebPush(SAFARI_16_1), false)
assert.equal(iosSupportsWebPush("iPhone OS 16_4 like Mac OS X"), true)
assert.equal(iosSupportsWebPush("iPhone"), true, "unknown version: no warning")
ok("web push needs iOS 16.4+")

console.log(`\n${passed} passed`)
