"use strict";
// Run with Node's test runner and Playwright on the module path; see README.md.
// Settings → General's copy, after the pass that shortened it: the tray row
// ("Click tray icon") and the Dock row ("Show in Dock") lost the line under
// their names, Lightweight mode and Session terminal keep one short line
// each, Prevent sleep's line says what the setting does, and Language is a
// pick of the app's own menu (as Session terminal's is) instead of a strip
// of tabs, because the list of languages keeps growing. A pick there saves
// the language and the rows are drawn again in it; no click scrolls the
// page. English, Chinese, Japanese and German, at 900px and 440px, Chromium
// and WebKit, with the API faked here.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { test } = require("node:test");
const { chromium, webkit } = require("playwright");
const { watchSettingsReads, settingsDrawn } = require("./reader.cjs");

const assets = path.resolve(__dirname, "../assets");
const words = {
  en: {
    tray: "Click tray icon", openPanel: "Open quick panel", openWindow: "Open main window",
    dock: "Show in Dock", light: "Lightweight mode",
    lightSub: "Reloading resources when the panel or window is reopened",
    awake: "Prevent sleep", awakeSub: "Keeps this computer awake while magpie runs tasks",
    termSub: "The terminal used when opening a session",
    lang: "Language", off: "Off",
  },
  zh: {
    tray: "点击托盘图标", openPanel: "打开快捷面板", openWindow: "打开主窗口",
    dock: "显示程序坞", light: "轻量模式",
    lightSub: "打开界面时重新加载资源",
    awake: "防止休眠", awakeSub: "在 magpie 运行任务时，让电脑保持唤醒状态",
    termSub: "打开会话时所使用的终端",
    lang: "语言", off: "关闭",
  },
  ja: {
    tray: "トレイアイコンをクリック", openPanel: "クイックパネルを開く", openWindow: "メインウィンドウを開く",
    dock: "Dock に表示", light: "軽量モード",
    lightSub: "パネルやウィンドウを再度開くと、その場でリソースを読み込み直します",
    awake: "スリープを防ぐ", awakeSub: "magpie がタスクを実行している間、このコンピューターをスリープさせません",
    termSub: "セッションを開くときに使うターミナル",
    lang: "言語", off: "オフ",
  },
  de: {
    tray: "Tray-Symbol anklicken", openPanel: "Schnell-Panel öffnen", openWindow: "Hauptfenster öffnen",
    dock: "Im Dock anzeigen", light: "Ressourcensparmodus",
    lightSub: "Beim erneuten Öffnen von Panel oder Fenster werden seine Ressourcen neu geladen",
    awake: "Schlafmodus verhindern", awakeSub: "Hält diesen Computer wach, während magpie Aufgaben ausführt",
    termSub: "Das Terminal, das beim Öffnen einer Sitzung verwendet wird",
    lang: "Sprache", off: "Aus",
  },
};
// The language menu is the app's LOCALES: the system choice under its own
// translated name, then every language as it names itself.
const langs = ["English", "简体中文", "繁體中文", "日本語", "Deutsch"];
const sys = { en: "System", zh: "跟随系统", ja: "システム", de: "System" };
// The terminals macOS has registered, whose default becomes the system pick.
const terminalApps = [
  { id: "com.apple.Terminal", name: "Terminal" },
  { id: "com.googlecode.iterm2", name: "iTerm" },
  { id: "com.mitchellh.ghostty", name: "Ghostty" },
];
const picked = terminalApps[2].id;

