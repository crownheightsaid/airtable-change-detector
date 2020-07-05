const _ = require("lodash");
const RecordError = require("./RecordError.js");

// N second overlap for lastModified
// We are worried that there's clock skew on Airtable's part so we end up overlapping our requests by 5s to try to work around this possibility
const overlapMs = 5 * 1000;
// Airtable only allows 10 records at a time to be updated
const UPDATE_BATCH_SIZE = 10;

const wait = interval => new Promise(r => setTimeout(r, interval));
/**
 * Reusable scheduler for repeating in-process tasks
 * `interval` is between one invocation's end and the next one's start, unlike `setInterval`
 */
function schedule(taskName, interval, f, errFunc) {
  let running = true;
  (async () => {
    console.log(`Starting ${taskName} and polling every ${interval}ms`);
    /* eslint-disable no-await-in-loop */
    while (running) {
      try {
        // Wait for last to finish
        await Promise.all([f(), wait(interval)]);
      } catch (e) {
        let err = e;
        if (e instanceof RecordError) {
          err = e.cause;
        }
        console.error(
          `Error in ${taskName} poll. Continuing in ${interval}. %O`,
          err
        );
        if (errFunc) {
          errFunc(err);
        }
        await wait(interval);
      }
    }
    /* eslint-disable no-await-in-loop */
    console.log(`Stopped ${taskName}`);
  })();
  return () => {
    console.log(`Stopping ${taskName}`);
    running = false;
  };
}

/**
 * Implementation of a simple change detector for Airtable Tables
 * Relies on 2 fields and provides a 3rd:
 * 1) `metaField`:          stores the last values for the row. This is used to determine what has changed and lets you see what the changes were
 * 2) `lastModifiedField`:  set up to be an automatic Last Modified field on Airtable's side. This lets us easily poll for changed/new rows.
 * 3) `lastProcessedField': a datetime field that holds the last time this record was processed through the system
 *
 * The basic flow is to:
 * 1) Find all records where lastModified > the last observed lastModified - an overlapp
 * 2) Check to make sure that non-meta columns have actually changed
 * 3) Update the record's lastProcessed and meta.lastValues to reflect what the state is currently
 * 3) Emit the records that have changed to the caller.
 *
 * Use like:
 *   const detector = new ChangeDetector("YourTableName")
 *   const changes = detector.poll()
 *   for(const changedRecord of changes){
 *    //do something with the record
 *   }
 *   //wait some time and poll again
 */
class ChangeDetector {
  constructor(table, config) {
    this.tableName = table.name;
    this.table = table;
    this.lastModified = new Date(0); // Unix epoch 0
    const options = config || {};
    this.metaFieldName = options.metaFieldName || "Meta";
    this.lastModifiedFieldName =
      options.lastModifiedFieldName || "Last Modified";
    this.lastProcessedFieldName = options.lastProcessedFieldName || "";
    this.writeDelayMs = options.writeDelayMs || 0;
    this.sensitiveFields = options.sensitiveFields || [];
    this.autoUpdateEnabled = options.autoUpdateEnabled || true;
  }

  /**
   * Returns all the records that have been changed or added since last `pollOnce()`.
   *
   * Promise is rejected in the case of a configured field not existing in airtable.
   *
   * The Airtable record objects are just a map from field to value:
   *   record.get("field name") // returns current value for "field name"
   * (https://github.com/Airtable/airtable.js/blob/master/lib/record.js)
   */
  async pollOnce() {
    const toExamine = await this.getModifiedRecords();
    const recordsWithFieldChanges = toExamine.filter(
      r => this.hasFieldChanges(r),
      this
    );
    const results = recordsWithFieldChanges.map(r => _.cloneDeep(r));
    if (results.length === 0) {
      return results;
    }
    if (this.autoUpdateEnabled) {
      await this.updateRecords(recordsWithFieldChanges);
    }
    this.updateLastModified(toExamine);
    return results;
  }

  /**
   * Calls `pollOnce` on a schedule.
   *
   * Will wait for both interval and work to complete.
   *
   * errFunc(err, recordId?): Optional function
   * for reporting errors. recordId will be null if
   * the error is not specific to a single record.
   */
  pollWithInterval(taskName, interval, f, errFunc) {
    return schedule(
      taskName,
      interval,
      async () => {
        try {
          const recordsChanged = await this.pollOnce();
          return f(recordsChanged);
        } catch (e) {
          if (errFunc) {
            if (e instanceof RecordError) {
              return errFunc(e.cause, e.message);
            }
            return errFunc(e);
          }
          throw e;
        }
      },
      errFunc
    );
  }

