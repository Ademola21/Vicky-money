const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const fs = require('fs');

// CONFIGURATION
const TOKEN_FILE = './tokens.txt';
const USER_AGENT_FILE = './user_agents.txt';
const HEADLESS = false;
const COOLDOWN_MINUTES = 16;
const DEBUG = true;

function readLines(file) {
    try {
        return fs.readFileSync(file, 'utf8')
            .split('\n')
            .filter(line => line.trim() !== '');
    } catch (err) {
        console.error(`Error reading ${file}:`, err);
        return [];
    }
}

const tokens = readLines(TOKEN_FILE);
const userAgents = readLines(USER_AGENT_FILE);

if (tokens.length === 0 || userAgents.length === 0) {
    console.error("Missing tokens or user agents!");
    process.exit(1);
}

async function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function processAccount(token, userAgent, index) {
    const browser = await puppeteer.launch({
        executablePath: await chromium.executablePath(),
        args: [
            ...chromium.args,
            '--no-sandbox',
            '--disable-dev-shm-usage',
            '--disable-blink-features=AutomationControlled'
        ],
        headless: HEADLESS,
    });

    const page = await browser.newPage();
    try {
        // Set unique user agent for each session
        await page.setUserAgent(userAgent);
        await page.setViewport({ width: 1280, height: 720 });

        // Anti-detection measures
        await page.evaluateOnNewDocument(() => {
            delete navigator.__proto__.webdriver;
        });

        // Load page with retries
        let loaded = false;
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                await page.goto('https://telegram.geagle.online/', {
                    waitUntil: 'networkidle2',
                    timeout: 30000
                });
                loaded = true;
                break;
            } catch (e) {
                console.log(`[${index}] Load attempt ${attempt} failed, retrying...`);
                await delay(2000);
            }
        }
        if (!loaded) throw new Error('Failed to load page');

        // Set session token
        await page.evaluate((t) => {
            localStorage.setItem("session_token", t);
            document.cookie = `session_token=${t}; domain=telegram.geagle.online; path=/; secure`;
        }, token);

        // Verify session
        await delay(2000);
        await page.reload({ waitUntil: 'networkidle2', timeout: 30000 });
        await delay(3000);

        // Enhanced tapping with verification
        const tapSuccess = await page.evaluate(async () => {
            try {
                const button = document.querySelector("._tapArea_njdmz_15");
                if (!button) return false;

                // Wait for button to be ready
                await new Promise(resolve => {
                    const check = () => button.offsetParent !== null ? resolve() : setTimeout(check, 100);
                    check();
                });

                // Perform taps in controlled batches
                const BATCH_SIZE = 50;
                const TOTAL_TAPS = 1000;

                for (let i = 0; i < TOTAL_TAPS; i += BATCH_SIZE) {
                    await new Promise(resolve => {
                        for (let j = 0; j < BATCH_SIZE; j++) {
                            setTimeout(() => button.click(), j * 5);
                        }
                        setTimeout(resolve, BATCH_SIZE * 5 + 100);
                    });
                }
                return true;
            } catch (e) {
                return false;
            }
        });

        if (!tapSuccess) throw new Error('Tapping failed');

        console.log(`✅ [${index + 1}] Full claim successful (UA: ${userAgent.substring(0, 30)}...)`);
    } catch (error) {
        console.error(`❌ [${index + 1}] Failed:`, error.message);
    } finally {
        console.log(`⏳ [${index + 1}] Cooldown started for ${COOLDOWN_MINUTES} minutes...`);
        await delay(COOLDOWN_MINUTES * 60 * 1000); // Cooldown for this token
        await browser.close();
    }
}

(async () => {
    const promises = tokens.map((token, index) => {
        const userAgent = userAgents[index % userAgents.length];
        return processAccount(token, userAgent, index); // Start each token in its own process
    });

    await Promise.all(promises); // Wait for all tokens to finish
    console.log("✅ All tokens processed!");
})();