function serve(lang, posted, st) {
  const settings = () => ({ lang, theme: "light", searchVendors: [], searchAPIs: [], terminalApps, terminalDefault: terminalApps[0].id, ...st });
  return async (r) => {
    const url = new URL(r.request().url());
    const json = (data, status = 200) => r.fulfill({ status, json: data });
    if (url.pathname === "/boot.js") return r.fulfill({ contentType: "text/javascript", body: `window.bootPrefs = {lang:"${lang}",theme:"light",web:false};` });
    if (url.pathname === "/wails/runtime.js") return r.fulfill({ contentType: "text/javascript", body: "export const Window = {};" });
    if (url.pathname === "/api/state") return json({ agents: [], profiles: [], settings: settings() });
    if (url.pathname === "/api/settings") {
      if (r.request().method() === "POST") {
        const b = JSON.parse(r.request().postData());
        posted.push(b);
        Object.assign(st, b);
      }
      return json(settings());
    }
    if (url.pathname === "/api/providers") return json({ providers: [], presets: [], excluded: [], gateway: { running: true, window: true, url: "http://127.0.0.1:3999" } });
    if (url.pathname === "/api/groups") return json({ models: [], groups: [], pools: [] });
    if (url.pathname === "/api/plugins") return json({ plugins: [] });
    if (url.pathname === "/api/usage/quotas") return json([]);
    if (url.pathname.startsWith("/api/")) return json({});
    const file = path.join(assets, url.pathname === "/" ? "index.html" : url.pathname);
    const contentType = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" }[path.extname(file)];
    await r.fulfill({ body: await fs.readFile(file), contentType });
  };
}

async function open(engine, lang, posted, st, t, width) {
  const browser = await (engine === "webkit" ? webkit.launch() : chromium.launch({ channel: "chromium" }));
  t.after(() => browser.close());
  const page = await (await browser.newContext({ viewport: { width, height: 760 } })).newPage();
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // the Dock row and the Session terminal row are macOS only: shown on a Mac
  await page.addInitScript(() => Object.defineProperty(navigator, "platform", { get: () => "MacIntel" }));
  await page.route("**/*", serve(lang, posted, st));
  await watchSettingsReads(page);
  await page.goto("http://magpie.test/?view=settings");
  await settingsDrawn(page); // rows found are the ones that stay (#1659)
  await page.locator("#setPage-general .row.pref").first().waitFor();
  return { page, errors };
}

