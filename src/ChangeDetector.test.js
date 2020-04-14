const sinon = require("sinon");
const { expect, assert } = require("chai");
const Airtable = require("airtable");
const ChangeDetector = require("./ChangeDetector");

process.on("unhandledRejection", (reason, p) => {
  console.log("Unhandled Rejection at: Promise", p, "reason:", reason);
  // application specific logging, throwing an error, or other logic here
});

afterEach(() => {
  sinon.restore();
});

describe("Airtable Changes", () => {
  describe("#pollOnce()", () => {
    it("Should return records that are new", async () => {
      const modifiedTime = "a date";
      const base = new Airtable.Base("airtable", "baseId");
      const table = base.table("tableName");
      const updateSpy = sinon.fake();
      sinon.replace(table, "update", updateSpy);
      sinon
        .stub(table, "select")
        .returns({
          all: () => Promise.resolve([])
        })
        .onSecondCall()
        .returns({
          all: () =>
            Promise.resolve([
              {
                id: "someRecord",
                fields: { "Last Modified": modifiedTime, Name: "test" },
                get(field) {
                  return this.fields[field];
                }
              }
            ])
        })
        .onThirdCall()
        .returns({
          all: () =>
            Promise.resolve([
              {
                id: "someRecord",
                fields: { Name: "New Name" },
                get(field) {
                  return this.fields[field];
                }
              }
            ])
        });
      const changes = new ChangeDetector(table);

      let changed = await changes.pollOnce();
      assert.equal(0, changed.length);

      changed = await changes.pollOnce();
      assert.equal(1, changed.length);
      const newRecord = changed[0];
      assert.equal("test", newRecord.get("Name"));
      assert.equal(undefined, newRecord.get("Notes"));
      assert.isOk(newRecord.didChange("Name"));
      assert.isOk(newRecord.didChange("Notes"));
      assert.equal(undefined, newRecord.getPrior("Name"));
      assert.equal(undefined, newRecord.getPrior("Notes"));
      const update = updateSpy.firstCall.args[0];
      const meta = {
        lastValues: {
          "Last Modified": modifiedTime,
          Name: "test"
        }
      };
      expect(update).to.deep.include({
        id: "someRecord",
        fields: {
          Meta: JSON.stringify(meta)
        }
      });

      changed = await changes.pollOnce();
      assert.equal(1, changed.length);

      changed = await changes.pollOnce();
      assert.equal(0, changed.length);
    });
  }).timeout(10000);
});