  /**
   * Gets all the records that have changed since lastModified (- a overlap)
   *
   * The overlap means we will observe some records more than once, but
   * since they won't have any actual field changes they will get filtered out.
   *
   * Similarly, since the lastModified is not persisted across instances, an instance will examine
   * (but not report changes or update metadata) for all rows when it is started.
   */
  async getModifiedRecords() {
    const cutoff = new Date(
      Math.max(this.lastModified.getTime() - overlapMs, 0)
    );
    const modifiedSinceCutoff = `({${
      this.lastModifiedFieldName
    }} > '${cutoff.toISOString()}')`;
    const records = await this.table
      .select({
        filterByFormula: modifiedSinceCutoff
      })
      .all();
    return records.map(r => this.enrichRecord(r), this);
  }

  /**
   * Updates the bookkeeing information in Airtable: metaField and lastProcessedField
   */
  async updateRecords(records) {
    if (records.length === 0) {
      return;
    }
    const updates = [];
    records.forEach(record => {
      const fields = _.clone(record.fields);
      const meta = this.getNormalizedMeta(record);
      delete fields[this.metaFieldName];
      this.sensitiveFields.forEach(sensitiveField => {
        delete fields[sensitiveField];
      });
      meta.lastValues = fields;
      const newFields = {
        [this.metaFieldName]: JSON.stringify(meta)
      };
      if (this.lastProcessedFieldName) {
        newFields[this.lastProcessedFieldName] = new Date().toISOString();
      }
      updates.push({
        id: record.id,
        fields: newFields
      });
    }, this);
    // unfortunately Airtable only allows 10 records at a time to be updated so batck up the changes
    /* eslint-disable no-restricted-syntax */
    for (const batch of _.chunk(updates, UPDATE_BATCH_SIZE)) {
      await this.table.update(batch);
      await wait(this.writeDelayMs);
    }
    /* eslint-enable no-restricted-syntax */
  }

  /**
   * Determines if any of are records fields have changed.
   * This ignores the bookkeeking fields such as metaField and lastProcessedField
   */
  hasFieldChanges(record) {
    const fields = _.clone(record.fields);
    const meta = record.getMeta();
    const { lastValues } = meta;

    const ignoredFields = [
      this.lastModifiedFieldName,
      this.metaFieldName,
      ...this.sensitiveFields
    ];
    if (this.lastProcessedFieldName) {
      ignoredFields.push(this.lastProcessedFieldName);
    }
    ignoredFields.forEach(ignoredField => {
      delete fields[ignoredField];
      delete lastValues[ignoredField];
    });
    if (!_.isEqual(fields, meta.lastValues)) {
      return true;
    }
    return false;
  }

  /**
   * Adds some extra methods to the record
   *   record.getTableName() //returns the table name of the record
   *   record.getPrior(field)  //returns the prior value for `field` or undefined
   *   record.getMeta() // returns the parsed meta for the record: {"lastValues":{...}}
   *   record.didChange(field) // returns true if the field changed (or is new) between the last observation and now
   */
  enrichRecord(record) {
    const meta = this.getNormalizedMeta(record);
    const { lastValues } = meta;
    const enriched = _.cloneDeep(record);
    const lastSetValues = _.keys(lastValues);
    enriched.getTableName = () => this.tableName;
    enriched.getPrior = field => lastValues[field];
    enriched.getMeta = () => meta;
    enriched.didChange = field =>
      lastSetValues.length === 0 || // Short circuit indicating first change
      !_.isEqual(enriched.getPrior(field), enriched.get(field));
    return enriched;
  }

  /**
   * Push this instance's lastModified forward based on the latest modification date of the given fields
   */
  updateLastModified(records) {
    if (records.length === 0) {
      return;
    }
    const maxLastModified = _.max(
      records.map(r => {
        const rModified = r.get(this.lastModifiedFieldName);
        return rModified ? new Date(rModified).getTime() : 0;
      }, this)
    );
    this.lastModified = new Date(maxLastModified || 0);
  }

  getNormalizedMeta(record) {
    if (!record.fields[this.metaFieldName]) {
      return { lastValues: {} };
    }
    let meta;
    try {
      meta = JSON.parse(record.fields[this.metaFieldName]);
    } catch (e) {
      throw new RecordError(record.id, e);
    }
    if (!meta.lastValues) {
      meta.lastValues = {};
    }
    return meta;
  }
}

ChangeDetector.RecordError = RecordError;
module.exports = ChangeDetector;
