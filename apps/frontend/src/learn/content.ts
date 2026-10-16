export type Section = { heading?: string; text: string; code?: string };
export type Lesson = { id: string; title: string; topic: "SQL" | "DBMS"; summary: string; sections: Section[] };
export type Exercise = { id: string; title: string; prompt: string; hint: string; solution: string; explanation: string };
export type Question = { id: string; topic: string; question: string; answer: string };

export const SAMPLE_SCHEMA = [
  "department(id PK, name)",
  "student(id PK, name, email, department_id FK → department.id)",
  "course(id PK, title, credits, department_id FK → department.id)",
  "enrollment(id PK, student_id FK → student.id, course_id FK → course.id, grade)",
];

export const lessons: Lesson[] = [
  {
    id: "sql-select-basics", title: "SELECT, WHERE, ORDER BY, LIMIT", topic: "SQL",
    summary: "Read and filter rows from a table.",
    sections: [
      { text: "SELECT reads rows from a table. List the columns you want, or use * for all columns.",
        code: "SELECT name, email\nFROM student\nWHERE department_id = 2\nORDER BY name\nLIMIT 10;" },
      { heading: "Filtering and sorting", text: "WHERE filters rows. ORDER BY sorts the result (ASC is the default, DESC reverses it). LIMIT caps the number of rows, so always use it when exploring big tables." },
      { heading: "NULL", text: "NULL means unknown, so = NULL never matches. Use IS NULL or IS NOT NULL.",
        code: "SELECT name FROM student WHERE email IS NULL;" },
    ],
  },
  {
    id: "sql-joins", title: "Joins", topic: "SQL", summary: "Combine rows from related tables.",
    sections: [
      { text: "INNER JOIN keeps only rows that have a match in both tables.",
        code: "SELECT s.name, d.name AS department\nFROM student s\nINNER JOIN department d ON d.id = s.department_id;" },
      { heading: "LEFT JOIN", text: "LEFT JOIN keeps every row from the left table. Where there is no match, the right side's columns are NULL. This is how you find rows with no related rows.",
        code: "SELECT s.name\nFROM student s\nLEFT JOIN enrollment e ON e.student_id = s.id\nWHERE e.id IS NULL;" },
      { heading: "Common mistake", text: "Always join on the key columns (usually foreign key = primary key). A missing ON condition produces every combination of rows, which is slow and wrong." },
    ],
  },
  {
    id: "sql-aggregation", title: "GROUP BY and aggregates", topic: "SQL", summary: "Summarize rows with COUNT, SUM, AVG.",
    sections: [
      { text: "Aggregate functions (COUNT, SUM, AVG, MIN, MAX) collapse many rows into one value per group.",
        code: "SELECT department_id, COUNT(*) AS students\nFROM student\nGROUP BY department_id;" },
      { heading: "WHERE vs HAVING", text: "WHERE filters rows before grouping. HAVING filters groups after aggregation.",
        code: "SELECT course_id, COUNT(*) AS enrolled\nFROM enrollment\nGROUP BY course_id\nHAVING COUNT(*) > 3;" },
      { heading: "Rules", text: "Every selected column that is not aggregated must appear in GROUP BY (PostgreSQL enforces this). COUNT(*) counts rows; COUNT(column) skips NULLs." },
    ],
  },
  {
    id: "sql-subqueries-cte", title: "Subqueries and CTEs", topic: "SQL", summary: "Build queries from smaller queries.",
    sections: [
      { text: "A subquery is a query inside another query. This finds grades above the overall average.",
        code: "SELECT *\nFROM enrollment\nWHERE grade > (SELECT AVG(grade) FROM enrollment);" },
      { heading: "CTEs", text: "A CTE (WITH clause) gives a subquery a name, which makes long queries easier to read.",
        code: "WITH per_student AS (\n  SELECT student_id, AVG(grade) AS avg_grade\n  FROM enrollment\n  GROUP BY student_id\n)\nSELECT s.name, p.avg_grade\nFROM per_student p\nJOIN student s ON s.id = p.student_id;" },
    ],
  },
  {
    id: "dbms-keys-constraints", title: "Keys and constraints", topic: "DBMS", summary: "How the database protects data integrity.",
    sections: [
      { text: "A PRIMARY KEY uniquely identifies each row and cannot be NULL. A FOREIGN KEY points at a primary key in another table, so the database refuses rows that reference something that does not exist (referential integrity)." },
      { heading: "Other constraints", text: "UNIQUE forbids duplicate values. NOT NULL forbids missing values. CHECK enforces a condition, for example grade between 0 and 100." },
      { heading: "ON DELETE", text: "A foreign key can say what happens when the parent row is deleted: RESTRICT (block it), CASCADE (delete the children too) or SET NULL (clear the reference).",
        code: "ALTER TABLE enrollment\n  ADD FOREIGN KEY (student_id) REFERENCES student (id)\n  ON DELETE CASCADE;" },
    ],
  },
  {
    id: "dbms-normalization", title: "Normalization (1NF to 3NF)", topic: "DBMS", summary: "Remove redundancy by splitting tables.",
    sections: [
      { heading: "1NF", text: "Every column holds a single atomic value and there are no repeating groups. A column like phones = '111, 222' breaks 1NF." },
      { heading: "2NF", text: "In 1NF, and no non-key column depends on only part of a composite key." },
      { heading: "3NF", text: "In 2NF, and no non-key column depends on another non-key column. Example: orders(order_id, customer_id, customer_city). customer_city depends on customer_id, not on order_id, so move it to a customer table." },
      { heading: "Trade-off", text: "Normalized designs avoid update anomalies. Sometimes you denormalize on purpose to make reads faster, accepting extra care when writing." },
    ],
  },
  {
    id: "dbms-transactions-acid", title: "Transactions and ACID", topic: "DBMS", summary: "All-or-nothing changes.",
    sections: [
      { text: "A transaction groups statements so they succeed or fail together.",
        code: "BEGIN;\nUPDATE account SET balance = balance - 100 WHERE id = 1;\nUPDATE account SET balance = balance + 100 WHERE id = 2;\nCOMMIT;  -- or ROLLBACK to undo both" },
      { heading: "ACID", text: "Atomicity: all or nothing. Consistency: constraints hold before and after. Isolation: concurrent transactions do not see each other's half-done work. Durability: committed data survives a crash." },
      { heading: "Isolation levels", text: "READ COMMITTED, REPEATABLE READ and SERIALIZABLE trade speed for protection against dirty reads (seeing uncommitted data), non-repeatable reads (a row changes between two reads) and phantom reads (new rows appear between two reads)." },
    ],
  },
  {
    id: "dbms-indexes", title: "Indexes", topic: "DBMS", summary: "Why queries get faster, and the cost.",
    sections: [
      { text: "An index (usually a B-tree) lets the database find rows without scanning the whole table, which speeds up WHERE, JOIN and ORDER BY on the indexed columns.",
        code: "CREATE INDEX idx_student_email ON student (email);" },
      { heading: "Costs", text: "Every index uses storage and makes INSERT, UPDATE and DELETE slower, because the index must be updated too." },
      { heading: "Choosing columns", text: "In a composite index, order matters: (a, b) helps filters on a, or on a and b, but not on b alone. Columns where most rows share a few values (like a boolean) rarely benefit. Always check with EXPLAIN, for example in the Performance Analyzer, instead of guessing." },
    ],
  },
];

