const { Pool } = require("pg");

const db = new Pool({
  host: "localhost",
  user: "postgres",
  password: "123456",
  database: "todo_app",
  port: 5432
});

db.on("connect", () => {
  console.log("PostgreSQL connected");
});

module.exports = db;
