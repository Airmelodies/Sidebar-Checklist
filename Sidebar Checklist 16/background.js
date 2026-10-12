/**
 * background.js — Service Worker (v5)
 *
 * Injection architecture (v5 — single MAIN world call):
 *   1. Background creates tab, waits for load, waits for React init
 *   2. ONE executeScript(world: "MAIN") call does everything:
 *      a. Dispatches Ctrl+K to open search
 *      b. Polls internally for the search input (no repeated executeScript calls)
 *      c. Once found, tries multiple injection methods in sequence
 *      d. Returns detailed results
 *
 *   This eliminates latency from repeatedly calling executeScript
 *   across the extension bridge.
 */

const ZUORA_URL = "https://eu.zuora.com/platform/webapp";

chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

/* ═══════════════════════════════════════════════════════
   LAUNCH ACCOUNTS
   ═══════════════════════════════════════════════════════ */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== "LAUNCH_ACCOUNTS") return false;

  const accounts = msg.accounts || [];
  console.log("[BG] ═══ LAUNCHING", accounts.length, "ACCOUNTS ═══");
  accounts.forEach((item, i) => console.log("[BG]   ", i + 1, "→", item.acct));

  accounts.forEach((item, index) => {
    const { acct, rowId } = item;

    setTimeout(() => {
      chrome.tabs.create({ url: ZUORA_URL }, (tab) => {
        if (!tab?.id) {
          console.error("[BG] Failed to create tab for:", acct);
          return;
        }

        console.log("[BG] Tab", tab.id, "created →", acct);

        function waitForTabLoad(tabId) {
          chrome.tabs.onUpdated.addListener(function listener(updatedTabId, changeInfo) {
            if (updatedTabId === tabId && changeInfo.status === "complete") {
              chrome.tabs.onUpdated.removeListener(listener);
              console.log("[BG] Tab", tabId, "page loaded, waiting 3s for React...");

              setTimeout(() => {
                runInjection(tabId, acct);
              }, 3000);
            }
          });
        }

        waitForTabLoad(tab.id);
      });

    }, index * 800);
  });

  return true;
});

/* ═══════════════════════════════════════════════════════
   RUN INJECTION — single executeScript call
   ═══════════════════════════════════════════════════════ */

