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

  describe("#enrichRecords()", () => {
    describe("#didChange()", () => {
      it("Should compare array changes by value", async () => {
        const base = new Airtable.Base("airtable", "baseId");
        const table = base.table("tableName");
        const updateSpy = sinon.fake();
        sinon.replace(table, "update", updateSpy);
        const stub = sinon.stub(table, "select").returns({
          all: () =>
            Promise.resolve([
              {
                id: "someRecord",
                fields: { Things: ["thing1", "thing2"] },
                get(field) {
                  return this.fields[field];
                }
              }
            ])
        });

        const changes = new ChangeDetector(table);
        let changed = await changes.pollOnce();
        assert.lengthOf(changed, 1);
        let [newRecord] = changed;
        assert.isTrue(newRecord.didChange("Things"));

        // No change
        stub.onSecondCall().returns({
          all: () =>
            Promise.resolve([
              {
                id: "someRecord",
                fields: {
                  Things: ["thing1", "thing2"],
                  Meta: JSON.stringify({
                    lastValues: {
                      Things: ["thing1", "thing2"]
                    }
                  })
                },
                get(field) {
                  return this.fields[field];
                }
              }
            ])
        });

        changed = await changes.pollOnce();
        assert.isEmpty(changed);

        // Change to different field
        stub.onThirdCall().returns({
          all: () =>
            Promise.resolve([
              {
                id: "someRecord",
                fields: {
                  Things: ["thing1", "thing2"],
                  NewField: 1,
                  Meta: JSON.stringify({
                    lastValues: {
                      Things: ["thing1", "thing2"]
                    }
                  })
                },
                get(field) {
                  return this.fields[field];
                }
              }
            ])
        });

        changed = await changes.pollOnce();
        assert.lengthOf(changed, 1);
        [newRecord] = changed;
        assert.isNotTrue(newRecord.didChange("Things"));
        assert.deepStrictEqual(newRecord.get("Things"), ["thing1", "thing2"]);

        // Change to array field
        stub.onCall(3).returns({
          all: () =>
            Promise.resolve([
              {
                id: "someRecord",
                fields: {
                  Things: ["thing1", "thing2", "thing3"],
                  NewField: 1,
                  Meta: JSON.stringify({
                    lastValues: {
                      NewField: 1,
                      Things: ["thing1", "thing2"]
                    }
                  })
                },
                get(field) {
                  return this.fields[field];
                }
              }
            ])
        });

        changed = await changes.pollOnce();
        assert.lengthOf(changed, 1);
        [newRecord] = changed;
        assert.isTrue(newRecord.didChange("Things"));
        assert.deepStrictEqual(newRecord.get("Things"), [
          "thing1",
          "thing2",
          "thing3"
        ]);
      });
    }).timeout(10000);
  });
});
