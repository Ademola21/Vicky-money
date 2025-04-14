const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const fs = require('fs');

// CONFIGURATION
const TOKEN_FILE = './tokens.txt';
const USER_AGENT_FILE = './user_agents.txt';
const COOLDOWN_MINUTES = 14;
const MAX_CONCURRENT_BROWSERS = 3; // Limit concurrent browsers
const MAX_TAPS = 1050; // Target slightly more than 1000 to ensure we get at least 1000 registered

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
// Active browser count for concurrency control
let activeBrowsers = 0;
// Queue for pending token operations
const tokenQueue = [];

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Memory management function
async function cleanupResources(page, browser) {
  try {
    // Clear JavaScript heap
    if (page && !page.isClosed()) {
      await page.evaluate(() => {
        if (window.gc) window.gc();
        
        // Clear any intervals that might be running
        for (let i = 1; i < 9999; i++) {
          window.clearInterval(i);
          window.clearTimeout(i);
        }
        
        // Remove event listeners
        const oldNode = document.documentElement.cloneNode(true);
        document.documentElement.parentNode.replaceChild(oldNode, document.documentElement);
      }).catch(() => {});
      
      // Close page explicitly
      await page.close().catch(() => {});
    }
    
    // Close browser explicitly and force garbage collection
    if (browser) {
      const pages = await browser.pages().catch(() => []);
      await Promise.all(pages.map(p => p.close().catch(() => {})));
      await browser.close().catch(() => {});
    }
    
    // Force Node.js garbage collection if available
    if (global.gc) {
      global.gc();
    }
  } catch (err) {
    console.error("Error during cleanup:", err);
  } finally {
    // Decrease active browser count when done
    activeBrowsers--;
    processQueue(); // Process next item in queue if any
  }
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
  
  let browser = null;
  let page = null;
  try {
    // Configure browser with minimal memory settings
    browser = await puppeteer.launch({
      executablePath: await chromium.executablePath(),
      args: [
        ...chromium.args,
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-extensions',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process', // Important for memory usage
        '--disable-gpu',
        '--js-flags=--expose-gc', // Enable garbage collection
        '--disable-features=site-per-process', // Reduces process overhead
        '--disable-infobars',
        '--mute-audio'
      ],
      headless: true,
      defaultViewport: {
        width: 1280,
        height: 720,
        deviceScaleFactor: 1
      },
      ignoreHTTPSErrors: true,
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false,
    });

    page = await browser.newPage();
    
    // Disable unnecessary features to save memory
    await page.setRequestInterception(true);
    page.on('request', request => {
      const resourceType = request.resourceType();
      // Block unnecessary resource types, but still load necessary resources
      if (['image', 'media', 'font'].includes(resourceType)) {
        request.abort();
      } else {
        request.continue();
      }
    });
    
    // Basic setup
    await page.setUserAgent(userAgent);
    
    // Load page
    console.log(`[${index + 1}] Loading page...`);
    await page.goto('https://telegram.geagle.online/', {
      waitUntil: 'networkidle2', // Using networkidle2 for better reliability in this case
      timeout: 60000
    });

    // Set token
    await page.evaluate((t) => {
      localStorage.setItem("session_token", t);
      document.cookie = `session_token=${t}; domain=telegram.geagle.online; path=/; secure`;
    }, token);

    // Reload to apply token
    await delay(1500);
    await page.reload({ waitUntil: 'networkidle2' });
    await delay(2000);

    // Check for the button first to verify everything is loaded correctly
    const buttonCheck = await page.evaluate(() => {
      const button = document.querySelector("._tapArea_njdmz_15");
      return !!button;
    });

    if (!buttonCheck) {
      console.error(`[${index + 1}] Button not found. Page might not have loaded correctly.`);
      // Take a screenshot for debugging
      await page.screenshot({ path: `debug_${index}_no_button.png` });
      throw new Error('Button not found');
    }

    // Execute the improved tapping script with better reliability
    console.log(`[${index + 1}] Starting enhanced tapping process...`);
    const result = await page.evaluate(async (maxTapsGoal) => {
      try {
        // Find the button based on class
        let button = document.querySelector("._tapArea_njdmz_15");
        
        if (!button) {
          return {success: false, reason: 'Button not found after verification'};
        }
        
        console.log(`⏳ Executing ${maxTapsGoal} taps...`);
        
        // Function to perform a single tap with better reliability
        const performTap = () => {
          try {
            // Create and dispatch both mouse and touch events for better reliability
            // Mouse events
            const mouseDown = new MouseEvent('mousedown', {
              bubbles: true,
              cancelable: true,
              view: window
            });
            
            const mouseUp = new MouseEvent('mouseup', {
              bubbles: true,
              cancelable: true,
              view: window
            });
            
            const click = new MouseEvent('click', {
              bubbles: true,
              cancelable: true,
              view: window
            });
            
            // Touch events (for mobile simulation)
            const touchStart = new TouchEvent('touchstart', {
              bubbles: true,
              cancelable: true,
              view: window
            });
            
            const touchEnd = new TouchEvent('touchend', {
              bubbles: true,
              cancelable: true,
              view: window
            });
            
            // Dispatch events in sequence
            button.dispatchEvent(mouseDown);
            button.dispatchEvent(touchStart);
            button.dispatchEvent(mouseUp);
            button.dispatchEvent(touchEnd);
            button.dispatchEvent(click);
            
            // Also trigger native click as backup
            button.click();
            
            return true;
          } catch (e) {
            console.error("Tap error:", e);
            return false;
          }
        };
        
        // Better tapping mechanism with reliability checks
        let registeredClicks = 0;
        let failedClicks = 0;
        const batchSize = 50; // Smaller batches for more frequent verification
        
        // Loop through batches
        for (let batch = 0; batch < Math.ceil(maxTapsGoal / batchSize); batch++) {
          const batchStart = batch * batchSize;
          const batchEnd = Math.min(batchStart + batchSize, maxTapsGoal);
          
          // Process each batch
          for (let i = batchStart; i < batchEnd; i++) {
            await new Promise(resolve => {
              setTimeout(() => {
                const success = performTap();
                if (success) {
                  registeredClicks++;
                } else {
                  failedClicks++;
                }
                
                // Log progress periodically
                if ((registeredClicks + failedClicks) % 100 === 0 || i === batchEnd - 1) {
                  console.log(`✅ Tapped ${registeredClicks} times successfully (${failedClicks} failed)`);
                }
                resolve();
              }, 10 + Math.random() * 15); // Slightly longer delay between taps (10-25ms)
            });
          }
          
          // Re-select button in case page has changed
          button = document.querySelector("._tapArea_njdmz_15");
          if (!button) {
            console.warn("Button lost during tapping, searching for it again...");
            // Try some alternative selectors if the main one fails
            button = document.querySelector("[class*='tapArea']") || 
                    document.querySelector("[class*='tap']") ||
                    document.querySelector("button");
                    
            if (!button) {
              return {
                success: registeredClicks >= 1000, 
                taps: registeredClicks,
                reason: 'Button lost during tapping but already registered ' + registeredClicks + ' taps'
              };
            }
          }
          
          // Small delay between batches
          await new Promise(r => setTimeout(r, 100));
        }
        
        console.log(`💰 Completed all ${registeredClicks} taps (${failedClicks} failed)!`);
        
        // Wait for processing
        await new Promise(r => setTimeout(r, 2000));
        
        return {
          success: registeredClicks >= 1000, 
          taps: registeredClicks,
          failed: failedClicks
        };
      } catch (e) {
        console.error("Process error:", e);
        return {success: false, reason: e.message};
      }
    }, MAX_TAPS).catch(err => {
      return {success: false, reason: `Evaluation error: ${err.message}`};
    });

    console.log(`[${index + 1}] Tapping result:`, result);
    
    if (!result.success) {
      throw new Error(`Tapping failed: ${result.reason || 'Unknown error'}`);
    }
    
    console.log(`✅ [${index + 1}] Tapping completed: ${result.taps} taps registered (${result.failed || 0} failed)`);
    
    // Verify taps were registered by checking UI elements if possible
    try {
      const verificationResult = await page.evaluate(() => {
        // Look for any element that might indicate taps were registered
        // This is a generic approach and might need adjustment based on the site
        const counters = document.querySelectorAll("[class*='counter'], [class*='score'], [class*='count'], [class*='points']");
        if (counters.length > 0) {
          return {
            found: true,
            values: Array.from(counters).map(el => ({
              text: el.textContent,
              className: el.className
            }))
          };
        }
        return { found: false };
      });
      
      if (verificationResult.found) {
        console.log(`[${index + 1}] Found possible counters:`, verificationResult.values);
      }
    } catch (verifyErr) {
      console.log(`[${index + 1}] Verification check failed:`, verifyErr.message);
    }
    
    // Set cooldown for this token
    const cooldownUntil = Date.now() + (COOLDOWN_MINUTES * 60 * 1000);
    tokenCooldowns.set(token, cooldownUntil);
    console.log(`[${index + 1}] Set cooldown until ${new Date(cooldownUntil).toLocaleTimeString()}`);
    
    return { success: true, token, taps: result.taps };
  } catch (error) {
    console.error(`❌ [${index + 1}] Failed:`, error.message);
    return { success: false, token, reason: error.message };
  } finally {
    // Proper cleanup to reduce memory footprint
    await cleanupResources(page, browser);
    console.log(`[${index + 1}] Browser instance cleaned up`);
  }
}

