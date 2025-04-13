const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const fs = require('fs');

// CONFIGURATION
const TOKEN_FILE = './tokens.txt';
const USER_AGENT_FILE = './user_agents.txt';
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

// Track cooldown times for each token
const tokenCooldowns = new Map();

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function processAccount(token, userAgent, index) {
  // Check if this token is on cooldown
  const now = Date.now();
  const cooldownUntil = tokenCooldowns.get(token) || 0;
  
  if (now < cooldownUntil) {
    const waitTimeMin = Math.ceil((cooldownUntil - now) / 60000);
    console.log(`[${index + 1}] Token still on cooldown for ${waitTimeMin} more minutes. Skipping.`);
    return { success: false, token, reason: 'cooldown' };
  }

  console.log(`[${index + 1}] Launching browser for token ${token.substring(0, 8)}...`);
  
  // Configure browser with restricted environment settings
  const browser = await puppeteer.launch({
    executablePath: await chromium.executablePath(),
    args: [
      ...chromium.args,
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu',
      '--single-process' // Important for some restricted environments
    ],
    headless: true, // Must use headless in Discord hosting
  });

  const page = await browser.newPage();
  try {
    // Basic setup
    await page.setUserAgent(userAgent);
    await page.setViewport({ width: 1280, height: 720 });
    
    // Anti-detection (simplified)
    await page.evaluateOnNewDocument(() => {
      delete navigator.__proto__.webdriver;
      navigator.connection = { effectiveType: '4g' }; // Add some browser properties
    });

    // Load page with simple approach
    console.log(`[${index + 1}] Loading page...`);
    await page.goto('https://telegram.geagle.online/', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    // Set session token
    await page.evaluate((t) => {
      localStorage.setItem("session_token", t);
      document.cookie = `session_token=${t}; domain=telegram.geagle.online; path=/; secure`;
    }, token);

    // Verify session with reload
    await delay(2000);
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
    await delay(3000);

    // Improved tapping sequence with better synchronization
    console.log(`[${index + 1}] Starting improved tapping process...`);
    const result = await page.evaluate(async () => {
      try {
        // Find the button
        const button = document.querySelector("._tapArea_njdmz_15");
        if (!button) return {success: false, reason: 'Button not found'};
        
        console.log(`⏳ Starting tapping with improved method...`);
        
        // Improved tapping approach with smaller batches and better timing
        const maxTaps = 1000;
        const BATCH_SIZE = 10; // Smaller batches for better registration
        let tapCount = 0;
        
        // Function to get the current tap count from the UI if possible
        const getCurrentTapCount = () => {
          try {
            // This should be adapted to match how the site shows tap count
            const countElements = document.querySelectorAll("div._mainInfo_1tgt6_12 span");
            if (countElements && countElements.length > 0) {
              // Try to find an element that contains numeric content
              for (const el of countElements) {
                const text = el.innerText.trim();
                const num = parseInt(text.replace(/[^\d]/g, ''), 10);
                if (!isNaN(num)) return num;
              }
            }
            return null; // Unable to determine current count
          } catch (e) {
            console.error("Error getting tap count:", e);
            return null;
          }
        };
        
        // Get initial count if possible
        const initialCount = getCurrentTapCount();
        console.log(`Initial tap count: ${initialCount !== null ? initialCount : 'unknown'}`);
        
        // Process in batches with more natural timing
        for (let i = 0; i < maxTaps; i += BATCH_SIZE) {
          // Process a batch
          for (let j = 0; j < BATCH_SIZE && (i + j) < maxTaps; j++) {
            button.click();
            // Small random delay within each batch for more human-like behavior
            await new Promise(r => setTimeout(r, Math.random() * 15 + 5));
          }
          
          // Report progress occasionally
          if (i % 100 === 0 && i > 0) {
            const currentCount = getCurrentTapCount();
            console.log(`✅ Tapped ${i} times so far. Site shows: ${currentCount !== null ? currentCount : 'unknown'}`);
          }
          
          // Add a more significant delay between batches to let server process
          if (i + BATCH_SIZE < maxTaps) {
            await new Promise(r => setTimeout(r, 300 + Math.random() * 200));
          }
        }

        // Final pause to ensure server registers the last batch
        await new Promise(r => setTimeout(r, 5000));
        
        // Get final count for verification
        const finalCount = getCurrentTapCount();
        console.log(`💰 Completed all ${maxTaps} taps! Site shows: ${finalCount !== null ? finalCount : 'unknown'}`);
        
        return {
          success: true, 
          tapped: maxTaps,
          initialCount: initialCount,
          finalCount: finalCount
        };
      } catch (e) {
        console.error("Process error:", e);
        return {success: false, reason: e.message};
      }
    });

    console.log(`[${index + 1}] Tapping result:`, result);
    
    if (!result.success) {
      throw new Error(`Tapping failed: ${result.reason || 'Unknown error'}`);
    }
    
    console.log(`✅ [${index + 1}] Full claim successful with ${result.tapped} taps`);
    if (result.initialCount !== null && result.finalCount !== null) {
      console.log(`💰 [${index + 1}] Coins: ${result.initialCount} → ${result.finalCount} (gained: ${result.finalCount - result.initialCount})`);
    }
    
    // Set individual cooldown for this token
    const cooldownUntil = Date.now() + (COOLDOWN_MINUTES * 60 * 1000);
    tokenCooldowns.set(token, cooldownUntil);
    console.log(`[${index + 1}] Set cooldown until ${new Date(cooldownUntil).toLocaleTimeString()}`);
    
    return { success: true, token };
  } catch (error) {
    console.error(`❌ [${index + 1}] Failed:`, error.message);
    return { success: false, token, reason: error.message };
  } finally {
    // Always close browser to free resources
    if (page && !page.isClosed()) await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

// Process tokens with individual cooldowns
async function processTokenWithCooldown(token, index) {
  try {
    const userAgent = userAgents[index % userAgents.length];
    
    // Process the token
    const result = await processAccount(token, userAgent, index);
    
    // Get the next run time based on cooldown
    const now = Date.now();
    const cooldownUntil = tokenCooldowns.get(token) || now;
    const waitTime = Math.max(10000, cooldownUntil - now); // At least 10 seconds
    
    // Schedule next run for this specific token
    console.log(`[${index + 1}] Next run in ${Math.ceil(waitTime/60000)} minutes`);
    setTimeout(() => {
      processTokenWithCooldown(token, index);
    }, waitTime);
    
  } catch (err) {
    console.error(`Fatal error processing token ${index+1}:`, err);
    
    // Retry after error with a delay
    console.log(`[${index + 1}] Retrying in 5 minutes due to error`);
    setTimeout(() => {
      processTokenWithCooldown(token, index);
    }, 5 * 60 * 1000);
  }
}

// Start the process for each token independently
(async () => {
  try {
    console.log(`Starting independent processes for ${tokens.length} tokens`);
    
    // Start each token on its own schedule with a staggered start
    tokens.forEach((token, index) => {
      // Stagger the start times to avoid overloading resources
      const startDelay = index * 30000; // 30 seconds between starts
      setTimeout(() => {
        processTokenWithCooldown(token, index);
      }, startDelay);
      
      console.log(`[${index + 1}] Scheduled to start in ${startDelay/1000} seconds`);
    });
    
  } catch (error) {
    console.error('Initialization error:', error);
    process.exit(1);
  }
})();