async function runInjection(tabId, acct) {
  try {
    console.log("[BG] ── Starting injection: tab", tabId, "| acct:", acct);

    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: async (accountNumber) => {
        // ═══════════════════════════════════════════
        // Helper: sleep
        // ═══════════════════════════════════════════
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));

        // ═══════════════════════════════════════════
        // Step 1: Dispatch Ctrl+K
        // ═══════════════════════════════════════════
        console.log("[INJECT] Dispatching Ctrl+K...");

        // Also try Cmd+K (macOS) alongside Ctrl+K
        document.dispatchEvent(new KeyboardEvent("keydown", {
          key: "k", code: "KeyK", keyCode: 75, which: 75,
          ctrlKey: true, metaKey: false, bubbles: true, cancelable: true,
        }));
        document.dispatchEvent(new KeyboardEvent("keyup", {
          key: "k", code: "KeyK", keyCode: 75, which: 75,
          ctrlKey: true, metaKey: false, bubbles: true, cancelable: true,
        }));

        // ═══════════════════════════════════════════
        // Step 2: Poll for search input (internal polling)
        // ═══════════════════════════════════════════
        console.log("[INJECT] Polling for search input...");

        const SELECTOR = 'input[data-e2e="search-input"]';
        const MAX_WAIT = 12000;
        const POLL_MS = 250;
        let elapsed = 0;
        let el = null;

        while (elapsed < MAX_WAIT) {
          await sleep(POLL_MS);
          elapsed += POLL_MS;
          el = document.querySelector(SELECTOR);
          if (el) {
            console.log("[INJECT] Found search input after", elapsed, "ms");
            break;
          }
        }

        if (!el) {
          console.error("[INJECT] ❌ Search input NEVER appeared after", MAX_WAIT, "ms");
          console.log("[INJECT] Dumping all inputs on page:");
          document.querySelectorAll('input').forEach((inp, i) => {
            console.log("[INJECT]   input[" + i + "]:", inp.type, "|", inp.placeholder, "|", inp.className, "|", inp.getAttribute('data-e2e') || 'no data-e2e');
          });
          return { success: false, error: "Search input not found", debugTime: elapsed };
        }

        // ═══════════════════════════════════════════
        // Step 3: Wait for React to wire up event handlers
        // ═══════════════════════════════════════════
        console.log("[INJECT] Input found, waiting 500ms for React handlers...");
        await sleep(500);

        // ═══════════════════════════════════════════
        // Method 1: execCommand('insertText')
        // ═══════════════════════════════════════════
        console.log("[INJECT] Method 1: execCommand insertText...");
        el.focus();
        await sleep(100);
        el.select();
        await sleep(50);
        el.value = '';
        await sleep(50);

        const execResult = document.execCommand('insertText', false, accountNumber);
        console.log("[INJECT]   execCommand returned:", execResult, "| value:", el.value);
        await sleep(200);

        if (el.value === accountNumber) {
          console.log("[INJECT] ✅ SUCCESS via execCommand!");
          return { success: true, method: "execCommand", value: el.value };
        }

        // ═══════════════════════════════════════════
        // Method 2: Native setter + InputEvent
        // ═══════════════════════════════════════════
        console.log("[INJECT] Method 2: Native setter + InputEvent...");
        el.focus();
        await sleep(100);

        const nativeSetter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype, 'value'
        ).set;
        nativeSetter.call(el, accountNumber);

        el.dispatchEvent(new InputEvent('input', {
          bubbles: true, cancelable: true, data: accountNumber, inputType: 'insertText',
        }));
        el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
        await sleep(200);

        console.log("[INJECT]   value after setter:", el.value);
        if (el.value === accountNumber) {
          console.log("[INJECT] ✅ SUCCESS via native setter!");
          return { success: true, method: "nativeSetter", value: el.value };
        }

        // ═══════════════════════════════════════════
        // Method 3: execCommand on empty (try without select first)
        // ═══════════════════════════════════════════
        console.log("[INJECT] Method 3: execCommand on clean input...");
        el.focus();
        await sleep(100);
        el.value = '';
        nativeSetter.call(el, '');
        el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'deleteContentBackward' }));
        await sleep(100);

        const execResult2 = document.execCommand('insertText', false, accountNumber);
        console.log("[INJECT]   execCommand2 returned:", execResult2, "| value:", el.value);
        await sleep(200);

        if (el.value === accountNumber) {
          console.log("[INJECT] ✅ SUCCESS via execCommand clean!");
          return { success: true, method: "execCommandClean", value: el.value };
        }

        // ═══════════════════════════════════════════
        // Method 4: Character-by-character
        // ═══════════════════════════════════════════
        console.log("[INJECT] Method 4: Character-by-character...");
        el.focus();
        el.value = '';
        nativeSetter.call(el, '');
        await sleep(100);

        for (let i = 0; i < accountNumber.length; i++) {
          const char = accountNumber[i];
          nativeSetter.call(el, el.value + char);
          el.dispatchEvent(new InputEvent('input', {
            bubbles: true, cancelable: true, data: char, inputType: 'insertText',
          }));
          await sleep(50);
        }
        el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
        await sleep(200);

        console.log("[INJECT]   value after charByChar:", el.value);
        if (el.value === accountNumber) {
          console.log("[INJECT] ✅ SUCCESS via charByChar!");
          return { success: true, method: "charByChar", value: el.value };
        }

        // ═══════════════════════════════════════════
        // ALL METHODS FAILED
        // ═══════════════════════════════════════════
        console.error("[INJECT] ❌ ALL methods failed");
        console.error("[INJECT]   Final input value:", el.value);
        console.error("[INJECT]   Expected:", accountNumber);
        console.error("[INJECT]   input.disabled:", el.disabled);
        console.error("[INJECT]   input.readOnly:", el.readOnly);
        console.error("[INJECT]   document.activeElement === input:", document.activeElement === el);
        console.error("[INJECT]   input.outerHTML (truncated):", el.outerHTML.substring(0, 300));

        return {
          success: false,
          error: "All injection methods failed",
          finalValue: el.value,
          expected: accountNumber
        };
      },
      args: [acct]
    });

    const result = results?.[0]?.result;
    if (result?.success) {
      console.log("[BG] ✅", acct, "→", result.method, "| value:", result.value);
    } else {
      console.error("[BG] ❌", acct, "→", result?.error);
      if (result?.debugTime) console.error("[BG]   Polled for", result.debugTime, "ms");
      if (result?.finalValue) console.error("[BG]   Final value:", result.finalValue, "| expected:", result.expected);
    }

  } catch (err) {
    console.error("[BG] executeScript error for tab", tabId, ":", err);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
