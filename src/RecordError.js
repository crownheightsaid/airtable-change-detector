/**
 * Thrown when an error rises from an individual record
 * (such as issue parsing Meta field JSON).
 */
class RecordError extends Error {
  constructor(recordId, cause) {
    super(recordId);
    this.cause = cause;
    this.name = this.constructor.name;
  }
}

module.exports = RecordError;
