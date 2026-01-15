const { Pool } = require("pg");

const isProd = process.env.NODE_ENV === "production";

const db = new Pool(
  isProd
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
      }
    : {
        host: "localhost",
        user: "postgres",
        password: "123456",
        database: "todo_app",
        port: 5432
      }
);

module.exports = db;


//const { Pool } = require("pg");

// const db = new Pool({
//   host: "localhost",
//   user: "postgres",
//   password: "123456",
//   database: "todo_app",
//   port: 5432
// });
//cấu hình db cho deploy lên web