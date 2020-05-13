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
      // Default report no changes
      const stub = sinon.stub(table, "select").returns({
        all: () => Promise.resolve([])
      });

      const changes = new ChangeDetector(table);

      let changed = await changes.pollOnce();
      assert.isEmpty(changed);

      stub.onSecondCall().returns({
        all: () =>
          Promise.resolve([
            {
              id: "someRecord",
              fields: { "Last Modified": modifiedTime, Name: "Old Name" },
              get(field) {
                return this.fields[field];
              }
            }
          ])
      });

      changed = await changes.pollOnce();
      assert.lengthOf(changed, 1);
      let [newRecord] = changed;
      assert.equal(newRecord.get("Name"), "Old Name");
      assert.isUndefined(newRecord.get("Notes"));
      assert.isTrue(newRecord.didChange("Name"));
      assert.isTrue(newRecord.didChange("Notes"));
      assert.isUndefined(newRecord.getPrior("Name"));
      assert.isUndefined(newRecord.getPrior("Notes"));
      const update = updateSpy.firstCall.args[0];
      const meta = {
        lastValues: {
          "Last Modified": modifiedTime,
          Name: "Old Name"
        }
      };
      expect(update).to.deep.include({
        id: "someRecord",
        fields: {
          Meta: JSON.stringify(meta)
        }
      });

      stub.onThirdCall().returns({
        all: () =>
          Promise.resolve([
            {
              id: "someRecord",
              fields: {
                Meta: JSON.stringify(meta),
                Name: "New Name"
              },
              get(field) {
                return this.fields[field];
              }
            }
          ])
      });

      changed = await changes.pollOnce();
      assert.equal(changed.length, 1);
      [newRecord] = changed;
      assert.isTrue(newRecord.didChange("Name"));
      assert.equal(newRecord.getPrior("Name"), "Old Name");
      assert.equal(newRecord.get("Name"), "New Name");

      changed = await changes.pollOnce();
      assert.equal(changed.length, 0);
    });
  }).timeout(10000);
});
