<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import * as VIAM from '@viamrobotics/sdk';
  import Cookies from 'js-cookie';

  let machine: VIAM.RobotClient | null = null;
  let videoElement: HTMLVideoElement;
  let stream: VIAM.StreamClient | null = null;
  let imageSrc: string | null = null;
  let ocrReadings: any = null;
  let error: string | null = null;
  let isConnecting = true;
  let isConnected = false;
  let isStreamActive = false;   
  let mediaStreamRef: MediaStream | null = null;
  let cameraError: string | null = null;

  // Demo control states
  let showReceiptImage = false;
  let showReceiptData = false;

  // Initialize connection on mount
  onMount(() => {
    initializeConnection();
    
    // Cleanup on unmount
    return () => {
      if (stream) {
        // Clean up stream
        if (videoElement && videoElement.srcObject) {
          const mediaStream = videoElement.srcObject as MediaStream;
          mediaStream.getTracks().forEach(track => track.stop());
        }
      }
      if (machine) {
        machine.disconnect();
      }
    };
  });

  async function initializeConnection() {
    try {
      const machineCookieKey = window.location.pathname.split("/")[2];
      const cookieData = machineCookieKey ? Cookies.get(machineCookieKey) : null;
      if (!cookieData) {
        throw new Error("No connection data found. Please log in again.");
      }

      const connectionConfig = JSON.parse(cookieData);
      console.log("Connecting to:", connectionConfig.hostname);

      // Connect to the machine with a timeout
      const connectionTimeout = new Promise((_, reject) => 
        setTimeout(() => reject(new Error("Connection timeout - machine may be offline")), 10000)
      );

      const connectionPromise = VIAM.createRobotClient({
        host: connectionConfig.hostname,
        credentials: {
          type: "api-key",
          authEntity: connectionConfig.apiKey.id,
          payload: connectionConfig.apiKey.key,
        },
        signalingAddress: "https://app.viam.com:443",
      });

      // Race between connection and timeout
      machine = await Promise.race([connectionPromise, connectionTimeout]) as VIAM.RobotClient;

      console.log("Successfully connected to machine");
      isConnected = true;
      
      await tick();

      // Initialize camera stream
      await initializeCameraStream();

      // Load data but don't show it initially
      await loadOCR();
    } catch (err) {
      console.error("Connection error:", err);
      error = err instanceof Error ? err.message : "Failed to connect";
    } finally {
      isConnecting = false;
    }
  }

  async function initializeCameraStream() {
    if (!machine) return;
    try {
      console.log("[CAMERA] Initializing camera stream...");

      // cleanup any old stream
      if (stream) {
        try {
          const old = videoElement?.srcObject as MediaStream | null;
          old?.getTracks().forEach(t => t.stop());
          if (videoElement) videoElement.srcObject = null;
          await stream.remove("web-camera");
        } catch (e) {
          console.warn("[CAMERA] cleanup:", e);
        }
      }

      const cameraName = "web-camera";

      // quick probe for static image
      try {
        const cam = new VIAM.CameraClient(machine, cameraName);
        const img = await cam.getImage();
        console.log("[CAMERA] static image size:", img.length);
      } catch {}

      // get the actual MediaStream and store it
      stream = new VIAM.StreamClient(machine);
      console.log("[CAMERA] StreamClient created");
      const ms = await stream.getStream(cameraName);
      console.log("[CAMERA] got MediaStream", { active: ms.active, id: ms.id, tracks: ms.getTracks().length });

      mediaStreamRef = ms;
      isStreamActive = ms.active;

      const [track] = ms.getVideoTracks();
      if (track) track.onended = () => { isStreamActive = false; };

      cameraError = null;
    } catch (err) {
      console.error("[CAMERA] init error:", err);
      cameraError = err instanceof Error ? err.message : "Camera stream unavailable";
    }
  }

  $: if (videoElement && mediaStreamRef && videoElement.srcObject !== mediaStreamRef) {
    console.log("[CAMERA] Attaching stream to <video>");
    videoElement.srcObject = mediaStreamRef;
    videoElement.muted = true;
    const p = videoElement.play();
    if (p && typeof p.then === "function") {
      p.catch(() => { cameraError = "Click to start camera stream"; });
    }
  }

  async function loadOCR() {
    if (!machine) return;
    try {
      // Load OCR image
      const camera = new VIAM.CameraClient(machine, "ocr-image");
      const image = await camera.getImage();
      imageSrc = URL.createObjectURL(new Blob([image], { type: "image/jpeg" }));

      // Load OCR sensor data
      const sensor = new VIAM.SensorClient(machine, "google-vision-sensor-ocr");
      ocrReadings = await sensor.getReadings();

      error = null;
    } catch (err) {
      console.error("Error loading OCR:", err);
      error = err instanceof Error ? err.message : "Failed to load OCR data";
    }
  }

  onDestroy(() => {
    const ms = videoElement?.srcObject as MediaStream | null;
    ms?.getTracks().forEach(t => t.stop());
    stream?.remove?.("web-camera").catch(() => {});
    machine?.disconnect?.();
  });

  // Demo control functions
  function processWebcam() {
    showReceiptImage = true;
  }

  function processReceipt() {
    showReceiptData = true;
  }

  function resetDemo() {
    showReceiptImage = false;
    showReceiptData = false;
  }
