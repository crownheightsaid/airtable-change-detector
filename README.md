# Airtable Change Detector 

[![npm version](https://badge.fury.io/js/airtable-change-detector.svg)](https://badge.fury.io/js/airtable-change-detector)

Detects changes on an Airtable table by storing previous state for each row in a field of your choosing.
This can be used to perform logic (like webhooks) on field changes.

Package is `1.0.0` because it's used in production and we have no plans on changing API. However, it is undertested.
Please add tests if you can! There is only one source file.

## Installation

```sh
npm install airtable-change-detector --save
```

## Airtable Setup

**Required:** the following fields on tables that you want to detect (names can be configured):
- **Meta**

  `Long text` field. Stores the previous row state as serialized JSON

  ![Meta](.github/meta.png)

- **Last Modified**

  `Last modified time` field. Used to query which rows have changed. You can set this to only fields you care about, but by default all fields are stored in `Meta`

  ![Modified](.github/modified.png)

**Optional** You can also include the optional field:
- **Last Processed**

  `Date` field. Stores the last time the detector detected a change.

  ![Processed](.github/processed.png)

## Usage example

This example uses all available options for `ChangeDetector`.

```js
const ChangeDetector = require("airtable-change-detector");

const base = new Airtable({ apiKey: process.env.AIR_KEY }).base(
  process.env.AIR_BASE_ID
);

// You can create multiple ChangeDetectors for each table you want to watch.
const myTableDetector = new ChangeDetector(base("MyTableName"), {
  writeDelayMs: 100, // Delay between Airtable writes.
  metaFieldName: "MyMetaField", // Defaults to `Meta`
  lastModifiedFieldName: "My Last Modified", // Defaults to `Last Modified`
  lastProcessedFieldName: "Last Processed", // If not included, detector will not write this field
  sensitiveFields: ["Address", "Birthdate"] // Fields not to include in `Meta`s previous state. Useful for keeping data deletion easy.
});
myTableDetector.pollWithInterval(
  "pollingNameForLogging",
  10000, // interval in milliseconds. `pollWithInterval` will wait for both interval and work to complete
  async recordsChanged => {
    const statusFieldName = "Status";
    const colorFieldName = "Color";
    console.info(`Found ${recordsChanged.length} changes in MyTableName`);
    const promises = [];
    recordsChanged.forEach(record => {
      // Each `record` is an Airtable record in the node API with extra fields added including:
      // record.didChange(field) returns true if the field changed (or is new) between the last observation and now
      // record.getPrior(field) returns the prior value for `field` or undefined
      // See `enrichRecord` for more added methods
      
      if (record.didChange(colorFieldName)) {
        // Ex: send new color value to webhook
        promises.push(axios.post(myWebhookUrl, { newColor: record.get(colorFieldName) }));
      }
      if (
        record.didChange(statusFieldName) &&
        record.getPrior(statusFieldName) === "New" &&
        record.get(statusFieldName) === "Assigned"
      ) {
        const result = await doSomeAsyncLogic();
        console.log(result);
      }
    });
    // If doing many Airtable writes, be careful of 5rps rate limit
    return Promise.all(promises);
  }
);
```

## Caveats

- All comparison for the sake of change detecting is done with lodash's [isEqual](https://lodash.com/docs/4.17.15#isEqual)
- Changes are only detected ONCE. If your change logic fails, you could:
   - Retry it yourself
   - Modify a field that is watched by `Last Modified` field. The change detector will fire again for the field you changed.
   - Remove the watched field that you were reacting to in the `lastValues` Meta property. The prior value would be lost. (this is complicated and we may provide an API if there is interest)

## Info

This was created by [@alexquick](https://github.com/alexquick) to poll airtable at an interval
for [mutual-aid-app](https://github.com/crownheightsma/mutual-aid-app).

## Development setup

```sh
npm i // Initial install

npm run lint // Find lint issues 
npm run fix // Attempt to fix lint issues 
npm run test // Run mocha tests 
```

## Contributing

1. Fork it (<>)
2. Create your feature branch (`git checkout -b feature/fooBar`)
3. Commit your changes (`git commit -am 'Add some fooBar'`)
4. Push to the branch (`git push origin feature/fooBar`)
5. Create a new Pull Request
