export type Category = "Getting started" | "Using the app" | "PostgreSQL" | "MySQL" | "MongoDB" | "Reference";

export const CATEGORIES: Category[] = ["Getting started", "Using the app", "PostgreSQL", "MySQL", "MongoDB", "Reference"];

export type Block =
  | { t: "p"; text: string }
  | { t: "h"; text: string }
  | { t: "list"; items: string[] }
  | { t: "code"; lang: "sql" | "mongo" | "bash" | "text"; code: string }
  | { t: "table"; head: string[]; rows: string[][] }
  | { t: "note"; kind: "tip" | "warn"; text: string };

export type Doc = { slug: string; title: string; category: Category; summary: string; blocks: Block[] };

const p = (text: string): Block => ({ t: "p", text });
const h = (text: string): Block => ({ t: "h", text });
const ul = (...items: string[]): Block => ({ t: "list", items });
const sql = (code: string): Block => ({ t: "code", lang: "sql", code });
const mongo = (code: string): Block => ({ t: "code", lang: "mongo", code });
const text = (code: string): Block => ({ t: "code", lang: "text", code });
const tip = (t: string): Block => ({ t: "note", kind: "tip", text: t });
const warn = (t: string): Block => ({ t: "note", kind: "warn", text: t });
const table = (head: string[], rows: string[][]): Block => ({ t: "table", head, rows });

