import * as VIAM from "@viamrobotics/sdk";
import { BSON } from "bson";
import Cookies from "js-cookie";

// --- CONFIGURATION ---
const fragmentID = "c59e453d-b811-4cce-bb20-862867045ed6";
const SENSOR_NAME = "google-vision-sensor-ocr";

// --- GLOBAL STATE ---
let viamClient: VIAM.ViamClient;
const contentArea = document.getElementById("insert-readings")!;
const currentReceiptBtn = document.getElementById("current-receipt-btn")!;
const inventoryBtn = document.getElementById("inventory-btn")!;

/**
 * Main initialization function.
 */
async function initializeApp() {
  try {
    const userTokenRawCookie = Cookies.get("userToken")!;
    const userTokenValue = userTokenRawCookie.slice(userTokenRawCookie.indexOf("{"), userTokenRawCookie.indexOf("}") + 1);
    const accessToken = JSON.parse(userTokenValue).access_token;

    viamClient = await VIAM.createViamClient({
      serviceHost: "https://app.viam.com",
      credentials: { type: "access-token", payload: accessToken },
    });

    currentReceiptBtn.addEventListener('click', showCurrentReceiptView);
    inventoryBtn.addEventListener('click', showInventoryView);
    await showCurrentReceiptView();

  } catch (error) {
    console.error("Initialization Failed:", error);
    renderError("Initialization Failed. Are you logged into app.viam.com in another tab?");
  }
}

/**
 * Shows the "Current Receipt" view.
 */
async function showCurrentReceiptView() {
  setActiveTab(currentReceiptBtn);
  showLoadingState("Loading Current Receipt Data...");

  const dataClient = viamClient.dataClient;
  const locationSummaries = await viamClient.appClient.listMachineSummaries("", [fragmentID]);
  const htmlblock = document.createElement("div");

  for (const locationSummary of locationSummaries) {
    for (const machine of locationSummary.machineSummaries) {
      const locationDetails = await viamClient.appClient.getLocation(locationSummary.locationId);
      const orgID = locationDetails?.organizations[0].organizationId || "";
      const BSONQueryForData = [
        BSON.serialize({ $match: { robot_id: machine.machineId, component_name: SENSOR_NAME, time_requested: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } } }),
        BSON.serialize({ $sort: { time_requested: -1 } }),
        BSON.serialize({ $limit: 1 })
      ];

      const machineMeasurements = await dataClient.tabularDataByMQL(orgID, BSONQueryForData);
      const insideDiv = document.createElement("div");

      if (!machineMeasurements || machineMeasurements.length === 0) {
        insideDiv.className = "inner-div unavailable";
        insideDiv.innerHTML = `<p>${machine.machineName}: No data in the last 24 hours</p>`;
      } else {
        insideDiv.className = "inner-div available";
        const latestReading = machineMeasurements[0];
        const readings = latestReading?.data?.readings;
        const items = readings?.items || [];
        const metrics = readings?.metrics;
        const totals = readings?.totals;
        const store = readings?.store;

        if (readings && items.length > 0) {
          let itemsHTML = `<div class="receipt-header"><h3>${machine.machineName} - ${store?.name || 'Unknown Store'}</h3></div>`;

          if (metrics) {
            itemsHTML += `<div class="metrics">
                            <p><strong>Receipt Summary:</strong></p>
                            <p>Items: ${metrics.item_count} | Unique Items: ${metrics.unique_descriptions}</p>
                            <p>Items Sum: $${(metrics.sum_items || 0).toFixed(2)} | Total Match: ${metrics.sum_matches_total ? '✓ Yes' : '✗ No'}</p>
                        </div>`;
          }

          if (totals) {
            itemsHTML += `<div class="totals">
                            <p><strong>Receipt Total: $${(totals.total || 0).toFixed(2)}</strong></p>
                            <p>Subtotal: $${(totals.subtotal || 0).toFixed(2)} | Tax: $${(totals.tax || 0).toFixed(2)}</p>
                        </div>`;
          }

          const groupedItems: { [key: string]: { count: number, price: number } } = {};
          items.forEach((item: any) => {
            if (!item.desc || item.desc.trim() === '') return;
            let cleanDesc = item.desc.replace(/\s+\d{12,}\s*[A-Z]*\s*$/g, '').replace(/\s+[A-Z]\s*$/g, '').replace(/\s+/g, ' ').trim();
            if (cleanDesc.length < 2) { cleanDesc = item.desc.replace(/\b\d{12,}\b/g, '').trim(); }
            if (cleanDesc.length < 2 || /^\d+$/.test(cleanDesc)) return;

            if (groupedItems[cleanDesc]) {
              groupedItems[cleanDesc].count += 1;
              groupedItems[cleanDesc].price += (item.price || 0);
            } else {
              groupedItems[cleanDesc] = { count: 1, price: (item.price || 0) };
            }
          });

          itemsHTML += `<div class="items-section"><p><strong>Items Purchased:</strong></p><ul>`;
          Object.entries(groupedItems).forEach(([desc, data]) => {
            itemsHTML += `<li>${desc}<span>$${data.price.toFixed(2)}`;
            if (data.count > 1) { itemsHTML += ` (${data.count}x)`; }
            itemsHTML += `</span></li>`;
          });
          itemsHTML += `</ul></div>`;

          if (readings.timestamp) {
            itemsHTML += `<div class="timestamp"><p><small>Processed: ${new Date(readings.timestamp * 1000).toLocaleString()}</small></p></div>`;
          }
          insideDiv.innerHTML = itemsHTML;
        } else {
          insideDiv.className = "inner-div unavailable";
          insideDiv.innerHTML = `<p>${machine.machineName}: No receipt data available in the latest reading</p>`;
        }
      }
      htmlblock.appendChild(insideDiv);
    }
  }
  contentArea.innerHTML = '';
  contentArea.appendChild(htmlblock);
}