export const exercises: Exercise[] = [
  { id: "ex-names-sorted", title: "Sorted student names",
    prompt: "List the names of all students in alphabetical order.",
    hint: "Use ORDER BY.", solution: "SELECT name\nFROM student\nORDER BY name;",
    explanation: "ORDER BY sorts ascending by default." },
  { id: "ex-students-per-dept", title: "Students per department",
    prompt: "For every department (including departments with no students), show the department name and its number of students, largest first.",
    hint: "A department with zero students needs a LEFT JOIN, and COUNT should count a column of the student table.",
    solution: "SELECT d.name, COUNT(s.id) AS total_students\nFROM department d\nLEFT JOIN student s ON s.department_id = d.id\nGROUP BY d.id, d.name\nORDER BY total_students DESC;",
    explanation: "COUNT(s.id) ignores the NULLs created by the LEFT JOIN, so empty departments show 0." },
  { id: "ex-not-enrolled", title: "Students with no courses",
    prompt: "Find the names of students who are not enrolled in any course.",
    hint: "LEFT JOIN enrollment and keep rows where the enrollment side is NULL.",
    solution: "SELECT s.name\nFROM student s\nLEFT JOIN enrollment e ON e.student_id = s.id\nWHERE e.id IS NULL;",
    explanation: "Students without enrollments get NULL in every enrollment column." },
  { id: "ex-popular-courses", title: "Popular courses",
    prompt: "Show course titles that have more than 3 enrolled students, with the number enrolled.",
    hint: "Group by course and filter the groups with HAVING.",
    solution: "SELECT c.title, COUNT(*) AS enrolled\nFROM course c\nJOIN enrollment e ON e.course_id = c.id\nGROUP BY c.id, c.title\nHAVING COUNT(*) > 3;",
    explanation: "HAVING filters after aggregation. Grouping by c.id as well avoids merging two courses with the same title." },
  { id: "ex-top-average", title: "Top 5 average grades",
    prompt: "Show the 5 students with the highest average grade.",
    hint: "AVG with GROUP BY, then ORDER BY and LIMIT.",
    solution: "SELECT s.name, AVG(e.grade) AS avg_grade\nFROM student s\nJOIN enrollment e ON e.student_id = s.id\nGROUP BY s.id, s.name\nORDER BY avg_grade DESC\nLIMIT 5;",
    explanation: "Sort the aggregated result and keep the first five rows." },
  { id: "ex-above-average", title: "Above the overall average",
    prompt: "List the distinct names of students who have at least one grade above the average of all grades.",
    hint: "Use a subquery that computes AVG(grade).",
    solution: "SELECT DISTINCT s.name\nFROM student s\nJOIN enrollment e ON e.student_id = s.id\nWHERE e.grade > (SELECT AVG(grade) FROM enrollment);",
    explanation: "The subquery runs once and returns a single number to compare against. DISTINCT removes duplicates for students with several qualifying grades." },
];