</script>

<div class="dashboard">
  <div class="header">
    <h1>OCR Dashboard</h1>
  </div>

  {#if isConnecting}
    <div class="status-card connecting">
      <div class="loading-spinner"></div>
      <p>Connecting to machine...</p>
    </div>
  {:else if error}
    <div class="status-card error">
      <p>⚠️ {error}</p>
    </div>
  {:else if isConnected}
    <!-- Demo Control Panel -->
    <div class="demo-controls">
      <button on:click={processWebcam} disabled={!isStreamActive || showReceiptImage}>
        📸 Process Webcam → Receipt Image
      </button>
      <button on:click={processReceipt} disabled={!showReceiptImage || showReceiptData}>
        🔍 Process Receipt → Extract Data
      </button>
      <button on:click={resetDemo} class="reset-btn">
        🔄 Reset Demo
      </button>
    </div>

    <div class="content">
      <!-- Left: Web Camera -->
      <div class="web-camera-section">
        <div class="camera-card card">
          <h2>📹 Web Camera</h2>
          <div class="image-container">
            <video
              bind:this={videoElement}
              autoplay
              playsinline
              muted
              on:loadedmetadata={() => (error = null)}
              on:error={() => (error = "Web camera stream unavailable")}>
            </video>

            {#if !isStreamActive}
              <div class="overlay">
                <div>
                  <p>{error || 'Starting camera…'}</p>
                  <button class="retry-button" on:click={() => videoElement?.play?.()}>Start Stream</button>
                </div>
              </div>
            {/if}
          </div>
        </div>
      </div>

      <!-- Middle: Receipt Image -->
      <div class="receipt-section">
        <div class="camera-card card">
          <h2>📷 Receipt Image</h2>
          {#if showReceiptImage && imageSrc}
            <div class="image-container">
              <img src={imageSrc} alt="Receipt" />
            </div>
          {:else if showReceiptImage}
            <div class="placeholder">
              <p>No receipt image loaded.</p>
            </div>
          {:else}
            <div class="placeholder">
              <p>🔄 Process webcam to extract receipt image</p>
            </div>
          {/if}
        </div>
      </div>

      <!-- Right: OCR Results -->
      <div class="ocr-section card">
        {#if showReceiptData && ocrReadings}
          <div class="ocr-content">
            <div class="store-info">
              <h2 class="store-name">🏪 {ocrReadings.store?.name || "Store"}</h2>
              {#if ocrReadings.store?.address_lines}
                <div class="address">
                  {#each ocrReadings.store.address_lines as line}
                    <div>{line}</div>
                  {/each}
                </div>
              {/if}
            </div>

            <div class="totals-card">
              <h3>💰 Transaction Summary</h3>
              <div class="totals-grid">
                <div class="total-item">
                  <span class="label">Subtotal:</span>
                  <span class="value">${ocrReadings.totals?.subtotal?.toFixed(2)}</span>
                </div>
                <div class="total-item">
                  <span class="label">Tax:</span>
                  <span class="value">${ocrReadings.totals?.tax?.toFixed(2)}</span>
                </div>
                <div class="total-item grand-total">
                  <span class="label">Total:</span>
                  <span class="value">${ocrReadings.totals?.total?.toFixed(2)}</span>
                </div>
              </div>
            </div>

            <div class="items-section">
              <h3>🛒 Items ({ocrReadings.items?.length || 0})</h3>
              {#if ocrReadings.items && ocrReadings.items.length > 0}
                <div class="table-container">
                  <div class="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Description</th>
                          <th class="price-col">Price</th>
                        </tr>
                      </thead>
                      <tbody>
                        {#each ocrReadings.items || [] as item}
                          <tr>
                            <td class="description">{item.desc}</td>
                            <td class="price">${item.price?.toFixed(2)}</td>
                          </tr>
                        {/each}
                      </tbody>
                    </table>
                  </div>
                </div>
              {:else}
                <div class="placeholder">
                  <p>No items found</p>
                </div>
              {/if}
            </div>

            <div class="metrics-card">
              <h3>📊 Analysis</h3>
              <div class="metrics-grid">
                <div class="metric">
                  <span class="metric-label">Item Count:</span>
                  <span class="metric-value">{ocrReadings.metrics?.item_count || 0}</span>
                </div>
                <div class="metric">
                  <span class="metric-label">Unique Items:</span>
                  <span class="metric-value">{ocrReadings.metrics?.unique_descriptions || 0}</span>
                </div>
              </div>
            </div>
          </div>
        {:else}
          <div class="placeholder">
            <h2>📊 OCR Results</h2>
            <p>🔄 Process receipt image to extract transaction data</p>
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
* {
  box-sizing: border-box;
}

.dashboard {
  height: 100vh;
  width: 100%;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  padding: clamp(0.5rem, 2vw, 1.5rem);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.header {
  text-align: center;
  margin-bottom: clamp(0.5rem, 1.5vw, 1rem);
  flex-shrink: 0;
}

h1 {
  color: white;
  font-size: clamp(1.2rem, 4vw, 2rem);
  font-weight: 700;
  margin: 0;
  text-shadow: 0 2px 4px rgba(0,0,0,0.3);
}

.demo-controls {
  display: flex;
  justify-content: center;
  gap: clamp(0.5rem, 1.5vw, 1rem);
  margin-bottom: clamp(0.5rem, 1.5vw, 1rem);
  flex-wrap: wrap;
  flex-shrink: 0;
}

.demo-controls button {
  background: white;
  border: 2px solid #4f46e5;
  color: #4f46e5;
  padding: clamp(0.3rem, 1vw, 0.6rem) clamp(0.8rem, 2vw, 1.2rem);
  border-radius: 6px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  font-size: clamp(0.7rem, 1.2vw, 0.85rem);
  white-space: nowrap;
}

.demo-controls button:hover:not(:disabled) {
  background: #4f46e5;
  color: white;
  transform: translateY(-1px);
}

.demo-controls button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.demo-controls .reset-btn {
  background: #dc2626;
  border-color: #dc2626;
  color: white;
}

.demo-controls .reset-btn:hover {
  background: #b91c1c;
  border-color: #b91c1c;
}

.status-card {
  margin: 2rem auto;
  padding: 2rem;
  border-radius: 12px;
  text-align: center;
  font-size: 1.1rem;
  box-shadow: 0 8px 32px rgba(0,0,0,0.1);
  max-width: 500px;
}

.status-card.connecting {
  background: white;
  color: #4f46e5;
  border: 2px solid #e0e7ff;
}

.status-card.error {
  background: #fef2f2;
  color: #dc2626;
  border: 2px solid #fecaca;
}

.loading-spinner {
  width: 24px;
  height: 24px;
  border: 3px solid #e0e7ff;
  border-top: 3px solid #4f46e5;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin: 0 auto 1rem;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

.content {
  display: grid;
  gap: clamp(0.5rem, 1.5vw, 1rem);
  width: 100%;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  
  /* Mobile: Single column */
  grid-template-columns: 1fr;
  grid-template-areas: 
    "webcam"
    "receipt"
    "ocr";
  grid-template-rows: 1fr 1fr 1fr;
}

/* Tablet */
@media (min-width: 768px) {
  .content {
    grid-template-columns: 1fr 1fr;
    grid-template-areas: 
      "webcam receipt"
      "ocr ocr";
    grid-template-rows: 1fr 1fr;
  }
}

/* Desktop */
@media (min-width: 1024px) {
  .content {
    grid-template-columns: 1.2fr 1fr 1.3fr;
    grid-template-areas: "webcam receipt ocr";
    grid-template-rows: 1fr;
  }
}

/* Large desktop */
@media (min-width: 1440px) {
  .content {
    grid-template-columns: 1.5fr 1fr 1.2fr;
  }
}

.web-camera-section {
  grid-area: webcam;
}

.receipt-section {
  grid-area: receipt;
}

.ocr-section {
  grid-area: ocr;
  overflow: hidden;
}

.card {
  background: white;
  border-radius: 12px;
  padding: clamp(0.8rem, 2vw, 1.5rem);
  box-shadow: 0 6px 20px rgba(0,0,0,0.1);
  border: 1px solid rgba(255,255,255,0.2);
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.card h2, .card h3 {
  color: #1f2937;
  margin: 0 0 clamp(0.5rem, 1.5vw, 1rem) 0;
  font-weight: 600;
  font-size: clamp(0.9rem, 2vw, 1.1rem);
  flex-shrink: 0;
}

.image-container {
  display: flex;
  justify-content: center;
  align-items: center;
  flex: 1;
  min-height: 0;
  position: relative;
  overflow: hidden;
  border-radius: 8px;
}

img, video {
  max-width: 100%;
  max-height: 100%;
  height: auto;
  width: auto;
  border-radius: 8px;
  object-fit: contain;
}

.overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(249, 250, 251, 0.9);
  border-radius: 8px;
}

.placeholder {
  text-align: center;
  padding: clamp(1rem, 3vw, 2rem);
  color: #6b7280;
  background: #f9fafb;
  border-radius: 8px;
  border: 2px dashed #d1d5db;
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-height: 0;
}

.placeholder h2 {
  color: #4b5563 !important;
  margin-bottom: 0.5rem !important;
}

.placeholder p {
  font-size: clamp(0.8rem, 1.5vw, 0.95rem);
  margin: 0;
}

.ocr-content {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
  padding-right: 4px;
}

.store-info {
  margin-bottom: clamp(1rem, 2vw, 1.5rem);
  padding-bottom: clamp(0.8rem, 1.5vw, 1rem);
  border-bottom: 2px solid #f3f4f6;
}

.store-name {
  color: #059669 !important;
  margin-bottom: 0.25rem !important;
  font-size: clamp(1rem, 2vw, 1.2rem) !important;
}

.address {
  color: #6b7280;
  font-size: clamp(0.75rem, 1.3vw, 0.85rem);
  line-height: 1.3;
}

.totals-card, .metrics-card {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: clamp(0.8rem, 1.5vw, 1rem);
  margin: clamp(0.8rem, 1.5vw, 1rem) 0;
}

.totals-card h3, .metrics-card h3 {
  margin-bottom: 0.8rem !important;
  color: #1e293b;
  font-size: clamp(0.85rem, 1.6vw, 1rem) !important;
}

.totals-grid {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.total-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.25rem 0;
}

.total-item.grand-total {
  border-top: 2px solid #e2e8f0;
  padding-top: 0.6rem;
  margin-top: 0.3rem;
  font-weight: 700;
}

.total-item .label {
  color: #4b5563;
  font-weight: 500;
  font-size: clamp(0.8rem, 1.4vw, 0.9rem);
}

.total-item .value {
  color: #059669;
  font-weight: 600;
  font-size: clamp(0.85rem, 1.5vw, 0.95rem);
}

.grand-total .value {
  color: #dc2626;
  font-size: clamp(0.9rem, 1.6vw, 1.05rem);
}

.items-section {
  margin: clamp(1rem, 2vw, 1.5rem) 0;
}

.table-container {
  background: white;
  border-radius: 6px;
  overflow: hidden;
  border: 1px solid #e5e7eb;
  max-height: 200px;
}

.table-scroll {
  max-height: 200px;
  overflow-y: auto;
  overflow-x: auto;
}

.table-scroll::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

.table-scroll::-webkit-scrollbar-track {
  background: #f1f1f1;
}

.table-scroll::-webkit-scrollbar-thumb {
  background: #c1c1c1;
  border-radius: 3px;
}

table {
  width: 100%;
  border-collapse: collapse;
  min-width: 300px;
}

th {
  background: #1f2937;
  color: white;
  padding: clamp(0.4rem, 1vw, 0.6rem);
  text-align: left;
  font-weight: 600;
  font-size: clamp(0.7rem, 1.2vw, 0.8rem);
  text-transform: uppercase;
  letter-spacing: 0.3px;
  position: sticky;
  top: 0;
  z-index: 10;
}

.price-col {
  text-align: right !important;
  width: 80px;
}

td {
  padding: clamp(0.4rem, 1vw, 0.6rem);
  border-bottom: 1px solid #f3f4f6;
  color: #374151;
  font-size: clamp(0.7rem, 1.2vw, 0.8rem);
}

tr:hover td {
  background: #f9fafb;
}

.description {
  font-weight: 500;
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.price {
  text-align: right;
  font-weight: 600;
  color: #059669;
  font-family: 'SF Mono', Monaco, monospace;
}

.metrics-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 0.8rem;
}

.metric {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: clamp(0.5rem, 1.2vw, 0.6rem);
  background: white;
  border-radius: 6px;
  border: 1px solid #e2e8f0;
}

.metric-label {
  color: #4b5563;
  font-weight: 500;
  font-size: clamp(0.7rem, 1.2vw, 0.8rem);
}

.metric-value {
  font-weight: 700;
  color: #1f2937;
  font-size: clamp(0.75rem, 1.3vw, 0.85rem);
}

.retry-button {
  background: #4f46e5;
  color: white;
  border: none;
  padding: 0.4rem 0.8rem;
  border-radius: 4px;
  cursor: pointer;
  margin-top: 0.4rem;
  font-size: clamp(0.7rem, 1.2vw, 0.8rem);
}

.retry-button:hover {
  background: #3730a3;
}

/* Ultra-wide screen optimization */
@media (min-width: 1920px) {
  .dashboard {
    max-width: 1600px;
    margin: 0 auto;
  }
}
</style>