for (const engine of (process.env.BROWSER ? [process.env.BROWSER] : ["chromium", "webkit"])) {
  for (const lang of ["en", "zh", "ja", "de"]) for (const width of [900, 440]) {
    const w = words[lang];
    test(`${engine} ${lang} ${width}px: the General rows the copy pass touched`, async (t) => {
      const posted = [], st = {};
      const { page, errors } = await open(engine, lang, posted, st, t, width);
      const wait = () => page.waitForFunction(() => prefsBusy === 0);
      // every scrolled box, so a click that moved any of them shows
      const where = () => page.evaluate(() => [scrollX, scrollY, document.scrollingElement.scrollTop, ...[...document.querySelectorAll("*")].filter((e) => e.scrollTop).map((e) => e.scrollTop)]);
      // wheel the row into sight: an unsolicited scrollIntoView is undone by
      // the app, so a control is brought to the middle of the view by hand
      const bring = async (loc) => {
        const view = await page.locator("#view-settings").boundingBox();
        await page.mouse.move(view.x + view.width / 2, view.y + view.height / 2);
        for (let i = 0; i < 80; i++) {
          const b = await loc.boundingBox();
          if (b && b.y >= view.y + 10 && b.y + b.height <= view.y + view.height - 10) return b;
          await page.mouse.wheel(0, b && b.y < view.y ? -80 : 80);
          await page.waitForTimeout(25);
        }
        throw new Error("the row did not come into sight");
      };
      const clickAt = async (loc) => {
        await wait();
        const b = await bring(loc);
        const before = await where();
        await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
        return before;
      };

      // Click tray icon: the name and its two clicks, no line under the name
      const trayName = page.locator("#setPage-general .row .name", { hasText: w.tray }).first();
      await trayName.waitFor();
      assert.equal(await trayName.innerText(), w.tray);
      assert.equal(await trayName.locator("xpath=ancestor::div[contains(@class,'row')][1]/div[contains(@class,'sub')]").count(), 0, "the tray row has no line under the name");
      assert.deepEqual((await page.locator("#traySegs .opt").allInnerTexts()).map((s) => s.trim()), [w.openPanel, w.openWindow]);
      const trayBefore = await clickAt(page.locator("#traySegs .opt").nth(1));
      await wait();
      assert.equal((await page.locator("#traySegs .opt.on").innerText()).trim(), w.openWindow, "the pick is shown");
      assert.equal(posted.at(-1).tray, "window", "and saved");
      assert.deepEqual(await where(), trayBefore, "picking a tray click scrolled the page");

      // Show in Dock: a name, its three clicks, and no line under the name
      assert.equal(await page.locator("#dockRow .name").innerText(), w.dock);
      assert.equal(await page.locator("#dockRow .sub").count(), 0, "the Dock row has no line under the name");
      assert.equal((await page.locator("#dockSegs .opt").allInnerTexts()).length, 3);

      // Lightweight mode: the shorter line, still a two-way choice
      assert.equal(await page.locator("#lightweightRow .name").innerText(), w.light);
      assert.equal(await page.locator("#lightweightRow .sub").innerText(), w.lightSub);

      // Prevent sleep: the short name, its one line, off by default
      assert.equal(await page.locator("#keepAwakeRow .name").innerText(), w.awake);
      assert.equal(await page.locator("#keepAwakeRow .sub").innerText(), w.awakeSub);
      assert.equal((await page.locator("#keepAwakeSegs .opt.on").innerText()).trim(), w.off, "off by default");

      // Session terminal: the shorter line, and its menu still picks one
      assert.equal(await page.locator("#sessionTerminalRow .sub").innerText(), w.termSub);
      const select = page.locator("#sessionTerminalSelect");
      const termBefore = await clickAt(select);
      const items = (await page.locator(".proto-menu .pm-name").allInnerTexts()).map((s) => s.trim());
      const system = await page.evaluate(() => t("System default ({name})", { name: "Terminal" }));
      assert.deepEqual(items, [system, "iTerm", "Ghostty"], "the menu lists the terminals that are registered");
      await page.locator(".proto-menu .pm-item").last().click();
      await page.waitForFunction(() => !document.querySelector(".proto-menu"));
      await wait();
      assert.equal(posted.at(-1).sessionTerminal, picked, "the terminal picked is saved");
      assert.deepEqual(await where(), termBefore, "picking a terminal scrolled the page");

      // Language: a menu button, as Session terminal's is, not a strip of tabs
      const langRow = page.locator("#langSelect").locator("xpath=ancestor::div[contains(@class,'row')][1]");
      assert.equal(await langRow.locator(".name").innerText(), w.lang);
      assert.equal(await langRow.locator(".sub").count(), 0, "the language row has no line under the name");
      assert.equal(await langRow.locator(".sess-pick").count(), 1, "a menu button");
      assert.equal(await langRow.locator(".segs").count(), 0, "no strip of language tabs");
      const langBefore = await clickAt(page.locator("#langSelect"));
      assert.equal(await page.locator("#langSelect").getAttribute("aria-expanded"), "true", "the button says its menu is open");
      const menu = (await page.locator(".proto-menu .pm-name").allInnerTexts()).map((s) => s.trim());
      assert.deepEqual(menu, [sys[lang], ...langs], "every language is in the menu, the system one under its translated name");
      assert.deepEqual(await where(), langBefore, "opening the menu scrolled the page");
      await page.locator(".proto-menu .pm-item").last().click();
      await page.waitForFunction(() => !document.querySelector(".proto-menu"));
      await wait();
      // the language is saved, and the rows are drawn again in it
      assert.equal(posted.at(-1).lang, "de", "the language picked is saved");
      assert.equal((await page.locator("#langSelect span").innerText()).trim(), "Deutsch", "the row names the language picked");
      assert.equal(await page.locator("#keepAwakeRow .sub").innerText(), words.de.awakeSub);
      assert.equal(await page.locator("#setPage-general .row .name", { hasText: words.de.tray }).first().innerText(), words.de.tray);
      assert.deepEqual(errors, []);
    });
  }
}