/**
 * Shows the "Inventory" view with high-level fleet data.
 */
async function showInventoryView() {
  setActiveTab(inventoryBtn);
  showLoadingState("Loading Inventory Log...");

  const dataClient = viamClient.dataClient;
  const locationSummaries = await viamClient.appClient.listMachineSummaries("", [fragmentID]);

  const machineNames: { [key: string]: string } = {};
  locationSummaries.forEach(summary => {
    summary.machineSummaries.forEach((m: any) => { machineNames[m.machineId] = m.machineName; });
  });

  const locationDetails = await viamClient.appClient.getLocation(locationSummaries[0].locationId);
  const orgID = locationDetails?.organizations[0].organizationId;

  const BSONQuery = [
    BSON.serialize({ $match: { "tags": "ocr-sensor", "component_name": SENSOR_NAME } }),
    BSON.serialize({ $sort: { time_requested: -1 } }),
    BSON.serialize({ $limit: 10 })
  ];

  const inventoryData = await dataClient.tabularDataByMQL(orgID, BSONQuery);

  if (inventoryData.length === 0) {
    contentArea.innerHTML = `<div class="inner-div unavailable"><p>No inventory data found.</p></div>`;
    return;
  }

  let inventoryHTML = `<div class="fleet-log-header"><h2>High-Level Inventory Log</h2></div>`;
  inventoryData.forEach(record => {
    const { data, time_requested, robot_id } = record;
    const { store, metrics, totals } = data.readings || {};

    inventoryHTML += `
            <div class="inner-div available">
                <div class="receipt-header">
                    <h3>${machineNames[robot_id] || 'Unknown Machine'}</h3>
                    <p>${store?.name || 'Unknown Store'} - ${locationDetails.name}</p>
                    <small>Processed: ${new Date(time_requested).toLocaleString()}</small>
                </div>
                <div class="metric-grid">
                    <div class="metric-item">
                        <div class="metric-item-label">Total</div>
                        <div class="metric-item-value">$${(totals?.total || 0).toFixed(2)}</div>
                    </div>
                    <div class="metric-item">
                        <div class="metric-item-label">Item Count</div>
                        <div class="metric-item-value">${metrics?.item_count || 0}</div>
                    </div>
                    <div class="metric-item">
                        <div class="metric-item-label">Unique Items</div>
                        <div class="metric-item-value">${metrics?.unique_descriptions || 0}</div>
                    </div> 
                </div>
            </div>
        `;
  });
  contentArea.innerHTML = inventoryHTML;
}

// --- HELPER FUNCTIONS ---
function setActiveTab(activeButton: HTMLElement) {
  [currentReceiptBtn, inventoryBtn].forEach(button => button.classList.remove('active'));
  activeButton.classList.add('active');
}

function showLoadingState(message: string) {
  contentArea.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>${message}</p></div>`;
}

function renderError(message: string) {
  contentArea.innerHTML = `<div class="inner-div unavailable"><p>${message}</p></div>`;
}

// --- APP ENTRY POINT ---
document.addEventListener("DOMContentLoaded", initializeApp);