import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deploymentTarget, resolvePresentation } from "./presentation";

assert.equal(deploymentTarget("production"), "production");
assert.equal(deploymentTarget("preview"), "preview");
assert.equal(deploymentTarget("development"), "development");
assert.equal(deploymentTarget(undefined), "development");
assert.equal(resolvePresentation("909", "production"), "909");
assert.equal(resolvePresentation("folio", "production"), "909");
assert.equal(resolvePresentation("folio", "preview"), "folio");
assert.equal(resolvePresentation("folio", "development"), "folio");

const mobileShell = readFileSync("components/mobile2/MobileShell.tsx", "utf8");
const ledDisplay = readFileSync("components/console/hw/LedDisplay.tsx", "utf8");
const shadowResearch = readFileSync("components/perform/ShadowResearchWorkspace.tsx", "utf8");
const foundationCss = readFileSync("app/seve-909.css", "utf8");
const workstationCss = readFileSync("app/workstation.css", "utf8");
const workstationShell = readFileSync("components/shell/WorkstationShell.tsx", "utf8");
const performCss = readFileSync("app/perform.css", "utf8");
const intradayChart = readFileSync("components/IntradayChart.tsx", "utf8");
const mobilePerform = readFileSync("components/mobile2/MobilePerform.tsx", "utf8");
const mobileDock = readFileSync("components/mobile2/MobileDock.tsx", "utf8");
const mobileRackRow = readFileSync("components/mobile2/MobileRackRow.tsx", "utf8");
const mobileStudio = readFileSync("components/mobile2/MobileStudio.tsx", "utf8");
const sessionSequencer = readFileSync("components/console/SessionSequencer.tsx", "utf8");
const mobileCss = readFileSync("app/mobile2.css", "utf8");
assert.match(mobileShell, /<LedWordmark value="\$EVE" color=\{dayColor\}/);
assert.match(mobileShell, /const dayColor = down \? "var\(--led-red\)" : "var\(--pm-green\)"/);
assert.match(ledDisplay, /"\$": "afgcd"[\s\S]*"E": "afged"[\s\S]*"V": ""/);
assert.match(mobileShell, /className="m2-status-center"/);
assert.match(mobileShell, /className="m2-status-center"[\s\S]*<MobileKillControl[\s\S]*className="m2-cog"/);
assert.match(mobileShell, /className="m2-account-pnl"[\s\S]*<b>P&amp;L<\/b>[\s\S]*value=\{dayLed\}/);
assert.doesNotMatch(mobileShell, /m2-head-r2|m2-run|spotStr|\{clock\} PT/);
assert.match(foundationCss, /\.m2-account-pnl > b \{[\s\S]{0,100}10px\/1\.1/);
assert.doesNotMatch(mobileShell, /className="m2-band"/);
assert.match(shadowResearch, /const RECENT_SESSION_LIMIT = 4/);
assert.match(shadowResearch, /aria-label="Older research session"/);
assert.match(shadowResearch, /shadowResearch\.sessions\.slice\(RECENT_SESSION_LIMIT\)/);
assert.match(foundationCss, /\[data-skin="cream"\] \.m2-book-nav button/);
assert.match(foundationCss, /\[data-skin="cream"\] \.m2-markets-chain > \.panel/);
assert.match(workstationCss, /\.ws-deck-mode,\.ws-transport \{ display:none; \}/);
assert.match(workstationCss, /\.ws-left-copy b\{[^}]*font-size:12px/);
assert.doesNotMatch(workstationShell, /<small>\{item\.hint\}<\/small>/);
assert.match(workstationCss, /:is\(\.pf-market-target,\.pf-markets-chart\) \.phead \.t \{ font-size:13px/);
assert.match(workstationCss, /:is\(\.pf-market-target,\.pf-markets-chart\) :is\(\.chart-toggle,\.seg\) button \{ min-height:28px/);
assert.match(workstationCss, /\.ws-sequencer>\.m-sqdock \{[^}]*position:absolute/);
assert.match(workstationCss, /\.ws-sequencer \.m-sqbody \{[^}]*bottom:40px/);
assert.match(workstationShell, /import \{ SessionSequencer \} from "@\/components\/console\/SessionSequencer"/);
assert.match(workstationShell, /import \{ LedDisplay, LedWordmark \} from "@\/components\/console\/hw\/LedDisplay"/);
assert.match(workstationShell, /const dayLedColor = liveFund\.dayPnl < 0 \? "var\(--led-red\)" : "var\(--pm-green\)"/);
assert.match(workstationShell, /<LedWordmark value="\$EVE" color=\{dayLedColor\} label="\$EVE" \/>/);
assert.doesNotMatch(workstationShell, /SEVE DESK|TRADING WORKSTATION/);
assert.match(workstationCss, /\.ws-brand--led \.led-wordmark \{[^}]*padding:0;[^}]*border:0;[^}]*background:none;[^}]*box-shadow:none/);
assert.match(workstationCss, /\.ws-brand--led \.led-glass \{ display:none; \}/);
assert.match(workstationCss, /\.ws-brand--led \.seven-seg \{ width:18px; height:34px; \}/);
assert.match(workstationShell, /<SessionSequencer[\s\S]*variant="dock"[\s\S]*positions=\{feed\.positions\}[\s\S]*recentTrades=\{feed\.recentTrades\}/);
assert.doesNotMatch(workstationShell, /Array\.from\(\{ length: 16 \}, \(_, i\) => <i/);
assert.doesNotMatch(workstationShell, /<AccountSwitcher/);
assert.match(workstationShell, /accounts\.map\(\(account, index\) =>/);
assert.match(workstationShell, /<LedDisplay value=\{String\(index \+ 1\)\} digits=\{1\} color=\{color\}/);
assert.match(workstationShell, /aria-label=\{`Account \$\{index \+ 1\}: \$\{account\.name\}`\}/);
assert.match(workstationCss, /--ws-nav-width:220px; --ws-main-gap:8px; --ws-telemetry-edge:3px/);
assert.match(workstationCss, /\.ws-rail \{[\s\S]*?grid-template-columns:120px 210px repeat\(5,minmax\(92px,1fr\)\) minmax\(240px,1\.35fr\) 96px/);
assert.match(workstationCss, /\.ws-account-bank \{[^}]*grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
assert.match(workstationCss, /\.ws-account-key \.seven-seg \{ width:18px; height:34px; \}/);
assert.match(workstationCss, /\.ws-account-key\.on::after \{ background:var\(--hw-green\)/);
assert.ok(ledDisplay.includes('"+": "g"'));
assert.ok(ledDisplay.includes('":": ""'));
assert.match(workstationShell, /className="ws-day-readouts"/);
assert.ok(workstationShell.includes('<LedDisplay value={dayPctLed} digits={dayPctLed.replace(".", "").length} color={dayLedColor} unit="%"'));
assert.match(workstationCss, /\.ws-led-percent \.seven-seg \{ width:6px; height:12px; \}/);
assert.match(workstationShell, /className="ws-rail" aria-label="Desk command rail"/);
assert.match(workstationShell, /const railDetail = `DATA \$\{processTelemetry\.label\} · BROKER \$\{brokerTelemetry\.label\}/);
assert.match(workstationShell, /className=\{`ws-health ws-health--\$\{railTone\}`\}/);
assert.match(workstationShell, /className="ws-utility-menu"/);
assert.match(workstationShell, /COMMAND ⌘K/);
assert.doesNotMatch(workstationShell, /ws-mode-tabs|ws-deck-mode|ws-transport|\{clock\}/);
assert.doesNotMatch(workstationShell, /className="ws-scope"/);
assert.doesNotMatch(workstationShell, /Decorative ambient signal scope/);
assert.doesNotMatch(workstationShell, /ws-density/);
assert.doesNotMatch(workstationShell, /toggleDensity/);
assert.match(workstationShell, /const startOfDayNav = liveFund\.nav - liveFund\.dayPnl/);
assert.match(workstationShell, /const dayPnlPct = startOfDayNav > 0 \? \(liveFund\.dayPnl \/ startOfDayNav\) \* 100 : null/);
assert.doesNotMatch(workstationShell, /dayChangePct/);
assert.doesNotMatch(workstationShell, /selectedAccount\?\.mode/);
assert.match(workstationShell, /ws-metric ws-metric--led ws-metric--capacity"><small>DESK CAPACITY/);
assert.match(workstationShell, /ws-metric ws-metric--led ws-metric--positions"><small>OPEN POSITIONS/);
assert.match(workstationShell, /ws-metric ws-metric--led ws-metric--risk"><small>RISK USED/);
assert.match(performCss, /grid-auto-flow: column; grid-auto-columns: minmax\(182px, 1fr\)/);
assert.match(intradayChart, /hideTitle = false/);
assert.match(mobilePerform, /onSymbolChange=\{setSymbol\}[\s\S]*hideTitle/);
assert.match(mobilePerform, /aria-label="Chart settings"[\s\S]*mobileSettingsOpen=\{chartSettingsOpen\}/);
assert.match(mobilePerform, /onMobileSettingsOpenChange=\{setChartSettingsOpen\}[\s\S]*compactTickerInToolbar/);
assert.match(intradayChart, /className="chart-toolbar-led"[\s\S]*\$\{symbol\} price \$\{ledSpot\.toFixed\(2\)\}/);
assert.match(foundationCss, /\.m2-chart-body \.seg--range button \{[\s\S]{0,180}min-width:\s*44px;[\s\S]{0,100}min-height:\s*34px/);
assert.match(foundationCss, /@media \(max-width: 380px\)[\s\S]*\.chart-toolbar-led \.seven-seg \{[\s\S]{0,80}width:\s*6px;[\s\S]*\.seg--range button \{[\s\S]{0,80}min-width:\s*40px/);
assert.ok(mobileRackRow.indexOf('className="m2-fireslbl') < mobileRackRow.indexOf("m2-passport lane-"));
assert.ok(mobileRackRow.indexOf("m2-passport lane-") < mobileRackRow.lastIndexOf("<ChannelConfigDraftPanel"));
assert.match(mobileRackRow, /className="m2-passport-toggle"[\s\S]*aria-expanded=\{passportOpen\}/);
assert.match(mobileStudio, /className="m2-studio-sequencer"/);
assert.doesNotMatch(mobileStudio, /m2-tape-screen/);
assert.doesNotMatch(mobileStudio, /MASTER · SESSION/);
assert.doesNotMatch(mobileStudio, /Runtime release identity/);
assert.match(mobileDock, /onOpenChannel\?: \(slug: string\) => void/);
assert.match(mobileDock, /aria-label=\{`Open \$\{ch\.slug\} in Studio`\}/);
assert.match(mobileShell, /const openStudioChannel = \(slug: string\) => \{[\s\S]*setOpenSlug\(slug\);[\s\S]*setRoom\("studio"\)/);
assert.match(mobileShell, /const \{ skin, setSkin, setMode \} = useShell\(\)/);
assert.match(mobileShell, /setMode\(room === "studio" \? "studio" : "perform"\)/);
assert.match(mobileCss, /\.m2-studio-sequencer \.m-sqbody \{[^}]*padding-top:6px/);
assert.match(sessionSequencer, /if \(variant === "dock"\)[\s\S]*className="m-sqbody"[\s\S]*className="m-sqhead"/);
assert.match(mobileCss, /\.m2-app\[data-room="studio"\] \.m2-padbar \{ margin-top:0/);
assert.match(mobileCss, /\.m2-app\[data-mode="studio"\] \.roster-console-body \{[^}]*display:grid/);
assert.match(mobileCss, /\.m2-app\[data-mode="studio"\] \.roster-workflow ol \{[^}]*grid-template-columns:1fr 1fr/);
assert.match(mobileCss, /\.m2-app\[data-mode="studio"\] \.roster-selected \{[^}]*grid-template-columns:1fr 1fr/);
assert.match(mobileCss, /\.m2-app\[data-mode="studio"\] \.roster-console-body :is\(select,input,textarea\) \{[\s\S]{0,220}min-height:44px/);
assert.match(foundationCss, /\[data-skin="blackout"\] \.m2-desk-section > header,[\s\S]{0,180}\.m2-desk-disclosure > summary/);
assert.match(foundationCss, /\.m2-market-switch button \{[\s\S]{0,120}min-height:\s*46px/);
assert.match(foundationCss, /\.m2-chart-body :is\(\.chart-toggle, \.seg\) button \{[\s\S]{0,120}min-height:\s*42px/);
assert.match(foundationCss, /\.srw-head b \{[\s\S]{0,80}font-size:\s*clamp\(18px, 1vw, 21px\)/);
assert.match(foundationCss, /\.srw-row \{[\s\S]{0,80}min-height:\s*44px;[\s\S]{0,80}font-size:\s*clamp\(14px, \.78vw, 16px\)/);
assert.match(foundationCss, /:is\(\.pf-market-target, \.pf-markets-chart\) > \.panel/);
assert.match(foundationCss, /:is\(\s*\.pf-market-target,\s*\.pf-markets-chart\s*\) :is\([\s\S]{0,100}\.chart-toggle,[\s\S]{0,60}\.seg[\s\S]{0,40}\) button\.on/);
const themeContract = foundationCss.match(/909 THEME SURFACE CONTRACT([\s\S]*?)909 THEME SURFACE CONTRACT: END/)?.[1] ?? "";
assert.ok(themeContract, "final 909 theme surface contract is missing");
for (const token of [
  "--909-surface-canvas",
  "--909-surface-panel",
  "--909-surface-panel-inset",
  "--909-text-primary",
  "--909-border",
  "--909-border-strong",
]) {
  assert.ok(themeContract.includes(token), `theme contract does not consume ${token}`);
}
for (const family of [
  ".ws-left",
  ".pf-hardware",
  ".m2-market-switch",
  ".m2-screen.m2-hardware",
  ".m2-desk-section",
  ".srw.compact",
]) {
  assert.ok(themeContract.includes(family), `theme contract does not cover ${family}`);
}

console.log("presentation-selftest: 101/101 passed");
