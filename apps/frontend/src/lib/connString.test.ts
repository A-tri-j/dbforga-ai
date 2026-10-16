import { describe, expect, it } from "vitest";
import { hintFor, parseConnectionString } from "./connString";

describe("parseConnectionString", () => {
  it("reads a Neon style PostgreSQL string", () => {
    const c = parseConnectionString("postgresql://neondb_owner:p%40ss@ep-cool-123.us-east-2.aws.neon.tech/neondb?sslmode=require");
    expect(c).toEqual({
      engine: "postgresql", host: "ep-cool-123.us-east-2.aws.neon.tech", port: 5432,
      database: "neondb", username: "neondb_owner", password: "p@ss", ssl: true,
    });
  });

  it("accepts postgres:// with a port and no ssl", () => {
    const c = parseConnectionString("postgres://u:pw@localhost:5433/app");
    expect(c).toMatchObject({ engine: "postgresql", host: "localhost", port: 5433, database: "app", ssl: false });
  });

  it("keeps an unencoded @ inside the password", () => {
    const c = parseConnectionString("postgresql://u:p@ss@host/db");
    expect(c).toMatchObject({ username: "u", password: "p@ss", host: "host" });
  });

  it("reads MySQL ssl-mode", () => {
    const c = parseConnectionString("mysql://root:secret@127.0.0.1:3306/shop?ssl-mode=REQUIRED");
    expect(c).toMatchObject({ engine: "mysql", port: 3306, database: "shop", ssl: true });
  });

  it("reads Atlas SRV strings", () => {
    const c = parseConnectionString("mongodb+srv://user:pw@cluster0.abc.mongodb.net/school?retryWrites=true");
    expect(c).toMatchObject({ engine: "mongodb+srv", host: "cluster0.abc.mongodb.net", database: "school", ssl: true });
  });

  it("keeps the full host list for a MongoDB replica set", () => {
    const c = parseConnectionString("mongodb://h1:27017,h2:27018/db");
    expect(c).toMatchObject({ engine: "mongodb", host: "h1:27017,h2:27018", port: 27017, database: "db" });
  });

  it("rejects things that are not connection strings", () => {
    expect(parseConnectionString("not a url")).toBeNull();
    expect(parseConnectionString("ftp://x/y")).toBeNull();
  });
});

describe("hintFor", () => {
  it("gives a hint for common errors", () => {
    expect(hintFor("connection refused")).toMatch(/running/);
    expect(hintFor("password authentication failed for user x")).toMatch(/password/);
    expect(hintFor("something unusual")).toBe("");
  });
});