export const docs: Doc[] = [
  // ---------------------------------------------------------------- Getting started
  {
    slug: "welcome", title: "Welcome to DBForge AI", category: "Getting started",
    summary: "What the app does and a 5 minute quick start.",
    blocks: [
      p("DBForge AI is a workspace for database engineering. Connect PostgreSQL, MySQL or MongoDB, write and run queries, explore schemas, import data and get AI help in one place. Your browser never talks to your database: every operation goes through the DBForge backend."),
      h("Pages at a glance"),
      table(["Page", "Use it to"], [
        ["SQL Editor", "The main workspace: AI prompt, editor, results, AI chat, file upload and a live diagram."],
        ["Databases", "Save connections and browse schemas, tables or collections, columns and indexes."],
        ["ER Diagram", "See tables and relationships, save snapshots and download the diagram as an image."],
        ["Schema Compare", "Compare two schemas and preview the migration SQL."],
        ["Import", "Load CSV or Excel files into a table."],
        ["Performance", "Read query plans (EXPLAIN) and get index suggestions."],
        ["AI Assistant", "A full page chat for SQL questions."],
        ["History", "Search every query you ran and open saved queries."],
        ["Learn", "Lessons, practice exercises and interview questions."],
        ["Settings", "Add your own OpenAI, Groq or Grok key."],
      ]),
      h("Quick start"),
      ul(
        "1. Open Databases and add a connection (see Connecting a database).",
        "2. Open the SQL Editor and choose the connection at the top.",
        "3. Type a query and press Ctrl+Enter, or describe what you need in the AI prompt and press Generate.",
        "4. Add an AI key in Settings if you want the AI features.",
        "5. Run a CREATE TABLE statement and watch the diagram on the right update.",
      ),
      tip("Nothing the AI writes is run automatically. It only writes into the editor, and you press Run."),
    ],
  },
  {
    slug: "connect-database", title: "Connecting a database", category: "Getting started",
    summary: "Hosts, ports, SSL, Atlas and least-privilege users.",
    blocks: [
      p("Open Databases, click New connection, fill the form and press Test connection. A connection is saved only after the test succeeds. Passwords are stored encrypted and never shown again."),
      table(["Engine", "Host example", "Port", "Notes"], [
        ["PostgreSQL", "localhost or ep-xxx.region.aws.neon.tech", "5432", "Tick SSL for Neon and most cloud databases."],
        ["MySQL / MariaDB", "localhost or your cloud host", "3306", "Tick SSL if your provider requires it."],
        ["MongoDB", "localhost or host1:27017,host2:27017", "27017", "Username can be empty on a local server without authentication."],
        ["MongoDB Atlas (SRV)", "cluster0.xxxx.mongodb.net", "ignored", "Use the host only, without mongodb+srv://. TLS is always on."],
      ]),
      h("Create a read-only user (recommended)"),
      p("Read-only mode in the editor is a convenience guard. A database user that can only read is the real protection."),
      sql(`CREATE ROLE dbforge_reader LOGIN PASSWORD 'change-me';
GRANT CONNECT ON DATABASE mydb TO dbforge_reader;
GRANT USAGE ON SCHEMA public TO dbforge_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO dbforge_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO dbforge_reader;`),
      p("MySQL:"),
      sql(`CREATE USER 'dbforge_reader'@'%' IDENTIFIED BY 'change-me';
GRANT SELECT ON mydb.* TO 'dbforge_reader'@'%';`),
      p("MongoDB (run this in mongosh, not in DBForge):"),
      text(`use mydb
db.createUser({ user: "dbforge_reader", pwd: "change-me", roles: [{ role: "read", db: "mydb" }] })`),
      warn("When DBForge runs on a hosted server, it cannot reach localhost or private network addresses, and it refuses them on purpose. Use a database that is reachable from the internet, or use the desktop app."),
      tip("Atlas: add the server's IP address to the Atlas network access list, or the connection will time out."),
    ],
  },

  // ---------------------------------------------------------------- Using the app
  {
    slug: "sql-editor", title: "The SQL Editor page", category: "Using the app",
    summary: "Running queries, read-only mode, results, history and shortcuts.",
    blocks: [
      p("The SQL Editor is the main page. The left panel has the AI prompt, file upload and the list of tables or collections. The middle has the editor with Results and AI Chat below it. The right shows a live diagram."),
      h("Running queries"),
      table(["Action", "What it does"], [
        ["Run (Ctrl+Enter)", "Runs the selected text, or the statement at the cursor. Only one statement at a time."],
        ["Run all", "Runs every statement in the editor in order and stops at the first error."],
        ["Cancel", "Stops a running query. For MongoDB this needs the permission to kill operations, otherwise the time limit stops it."],
        ["Explain", "Asks the AI to explain the statement at the cursor."],
        ["Analyze", "Opens the Performance page with the statement (SQL databases)."],
        ["Format", "Formats the whole script (SQL only)."],
        ["Save", "Saves the statement under a name. Find it in History, Saved queries."],
      ]),
      p("Separate statements with a semicolon. MongoDB statements must end with a semicolon too."),
      h("Safety"),
      ul(
        "Read-only is on by default. SQL writes are blocked by a read-only transaction and MongoDB write methods are blocked. Turn it off to run CREATE, INSERT, UPDATE and so on.",
        "With Read-only off, destructive statements (DROP, TRUNCATE, ALTER, UPDATE, DELETE, and MongoDB update, delete, drop, $out, $merge) ask for confirmation first.",
        "Each run has a 30 second time limit and returns at most 5000 rows.",
      ),
      warn("Read-only is a guard, not a security boundary. Use a database user with limited privileges."),
      h("Results"),
      p("Results appear in a paged grid. MongoDB results also have a JSON view (the first 200 documents). A warning tells you when the row limit cut the result."),
      h("Your script and history"),
      ul(
        "The script in the editor is saved automatically in this browser, so it is still there after a refresh or after visiting other pages.",
        "Every run is added to History (the query text only, never the result). The last 500 are kept.",
        "Choosing Open in editor on another page appends that query to your script instead of replacing it.",
      ),
      h("Autocomplete"),
      p("Start typing to get keywords, table or collection names and column or field names from the live schema. Clicking a table in the left list inserts a query for it."),
    ],
  },
  {
    slug: "ai-assistant", title: "AI prompt, Explain and Chat", category: "Using the app",
    summary: "How to use the AI safely and get better answers.",
    blocks: [
      p("Add your own API key first (Settings, AI providers). OpenAI (ChatGPT), Groq and xAI (Grok) are supported. The key is checked with the provider, stored encrypted on the server and never shown again."),
      h("Where the AI helps"),
      table(["Feature", "How"], [
        ["Generate", "Describe what you need in the AI prompt box. The query is written into the editor, with your prompt as a comment."],
        ["Explain", "Put the cursor in a statement and press Explain. The answer appears in the AI Chat tab."],
        ["Fix an error", "After a failed run, press Ask AI to explain and fix this error."],
        ["Chat", "Ask any question in the AI Chat tab. You can insert a suggested query into the editor."],
      ]),
      h("What is sent to your AI provider"),
      ul(
        "Your text, and the query or error you asked about.",
        "The schema structure: table or collection names, column or field names and types.",
        "Never your row data. But an error message can contain data values (for example a duplicate key), so read it before you send it.",
      ),
      h("Writing good prompts"),
      ul(
        "Name the tables and columns you mean when you can.",
        "Say the database: the dialect follows your connection, or the language selector when no connection is chosen.",
        "Ask for one thing at a time, then refine in the chat.",
      ),
      text(`Show the 10 students with the highest average grade, with their department name.
Create tables for a library: books, members and loans, with primary and foreign keys.
Which orders have no payment yet?`),
      warn("Always read AI generated queries before you run them. The AI can be wrong, especially about columns that are not in the schema it saw."),
    ],
  },
  {
    slug: "import-data", title: "Importing CSV, Excel and PDF tables", category: "Using the app",
    summary: "Upload a file, review the proposed schema and import it safely.",
    blocks: [
      p("Use Upload file in the SQL Editor (or the Import page). Importing needs Read-only to be off and works with PostgreSQL and MySQL for now."),
      h("CSV and Excel"),
      ul(
        "1. Upload a .csv, .tsv or .xlsx file (up to 20 MB and 100,000 rows).",
        "2. Review the profile: detected types, empty values, distinct values, duplicate rows and key candidates.",
        "3. Choose a new table or an existing one, and map the columns.",
        "4. Confirm. Every row is validated first, then everything is written in one transaction.",
        "5. The report shows the table row count read back from the database.",
      ),
      table(["The values look like", "Detected type"], [
        ["true, false, yes, no", "boolean"],
        ["whole numbers", "integer or bigint"],
        ["numbers with decimals", "float"],
        ["2024-01-31", "date"],
        ["2024-01-31 14:30:00", "timestamp"],
        ["007 (leading zeros)", "text, so the zeros are kept"],
        ["31/01/2024", "text, because the day and month order is ambiguous"],
      ]),
      tip("If some rows are invalid you can import nothing, or skip the invalid rows. The report lists the exact file row and column."),
      h("PDF tables"),
      ul(
        "Works with text based PDFs (not scans). The first 30 pages are read.",
        "DBForge detects tables, you pick one and answer: what is this table for? Name it, set the header row, remove columns or rows.",
        "It then shows how it understood the table and asks: is this correct? Nothing is written until you answer Correct.",
        "After Correct it creates an Excel file (you can download it), creates the table from it and adds starter queries to the editor.",
      ),
      warn("Tables guessed from text alignment (no ruled lines) can be wrong. Check them carefully."),
    ],
  },
  {
    slug: "er-diagrams", title: "ER diagrams", category: "Using the app",
    summary: "Read the diagram, expand it and download an image.",
    blocks: [
      p("The diagram is built from your real schema metadata. It refreshes after CREATE, ALTER and DROP statements, or press Refresh."),
      table(["You see", "It means"], [
        ["Solid cyan line", "A real foreign key constraint."],
        ["Dashed amber line", "A guess from column names such as student_id. It is not a constraint."],
        ["PK / FK badge", "Primary key column / foreign key column."],
      ]),
      ul(
        "Tables without relationships are laid out in a grid, connected tables flow left to right.",
        "Expand makes the diagram panel wider. Use the mouse wheel to zoom and drag to move.",
        "Download image saves a PNG of the whole diagram.",
        "Up to 200 tables are drawn. Foreign keys to other schemas are counted but not drawn.",
      ),
      h("MongoDB"),
      p("MongoDB has no foreign keys. Fields come from a sample of 100 documents per collection, and a field like studentId that holds an ObjectId is drawn as a dashed guess to the students collection."),
    ],
  },
  {
    slug: "schema-compare", title: "Snapshots and schema compare", category: "Using the app",
    summary: "Compare two schemas and preview the migration SQL.",
    blocks: [
      ul(
        "On the ER Diagram page press Save snapshot to store the schema as it is now.",
        "On Schema Compare choose a Base (the current state) and a Desired state. Each side is a live database or a snapshot. Both must use the same engine.",
        "You get the added, removed and changed tables, columns, foreign keys and indexes, plus a migration preview.",
      ),
      warn("The migration SQL is a preview only. Nothing is executed. Destructive statements are marked, and statement order is approximate, so review before you run anything."),
      p("Not generated: primary key changes, sequences and expression indexes (each adds a warning). Schemas above 200 tables cannot be compared. SQL databases only."),
    ],
  },
  {
    slug: "performance", title: "Performance analyzer", category: "Using the app",
    summary: "Read query plans and add indexes with confirmation.",
    blocks: [
      p("Paste one SELECT, INSERT, UPDATE or DELETE and press Analyze. By default DBForge asks the database for its estimated plan and does not run the statement."),
      ul(
        "Measure actual execution runs a SELECT once (read-only, 30 second limit) and adds real timings and row counts.",
        "Findings point out full table scans, row estimates that are far off, sorts that spill to disk and scans repeated many times.",
        "Index suggestions come from the columns in a filter. They are starting points: check how selective the filter is and what extra writes cost.",
        "Create index always asks you to confirm and builds the statement on the server.",
      ),
      table(["Plan node", "Meaning"], [
        ["Seq Scan / Table access (ALL)", "Reads every row of the table."],
        ["Index Scan", "Uses an index to find rows."],
        ["Bitmap Heap Scan", "Collects matching rows through an index, then reads them in order."],
        ["Nested Loop", "For each row on one side, looks up the other side. Good with an index, slow with a full scan."],
        ["Hash Join", "Builds a hash table of one side and probes it with the other."],
        ["Sort", "Orders rows. Slow when it spills to disk."],
      ]),
      warn("CREATE INDEX runs in a transaction here, so PostgreSQL's CONCURRENTLY option is not available. On a big table, a normal CREATE INDEX can block writes while it builds."),
    ],
  },

  // ---------------------------------------------------------------- PostgreSQL
  {
    slug: "pg-basics", title: "PostgreSQL basics", category: "PostgreSQL",
    summary: "Data types, tables, constraints and CRUD.",
    blocks: [
      p("Choose PostgreSQL in the SQL Editor (or a PostgreSQL connection) and turn Read-only off to try the examples."),
      h("Common data types"),
      table(["Type", "Use it for"], [
        ["INTEGER, BIGINT", "Whole numbers"],
        ["NUMERIC(10,2)", "Exact decimals such as money"],
        ["TEXT, VARCHAR(n)", "Text. TEXT has no length limit"],
        ["BOOLEAN", "true / false"],
        ["DATE, TIMESTAMPTZ", "Dates, and timestamps with time zone"],
        ["UUID", "Globally unique ids"],
        ["JSONB", "JSON documents you can index and query"],
      ]),
      h("Create tables"),
      sql(`CREATE TABLE department (
  id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE
);

CREATE TABLE student (
  id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE,
  age INT CHECK (age >= 0),
  department_id INT REFERENCES department (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);`),
      h("Insert, update, delete"),
      sql(`INSERT INTO department (name) VALUES ('IT'), ('Math');

INSERT INTO student (name, email, age, department_id)
VALUES ('Ana', 'ana@example.com', 20, 1),
       ('Raj', 'raj@example.com', 22, 2);

UPDATE student SET age = 21 WHERE email = 'ana@example.com';

DELETE FROM student WHERE email = 'raj@example.com';`),
      tip("Always write the WHERE clause first. UPDATE and DELETE without WHERE change every row (DBForge asks for confirmation, but check anyway)."),
    ],
  },
  {
    slug: "pg-queries", title: "PostgreSQL queries", category: "PostgreSQL",
    summary: "Joins, grouping, CTEs, window functions and upserts.",
    blocks: [
      h("Joins and filtering"),
      sql(`SELECT s.name, d.name AS department
FROM student s
LEFT JOIN department d ON d.id = s.department_id
WHERE s.name ILIKE 'a%'
ORDER BY s.name
LIMIT 20;`),
      p("ILIKE is a case insensitive LIKE. COALESCE(x, 'n/a') replaces NULL."),
      h("Grouping"),
      sql(`SELECT d.name,
       COUNT(*) AS students,
       COUNT(*) FILTER (WHERE s.age >= 21) AS adults
FROM student s
JOIN department d ON d.id = s.department_id
GROUP BY d.name
HAVING COUNT(*) > 1;`),
      h("CTE (WITH)"),
      sql(`WITH avg_age AS (
  SELECT department_id, AVG(age) AS avg_age
  FROM student
  GROUP BY department_id
)
SELECT s.name, s.age, a.avg_age
FROM student s
JOIN avg_age a ON a.department_id = s.department_id
WHERE s.age > a.avg_age;`),
      h("Window functions"),
      sql(`SELECT name, department_id, age,
       ROW_NUMBER() OVER (PARTITION BY department_id ORDER BY age DESC) AS rank_in_dept,
       AVG(age) OVER (PARTITION BY department_id) AS dept_avg
FROM student;`),
      p("A window function adds a value to every row without collapsing rows like GROUP BY does."),
      h("Upsert and useful helpers"),
      sql(`INSERT INTO department (name) VALUES ('IT')
ON CONFLICT (name) DO NOTHING;

SELECT DISTINCT ON (department_id) department_id, name, age
FROM student
ORDER BY department_id, age DESC;

SELECT generate_series(1, 5) AS n;`),
    ],
  },
  {
    slug: "pg-advanced", title: "PostgreSQL indexes, plans and JSONB", category: "PostgreSQL",
    summary: "Indexes, EXPLAIN, JSONB and views.",
    blocks: [
      h("Indexes"),
      sql(`CREATE INDEX idx_student_email ON student (email);
CREATE INDEX idx_student_dept_age ON student (department_id, age);
CREATE INDEX idx_adults ON student (age) WHERE age >= 18;`),
      ul(
        "A composite index (a, b) helps filters on a, or on a and b, but not on b alone.",
        "A partial index (WHERE ...) is smaller and good when you query a small subset.",
        "Every index slows down writes, so add only the ones you use.",
      ),
      h("Reading a plan"),
      sql(`EXPLAIN SELECT * FROM student WHERE email = 'ana@example.com';`),
      p("Use the Performance page for a readable version, with findings and index suggestions. The first number in cost is the startup cost, the second the total."),
      h("JSONB"),
      sql(`CREATE TABLE event (id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, data JSONB NOT NULL);
INSERT INTO event (data) VALUES ('{"type": "login", "user": {"name": "Ana"}}');

SELECT data->'user'->>'name' AS user_name FROM event WHERE data @> '{"type": "login"}';
CREATE INDEX idx_event_data ON event USING gin (data);`),
      h("Views"),
      sql(`CREATE VIEW student_summary AS
SELECT d.name AS department, COUNT(*) AS students
FROM student s JOIN department d ON d.id = s.department_id
GROUP BY d.name;`),
      warn("DBForge runs each statement in its own transaction. A BEGIN in one run does not stay open for the next run, so write multi-statement transactions as one script in another tool."),
    ],
  },

  // ---------------------------------------------------------------- MySQL
  {
    slug: "mysql-basics", title: "MySQL basics", category: "MySQL",
    summary: "Data types, InnoDB, AUTO_INCREMENT and CRUD.",
    blocks: [
      p("Choose a MySQL or MariaDB connection and turn Read-only off to try the examples."),
      table(["Type", "Use it for"], [
        ["INT, BIGINT", "Whole numbers"],
        ["DECIMAL(10,2)", "Exact decimals such as money"],
        ["VARCHAR(n), TEXT", "Text. VARCHAR needs a length"],
        ["TINYINT(1) / BOOLEAN", "true / false (stored as 0 or 1)"],
        ["DATE, DATETIME, TIMESTAMP", "Dates and times. TIMESTAMP is stored in UTC"],
        ["JSON", "JSON documents"],
      ]),
      h("Create tables"),
      sql(`CREATE TABLE department (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE student (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(190) UNIQUE,
  age INT,
  department_id INT UNSIGNED,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (department_id) REFERENCES department (id) ON DELETE SET NULL
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;`),
      ul(
        "InnoDB is the engine that supports transactions and foreign keys. Use it.",
        "utf8mb4 is the character set that stores all of Unicode, including emoji and Bengali.",
        "CHECK constraints are enforced from MySQL 8.0.16.",
      ),
      h("Insert, update, delete"),
      sql(`INSERT INTO department (name) VALUES ('IT'), ('Math');
INSERT INTO student (name, email, age, department_id) VALUES ('Ana', 'ana@example.com', 20, 1);
UPDATE student SET age = 21 WHERE email = 'ana@example.com';
DELETE FROM student WHERE email = 'ana@example.com';`),
    ],
  },
  {
    slug: "mysql-queries", title: "MySQL queries", category: "MySQL",
    summary: "Joins, grouping, window functions, upserts and SHOW commands.",
    blocks: [
      sql(`SELECT s.name, d.name AS department
FROM student s
LEFT JOIN department d ON d.id = s.department_id
WHERE s.name LIKE 'a%'
ORDER BY s.name
LIMIT 20 OFFSET 0;`),
      p("LIKE is case insensitive with the default collations. Use CONCAT(a, ' ', b) to join text and IFNULL(x, 'n/a') for NULL."),
      h("Grouping and window functions (MySQL 8.0+)"),
      sql(`SELECT department_id, COUNT(*) AS students, GROUP_CONCAT(name ORDER BY name) AS names
FROM student
GROUP BY department_id;

SELECT name, department_id, age,
       ROW_NUMBER() OVER (PARTITION BY department_id ORDER BY age DESC) AS rank_in_dept
FROM student;`),
      h("CTE (MySQL 8.0+)"),
      sql(`WITH avg_age AS (
  SELECT department_id, AVG(age) AS avg_age FROM student GROUP BY department_id
)
SELECT s.name, s.age FROM student s
JOIN avg_age a ON a.department_id = s.department_id
WHERE s.age > a.avg_age;`),
      h("Upsert"),
      sql(`INSERT INTO department (name) VALUES ('IT')
ON DUPLICATE KEY UPDATE name = VALUES(name);`),
      h("Looking around"),
      sql(`SHOW TABLES;
DESCRIBE student;
SHOW CREATE TABLE student;
SHOW INDEX FROM student;`),
    ],
  },
  {
    slug: "mysql-advanced", title: "MySQL indexes, plans and transactions", category: "MySQL",
    summary: "Indexes, EXPLAIN, isolation and JSON.",
    blocks: [
      h("Indexes"),
      sql(`CREATE INDEX idx_student_email ON student (email);
CREATE INDEX idx_student_dept_age ON student (department_id, age);`),
      p("The leftmost prefix rule applies: (a, b) helps filters on a, or on a and b, but not on b alone."),
      h("Reading a plan"),
      sql(`EXPLAIN FORMAT=JSON SELECT * FROM student WHERE email = 'ana@example.com';`),
      p("access_type ALL means a full table scan. ref, range and const use an index. The Performance page reads this for you. EXPLAIN ANALYZE (MySQL 8.0.18+) also runs the query and shows real timings as text."),
      h("Transactions and isolation"),
      ul(
        "InnoDB defaults to REPEATABLE READ.",
        "DDL statements (CREATE, ALTER, DROP) commit immediately in MySQL and cannot be rolled back. PostgreSQL can roll DDL back.",
        "DBForge runs each statement in its own transaction.",
      ),
      h("JSON"),
      sql(`CREATE TABLE event (id INT AUTO_INCREMENT PRIMARY KEY, data JSON NOT NULL);
INSERT INTO event (data) VALUES ('{"type": "login", "user": {"name": "Ana"}}');
SELECT data->>'$.user.name' AS user_name FROM event WHERE JSON_EXTRACT(data, '$.type') = 'login';`),
    ],
  },

  // ---------------------------------------------------------------- MongoDB
  {
    slug: "mongo-basics", title: "MongoDB basics", category: "MongoDB",
    summary: "Documents, collections and CRUD in the editor.",
    blocks: [
      p("MongoDB stores documents (JSON like objects) in collections. Documents in one collection can have different fields, and every document has a unique _id (an ObjectId unless you set your own)."),
      p("Choose a MongoDB connection in the SQL Editor and write mongosh style statements, each ending with a semicolon. Turn Read-only off to try the writes."),
      h("Insert"),
      mongo(`db.students.insertOne({ name: "Ana", age: 20, tags: ["it", "ml"], address: { city: "Kolkata" } });
db.students.insertMany([{ name: "Raj", age: 22 }, { name: "Mia", age: 19 }]);`),
      h("Find"),
      mongo(`db.students.find({});
db.students.find({ age: { $gte: 20 } });
db.students.find({}, { name: 1, _id: 0 });
db.students.findOne({ name: "Ana" });`),
      h("Update"),
      mongo(`db.students.updateOne({ name: "Ana" }, { $set: { age: 21 } });
db.students.updateMany({}, { $inc: { age: 1 } });
db.students.updateOne({ name: "Zed" }, { $set: { age: 30 } }, { upsert: true });`),
      h("Delete"),
      mongo(`db.students.deleteOne({ name: "Raj" });
db.students.deleteMany({ age: { $lt: 18 } });`),
      tip("A collection is created automatically by the first insert. The diagram and the collection list refresh after it."),
      warn("Update and delete statements ask for confirmation. deleteMany({}) removes every document in the collection."),
    ],
  },
  {
    slug: "mongo-queries", title: "MongoDB queries and aggregation", category: "MongoDB",
    summary: "Operators, sorting and the aggregation pipeline.",
    blocks: [
      h("Query operators"),
      table(["Operator", "Meaning", "Example"], [
        ["$gt $gte $lt $lte", "Compare", "{ age: { $gt: 18 } }"],
        ["$eq $ne", "Equal / not equal", "{ status: { $ne: \"closed\" } }"],
        ["$in $nin", "In a list", "{ city: { $in: [\"Kolkata\", \"Delhi\"] } }"],
        ["$and $or $not", "Combine conditions", "{ $or: [{ age: 20 }, { name: \"Ana\" }] }"],
        ["$exists", "Field is present", "{ email: { $exists: true } }"],
        ["$regex", "Pattern match", "{ name: { $regex: \"^a\", $options: \"i\" } }"],
      ]),
      mongo(`db.students.find({ age: { $gte: 18 } }, { name: 1, age: 1 }).sort({ age: -1 }).limit(5);
db.students.countDocuments({ age: { $gte: 18 } });
db.students.distinct("address.city");`),
      p("Use dots to reach nested fields: \"address.city\". Regular expression literals such as /abc/ are not supported, use $regex."),
      h("Aggregation pipeline"),
      p("A pipeline is a list of stages. Each stage transforms the documents and passes them on."),
      mongo(`db.students.aggregate([
  { $match: { age: { $gte: 18 } } },
  { $group: { _id: "$department", students: { $sum: 1 }, avgAge: { $avg: "$age" } } },
  { $sort: { students: -1 } },
  { $limit: 5 }
]);`),
      h("Joining with $lookup"),
      mongo(`db.enrollments.aggregate([
  { $lookup: { from: "students", localField: "studentId", foreignField: "_id", as: "student" } },
  { $unwind: "$student" },
  { $project: { _id: 0, course: 1, student: "$student.name" } }
]);`),
      warn("$where, $function and $accumulator run JavaScript on the server and are blocked. $out and $merge write data, so they need Read-only off and a confirmation."),
    ],
  },
  {
    slug: "mongo-schema", title: "MongoDB schema design and indexes", category: "MongoDB",
    summary: "Embed or reference, indexes and how the diagram is inferred.",
    blocks: [
      h("Embed or reference?"),
      table(["Embed (nested inside one document)", "Reference (store another document's _id)"], [
        ["Data is read together, for example an order with its lines", "Data is shared or large, for example one product used by many orders"],
        ["The nested list stays small", "The list can grow without limit"],
        ["You want one read and one atomic update", "You are fine with a second query or a $lookup"],
      ]),
      ul(
        "A document can be at most 16 MB, so never embed an unbounded array.",
        "Name reference fields clearly (studentId, customerId). DBForge uses names like these to draw dashed guesses in the diagram.",
      ),
      h("Indexes"),
      mongo(`db.students.createIndex({ email: 1 }, { unique: true });
db.students.createIndex({ department: 1, age: -1 });
db.sessions.createIndex({ createdAt: 1 }, { expireAfterSeconds: 3600 });`),
      ul(
        "Without an index MongoDB reads every document (a collection scan).",
        "Compound index order matters, just like in SQL.",
        "A TTL index (expireAfterSeconds) deletes documents automatically after the time passes.",
      ),
      h("How DBForge shows your schema"),
      p("MongoDB has no fixed schema, so DBForge reads a sample of up to 100 documents from each collection and lists the fields it saw, with the most common type. Rare fields can be missing. Open the Databases page to see the inferred fields and the indexes of each collection."),
      p("Not supported yet for MongoDB: CSV and PDF import, the performance analyzer, schema compare and collection validators."),
    ],
  },

  // ---------------------------------------------------------------- Reference
  {
    slug: "sql-vs-mongo", title: "SQL vs MongoDB cheat sheet", category: "Reference",
    summary: "The same ideas in both worlds.",
    blocks: [
      table(["SQL", "MongoDB"], [
        ["table", "collection"],
        ["row", "document"],
        ["column", "field"],
        ["primary key", "_id"],
        ["SELECT a, b FROM t", "db.t.find({}, { a: 1, b: 1 })"],
        ["WHERE age > 18", "{ age: { $gt: 18 } } as the first argument of find"],
        ["ORDER BY age DESC LIMIT 5", ".sort({ age: -1 }).limit(5)"],
        ["INSERT INTO t ...", "db.t.insertOne({ ... })"],
        ["UPDATE t SET a = 1 WHERE ...", "db.t.updateMany(filter, { $set: { a: 1 } })"],
        ["DELETE FROM t WHERE ...", "db.t.deleteMany(filter)"],
        ["GROUP BY / COUNT / SUM", "aggregate with $group and $sum"],
        ["JOIN", "aggregate with $lookup (or embed the data)"],
        ["CREATE INDEX", "db.t.createIndex({ a: 1 })"],
        ["COUNT(*)", "db.t.countDocuments({})"],
        ["SELECT DISTINCT a", "db.t.distinct(\"a\")"],
      ]),
      mongo(`db.students.aggregate([
  { $match: { age: { $gte: 18 } } },
  { $group: { _id: "$department", n: { $sum: 1 } } },
  { $sort: { n: -1 } }
]);`),
      p("The SQL version of the query above: SELECT department, COUNT(*) AS n FROM students WHERE age >= 18 GROUP BY department ORDER BY n DESC;"),
    ],
  },
  {
    slug: "dialect-differences", title: "PostgreSQL vs MySQL differences", category: "Reference",
    summary: "What changes when you move SQL between the two.",
    blocks: [
      table(["Topic", "PostgreSQL", "MySQL"], [
        ["Auto id", "GENERATED ... AS IDENTITY or SERIAL", "AUTO_INCREMENT"],
        ["Quote identifiers", "\"name\"", "backticks, like `name`"],
        ["Join text", "a || b", "CONCAT(a, b)"],
        ["Case insensitive search", "ILIKE", "LIKE (default collation)"],
        ["Upsert", "ON CONFLICT (...) DO UPDATE", "ON DUPLICATE KEY UPDATE"],
        ["Return inserted rows", "RETURNING", "not available"],
        ["Boolean", "BOOLEAN", "TINYINT(1) / BOOLEAN"],
        ["Current time", "now()", "NOW()"],
        ["Round a date", "date_trunc('month', d)", "DATE_FORMAT(d, '%Y-%m-01')"],
        ["FULL OUTER JOIN", "supported", "not supported (use UNION of two joins)"],
        ["DDL in a transaction", "can be rolled back", "commits immediately"],
        ["JSON", "JSONB with indexes", "JSON"],
        ["Show tables", "\\dt in psql, or query information_schema", "SHOW TABLES"],
      ]),
      tip("Choosing the connection also sets the language for the AI, so generated queries use the right dialect."),
    ],
  },
  {
    slug: "troubleshooting", title: "Troubleshooting", category: "Reference",
    summary: "Common errors and what to do.",
    blocks: [
      p("Solutions for common connection, execution and configuration issues."),
      table(["You see", "What to do"], [
        ["Connections to private or local addresses are disabled on this server", "A hosted DBForge cannot reach localhost. Use a database that is reachable from the internet, or run the desktop app."],
        ["Could not reach the server / timed out", "Check host and port, the firewall and the provider's IP allowlist (Atlas, Neon, RDS). Tick SSL if the provider requires it."],
        ["password authentication failed / Authentication failed", "Check the user and password. For MongoDB the user may live in the admin database or in your own database, DBForge tries both."],
        ["Read-only mode blocks write operations", "Turn off Read-only in the top bar."],
        ["Run one statement at a time", "Select the statement and press Run, or use Run all."],
        ["This feature supports SQL databases only", "Import, Analyze and Schema Compare do not support MongoDB yet."],
        ["The provider rejected this API key", "Create a new key at the provider and replace it in Settings."],
        ["Rate limit or quota exceeded at the provider", "Wait, or check your billing and quota at the AI provider."],
        ["Model is not available for this key", "Load the model list in Settings and pick one from it."],
        ["The diagram is empty", "The tables may be in another schema. Choose the schema at the top. A new MongoDB collection appears after its first insert."],
        ["Query stopped after the time limit", "Add a filter or an index. Each run is limited to 30 seconds."],
      ]),
    ],
  },
  {
    slug: "limits-security", title: "Limits and security", category: "Reference",
    summary: "What is stored, what is limited and what is protected.",
    blocks: [
      h("What DBForge stores"),
      ul(
        "Your account, saved connections (the password is encrypted), query history and saved queries (text only, never results), schema snapshots, learning progress and your AI keys (encrypted).",
        "The script in the editor stays in your browser only.",
        "Uploaded files are kept for one hour and then deleted. A PDF is read in memory and never stored.",
      ),
      h("Protections"),
      ul(
        "Database credentials and AI keys never go to the browser after you save them.",
        "SQL values are bound as parameters, and the destructive confirmation and Read-only mode guard against slips.",
        "On a hosted server, connections to private and local addresses are refused.",
        "MongoDB queries are parsed, not evaluated. JavaScript operators are blocked.",
        "AI requests contain schema names and types, never row data.",
      ),
      h("Limits"),
      table(["What", "Limit"], [
        ["Rows returned per run", "5000"],
        ["Time per run", "30 seconds"],
        ["History kept per user", "500 queries"],
        ["Import file", "20 MB, 100,000 rows"],
        ["PDF", "20 MB, first 30 pages, 20 tables"],
        ["Diagram, snapshot and compare", "200 tables"],
        ["MongoDB schema sample", "100 documents per collection"],
      ]),
      warn("Use a database user with only the privileges you need. Read-only mode is a guard, not a security boundary."),
    ],
  },
];

export function docText(d: Doc): string {
  const parts: string[] = [d.title, d.summary, d.category];
  for (const b of d.blocks) {
    if (b.t === "p" || b.t === "h" || b.t === "note") parts.push(b.text);
    else if (b.t === "list") parts.push(...b.items);
    else if (b.t === "code") parts.push(b.code);
    else parts.push(...b.head, ...b.rows.flat());
  }
  return parts.join("\n").toLowerCase();
}