export const questions: Question[] = [
  { id: "q-pk-vs-unique", topic: "Keys", question: "What is the difference between a primary key and a unique key?",
    answer: "Both enforce uniqueness. A table has one primary key and it can never be NULL; it is the row's identity. A table can have many unique constraints, and (depending on the database) they may allow NULLs." },
  { id: "q-inner-vs-left", topic: "Joins", question: "INNER JOIN vs LEFT JOIN?",
    answer: "INNER JOIN returns only rows that match in both tables. LEFT JOIN returns all rows from the left table and fills the right side with NULL when nothing matches." },
  { id: "q-where-vs-having", topic: "SQL", question: "WHERE vs HAVING?",
    answer: "WHERE filters individual rows before grouping and cannot use aggregates. HAVING filters groups after aggregation and can use aggregates like COUNT(*)." },
  { id: "q-union", topic: "SQL", question: "UNION vs UNION ALL?",
    answer: "UNION combines results and removes duplicates, which costs a sort or hash. UNION ALL keeps duplicates and is faster. Use UNION ALL unless you need deduplication." },
  { id: "q-delete-truncate-drop", topic: "SQL", question: "DELETE vs TRUNCATE vs DROP?",
    answer: "DELETE removes rows (optionally with WHERE) and can be rolled back. TRUNCATE quickly removes all rows and keeps the table; behavior in transactions varies by database. DROP removes the table itself, including its structure." },
  { id: "q-index", topic: "Performance", question: "What is an index and what are the trade-offs?",
    answer: "A data structure (usually a B-tree) that lets the database find rows without scanning the table. It speeds up reads on the indexed columns but uses storage and slows down writes." },
  { id: "q-acid", topic: "Transactions", question: "Explain ACID.",
    answer: "Atomicity (all or nothing), Consistency (constraints hold), Isolation (concurrent transactions do not interfere), Durability (committed data survives crashes)." },
  { id: "q-normalization", topic: "Design", question: "What is normalization, and when would you denormalize?",
    answer: "Organizing tables to remove redundancy (1NF, 2NF, 3NF) so each fact is stored once. Denormalize deliberately when read performance matters more than the extra effort to keep duplicated data consistent." },
  { id: "q-isolation", topic: "Transactions", question: "What problems do isolation levels prevent?",
    answer: "Dirty reads (reading uncommitted data), non-repeatable reads (a row changes between two reads in one transaction) and phantom reads (new matching rows appear). Higher levels prevent more of these at the cost of concurrency." },
  { id: "q-deadlock", topic: "Transactions", question: "What is a deadlock?",
    answer: "Two transactions each hold a lock the other needs, so neither can continue. The database detects it and aborts one transaction. Reduce them by locking rows in a consistent order and keeping transactions short." },
];
