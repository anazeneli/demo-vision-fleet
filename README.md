# Viam OCR Fleet Management Dashboard Demo

This project is a simple demonstration of Viam's fleet management capabilities using a web-based OCR (Optical Character Recognition) dashboard. The application connects to your Viam account to display data from an OCR sensor, providing two main views for monitoring.



## Features

* **Current Receipt View**: Displays the most recent, fully detailed receipt processed by the sensor, including an itemized list, totals, and metadata.
* **Inventory View**: Provides a high-level fleet management log, showing a history of the last 10 processed receipts with key information like location, machine, timestamp, and totals.

***
## Prerequisites

Before you begin, ensure you have the following installed and configured:

* **Node.js & npm**: You'll need Node.js (v18 or later is recommended) and npm to install dependencies and run the project.
* **Viam Server**: The Viam server must be installed and running on your machine. This demo expects **Version 0.92.0**. You can find installation instructions [here](https://docs.viam.com/try-viam/get-started/#install-viam-server).

***
## Setup

1.  **Clone the Repository**
    Clone this project to your local machine.
    ```bash
    git clone <your-repository-url>
    cd <repository-name>
    ```

2.  **Install Dependencies**
    Install the required Node.js packages.
    ```bash
    npm install
    ```

***
## Running the Application (Local Development)

To run the dashboard locally for development, you will need two terminal windows.

1.  **Start the Web Server**
    In your first terminal, start the local development server. This will serve your HTML, CSS, and JavaScript files on `http://localhost:8000`.
    ```bash
    npm start
    ```

2.  **Start the Viam Local App Testing Tool**
    In a **new terminal window**, run the following command. This tool connects the local web server to Viam's modular resource system.
    ```bash
    viam module local-app-testing --app-url http://localhost:8000
    ```

3.  **Access the Dashboard**
    The `local-app-testing` tool will provide a new URL, typically `http://localhost:8012`. Open this URL in your browser to view the dashboard.

    > **Note**: For the dashboard to fetch data, you must be logged into your account at **app.viam.com** in another tab of the same browser.

***
## Build Process

This project is written in TypeScript (`main.ts`). To see your changes, you must compile the TypeScript into JavaScript, which the browser can understand.

Run the following command in your terminal to build the project:

```bash
npm run build