// Queue processor function
async function processQueue() {
  // Check if we can process more tokens
  if (tokenQueue.length > 0 && activeBrowsers < MAX_CONCURRENT_BROWSERS) {
    const task = tokenQueue.shift();
    activeBrowsers++;
    
    try {
      await processTokenWithCooldown(task.token, task.index);
    } catch (err) {
      console.error(`Error in queue processing:`, err);
      activeBrowsers--; // Make sure to decrease counter if there's an error
      processQueue(); // Try next item
    }
  }
}

// Process tokens with cooldowns
async function processTokenWithCooldown(token, index) {
  try {
    const userAgent = userAgents[index % userAgents.length];
    
    // Process the token
    const result = await processAccount(token, userAgent, index);
    
    // Get the next run time based on cooldown
    const now = Date.now();
    const cooldownUntil = tokenCooldowns.get(token) || now;
    const waitTime = Math.max(10000, cooldownUntil - now);
    
    // Add a small random variation (0-60 seconds)
    const randomVariation = Math.floor(Math.random() * 60 * 1000);
    const nextRunTime = waitTime + randomVariation;
    
    // Schedule next run for this token
    console.log(`[${index + 1}] Next run in ${Math.ceil(nextRunTime/60000)} minutes`);
    setTimeout(() => {
      // Add to queue instead of running directly
      tokenQueue.push({ token, index });
      processQueue();
    }, nextRunTime);
    
  } catch (err) {
    console.error(`Fatal error processing token ${index+1}:`, err);
    
    // Retry after error with a delay
    console.log(`[${index + 1}] Retrying in 5 minutes due to error`);
    setTimeout(() => {
      tokenQueue.push({ token, index });
      processQueue();
    }, 5 * 60 * 1000);
  }
}

