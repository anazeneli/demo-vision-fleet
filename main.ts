console.log("Script loaded - starting dashboard");

// OCR Sensor dashboard

import * as VIAM from "@viamrobotics/sdk";
import { BSON } from "bson";
import Cookies from "js-cookie";

let access_token = "";
let fragmentID = "c59e453d-b811-4cce-bb20-862867045ed6";
let location_id = "";

async function main() {

  const opts: VIAM.ViamClientOptions = {
    serviceHost: "https://app.viam.com",
    credentials: {
      type: "access-token",
      payload: access_token,
    },
  };

  // Instantiate data_client and get all readings 
  const client = await VIAM.createViamClient(opts);
  const dataClient = client.dataClient;
  let locationSummaries: any[] = [];
  if (fragmentID !== "") {
    locationSummaries = await client.appClient.listMachineSummaries("", [fragmentID]);
  } else if (location_id !== "") {
    locationSummaries = await client.appClient.listMachineSummaries("", [], [location_id]);
  } else {
    locationSummaries = await client.appClient.listMachineSummaries("");
  }

  let measurements: any[] = [];
  let htmlblock: HTMLElement = document.createElement("div");
  let location_orgID_mapping: any[] = [];

  console.log("Location summaries:", locationSummaries);


  // Get all the machine IDs from accessible machines
  for (let locationSummary of locationSummaries) {
    console.log(locationSummary);
    let machines = locationSummary.machineSummaries;
    for (let machine of machines) {
      let machineID = machine.machineId;
      let machineName = machine.machineName;
      let orgID = "";

      if (location_orgID_mapping.includes(locationSummary.locationId)) {
        orgID = location_orgID_mapping[locationSummary.locationId];
      } else {
        // Get the full location details to access organizationId
        let locationDetails = await client.appClient.getLocation(locationSummary.locationId);
        orgID = locationDetails?.organizations[0].organizationId || "";

        location_orgID_mapping[locationSummary.locationId] = orgID;
      }

      console.log({ machineID, machineName, orgID });

      const match_query = {
        $match: {
          robot_id: machineID,
          "component_name": "google-vision-sensor-ocr",
          time_requested: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
        }
      };

      const sort_stage = {
        $sort: { time_requested: -1 }
      };

      const limit_stage = {
        $limit: 1
      };

      // Get the sensor data for the current machine
      const BSONQueryForData = [
        BSON.serialize(match_query),
        BSON.serialize(sort_stage),
        BSON.serialize(limit_stage)
      ];

      try {
        let machineMeasurements: any = await dataClient?.tabularDataByMQL(
          orgID,
          BSONQueryForData,
        );
        measurements[machineID] = machineMeasurements;
        console.log(`Machine measurements for ${machineName}:`, measurements[machineID]);
      } catch (error) {
        console.error(`Error getting data for machine ${machineID}:`, error);
      }

      let insideDiv: HTMLElement = document.createElement("div");

      if (!measurements[machineID] || measurements[machineID].length === 0) {
        console.log(`No measurements found for machine ${machineID}`);
        insideDiv.className = "inner-div unavailable";
        insideDiv.innerHTML = "<p>" + machineName + ": No data</p>";
        htmlblock.appendChild(insideDiv);
      } else {
        let latestReading = measurements[machineID][0]; // The full record
        let readings = latestReading?.data?.readings;
        let items = readings?.items || [];
        let metrics = readings?.metrics;
        let totals = readings?.totals;
        let store = readings?.store;

        console.log(`Latest reading for ${machineName}:`, latestReading);
        console.log(`Readings object:`, readings);
        console.log(`Items found for ${machineName}:`, items);

        if (readings && items.length > 0) {
          insideDiv.className = "inner-div available";

          let itemsHTML = `<div class="receipt-header">
            <h3>${machineName} - ${store?.name || 'Unknown Store'}</h3>
          </div>`;

          // Show metrics
          if (metrics) {
            itemsHTML += `<div class="metrics">
              <p><strong>Receipt Summary:</strong></p>
              <p>Items: ${metrics.item_count} | Unique Items: ${metrics.unique_descriptions}</p>
              <p>Items Sum: $${(metrics.sum_items || 0).toFixed(2)} | Total Match: ${metrics.sum_matches_total ? '✓ Yes' : '✗ No'}</p>
            </div>`;
          }

          // Show totals
          if (totals) {
            itemsHTML += `<div class="totals">
              <p><strong>Receipt Total: $${(totals.total || 0).toFixed(2)}</strong></p>
              <p>Subtotal: $${(totals.subtotal || 0).toFixed(2)} | Tax: $${(totals.tax || 0).toFixed(2)}</p>
            </div>`;
          }

          // Clean item names and group by description
          let groupedItems: { [key: string]: { count: number, price: number } } = {};


          items.forEach((item: any) => {
            // Skip items with no description
            if (!item.desc || item.desc.trim() === '') {
              return;
            }
            let cleanDesc = item.desc
              // Remove UPC codes (12+ digits) and any single letters that follow
              .replace(/\s+\d{12,}\s*[A-Z]*\s*$/g, '')
              // Remove any remaining trailing single letters (like F, X, O, N)
              .replace(/\s+[A-Z]\s*$/g, '')
              // Clean up multiple spaces
              .replace(/\s+/g, ' ')
              .trim();

            // If cleaning removed everything, keep just the product name part
            if (cleanDesc.length < 2) {
              cleanDesc = item.desc.replace(/\b\d{12,}\b/g, '').trim();
            }

            // If still empty or just numbers, skip this item
            if (cleanDesc.length < 2 || /^\d+$/.test(cleanDesc)) {
              return;
            }

            if (groupedItems[cleanDesc]) {
              groupedItems[cleanDesc].count += 1;
              groupedItems[cleanDesc].price += (item.price || 0);
            } else {
              groupedItems[cleanDesc] = {
                count: 1,
                price: (item.price || 0)
              };
            }
          });

          console.log(`Grouped items for ${machineName}:`, groupedItems);

          itemsHTML += `<div class="items-section">
            <p><strong>Items Purchased:</strong></p>
            <ul>`;

          Object.entries(groupedItems).forEach(([desc, data]) => {
            itemsHTML += "<li>" + desc + " - $" + data.price.toFixed(2);
            if (data.count > 1) {
              itemsHTML += " (" + data.count + "x)";
            }
            itemsHTML += "</li>";
          });

          itemsHTML += `</ul>
            <p><small>Total unique items: ${Object.keys(groupedItems).length}</small></p>
          </div>`;

          // Add timestamp if available
          if (readings.timestamp) {
            const receiptDate = new Date(readings.timestamp * 1000).toLocaleString();
            itemsHTML += `<div class="timestamp">
              <p><small>Receipt processed: ${receiptDate}</small></p>
            </div>`;
          }

          insideDiv.innerHTML = itemsHTML;
        } else {
          insideDiv.className = "inner-div unavailable";
          insideDiv.innerHTML = "<p>" + machineName + ": No receipt data available</p>";
        }
        htmlblock.appendChild(insideDiv);
      }
    }
  }

  console.log("Final HTML block:", htmlblock);

  // Add the block of HTML with color-coded boxes for each machine
  document.getElementById("insert-readings")?.replaceWith(htmlblock);

  return;
}

document.addEventListener("DOMContentLoaded", async () => {

  const userTokenRawCookie = Cookies.get("userToken")!;
  const startIndex = userTokenRawCookie.indexOf("{");
  const endIndex = userTokenRawCookie.indexOf("}");
  const userTokenValue = userTokenRawCookie.slice(startIndex, endIndex + 1);
  access_token = JSON.parse(userTokenValue).access_token;

  console.log("Dashboard starting with access token:", access_token ? "✓ Found" : "✗ Missing");

  main().catch((error) => {
    console.error("encountered an error:", error);
  });
});
