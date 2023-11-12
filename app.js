const express = require("express");
const cors = require("cors");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3").verbose();

const axios = require("axios");
const path = require("path");

const databasePath = path.join(__dirname, "database.db");

const app = express();

app.use(express.json());

let database = null;

app.use(cors());

// Create SQLite database
// const database = new sqlite3.Database("database.db", (err) => {
//   if (err) {
//     console.error("Error opening database:", err.message);
//   } else {
//     console.log("Database connected successfully!");
//     createTables(); // Create tables if they don't exist
//   }
// });

// Create tables
// function createTables() {
//   db.run(`
//     CREATE TABLE IF NOT EXISTS amazon (
//       id INTEGER PRIMARY KEY,
//       title TEXT,
//       price FLOAT,
//       description TEXT,
//       category VARCHAR(250),
//       image TEXT,
//       sold TEXT,
//       dateOfSale TEXT
//     )
//   `);
// }

// Fetch data from the third-party API and store in the database
async function fetchDataAndInitializeDB() {
  try {
    const response = await axios.get(
      "https://s3.amazonaws.com/roxiler.com/product_transaction.json"
    );
    const amazon = response.data; // Assuming the response contains an array of users

    for (const user of amazon) {
      db.run(
        "INSERT INTO amazon (title, price,description,category,image,sold,dateOfSale) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [
          user.title,
          user.price,
          user.description,
          user.category,
          user.image,
          user.sold,
          user.dateOfSale,
        ]
      );
    }

    console.log("Data initialized successfully!");
  } catch (error) {
    console.error("Error fetching data:", error.message);
  }
}

// Initialize database with seed data
app.get("/initdb", (req, res) => {
  fetchDataAndInitializeDB();
  res.send("Initializing database...");
});

const initializeDbAndServer = async () => {
  try {
    database = await open({
      filename: databasePath,
      driver: sqlite3.Database,
    });

    app.listen(3001, () =>
      console.log("Server Running at http://localhost:3001/")
    );
  } catch (error) {
    console.log(`DB Error: ${error.message}`);
    process.exit(1);
  }
};

initializeDbAndServer();

//all transactions:
app.get("/transactions", async (req, res) => {
  const { page = 1, perPage = 10, search, month = "03" } = req.query; // Default month is March
  let query = "SELECT * FROM amazon WHERE 1=1"; // Start the query with a true condition
  const params = [];

  if (search) {
    query += " AND (title LIKE ? OR description LIKE ? OR price LIKE ?)";
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  query += " AND strftime('%m', dateOfSale) = ?"; // Adjust the query for the month
  params.push(month);

  query += " LIMIT ? OFFSET ?;";
  params.push(perPage, (page - 1) * perPage);

  try {
    const db = await database;
    const rows = await db.all(query, params);

    res.json(rows);
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

//get total month sale

app.get("/totalItems-sale-amount/:month", async (req, res) => {
  const { month } = req.params;
  const totalQuery = `
    SELECT 
    SUM(CASE WHEN strftime('%m', dateOfSale) = "${month}" AND sold =1  THEN price ELSE 0 END) AS totalSaleAmount,
    COUNT(CASE WHEN strftime('%m', dateOfSale) = "${month}"  AND sold = 1 THEN price END) AS totalSoldItems,
    COUNT(CASE WHEN strftime('%m', dateOfSale) = "${month}"  AND sold = 0 THEN price END) AS totalNotSoldItems
    FROM 
    amazon;

    `;
  const result = await database.all(totalQuery);
  res.send(result);
});

// bar chart data

app.get("/bar-chart-data/:month", async (req, res) => {
  const { month } = req.params;
  const dataQuery = `
  SELECT
  ranges.priceRange,
  COALESCE(COUNT(price), 0) AS itemCount
FROM (
  SELECT '0 - 100' AS priceRange
  UNION SELECT '101 - 200'
  UNION SELECT '201 - 300'
  UNION SELECT '301 - 400'
  UNION SELECT '401 - 500'
  UNION SELECT '501 - 600'
  UNION SELECT '601 - 700'
  UNION SELECT '701 - 800'
  UNION SELECT '801 - 900'
) AS ranges
LEFT JOIN amazon ON
  (
    (price BETWEEN 0 AND 100 AND ranges.priceRange = '0 - 100') OR
    (price BETWEEN 101 AND 200 AND ranges.priceRange = '101 - 200') OR
    (price BETWEEN 201 AND 300 AND ranges.priceRange = '201 - 300') OR
    (price BETWEEN 301 AND 400 AND ranges.priceRange = '301 - 400') OR
    (price BETWEEN 401 AND 500 AND ranges.priceRange = '401 - 500') OR
    (price BETWEEN 501 AND 600 AND ranges.priceRange = '501 - 600') OR
    (price BETWEEN 601 AND 700 AND ranges.priceRange = '601 - 700') OR
    (price BETWEEN 701 AND 800 AND ranges.priceRange = '701 - 800') OR
    (price BETWEEN 801 AND 900 AND ranges.priceRange = '801 - 900')
  )
  AND strftime('%m', dateOfSale ) = "${month}"
GROUP BY ranges.priceRange
ORDER BY ranges.priceRange;

  `;
  const result = await database.all(dataQuery);
  res.json(result);
});

//api for pie chart ,unique categories and number of items in a month

app.get("/unique-category/:month", async (req, res) => {
  const { month } = req.params;
  const uniqueQuery = `
    SELECT distinct category, COUNT(*) AS itemsCount FROM amazon WHERE strftime('%m', dateOfSale)= "${month}"
    GROUP BY  category;`;
  const result = await database.all(uniqueQuery);
  res.send(result);
});

//combined api response

const fetchDataFromAPI = async (url) => {
  try {
    const response = await axios.get(url);
    return response.data;
  } catch (error) {
    console.error("Error fetching data from API:", error.message);
    return null;
  }
};

// API to get combined data for a specific month using path parameter
app.get("/combined-data/:month", async (req, res) => {
  const { month } = req.params;

  try {
    // Fetch data from the three APIs asynchronously
    const salesData = await fetchDataFromAPI(
      `http://localhost:3001/totalItems-sale-amount/${month}`
    );
    const barChartData = await fetchDataFromAPI(
      `http://localhost:3001/bar-chart-data/${month}`
    );
    const pieChartData = await fetchDataFromAPI(
      `http://localhost:3001/unique-category/${month}`
    );

    // Combine the data into a single JSON object
    const combinedData = {
      sales: salesData,
      barChart: barChartData,
      pieChart: pieChartData,
    };

    res.json(combinedData);
  } catch (error) {
    console.error("Error combining data:", error.message);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

module.exports = app;
