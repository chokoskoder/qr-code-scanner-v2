// This is the service worker (background.js)
try {
  importScripts('jsQR.js');
  console.log("jsQR.js loaded successfully via importScripts at top level.");
} catch (e) {
  console.error("CRITICAL: Failed to load jsQR.js at top level:", e);
  // Extension might not function without jsQR
}

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
    return true;
  } else if (message.action === "captureVisibleTabAndCrop") {
    console.log("Background received 'captureVisibleTabAndCrop' action with rect:", message.rect);
    const { x, y, width, height, devicePixelRatio } = message.rect;

    chrome.tabs.captureVisibleTab(null, { format: "png" }, async (dataUrl) => {
      if (chrome.runtime.lastError || !dataUrl) {
        console.error("Failed to capture visible tab:", chrome.runtime.lastError?.message);
        sendResponse({ status: "error", error: "Failed to capture screen. " + (chrome.runtime.lastError?.message || "No data URL") });
        return;
      }
      console.log("Tab captured, full screenshot dataUrl length (approx):", dataUrl ? dataUrl.length : 'null');

      try {
        const image = await createImageBitmapFromDataURL(dataUrl); // This dataUrl is the full screenshot
        const cropCanvas = new OffscreenCanvas(width * devicePixelRatio, height * devicePixelRatio);
        const cropCtx = cropCanvas.getContext('2d');

        if (!cropCtx) {
            throw new Error("Could not get 2D context from OffscreenCanvas for cropping.");
        }
        cropCtx.drawImage(
          image,
          x * devicePixelRatio, y * devicePixelRatio,
          width * devicePixelRatio, height * devicePixelRatio,
          0, 0,
          width * devicePixelRatio, height * devicePixelRatio
        );
        const croppedDataUrl = await cropCanvas.convertToBlob({ type: 'image/png' }).then(blob => {
            return new Promise(resolve => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result);
                reader.readAsDataURL(blob);
            });
        });
        console.log("Image cropped, croppedDataUrl length (approx):", croppedDataUrl ? croppedDataUrl.length : 'null');
        sendResponse({ status: "success", dataUrl: croppedDataUrl });
      } catch (error) {
        console.error("Error during image cropping process:", error);
        sendResponse({ status: "error", error: `Error cropping image: ${error.message}` });
      }
    });
    return true;
  } else if (message.action === "captureDone") {
    console.log("Background received image dataURI for QR decoding (this is the cropped image).");
    decodeQrCodeFromDataUrl(message.dataUrl, sendResponse); // Pass the dataUrl from message
    return true;
  } else {
    console.warn("Received an unknown action in background.js:", message.action);
  }
});

async function decodeQrCodeFromDataUrl(dataUrl, sendResponse) {
  // Log the dataURL to allow viewing the image being processed
  console.log("Attempting to decode QR from this dataURL (copy and paste into a new browser tab to view):", dataUrl);

  try {
    // Ensure jsQR is loaded
    if (typeof jsQR !== 'function') {
        console.error("jsQR function not available. Library might not have loaded.");
        sendResponse({ status: "Error", data: "QR decoding library not properly loaded." });
        return;
    }

    const image = await createImageBitmapFromDataURL(dataUrl); // This dataUrl is the cropped image
    const canvas = new OffscreenCanvas(image.width, image.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        throw new Error("Could not get 2D context from OffscreenCanvas for decoding.");
    }
    ctx.drawImage(image, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    console.log(`Decoding image with dimensions: ${imageData.width}x${imageData.height}`);

    const code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: "attemptBoth",
    });

    if (code && code.data) {
      console.log("QR Code found:", code.data);
      const notificationMessage = `Decoded Data: ${code.data.substring(0, 100)}${code.data.length > 100 ? '...' : ''}`;
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'images/icon48.png',
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
      console.log("No QR Code found by jsQR or could not decode.");
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'images/icon48.png',
        title: 'QR Scan Failed',
        message: 'No QR code found in the selected area.'
      });
      sendResponse({ status: "Error", data: "No QR code found." });
    }
  } catch (error) {
    console.error("Error during QR decoding process:", error);
    sendResponse({ status: "Error", data: `Error decoding QR: ${error.message}` });
  }
}

async function createImageBitmapFromDataURL(dataURL) {
  console.log("createImageBitmapFromDataURL called. dataURL length:", dataURL ? dataURL.length : 'null or undefined');
  // Basic sanity check for the dataURL format
  if (!dataURL || typeof dataURL !== 'string' || !dataURL.startsWith('data:image/')) {
    console.error("Invalid or malformed dataURL received in createImageBitmapFromDataURL:", dataURL);
    throw new Error("Invalid or malformed dataURL provided to createImageBitmapFromDataURL.");
  }

  try {
    const res = await fetch(dataURL);
    console.log(`Fetched dataURL. Status: ${res.status}, OK: ${res.ok}`);

    if (!res.ok) {
      const errorText = await res.text().catch(() => "Could not read error text from failed fetch.");
      console.error(`Fetch failed for dataURL. Status: ${res.status}. Response text: ${errorText}`);
      throw new Error(`Fetch failed for dataURL: ${res.status} ${res.statusText}. Body: ${errorText}`);
    }

    const blob = await res.blob();
    console.log(`Blob created from dataURL. Type: ${blob.type}, Size: ${blob.size}`);

    if (blob.size === 0) {
      console.error("Blob created from dataURL is empty (size 0).");
      throw new Error("Blob from dataURL is empty.");
    }

    if (!blob.type.startsWith('image/')) {
        console.error(`Blob is not an image type. Type: ${blob.type}`);
        throw new Error(`Blob is not an image type: ${blob.type}`);
    }

    return createImageBitmap(blob);
  } catch (error) {
    console.error("Error within createImageBitmapFromDataURL processing:", error.message);
    // Re-throw the error to be caught by the caller, adding more context
    throw new Error(`Failed in createImageBitmapFromDataURL: ${error.message}`);
  }
}

console.log("QR Code Snip & Scan service worker started/restarted.");
