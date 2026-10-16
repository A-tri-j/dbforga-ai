import datetime as dt

import pytest
from bson import ObjectId

from app.services import mongo_runner as mr
from app.services import schema_tools as st


def test_parse_find_with_chain_and_relaxed_json():
    cmd = mr.parse_command("db.students.find({age: {$gt: 18}, name: 'Ana'}, {name: 1}).sort({name: 1}).limit(5);")
    assert (cmd.coll, cmd.method, cmd.kind) == ("students", "find", "FIND")
    assert cmd.args[0] == {"age": {"$gt": 18}, "name": "Ana"} and cmd.args[1] == {"name": 1}
    assert cmd.sort == {"name": 1} and cmd.limit == 5 and not cmd.is_write


def test_objectid_and_isodate_helpers():
    cmd = mr.parse_command('db.u.find({_id: ObjectId("507f1f77bcf86cd799439011"), at: {$gte: ISODate("2024-01-01T00:00:00Z")}})')
    assert cmd.args[0]["_id"] == ObjectId("507f1f77bcf86cd799439011")
    assert isinstance(cmd.args[0]["at"]["$gte"], dt.datetime)


def test_leading_comments_and_get_collection():
    cmd = mr.parse_command('// Prompt: list\n/* note */ db.getCollection("my coll").find({}) // trailing')
    assert cmd.coll == "my coll"


def test_javascript_operators_are_rejected():
    for q in ['db.a.find({$where: "this.x > 1"})', 'db.a.aggregate([{$group: {_id: 1, v: {$function: {}}}}])']:
        with pytest.raises(mr.MongoInputError):
            mr.parse_command(q)


def test_write_and_destructive_classification():
    assert mr.parse_command("db.a.deleteMany({})").destructive
    insert = mr.parse_command("db.a.insertOne({x: 1})")
    assert insert.is_write and not insert.destructive
    out = mr.parse_command("db.a.aggregate([{$match: {}}, {$out: 'b'}])")
    assert out.is_write and out.destructive


@pytest.mark.parametrize("bad", ["select 1", "db.a.mapReduce({})", "db.a.find({}) xyz", "db.a.find({x: 1", "db.a.insertOne(5).sort({a:1})"])
def test_bad_queries(bad):
    with pytest.raises(mr.MongoInputError):
        mr.parse_command(bad)


def test_read_only_blocks_writes_without_touching_the_server():
    cmd = mr.parse_command("db.a.insertOne({x: 1})")
    out = mr.run_command(client=None, db_name="d", user_id=1, query_id="q-readonly-1", cmd=cmd,
                         read_only=True, max_rows=10, timeout_s=5)
    assert out["status"] == "error" and "Read-only" in out["message"]


def test_cell_conversion():
    assert mr._cell(ObjectId("507f1f77bcf86cd799439011")) == "507f1f77bcf86cd799439011"
    assert mr._cell({"a": 1}) == '{"a": 1}'


def test_inferred_relationship_from_camel_case_object_id():
    def col(name, typ):
        return {"name": name, "type": typ, "nullable": False, "default": None}

    cap = {"tables": {
        "students": {"columns": [col("_id", "ObjectId")], "primary_key": ["_id"], "foreign_keys": [], "indexes": []},
        "enrollments": {"columns": [col("_id", "ObjectId"), col("studentId", "ObjectId")],
                        "primary_key": ["_id"], "foreign_keys": [], "indexes": []},
    }, "truncated": False, "omitted_cross_schema_fks": 0}
    rels = st.build_graph(cap, "db")["relationships"]
    assert any(r["source_table"] == "enrollments" and r["target_table"] == "students" and r["kind"] == "inferred" for r in rels)