// Monitor and report memory usage
setInterval(() => {
  const memoryUsage = process.memoryUsage();
  console.log('Memory Usage:', {
    rss: `${Math.round(memoryUsage.rss / 1024 / 1024)} MB`,
    heapTotal: `${Math.round(memoryUsage.heapTotal / 1024 / 1024)} MB`,
    heapUsed: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)} MB`,
    external: `${Math.round(memoryUsage.external / 1024 / 1024)} MB`,
    activeBrowsers: activeBrowsers,
    queueLength: tokenQueue.length
  });
  
  // Force garbage collection if memory usage is high
  if (memoryUsage.heapUsed > 1024 * 1024 * 500) { // If heap usage exceeds 500MB
    console.log('High memory usage detected, forcing garbage collection');
    if (global.gc) global.gc();
  }
}, 60000); // Log memory usage every minute

// Start the process with improved queue system
(async () => {
  try {
    console.log(`Starting optimized processes for ${tokens.length} tokens with max ${MAX_CONCURRENT_BROWSERS} concurrent browsers`);
    console.log(`Targeting ${MAX_TAPS} taps to ensure at least 1000 register successfully`);
    
    // Start each token on its own schedule with a staggered start
    tokens.forEach((token, index) => {
      // Add to queue instead of running immediately
      const startDelay = index * 10000; // 10 seconds between queueing
      setTimeout(() => {
        tokenQueue.push({ token, index });
        processQueue();
      }, startDelay);
      
      console.log(`[${index + 1}] Scheduled to start in ${startDelay/1000} seconds`);
    });
    
  } catch (error) {
    console.error('Initialization error:', error);
    process.exit(1);
  }
})();
