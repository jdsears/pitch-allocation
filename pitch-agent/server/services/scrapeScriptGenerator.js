/**
 * Generates downloadable one-click scrape scripts for Mac and Windows.
 *
 * These scripts run on the user's local machine (where FA Full-Time is
 * accessible), scrape fixtures, and POST them to the Railway API.
 */

const BOYS_SEASON_ID = '353505162';
const BOYS_CLUB_ID = '926960945';
const GIRLS_SEASON_ID = '199649392';
const GIRLS_CLUB_ID = '468454775';

function buildFixtureUrl(seasonId, clubId) {
  return `https://fulltime.thefa.com/fixtures.html?selectedSeason=${seasonId}&selectedFixtureGroupAgeGroup=0&selectedFixtureGroupKey=&selectedDateCode=all&selectedClub=${clubId}&selectedTeam=&selectedRelatedFixtureOption=3&selectedFixtureDateStatus=&selectedFixtureStatus=&previousSelectedFixtureGroupAgeGroup=0&previousSelectedFixtureGroupKey=&previousSelectedClub=${clubId}&itemsPerPage=100`;
}

// The inline Node.js scraping code that gets embedded in shell scripts
function getNodeScriptContent(apiUrl) {
  const boysUrl = buildFixtureUrl(BOYS_SEASON_ID, BOYS_CLUB_ID);
  const girlsUrl = buildFixtureUrl(GIRLS_SEASON_ID, GIRLS_CLUB_ID);

  // This is the Node.js code that will be written to a temp file and executed
  return `
const puppeteer = require('puppeteer');
const cheerio = require('cheerio');

const API_URL = ${JSON.stringify(apiUrl)};
const BOYS_URL = ${JSON.stringify(boysUrl)};
const GIRLS_URL = ${JSON.stringify(girlsUrl)};

const AGE_TO_FORMAT = {
  U6:'5v5',U7:'5v5',U8:'5v5',U9:'7v7',U10:'7v7',
  U11:'9v9',U12:'9v9',U13:'11v11',U14:'11v11',U15:'11v11',
  U16:'11v11',U17:'11v11',U18:'11v11'
};

function extractAgeGroup(t){const m=t.match(/U(\\d+)/i);return m?'U'+m[1]:null;}
function getFormat(a){return AGE_TO_FORMAT[a]||'11v11';}
function isMorleyHome(t){return t.toLowerCase().includes('morley');}

async function scrapePage(url,label){
  console.log('Scraping '+label+'...');
  const browser=await puppeteer.launch({headless:'new',args:['--no-sandbox','--disable-setuid-sandbox']});
  try{
    const page=await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setRequestInterception(true);
    page.on('request',r=>{const t=r.resourceType();['image','font','media'].includes(t)?r.abort():r.continue();});
    await page.goto(url,{waitUntil:'networkidle2',timeout:60000});
    const sels=['.League-Results_Table','table.table','table'];
    for(const s of sels){try{await page.waitForSelector(s,{timeout:15000});break;}catch{}}
    await new Promise(r=>setTimeout(r,3000));
    const html=await page.content();
    return parseFixtures(html);
  }finally{await browser.close();}
}

function parseFixtures(html){
  const $=cheerio.load(html);const fixtures=[];
  let rows;
  if($('.League-Results_Table tr').length>0){rows=$('.League-Results_Table tr');}
  else{rows=$('tr').filter((i,row)=>{const t=$(row).text();return t.includes(' VS ')||t.includes(' v ')||t.includes(' vs ');});}

  rows.each((i,row)=>{
    if($(row).find('th').length>0)return;
    const cells=$(row).find('td');if(cells.length<4)return;
    const cellTexts=[];cells.each((j,c)=>{cellTexts.push($(c).text().trim());});
    const rowText=cellTexts.join(' ');
    const dateMatch=rowText.match(/(\\d{2}\\/\\d{2}\\/\\d{2,4})/);if(!dateMatch)return;
    const timeMatch=rowText.match(/(\\d{2}:\\d{2})/);
    let vsCell=-1;cellTexts.forEach((t,idx)=>{if(t.toUpperCase()==='VS'||t.toUpperCase()==='V')vsCell=idx;});
    if(vsCell===-1)return;
    let leagueCode='';if(cellTexts[0]&&cellTexts[0].match(/^\\d{2}[A-Z]/))leagueCode=cellTexts[0];
    let homeTeam='';for(let k=vsCell-1;k>=0;k--){const t=cellTexts[k];if(t.length>3&&!t.match(/^\\d{2}[\\/:]/)&&!t.match(/^\\d{2}[A-Z]/)&&t!=='VS'){homeTeam=t;break;}}
    let awayTeam='';for(let k=vsCell+1;k<cellTexts.length;k++){const t=cellTexts[k];if(t.length>3&&!t.match(/^\\d{2}[\\/:]/)&&t!=='VS'){awayTeam=t;break;}}
    if(!homeTeam||!awayTeam)return;
    let venueName='';for(let k=cellTexts.length-1;k>vsCell+1;k--){const t=cellTexts[k];if(t.length>2&&t!==awayTeam&&!t.match(/^\\d{2}[\\/:]/)&&t.toUpperCase()!=='VS'){venueName=t;break;}}
    const dp=dateMatch[1].split('/');let yr=dp[2];if(yr.length===2)yr='20'+yr;
    const matchDate=yr+'-'+dp[1]+'-'+dp[0];
    const kickOff=timeMatch?timeMatch[1]:null;
    const ageGroup=extractAgeGroup(homeTeam)||extractAgeGroup(awayTeam);
    fixtures.push({league_code:leagueCode,match_date:matchDate,kick_off:kickOff,home_team:homeTeam,away_team:awayTeam,venue_name:venueName,is_home_game:isMorleyHome(homeTeam),age_group:ageGroup,format:getFormat(ageGroup),match_type:'League / Cup'});
  });
  return fixtures;
}

async function main(){
  console.log('=== Morley YFC Fixture Scraper ===\\n');
  const boys=(await scrapePage(BOYS_URL,'Boys')).map(f=>({...f,gender:'boys'}));
  console.log('Boys: '+boys.length+' fixtures');
  const girls=(await scrapePage(GIRLS_URL,'Girls')).map(f=>({...f,gender:'girls'}));
  console.log('Girls: '+girls.length+' fixtures');
  const all=[...boys,...girls];
  console.log('\\nTotal: '+all.length+' fixtures');
  if(all.length===0){console.log('\\nNo fixtures found. The page structure may have changed.');process.exit(1);}
  all.forEach(f=>{
    const h=f.is_home_game?'(H)':'(A)';
    console.log('  '+f.match_date+' '+(f.kick_off||'??:??')+'  '+f.home_team+' vs '+f.away_team+'  '+h+'  '+(f.age_group||'?')+'  '+f.gender);
  });
  console.log('\\nPushing to API...');
  const res=await fetch(API_URL+'/api/fixtures/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fixtures:all})});
  if(!res.ok){const t=await res.text();throw new Error('API error '+res.status+': '+t);}
  const result=await res.json();
  console.log('Saved: '+JSON.stringify(result));
  console.log('\\nDone! Fixtures have been imported successfully.');
}

main().catch(e=>{console.error('Error: '+e.message);process.exit(1);});
`.trim();
}

