// @experimental
// This script is intended to export CakeyBot's warnings, to import into ShaggyBot if needs be. 
// Why? Because sometimes you want to switch bots, but you don't want to lose all your existing warnings.
// Why Cakey? Only because I am only familiar with CakeyBot, not any other bots.

// Usage:
// 1. Open the web page with the DataTable you want to export.
// 2. Open the browser's developer console (usually F12 or right-click > Inspect > Console).
// 3. Paste this entire script into the console and press Enter.
// 4. A file named "datatable_export.json" will be downloaded containing the extracted data.


(async function () {
    const tableElement = document.querySelector('#DataTables_Table_0');
    if (!tableElement) {
        console.error("Table not found.");
        return;
    }

    let rowsData = [];

    // If DataTables is being used (most likely)
    if (window.jQuery && jQuery.fn.DataTable) {
        const table = jQuery(tableElement).DataTable();

        // Get ALL rows across ALL pages
        const allData = table.rows({ search: 'applied' }).data();

        for (let i = 0; i < allData.length; i++) {
            const rowNode = table.row(i).node();
            const cells = rowNode.querySelectorAll('th, td');

            rowsData.push({
                id: cells[0]?.innerText.trim(),
                status: cells[1]?.innerText.trim(),
                user_id: cells[2]?.innerText.trim(),
                username: cells[3]?.innerText.trim(),
                moderator: cells[4]?.innerText.trim(),
                reason: cells[5]?.innerText.trim(),
                time: cells[6]?.innerText.trim()
            });
        }

    } else {
        // Fallback: scrape visible DOM rows
        const rows = tableElement.querySelectorAll('tbody tr');

        rows.forEach(row => {
            const cells = row.querySelectorAll('th, td');

            rowsData.push({
                id: cells[0]?.innerText.trim(),
                status: cells[1]?.innerText.trim(),
                user_id: cells[2]?.innerText.trim(),
                username: cells[3]?.innerText.trim(),
                moderator: cells[4]?.innerText.trim(),
                reason: cells[5]?.innerText.trim(),
                time: cells[6]?.innerText.trim()
            });
        });
    }

    // Convert to formatted JSON
    const jsonOutput = JSON.stringify(rowsData, null, 2);

    // Download file
    const blob = new Blob([jsonOutput], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "datatable_export.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    URL.revokeObjectURL(url);

    console.log("Export complete:", rowsData);
})();