// This is the service worker (background.js)

// Import jsQR library - In a real extension, you'd bundle this or ensure it's available.
// For this example, we'll assume it's globally available or you'd use dynamic import.
// If jsQR is not bundled, you might need to load it via importScripts() in MV3 for service workers
// or ensure it's included in your build process.
// For simplicity, we'll just call its function later.
// import jsQR from './jsQR.js'; // Example if bundled

chrome.runtime.onInstalled.addListener(() => {
  console.log('QR Code Snip & Scan extension installed/updated.');
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Message received in background.js:', message, 'From sender:', sender);

  if (message.action === "startSnipMode") {
    console.log("Background script received 'startSnipMode' action.");
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs && tabs.length > 0) {
        const activeTab = tabs[0];
        if (activeTab.id) {
          chrome.scripting.insertCSS({
            target: { tabId: activeTab.id },
            files: ["content/snipper.css"]
          }).then(() => {
            console.log("CSS injected successfully.");
            return chrome.scripting.executeScript({
              target: { tabId: activeTab.id },
              files: ["content/snipper.js"]
            });
          }).then(() => {
            console.log("Content script (snipper.js) injected successfully.");
            sendResponse({ status: "Snip mode initiated, scripts injected.", tabId: activeTab.id });
          }).catch(err => {
            console.error("Error injecting scripts:", err);
            sendResponse({ status: "Error injecting scripts", error: err.message });
          });
        } else {
          console.error("Active tab has no ID.");
          sendResponse({ status: "Error: Active tab has no ID." });
        }
      } else {
        console.error("No active tab found.");
        sendResponse({ status: "Error: No active tab found" });
      }
    });
    return true; // Keep message channel open for async response
  } else if (message.action === "captureVisibleTabAndCrop") {
    console.log("Background received 'captureVisibleTabAndCrop' action with rect:", message.rect);
    const { x, y, width, height, devicePixelRatio } = message.rect;

    chrome.tabs.captureVisibleTab(null, { format: "png" }, async (dataUrl) => {
      if (chrome.runtime.lastError || !dataUrl) {
        console.error("Failed to capture visible tab:", chrome.runtime.lastError?.message);
        sendResponse({ status: "error", error: "Failed to capture screen. " + (chrome.runtime.lastError?.message || "No data URL") });
        return;
      }
      console.log("Tab captured, dataUrl length:", dataUrl.length);

      try {
        const image = await createImageBitmapFromDataURL(dataUrl);
        
        // Create an OffscreenCanvas for the cropped image
        // Adjust coordinates and dimensions by devicePixelRatio for accurate cropping
        const cropCanvas = new OffscreenCanvas(width * devicePixelRatio, height * devicePixelRatio);
        const cropCtx = cropCanvas.getContext('2d');

        if (!cropCtx) {
            throw new Error("Could not get 2D context from OffscreenCanvas for cropping.");
        }

        // Draw the specific portion of the captured image onto the cropCanvas
        cropCtx.drawImage(
          image,
          x * devicePixelRatio, // sourceX
          y * devicePixelRatio, // sourceY
          width * devicePixelRatio,  // sourceWidth
          height * devicePixelRatio, // sourceHeight
          0,                    // destX
          0,                    // destY
          width * devicePixelRatio,  // destWidth
          height * devicePixelRatio  // destHeight
        );

        // Get the data URL of the cropped image
        const croppedDataUrl = await cropCanvas.convertToBlob({ type: 'image/png' }).then(blob => {
            return new Promise(resolve => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result);
                reader.readAsDataURL(blob);
            });
        });

        console.log("Image cropped, croppedDataUrl length:", croppedDataUrl.length);
        sendResponse({ status: "success", dataUrl: croppedDataUrl });

      } catch (error) {
        console.error("Error during image cropping:", error);
        sendResponse({ status: "error", error: `Error cropping image: ${error.message}` });
      }
    });
    return true; // VERY IMPORTANT: Indicates an asynchronous response.
  } else if (message.action === "captureDone") {
    console.log("Background received captured image dataURI for decoding.");
    decodeQrCodeFromDataUrl(message.dataUrl, sendResponse);
    return true; // Keep message channel open for async response from QR decoding
  } else {
    console.warn("Received an unknown action in background.js:", message.action);
    // Optionally send a response for unknown actions if the sender expects one
    // sendResponse({ status: "Unknown action" }); 
  }
  // If not returning true for an async sendResponse, the channel might close.
});

async function decodeQrCodeFromDataUrl(dataUrl, sendResponse) {
  try {
    const image = await createImageBitmapFromDataURL(dataUrl);
    const canvas = new OffscreenCanvas(image.width, image.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        throw new Error("Could not get 2D context from OffscreenCanvas for decoding.");
    }
    ctx.drawImage(image, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    if (typeof jsQR === 'undefined') {
        console.warn("jsQR library is not loaded! Attempting to load dynamically...");
        try {
            importScripts('jsQR.js'); // Assumes jsQR.js is in the root of the extension
            console.log("jsQR loaded dynamically via importScripts.");
        } catch (e) {
            console.error("Failed to load jsQR dynamically:", e);
            sendResponse({ status: "Error", data: "QR decoding library not available." });
            return;
        }
    }

    const code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: "dontInvert", // Or "attemptBoth" if needed
    });

    if (code && code.data) {
      console.log("QR Code found:", code.data);
      const notificationMessage = `Decoded Data: ${code.data.substring(0, 100)}${code.data.length > 100 ? '...' : ''}`;
      chrome.notifications.create({
        type: 'basic',
        iconUrl: chrome.runtime.getURL('images/icon48.png'),
        title: 'QR Code Scanned!',
        message: notificationMessage
      }, (notificationId) => {
        if (chrome.runtime.lastError) {
            console.error("Notification error:", chrome.runtime.lastError.message);
        } else {
            console.log("Notification shown:", notificationId);
        }
      });
      sendResponse({ status: "Success", data: code.data });
    } else {
      console.log("No QR Code found or could not decode.");
      chrome.notifications.create({
        type: 'basic',
        iconUrl: chrome.runtime.getURL('images/icon48.png'),
        title: 'QR Scan Failed',
        message: 'No QR code found in the selected area.'
      });
      sendResponse({ status: "Error", data: "No QR code found." });
    }
  } catch (error) {
    console.error("Error decoding QR code:", error);
    sendResponse({ status: "Error", data: `Error decoding: ${error.message}` });
  }
}

async function createImageBitmapFromDataURL(dataURL) {
  const res = await fetch(dataURL);
  const blob = await res.blob();
  return createImageBitmap(blob);
}

console.log("QR Code Snip & Scan service worker started/restarted.");