function generateMacScript(apiUrl) {
  const nodeScript = getNodeScriptContent(apiUrl);
  // Escape single quotes and backslashes for embedding in heredoc
  const escapedScript = nodeScript.replace(/\\/g, '\\\\').replace(/'/g, "'\\''");

  return `#!/bin/bash
# ============================================
# Morley YFC Fixture Scraper (Mac)
# ============================================
# Double-click this file to scrape FA Full-Time
# fixtures and import them into the Pitch Agent.
#
# Requires: Node.js (https://nodejs.org)
# ============================================

set -e

echo "=========================================="
echo "  Morley YFC Fixture Scraper"
echo "=========================================="
echo ""

# Check for Node.js
if ! command -v node &> /dev/null; then
    echo "ERROR: Node.js is not installed."
    echo "Please install it from https://nodejs.org"
    echo ""
    echo "Press any key to exit..."
    read -n 1
    exit 1
fi

echo "Node.js found: $(node --version)"

# Create temp working directory
WORK_DIR=$(mktemp -d)
echo "Working directory: $WORK_DIR"
cd "$WORK_DIR"

# Initialize and install dependencies
echo ""
echo "Installing dependencies (puppeteer + cheerio)..."
echo "This may take a minute on first run..."
echo ""
npm init -y > /dev/null 2>&1
npm install puppeteer cheerio > /dev/null 2>&1

echo "Dependencies installed. Starting scrape..."
echo ""

# Write and run the scraper
cat > scrape.js << 'SCRAPER_EOF'
${nodeScript}
SCRAPER_EOF

node scrape.js

# Cleanup
cd /
rm -rf "$WORK_DIR"

echo ""
echo "Press any key to exit..."
read -n 1
`;
}

function generateWindowsScript(apiUrl) {
  const nodeScript = getNodeScriptContent(apiUrl);

  return `@echo off
REM ============================================
REM Morley YFC Fixture Scraper (Windows)
REM ============================================
REM Double-click this file to scrape FA Full-Time
REM fixtures and import them into the Pitch Agent.
REM
REM Requires: Node.js (https://nodejs.org)
REM ============================================

echo ==========================================
echo   Morley YFC Fixture Scraper
echo ==========================================
echo.

REM Check for Node.js
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo ERROR: Node.js is not installed.
    echo Please install it from https://nodejs.org
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node --version') do echo Node.js found: %%i

REM Create temp working directory
set "WORK_DIR=%TEMP%\\morley-scraper-%RANDOM%"
mkdir "%WORK_DIR%"
echo Working directory: %WORK_DIR%
cd /d "%WORK_DIR%"

echo.
echo Installing dependencies (puppeteer + cheerio)...
echo This may take a minute on first run...
echo.
call npm init -y >nul 2>nul
call npm install puppeteer cheerio >nul 2>nul

echo Dependencies installed. Starting scrape...
echo.

REM Write the scraper script
(
${nodeScript.split('\n').map(line => `echo ${line.replace(/%/g, '%%').replace(/>/g, '^>').replace(/</g, '^<').replace(/&/g, '^&').replace(/\|/g, '^|').replace(/\(/g, '^(').replace(/\)/g, '^)')}`).join('\n')}
) > scrape.js

node scrape.js

REM Cleanup
cd /d "%TEMP%"
rmdir /s /q "%WORK_DIR%" >nul 2>nul

echo.
pause
`;
}

// PowerShell is much cleaner for Windows
function generatePowershellScript(apiUrl) {
  const nodeScript = getNodeScriptContent(apiUrl);

  return `# ============================================
# Morley YFC Fixture Scraper (Windows PowerShell)
# ============================================
# Right-click > Run with PowerShell to scrape FA
# Full-Time fixtures and import them.
#
# Requires: Node.js (https://nodejs.org)
# ============================================

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  Morley YFC Fixture Scraper" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

# Check for Node.js
try {
    $nodeVersion = & node --version 2>$null
    Write-Host "Node.js found: $nodeVersion"
} catch {
    Write-Host "ERROR: Node.js is not installed." -ForegroundColor Red
    Write-Host "Please install it from https://nodejs.org"
    Read-Host "Press Enter to exit"
    exit 1
}

# Create temp working directory
$workDir = Join-Path $env:TEMP "morley-scraper-$(Get-Random)"
New-Item -ItemType Directory -Path $workDir -Force | Out-Null
Write-Host "Working directory: $workDir"
Set-Location $workDir

Write-Host ""
Write-Host "Installing dependencies (puppeteer + cheerio)..."
Write-Host "This may take a minute on first run..."
Write-Host ""
& npm init -y 2>$null | Out-Null
& npm install puppeteer cheerio 2>$null | Out-Null

Write-Host "Dependencies installed. Starting scrape..."
Write-Host ""

# Write the scraper
$scraperContent = @'
${nodeScript}
'@
Set-Content -Path "scrape.js" -Value $scraperContent

& node scrape.js

# Cleanup
Set-Location $env:TEMP
Remove-Item -Recurse -Force $workDir -ErrorAction SilentlyContinue

Write-Host ""
Read-Host "Press Enter to exit"
`;
}

module.exports = { generateMacScript, generateWindowsScript: generatePowershellScript };
