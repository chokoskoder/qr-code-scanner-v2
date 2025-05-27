// Import jsQR at the top - this works when not using module type
importScripts('jsQR.js');

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
      console.log("Tab captured, dataUrl length:", dataUrl.length);

      try {
        const image = await createImageBitmapFromDataURL(dataUrl);
        
        const cropCanvas = new OffscreenCanvas(width * devicePixelRatio, height * devicePixelRatio);
        const cropCtx = cropCanvas.getContext('2d');

        if (!cropCtx) {
            throw new Error("Could not get 2D context from OffscreenCanvas for cropping.");
        }

        cropCtx.drawImage(
          image,
          x * devicePixelRatio,
          y * devicePixelRatio,
          width * devicePixelRatio,
          height * devicePixelRatio,
          0,
          0,
          width * devicePixelRatio,
          height * devicePixelRatio
        );

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
    return true;
  } else if (message.action === "captureDone") {
    console.log("Background received captured image dataURI for decoding.");
    decodeQrCodeFromDataUrl(message.dataUrl, sendResponse);
    return true;
  } else {
    console.warn("Received an unknown action in background.js:", message.action);
  }
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

    // jsQR should be available since we imported it at the top
    if (typeof jsQR === 'undefined') {
        console.error("jsQR library is not available!");
        sendResponse({ status: "Error", data: "QR decoding library not available." });
        return;
    }

    const code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: "dontInvert",
    });

    if (code && code.data) {
      console.log("QR Code found:", code.data);
      sendResponse({ status: "Success", data: code.data });
    } else {
      console.log("No QR Code found or could not decode.");
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