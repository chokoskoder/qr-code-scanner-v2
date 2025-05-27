// content/snipper.js - Handles the snipping UI and capturing

(function() {
    // Prevent multiple injections if script is already running
    if (window.hasRunQrSnipper) {
        return;
    }
    window.hasRunQrSnipper = true;

    console.log("QR Snipper content script loaded.");

    let startX, startY, endX, endY;
    let isSelecting = false;
    let overlayDiv = null;
    let selectionBox = null;

    function createOverlay() {
        if (document.getElementById('qrSnipOverlay')) return; // Already exists

        overlayDiv = document.createElement('div');
        overlayDiv.id = 'qrSnipOverlay';
        // Styles are mostly in snipper.css, but some initial setup here
        overlayDiv.style.position = 'fixed';
        overlayDiv.style.left = '0';
        overlayDiv.style.top = '0';
        overlayDiv.style.width = '100vw';
        overlayDiv.style.height = '100vh';
        overlayDiv.style.zIndex = '2147483640'; // High z-index
        overlayDiv.style.cursor = 'crosshair';
        overlayDiv.style.backgroundColor = 'rgba(0, 0, 0, 0.3)'; // Semi-transparent overlay

        selectionBox = document.createElement('div');
        selectionBox.id = 'qrSnipSelectionBox';
        // Styles in snipper.css
        overlayDiv.appendChild(selectionBox);
        document.body.appendChild(overlayDiv);

        overlayDiv.addEventListener('mousedown', handleMouseDown);
        overlayDiv.addEventListener('mousemove', handleMouseMove);
        overlayDiv.addEventListener('mouseup', handleMouseUp);
        
        // Add Escape key listener to cancel
        document.addEventListener('keydown', handleKeyDown);

        console.log("Overlay created.");
    }

    function handleKeyDown(event) {
        if (event.key === "Escape") {
            console.log("Snipping cancelled by Escape key.");
            cleanup();
        }
    }

    function handleMouseDown(event) {
        // Prevent default browser actions like text selection or image dragging
        event.preventDefault(); 
        
        isSelecting = true;
        startX = event.clientX;
        startY = event.clientY;
        selectionBox.style.left = startX + 'px';
        selectionBox.style.top = startY + 'px';
        selectionBox.style.width = '0px';
        selectionBox.style.height = '0px';
        selectionBox.style.border = '2px dashed #007bff'; // Visible selection border
        selectionBox.style.display = 'block'; // Make it visible
        console.log("Mouse down at:", startX, startY);
    }

    function handleMouseMove(event) {
        if (!isSelecting) return;
        event.preventDefault();

        endX = event.clientX;
        endY = event.clientY;

        let width = Math.abs(endX - startX);
        let height = Math.abs(endY - startY);
        let left = Math.min(startX, endX);
        let top = Math.min(startY, endY);

        selectionBox.style.width = width + 'px';
        selectionBox.style.height = height + 'px';
        selectionBox.style.left = left + 'px';
        selectionBox.style.top = top + 'px';
    }

    function handleMouseUp(event) {
        if (!isSelecting) return;
        event.preventDefault();
        isSelecting = false;
        console.log("Mouse up. Selection complete.");

        // Ensure a minimal selection area to avoid tiny/accidental captures
        const selectedWidth = parseInt(selectionBox.style.width, 10);
        const selectedHeight = parseInt(selectionBox.style.height, 10);

        if (selectedWidth < 10 || selectedHeight < 10) {
            console.log("Selection too small, cancelling.");
            cleanup();
            return;
        }
        
        // Temporarily hide the overlay to capture the underlying page content
        overlayDiv.style.display = 'none';

        // Capture the screen area
        // chrome.tabs.captureVisibleTab is not available in content scripts.
        // We need to ask the background script to do this.
        // For simplicity here, we'll try to capture the selected area using HTML Canvas
        // by drawing the relevant part of the document.body. This is complex.
        // A more robust way is to send coordinates to background and use captureVisibleTab then crop.

        // Let's send a message to background to capture the screen, then crop.
        // The coordinates are relative to the viewport.
        const rect = {
            x: parseInt(selectionBox.style.left, 10),
            y: parseInt(selectionBox.style.top, 10),
            width: selectedWidth,
            height: selectedHeight,
            devicePixelRatio: window.devicePixelRatio // Important for high DPI screens
        };
        
        console.log("Capturing area:", rect);

        // Use a short timeout to ensure the overlay is hidden before capture
        setTimeout(() => {
            chrome.runtime.sendMessage({ action: "captureVisibleTabAndCrop", rect: rect }, (response) => {
                if (chrome.runtime.lastError) {
                    console.error("Error sending capture request or receiving response:", chrome.runtime.lastError.message);
                    alert("Error capturing screen: " + chrome.runtime.lastError.message + "\nTry reloading the page and the extension.");
                } else if (response && response.status === "success" && response.dataUrl) {
                    console.log("Background script sent cropped image dataURL.");
                    // Now send this dataURL to the background script for QR decoding
                    chrome.runtime.sendMessage({ action: "captureDone", dataUrl: response.dataUrl }, (decodeResponse) => {
                        if (chrome.runtime.lastError) {
                            console.error("Error sending dataUrl for decoding:", chrome.runtime.lastError.message);
                        } else {
                            console.log("Response from QR decoding:", decodeResponse);
                        }
                        // Display result or cleanup further if needed
                    });
                } else {
                    console.error("Failed to get cropped image from background.", response);
                    alert("Failed to capture the selected area. " + (response ? response.error : "Unknown error."));
                }
                cleanup(); // Clean up the overlay regardless of capture success/failure
            });
        }, 50); // 50ms delay, adjust if needed
    }
    
    // This message listener is for messages from the background script TO this content script
    // (if we needed two-way comms initiated by background after injection)
    // chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    //   if (message.action === "doSomethingInContent") {
    //     console.log("Content script received:", message);
    //     sendResponse({status: "Done in content."});
    //   }
    // });


    function cleanup() {
        if (overlayDiv) {
            overlayDiv.removeEventListener('mousedown', handleMouseDown);
            overlayDiv.removeEventListener('mousemove', handleMouseMove);
            overlayDiv.removeEventListener('mouseup', handleMouseUp);
            document.body.removeChild(overlayDiv);
            overlayDiv = null;
            selectionBox = null;
        }
        document.removeEventListener('keydown', handleKeyDown);
        window.hasRunQrSnipper = false; // Allow re-injection if needed
        console.log("Snipper overlay cleaned up.");
    }

    // --- Initialize ---
    createOverlay();

})(); // IIFE to encapsulate scope
